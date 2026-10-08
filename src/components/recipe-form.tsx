"use client";

import { useCallback, useEffect, useId, useRef, useState, useTransition } from "react";
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
import {
  IngredientClassificationController,
  type IngredientClassificationStatus,
} from "@/lib/ingredient-classification-client";
import { normalizeIngredientName } from "@/lib/domain";

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
  const [classificationPending, setClassificationPending] = useState(false);
  const [classificationStatuses, setClassificationStatuses] = useState<
    Record<string, IngredientClassificationStatus | undefined>
  >({});
  const [pending, startTransition] = useTransition();
  const submittingRef = useRef(false);
  const mountedRef = useRef(true);
  const draftRef = useRef({ title, servings, steps, lines });
  const classificationRef = useRef<IngredientClassificationController | null>(null);

  useEffect(() => {
    const controller = new IngredientClassificationController({
      onSuggestion: (key, name, aisle) => {
        const current = draftRef.current.lines.find((line) => line.key === key);
        if (!current || current.ingredient_id || normalizeIngredientName(current.name) !== name)
          return;
        const nextLines = draftRef.current.lines.map((line) =>
          line.key === key ? { ...line, aisle } : line,
        );
        draftRef.current = { ...draftRef.current, lines: nextLines };
        setLines(nextLines);
      },
      onStatus: (key, status) => {
        setClassificationStatuses((current) => {
          const next = { ...current };
          if (status) next[key] = status;
          else delete next[key];
          return next;
        });
      },
    });
    classificationRef.current = controller;
    controller.activate();
    controller.replaceLines(draftRef.current.lines);
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      controller.dispose();
      if (classificationRef.current === controller) classificationRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );

  const loadRecipe = useCallback((source: Recipe | undefined) => {
    const nextLines = initialLines(source);
    const nextTitle = source?.title ?? "";
    const nextServings = String(source?.servings ?? 2);
    const nextSteps = source?.steps.length ? source.steps : [""];
    draftRef.current = {
      title: nextTitle,
      servings: nextServings,
      steps: nextSteps,
      lines: nextLines,
    };
    setTitle(source?.title ?? "");
    setServings(String(source?.servings ?? 2));
    setLines(nextLines);
    setSteps(nextSteps);
    classificationRef.current?.replaceLines(nextLines);
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
    const nextLines = draftRef.current.lines.map((line) =>
      line.key === key ? { ...line, ...patch } : line,
    );
    draftRef.current = { ...draftRef.current, lines: nextLines };
    setLines(nextLines);
    const line = nextLines.find((item) => item.key === key);
    if (line)
      classificationRef.current?.updateLine(
        key,
        line.name,
        line.ingredient_id ? line.aisle : undefined,
      );
  };

  const updateTitle = (value: string) => {
    markDirty();
    draftRef.current = { ...draftRef.current, title: value };
    setTitle(value);
  };

  const updateServings = (value: string) => {
    markDirty();
    draftRef.current = { ...draftRef.current, servings: value };
    setServings(value);
  };

  const updateStep = (index: number, value: string) => {
    markDirty();
    const nextSteps = draftRef.current.steps.map((step, currentIndex) =>
      currentIndex === index ? value : step,
    );
    draftRef.current = { ...draftRef.current, steps: nextSteps };
    setSteps(nextSteps);
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
        if (submittingRef.current) return;
        submittingRef.current = true;
        setError("");
        setClassificationPending(true);
        void (async () => {
          try {
            await classificationRef.current?.prepareSubmit(draftRef.current.lines);
            if (!mountedRef.current) return;
            const draft = draftRef.current;
            const form = new FormData();
            form.set(
              "recipe",
              serializeRecipeDraft(draft, {
                id: recipe?.id,
                revision: draftRevision,
                creationId,
              }),
            );
            form.set("removePhoto", String(removePhoto));
            if (photo) form.set("photo", photo);

            setClassificationPending(false);
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
              } finally {
                submittingRef.current = false;
              }
            });
          } catch {
            // Classification is best effort; the recipe can still be saved with its current aisles.
            if (mountedRef.current) {
              setClassificationPending(false);
              submittingRef.current = false;
            }
          }
        })();
      }}
    >
      <fieldset disabled={pending || classificationPending} className="form-fields">
        <RecipeBasicsSection
          title={title}
          servings={servings}
          image={image}
          onTitleChange={updateTitle}
          onServingsChange={updateServings}
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
          classificationStatuses={classificationStatuses}
          onLineChange={updateLine}
          onLineRemove={(key) => {
            markDirty();
            classificationRef.current?.removeLine(key);
            const nextLines = draftRef.current.lines.filter((line) => line.key !== key);
            draftRef.current = { ...draftRef.current, lines: nextLines };
            setLines(nextLines);
          }}
          onLineAdd={() => {
            markDirty();
            const nextLines = [...draftRef.current.lines, blankLine(crypto.randomUUID())];
            draftRef.current = { ...draftRef.current, lines: nextLines };
            setLines(nextLines);
          }}
          onLineBlur={(key, name) => {
            const line = draftRef.current.lines.find((item) => item.key === key);
            if (!line) return;
            classificationRef.current?.classifyLine(
              key,
              name,
              line.ingredient_id ? line.aisle : undefined,
            );
          }}
          onAisleManualChange={(key) => classificationRef.current?.markManual(key)}
        />
        <StepsSection
          steps={steps}
          onStepChange={updateStep}
          onStepRemove={(index) => {
            markDirty();
            const nextSteps = draftRef.current.steps.filter(
              (_, currentIndex) => currentIndex !== index,
            );
            draftRef.current = { ...draftRef.current, steps: nextSteps };
            setSteps(nextSteps);
          }}
          onStepAdd={() => {
            markDirty();
            const nextSteps = [...draftRef.current.steps, ""];
            draftRef.current = { ...draftRef.current, steps: nextSteps };
            setSteps(nextSteps);
          }}
        />
      </fieldset>

      {remoteConflict && recipe && (
        <ErrorMessage>
          Cette recette a changé sur l’autre appareil. Votre saisie est conservée jusqu’à ce que
          vous choisissiez la dernière version.
          <button
            type="button"
            className="text-button"
            disabled={pending || classificationPending}
            onClick={() => loadRecipe(recipe)}
          >
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
          disabled={pending || classificationPending || remoteConflict}
        >
          {pending || classificationPending ? <Spinner /> : <Save size={18} />}
          {classificationPending ? "Classement des ingrédients…" : "Enregistrer la recette"}
        </button>
      </div>
    </form>
  );
}
