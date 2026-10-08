"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  useTransition,
} from "react";
import { CalendarPlus, Check, Plus, ShoppingBasket, Trash2, Users, CookingPot } from "lucide-react";
import { saveSelection, deleteSelection, generateList } from "@/app/actions";
import type { ActionResult, RecipeSummary, Selection } from "@/lib/domain";
import { PortionAutosave } from "@/lib/portion-autosave";
import { ConfirmDialog, EmptyState, ErrorMessage, Spinner } from "./ui";

type RegisterAutosave = (id: string, autosave: PortionAutosave) => () => void;
type TrackOperation = <T>(operation: () => Promise<T>) => Promise<T>;

function SelectedDish({
  selection,
  register,
  trackOperation,
  disabled,
}: {
  selection: Selection;
  register: RegisterAutosave;
  trackOperation: TrackOperation;
  disabled: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const [autosave] = useState(
    () =>
      new PortionAutosave(selection.servings, (servings) =>
        saveSelection({ recipeId: selection.recipe.id, servings }, selection.id),
      ),
  );
  const draft = useSyncExternalStore(
    autosave.subscribe,
    autosave.getSnapshot,
    autosave.getSnapshot,
  );
  useEffect(() => {
    autosave.reconcile(selection.servings);
  }, [autosave, selection.servings]);
  useEffect(() => {
    const unregister = register(selection.id, autosave);
    return () => {
      unregister();
      autosave.leave();
    };
  }, [autosave, register, selection.id]);
  const run = (operation: () => ReturnType<typeof saveSelection>) => {
    setError("");
    startTransition(async () => {
      try {
        const result = await trackOperation(operation);
        if (!result.ok) setError(result.error);
      } catch {
        setError("Le plat n’a pas pu être enregistré. Réessayez.");
      }
    });
  };
  return (
    <div className="selected-dish">
      <div className="selected-dish-main">
        <span className="dish-icon">
          <CookingPot size={22} />
        </span>
        <div>
          <Link href={`/recettes/${selection.recipe.id}`}>{selection.recipe.title}</Link>
          <span>{selection.recipe.ingredients.length} ingrédients</span>
        </div>
        <button
          type="button"
          className="icon-button"
          aria-label={`Retirer ${selection.recipe.title}`}
          disabled={pending || disabled || draft.status === "saving"}
          onClick={() => {
            autosave.discard();
            run(() => deleteSelection(selection.id));
          }}
        >
          <Trash2 size={18} />
        </button>
      </div>
      <div className="selection-portions">
        <label>
          <Users size={16} />
          <span>Pour</span>
          <input
            name="servings"
            type="number"
            min="1"
            max="1000"
            step="1"
            inputMode="numeric"
            value={draft.value}
            required
            disabled={pending || disabled}
            aria-invalid={draft.status === "invalid"}
            aria-label={`Portions pour ${selection.recipe.title}`}
            onChange={(event) => autosave.setValue(event.target.value)}
            onBlur={() => {
              void autosave.flush();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void autosave.flush();
              }
            }}
          />
          <span>personnes</span>
        </label>
        <span className="portion-status" role="status" aria-live="polite">
          {draft.status === "saved" ? (
            <>
              <Check size={14} /> Enregistré
            </>
          ) : draft.status === "waiting" || draft.status === "saving" ? (
            <>
              <Spinner /> Enregistrement…
            </>
          ) : (
            ""
          )}
        </span>
      </div>
      {draft.error && (
        <ErrorMessage>
          {draft.error}
          {draft.status === "error" && (
            <button
              type="button"
              className="text-button"
              aria-label={`Réessayer l’enregistrement des portions pour ${selection.recipe.title}`}
              onClick={() => {
                void autosave.flush();
              }}
            >
              Réessayer
            </button>
          )}
        </ErrorMessage>
      )}
      {error && <ErrorMessage>{error}</ErrorMessage>}
    </div>
  );
}
export function PreparationView({
  recipes,
  selections,
  activeListId,
}: {
  recipes: RecipeSummary[];
  selections: Selection[];
  activeListId: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState("");
  const autosaves = useRef(new Map<string, PortionAutosave>());
  const operations = useRef(new Set<Promise<unknown>>());
  const [pendingOperations, setPendingOperations] = useState(0);
  const trackOperation = useCallback<TrackOperation>(async (operation) => {
    const request = operation();
    operations.current.add(request);
    setPendingOperations(operations.current.size);
    try {
      return await request;
    } finally {
      operations.current.delete(request);
      setPendingOperations(operations.current.size);
    }
  }, []);
  const register = useCallback<RegisterAutosave>((id, autosave) => {
    autosaves.current.set(id, autosave);
    return () => {
      autosaves.current.delete(id);
    };
  }, []);
  const generate = async (): Promise<ActionResult> => {
    await Promise.all([...operations.current]);
    const saved = await Promise.all(
      [...autosaves.current.values()].map((autosave) => autosave.flush()),
    );
    if (saved.some((success) => !success))
      return {
        ok: false,
        error: "Vérifiez les portions de chaque plat avant de générer les courses.",
      };
    return generateList(activeListId);
  };
  return (
    <>
      <div className="page-header">
        <div>
          <p className="eyebrow">LES PROCHAINS PETITS PLATS</p>
          <h1>
            On mange quoi<span className="heading-dot"> ?</span>
          </h1>
          <p>Choisissez les plats, ajustez les portions, et les courses suivent.</p>
        </div>
        <span className="pill">
          <Users size={15} /> À deux, ou plus
        </span>
      </div>
      {!recipes.length ? (
        <EmptyState
          icon={CalendarPlus}
          title="Commençons par une recette."
          action={
            <Link href="/recettes/nouvelle" className="button button-primary">
              <Plus size={18} /> Ajouter une recette
            </Link>
          }
        >
          Vos plats apparaîtront ici pour préparer les prochaines courses.
        </EmptyState>
      ) : (
        <div className="preparation-grid">
          <section>
            <div className="section-title">
              <h2>À mettre au menu</h2>
              <span>{recipes.length} recettes</span>
            </div>
            <div className="recipe-picker">
              {recipes.map((recipe) => (
                <div className="picker-recipe" key={recipe.id}>
                  <span className="dish-icon">
                    <CookingPot size={23} />
                  </span>
                  <div>
                    <Link href={`/recettes/${recipe.id}`}>{recipe.title}</Link>
                    <p>{recipe.ingredient_count} ingrédients</p>
                  </div>
                  <button
                    type="button"
                    className="button button-secondary small"
                    disabled={pending || pendingOperations > 0}
                    aria-label={`Ajouter ${recipe.title} aux plats`}
                    onClick={() => {
                      setError("");
                      startTransition(async () => {
                        try {
                          const result = await trackOperation(() =>
                            saveSelection({ recipeId: recipe.id, servings: 2 }),
                          );
                          if (!result.ok) setError(result.error);
                        } catch {
                          setError("Le plat n’a pas pu être ajouté. Réessayez.");
                        }
                      });
                    }}
                  >
                    <Plus size={17} />
                    <span>Ajouter</span>
                  </button>
                </div>
              ))}
            </div>
            {error && <ErrorMessage>{error}</ErrorMessage>}
          </section>
          <section className="menu-panel">
            <div className="menu-panel-header">
              <span className="pill orange">
                <CalendarPlus size={14} /> Notre sélection
              </span>
              <h2>
                {selections.length
                  ? `${selections.length} plat${selections.length > 1 ? "s" : ""} à préparer`
                  : "Le menu se prépare"}
              </h2>
              <p>Les portions sont enregistrées automatiquement.</p>
            </div>
            <div className="selected-dishes">
              {selections.length ? (
                selections.map((selection) => (
                  <SelectedDish
                    key={selection.id}
                    selection={selection}
                    register={register}
                    trackOperation={trackOperation}
                    disabled={pending || pendingOperations > 0}
                  />
                ))
              ) : (
                <div className="selection-empty">
                  <CookingPot size={30} strokeWidth={1.5} />
                  <p>
                    Ajoutez quelques recettes
                    <br />
                    pour préparer les courses.
                  </p>
                </div>
              )}
            </div>
            <div className="menu-panel-footer">
              {activeListId ? (
                <ConfirmDialog
                  disabled={pending || pendingOperations > 0 || !selections.length}
                  trigger={
                    <>
                      <ShoppingBasket size={18} /> Générer les courses
                    </>
                  }
                  title="Remplacer la liste de courses ?"
                  confirmLabel="Générer la nouvelle liste"
                  onConfirm={generate}
                  onSuccess={() => router.push("/courses")}
                >
                  La liste actuelle et ses cases cochées seront remplacées par les ingrédients de
                  cette sélection.
                </ConfirmDialog>
              ) : (
                <button
                  type="button"
                  className="button button-primary full-width"
                  disabled={!selections.length || pending || pendingOperations > 0}
                  onClick={() => {
                    setError("");
                    startTransition(async () => {
                      try {
                        const result = await generate();
                        if (!result.ok) setError(result.error);
                        else router.push("/courses");
                      } catch {
                        setError("La liste n’a pas pu être générée. Réessayez.");
                      }
                    });
                  }}
                >
                  {pending ? <Spinner /> : <ShoppingBasket size={18} />}Générer les courses
                </button>
              )}
              <p>Les ingrédients communs sont additionnés automatiquement.</p>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
