import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import {
  recipeRecordSchema,
  recipeListSchema,
  recipeSummaryListSchema,
  preparationSchema,
  preparationViewSchema,
  shoppingListSchema,
  saveRecipeResultSchema,
  deleteRecipeResultSchema,
  aggregateShopping,
  parseServings,
  recipeSchema,
  normalizeIngredientName,
  SERVINGS_MIN,
  SERVINGS_MAX,
} from "@/lib/domain";
import { ACCOUNT, OTHER_ACCOUNT, createDatabase, resetAccount, rpc } from "./helpers/database";
let db: PGlite;
const args = {
  p_id: null,
  p_expected_revision: null,
  p_title: "Crêpes",
  p_servings: 4,
  p_steps: ["Cuire."],
  p_ingredients: [{ name: "Farine de blé", aisle: "pantry", quantity: 500, unit: "g" }],
  p_photo_action: "keep",
  p_photo_path: null,
};
beforeAll(async () => {
  db = await createDatabase();
});
beforeEach(async () => {
  await resetAccount(db, ACCOUNT);
});
afterAll(async () => {
  await db?.close();
});
describe("contrats SQL ↔ décodeurs TypeScript", () => {
  it("limite la nouvelle lecture au compte et garde le trigger interne non exécutable", async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select public.get_preparation_view()");
      }),
    ).rejects.toThrow("permission denied");
    const privilege = await db.query<{ allowed: boolean }>(
      "select has_function_privilege('authenticated', 'public.invalidate_recipes_for_aisle_change()', 'execute') as allowed",
    );
    expect(privilege.rows[0].allowed).toBe(false);
  });
  it("décode chaque RPC avec le schéma employé par son consommateur", async () => {
    const saved = saveRecipeResultSchema.parse(await rpc(db, ACCOUNT, "save_recipe", args));
    const recipe = recipeRecordSchema.parse(
      await rpc(db, ACCOUNT, "get_recipe", { p_id: saved.id }),
    );
    expect(recipeListSchema.parse(await rpc(db, ACCOUNT, "get_recipes"))).toEqual([recipe]);
    expect(
      recipeSummaryListSchema.parse(await rpc(db, ACCOUNT, "get_recipe_summaries"))[0],
    ).toMatchObject({ ingredient_count: 1 });
    await rpc(db, ACCOUNT, "save_selection", { p_id: null, p_recipe_id: saved.id, p_servings: 2 });
    const prep = preparationSchema.parse(await rpc(db, ACCOUNT, "get_preparation"));
    await rpc(db, ACCOUNT, "replace_shopping_list", {
      p_revision: prep.revision,
      p_expected_list_id: null,
      p_items: aggregateShopping(prep.selections),
    });
    const list = shoppingListSchema.parse(await rpc(db, ACCOUNT, "get_shopping_list"));
    const viewRaw = await rpc(db, ACCOUNT, "get_preparation_view");
    expect(viewRaw).toEqual({
      active_list_id: list.id,
      selections: [
        {
          id: prep.selections[0].id,
          servings: 2,
          recipe: { id: saved.id, title: recipe.title, servings: 4, ingredient_count: 1 },
        },
      ],
    });
    preparationViewSchema.parse(viewRaw);
    expect(
      preparationViewSchema.parse(await rpc(db, OTHER_ACCOUNT, "get_preparation_view")),
    ).toEqual({ active_list_id: null, selections: [] });
    deleteRecipeResultSchema.parse(await rpc(db, ACCOUNT, "delete_recipe", { p_id: saved.id }));
  });
  it("versionne les autres recettes touchées par un changement de rayon partagé", async () => {
    const a = saveRecipeResultSchema.parse(await rpc(db, ACCOUNT, "save_recipe", args));
    const b = saveRecipeResultSchema.parse(
      await rpc(db, ACCOUNT, "save_recipe", { ...args, p_title: "Autre recette" }),
    );
    await rpc(db, ACCOUNT, "save_recipe", {
      ...args,
      p_id: b.id,
      p_expected_revision: 0,
      p_ingredients: [{ ...args.p_ingredients[0], aisle: "other" }],
    });
    expect(
      recipeRecordSchema.parse(await rpc(db, ACCOUNT, "get_recipe", { p_id: a.id })),
    ).toMatchObject({ revision: 1, ingredients: [{ aisle: "other" }] });
    await expect(
      rpc(db, ACCOUNT, "save_recipe", { ...args, p_id: a.id, p_expected_revision: 0 }),
    ).rejects.toThrow("RECIPE_CHANGED");
    expect(
      recipeRecordSchema.parse(await rpc(db, ACCOUNT, "get_recipe", { p_id: a.id })).ingredients[0]
        .aisle,
    ).toBe("other");
  });
  it.each([SERVINGS_MIN - 1, SERVINGS_MIN, SERVINGS_MAX, SERVINGS_MAX + 1])(
    "valide les mêmes bornes de portions en TS et SQL : %i",
    async (servings) => {
      const accepted = parseServings(String(servings)) !== null;
      expect(
        recipeSchema.safeParse({
          title: args.p_title,
          servings,
          steps: [],
          ingredients: args.p_ingredients,
        }).success,
      ).toBe(accepted);
      const call = rpc(db, ACCOUNT, "save_recipe", { ...args, p_servings: servings });
      if (accepted) expect(saveRecipeResultSchema.parse(await call).id).toBeTruthy();
      else await expect(call).rejects.toThrow();
    },
  );
  it("normalise le même nom accepté par le serveur et la colonne SQL", async () => {
    const name = "  FARINE   de   blé  ";
    await rpc(db, ACCOUNT, "save_recipe", {
      ...args,
      p_ingredients: [{ ...args.p_ingredients[0], name }],
    });
    expect(
      (
        await db.query<{ normalized_name: string }>(
          "select normalized_name from public.ingredients where owner_id = $1",
          [ACCOUNT],
        )
      ).rows[0].normalized_name,
    ).toBe(normalizeIngredientName(name));
    expect(normalizeIngredientName(" Farine\tde\nblé ")).toBe("farine de blé");
  });
  it("rejette une révision NULL dans le payload d’édition au lieu de la convertir en zéro", () => {
    expect(
      recipeSchema.safeParse({
        id: ACCOUNT,
        revision: null,
        title: "Recette",
        servings: 2,
        steps: [],
        ingredients: args.p_ingredients,
      }).success,
    ).toBe(false);
  });
});

it("répare une recette avec étape NULL lors de la migration depuis l’ancien schéma", async () => {
  const legacy = await createDatabase({
    migrationsThrough: "20261007185709_shared_workspace_realtime.sql",
  });
  try {
    // Call the original signature; the initial three migrations accepted NULL elements.
    await legacy.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [ACCOUNT]);
      await tx.query(
        "select public.save_recipe(null, 'Ancienne recette', 2, array['Cuire.', null, 'Servir.'], $1::jsonb, null)",
        [JSON.stringify(args.p_ingredients)],
      );
    });
    const { readdir } = await import("node:fs/promises");
    const directory = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(directory))
      .filter(
        (file) => file > "20261007185709_shared_workspace_realtime.sql" && file.endsWith(".sql"),
      )
      .sort()) {
      await legacy.exec(await readFile(new URL(file, directory), "utf8"));
    }
    expect(recipeListSchema.parse(await rpc(legacy, ACCOUNT, "get_recipes"))[0].steps).toEqual([
      "Cuire.",
      "Servir.",
    ]);
  } finally {
    await legacy.close();
  }
});
