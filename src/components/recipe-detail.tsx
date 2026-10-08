"use client";
import Link from "next/link";
import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Decimal from "decimal.js";
import { ArrowLeft, CalendarPlus, Check, CookingPot, Pencil, Trash2, Users } from "lucide-react";
import { deleteRecipe, saveSelection } from "@/app/actions";
import { formatAmount, parseServings, SERVINGS_MAX, SERVINGS_MIN, type Recipe } from "@/lib/domain";
import { ConfirmDialog, ErrorMessage, Spinner } from "./ui";

export function RecipeDetail({ recipe }: { recipe: Recipe }) {
  const router = useRouter();
  const [servings, setServings] = useState(String(recipe.servings));
  const [error, setError] = useState("");
  const [added, setAdded] = useState(false);
  const [pending, startTransition] = useTransition();
  const count = parseServings(servings);
  const valid = count !== null;
  const ratio = new Decimal(count ?? recipe.servings).div(recipe.servings);
  return (
    <>
      <Link href="/recettes" className="back-link">
        <ArrowLeft size={17} /> Nos recettes
      </Link>
      <div className="detail-heading">
        <div>
          <p className="eyebrow">DANS NOTRE CARNET</p>
          <h1>{recipe.title}</h1>
          <p>
            {recipe.ingredients.length} ingrédients · recette pour {recipe.servings} personnes
          </p>
        </div>
        <Link className="button button-secondary" href={`/recettes/${recipe.id}/modifier`}>
          <Pencil size={17} /> Modifier
        </Link>
      </div>
      {recipe.photo_url && (
        <div className="detail-photo">
          <Image
            unoptimized
            src={recipe.photo_url}
            alt={recipe.title}
            fill
            sizes="(max-width: 700px) 100vw, 1000px"
          />
        </div>
      )}
      <div className="detail-columns">
        <section className="ingredients-panel">
          <div className="panel-heading">
            <h2>Les ingrédients</h2>
            <CookingPot size={21} />
          </div>
          <label className="portion-control">
            <Users size={18} />
            <span>Pour</span>
            <input
              aria-label="Nombre de personnes"
              type="number"
              min={SERVINGS_MIN}
              max={SERVINGS_MAX}
              step="1"
              inputMode="numeric"
              value={servings}
              onChange={(event) => {
                setServings(event.target.value);
                setAdded(false);
              }}
            />
            <span>personnes</span>
          </label>
          <ul className="detail-ingredients">
            {recipe.ingredients.map((ingredient, i) => (
              <li key={i}>
                <span>{ingredient.name}</span>
                <strong>
                  {formatAmount(
                    ingredient.quantity === null
                      ? null
                      : new Decimal(ingredient.quantity).mul(ratio).toString(),
                    ingredient.unit,
                  )}
                </strong>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="button button-primary full-width"
            disabled={!valid || pending}
            onClick={() => {
              setError("");
              startTransition(async () => {
                try {
                  const result = await saveSelection({ recipeId: recipe.id, servings: count });
                  if (!result.ok) setError(result.error);
                  else setAdded(true);
                } catch {
                  setError("Le plat n’a pas pu être ajouté. Réessayez.");
                }
              });
            }}
          >
            {pending ? <Spinner /> : added ? <Check size={18} /> : <CalendarPlus size={18} />}
            {added ? "Plat ajouté" : "Prévoir ce plat"}
          </button>
          {added && (
            <Link className="text-button added-link" href="/preparer">
              Voir les plats sélectionnés
            </Link>
          )}
          {error && <ErrorMessage>{error}</ErrorMessage>}
        </section>
        <section className="steps-panel">
          <h2>En cuisine</h2>
          {recipe.steps.length ? (
            <ol className="cooking-steps">
              {recipe.steps.map((step, index) => (
                <li key={index}>
                  <span className="step-number">{index + 1}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          ) : (
            <p className="muted">
              Les étapes n’ont pas encore été ajoutées. Vous pouvez les compléter en modifiant la
              recette.
            </p>
          )}
        </section>
      </div>
      <div className="detail-danger">
        <ConfirmDialog
          destructive
          title="Supprimer cette recette ?"
          trigger={
            <>
              <Trash2 size={16} /> Supprimer la recette
            </>
          }
          confirmLabel="Supprimer"
          onConfirm={() => deleteRecipe(recipe.id)}
          onSuccess={() => {
            router.push("/recettes");
            router.refresh();
          }}
        >
          Elle sera retirée du carnet et des plats sélectionnés. Votre liste de courses déjà générée
          restera disponible.
        </ConfirmDialog>
      </div>
    </>
  );
}
