import { Client } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { ACCOUNT, BOOTSTRAP_SQL } from "../helpers/database";
import {
  preparationSchema,
  recipeRecordSchema,
  saveRecipeResultSchema,
  shoppingListSchema,
  aggregateShopping,
} from "@/lib/domain";

const url = process.env.TEST_POSTGRES_URL;
if (!url)
  throw new Error(
    "TEST_POSTGRES_URL doit désigner une base PostgreSQL locale vide recipes_test_*.",
  );
const target = new URL(url);
if (
  !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) ||
  !/^\/recipes_test_[a-z0-9_]+$/.test(target.pathname)
) {
  throw new Error(
    "Les tests exigent une base locale dédiée recipes_test_*, jamais une base distante.",
  );
}
const admin = new Client({ connectionString: url });
const first = new Client({ connectionString: url });
const second = new Client({ connectionString: url });
const args = [
  null,
  null,
  "Crêpes",
  4,
  ["Cuire."],
  JSON.stringify([{ name: "Farine", aisle: "pantry", quantity: 500, unit: "g" }]),
  "keep",
  null,
];
async function call(client: Client, name: string, params: unknown[] = []) {
  const placeholders = params.map((_, index) => `$${index + 1}`).join(",");
  return (await client.query(`select public.${name}(${placeholders}) as data`, params)).rows[0]
    .data;
}
async function begin(client: Client) {
  await client.query("begin");
  await client.query("set local role authenticated");
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [ACCOUNT]);
  await client.query("set local statement_timeout = '8s'");
}
async function waitForWorkspaceLock(pid: number) {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const result = await admin.query(
      "select wait_event_type from pg_stat_activity where pid = $1",
      [pid],
    );
    if (result.rows[0]?.wait_event_type === "Lock") return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("La deuxième connexion ne s’est pas bloquée sur le verrou attendu.");
}
beforeAll(async () => {
  await admin.connect();
  const tables = await admin.query("select tablename from pg_tables where schemaname = 'public'");
  if (tables.rows.length)
    throw new Error("La base de test doit être vide ; aucune table existante ne sera effacée.");
  await admin.query(BOOTSTRAP_SQL);
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  for (const file of (await readdir(directory)).filter((file) => file.endsWith(".sql")).sort()) {
    await admin.query(await readFile(new URL(file, directory), "utf8"));
  }
  await first.connect();
  await second.connect();
});
beforeEach(async () => {
  await first.query("rollback");
  await second.query("rollback");
  await admin.query(
    "delete from public.shopping_lists; delete from public.recipes; delete from public.ingredients; delete from public.workspaces;",
  );
});
afterAll(async () => {
  await Promise.all([first.end(), second.end(), admin.end()]);
});
it("sérialise deux éditions simultanées et refuse la révision périmée", async () => {
  await begin(first);
  const saved = saveRecipeResultSchema.parse(await call(first, "save_recipe", args));
  await first.query("commit");
  await begin(first);
  await begin(second);
  const secondPid = (await second.query("select pg_backend_pid() as pid")).rows[0].pid;
  await call(first, "save_recipe", [
    saved.id,
    0,
    "Version A",
    ...args.slice(3, 6),
    "replace",
    `${ACCOUNT}/a.png`,
  ]);
  const pending = call(second, "save_recipe", [
    saved.id,
    0,
    "Version B",
    ...args.slice(3, 6),
    "keep",
    null,
  ]);
  const rejection = expect(pending).rejects.toThrow("RECIPE_CHANGED");
  await waitForWorkspaceLock(secondPid);
  await first.query("commit");
  await rejection;
  await second.query("rollback");
  await begin(first);
  expect(recipeRecordSchema.parse(await call(first, "get_recipe", [saved.id]))).toMatchObject({
    title: "Version A",
    photo_path: `${ACCOUNT}/a.png`,
    revision: 1,
  });
  await first.query("commit");
});
it("refuse une génération bloquée par une mutation concurrente et conserve toutes les coches", async () => {
  await begin(first);
  const recipe = saveRecipeResultSchema.parse(await call(first, "save_recipe", args));
  await call(first, "save_selection", [null, recipe.id, 2]);
  const plan = preparationSchema.parse(await call(first, "get_preparation"));
  await call(first, "replace_shopping_list", [
    plan.revision,
    null,
    JSON.stringify(aggregateShopping(plan.selections)),
  ]);
  const list = shoppingListSchema.parse(await call(first, "get_shopping_list"));
  await call(first, "set_shopping_item_checked", [list.items[0].id, list.id, true]);
  const snapshot = shoppingListSchema.parse(await call(first, "get_shopping_list"));
  await first.query("commit");
  await begin(first);
  await begin(second);
  const secondPid = (await second.query("select pg_backend_pid() as pid")).rows[0].pid;
  await call(first, "save_selection", [null, recipe.id, 3]);
  const rejection = expect(
    call(second, "replace_shopping_list", [
      plan.revision,
      list.id,
      JSON.stringify(aggregateShopping(plan.selections)),
    ]),
  ).rejects.toThrow("PLAN_CHANGED");
  await waitForWorkspaceLock(secondPid);
  await first.query("commit");
  await rejection;
  await second.query("rollback");
  await begin(first);
  expect(shoppingListSchema.parse(await call(first, "get_shopping_list"))).toEqual(snapshot);
  await first.query("commit");
});

it("deux créations simultanées de la même tentative retrouvent une seule recette", async () => {
  const creationId = "33333333-3333-4333-8333-333333333333";
  await begin(first);
  await begin(second);
  const secondPid = (await second.query("select pg_backend_pid() as pid")).rows[0].pid;
  const original = saveRecipeResultSchema.parse(
    await call(first, "save_recipe", [
      ...args.slice(0, 6),
      "replace",
      `${ACCOUNT}/first.png`,
      creationId,
      "same-photo-hash",
    ]),
  );
  const pending = call(second, "save_recipe", [
    ...args.slice(0, 6),
    "replace",
    `${ACCOUNT}/retry.png`,
    creationId,
    "same-photo-hash",
  ]);
  await waitForWorkspaceLock(secondPid);
  await first.query("commit");
  const retried = saveRecipeResultSchema.parse(await pending);
  await second.query("commit");
  expect(retried).toEqual(original);
  await begin(first);
  expect(await call(first, "get_recipes")).toHaveLength(1);
  expect(recipeRecordSchema.parse(await call(first, "get_recipe", [creationId])).photo_path).toBe(
    `${ACCOUNT}/first.png`,
  );
  await first.query("commit");
});
