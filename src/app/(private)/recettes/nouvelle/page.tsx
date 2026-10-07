import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { RecipeForm } from "@/components/recipe-form";
import { getCatalog } from "@/lib/data";
export default async function NewRecipe() {
  return <><Link href="/recettes" className="back-link"><ArrowLeft size={17}/> Nos recettes</Link><div className="page-header"><div><p className="eyebrow">UNE NOUVELLE IDÉE</p><h1>On note la recette<span className="heading-dot">.</span></h1></div></div><RecipeForm catalog={await getCatalog()}/></>;
}
