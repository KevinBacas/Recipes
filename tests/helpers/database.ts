import { PGlite, type Transaction } from "@electric-sql/pglite";
import { readFile, readdir } from "node:fs/promises";

export const ACCOUNT = "11111111-1111-4111-8111-111111111111";
export const OTHER_ACCOUNT = "22222222-2222-4222-8222-222222222222";
export async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin; create role authenticated nologin;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id), name text);
    alter table storage.objects enable row level security;
    create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
    grant usage on schema public, auth, storage to anon, authenticated;
    grant select,insert,delete on storage.objects to authenticated;
    create publication supabase_realtime;
    insert into auth.users(id) values ('${ACCOUNT}'), ('${OTHER_ACCOUNT}');
  `);
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter(name => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  return db;
}
export async function asAccount<T>(db: PGlite, ownerId: string, operation: (tx: Transaction) => Promise<T>) {
  return db.transaction(async tx => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [ownerId]);
    return operation(tx);
  });
}
export async function rpc<T>(db: PGlite, ownerId: string, name: string, args: Record<string, unknown> = {}) {
  const signatures: Record<string, [string, string][]> = {
    get_recipes: [], get_preparation: [], get_shopping_list: [],
    save_recipe: [["p_id","uuid"],["p_title","text"],["p_servings","integer"],["p_steps","text[]"],["p_ingredients","jsonb"],["p_photo_path","text"]],
    delete_recipe: [["p_id","uuid"]], save_selection: [["p_id","uuid"],["p_recipe_id","uuid"],["p_servings","integer"]],
    delete_selection: [["p_id","uuid"]], replace_shopping_list: [["p_revision","bigint"],["p_expected_list_id","uuid"],["p_items","jsonb"]],
    set_shopping_item_checked: [["p_id","uuid"],["p_list_id","uuid"],["p_checked","boolean"]],
  };
  const signature = signatures[name]; if (!signature) throw new Error("Unknown RPC");
  return asAccount(db, ownerId, async tx => {
    const result = await tx.query<{ data: T }>(`select public.${name}(${signature.map(([, cast], index) => `$${index+1}::${cast}`).join(",")}) as data`, signature.map(([key, cast]) => cast === "jsonb" ? JSON.stringify(args[key]) : args[key] ?? null));
    return result.rows[0].data;
  });
}
