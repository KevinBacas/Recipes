import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getRecipes,
  getRecipe,
  getRecipeSummaries,
  getPreparation,
  getPreparationView,
  getShoppingList,
} from "@/lib/data";
const mocks = vi.hoisted(() => ({ rpc: vi.fn(), sign: vi.fn(), claims: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getClaims: mocks.claims },
    rpc: mocks.rpc,
    storage: { from: () => ({ createSignedUrls: mocks.sign }) },
  }),
}));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: () => true }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
const ownerId = "11111111-1111-4111-8111-111111111111";
const recipe = {
  id: ownerId,
  title: "Recette privée",
  servings: 2,
  ingredients: [],
  steps: [],
  revision: 0,
  photo_path: `${ownerId}/photo.png`,
  created_at: "2026-10-08T00:00:00Z",
};
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  mocks.claims.mockResolvedValue({ data: { claims: { sub: ownerId } }, error: null });
  mocks.rpc.mockResolvedValue({ data: null, error: null });
  mocks.sign.mockResolvedValue({ data: [], error: null });
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});
describe("frontières de lecture serveur", () => {
  it.each([getRecipes, getRecipeSummaries, getPreparation, getPreparationView])(
    "rejette NULL pour une lecture obligatoire",
    async (read) => {
      await expect(read()).rejects.toThrow("format attendu");
      expect(log).toHaveBeenCalled();
    },
  );
  it("accepte une absence explicitement prévue pour une recette ou une liste", async () => {
    expect(await getRecipe(ownerId)).toBeNull();
    expect(await getShoppingList()).toBeNull();
  });
  it.each([
    { ...recipe, steps: [null] },
    { ...recipe, revision: undefined },
    { ...recipe, servings: "2" },
  ])("rejette une réponse de recette incompatible", async (value) => {
    mocks.rpc.mockResolvedValue({ data: [value], error: null });
    await expect(getRecipes()).rejects.toThrow("format attendu");
    expect(JSON.stringify(log.mock.calls)).not.toContain(recipe.title);
  });
  it("distingue une absence de photo d’une erreur Storage par fichier", async () => {
    mocks.rpc.mockResolvedValue({ data: [recipe], error: null });
    mocks.sign.mockResolvedValue({
      data: [{ path: recipe.photo_path, signedUrl: null, error: "Object not found" }],
      error: null,
    });
    expect((await getRecipes())[0].photo_url).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("certaines photos"), {
      code: "STORAGE_OBJECT_ERROR",
      count: 1,
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain(ownerId);
    log.mockClear();
    mocks.rpc.mockResolvedValue({ data: [{ ...recipe, photo_path: null }], error: null });
    await getRecipes();
    expect(log).not.toHaveBeenCalled();
  });
  it("journalise une erreur globale Storage sans contenu privé", async () => {
    mocks.rpc.mockResolvedValue({ data: [recipe], error: null });
    mocks.sign.mockResolvedValue({ data: null, error: { name: "StorageUnavailable" } });
    await getRecipes();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Signature"), {
      code: "StorageUnavailable",
    });
  });
  it("retourne une URL renouvelée pour la même révision", async () => {
    mocks.rpc.mockResolvedValue({ data: recipe, error: null });
    mocks.sign.mockResolvedValueOnce({
      data: [{ path: recipe.photo_path, signedUrl: "first", error: null }],
      error: null,
    });
    mocks.sign.mockResolvedValueOnce({
      data: [{ path: recipe.photo_path, signedUrl: "renewed", error: null }],
      error: null,
    });
    expect((await getRecipe(ownerId))?.photo_url).toBe("first");
    expect((await getRecipe(ownerId))?.photo_url).toBe("renewed");
  });
  it("journalise aussi une exception de transport pendant la signature", async () => {
    mocks.rpc.mockResolvedValue({ data: [recipe], error: null });
    mocks.sign.mockRejectedValueOnce(new TypeError("offline"));
    expect((await getRecipes())[0].photo_url).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("indisponible"), {
      code: "TypeError",
    });
  });
});
