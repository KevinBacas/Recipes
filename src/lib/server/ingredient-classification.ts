import "server-only";

import { experimental_decide } from "ai";
import { createGateway } from "@ai-sdk/gateway";
import { z } from "zod";
import { AISLES, type Aisle } from "../domain";

const aisleSchema = z.enum(AISLES.map((aisle) => aisle.id) as [Aisle, ...Aisle[]]);

const aisleDescriptions = {
  produce: "Fruits et légumes frais, herbes fraîches",
  meat: "Viandes et charcuteries",
  fish: "Poissons et fruits de mer",
  dairy: "Produits laitiers et œufs",
  bakery: "Pain et produits de boulangerie",
  pantry: "Épicerie salée, conserves, féculents, huiles et condiments",
  sweet: "Épicerie sucrée, pâtisserie et confiseries",
  frozen: "Produits vendus surgelés",
  drinks: "Boissons",
  other: "Tout produit qui ne correspond pas clairement aux autres rayons",
} satisfies Record<Aisle, string>;

export async function classifyIngredientAisle(name: string): Promise<Aisle | null> {
  const apiKey = process.env.AI_GATEWAY_API_KEY;
  if (!apiKey) return null;

  try {
    const gateway = createGateway({ apiKey });
    const result = await experimental_decide({
      model: gateway.decisionModel("openai/gpt-6-luna-decisions"),
      state: name,
      questions: {
        aisle: {
          type: "choice",
          instructions:
            "Dans un supermarché français, quel rayon convient le mieux à cet ingrédient ? Classe le produit selon son rayon habituel, pas selon une recette ou une marque. Choisis Autres uniquement si aucun autre rayon ne convient.",
          criteria: aisleDescriptions,
        },
      },
      maxRetries: 0,
      abortSignal: AbortSignal.timeout(5_000),
    });

    const answer = aisleSchema.safeParse(result.answers.aisle.choice);
    return answer.success ? answer.data : null;
  } catch {
    // Provider errors may contain private request data; never log their details.
    console.error("[recipes] Classement d’ingrédient indisponible");
    return null;
  }
}
