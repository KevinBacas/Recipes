import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";
import type { AppDatabase } from "../../src/lib/supabase/database";
import type { Recipe } from "../../src/lib/domain";

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
async function navigate(page: Page, section: "Recettes" | "Préparer" | "Courses") {
  await page.getByRole("link", { name: section, exact: true }).click();
  const paths = { Recettes: "/recettes", Préparer: "/preparer", Courses: "/courses" };
  await expect(page).toHaveURL(new RegExp(`${paths[section]}$`));
}
async function clientForCleanup() {
  const client = createClient<AppDatabase>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
  const { error } = await client.auth.signInWithPassword({ email: email!, password: password! });
  if (error) throw error;
  return client;
}
test.beforeEach(async () => {
  if (!email?.startsWith("codex-e2e-") && process.env.E2E_ALLOW_DESTRUCTIVE !== "true")
    throw new Error(
      "Use an isolated codex-e2e- test account, or explicitly opt into clearing that test account.",
    );
  const client = await clientForCleanup();
  const { data, error } = await client.rpc("get_recipes");
  if (error) throw error;
  for (const recipe of (data ?? []) as unknown as Recipe[]) {
    if (recipe.photo_path) await client.storage.from("recipe-photos").remove([recipe.photo_path]);
    const { error } = await client.rpc("delete_recipe", { p_id: recipe.id });
    if (error) throw error;
  }
});

async function createRecipe(
  page: Page,
  title: string,
  flourQuantity: string,
  flourUnit: string,
  milkQuantity: string,
  milkUnit: string,
  base: number,
  withPhoto = false,
) {
  await navigate(page, "Recettes");
  await page.getByRole("link", { name: "Nouvelle recette", exact: true }).click();
  await page.getByLabel("Nom de la recette").fill(title);
  await page.getByLabel(/Recette pour/).fill(String(base));
  await page.getByLabel("Ingrédient 1", { exact: true }).fill("Farine");
  await page.getByLabel("Quantité", { exact: true }).nth(0).fill(flourQuantity);
  await page.getByRole("combobox", { name: "Unité", exact: true }).nth(0).selectOption(flourUnit);
  await page.getByRole("combobox", { name: "Rayon", exact: true }).nth(0).selectOption("pantry");
  await page.getByRole("button", { name: "Ajouter un ingrédient", exact: true }).click();
  await page.getByLabel("Ingrédient 2", { exact: true }).fill("Lait");
  await page.getByLabel("Quantité", { exact: true }).nth(1).fill(milkQuantity);
  await page.getByRole("combobox", { name: "Unité", exact: true }).nth(1).selectOption(milkUnit);
  await page.getByRole("combobox", { name: "Rayon", exact: true }).nth(1).selectOption("dairy");
  await page.getByRole("button", { name: "Ajouter un ingrédient", exact: true }).click();
  await page.getByLabel("Ingrédient 3", { exact: true }).fill("Sel");
  await page.getByRole("combobox", { name: "Unité", exact: true }).nth(2).selectOption("to_taste");
  await page.getByRole("combobox", { name: "Rayon", exact: true }).nth(2).selectOption("pantry");
  await page
    .getByLabel("Étape 1", { exact: true })
    .fill("Mélanger les ingrédients, puis faire cuire.");
  if (withPhoto)
    await page
      .getByLabel("Photo de la recette", { exact: true })
      .setInputFiles({
        name: "test.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5r8AAAAASUVORK5CYII=",
          "base64",
        ),
      });
  await page.getByRole("button", { name: "Enregistrer la recette", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  return new URL(page.url()).pathname;
}

test("recettes → portions → courses partagées, conservation et remplacement", async ({
  page,
  browser,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  const firstRecipe = await createRecipe(page, "Crêpes maison", "500", "g", "0,5", "l", 4, true);
  await expect(page.getByAltText("Crêpes maison")).toBeVisible();
  await expect
    .poll(() =>
      page
        .getByAltText("Crêpes maison")
        .evaluate((image) => (image as HTMLImageElement).naturalWidth),
    )
    .toBeGreaterThan(0);
  await page.getByLabel("Nombre de personnes", { exact: true }).fill("2");
  await page.getByRole("button", { name: "Prévoir ce plat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Plat ajouté", exact: true })).toBeVisible();
  await createRecipe(page, "Gâteau du dimanche", "0,25", "kg", "250", "ml", 2);
  await page.getByRole("button", { name: "Prévoir ce plat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Plat ajouté", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Plat ajouté", exact: true }).click();
  await navigate(page, "Préparer");
  await expect(
    page.getByRole("heading", { name: "3 plats à préparer", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Générer les courses", exact: true }).click();
  if (await page.getByRole("dialog").isVisible())
    await page.getByRole("button", { name: "Générer la nouvelle liste", exact: true }).click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.getByRole("checkbox", { name: "Farine, 750 g", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Lait, 750 ml", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Sel, au goût", exact: true })).toBeVisible();
  await expect(page.getByText("Partagé entre vos appareils", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    ...(testInfo.project.name === "safari-mobile"
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : { viewport: { width: 1365, height: 900 } }),
  });
  const secondPage = await secondContext.newPage();
  await login(secondPage);
  await navigate(secondPage, "Courses");
  await expect(secondPage.getByText("Partagé entre vos appareils", { exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: "Farine, 750 g", exact: true }).check();
  await expect(page.getByRole("checkbox", { name: "Farine, 750 g", exact: true })).toBeChecked();
  await expect(
    secondPage.getByRole("checkbox", { name: "Farine, 750 g", exact: true }),
  ).toBeChecked();
  await secondPage.reload();
  await expect(
    secondPage.getByRole("checkbox", { name: "Farine, 750 g", exact: true }),
  ).toBeChecked();
  await page.context().setOffline(true);
  await expect(
    page.getByText("Partage en pause. Vérifiez votre connexion.", { exact: true }),
  ).toBeVisible();
  await secondPage.getByRole("checkbox", { name: "Lait, 750 ml", exact: true }).check();
  await page.context().setOffline(false);
  await expect(page.getByRole("checkbox", { name: "Lait, 750 ml", exact: true })).toBeChecked();
  await expect(page.getByText("Partagé entre vos appareils", { exact: true })).toBeVisible();
  await secondPage.getByRole("checkbox", { name: "Lait, 750 ml", exact: true }).uncheck();
  await expect(page.getByRole("checkbox", { name: "Lait, 750 ml", exact: true })).not.toBeChecked();
  await secondContext.close();

  await page.route("**/courses", (route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.continue(),
  );
  await page.getByRole("checkbox", { name: "Lait, 750 ml", exact: true }).click();
  await expect(page.locator(".shopping-row").getByRole("alert")).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Lait, 750 ml", exact: true })).not.toBeChecked();
  await page.unroute("**/courses");

  await navigate(page, "Recettes");
  await page.getByRole("link", { name: /Crêpes maison/ }).click();
  await page.getByRole("link", { name: "Modifier", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`${firstRecipe}/modifier$`));
  await page.getByLabel("Quantité", { exact: true }).nth(0).fill("1000");
  await page.getByRole("button", { name: "Enregistrer la recette", exact: true }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Crêpes maison");
  await navigate(page, "Courses");
  await expect(page.getByRole("checkbox", { name: "Farine, 750 g", exact: true })).toBeChecked();
  await expect(page.getByText("Partagé entre vos appareils", { exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("courses.png"), fullPage: true });
  await navigate(page, "Recettes");
  await page.screenshot({ path: testInfo.outputPath("recettes.png"), fullPage: true });
  await navigate(page, "Préparer");
  await page.getByRole("button", { name: "Générer les courses", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "Annuler", exact: true }).click();
  await navigate(page, "Courses");
  await expect(page.getByRole("checkbox", { name: "Farine, 750 g", exact: true })).toBeChecked();
  await navigate(page, "Préparer");
  await page.getByRole("button", { name: "Générer les courses", exact: true }).click();
  await page.getByRole("button", { name: "Générer la nouvelle liste", exact: true }).click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.getByRole("checkbox", { name: "Farine, 1 kg", exact: true })).not.toBeChecked();
  await navigate(page, "Recettes");
  await page.getByRole("link", { name: /Crêpes maison/ }).click();
  await expect(page).toHaveURL(new RegExp(`${firstRecipe}$`));
  await page.getByRole("button", { name: "Supprimer la recette", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(page).toHaveURL(/\/recettes$/);
  await navigate(page, "Courses");
  await expect(page.getByRole("checkbox", { name: "Farine, 1 kg", exact: true })).toBeVisible();
  await navigate(page, "Préparer");
  await expect(
    page.getByRole("heading", { name: "2 plats à préparer", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("portions automatiques et recettes partagées entre deux sessions", async ({
  page,
  browser,
}, testInfo) => {
  await login(page);
  const secondContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    ...(testInfo.project.name === "safari-mobile"
      ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
      : {}),
  });
  const secondPage = await secondContext.newPage();
  await login(secondPage);
  await expect(secondPage.getByText("Partagé entre vos appareils", { exact: true })).toBeVisible();
  await createRecipe(page, "Soupe partagée", "500", "g", "0,5", "l", 2);
  await expect(
    secondPage.getByRole("heading", { name: "Soupe partagée", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Prévoir ce plat", exact: true }).click();
  await expect(page.getByRole("button", { name: "Plat ajouté", exact: true })).toBeVisible();
  await navigate(page, "Préparer");
  await navigate(secondPage, "Préparer");
  await expect(
    secondPage.getByRole("heading", { name: "1 plat à préparer", exact: true }),
  ).toBeVisible();

  let releaseAdd!: () => void;
  let addStarted!: () => void;
  const pendingAdd = new Promise<void>((resolve) => {
    releaseAdd = resolve;
  });
  const addRequestStarted = new Promise<void>((resolve) => {
    addStarted = resolve;
  });
  let heldAdd = false;
  await page.route("**/preparer", async (route) => {
    if (route.request().method() === "POST" && !heldAdd) {
      heldAdd = true;
      addStarted();
      await pendingAdd;
    }
    await route.continue();
  });
  await page.getByRole("button", { name: "Ajouter Soupe partagée aux plats", exact: true }).click();
  await addRequestStarted;
  await expect(
    page.getByRole("button", { name: "Générer les courses", exact: true }),
  ).toBeDisabled();
  releaseAdd();
  await expect(
    secondPage.getByRole("heading", { name: "2 plats à préparer", exact: true }),
  ).toBeVisible();
  await page.unroute("**/preparer");
  await page.getByRole("button", { name: "Retirer Soupe partagée", exact: true }).nth(1).click();
  await expect(
    secondPage.getByRole("heading", { name: "1 plat à préparer", exact: true }),
  ).toBeVisible();

  const input = page.getByLabel("Portions pour Soupe partagée", { exact: true });
  const remoteInput = secondPage.getByLabel("Portions pour Soupe partagée", { exact: true });
  const row = page.locator(".selected-dish");
  await expect(page.getByRole("button", { name: /Appliquer les portions/ })).toHaveCount(0);
  await input.fill("4");
  await expect(remoteInput).toHaveValue("4");
  await expect(row.getByRole("status")).toHaveText("Enregistré");

  let release!: () => void;
  let started!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const requestStarted = new Promise<void>((resolve) => {
    started = resolve;
  });
  let intercepted = false;
  await page.route("**/preparer", async (route) => {
    if (route.request().method() === "POST" && !intercepted) {
      intercepted = true;
      started();
      await held;
    }
    await route.continue();
  });
  await input.fill("5");
  await requestStarted;
  await expect(input).toBeEnabled();
  await input.fill("8");
  release();
  await expect(remoteInput).toHaveValue("8");
  await expect(input).toHaveValue("8");
  await expect(row.getByRole("status")).toHaveText("Enregistré");
  await page.unroute("**/preparer");

  await input.fill("");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await expect(row.getByRole("alert")).toContainText("Indiquez un nombre entier");
  await expect(remoteInput).toHaveValue("8");
  await page.route("**/preparer", (route) =>
    route.request().method() === "POST" ? route.abort("failed") : route.continue(),
  );
  await input.fill("6");
  await expect(row.getByRole("button", { name: /Réessayer l’enregistrement/ })).toBeVisible();
  await expect(input).toHaveValue("6");
  await expect(remoteInput).toHaveValue("8");
  await page.unroute("**/preparer");
  await row.getByRole("button", { name: /Réessayer l’enregistrement/ }).click();
  await expect(remoteInput).toHaveValue("6");
  await expect(row.getByRole("status")).toHaveText("Enregistré");
  await page.screenshot({ path: testInfo.outputPath("portions-automatiques.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  await input.fill("3");
  await page.getByRole("button", { name: "Générer les courses", exact: true }).click();
  if (await page.getByRole("dialog").isVisible())
    await page.getByRole("button", { name: "Générer la nouvelle liste", exact: true }).click();
  await expect(page).toHaveURL(/\/courses$/);
  await expect(page.getByRole("checkbox", { name: "Farine, 750 g", exact: true })).toBeVisible();
  await expect(remoteInput).toHaveValue("3");

  await navigate(page, "Recettes");
  await navigate(secondPage, "Recettes");
  await expect(
    secondPage.getByRole("heading", { name: "Soupe partagée", exact: true }),
  ).toBeVisible();
  await page.getByRole("link", { name: /Soupe partagée/ }).click();
  const editUrl = `${new URL(page.url()).pathname}/modifier`;
  await page.goto(editUrl);
  await secondPage.goto(editUrl);
  const localTitle = page.getByLabel("Nom de la recette", { exact: true });
  const remoteTitle = secondPage.getByLabel("Nom de la recette", { exact: true });
  await localTitle.fill("Soupe locale");
  await remoteTitle.fill("Soupe distante");
  await secondPage.getByRole("button", { name: "Enregistrer la recette", exact: true }).click();
  await expect(
    secondPage.getByRole("heading", { name: "Soupe distante", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Cette recette a changé sur l’autre appareil",
  );
  await expect(localTitle).toHaveValue("Soupe locale");
  await page.getByRole("button", { name: "Reprendre la dernière version", exact: true }).click();
  await expect(localTitle).toHaveValue("Soupe distante");
  await navigate(page, "Recettes");
  await page.getByRole("link", { name: /Soupe distante/ }).click();
  await page.getByRole("button", { name: "Supprimer la recette", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(
    secondPage.getByRole("heading", { name: "Soupe partagée", exact: true }),
  ).toHaveCount(0);
  await expect(
    secondPage.getByText("Notre carnet est encore tout neuf.", { exact: true }),
  ).toBeVisible();
  await secondContext.close();
});
