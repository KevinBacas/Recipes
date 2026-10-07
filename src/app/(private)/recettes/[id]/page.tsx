import { notFound } from "next/navigation";
import { getRecipes } from "@/lib/data";
import { RecipeDetail } from "@/components/recipe-detail";
export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipe = (await getRecipes()).find(recipe => recipe.id === id);
  if (!recipe) notFound();
  return <RecipeDetail recipe={recipe}/>;
}
