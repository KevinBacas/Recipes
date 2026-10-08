"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticatedClient } from "@/lib/data";
import {
  aggregateShopping,
  deleteRecipeResultSchema,
  preparationSchema,
  recipeSchema,
  saveRecipeResultSchema,
  selectionSchema,
  type ActionResult,
} from "@/lib/domain";
import { isConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

function errorDetails(error: unknown) {
  if (!error || typeof error !== "object") return { message: "", code: "UNKNOWN" };
  const details = error as { message?: unknown; code?: unknown; name?: unknown };
  return {
    message: typeof details.message === "string" ? details.message : "",
    code:
      typeof details.code === "string"
        ? details.code
        : typeof details.name === "string"
          ? details.name
          : "UNKNOWN",
  };
}

function databaseRejectedMutation(error: unknown) {
  return /^(P\d{4}|23\d{3})$/.test(errorDetails(error).code);
}

function failure(error: unknown, operation: string): ActionResult<never> {
  const { message, code } = errorDetails(error);
  console.error(`[recipes] Échec de ${operation}`, { code });

  if (message.includes("PLAN_CHANGED"))
    return {
      ok: false,
      error: "Les plats ont changé sur un autre appareil. Actualisez la page puis réessayez.",
    };
  if (message.includes("LIST_CHANGED"))
    return {
      ok: false,
      error: "La liste a changé sur un autre appareil. Actualisez la page avant de continuer.",
    };
  if (message.includes("RECIPE_CHANGED"))
    return {
      ok: false,
      error: "Cette recette a été modifiée sur un autre appareil. Rechargez-la avant de continuer.",
    };
  if (message.includes("NOT_FOUND"))
    return { ok: false, error: "Cet élément n’est plus disponible. Actualisez la page." };
  return { ok: false, error: "L’enregistrement a échoué. Vérifiez votre connexion et réessayez." };
}

function refresh() {
  revalidatePath("/recettes", "layout");
  revalidatePath("/preparer");
  revalidatePath("/courses");
}

function refreshAfterMutation(operation: string) {
  try {
    refresh();
  } catch {
    console.error(`[recipes] Revalidation impossible après ${operation}`);
  }
}

async function removeRecipePhoto(
  client: Awaited<ReturnType<typeof authenticatedClient>>["client"],
  path: string,
  operation: string,
) {
  try {
    const { error } = await client.storage.from("recipe-photos").remove([path]);
    if (error)
      console.error(`[recipes] Nettoyage de photo impossible après ${operation}`, {
        code: error.name,
      });
  } catch {
    console.error(`[recipes] Nettoyage de photo impossible après ${operation}`);
  }
}

export async function signIn(form: FormData): Promise<ActionResult> {
  if (!isConfigured()) return { ok: false, error: "Votre espace n’est pas encore configuré." };

  const parsed = z
    .object({ email: z.email(), password: z.string().min(1) })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success)
    return { ok: false, error: "Renseignez une adresse email et votre mot de passe." };

  try {
    const client = await createClient();
    const { error } = await client.auth.signInWithPassword(parsed.data);
    if (error)
      return {
        ok: false,
        error: "Connexion impossible. Vérifiez votre email et votre mot de passe.",
      };
  } catch {
    return {
      ok: false,
      error: "Connexion impossible pour le moment. Réessayez dans quelques instants.",
    };
  }

  redirect("/recettes");
}

export async function signOut(): Promise<ActionResult> {
  const { client } = await authenticatedClient();
  const { error } = await client.auth.signOut({ scope: "local" });
  if (error) {
    console.error("[recipes] Échec de la déconnexion", { code: errorDetails(error).code });
    return { ok: false, error: "Déconnexion impossible. Vérifiez votre connexion puis réessayez." };
  }
  redirect("/connexion");
}

function imageMime(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { mime: "image/jpeg", extension: "jpg" };
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte))
    return { mime: "image/png", extension: "png" };
  if (
    new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
    new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP"
  ) {
    return { mime: "image/webp", extension: "webp" };
  }
  return null;
}

export async function saveRecipe(form: FormData): Promise<ActionResult<{ id: string }>> {
  let payload: unknown;
  try {
    payload = JSON.parse(String(form.get("recipe")));
  } catch {
    return { ok: false, error: "Le formulaire est incomplet." };
  }

  const parsed = recipeSchema.safeParse(payload);
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Vérifiez les informations de la recette.",
    };
  if (parsed.data.id && parsed.data.revision === undefined) {
    return { ok: false, error: "Rechargez cette recette avant de l’enregistrer." };
  }

  const { client, ownerId } = await authenticatedClient();
  let uploadedPath: string | null = null;

  try {
    const photo = form.get("photo");
    if (photo instanceof File && photo.size > 0) {
      if (photo.size > 5 * 1024 * 1024)
        return { ok: false, error: "La photo doit faire moins de 5 Mo." };

      const bytes = new Uint8Array(await photo.arrayBuffer());
      const detected = imageMime(bytes);
      if (!detected) return { ok: false, error: "Choisissez une photo JPG, PNG ou WebP." };

      uploadedPath = `${ownerId}/${crypto.randomUUID()}.${detected.extension}`;
      const { error } = await client.storage.from("recipe-photos").upload(uploadedPath, bytes, {
        contentType: detected.mime,
        upsert: false,
      });
      if (error) return failure(error, "l’envoi de la photo");
    }

    const photoAction = uploadedPath
      ? "replace"
      : form.get("removePhoto") === "true"
        ? "remove"
        : "keep";
    const { data, error } = await client.rpc("save_recipe", {
      p_id: parsed.data.id ?? null,
      p_expected_revision: parsed.data.revision ?? null,
      p_title: parsed.data.title,
      p_servings: parsed.data.servings,
      p_steps: parsed.data.steps,
      p_ingredients: parsed.data.ingredients,
      p_photo_action: photoAction,
      p_photo_path: uploadedPath,
    });

    if (error) {
      if (uploadedPath && databaseRejectedMutation(error)) {
        await removeRecipePhoto(client, uploadedPath, "annulation confirmée de l’enregistrement");
      }
      // A lost response does not prove the transaction rolled back; keep the uploaded object.
      return failure(error, "l’enregistrement de la recette");
    }

    const saved = saveRecipeResultSchema.safeParse(data);
    if (!saved.success) {
      console.error("[recipes] Résultat inattendu de save_recipe");
      return {
        ok: false,
        error: "La recette a peut-être été enregistrée. Rechargez le carnet avant de réessayer.",
      };
    }

    const previousPath = saved.data.previous_photo_path;
    if (previousPath && previousPath !== uploadedPath && previousPath.startsWith(`${ownerId}/`)) {
      await removeRecipePhoto(client, previousPath, "remplacement de photo");
    }

    refreshAfterMutation("l’enregistrement de la recette");
    return { ok: true, data: { id: saved.data.id } };
  } catch (error) {
    return failure(error, "l’enregistrement de la recette");
  }
}

export async function deleteRecipe(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Recette introuvable." };

  const { client, ownerId } = await authenticatedClient();
  try {
    const { data, error } = await client.rpc("delete_recipe", { p_id: id });
    if (error) return failure(error, "la suppression de la recette");

    const deleted = deleteRecipeResultSchema.safeParse(data);
    if (!deleted.success) {
      console.error("[recipes] Résultat inattendu de delete_recipe");
      return {
        ok: false,
        error: "La recette a peut-être été supprimée. Rechargez le carnet avant de réessayer.",
      };
    }

    const photoPath = deleted.data.photo_path;
    if (photoPath?.startsWith(`${ownerId}/`))
      await removeRecipePhoto(client, photoPath, "suppression de recette");
    refreshAfterMutation("la suppression de la recette");
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "la suppression de la recette");
  }
}

export async function saveSelection(input: unknown, id?: string): Promise<ActionResult> {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success || (id && !z.uuid().safeParse(id).success)) {
    return { ok: false, error: "Choisissez une recette et un nombre de portions valide." };
  }

  const { client } = await authenticatedClient();
  try {
    const { error } = await client.rpc("save_selection", {
      p_id: id ?? null,
      p_recipe_id: parsed.data.recipeId,
      p_servings: parsed.data.servings,
    });
    if (error) return failure(error, "l’enregistrement du plat");

    refreshAfterMutation("l’enregistrement du plat");
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "l’enregistrement du plat");
  }
}

export async function deleteSelection(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Plat introuvable." };

  const { client } = await authenticatedClient();
  try {
    const { error } = await client.rpc("delete_selection", { p_id: id });
    if (error) return failure(error, "la suppression du plat");

    refreshAfterMutation("la suppression du plat");
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "la suppression du plat");
  }
}

export async function generateList(expectedListId: string | null): Promise<ActionResult> {
  if (expectedListId !== null && !z.uuid().safeParse(expectedListId).success) {
    return { ok: false, error: "Liste introuvable." };
  }

  const { client } = await authenticatedClient();
  try {
    const { data, error: readError } = await client.rpc("get_preparation");
    if (readError) return failure(readError, "la lecture des plats à préparer");

    const parsed = preparationSchema.safeParse(data);
    if (!parsed.success) {
      console.error("[recipes] Réponse inattendue de get_preparation");
      return {
        ok: false,
        error: "Les plats n’ont pas pu être vérifiés. Actualisez la page puis réessayez.",
      };
    }
    if (!parsed.data.selections.length)
      return { ok: false, error: "Ajoutez au moins un plat avant de générer les courses." };

    const items = aggregateShopping(parsed.data.selections);
    const { error } = await client.rpc("replace_shopping_list", {
      p_revision: parsed.data.revision,
      p_expected_list_id: expectedListId,
      p_items: items,
    });
    if (error) return failure(error, "la génération des courses");

    refreshAfterMutation("la génération des courses");
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "la génération des courses");
  }
}

export async function setChecked(input: unknown): Promise<ActionResult> {
  const parsed = z
    .object({ id: z.uuid(), listId: z.uuid(), checked: z.boolean() })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Article introuvable." };

  const { client } = await authenticatedClient();
  try {
    const { error } = await client.rpc("set_shopping_item_checked", {
      p_id: parsed.data.id,
      p_list_id: parsed.data.listId,
      p_checked: parsed.data.checked,
    });
    if (error) return failure(error, "la mise à jour d’un article");

    try {
      revalidatePath("/courses");
    } catch {
      console.error("[recipes] Revalidation impossible après la mise à jour d’un article");
    }
    return { ok: true, data: undefined };
  } catch (error) {
    return failure(error, "la mise à jour d’un article");
  }
}
