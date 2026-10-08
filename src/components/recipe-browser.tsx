"use client";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { BookOpen, Plus, Search, Users, CookingPot } from "lucide-react";
import type { Recipe } from "@/lib/domain";
import { EmptyState } from "./ui";

export function RecipeBrowser({ recipes }: { recipes: Recipe[] }) {
  const [query, setQuery] = useState("");
  const visible = recipes.filter((recipe) =>
    recipe.title.toLocaleLowerCase("fr").includes(query.toLocaleLowerCase("fr")),
  );
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">NOTRE CARNET DE CUISINE</p>
          <h1>
            Nos recettes<span className="heading-dot">.</span>
          </h1>
          <p>
            {recipes.length
              ? `${recipes.length} recette${recipes.length > 1 ? "s" : ""} à retrouver et à refaire.`
              : "Les bonnes idées commencent ici."}
          </p>
        </div>
        <Link href="/recettes/nouvelle" className="button button-primary">
          <Plus size={19} /> Nouvelle recette
        </Link>
      </div>
      {recipes.length > 0 && (
        <div className="collection-toolbar">
          <label className="search-field">
            <Search size={18} />
            <input
              type="search"
              aria-label="Rechercher une recette"
              placeholder="Retrouver une recette…"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <span className="collection-count">
            {visible.length} recette{visible.length !== 1 ? "s" : ""}
          </span>
        </div>
      )}
      {!recipes.length ? (
        <EmptyState
          icon={BookOpen}
          title="Notre carnet est encore tout neuf."
          action={
            <Link href="/recettes/nouvelle" className="button button-primary">
              <Plus size={18} /> Ajouter notre première recette
            </Link>
          }
        >
          Une recette de famille, un plat du dimanche ou votre dîner préféré : gardez-les ici.
        </EmptyState>
      ) : !visible.length ? (
        <EmptyState icon={Search} title="Aucune recette trouvée.">
          Essayez un autre nom pour retrouver votre plat.
        </EmptyState>
      ) : (
        <div className="recipe-grid">
          {visible.map((recipe, index) => (
            <Link key={recipe.id} className="recipe-card" href={`/recettes/${recipe.id}`}>
              <div className={`recipe-cover cover-${index % 4}`}>
                {recipe.photo_url ? (
                  <Image
                    unoptimized
                    src={recipe.photo_url}
                    alt={recipe.title}
                    fill
                    sizes="(max-width: 600px) 100vw, (max-width: 1100px) 50vw, 33vw"
                  />
                ) : (
                  <div className="recipe-placeholder">
                    <CookingPot size={45} strokeWidth={1.3} />
                    <span>Fait maison</span>
                  </div>
                )}
                <span className="portion-badge">
                  <Users size={13} />
                  {recipe.servings} pers.
                </span>
              </div>
              <div className="recipe-card-body">
                <h2>{recipe.title}</h2>
                <p>
                  {recipe.ingredients
                    .slice(0, 3)
                    .map((i) => i.name)
                    .join(" · ")}
                  {recipe.ingredients.length > 3 && "…"}
                </p>
                <div className="recipe-card-footer">
                  <span>
                    {recipe.ingredients.length} ingrédient
                    {recipe.ingredients.length !== 1 ? "s" : ""}
                  </span>
                  <BookOpen size={16} />
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
