import { describe, expect, it } from "vitest";
import {
  aggregateShopping,
  formatAmount,
  parseQuantity,
  recipeSchema,
  type RecipeIngredient,
  type Selection,
} from "@/lib/domain";

const ingredientId = "11111111-1111-4111-8111-111111111111";
const line = (
  quantity: number | null,
  unit: RecipeIngredient["unit"] = "g",
  id = ingredientId,
): RecipeIngredient => ({ ingredient_id: id, name: "Farine", aisle: "pantry", quantity, unit });
const dish = (ingredients: RecipeIngredient[], base = 2, servings = 2): Selection => ({
  id: crypto.randomUUID(),
  servings,
  recipe: { id: crypto.randomUUID(), title: "Recette", servings: base, ingredients },
});

describe("courses", () => {
  it("adapte les portions avant d’additionner", () => {
    const result = aggregateShopping([dish([line(300)], 4, 2), dish([line(100)], 2, 4)]);
    expect(result).toHaveLength(1);
    expect(result[0].quantity).toBe("350");
  });
  it("additionne grammes et kilogrammes", () =>
    expect(aggregateShopping([dish([line(0.5, "kg"), line(250)])])[0].quantity).toBe("750"));
  it("convertit litres, centilitres et millilitres", () =>
    expect(
      aggregateShopping([dish([line(1, "l"), line(25, "cl"), line(50, "ml")])])[0],
    ).toMatchObject({ unit: "ml", quantity: "1300" }));
  it("garde les cups, masses, volumes et cuillères séparés", () =>
    expect(
      aggregateShopping([
        dish([line(2, "cup"), line(100, "g"), line(100, "ml"), line(1, "tbsp"), line(1, "tsp")]),
      ]),
    ).toHaveLength(5));
  it("adapte et additionne les cups selon les portions produites", () => {
    const result = aggregateShopping([
      dish([line(2, "cup")], 32, 16),
      dish([line(1, "cup")], 8, 4),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ unit: "cup", quantity: "1.5" });
  });
  it("ne confond pas deux ingrédients au nom identique", () =>
    expect(
      aggregateShopping([
        dish([line(100), line(100, "g", "22222222-2222-4222-8222-222222222222")]),
      ]),
    ).toHaveLength(2));
  it("réunit les mentions au goût sans inventer de quantité", () =>
    expect(
      aggregateShopping([dish([line(null, "to_taste")]), dish([line(null, "to_taste"), line(10)])]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ quantity: null, unit: "to_taste" }),
        expect.objectContaining({ quantity: "10", unit: "g" }),
      ]),
    ));
  it("évite les erreurs d’addition décimale", () =>
    expect(aggregateShopping([dish([line(0.1), line(0.2)])])[0].quantity).toBe("0.3"));
  it("additionne les portions fractionnaires avant d’arrondir", () =>
    expect(
      aggregateShopping([dish([line(1, "piece")], 3, 1), dish([line(1, "piece")], 3, 2)])[0]
        .quantity,
    ).toBe("1"));
  it("permet de sélectionner plusieurs fois le même plat", () => {
    const selection = dish([line(100)]);
    expect(aggregateShopping([selection, selection])[0].quantity).toBe("200");
  });
  it("accepte une sélection vide", () => expect(aggregateShopping([])).toEqual([]));
  it("conserve les besoins très petits sans les ramener à zéro", () =>
    expect(
      Number(aggregateShopping([dish([line(0.000001)], 1000, 1)])[0].quantity),
    ).toBeGreaterThan(0));
});
describe("saisie et affichage", () => {
  it("accepte la virgule française", () => expect(parseQuantity(" 0,5 ")).toBe(0.5));
  it.each(["1,2,3", "1e3", "-2", "trois", "1.1234567"])(
    "refuse une quantité ambiguë : %s",
    (value) => expect(parseQuantity(value)).toBeNaN(),
  );
  it("représente une quantité absente", () => expect(parseQuantity(" ")).toBeNull());
  it("affiche une quantité lisible et son unité", () => {
    expect(formatAmount(1500, "g")).toBe("1,5 kg");
    expect(formatAmount(1000, "ml")).toBe("1 l");
    expect(formatAmount(1.5, "cup")).toBe("1,5 cup(s)");
    expect(formatAmount(null, "to_taste")).toBe("au goût");
  });
  it("ne présente pas un petit besoin comme zéro", () =>
    expect(formatAmount(0.000001, "g")).toBe("< 0,001 g"));
  const input = {
    title: "Crêpes",
    servings: 2,
    steps: [],
    ingredients: [{ name: "Farine", aisle: "pantry", quantity: "0,5", unit: "kg" }],
  };
  it("valide une recette avec une quantité française", () =>
    expect(recipeSchema.parse(input).ingredients[0].quantity).toBe(0.5));
  it("accepte une quantité de cups sans la convertir", () => {
    expect(
      recipeSchema.parse({
        ...input,
        ingredients: [{ ...input.ingredients[0], unit: "cup", quantity: "1,5" }],
      }).ingredients[0],
    ).toMatchObject({ unit: "cup", quantity: 1.5 });
  });
  it.each([null, "", 0, -1])(
    "refuse une quantité de cups absente ou non positive : %s",
    (quantity) => {
      expect(
        recipeSchema.safeParse({
          ...input,
          ingredients: [{ ...input.ingredients[0], unit: "cup", quantity }],
        }).success,
      ).toBe(false);
    },
  );
  it("exige une quantité sauf au goût", () =>
    expect(
      recipeSchema.safeParse({ ...input, ingredients: [{ ...input.ingredients[0], quantity: "" }] })
        .success,
    ).toBe(false));
  it("refuse les portions nulles et les quantités nulles chiffrées", () => {
    expect(recipeSchema.safeParse({ ...input, servings: 0 }).success).toBe(false);
    expect(
      recipeSchema.safeParse({
        ...input,
        ingredients: [{ ...input.ingredients[0], quantity: "0" }],
      }).success,
    ).toBe(false);
  });
});
