"use client";

import Image from "next/image";
import { ImagePlus, Plus, Trash2, X } from "lucide-react";
import {
  AISLES,
  normalizeIngredientName,
  SERVINGS_MAX,
  SERVINGS_MIN,
  UNITS,
  type Aisle,
  type Ingredient,
  type Unit,
} from "@/lib/domain";

import type { IngredientLine } from "@/lib/recipe-draft";
import type { IngredientClassificationStatus } from "@/lib/ingredient-classification-client";

export function RecipeBasicsSection({
  title,
  servings,
  image,
  onTitleChange,
  onServingsChange,
  onPhotoChange,
  onPhotoRemove,
}: {
  title: string;
  servings: string;
  image: string | null | undefined;
  onTitleChange: (value: string) => void;
  onServingsChange: (value: string) => void;
  onPhotoChange: (file: File) => void;
  onPhotoRemove: () => void;
}) {
  return (
    <section className="form-section">
      <div className="section-heading">
        <span className="section-number">01</span>
        <div>
          <h2>Le plat</h2>
          <p>Un nom et le nombre de personnes de la recette d’origine.</p>
        </div>
      </div>
      <div className="basics-grid">
        <div>
          <label className="field">
            Nom de la recette
            <input
              required
              maxLength={120}
              value={title}
              onChange={(event) => onTitleChange(event.target.value)}
              placeholder="Ex. : Lasagnes du dimanche"
            />
          </label>
          <label className="field portions-field">
            Recette pour
            <div className="input-suffix">
              <input
                required
                type="number"
                min={SERVINGS_MIN}
                max={SERVINGS_MAX}
                step="1"
                inputMode="numeric"
                value={servings}
                onChange={(event) => onServingsChange(event.target.value)}
              />
              <span>personnes</span>
            </div>
          </label>
        </div>

        <div className="photo-field">
          <label className="photo-upload">
            {image ? (
              <Image unoptimized src={image} alt="Photo de la recette" fill sizes="240px" />
            ) : (
              <>
                <ImagePlus size={28} />
                <strong>Ajouter une photo</strong>
                <span>Facultative · JPG, PNG, WebP · 5 Mo max.</span>
              </>
            )}
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp"
              aria-label="Photo de la recette"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) onPhotoChange(file);
              }}
            />
          </label>
          {image && (
            <button type="button" className="text-button remove-photo" onClick={onPhotoRemove}>
              <X size={14} /> Retirer la photo
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

export function IngredientSection({
  formId,
  catalog,
  lines,
  classificationStatuses,
  onLineChange,
  onLineRemove,
  onLineAdd,
  onLineBlur,
  onAisleManualChange,
}: {
  formId: string;
  catalog: Ingredient[];
  lines: IngredientLine[];
  classificationStatuses: Record<string, IngredientClassificationStatus | undefined>;
  onLineChange: (key: string, patch: Partial<IngredientLine>) => void;
  onLineRemove: (key: string) => void;
  onLineAdd: () => void;
  onLineBlur: (key: string, name: string) => void;
  onAisleManualChange: (key: string, aisle: Aisle) => void;
}) {
  const catalogId = `${formId}-catalog`;

  return (
    <section className="form-section">
      <div className="section-heading">
        <span className="section-number">02</span>
        <div>
          <h2>Les ingrédients</h2>
          <p>Choisissez un ingrédient du carnet ou saisissez un nouveau nom.</p>
        </div>
      </div>
      <datalist id={catalogId}>
        {catalog.map((item) => (
          <option key={item.id} value={item.name} />
        ))}
      </datalist>

      <div className="ingredient-lines">
        {lines.map((line, index) => (
          <div className="ingredient-line" key={line.key}>
            <label className="field ingredient-name">
              Ingrédient {index + 1}
              <input
                list={catalogId}
                value={line.name}
                required
                maxLength={100}
                placeholder="Ex. : Tomates"
                onChange={(event) => {
                  const name = event.target.value;
                  const known = catalog.find(
                    (item) => normalizeIngredientName(item.name) === normalizeIngredientName(name),
                  );
                  onLineChange(line.key, {
                    name,
                    ingredient_id: known?.id,
                    aisle: known?.aisle ?? line.aisle,
                  });
                }}
                onBlur={(event) => onLineBlur(line.key, event.currentTarget.value)}
              />
            </label>
            <label className="field ingredient-quantity">
              Quantité
              <input
                inputMode="decimal"
                value={line.quantity}
                disabled={line.unit === "to_taste"}
                required={line.unit !== "to_taste"}
                placeholder={line.unit === "to_taste" ? "—" : "Ex. : 250"}
                onChange={(event) => onLineChange(line.key, { quantity: event.target.value })}
              />
            </label>
            <label className="field ingredient-unit">
              Unité
              <select
                value={line.unit}
                onChange={(event) => {
                  const unit = event.target.value as Unit;
                  onLineChange(line.key, {
                    unit,
                    quantity: unit === "to_taste" ? "" : line.quantity,
                  });
                }}
              >
                {UNITS.map((unit) => (
                  <option key={unit.id} value={unit.id}>
                    {unit.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field ingredient-aisle">
              Rayon
              <select
                value={line.aisle}
                onChange={(event) => {
                  const aisle = event.target.value as Aisle;
                  onAisleManualChange(line.key, aisle);
                  onLineChange(line.key, { aisle });
                }}
              >
                {AISLES.map((aisle) => (
                  <option key={aisle.id} value={aisle.id}>
                    {aisle.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="icon-button ingredient-remove"
              aria-label={`Retirer l’ingrédient ${index + 1}`}
              disabled={lines.length === 1}
              onClick={() => onLineRemove(line.key)}
            >
              <Trash2 size={18} />
            </button>
            {classificationStatuses[line.key] && (
              <p
                className="field-hint ingredient-classification-status"
                role="status"
                style={{ gridColumn: "1 / -1", marginTop: 0 }}
              >
                {classificationStatuses[line.key] === "pending" && "Recherche du rayon…"}
                {classificationStatuses[line.key] === "suggested" &&
                  "Rayon proposé automatiquement. Vous pouvez le modifier."}
                {classificationStatuses[line.key] === "catalog" && "Rayon du catalogue partagé."}
                {classificationStatuses[line.key] === "manual" && "Rayon choisi manuellement."}
                {classificationStatuses[line.key] === "unavailable" &&
                  "Aucune suggestion disponible ; vous pouvez choisir le rayon."}
              </p>
            )}
          </div>
        ))}
      </div>

      <button type="button" className="button button-secondary" onClick={onLineAdd}>
        <Plus size={17} /> Ajouter un ingrédient
      </button>
      <p className="field-hint">
        Le rayon d’un ingrédient est commun à toutes les recettes qui l’utilisent.
      </p>
    </section>
  );
}

export function StepsSection({
  steps,
  onStepChange,
  onStepRemove,
  onStepAdd,
}: {
  steps: string[];
  onStepChange: (index: number, value: string) => void;
  onStepRemove: (index: number) => void;
  onStepAdd: () => void;
}) {
  return (
    <section className="form-section">
      <div className="section-heading">
        <span className="section-number">03</span>
        <div>
          <h2>La préparation</h2>
          <p>Les étapes, dans l’ordre. Vous pourrez aussi les compléter plus tard.</p>
        </div>
      </div>
      <div className="step-lines">
        {steps.map((step, index) => (
          <div className="step-line" key={index}>
            <span className="step-number">{index + 1}</span>
            <label className="field">
              <span className="sr-only">Étape {index + 1}</span>
              <textarea
                maxLength={4000}
                rows={3}
                value={step}
                placeholder={index === 0 ? "Ex. : Préchauffer le four à 180 °C…" : "Et ensuite…"}
                onChange={(event) => onStepChange(index, event.target.value)}
              />
            </label>
            <button
              type="button"
              className="icon-button"
              aria-label={`Retirer l’étape ${index + 1}`}
              onClick={() => onStepRemove(index)}
            >
              <Trash2 size={18} />
            </button>
          </div>
        ))}
      </div>
      <button type="button" className="button button-secondary" onClick={onStepAdd}>
        <Plus size={17} /> Ajouter une étape
      </button>
    </section>
  );
}
