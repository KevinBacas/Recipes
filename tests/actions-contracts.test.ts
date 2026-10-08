import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { saveRecipe, deleteRecipe } from "@/app/actions";
import { initialLines, serializeRecipeDraft } from "@/lib/recipe-draft";
import { recipeRecordSchema } from "@/lib/domain";
import { ACCOUNT, createDatabase, resetAccount, rpc } from "./helpers/database";
import { actionClient, deferred } from "./helpers/action-client";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/data", () => ({ authenticatedClient: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
let db: PGlite;
let bridge: ReturnType<typeof actionClient>;
const creationId = "33333333-3333-4333-8333-333333333333";
function form(
  options: {
    id?: string;
    revision?: number;
    photo?: boolean;
    remove?: boolean;
    title?: string;
  } = {},
) {
  const data = new FormData();
  data.set(
    "recipe",
    serializeRecipeDraft(
      {
        title: options.title ?? "Crêpes",
        servings: "4",
        steps: ["Mélanger.", " "],
        lines: [{ key: "one", name: "Farine", aisle: "pantry", quantity: "500", unit: "g" }],
      },
      { id: options.id, revision: options.revision ?? null, creationId },
    ),
  );
  data.set("removePhoto", String(options.remove ?? false));
  if (options.photo)
    data.set(
      "photo",
      new File([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])], "photo.png", {
        type: "image/png",
      }),
    );
  return data;
}
async function read(id = creationId) {
  return recipeRecordSchema.parse(await rpc(db, ACCOUNT, "get_recipe", { p_id: id }));
}
async function objects() {
  return (
    await db.query<{ name: string }>("select name from storage.objects order by name")
  ).rows.map((row) => row.name);
}
beforeAll(async () => {
  db = await createDatabase();
});
beforeEach(async () => {
  await resetAccount(db, ACCOUNT);
  bridge = actionClient(db);
  mocks.auth.mockResolvedValue({ client: bridge.client, ownerId: ACCOUNT });
  mocks.revalidate.mockReset();
});
afterAll(async () => {
  await db?.close();
});

describe("contrat formulaire → action → migrations réelles", () => {
  it("crée avec le payload exact du formulaire, sans révision d’édition", async () => {
    expect(JSON.parse(String(form().get("recipe")))).not.toHaveProperty("revision");
    expect(await saveRecipe(form())).toEqual({ ok: true, data: { id: creationId } });
    expect(await read()).toMatchObject({ servings: 4, revision: 0, steps: ["Mélanger."] });
  });
  it("conserve le fichier Storage lors d’une édition de texte", async () => {
    await saveRecipe(form({ photo: true }));
    const before = await read();
    expect(
      await saveRecipe(form({ id: creationId, revision: 0, title: "Nouveau titre" })),
    ).toMatchObject({ ok: true });
    expect((await read()).photo_path).toBe(before.photo_path);
    expect(await objects()).toEqual([before.photo_path]);
  });
  it("remplace puis retire uniquement le fichier détaché", async () => {
    await saveRecipe(form({ photo: true }));
    const original = (await read()).photo_path;
    await saveRecipe(form({ id: creationId, revision: 0, photo: true }));
    const replacement = (await read()).photo_path;
    expect(replacement).not.toBe(original);
    expect(await objects()).toEqual([replacement]);
    await saveRecipe(form({ id: creationId, revision: 1, remove: true }));
    expect((await read()).photo_path).toBeNull();
    expect(await objects()).toEqual([]);
  });
  it("réconcilie une création après perte de réponse", async () => {
    bridge.controls.loseResponse = true;
    expect(await saveRecipe(form({ photo: true }))).toEqual({ ok: true, data: { id: creationId } });
    expect(await objects()).toEqual([(await read()).photo_path]);
  });
  it("reprend la même création après indisponibilité de la réconciliation", async () => {
    bridge.controls.loseResponse = true;
    bridge.controls.failRecovery = true;
    expect(await saveRecipe(form({ photo: true }))).toMatchObject({
      ok: false,
      error: expect.stringContaining("peut-être"),
    });
    const original = (await read()).photo_path;
    bridge.controls.failRecovery = false;
    expect(await saveRecipe(form({ photo: true }))).toMatchObject({ ok: true });
    expect(await rpc(db, ACCOUNT, "get_recipes")).toHaveLength(1);
    expect(await objects()).toEqual([original]);
    expect(await saveRecipe(form({ title: "Tentative différente", photo: true }))).toMatchObject({
      ok: false,
    });
    expect((await read()).title).toBe("Crêpes");
    expect(await objects()).toEqual([original]);
  });
  it("reste un succès métier si la revalidation échoue après le commit", async () => {
    mocks.revalidate.mockImplementation(() => {
      throw new Error("cache unavailable");
    });
    expect(await saveRecipe(form({ photo: true }))).toMatchObject({ ok: true });
    expect(await objects()).toEqual([(await read()).photo_path]);
  });
  it("refuse un remplacement périmé après un retrait concurrent pendant l’upload", async () => {
    await saveRecipe(form({ photo: true }));
    const uploadStarted = deferred();
    const resume = deferred();
    bridge.controls.beforeUpload = async () => {
      uploadStarted.resolve();
      await resume.promise;
    };
    const pending = saveRecipe(form({ id: creationId, revision: 0, photo: true }));
    await uploadStarted.promise;
    bridge.controls.beforeUpload = async () => {};
    await saveRecipe(form({ id: creationId, revision: 0, remove: true }));
    resume.resolve();
    expect(await pending).toMatchObject({
      ok: false,
      error: expect.stringContaining("autre appareil"),
    });
    expect((await read()).photo_path).toBeNull();
    expect(await objects()).toEqual([]);
  });
  it("nettoie l’upload refusé si la recette est supprimée pendant son envoi", async () => {
    await saveRecipe(form());
    const uploadStarted = deferred();
    const resume = deferred();
    bridge.controls.beforeUpload = async () => {
      uploadStarted.resolve();
      await resume.promise;
    };
    const pending = saveRecipe(form({ id: creationId, revision: 0, photo: true }));
    await uploadStarted.promise;
    await deleteRecipe(creationId);
    resume.resolve();
    expect(await pending).toMatchObject({ ok: false });
    expect(await objects()).toEqual([]);
  });
  it("le brouillon conserve les unités et les quantités après lecture", async () => {
    await saveRecipe(form());
    expect(initialLines(await read())[0]).toMatchObject({
      quantity: "500",
      unit: "g",
      name: "Farine",
    });
  });
  it("une édition de texte retardée ne rétablit pas la photo remplacée", async () => {
    await saveRecipe(form({ photo: true }));
    const entered = deferred();
    const resume = deferred();
    bridge.controls.beforeRpc = async (name, args) => {
      if (name === "save_recipe" && args.p_photo_action === "keep") {
        entered.resolve();
        await resume.promise;
      }
    };
    const pending = saveRecipe(form({ id: creationId, revision: 0, title: "Texte local" }));
    await entered.promise;
    bridge.controls.beforeRpc = async () => {};
    await saveRecipe(form({ id: creationId, revision: 0, photo: true }));
    const finalPhoto = (await read()).photo_path;
    resume.resolve();
    expect(await pending).toMatchObject({ ok: false });
    expect((await read()).photo_path).toBe(finalPhoto);
    expect(await objects()).toEqual([finalPhoto]);
  });
});
