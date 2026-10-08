"use client";
import { AlertCircle } from "lucide-react";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <AlertCircle size={32} />
      </span>
      <h1>Une petite pause imprévue</h1>
      <p>Votre espace n’a pas pu être chargé. Vérifiez votre connexion puis réessayez.</p>
      <button type="button" className="button button-primary" onClick={reset}>
        Réessayer
      </button>
    </div>
  );
}
