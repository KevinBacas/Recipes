import { notFound } from "next/navigation";
import { z } from "zod";
import { getRecipe } from "@/lib/data";
import { RecipeDetail } from "@/components/recipe-detail";
export default async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipe = z.uuid().safeParse(id).success ? await getRecipe(id) : null;
  if (!recipe) notFound();
  return <RecipeDetail recipe={recipe}/>;
}
