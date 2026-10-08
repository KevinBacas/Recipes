"use client";

import { useCallback, useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Save } from "lucide-react";
import { type Ingredient, type Recipe } from "@/lib/domain";
import { saveRecipe } from "@/app/actions";
import { ErrorMessage, Spinner } from "./ui";
import { IngredientSection, RecipeBasicsSection, StepsSection } from "./recipe-form-sections";

import {
  blankLine,
  initialLines,
  serializeRecipeDraft,
  type IngredientLine,
} from "@/lib/recipe-draft";

export function RecipeForm({ recipe, catalog }: { recipe?: Recipe; catalog: Ingredient[] }) {
  const router = useRouter();
  const formId = useId();
  const [creationId] = useState(() => crypto.randomUUID());
  const [title, setTitle] = useState(recipe?.title ?? "");
  const [servings, setServings] = useState(String(recipe?.servings ?? 2));
  const [lines, setLines] = useState<IngredientLine[]>(() => initialLines(recipe));
  const [steps, setSteps] = useState(recipe?.steps.length ? recipe.steps : [""]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(recipe?.photo_url ?? null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [draftRevision, setDraftRevision] = useState<number | null>(recipe?.revision ?? null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const loadRecipe = useCallback((source: Recipe | undefined) => {
    setTitle(source?.title ?? "");
    setServings(String(source?.servings ?? 2));
    setLines(initialLines(source));
    setSteps(source?.steps.length ? source.steps : [""]);
    setPhoto(null);
    setPreview(null);
    setPhotoUrl(source?.photo_url ?? null);
    setRemovePhoto(false);
    setDraftRevision(source?.revision ?? null);
    setDirty(false);
  }, []);

  useEffect(() => {
    if ((recipe?.revision ?? null) === draftRevision) return;
    // A clean draft follows router.refresh(); edited drafts stay untouched for conflict handling.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!dirty) loadRecipe(recipe);
  }, [dirty, draftRevision, loadRecipe, recipe]);
  const remoteConflict = dirty && (recipe?.revision ?? null) !== draftRevision;

  const markDirty = () => setDirty(true);
  const updateLine = (key: string, patch: Partial<IngredientLine>) => {
    markDirty();
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  };

  function choosePhoto(file: File) {
    if (file.size > 5 * 1024 * 1024) {
      setError("La photo doit faire moins de 5 Mo.");
      return;
    }
    markDirty();
    setError("");
    setPhoto(file);
    setPreview(URL.createObjectURL(file));
    setRemovePhoto(false);
  }

  const currentPhotoUrl =
    (recipe?.revision ?? null) === draftRevision ? (recipe?.photo_url ?? null) : photoUrl;
  const image = preview ?? (!removePhoto ? currentPhotoUrl : null);

  return (
    <form
      className="recipe-form"
      onSubmit={(event) => {
        event.preventDefault();
        setError("");

        const form = new FormData();
        form.set(
          "recipe",
          serializeRecipeDraft(
            { title, servings, steps, lines },
            {
              id: recipe?.id,
              revision: draftRevision,
              creationId,
            },
          ),
        );
        form.set("removePhoto", String(removePhoto));
        if (photo) form.set("photo", photo);

        startTransition(async () => {
          try {
            const result = await saveRecipe(form);
            if (!result.ok) {
              setError(result.error);
              return;
            }
            router.push(`/recettes/${result.data.id}`);
            router.refresh();
          } catch {
            setError(
              "La recette n’a pas pu être enregistrée. Vérifiez votre connexion et réessayez.",
            );
          }
        });
      }}
    >
      <fieldset disabled={pending} className="form-fields">
        <RecipeBasicsSection
          title={title}
          servings={servings}
          image={image}
          onTitleChange={(value) => {
            markDirty();
            setTitle(value);
          }}
          onServingsChange={(value) => {
            markDirty();
            setServings(value);
          }}
          onPhotoChange={choosePhoto}
          onPhotoRemove={() => {
            markDirty();
            setPhoto(null);
            setPreview(null);
            setRemovePhoto(true);
          }}
        />
        <IngredientSection
          formId={formId}
          catalog={catalog}
          lines={lines}
          onLineChange={updateLine}
          onLineRemove={(key) => {
            markDirty();
            setLines((current) => current.filter((line) => line.key !== key));
          }}
          onLineAdd={() => {
            markDirty();
            setLines((current) => [...current, blankLine(crypto.randomUUID())]);
          }}
        />
        <StepsSection
          steps={steps}
          onStepChange={(index, value) => {
            markDirty();
            setSteps((current) =>
              current.map((step, currentIndex) => (currentIndex === index ? value : step)),
            );
          }}
          onStepRemove={(index) => {
            markDirty();
            setSteps((current) => current.filter((_, currentIndex) => currentIndex !== index));
          }}
          onStepAdd={() => {
            markDirty();
            setSteps((current) => [...current, ""]);
          }}
        />
      </fieldset>

      {remoteConflict && recipe && (
        <ErrorMessage>
          Cette recette a changé sur l’autre appareil. Votre saisie est conservée jusqu’à ce que
          vous choisissiez la dernière version.
          <button type="button" className="text-button" onClick={() => loadRecipe(recipe)}>
            Reprendre la dernière version
          </button>
        </ErrorMessage>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}

      <div className="form-footer">
        <Link
          href={recipe ? `/recettes/${recipe.id}` : "/recettes"}
          className="button button-secondary"
        >
          Annuler
        </Link>
        <button
          type="submit"
          className="button button-primary"
          disabled={pending || remoteConflict}
        >
          {pending ? <Spinner /> : <Save size={18} />}Enregistrer la recette
        </button>
      </div>
    </form>
  );
}
