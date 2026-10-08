import { z } from "zod";
import { AISLES } from "./domain";

export const classificationRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

const aisleSchema = z.enum(AISLES.map((aisle) => aisle.id));
export const classificationResponseSchema = z.discriminatedUnion("source", [
  z.object({ source: z.literal("catalog"), aisle: aisleSchema }),
  z.object({ source: z.literal("ai"), aisle: aisleSchema }),
  z.object({ source: z.literal("unavailable"), aisle: z.null() }),
]);
export type IngredientClassification = z.infer<typeof classificationResponseSchema>;
