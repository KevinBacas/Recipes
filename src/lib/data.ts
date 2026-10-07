import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";
import type { Ingredient, Preparation, Recipe, ShoppingList } from "./domain";

export const authenticatedClient = cache(async () => {
  if (!isConfigured()) redirect("/configuration");
  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub) redirect("/connexion");
  return { client, ownerId: data.claims.sub as string };
});

export async function getRecipes(): Promise<Recipe[]> {
  const { client, ownerId } = await authenticatedClient();
  const { data, error } = await client.rpc("get_recipes");
  if (error) throw new Error("Impossible de charger vos recettes. Vérifiez la configuration Supabase.");
  const recipes = (data ?? []) as Recipe[];
  const paths = recipes.filter(r => r.photo_path).map(r => r.photo_path!);
  const { data: images } = paths.length ? await client.storage.from("recipe-photos").createSignedUrls(paths, 3600) : { data: [] };
  const urls = new Map(images?.map(image => [image.path, image.signedUrl]) ?? []);
  return recipes.map(recipe => ({ ...recipe, photo_url: recipe.photo_path?.startsWith(`${ownerId}/`) ? urls.get(recipe.photo_path) ?? null : null }));
}
export async function getCatalog(): Promise<Ingredient[]> {
  const { client } = await authenticatedClient();
  const { data, error } = await client.from("ingredients").select("id,name,aisle").order("name");
  if (error) throw new Error("Impossible de charger les ingrédients.");
  return (data ?? []) as Ingredient[];
}
export async function getPreparation(): Promise<Preparation> {
  const { client } = await authenticatedClient();
  const { data, error } = await client.rpc("get_preparation");
  if (error) throw new Error("Impossible de charger les plats sélectionnés.");
  return (data ?? { revision: 0, selections: [] }) as Preparation;
}
export async function getShoppingList(): Promise<ShoppingList | null> {
  const { client } = await authenticatedClient();
  const { data, error } = await client.rpc("get_shopping_list");
  if (error) throw new Error("Impossible de charger votre liste de courses.");
  return data as ShoppingList | null;
}
