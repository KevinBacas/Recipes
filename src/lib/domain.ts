import { z } from "zod";
import Decimal from "decimal.js";

export const AISLES = [
  { id: "produce", name: "Fruits et légumes", icon: "🥬" },
  { id: "meat", name: "Viande", icon: "🥩" },
  { id: "fish", name: "Poisson", icon: "🐟" },
  { id: "dairy", name: "Crémerie et œufs", icon: "🥚" },
  { id: "bakery", name: "Boulangerie", icon: "🥖" },
  { id: "pantry", name: "Épicerie salée", icon: "🫙" },
  { id: "sweet", name: "Épicerie sucrée", icon: "🍫" },
  { id: "frozen", name: "Surgelés", icon: "🧊" },
  { id: "drinks", name: "Boissons", icon: "🧃" },
  { id: "other", name: "Autres", icon: "🛒" },
] as const;
export const SERVINGS_MIN = 1;
export const SERVINGS_MAX = 1000;
export const UNITS = [
  { id: "g", label: "g" },
  { id: "kg", label: "kg" },
  { id: "ml", label: "ml" },
  { id: "cl", label: "cl" },
  { id: "l", label: "l" },
  { id: "piece", label: "pièce(s)" },
  { id: "tbsp", label: "c. à soupe" },
  { id: "tsp", label: "c. à café" },
  { id: "pinch", label: "pincée(s)" },
  { id: "to_taste", label: "au goût" },
] as const;
export type Unit = (typeof UNITS)[number]["id"];
export type Aisle = (typeof AISLES)[number]["id"];
export type Ingredient = { id: string; name: string; aisle: Aisle };
export type RecipeIngredient = {
  ingredient_id: string;
  name: string;
  aisle: Aisle;
  quantity: number | null;
  unit: Unit;
};
export type Recipe = {
  id: string;
  title: string;
  servings: number;
  steps: string[];
  photo_path: string | null;
  photo_url?: string | null;
  ingredients: RecipeIngredient[];
  created_at: string;
  revision: number;
};
export type RecipeSummary = {
  id: string;
  title: string;
  servings: number;
  ingredient_count: number;
};
export type PreparedRecipe = Pick<Recipe, "id" | "title" | "servings" | "ingredients">;
export type SelectionSummary = { id: string; servings: number; recipe: RecipeSummary };
export type PreparationViewData = { selections: SelectionSummary[]; active_list_id: string | null };
export type Selection = { id: string; servings: number; recipe: PreparedRecipe };
export type Preparation = { revision: number; selections: Selection[] };
export type ShoppingItemInput = {
  ingredient_id: string;
  name: string;
  aisle: Aisle;
  quantity: string | null;
  unit: Unit;
};
export type ShoppingItem = Omit<ShoppingItemInput, "quantity"> & {
  id: string;
  list_id: string;
  quantity: number | null;
  checked: boolean;
};
export type ShoppingList = {
  id: string;
  created_at: string;
  dish_count: number;
  items: ShoppingItem[];
};
export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; error: string };

const aisleSchema = z.enum(AISLES.map((aisle) => aisle.id));
const unitSchema = z.enum(UNITS.map((unit) => unit.id));
const recipeIngredientSchema = z.object({
  ingredient_id: z.uuid(),
  name: z.string(),
  aisle: aisleSchema,
  quantity: z.number().nullable(),
  unit: unitSchema,
});
const preparedRecipeSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  servings: z.number().int().min(SERVINGS_MIN).max(SERVINGS_MAX),
  ingredients: z.array(recipeIngredientSchema),
});

export const recipeRecordSchema = preparedRecipeSchema.extend({
  steps: z.array(z.string()),
  photo_path: z.string().nullable(),
  created_at: z.string(),
  revision: z.number().int().nonnegative(),
});
export const recipeListSchema = z.array(recipeRecordSchema);
export const ingredientListSchema = z.array(
  z.object({ id: z.uuid(), name: z.string(), aisle: aisleSchema }),
);
export const preparationSchema = z.object({
  revision: z.number().int().nonnegative(),
  selections: z.array(
    z.object({
      id: z.uuid(),
      servings: z.number().int().min(SERVINGS_MIN).max(SERVINGS_MAX),
      recipe: preparedRecipeSchema,
    }),
  ),
});
export const recipeSummaryListSchema = z.array(
  z.object({
    id: z.uuid(),
    title: z.string(),
    servings: z.number().int().min(SERVINGS_MIN).max(SERVINGS_MAX),
    ingredient_count: z.number().int().nonnegative(),
  }),
);
export const preparationViewSchema = z.object({
  selections: z.array(
    z.object({
      id: z.uuid(),
      servings: z.number().int().min(SERVINGS_MIN).max(SERVINGS_MAX),
      recipe: recipeSummaryListSchema.element,
    }),
  ),
  active_list_id: z.uuid().nullable(),
});
export function parseServings(value: string): number | null {
  const number = Number(value);
  return value.trim() &&
    Number.isInteger(number) &&
    number >= SERVINGS_MIN &&
    number <= SERVINGS_MAX
    ? number
    : null;
}

export const shoppingListSchema = z.object({
  id: z.uuid(),
  created_at: z.string(),
  dish_count: z.number().int().positive(),
  items: z.array(
    z.object({
      id: z.uuid(),
      list_id: z.uuid(),
      ingredient_id: z.uuid(),
      name: z.string(),
      aisle: aisleSchema,
      quantity: z.number().nullable(),
      unit: unitSchema,
      checked: z.boolean(),
    }),
  ),
});
export const saveRecipeResultSchema = z.object({
  id: z.uuid(),
  previous_photo_path: z.string().nullable(),
  photo_path: z.string().nullable(),
});
export const deleteRecipeResultSchema = z.object({
  photo_path: z.string().nullable(),
});
export function parseQuantity(value: string): number | null {
  if (!value.trim()) return null;
  const normalized = value.trim().replace(",", ".");
  if (!/^\d+(?:\.\d{1,6})?$/.test(normalized)) return NaN;
  return Number(normalized);
}
const quantitySchema = z.preprocess(
  (value) => (typeof value === "string" ? parseQuantity(value) : value),
  z.number().positive().max(1_000_000).nullable(),
);
export const recipeSchema = z.object({
  id: z.uuid().optional(),
  revision: z.number().int().nonnegative().optional(),
  creationId: z.uuid().optional(),
  title: z.string().trim().min(1, "Donnez un nom à cette recette.").max(120),
  servings: z.coerce.number().int().min(SERVINGS_MIN).max(SERVINGS_MAX),
  steps: z.array(z.string().trim().min(1).max(4000)).max(100),
  ingredients: z
    .array(
      z
        .object({
          ingredient_id: z.uuid().optional(),
          name: z.string().trim().min(1, "Indiquez le nom de chaque ingrédient.").max(100),
          aisle: z.enum(AISLES.map((aisle) => aisle.id)),
          unit: z.enum(UNITS.map((unit) => unit.id)),
          quantity: quantitySchema,
        })
        .superRefine((item, ctx) => {
          if (item.unit !== "to_taste" && item.quantity === null)
            ctx.addIssue({
              code: "custom",
              message: "Renseignez une quantité ou choisissez « au goût ».",
              path: ["quantity"],
            });
          if (item.unit === "to_taste" && item.quantity !== null)
            ctx.addIssue({
              code: "custom",
              message: "L’unité « au goût » ne demande pas de quantité.",
              path: ["quantity"],
            });
        }),
    )
    .min(1, "Ajoutez au moins un ingrédient.")
    .max(200),
});
export const selectionSchema = z.object({
  recipeId: z.uuid(),
  servings: z.coerce.number().int().min(SERVINGS_MIN).max(SERVINGS_MAX),
});

export function normalizeIngredientName(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}

const conversion: Partial<Record<Unit, { unit: Unit; factor: number }>> = {
  kg: { unit: "g", factor: 1000 },
  g: { unit: "g", factor: 1 },
  l: { unit: "ml", factor: 1000 },
  cl: { unit: "ml", factor: 10 },
  ml: { unit: "ml", factor: 1 },
};
export function aggregateShopping(selections: Selection[]): ShoppingItemInput[] {
  const groups = new Map<string, { item: ShoppingItemInput; total: Decimal | null }>();
  for (const selection of selections) {
    const ratio = new Decimal(selection.servings).div(selection.recipe.servings);
    for (const ingredient of selection.recipe.ingredients) {
      const measure = conversion[ingredient.unit] ?? { unit: ingredient.unit, factor: 1 };
      const key = `${ingredient.ingredient_id}:${measure.unit}`;
      const amount =
        ingredient.quantity === null
          ? null
          : new Decimal(ingredient.quantity).mul(measure.factor).mul(ratio);
      const previous = groups.get(key);
      if (previous && previous.total && amount) previous.total = previous.total.plus(amount);
      else if (!previous)
        groups.set(key, {
          item: {
            ingredient_id: ingredient.ingredient_id,
            name: ingredient.name,
            aisle: ingredient.aisle,
            unit: measure.unit,
            quantity: null,
          },
          total: amount,
        });
    }
  }
  return [...groups.values()]
    .map(({ item, total }) => ({
      ...item,
      quantity: total?.toSignificantDigits(15).toFixed() ?? null,
    }))
    .sort(
      (a, b) =>
        AISLES.findIndex((aisle) => aisle.id === a.aisle) -
          AISLES.findIndex((aisle) => aisle.id === b.aisle) || a.name.localeCompare(b.name, "fr"),
    );
}
export function formatAmount(quantity: number | string | null, unit: Unit) {
  if (quantity === null || unit === "to_taste") return "au goût";
  let value = new Decimal(quantity);
  let displayUnit: Unit = unit;
  if (unit === "g" && value.greaterThanOrEqualTo(1000)) {
    value = value.div(1000);
    displayUnit = "kg";
  }
  if (unit === "ml" && value.greaterThanOrEqualTo(1000)) {
    value = value.div(1000);
    displayUnit = "l";
  }
  const rounded = value.toDecimalPlaces(3);
  return `${rounded.isZero() && !value.isZero() ? "< 0,001" : rounded.toNumber().toLocaleString("fr-FR", { maximumFractionDigits: 3 })} ${UNITS.find((u) => u.id === displayUnit)?.label ?? displayUnit}`;
}
