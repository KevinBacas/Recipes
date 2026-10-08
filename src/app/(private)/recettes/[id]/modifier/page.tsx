import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RecipeForm } from "@/components/recipe-form";
import { getCatalog, getRecipe } from "@/lib/data";
import { z } from "zod";
export default async function Edit({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [recipe, catalog] = await Promise.all([getRecipe(id), getCatalog()]);
  if (!recipe) notFound();
  return <><Link href={`/recettes/${id}`} className="back-link"><ArrowLeft size={17}/> {recipe.title}</Link><div className="page-header"><div><p className="eyebrow">DANS NOTRE CARNET</p><h1>Un petit ajustement<span className="heading-dot">.</span></h1></div></div><RecipeForm recipe={recipe} catalog={catalog}/></>;
}
