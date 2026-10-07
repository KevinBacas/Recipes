"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authenticatedClient } from "@/lib/data";
import { aggregateShopping, recipeSchema, selectionSchema, type ActionResult, type Preparation } from "@/lib/domain";
import { isConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";

function failure(error: unknown): ActionResult<never> {
  const message = error instanceof Error ? error.message : String((error as { message?: string })?.message ?? "");
  if (message.includes("PLAN_CHANGED")) return { ok: false, error: "Les plats ont changé sur un autre appareil. Actualisez la page puis réessayez." };
  if (message.includes("LIST_CHANGED")) return { ok: false, error: "La liste a changé sur un autre appareil. Actualisez la page avant de continuer." };
  if (message.includes("NOT_FOUND")) return { ok: false, error: "Cet élément n’est plus disponible. Actualisez la page." };
  return { ok: false, error: "L’enregistrement a échoué. Vérifiez votre connexion et réessayez." };
}
function refresh() {
  revalidatePath("/recettes", "layout");
  revalidatePath("/preparer");
  revalidatePath("/courses");
}
export async function signIn(form: FormData): Promise<ActionResult> {
  if (!isConfigured()) return { ok: false, error: "Votre espace n’est pas encore configuré." };
  const parsed = z.object({ email: z.email(), password: z.string().min(1) }).safeParse({ email: form.get("email"), password: form.get("password") });
  if (!parsed.success) return { ok: false, error: "Renseignez une adresse email et votre mot de passe." };
  try {
    const client = await createClient();
    const { error } = await client.auth.signInWithPassword(parsed.data);
    if (error) return { ok: false, error: "Connexion impossible. Vérifiez votre email et votre mot de passe." };
  } catch { return { ok: false, error: "Connexion impossible pour le moment. Réessayez dans quelques instants." }; }
  redirect("/recettes");
}
export async function signOut() {
  const { client } = await authenticatedClient();
  await client.auth.signOut({ scope: "local" });
  redirect("/connexion");
}

function imageMime(bytes: Uint8Array): { mime: string; extension: string } | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", extension: "jpg" };
  if ([137,80,78,71,13,10,26,10].every((byte, index) => bytes[index] === byte)) return { mime: "image/png", extension: "png" };
  if (new TextDecoder().decode(bytes.slice(0,4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8,12)) === "WEBP") return { mime: "image/webp", extension: "webp" };
  return null;
}
export async function saveRecipe(form: FormData): Promise<ActionResult<{ id: string }>> {
  let payload: unknown;
  try { payload = JSON.parse(String(form.get("recipe"))); } catch { return { ok: false, error: "Le formulaire est incomplet." }; }
  const parsed = recipeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Vérifiez les informations de la recette." };
  const { client, ownerId } = await authenticatedClient();
  let oldPath: string | null = null;
  let uploadedPath: string | null = null;
  try {
    if (parsed.data.id) {
      const { data, error } = await client.from("recipes").select("photo_path").eq("id", parsed.data.id).eq("owner_id", ownerId).single();
      if (error) return failure(error);
      oldPath = data.photo_path;
    }
    let path = form.get("removePhoto") === "true" ? null : oldPath;
    const photo = form.get("photo");
    if (photo instanceof File && photo.size > 0) {
      if (photo.size > 5 * 1024 * 1024) return { ok: false, error: "La photo doit faire moins de 5 Mo." };
      const bytes = new Uint8Array(await photo.arrayBuffer());
      const detected = imageMime(bytes);
      if (!detected) return { ok: false, error: "Choisissez une photo JPG, PNG ou WebP." };
      uploadedPath = `${ownerId}/${crypto.randomUUID()}.${detected.extension}`;
      const { error } = await client.storage.from("recipe-photos").upload(uploadedPath, bytes, { contentType: detected.mime, upsert: false });
      if (error) throw error;
      path = uploadedPath;
    }
    const { data, error } = await client.rpc("save_recipe", {
      p_id: parsed.data.id ?? null, p_title: parsed.data.title, p_servings: parsed.data.servings,
      p_steps: parsed.data.steps, p_ingredients: parsed.data.ingredients, p_photo_path: path,
    });
    if (error) throw error;
    if (oldPath && oldPath !== path && oldPath.startsWith(`${ownerId}/`)) await client.storage.from("recipe-photos").remove([oldPath]);
    refresh();
    return { ok: true, data: { id: String(data) } };
  } catch (error) {
    if (uploadedPath) await client.storage.from("recipe-photos").remove([uploadedPath]);
    return failure(error);
  }
}
export async function deleteRecipe(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Recette introuvable." };
  const { client, ownerId } = await authenticatedClient();
  try {
    const { data } = await client.from("recipes").select("photo_path").eq("id", id).single();
    const { error } = await client.rpc("delete_recipe", { p_id: id });
    if (error) throw error;
    if (data?.photo_path?.startsWith(`${ownerId}/`)) await client.storage.from("recipe-photos").remove([data.photo_path]);
    refresh(); return { ok: true, data: undefined };
  } catch (error) { return failure(error); }
}
export async function saveSelection(input: unknown, id?: string): Promise<ActionResult> {
  const parsed = selectionSchema.safeParse(input);
  if (!parsed.success || (id && !z.uuid().safeParse(id).success)) return { ok: false, error: "Choisissez une recette et un nombre de portions valide." };
  const { client } = await authenticatedClient();
  try {
    const { error } = await client.rpc("save_selection", { p_id: id ?? null, p_recipe_id: parsed.data.recipeId, p_servings: parsed.data.servings });
    if (error) throw error;
    refresh(); return { ok: true, data: undefined };
  } catch (error) { return failure(error); }
}
export async function deleteSelection(id: string): Promise<ActionResult> {
  if (!z.uuid().safeParse(id).success) return { ok: false, error: "Plat introuvable." };
  const { client } = await authenticatedClient();
  try {
    const { error } = await client.rpc("delete_selection", { p_id: id });
    if (error) throw error;
    refresh(); return { ok: true, data: undefined };
  } catch (error) { return failure(error); }
}
export async function generateList(expectedListId: string | null): Promise<ActionResult> {
  if (expectedListId !== null && !z.uuid().safeParse(expectedListId).success) return { ok: false, error: "Liste introuvable." };
  const { client } = await authenticatedClient();
  try {
    const { data, error: readError } = await client.rpc("get_preparation");
    if (readError) throw readError;
    const preparation = data as Preparation;
    if (!preparation.selections.length) return { ok: false, error: "Ajoutez au moins un plat avant de générer les courses." };
    const items = aggregateShopping(preparation.selections);
    const { error } = await client.rpc("replace_shopping_list", { p_revision: preparation.revision, p_expected_list_id: expectedListId, p_items: items });
    if (error) throw error;
    refresh(); return { ok: true, data: undefined };
  } catch (error) { return failure(error); }
}
export async function setChecked(input: unknown): Promise<ActionResult> {
  const parsed = z.object({ id: z.uuid(), listId: z.uuid(), checked: z.boolean() }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Article introuvable." };
  const { client } = await authenticatedClient();
  try {
    const { error } = await client.rpc("set_shopping_item_checked", { p_id: parsed.data.id, p_list_id: parsed.data.listId, p_checked: parsed.data.checked });
    if (error) throw error;
    revalidatePath("/courses"); return { ok: true, data: undefined };
  } catch (error) { return failure(error); }
}
