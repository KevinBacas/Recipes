"use client";
import { useState, useTransition } from "react";
import { CookingPot, Heart, BookOpen, ShoppingBasket, CalendarPlus } from "lucide-react";
import { signIn } from "@/app/actions";
import { ErrorMessage, Spinner } from "./ui";

export function LoginForm({ configured }: { configured: boolean }) {
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  return (
    <main id="main" className="auth-page">
      <div className="auth-layout">
        <section className="auth-story">
          <div className="brand">
            <span className="brand-mark">
              <CookingPot size={23} />
            </span>
            <span>
              à table<span className="brand-dot">.</span>
            </span>
          </div>
          <div className="auth-story-content">
            <div className="pill">
              <Heart size={14} /> Notre cuisine à deux
            </div>
            <h1>
              De bonnes idées.
              <br />
              De bons petits plats.
            </h1>
            <p>Nos recettes préférées et tout ce qu’il faut pour les préparer.</p>
            <div className="auth-features">
              <span>
                <BookOpen size={20} /> Nos recettes
              </span>
              <span>
                <CalendarPlus size={20} /> Les prochains plats
              </span>
              <span>
                <ShoppingBasket size={20} /> Les courses, ensemble
              </span>
            </div>
          </div>
          <span className="auth-footnote">Un espace à nous, pour le quotidien.</span>
        </section>
        <section className="login-card">
          <p className="eyebrow">BIENVENUE À LA MAISON</p>
          <h2>On passe en cuisine ?</h2>
          <p>Connectez-vous avec notre compte commun.</p>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              setError("");
              startTransition(async () => {
                try {
                  const result = await signIn(form);
                  if (!result.ok) setError(result.error);
                } catch (error) {
                  if (error instanceof Error && error.message.includes("NEXT_REDIRECT"))
                    throw error;
                  setError("Connexion impossible. Vérifiez votre connexion puis réessayez.");
                }
              });
            }}
          >
            <label className="field">
              Email
              <input
                name="email"
                type="email"
                required
                autoComplete="username"
                placeholder="notre@email.fr"
                disabled={!configured || pending}
              />
            </label>
            <label className="field">
              Mot de passe
              <input
                name="password"
                type="password"
                required
                autoComplete="current-password"
                placeholder="Votre mot de passe"
                disabled={!configured || pending}
              />
            </label>
            {!configured && (
              <ErrorMessage>
                Votre espace attend sa configuration. Vous pourrez vous connecter dès qu’elle sera
                terminée.
              </ErrorMessage>
            )}
            {error && <ErrorMessage>{error}</ErrorMessage>}
            <button
              type="submit"
              className="button button-primary full-width"
              disabled={!configured || pending}
            >
              {pending && <Spinner />}Se connecter
            </button>
          </form>
          <div className="login-footer">
            <Heart size={14} /> Les mêmes recettes sur nos deux téléphones.
          </div>
        </section>
      </div>
    </main>
  );
}
