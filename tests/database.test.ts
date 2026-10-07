import { beforeAll, afterAll, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { aggregateShopping, type Recipe, type Preparation, type ShoppingList } from "@/lib/domain";
import { ACCOUNT, OTHER_ACCOUNT, createDatabase, asAccount, rpc } from "./helpers/database";

let db: PGlite; let recipeId: string; let list: ShoppingList;
const recipeArgs = { p_id: null, p_title: "Crêpes", p_servings: 4, p_steps: ["Mélanger."], p_ingredients: [{ name: "Farine", aisle: "pantry", quantity: 500, unit: "g" }, { name: "Sel", aisle: "pantry", quantity: null, unit: "to_taste" }], p_photo_path: null };
beforeAll(async () => { db = await createDatabase(); });
afterAll(async () => { await db?.close(); });

describe("migrations, droits et transactions PostgreSQL", () => {
  it("publie les révisions privées pour partager les modifications et suppressions", async () => {
    const publication = await db.query<{ tablename: string }>("select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'");
    expect(publication.rows.map(row => row.tablename)).toContain("workspaces");
  });
  it("enregistre une recette complète en une transaction", async () => {
    recipeId = await rpc<string>(db, ACCOUNT, "save_recipe", recipeArgs);
    const recipes = await rpc<Recipe[]>(db, ACCOUNT, "get_recipes");
    expect(recipes[0]).toMatchObject({ title: "Crêpes", servings: 4, steps: ["Mélanger."] }); expect(recipes[0].ingredients).toHaveLength(2);
  });
  it("réutilise un ingrédient malgré sa casse et ses espaces", async () => {
    await rpc(db, ACCOUNT, "save_recipe", { ...recipeArgs, p_title: "Gâteau", p_ingredients: [{ name: "  FARINE  ", aisle: "pantry", quantity: 0.25, unit: "kg" }] });
    const result = await asAccount(db, ACCOUNT, tx => tx.query("select * from public.ingredients where normalized_name = 'farine'"));
    expect(result.rows).toHaveLength(1);
  });
  it("refuse les recettes incohérentes et annule toutes leurs écritures", async () => {
    await expect(rpc(db, ACCOUNT, "save_recipe", { ...recipeArgs, p_title: "Invalide", p_ingredients: [{ name: "Nouveau", aisle: "other", quantity: null, unit: "g" }] })).rejects.toThrow();
    const recipes = await rpc<Recipe[]>(db, ACCOUNT, "get_recipes"); expect(recipes.some(r => r.title === "Invalide")).toBe(false);
    const ingredients = await asAccount(db, ACCOUNT, tx => tx.query("select * from public.ingredients where name = 'Nouveau'")); expect(ingredients.rows).toHaveLength(0);
  });
  it("empêche un autre compte de lire ou modifier nos recettes", async () => {
    expect(await rpc(db, OTHER_ACCOUNT, "get_recipes")).toEqual([]);
    await expect(rpc(db, OTHER_ACCOUNT, "delete_recipe", { p_id: recipeId })).rejects.toThrow("NOT_FOUND");
    await expect(rpc(db, OTHER_ACCOUNT, "save_recipe", { ...recipeArgs, p_id: recipeId })).rejects.toThrow("NOT_FOUND");
  });
  it("interdit le mélange de propriétaires dans les ingrédients et plats", async () => {
    const ingredientId = (await rpc<Recipe[]>(db, ACCOUNT, "get_recipes"))[0].ingredients[0].ingredient_id;
    await expect(rpc(db, OTHER_ACCOUNT, "save_recipe", { ...recipeArgs, p_ingredients: [{ ingredient_id: ingredientId, name: "Farine", aisle: "pantry", quantity: 1, unit: "g" }] })).rejects.toThrow("NOT_FOUND");
    await expect(rpc(db, OTHER_ACCOUNT, "save_selection", { p_id: null, p_recipe_id: recipeId, p_servings: 2 })).rejects.toThrow("NOT_FOUND");
  });
  it("interdit les écritures directes et l’accès anonyme", async () => {
    await expect(asAccount(db, ACCOUNT, tx => tx.query("update public.recipes set title = 'contournement'"))).rejects.toThrow("permission denied");
    await expect(db.transaction(async tx => { await tx.exec("set local role anon"); return tx.query("select public.get_recipes()"); })).rejects.toThrow("permission denied");
    await expect(db.transaction(async tx => { await tx.exec("set local role anon"); return tx.query("select * from public.recipes"); })).rejects.toThrow("permission denied");
  });
  it("protège les photos privées par le préfixe du compte", async () => {
    await asAccount(db, ACCOUNT, tx => tx.query("insert into storage.objects(bucket_id,name) values('recipe-photos',$1)", [`${ACCOUNT}/photo.jpg`]));
    expect((await asAccount(db, OTHER_ACCOUNT, tx => tx.query("select * from storage.objects"))).rows).toHaveLength(0);
    await expect(asAccount(db, OTHER_ACCOUNT, tx => tx.query("insert into storage.objects(bucket_id,name) values('recipe-photos',$1)", [`${ACCOUNT}/intrusion.jpg`]))).rejects.toThrow();
    await expect(rpc(db, OTHER_ACCOUNT, "save_recipe", { ...recipeArgs, p_photo_path: `${ACCOUNT}/photo.jpg` })).rejects.toThrow();
    const removed = await asAccount(db, OTHER_ACCOUNT, tx => tx.query("delete from storage.objects returning id")); expect(removed.rows).toHaveLength(0);
  });
  it("autorise plusieurs occurrences d’une recette et génère un instantané", async () => {
    await rpc(db, ACCOUNT, "save_selection", { p_id: null, p_recipe_id: recipeId, p_servings: 2 });
    await rpc(db, ACCOUNT, "save_selection", { p_id: null, p_recipe_id: recipeId, p_servings: 4 });
    const preparation = await rpc<Preparation>(db, ACCOUNT, "get_preparation"); expect(preparation.selections).toHaveLength(2);
    await rpc(db, ACCOUNT, "replace_shopping_list", { p_revision: preparation.revision, p_expected_list_id: null, p_items: aggregateShopping(preparation.selections) });
    list = await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list");
    expect(list.dish_count).toBe(2); expect(list.items.find(i => i.name === "Farine")?.quantity).toBe(750);
  });
  it("persiste un état coché idempotent et refuse un autre compte", async () => {
    const item = list.items[0];
    await rpc(db, ACCOUNT, "set_shopping_item_checked", { p_id: item.id, p_list_id: list.id, p_checked: true });
    await rpc(db, ACCOUNT, "set_shopping_item_checked", { p_id: item.id, p_list_id: list.id, p_checked: true });
    expect((await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list")).items.find(i => i.id === item.id)?.checked).toBe(true);
    await expect(rpc(db, OTHER_ACCOUNT, "set_shopping_item_checked", { p_id: item.id, p_list_id: list.id, p_checked: false })).rejects.toThrow("LIST_CHANGED");
    expect(await rpc(db, OTHER_ACCOUNT, "get_shopping_list")).toBeNull();
  });
  it("conserve la liste après modification d’une recette", async () => {
    await rpc(db, ACCOUNT, "save_recipe", { ...recipeArgs, p_id: recipeId, p_title: "Crêpes modifiées", p_servings: 8 });
    expect((await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list")).items.find(i => i.name === "Farine")?.quantity).toBe(750);
  });
  it("détecte les générations périmées sans perdre les cases cochées", async () => {
    const before = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    await rpc(db, ACCOUNT, "save_selection", { p_id: null, p_recipe_id: recipeId, p_servings: 2 });
    await expect(rpc(db, ACCOUNT, "replace_shopping_list", { p_revision: before.revision, p_expected_list_id: list.id, p_items: aggregateShopping(before.selections) })).rejects.toThrow("PLAN_CHANGED");
    const after = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    await expect(rpc(db, ACCOUNT, "replace_shopping_list", { p_revision: after.revision, p_expected_list_id: null, p_items: aggregateShopping(after.selections) })).rejects.toThrow("LIST_CHANGED");
    expect((await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list")).items.some(i => i.checked)).toBe(true);
  });
  it("refuse une révision nulle au lieu de contourner le contrôle", async () => {
    const preparation = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    await expect(rpc(db, ACCOUNT, "replace_shopping_list", { p_revision: null, p_expected_list_id: list.id, p_items: aggregateShopping(preparation.selections) })).rejects.toThrow("PLAN_CHANGED");
  });
  it("remplace atomiquement la liste et rejette un clic sur l’ancienne", async () => {
    const preparation = await rpc<Preparation>(db, ACCOUNT, "get_preparation");
    await rpc(db, ACCOUNT, "replace_shopping_list", { p_revision: preparation.revision, p_expected_list_id: list.id, p_items: aggregateShopping(preparation.selections) });
    const replacement = await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list"); expect(replacement.id).not.toBe(list.id); expect(replacement.items.every(i => !i.checked)).toBe(true);
    await expect(rpc(db, ACCOUNT, "set_shopping_item_checked", { p_id: list.items[0].id, p_list_id: list.id, p_checked: true })).rejects.toThrow("LIST_CHANGED");
    list = replacement;
  });
  it("conserve l’instantané après suppression d’une recette", async () => {
    await rpc(db, ACCOUNT, "delete_recipe", { p_id: recipeId });
    expect((await rpc<Preparation>(db, ACCOUNT, "get_preparation")).selections).toHaveLength(0);
    expect((await rpc<ShoppingList>(db, ACCOUNT, "get_shopping_list")).id).toBe(list.id);
  });
});
