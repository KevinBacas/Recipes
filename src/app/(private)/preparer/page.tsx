import { getRecipes, getPreparation, getShoppingList } from "@/lib/data";
import { PreparationView } from "@/components/preparation";
export default async function Prepare() {
  const [recipes, preparation, list] = await Promise.all([getRecipes(), getPreparation(), getShoppingList()]);
  return <PreparationView recipes={recipes} selections={preparation.selections} activeListId={list?.id ?? null}/>;
}
