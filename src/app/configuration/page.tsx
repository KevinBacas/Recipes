import { CookingPot, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { isConfigured } from "@/lib/supabase/config";
import { redirect } from "next/navigation";
export default function Configuration() {
  if (isConfigured()) redirect("/connexion");
  return (
    <main id="main" className="auth-page">
      <div className="setup-card">
        <span className="brand-mark large">
          <CookingPot size={32} />
        </span>
        <p className="eyebrow">À TABLE</p>
        <h1>Votre cuisine prend forme.</h1>
        <p>
          Votre espace privé doit être connecté à sa base de données avant de pouvoir enregistrer
          vos recettes et partager vos courses.
        </p>
        <div className="setup-note">
          <LockKeyhole size={20} />
          <span>
            La configuration est décrite dans le guide fourni avec le projet. Aucun compte ni aucune
            recette n’a encore été créé.
          </span>
        </div>
        <Link href="/connexion" className="button button-secondary">
          Voir la connexion
        </Link>
      </div>
    </main>
  );
}
