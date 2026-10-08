import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { aggregateShopping, type Preparation, type Recipe, type ShoppingList } from "@/lib/domain";
import {
  ACCOUNT,
  OTHER_ACCOUNT,
  asAccount,
  createDatabase,
  resetAccount,
  rpc,
} from "./helpers/database";

let db: PGlite;

const recipeArgs = {
  p_id: null,
  p_expected_revision: null,
  p_title: "Crêpes",
  p_servings: 4,
  p_steps: ["Mélanger."],
  p_ingredients: [
    { name: "Farine", aisle: "pantry", quantity: 500, unit: "g" },
    { name: "Sel", aisle: "pantry", quantity: null, unit: "to_taste" },
  ],
  p_photo_action: "keep",
  p_photo_path: null,
};

async function createRecipe(overrides: Record<string, unknown> = {}) {
  const result = await rpc<{ id: string; previous_photo_path: string | null }>(
    db,
    ACCOUNT,
    "save_recipe",
    { ...recipeArgs, ...overrides },
  );
  return result.id;
}

async function createList(recipeId?: string): Promise<ShoppingList> {
  await rpc(db, ACCOUNT, "save_selection", {
    p_id: null,
    p_recipe_id: recipeId ?? (await createRecipe()),
    p_servings: 2,
  });
  const preparation = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
  await rpc(db, ACCOUNT, "replace_shopping_list", {
    p_revision: preparation.revision,
    p_expected_list_id: null,
    p_items: aggregateShopping(preparation.selections),
  });
  return rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list");
}

beforeAll(async () => {
  db = await createDatabase();
});

beforeEach(async () => {
  await resetAccount(db, ACCOUNT);
  await db.query("delete from storage.objects where name like $1", [`${ACCOUNT}/%`]);
});

afterAll(async () => {
  await db?.close();
});

describe("migrations, droits et transactions PostgreSQL", () => {
  it("publie les révisions privées pour partager les modifications et suppressions", async () => {
    const publication = await db.query<{ tablename: string }>(
      "select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'",
    );
    expect(publication.rows.map((row) => row.tablename)).toContain("workspaces");
  });

  it("enregistre une recette complète avec sa révision initiale", async () => {
    const id = await createRecipe();
    const recipes = await rpc<Recipe[]>(db, ACCOUNT, "get_recipes");
    expect(recipes[0]).toMatchObject({
      id,
      title: "Crêpes",
      servings: 4,
      steps: ["Mélanger."],
      revision: 0,
    });
    expect(recipes[0].ingredients).toHaveLength(2);
  });

  it("renvoie une fiche ciblée et un catalogue résumé sans étapes ni photo", async () => {
    const id = await createRecipe({
      p_photo_action: "replace",
      p_photo_path: `${ACCOUNT}/crêpes.png`,
    });
    const recipe = await rpc<Record<string, unknown>>(db, ACCOUNT, "get_recipe", { p_id: id });
    const summaries = await rpc<Array<Record<string, unknown>>>(
      db,
      ACCOUNT,
      "get_recipe_summaries",
    );

    expect(recipe).toMatchObject({ id, title: "Crêpes", revision: 0 });
    expect(summaries).toEqual([{ id, title: "Crêpes", servings: 4, ingredient_count: 2 }]);
    expect(await rpc(db, OTHER_ACCOUNT, "get_recipe", { p_id: id })).toBeNull();
  });

  it("ne retourne dans la préparation que les données nécessaires au calcul", async () => {
    const id = await createRecipe({
      p_photo_action: "replace",
      p_photo_path: `${ACCOUNT}/crêpes.png`,
    });
    await rpc(db, ACCOUNT, "save_selection", { p_id: null, p_recipe_id: id, p_servings: 2 });
    const preparation = await rpc<{ selections: Array<{ recipe: Record<string, unknown> }> }>(
      db,
      ACCOUNT,
      "get_preparation",
    );

    expect(preparation.selections[0].recipe).toHaveProperty("ingredients");
    expect(preparation.selections[0].recipe).not.toHaveProperty("steps");
    expect(preparation.selections[0].recipe).not.toHaveProperty("photo_path");
  });

  it("réutilise un ingrédient malgré sa casse et ses espaces", async () => {
    await createRecipe({
      p_title: "Gâteau",
      p_ingredients: [{ name: "  FARINE  ", aisle: "pantry", quantity: 0.25, unit: "kg" }],
    });
    const result = await asAccount(db, ACCOUNT, (tx) =>
      tx.query("select * from public.ingredients where normalized_name = 'farine'"),
    );
    expect(result.rows).toHaveLength(1);
  });

  it("refuse les étapes nulles et les recettes incohérentes sans laisser d'écriture", async () => {
    await expect(createRecipe({ p_steps: [null] as unknown as string[] })).rejects.toThrow(
      "INVALID_STEPS",
    );
    await expect(
      createRecipe({
        p_title: "Invalide",
        p_ingredients: [{ name: "Nouveau", aisle: "other", quantity: null, unit: "g" }],
      }),
    ).rejects.toThrow();

    const recipes = await rpc<Recipe[]>(db, ACCOUNT, "get_recipes");
    const ingredients = await asAccount(db, ACCOUNT, (tx) =>
      tx.query("select * from public.ingredients where name = 'Nouveau'"),
    );
    expect(recipes).toEqual([]);
    expect(ingredients.rows).toHaveLength(0);
  });

  it("empêche un autre compte de lire ou modifier une recette", async () => {
    const id = await createRecipe();
    expect(await rpc(db, OTHER_ACCOUNT, "get_recipes")).toEqual([]);
    await expect(rpc(db, OTHER_ACCOUNT, "delete_recipe", { p_id: id })).rejects.toThrow(
      "NOT_FOUND",
    );
    await expect(
      rpc(db, OTHER_ACCOUNT, "save_recipe", { ...recipeArgs, p_id: id, p_expected_revision: 0 }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("interdit le mélange de propriétaires dans les ingrédients et les plats", async () => {
    const id = await createRecipe();
    const ingredientId = (await rpc<Recipe[]>(db, ACCOUNT, "get_recipes"))[0].ingredients[0]
      .ingredient_id;
    await expect(
      rpc(db, OTHER_ACCOUNT, "save_recipe", {
        ...recipeArgs,
        p_ingredients: [
          { ingredient_id: ingredientId, name: "Farine", aisle: "pantry", quantity: 1, unit: "g" },
        ],
      }),
    ).rejects.toThrow("NOT_FOUND");
    await expect(
      rpc(db, OTHER_ACCOUNT, "save_selection", { p_id: null, p_recipe_id: id, p_servings: 2 }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("interdit les écritures directes et l'accès anonyme", async () => {
    await createRecipe();
    await expect(
      asAccount(db, ACCOUNT, (tx) => tx.query("update public.recipes set title = 'contournement'")),
    ).rejects.toThrow("permission denied");
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        return tx.query("select public.get_recipes()");
      }),
    ).rejects.toThrow("permission denied");
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        return tx.query("select * from public.recipes");
      }),
    ).rejects.toThrow("permission denied");
  });

  it("protège les photos privées et refuse un chemin d'un autre compte", async () => {
    await asAccount(db, ACCOUNT, (tx) =>
      tx.query("insert into storage.objects(bucket_id,name) values('recipe-photos',$1)", [
        `${ACCOUNT}/photo.jpg`,
      ]),
    );
    expect(
      (await asAccount(db, OTHER_ACCOUNT, (tx) => tx.query("select * from storage.objects"))).rows,
    ).toHaveLength(0);
    await expect(
      asAccount(db, OTHER_ACCOUNT, (tx) =>
        tx.query("insert into storage.objects(bucket_id,name) values('recipe-photos',$1)", [
          `${ACCOUNT}/intrusion.jpg`,
        ]),
      ),
    ).rejects.toThrow();
    await expect(
      createRecipe({ p_photo_action: "replace", p_photo_path: `${OTHER_ACCOUNT}/photo.jpg` }),
    ).rejects.toThrow();
    expect(
      (
        await asAccount(db, OTHER_ACCOUNT, (tx) =>
          tx.query("delete from storage.objects returning id"),
        )
      ).rows,
    ).toHaveLength(0);
  });

  it("autorise plusieurs occurrences d'une recette et génère un instantané", async () => {
    const id = await createRecipe();
    await rpc(db, ACCOUNT, "save_selection", { p_id: null, p_recipe_id: id, p_servings: 2 });
    await rpc(db, ACCOUNT, "save_selection", { p_id: null, p_recipe_id: id, p_servings: 4 });
    const preparation = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    expect(preparation.selections).toHaveLength(2);

    await rpc(db, ACCOUNT, "replace_shopping_list", {
      p_revision: preparation.revision,
      p_expected_list_id: null,
      p_items: aggregateShopping(preparation.selections),
    });
    const list = await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list");
    expect(list.dish_count).toBe(2);
    expect(list.items.find((item) => item.name === "Farine")?.quantity).toBe(750);
  });

  it("persiste un état coché idempotent et refuse un autre compte", async () => {
    const list = await createList();
    const item = list.items[0];
    await rpc(db, ACCOUNT, "set_shopping_item_checked", {
      p_id: item.id,
      p_list_id: list.id,
      p_checked: true,
    });
    await rpc(db, ACCOUNT, "set_shopping_item_checked", {
      p_id: item.id,
      p_list_id: list.id,
      p_checked: true,
    });
    expect(
      (await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list")).items.find(
        (entry) => entry.id === item.id,
      )?.checked,
    ).toBe(true);
    await expect(
      rpc(db, OTHER_ACCOUNT, "set_shopping_item_checked", {
        p_id: item.id,
        p_list_id: list.id,
        p_checked: false,
      }),
    ).rejects.toThrow("LIST_CHANGED");
    expect(await rpc(db, OTHER_ACCOUNT, "get_shopping_list")).toBeNull();
  });

  it("préserve la liste et la photo lors d'une édition qui conserve la photo", async () => {
    const id = await createRecipe({
      p_photo_action: "replace",
      p_photo_path: `${ACCOUNT}/photo.png`,
    });
    const initial = await rpc<Recipe[]>(db, ACCOUNT, "get_recipes");
    await rpc(db, ACCOUNT, "save_selection", { p_id: null, p_recipe_id: id, p_servings: 2 });
    const before = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    await rpc(db, ACCOUNT, "replace_shopping_list", {
      p_revision: before.revision,
      p_expected_list_id: null,
      p_items: aggregateShopping(before.selections),
    });
    const list = await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list");

    await rpc(db, ACCOUNT, "save_recipe", {
      ...recipeArgs,
      p_id: id,
      p_expected_revision: initial[0].revision,
      p_title: "Recette modifiée",
      p_servings: 8,
      p_photo_action: "keep",
    });
    expect((await rpc<Recipe[]>(db, ACCOUNT, "get_recipes"))[0].photo_path).toBe(
      `${ACCOUNT}/photo.png`,
    );
    expect(await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list")).toEqual(list);
  });

  it("rejette une modification basée sur une ancienne révision", async () => {
    const id = await createRecipe({
      p_photo_action: "replace",
      p_photo_path: `${ACCOUNT}/original.png`,
    });
    await rpc(db, ACCOUNT, "save_recipe", {
      ...recipeArgs,
      p_id: id,
      p_expected_revision: 0,
      p_photo_action: "replace",
      p_photo_path: `${ACCOUNT}/remplacée.png`,
    });

    await expect(
      rpc(db, ACCOUNT, "save_recipe", {
        ...recipeArgs,
        p_id: id,
        p_expected_revision: 0,
        p_photo_action: "keep",
      }),
    ).rejects.toThrow("RECIPE_CHANGED");
    expect((await rpc<Recipe[]>(db, ACCOUNT, "get_recipes"))[0].photo_path).toBe(
      `${ACCOUNT}/remplacée.png`,
    );
  });

  it("détecte les générations périmées sans perdre les cases cochées", async () => {
    const list = await createList();
    await rpc(db, ACCOUNT, "set_shopping_item_checked", {
      p_id: list.items[0].id,
      p_list_id: list.id,
      p_checked: true,
    });
    const snapshot = await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list");
    const before = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    await rpc(db, ACCOUNT, "save_selection", {
      p_id: null,
      p_recipe_id: before.selections[0].recipe.id,
      p_servings: 2,
    });
    await expect(
      rpc(db, ACCOUNT, "replace_shopping_list", {
        p_revision: before.revision,
        p_expected_list_id: list.id,
        p_items: aggregateShopping(before.selections),
      }),
    ).rejects.toThrow("PLAN_CHANGED");

    const after = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    await expect(
      rpc(db, ACCOUNT, "replace_shopping_list", {
        p_revision: after.revision,
        p_expected_list_id: null,
        p_items: aggregateShopping(after.selections),
      }),
    ).rejects.toThrow("LIST_CHANGED");
    expect(await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list")).toEqual(snapshot);
    expect(snapshot.items[0].checked).toBe(true);
  });

  it("refuse une révision nulle au lieu de contourner le contrôle", async () => {
    const list = await createList();
    const preparation = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    await expect(
      rpc(db, ACCOUNT, "replace_shopping_list", {
        p_revision: null,
        p_expected_list_id: list.id,
        p_items: aggregateShopping(preparation.selections),
      }),
    ).rejects.toThrow("PLAN_CHANGED");
  });

  it("remplace atomiquement la liste et rejette un clic sur l'ancienne", async () => {
    const previous = await createList();
    const preparation = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    await rpc(db, ACCOUNT, "replace_shopping_list", {
      p_revision: preparation.revision,
      p_expected_list_id: previous.id,
      p_items: aggregateShopping(preparation.selections),
    });
    const replacement = await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list");
    expect(replacement.id).not.toBe(previous.id);
    expect(replacement.items.every((item) => !item.checked)).toBe(true);
    await expect(
      rpc(db, ACCOUNT, "set_shopping_item_checked", {
        p_id: previous.items[0].id,
        p_list_id: previous.id,
        p_checked: true,
      }),
    ).rejects.toThrow("LIST_CHANGED");
  });

  it("renvoie le chemin supprimé et conserve l'instantané après suppression de recette", async () => {
    const id = await createRecipe({
      p_photo_action: "replace",
      p_photo_path: `${ACCOUNT}/photo.png`,
    });
    const list = await createList(id);
    const deleted = await rpc<{ photo_path: string | null }>(db, ACCOUNT, "delete_recipe", {
      p_id: id,
    });

    expect(deleted).toEqual({ photo_path: `${ACCOUNT}/photo.png` });
    expect((await rpc<Preparation>(db, ACCOUNT, "get_preparation")).selections).toHaveLength(0);
    expect(await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list")).toEqual(list);
  });
});
