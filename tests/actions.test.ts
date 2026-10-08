import { beforeEach, describe, expect, it, vi } from "vitest";
import { deleteRecipe, saveRecipe, signOut } from "@/app/actions";

const mocks = vi.hoisted(() => ({
  authenticatedClient: vi.fn(),
  createClient: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/data", () => ({ authenticatedClient: mocks.authenticatedClient }));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: () => true }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${path}`), {
      digest: `NEXT_REDIRECT;push;${path};307;`,
    });
  },
}));

const ownerId = "11111111-1111-4111-8111-111111111111";
const recipeId = "22222222-2222-4222-8222-222222222222";

function recipeForm(
  options: { id?: string; revision?: number; photo?: boolean; removePhoto?: boolean } = {},
) {
  const form = new FormData();
  form.set(
    "recipe",
    JSON.stringify({
      id: options.id,
      revision: options.revision,
      title: "Crêpes",
      servings: 4,
      steps: [],
      ingredients: [{ name: "Farine", aisle: "pantry", quantity: "500", unit: "g" }],
    }),
  );
  form.set("removePhoto", String(options.removePhoto ?? false));
  if (options.photo) {
    form.set(
      "photo",
      new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], "photo.png", {
        type: "image/png",
      }),
    );
  }
  return form;
}

describe("Server Actions de recettes", () => {
  const remove = vi.fn();
  const upload = vi.fn();
  const rpc = vi.fn();
  const signOutRequest = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    remove.mockResolvedValue({ data: [], error: null });
    upload.mockResolvedValue({ data: {}, error: null });
    rpc.mockResolvedValue({ data: { id: recipeId, previous_photo_path: null }, error: null });
    signOutRequest.mockResolvedValue({ error: null });

    const client = {
      auth: { signOut: signOutRequest },
      rpc,
      storage: { from: () => ({ upload, remove }) },
    };
    mocks.authenticatedClient.mockResolvedValue({ client, ownerId });
    mocks.createClient.mockResolvedValue(client);
  });

  it("ne lit plus l'ancienne photo avant la RPC et transmet l'intention de remplacement", async () => {
    rpc.mockResolvedValueOnce({
      data: { id: recipeId, previous_photo_path: `${ownerId}/ancienne.png` },
      error: null,
    });
    const result = await saveRecipe(recipeForm({ id: recipeId, revision: 3, photo: true }));

    expect(result).toEqual({ ok: true, data: { id: recipeId } });
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_id: recipeId,
      p_expected_revision: 3,
      p_photo_action: "replace",
    });
    expect(rpc.mock.calls[0][1].p_photo_path).toMatch(new RegExp(`^${ownerId}/`));
    expect(remove).toHaveBeenCalledWith([`${ownerId}/ancienne.png`]);
  });

  it("laisse la RPC garder la photo actuelle pendant une édition du texte", async () => {
    const result = await saveRecipe(recipeForm({ id: recipeId, revision: 4 }));

    expect(result.ok).toBe(true);
    expect(rpc.mock.calls[0][1]).toMatchObject({
      p_expected_revision: 4,
      p_photo_action: "keep",
      p_photo_path: null,
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("retire l'ancienne photo seulement lorsque la RPC confirme sa suppression", async () => {
    rpc.mockResolvedValueOnce({
      data: { id: recipeId, previous_photo_path: `${ownerId}/ancienne.png` },
      error: null,
    });
    const result = await saveRecipe(recipeForm({ id: recipeId, revision: 1, removePhoto: true }));

    expect(result.ok).toBe(true);
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_photo_action: "remove", p_photo_path: null });
    expect(remove).toHaveBeenCalledWith([`${ownerId}/ancienne.png`]);
  });

  it("compense un upload seulement après un refus SQL confirmé", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { code: "P0001", message: "RECIPE_CHANGED" } });
    const result = await saveRecipe(recipeForm({ id: recipeId, revision: 0, photo: true }));

    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining("modifiée sur un autre appareil"),
    });
    expect(remove).toHaveBeenCalledWith([expect.stringMatching(new RegExp(`^${ownerId}/`))]);
  });

  it("conserve l'upload lorsqu'une réponse RPC perdue ne prouve pas un rollback", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: new TypeError("fetch failed after commit") });
    const result = await saveRecipe(recipeForm({ photo: true }));

    expect(result.ok).toBe(false);
    expect(remove).not.toHaveBeenCalled();
  });

  it("retourne un succès même si le nettoyage Storage échoue après le commit", async () => {
    rpc.mockResolvedValueOnce({
      data: { id: recipeId, previous_photo_path: `${ownerId}/ancienne.png` },
      error: null,
    });
    remove.mockResolvedValueOnce({ data: null, error: { name: "StorageError" } });

    expect(await saveRecipe(recipeForm({ id: recipeId, revision: 0, photo: true }))).toEqual({
      ok: true,
      data: { id: recipeId },
    });
  });

  it("supprime une recette puis nettoie le chemin retourné par la transaction", async () => {
    rpc.mockResolvedValueOnce({ data: { photo_path: `${ownerId}/ancienne.png` }, error: null });
    expect(await deleteRecipe(recipeId)).toEqual({ ok: true, data: undefined });
    expect(remove).toHaveBeenCalledWith([`${ownerId}/ancienne.png`]);
  });

  it("affiche un échec de déconnexion au lieu de renvoyer vers la page privée", async () => {
    signOutRequest.mockResolvedValueOnce({ error: { code: "AUTH_ERROR", message: "Unavailable" } });
    expect(await signOut()).toMatchObject({
      ok: false,
      error: expect.stringContaining("Déconnexion impossible"),
    });
  });
});
