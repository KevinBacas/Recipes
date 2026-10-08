import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  createGateway: vi.fn(),
  decisionModel: vi.fn(),
}));

vi.mock("ai", () => ({ experimental_decide: mocks.decide }));
vi.mock("@ai-sdk/gateway", () => ({ createGateway: mocks.createGateway }));

import { classifyIngredientAisle } from "@/lib/server/ingredient-classification";

const model = { id: "decision-model" };

function decision(choice: unknown) {
  return { answers: { aisle: { type: "choice", choice } } };
}

beforeEach(() => {
  vi.stubEnv("AI_GATEWAY_API_KEY", "test-secret");
  mocks.decisionModel.mockReturnValue(model);
  mocks.createGateway.mockReturnValue({ decisionModel: mocks.decisionModel });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  mocks.decide.mockReset();
  mocks.createGateway.mockReset();
  mocks.decisionModel.mockReset();
});

describe("classement serveur des ingrédients", () => {
  it("envoie uniquement le nom et une question choix aux dix rayons via le modèle configuré", async () => {
    mocks.decide.mockResolvedValue(decision("produce"));

    await expect(classifyIngredientAisle("tomate cerise")).resolves.toBe("produce");

    expect(mocks.createGateway).toHaveBeenCalledExactlyOnceWith({ apiKey: "test-secret" });
    expect(mocks.decisionModel).toHaveBeenCalledExactlyOnceWith("openai/gpt-6-luna-decisions");
    expect(mocks.decide).toHaveBeenCalledExactlyOnceWith({
      model,
      state: "tomate cerise",
      questions: {
        aisle: {
          type: "choice",
          instructions: expect.stringContaining("supermarché français"),
          criteria: {
            produce: expect.any(String),
            meat: expect.any(String),
            fish: expect.any(String),
            dairy: expect.any(String),
            bakery: expect.any(String),
            pantry: expect.any(String),
            sweet: expect.any(String),
            frozen: expect.any(String),
            drinks: expect.any(String),
            other: expect.any(String),
          },
        },
      },
      maxRetries: 0,
      abortSignal: expect.any(AbortSignal),
    });
  });

  it("renvoie null quand le choix du modèle ne fait pas partie du domaine", async () => {
    mocks.decide.mockResolvedValue(decision("rayon-inventé"));

    await expect(classifyIngredientAisle("farine")).resolves.toBeNull();
  });

  it("renvoie null si le modèle ne fournit pas de choix", async () => {
    mocks.decide.mockResolvedValue({ answers: { aisle: { type: "choice" } } });

    await expect(classifyIngredientAisle("farine")).resolves.toBeNull();
  });

  it("renvoie null sans appeler le fournisseur quand la clé est absente", async () => {
    vi.stubEnv("AI_GATEWAY_API_KEY", "");

    await expect(classifyIngredientAisle("farine")).resolves.toBeNull();

    expect(mocks.createGateway).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it("renvoie null en cas d’erreur sans exposer le nom ni le détail fournisseur dans les logs", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.decide.mockRejectedValue(
      new Error("provider response included secret and ingredient name"),
    );

    await expect(classifyIngredientAisle("nom confidentiel")).resolves.toBeNull();

    expect(log).toHaveBeenCalledExactlyOnceWith("[recipes] Classement d’ingrédient indisponible");
    expect(JSON.stringify(log.mock.calls)).not.toContain("nom confidentiel");
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret");
  });

  it("annule la demande après cinq secondes et renvoie null", async () => {
    const timeoutController = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(timeoutController.signal);
    let signal: AbortSignal | undefined;
    mocks.decide.mockImplementationOnce(({ abortSignal }: { abortSignal: AbortSignal }) => {
      signal = abortSignal;
      return new Promise((_, reject) => {
        abortSignal.addEventListener("abort", () => reject(abortSignal.reason), {
          once: true,
        });
      });
    });

    const result = classifyIngredientAisle("lentilles");
    expect(timeout).toHaveBeenCalledExactlyOnceWith(5_000);
    timeoutController.abort(new DOMException("Timed out", "TimeoutError"));

    await expect(result).resolves.toBeNull();
    expect(signal?.aborted).toBe(true);
  });
});
