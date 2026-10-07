# À table

Un carnet de recettes privé et une liste de courses partagée, pour un compte commun utilisé sur deux téléphones. Application Next.js, TypeScript et Supabase, conçue pour le mobile.

Documentation du dépôt : [architecture](docs/architecture.md), [contrats SQL](docs/database.md), [développement et skills](docs/development.md) et [décision sur les mutations](docs/decisions/0001-mutations-transactionnelles.md). Les consignes pour les agents sont dans [AGENTS.md](AGENTS.md).

Application déployée : [À table](https://recipes-virid-tau.vercel.app). Connectez-vous avec votre compte commun Supabase.

## Démarrage rapide

Prérequis : Node.js 22 ou supérieur, npm et un projet Supabase.

```sh
nvm use
npm ci
cp .env.example .env.local
```

Dans `.env.local`, renseigner l’URL du projet et sa **publishable key**, disponibles dans le dialogue **Connect** de Supabase. L’application ne nécessite aucune clé `service_role` ni aucun mot de passe de base de données.

Appliquer les migrations, créer le compte commun et désactiver les inscriptions comme indiqué ci-dessous, puis lancer :

```sh
npm run dev
```

Ouvrir [localhost:3000](http://localhost:3000). Sans configuration, l’application affiche une page d’attente et refuse toute sauvegarde ; elle ne simule pas une base partagée.

## Configurer Supabase

1. Créer un projet Supabase dans votre organisation, idéalement dans une région européenne.
2. Appliquer les fichiers de `supabase/migrations/` dans l’ordre de leur nom, via le SQL Editor. Pour un nouveau projet, la CLI peut également appliquer les migrations :

   ```sh
   supabase login
   supabase link --project-ref VOTRE_REFERENCE
   supabase db push
   ```

   Pour une installation neuve, appliquer toutes les migrations. Si elles ont déjà été appliquées via le connecteur ou le SQL Editor, vérifier l’historique du projet cible avant de les rejouer ou de les synchroniser avec la CLI.
3. Dans **Authentication → Users → Add user → Create new user**, créer votre compte commun avec votre email et votre mot de passe. Activer **Auto Confirm User**. N’utiliser aucun compte de test pour votre foyer.
4. Dans les réglages **Authentication**, désactiver **Allow new users to sign up** et les connexions anonymes. Ne pas désactiver la connexion email/mot de passe. Aucun formulaire d’inscription n’est fourni.
5. Dans **URL Configuration**, définir l’URL du site déployé comme **Site URL**. La connexion par mot de passe n’envoie pas d’email et ne nécessite pas de SMTP. En cas de mot de passe oublié, le réinitialiser via l’administration Supabase.
6. Vérifier que le bucket **recipe-photos** est privé et que les tables `workspaces`, `shopping_lists`, `shopping_items`, `meal_selections` et `recipes` sont incluses dans la publication **supabase_realtime**. Les migrations configurent ces éléments.

Les photos acceptées sont JPG, PNG et WebP, jusqu’à 5 Mo. Les fichiers HEIC doivent être convertis avant envoi. Les liens de lecture des photos sont signés et temporaires.

## Mettre en ligne sur Vercel

Importer le projet dans Vercel avec le preset Next.js et Node.js 22. Définir ces variables pour chaque environnement utilisé :

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Déployer, puis utiliser votre compte commun sur chacun des téléphones. Les identifiants sont ceux du compte **Authentication**, pas ceux du tableau de bord Supabase.

Avec la CLI :

```sh
npx vercel login
npx vercel link
npx vercel env add NEXT_PUBLIC_SUPABASE_URL production
npx vercel env add NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY production
npx vercel --prod
```

Le build utilise Webpack pour fonctionner aussi dans les environnements où les processus temporaires de Turbopack ne peuvent pas ouvrir de port. Ne jamais ajouter `.env.local`, les identifiants ou `.vercel/` au dépôt.

## Fonctionnement

- Une recette conserve ses portions d’origine. L’affichage et chaque occurrence d’un plat peuvent utiliser un autre nombre de portions.
- Sur **Préparer**, les portions s’enregistrent automatiquement après une courte pause de saisie, ou dès que le champ perd le focus. La génération attend les sauvegardes en cours. Une valeur invalide ou un enregistrement échoué bloque la génération et peut être corrigé ou réessayé.
- Le catalogue identifie les ingrédients par leur nom normalisé (casse et espaces). Le choix d’un ingrédient existant évite les doublons ; les synonymes et singuliers/pluriels ne sont pas fusionnés automatiquement.
- Le rayon est partagé par toutes les recettes utilisant cet ingrédient.
- Grammes et kilogrammes se regroupent ; millilitres, centilitres et litres aussi. Masses, volumes, pièces, cuillères et pincées restent distincts. Les mentions « au goût » ne sont pas chiffrées.
- Les calculs utilisent une arithmétique décimale ; l’affichage arrondit à trois décimales. L’application calcule les besoins, pas le nombre de paquets à acheter.
- La génération crée un instantané unique, indépendant des modifications ou suppressions ultérieures des recettes. Remplacer la liste nécessite une confirmation et réinitialise les cases cochées.
- Les mises à jour des cases sont idempotentes et synchronisées. Le dernier état enregistré prévaut. Les clics sur une ancienne liste sont rejetés.
- Un canal Realtime commun aux trois écrans reçoit les révisions privées de `workspaces` et les changements de courses. Les créations, modifications et retraits de plats et recettes apparaissent sur l’autre appareil. Une saisie locale en cours est conservée pendant les rafraîchissements. [Documentation Supabase Realtime](https://supabase.com/docs/guides/realtime/postgres-changes).
- La connexion Internet est nécessaire. Une modification échouée revient à son état précédent ; elle n’est pas mise en attente hors ligne.
- Se déconnecter d’un téléphone conserve la connexion sur l’autre appareil.

## Architecture et accès privés

Les lectures métier passent par les Server Components, les écritures par les Server Actions. Le navigateur utilise Supabase uniquement pour recevoir les événements Realtime. Les droits de la session sont revérifiés à chaque action.

Les tables possèdent des règles RLS limitant la lecture au propriétaire. Le rôle `authenticated` ne peut pas écrire directement dans ces tables : les fonctions transactionnelles de mutation vérifient `auth.uid()` et le propriétaire de chaque référence. Toutes les fonctions privilégiées ont un `search_path` vide ; le verrou interne n’est pas exposé aux utilisateurs. Supabase peut signaler les six fonctions de mutation `SECURITY DEFINER` accessibles aux utilisateurs connectés : cet accès est intentionnel, contrôlé et couvert par les tests. [Explication de l’avis Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

Un verrou par compte assure la cohérence de la préparation, de la génération et du remplacement. Un numéro de révision rejette les générations devenues périmées. Les contraintes empêchent de relier des recettes, ingrédients ou courses appartenant à des comptes différents.

Les types de `src/lib/supabase/database.types.ts` sont générés depuis le schéma réel. `database.ts` ajoute la nullabilité de certains paramètres RPC que le générateur ne peut pas déduire. Pour régénérer :

```sh
supabase gen types typescript --project-id VOTRE_REFERENCE > src/lib/supabase/database.types.ts
```

## Vérifications

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Les tests de calcul et de droits utilisent un PostgreSQL isolé via PGlite. Ils appliquent la migration réelle et vérifient les transactions, les accès anonymes et entre comptes, les photos, la stabilité des instantanés et les remplacements concurrents.

Les tests navigateur utilisent un **compte Supabase de test isolé** et la base réelle. Ils suppriment les recettes de ce compte avant chaque scénario. Ne jamais utiliser le compte du foyer. Créer `.env.e2e.local`, ignoré par Git :

```text
E2E_EMAIL=codex-e2e-votre-test@example.com
E2E_PASSWORD=mot-de-passe-du-compte-isole
```

```sh
npx playwright install chromium webkit
npm run build
npm run test:e2e
```

Les scénarios couvrent la création avec photo, les portions automatiques, les saisies pendant une requête lente, la génération après sauvegarde, deux sessions simultanées, le partage des créations et suppressions, la persistance après actualisation, la récupération après une coupure réseau, l’échec d’enregistrement et sa reprise, la modification d’une recette, la confirmation et le remplacement de liste. Chrome et WebKit mobile sont vérifiés. Pour tester une URL déployée, définir `E2E_BASE_URL`.

## Première version

Trois espaces : recettes, préparation et courses. Pas de calendrier, ajout d’articles libres, gestion du placard, export, import automatique, PWA ou mode hors ligne. La base n’est pas stockée dans le navigateur.
