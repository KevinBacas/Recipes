import { RecipeBrowser } from "@/components/recipe-browser";
import { getRecipes } from "@/lib/data";
export default async function Recipes() {
  return <RecipeBrowser recipes={await getRecipes()} />;
}
