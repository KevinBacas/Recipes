import { z } from "zod";
import { AISLES, normalizeIngredientName } from "@/lib/domain";
import {
  classificationRequestSchema,
  type IngredientClassification,
} from "@/lib/ingredient-classification";
import { classifyIngredientAisle } from "@/lib/server/ingredient-classification";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/supabase/config";

const catalogAisleSchema = z.object({ aisle: z.enum(AISLES.map((aisle) => aisle.id)) });

function respond(body: IngredientClassification | { error: string }, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    const body = await request.text();
    if (body.length > 2_048) return respond({ error: "Nom d’ingrédient invalide." }, 400);
    payload = JSON.parse(body);
  } catch {
    return respond({ error: "Nom d’ingrédient invalide." }, 400);
  }
  const parsed = classificationRequestSchema.safeParse(payload);
  if (!parsed.success) return respond({ error: "Nom d’ingrédient invalide." }, 400);
  if (!isConfigured()) return respond({ error: "Votre espace n’est pas configuré." }, 503);

  try {
    const client = await createClient();
    const { data: session, error: authError } = await client.auth.getClaims();
    const ownerId = session?.claims?.sub;
    if (authError || typeof ownerId !== "string") {
      return respond({ error: "Connectez-vous pour classer un ingrédient." }, 401);
    }

    // Preserve a shared catalog choice, including one created by the other phone.
    const { data, error } = await client
      .from("ingredients")
      .select("aisle")
      .eq("owner_id", ownerId)
      .eq("normalized_name", normalizeIngredientName(parsed.data.name))
      .maybeSingle();
    if (error) return respond({ error: "Le catalogue est indisponible." }, 503);
    if (data) {
      const known = catalogAisleSchema.safeParse(data);
      if (!known.success) return respond({ error: "Le catalogue est indisponible." }, 503);
      return respond({ aisle: known.data.aisle, source: "catalog" });
    }

    const aisle = await classifyIngredientAisle(parsed.data.name);
    return respond(aisle ? { aisle, source: "ai" } : { aisle: null, source: "unavailable" });
  } catch {
    console.error("[recipes] Service de classement indisponible");
    return respond({ error: "Le classement est indisponible pour le moment." }, 503);
  }
}
