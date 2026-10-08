import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import {
  ingredientListSchema,
  preparationSchema,
  recipeListSchema,
  recipeRecordSchema,
  recipeSummaryListSchema,
  shoppingListSchema,
  type Ingredient,
  type Preparation,
  type Recipe,
  type RecipeSummary,
  type ShoppingList,
} from "./domain";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";

export const authenticatedClient = cache(async () => {
  if (!isConfigured()) redirect("/configuration");

  const client = await createClient();
  const { data, error } = await client.auth.getClaims();
  const ownerId = data?.claims?.sub;
  if (error || typeof ownerId !== "string") redirect("/connexion");

  return { client, ownerId };
});

function readContract<T>(
  value: unknown,
  schema: { parse(value: unknown): T },
  operation: string,
): T {
  try {
    return schema.parse(value);
  } catch (error) {
    if (error instanceof ZodError) {
      const issues = error.issues;
      console.error(
        `[recipes] Réponse invalide pour ${operation}`,
        issues.map(({ path, code }) => ({ path, code })),
      );
    } else {
      console.error(`[recipes] Décodage impossible pour ${operation}`);
    }
    throw new Error("Les données reçues ne correspondent pas au format attendu.");
  }
}

async function attachPhotoUrls(
  recipes: Recipe[],
  ownerId: string,
  client: Awaited<ReturnType<typeof createClient>>,
) {
  const paths = recipes.flatMap((recipe) => (recipe.photo_path ? [recipe.photo_path] : []));
  if (!paths.length) return recipes.map((recipe) => ({ ...recipe, photo_url: null }));

  const { data, error } = await client.storage.from("recipe-photos").createSignedUrls(paths, 3600);
  if (error) console.error("[recipes] Signature des photos impossible", { code: error.name });

  const urls = new Map(
    data?.flatMap((image) =>
      image.path && image.signedUrl ? [[image.path, image.signedUrl] as const] : [],
    ),
  );
  return recipes.map((recipe) => ({
    ...recipe,
    photo_url: recipe.photo_path?.startsWith(`${ownerId}/`)
      ? (urls.get(recipe.photo_path) ?? null)
      : null,
  }));
}

export async function getRecipes(): Promise<Recipe[]> {
  const { client, ownerId } = await authenticatedClient();
  const { data, error } = await client.rpc("get_recipes");
  if (error) {
    console.error("[recipes] Lecture du carnet impossible", { code: error.code });
    throw new Error("Impossible de charger vos recettes. Vérifiez la configuration Supabase.");
  }

  const recipes = readContract(data ?? [], recipeListSchema, "get_recipes");
  return attachPhotoUrls(recipes, ownerId, client);
}

export async function getRecipe(id: string): Promise<Recipe | null> {
  const { client, ownerId } = await authenticatedClient();
  const { data, error } = await client.rpc("get_recipe", { p_id: id });
  if (error) {
    console.error("[recipes] Lecture de la recette impossible", { code: error.code });
    throw new Error("Impossible de charger cette recette.");
  }
  if (data === null) return null;

  const recipe = readContract(data, recipeRecordSchema, "get_recipe");
  return (await attachPhotoUrls([recipe], ownerId, client))[0];
}

export async function getRecipeSummaries(): Promise<RecipeSummary[]> {
  const { client } = await authenticatedClient();
  const { data, error } = await client.rpc("get_recipe_summaries");
  if (error) {
    console.error("[recipes] Lecture des résumés de recettes impossible", { code: error.code });
    throw new Error("Impossible de charger les recettes disponibles.");
  }
  return readContract(data ?? [], recipeSummaryListSchema, "get_recipe_summaries");
}

export async function getCatalog(): Promise<Ingredient[]> {
  const { client } = await authenticatedClient();
  const { data, error } = await client.from("ingredients").select("id,name,aisle").order("name");
  if (error) {
    console.error("[recipes] Lecture du catalogue impossible", { code: error.code });
    throw new Error("Impossible de charger les ingrédients.");
  }
  return readContract(data ?? [], ingredientListSchema, "ingredients");
}

export async function getPreparation(): Promise<Preparation> {
  const { client } = await authenticatedClient();
  const { data, error } = await client.rpc("get_preparation");
  if (error) {
    console.error("[recipes] Lecture de la préparation impossible", { code: error.code });
    throw new Error("Impossible de charger les plats sélectionnés.");
  }
  return readContract(
    data ?? { revision: 0, selections: [] },
    preparationSchema,
    "get_preparation",
  );
}

export async function getShoppingList(): Promise<ShoppingList | null> {
  const { client } = await authenticatedClient();
  const { data, error } = await client.rpc("get_shopping_list");
  if (error) {
    console.error("[recipes] Lecture de la liste de courses impossible", { code: error.code });
    throw new Error("Impossible de charger votre liste de courses.");
  }
  return data === null ? null : readContract(data, shoppingListSchema, "get_shopping_list");
}
