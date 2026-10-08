import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  configured: vi.fn(),
  createClient: vi.fn(),
  getClaims: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  maybeSingle: vi.fn(),
  classify: vi.fn(),
}));
vi.mock("@/lib/supabase/config", () => ({ isConfigured: mocks.configured }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/server/ingredient-classification", () => ({
  classifyIngredientAisle: mocks.classify,
}));

import { POST } from "@/app/api/ingredients/classify/route";

const request = (body: unknown) =>
  new Request("http://localhost/api/ingredients/classify", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });

describe("classement authentifié des ingrédients", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.configured.mockReturnValue(true);
    mocks.getClaims.mockResolvedValue({ data: { claims: { sub: "owner-1" } }, error: null });
    const query = { select: mocks.select, eq: mocks.eq, maybeSingle: mocks.maybeSingle };
    mocks.from.mockReturnValue(query);
    mocks.select.mockReturnValue(query);
    mocks.eq.mockReturnValue(query);
    mocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    mocks.createClient.mockResolvedValue({
      auth: { getClaims: mocks.getClaims },
      from: mocks.from,
    });
    mocks.classify.mockResolvedValue("produce");
  });

  it.each([{}, { name: " " }, { name: 5 }, { name: "x".repeat(101) }])(
    "rejette une entrée invalide sans appel externe : %j",
    async (body) => {
      expect((await POST(request(body))).status).toBe(400);
      expect(mocks.createClient).not.toHaveBeenCalled();
      expect(mocks.classify).not.toHaveBeenCalled();
    },
  );

  it("rejette un JSON invalide et une entrée excessive", async () => {
    for (const body of ["{", "x".repeat(2_049)]) {
      expect((await POST(new Request("http://localhost", { method: "POST", body }))).status).toBe(
        400,
      );
    }
  });

  it("refuse une session absente avant toute lecture ou requête IA", async () => {
    mocks.getClaims.mockResolvedValue({ data: null, error: null });
    const response = await POST(request({ name: "Tomates" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.classify).not.toHaveBeenCalled();
  });

  it("refuse une configuration absente", async () => {
    mocks.configured.mockReturnValue(false);
    expect((await POST(request({ name: "Tomates" }))).status).toBe(503);
    expect(mocks.createClient).not.toHaveBeenCalled();
  });

  it("préserve le catalogue privé et normalise son nom sans appeler le modèle", async () => {
    mocks.maybeSingle.mockResolvedValue({ data: { aisle: "pantry" }, error: null });
    const response = await POST(request({ name: "  Haricots   ROUGES  " }));
    expect(await response.json()).toEqual({ aisle: "pantry", source: "catalog" });
    expect(mocks.eq).toHaveBeenCalledWith("owner_id", "owner-1");
    expect(mocks.eq).toHaveBeenCalledWith("normalized_name", "haricots rouges");
    expect(mocks.classify).not.toHaveBeenCalled();
  });

  it("ne transmet que le nom validé au modèle et renvoie une réponse privée", async () => {
    const response = await POST(request({ name: "  Tomates  ", recipe: "private" }));
    expect(await response.json()).toEqual({ aisle: "produce", source: "ai" });
    expect(mocks.classify).toHaveBeenCalledExactlyOnceWith("Tomates");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("renvoie une absence de suggestion sans bloquer le formulaire", async () => {
    mocks.classify.mockResolvedValue(null);
    expect(await (await POST(request({ name: "Inconnu" }))).json()).toEqual({
      aisle: null,
      source: "unavailable",
    });
  });

  it.each([
    { data: null, error: { message: "private" } },
    { data: { aisle: "invented" }, error: null },
  ])("n’appelle pas le modèle quand la lecture échoue : %j", async (result) => {
    mocks.maybeSingle.mockResolvedValue(result);
    expect((await POST(request({ name: "Tomates" }))).status).toBe(503);
    expect(mocks.classify).not.toHaveBeenCalled();
  });
});
