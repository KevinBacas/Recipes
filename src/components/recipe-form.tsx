"use client";
import { useEffect, useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { ImagePlus, Plus, Save, Trash2, X } from "lucide-react";
import { AISLES, UNITS, type Aisle, type Ingredient, type Recipe, type Unit } from "@/lib/domain";
import { saveRecipe } from "@/app/actions";
import { ErrorMessage, Spinner } from "./ui";

type Line = { key: string; ingredient_id?: string; name: string; aisle: Aisle; quantity: string; unit: Unit };
const blankLine = (key: string): Line => ({ key, name: "", aisle: "other", quantity: "", unit: "g" });
const normalize = (value: string) => value.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
export function RecipeForm({ recipe, catalog }: { recipe?: Recipe; catalog: Ingredient[] }) {
  const router = useRouter(); const formId = useId();
  const [title, setTitle] = useState(recipe?.title ?? "");
  const [servings, setServings] = useState(String(recipe?.servings ?? 2));
  const [lines, setLines] = useState<Line[]>(recipe?.ingredients.map((line, i) => ({ ...line, quantity: line.quantity === null ? "" : String(line.quantity).replace(".", ","), key: `line-${i}` })) ?? [blankLine("line-0")]);
  const [steps, setSteps] = useState(recipe?.steps.length ? recipe.steps : [""]);
  const [photo, setPhoto] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [error, setError] = useState(""); const [pending, startTransition] = useTransition();
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const updateLine = (key: string, patch: Partial<Line>) => setLines(previous => previous.map(line => line.key === key ? { ...line, ...patch } : line));
  const image = preview ?? (!removePhoto ? recipe?.photo_url : null);
  return <form className="recipe-form" onSubmit={event => {
    event.preventDefault(); setError("");
    const form = new FormData();
    form.set("recipe", JSON.stringify({ id: recipe?.id, title, servings, steps: steps.filter(step => step.trim()), ingredients: lines.map(line => ({ ingredient_id: line.ingredient_id, name: line.name, aisle: line.aisle, quantity: line.quantity, unit: line.unit })) }));
    form.set("removePhoto", String(removePhoto)); if (photo) form.set("photo", photo);
    startTransition(async () => { try { const result = await saveRecipe(form); if (!result.ok) { setError(result.error); return; } router.push(`/recettes/${result.data.id}`); router.refresh(); } catch { setError("La recette n’a pas pu être enregistrée. Vérifiez votre connexion et réessayez."); } });
  }}>
    <fieldset disabled={pending} className="form-fields"><section className="form-section"><div className="section-heading"><span className="section-number">01</span><div><h2>Le plat</h2><p>Un nom et le nombre de personnes de la recette d’origine.</p></div></div><div className="basics-grid"><div><label className="field">Nom de la recette<input required maxLength={120} value={title} onChange={event => setTitle(event.target.value)} placeholder="Ex. : Lasagnes du dimanche"/></label><label className="field portions-field">Recette pour<div className="input-suffix"><input required type="number" min="1" max="1000" step="1" inputMode="numeric" value={servings} onChange={event => setServings(event.target.value)}/><span>personnes</span></div></label></div><div className="photo-field">
      <label className="photo-upload">{image ? <Image unoptimized src={image} alt="Photo de la recette" fill sizes="240px"/> : <><ImagePlus size={28}/><strong>Ajouter une photo</strong><span>Facultative · JPG, PNG, WebP · 5 Mo max.</span></>}<input type="file" accept="image/jpeg,image/png,image/webp" aria-label="Photo de la recette" onChange={event => { const file = event.target.files?.[0]; if (!file) return; if (file.size > 5 * 1024 * 1024) { setError("La photo doit faire moins de 5 Mo."); event.target.value = ""; return; } setPhoto(file); setPreview(URL.createObjectURL(file)); setRemovePhoto(false); }}/></label>{image && <button type="button" className="text-button remove-photo" onClick={() => { setPhoto(null); setPreview(null); setRemovePhoto(true); }}><X size={14}/> Retirer la photo</button>}</div></div></section>
    <section className="form-section"><div className="section-heading"><span className="section-number">02</span><div><h2>Les ingrédients</h2><p>Choisissez un ingrédient du carnet ou saisissez un nouveau nom.</p></div></div><datalist id={`${formId}-catalog`}>{catalog.map(item => <option key={item.id} value={item.name}/>)}</datalist>
      <div className="ingredient-lines">{lines.map((line, index) => <div className="ingredient-line" key={line.key}><label className="field ingredient-name">Ingrédient {index + 1}<input list={`${formId}-catalog`} value={line.name} required maxLength={100} placeholder="Ex. : Tomates" onChange={event => { const value = event.target.value; const known = catalog.find(item => normalize(item.name) === normalize(value)); updateLine(line.key, { name: value, ingredient_id: known?.id, aisle: known?.aisle ?? line.aisle }); }}/></label>
        <label className="field ingredient-quantity">Quantité<input inputMode="decimal" value={line.quantity} disabled={line.unit === "to_taste"} required={line.unit !== "to_taste"} placeholder={line.unit === "to_taste" ? "—" : "Ex. : 250"} onChange={event => updateLine(line.key, { quantity: event.target.value })}/></label>
        <label className="field ingredient-unit">Unité<select value={line.unit} onChange={event => { const unit = event.target.value as Unit; updateLine(line.key, { unit, quantity: unit === "to_taste" ? "" : line.quantity }); }}>{UNITS.map(unit => <option key={unit.id} value={unit.id}>{unit.label}</option>)}</select></label>
        <label className="field ingredient-aisle">Rayon<select value={line.aisle} onChange={event => updateLine(line.key, { aisle: event.target.value as Aisle })}>{AISLES.map(aisle => <option key={aisle.id} value={aisle.id}>{aisle.name}</option>)}</select></label>
        <button type="button" className="icon-button ingredient-remove" aria-label={`Retirer l’ingrédient ${index + 1}`} disabled={lines.length === 1} onClick={() => setLines(previous => previous.filter(item => item.key !== line.key))}><Trash2 size={18}/></button>
      </div>)}</div><button type="button" className="button button-secondary" onClick={() => setLines(previous => [...previous, blankLine(crypto.randomUUID())])}><Plus size={17}/> Ajouter un ingrédient</button><p className="field-hint">Le rayon d’un ingrédient est commun à toutes les recettes qui l’utilisent.</p>
    </section>
    <section className="form-section"><div className="section-heading"><span className="section-number">03</span><div><h2>La préparation</h2><p>Les étapes, dans l’ordre. Vous pourrez aussi les compléter plus tard.</p></div></div><div className="step-lines">{steps.map((step, index) => <div className="step-line" key={index}><span className="step-number">{index + 1}</span><label className="field"><span className="sr-only">Étape {index + 1}</span><textarea maxLength={4000} rows={3} value={step} placeholder={index === 0 ? "Ex. : Préchauffer le four à 180 °C…" : "Et ensuite…"} onChange={event => setSteps(previous => previous.map((value, i) => i === index ? event.target.value : value))}/></label><button type="button" className="icon-button" aria-label={`Retirer l’étape ${index + 1}`} onClick={() => setSteps(previous => previous.filter((_, i) => i !== index))}><Trash2 size={18}/></button></div>)}</div><button type="button" className="button button-secondary" onClick={() => setSteps(previous => [...previous, ""])}><Plus size={17}/> Ajouter une étape</button></section></fieldset>
    {error && <ErrorMessage>{error}</ErrorMessage>}<div className="form-footer"><Link href={recipe ? `/recettes/${recipe.id}` : "/recettes"} className="button button-secondary">Annuler</Link><button type="submit" className="button button-primary" disabled={pending}>{pending ? <Spinner/> : <Save size={18}/>}Enregistrer la recette</button></div>
  </form>;
}
