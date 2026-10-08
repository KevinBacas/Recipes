import { test, expect, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
test.skip(!email || !password, "Configurez un compte de test isolé dans .env.e2e.local.");

async function login(page: Page) {
  await page.goto("/recettes");
  await page.getByLabel("Email", { exact: true }).fill(email!);
  await page.getByLabel("Mot de passe", { exact: true }).fill(password!);
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page).toHaveURL(/\/recettes$/);
}

test("propose le rayon d'un nouveau nom, permet de le corriger et l'enregistre", async ({
  page,
}) => {
  if (!email?.startsWith("codex-e2e-") && process.env.E2E_ALLOW_DESTRUCTIVE !== "true")
    throw new Error("Utilisez un compte Supabase isolé codex-e2e- pour ce parcours.");

  const requests: Array<{ name: string }> = [];
  const ingredientName = `Fromage chèvre frais ${Date.now()}`;
  await page.route("**/api/ingredients/classify", async (route) => {
    requests.push(JSON.parse(route.request().postData() ?? "{}") as { name: string });
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ aisle: "dairy", source: "ai" }),
    });
  });

  await login(page);
  await page.getByRole("link", { name: "Nouvelle recette", exact: true }).click();
  await page.getByLabel("Nom de la recette").fill(`Classification ${Date.now()}`);
  await page.getByLabel(/Recette pour/).fill("2");
  await page.getByLabel("Ingrédient 1", { exact: true }).fill(ingredientName);
  await page.getByLabel("Quantité", { exact: true }).fill("120");
  await page.getByRole("combobox", { name: "Unité", exact: true }).selectOption("g");
  await page.getByLabel("Quantité", { exact: true }).click();
  await expect(page.locator(".ingredient-classification-status")).toContainText(
    "Rayon proposé automatiquement",
  );
  await expect(page.getByRole("combobox", { name: "Rayon", exact: true })).toHaveValue("dairy");
  expect(requests).toEqual([{ name: ingredientName }]);

  await page.getByRole("combobox", { name: "Rayon", exact: true }).selectOption("produce");
  await page.getByRole("textbox", { name: "Étape 1", exact: true }).fill("Mélanger.");
  const title = await page.getByLabel("Nom de la recette").inputValue();
  await page.getByRole("button", { name: "Enregistrer la recette", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);

  await page.getByRole("link", { name: "Modifier", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Rayon", exact: true })).toHaveValue("produce");
  await page.getByRole("link", { name: "Annuler", exact: true }).click();
  await page.getByRole("button", { name: "Supprimer la recette", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(page).toHaveURL(/\/recettes$/);
});
