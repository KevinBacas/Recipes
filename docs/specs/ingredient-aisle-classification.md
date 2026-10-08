# Classement des ingrédients avec un modèle de décision

## Besoin et contrats

Dans le formulaire de création ou d’édition, proposer automatiquement le rayon
de chaque nouveau nom d’ingrédient à la perte de focus. Un ingrédient du catalogue
conserve son rayon partagé. L’utilisateur peut toujours corriger la suggestion.
Le classement ne modifie la base qu’à l’enregistrement habituel de la recette.

- `POST /api/ingredients/classify` reçoit `{ name: string }` (1 à 100 caractères
  après trim) ; session Supabase revérifiée, lecture limitée au propriétaire.
- Succès : `{ aisle: Aisle | null, source: "catalog" | "ai" | "unavailable" }`.
  `null` signifie qu’aucune suggestion n’est disponible ; conserver le choix local.
- Erreurs HTTP : 400 pour une entrée invalide, 401 sans session, 503 pour une
  configuration ou une lecture indisponible. Réponses privées sans cache.
- Modèle : SDK Vercel AI, modèle `openai/gpt-6-luna-decisions`, question `choice` dont les critères
  sont les dix rayons de `AISLES`. Seul le nom de l’ingrédient est envoyé.
- Clé serveur `AI_GATEWAY_API_KEY` dans `.env.local`, facultative. Délai maximal
  de 5 secondes, sans retry ; erreur ou réponse invalide => aucune suggestion.

## Contraintes et concurrence

Préserver RPC, RLS, révisions, reprise de création, photos et modifications locales.
Pas de migration, cache partagé ni secret navigateur. Un résultat tardif ne doit
jamais remplacer un nom changé, une ligne supprimée, un choix manuel ou un
brouillon rechargé. Dédupliquer les noms dans le formulaire. À la soumission,
classer aussi les nouveaux noms encore non évalués et attendre les requêtes utiles
avant de sérialiser ; un échec laisse l’enregistrement possible.

## Répartition et dépendances

1. Coordination GPT-6.1 Sol : SDK et endpoint authentifié, contrat partagé,
   intégration, validation et corrections finales.
2. GPT-6 Luna High : module serveur IA et tests, uniquement
   `src/lib/server/ingredient-classification.ts`, `tests/ingredient-classification.test.ts`.
3. GPT-6 Luna High : formulaire et gestion des réponses obsolètes, uniquement
   `src/components/recipe-form.tsx`, `src/components/recipe-form-sections.tsx`,
   nouveau helper client et ses tests, nouveau fichier E2E indépendant.
4. GPT-6 Luna High : README, `.env.example`, architecture et guide de développement.
   Préserver le diff préexistant d’architecture ; vérifier ensuite les faits implémentés.
5. GPT-6 Astra High : revue du besoin, de cette spécification et du diff final.

Les trois tâches Luna sont indépendantes grâce au contrat ci-dessus. Le SDK est
installé par le coordinateur ; la documentation sera réconciliée après intégration.

## Acceptation

- Nouveau nom : suggestion valide visible et enregistrée ; nom connu : rayon
  du catalogue, sans appel IA ; correction manuelle prioritaire.
- Absence de clé, timeout, erreur Gateway et réponse invalide : saisie et sauvegarde
  utilisables ; aucune donnée sensible dans les logs ou bundles client.
- Réponses tardives, changement de nom, suppression, reload et submit rapide couverts.
- Tests du modèle simulé et du endpoint ; `npm run check` sous Node 22 ; parcours
  Playwright avec fournisseur simulé et compte isolé si disponible. Distinguer
  vérification locale et appel IA réel, qui dépend de la clé fournie.
