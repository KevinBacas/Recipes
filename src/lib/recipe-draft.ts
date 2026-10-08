import type { Aisle, Recipe, Unit } from "./domain";

export type IngredientLine = {
  key: string;
  ingredient_id?: string;
  name: string;
  aisle: Aisle;
  quantity: string;
  unit: Unit;
};
export const blankLine = (key: string): IngredientLine => ({
  key,
  name: "",
  aisle: "other",
  quantity: "",
  unit: "g",
});
export function initialLines(recipe?: Recipe): IngredientLine[] {
  return (
    recipe?.ingredients.map((line, index) => ({
      ...line,
      quantity: line.quantity === null ? "" : String(line.quantity).replace(".", ","),
      key: `line-${index}`,
    })) ?? [blankLine("line-0")]
  );
}
export function serializeRecipeDraft(
  draft: { title: string; servings: string; steps: string[]; lines: IngredientLine[] },
  identity: { id?: string; revision: number | null; creationId: string },
) {
  return JSON.stringify({
    ...(identity.id
      ? { id: identity.id, revision: identity.revision }
      : { creationId: identity.creationId }),
    title: draft.title,
    servings: draft.servings,
    steps: draft.steps.filter((step) => step.trim()),
    ingredients: draft.lines.map(({ ingredient_id, name, aisle, quantity, unit }) => ({
      ingredient_id,
      name,
      aisle,
      quantity,
      unit,
    })),
  });
}
