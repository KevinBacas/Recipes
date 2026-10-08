# Revue du code et plan de maintenabilité — 7 octobre 2026

Statut : diagnostic initial, complété par l'état de mise en œuvre de la PR.
Référence examinée : `4fbeb92`, checkout initialement propre.

## Conclusion

L'architecture est adaptée au produit et ses frontières sont respectées : lectures
serveur, actions authentifiées, calculs purs, mutations transactionnelles et droits
SQL limités. La maintenabilité est surtout freinée par le code extrêmement compact,
la concentration des responsabilités dans certaines fonctions et les contrats JSON
affirmés par des casts. Deux défauts de gestion des photos peuvent laisser une
recette pointer vers un fichier supprimé ; ils passent avant les refactorisations.

Une reprise progressive suffit. Les RPC, le compte commun, les instantanés et la
file de sauvegarde des portions constituent des bases à préserver.

## Périmètre et méthode

Lecture des 33 fichiers TS/TSX/CSS applicatifs hors types générés, des migrations,
des types SQL, des configurations, des suites de tests et de la documentation.
Application des six skills du dépôt : `recipes-maintainability`,
`vercel-react-best-practices`, `vercel-composition-patterns`, `supabase`,
`supabase-postgres-best-practices` et `recipes-docs-sync`, avec seulement leurs
références utiles. Vérification des API Next.js dans la documentation installée.

Les recommandations générales sont adaptées au compte commun et au faible nombre
d'appareils. Aucun besoin établi de cache partagé, de repository générique ou de
bibliothèque supplémentaire de gestion des données.

## État des lieux

| Domaine                  | Évaluation                      | Éléments observés                                                                                      |
| ------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Architecture             | Bonne base                      | Pages serveur fines ; dépendances React/Supabase absentes des calculs et de l'autosave                 |
| Accès privés             | Contrat solide dans les sources | Auth dans les actions ; RLS ; références composées ; EXECUTE limité ; `search_path` vide               |
| Calculs                  | Bien isolés et testés           | Decimal, conversions explicites, arrondi à l'affichage, conservation des petits besoins                |
| Sauvegarde des portions  | Bon exemple à conserver         | File indépendante de React ; états explicites ; tests de requêtes lentes et réponses perdues           |
| Lisibilité               | Principal frein quotidien       | JSX, callbacks et CSS écrits sur de très longues lignes                                                |
| Orchestration des photos | À corriger en priorité          | Lecture ancienne, commit et compensation ne partagent pas un contrat de concurrence fiable             |
| Frontières de données    | Fragiles face à une évolution   | RPC JSON converties directement en types métier                                                        |
| Tests                    | Bonne base, couverture inégale  | 47 tests locaux ; aucune suite locale dédiée aux actions/lectures ; tests SQL dépendants de leur ordre |
| Documentation            | Globalement cohérente           | Responsabilités, contrats SQL et choix durable documentés ; portée de la concurrence à préciser        |

Le contrôle de session via `getClaims()` et la propagation des cookies dans le
proxy correspondent au [modèle SSR Supabase](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs).
Cette revue des sources ne certifie pas la configuration actuelle du projet hébergé.

## Constats priorisés

P1 : risque de données incohérentes à traiter d'abord. P2 : correction fonctionnelle
ou dette de maintenabilité significative. P3 : amélioration utile, moins urgente.

### R1 — P1 : la compensation peut supprimer une photo déjà enregistrée

Source : [actions.ts](../../src/app/actions.ts), lignes 72–82.

Le même `try/catch` englobe la RPC, la suppression de l'ancienne photo et la
revalidation. Toute erreur mène à supprimer `uploadedPath`. Si la RPC a commité
mais sa réponse a été perdue, ou si la revalidation échoue après son succès,
la photo désormais référencée en base est supprimée. L'action retourne un échec
bien que la recette ait été enregistrée.

**Preuve :** exécution du code réel de l'action avec dépendances simulées. Dans
chacun de ces deux scénarios, la RPC enregistre le nouveau chemin et l'objet
correspondant disparaît après le traitement d'erreur. Ce sont des injections de
panne locales, pas des incidents observés sur le service hébergé.

**Correction :** distinguer échec confirmé avant commit, résultat indéterminé et
échec après commit. Ne pas compenser un résultat incertain sans réconciliation.
Séparer le succès métier du nettoyage et de la revalidation. Pour la création,
prévoir une identité stable permettant de retrouver le résultat d'une tentative.

**Validation :** réponse RPC perdue après commit, refus SQL avant commit,
revalidation échouée et nettoyage Storage échoué ; vérifier les références et les
objets, ainsi que le résultat renvoyé à l'interface.

### R2 — P1 : une modification concurrente peut rétablir une photo supprimée

Source : [actions.ts](../../src/app/actions.ts), lignes 55–77 ;
[save_recipe](../../supabase/migrations/20261002210648_initial_recipes_and_shopping.sql),
lignes 103–113.

Deux actions lisent le chemin X avant d'appeler la RPC. A remplace X par Y et
supprime X. B, qui modifie seulement le texte, transmet ensuite le chemin X lu
précédemment. La RPC rétablit X. Les deux actions peuvent réussir, mais la recette
référence un objet supprimé. Le verrou SQL sérialise les RPC ; il ne protège pas
la lecture Storage effectuée avant leur transaction.

**Preuve :** deux appels de l'action réelle avec entrelacement contrôlé et
dépendances simulées : deux succès, chemin final X, objet X absent.

**Correction :** exprimer l'intention photo dans la RPC : conserver la valeur
actuelle, retirer ou remplacer. Une modification de texte doit conserver la photo
au moment de la transaction. Retourner le chemin effectivement remplacé et
définir un nettoyage qui ne puisse retirer une référence active. Évaluer aussi la
garde de version proposée dans R6. Toute évolution SQL passe par une nouvelle
migration ; les migrations existantes restent immuables.

**Validation :** remplacement/retrait concurrents, sauvegarde de texte concurrente,
suppression de recette pendant un upload et échec du nettoyage.

### R3 — P2 : la présentation du code rend les changements difficiles à relire

Sources : [recipe-form.tsx](../../src/components/recipe-form.tsx),
[preparation.tsx](../../src/components/preparation.tsx),
[shopping-list.tsx](../../src/components/shopping-list.tsx),
[globals.css](../../src/app/globals.css), tests et migrations.

`RecipeForm` et `PreparationView` occupent chacun 47 lignes, mais certaines
dépassent respectivement 1 086 et 1 214 caractères. Le CSS contient 18 lignes,
jusqu'à 4 189 caractères par ligne. Une branche d'erreur, un champ ou un état peut
être noyé dans un diff contenant tout un bloc d'interface.

**Correction :** adopter un formatage reproductible des sources maintenues à la
main, puis faire un commit purement mécanique. Préserver les copies officielles
des skills, les types générés et les migrations appliquées. Organiser ensuite le
CSS par sections explicites ; son placement global n'est pas en soi un défaut.

**Validation :** `npm run check` et comparaison du parcours/rendu quand un compte
isolé est disponible. La séparation du formatage et des changements de logique
doit rendre les prochains diffs compréhensibles.

### R4 — P2 : certaines fonctions mélangent plusieurs responsabilités

Sources : [actions.ts](../../src/app/actions.ts),
[recipe-form.tsx](../../src/components/recipe-form.tsx),
[preparation.tsx](../../src/components/preparation.tsx),
[realtime.tsx](../../src/components/realtime.tsx).

`saveRecipe` gère décodage, validation, lecture, détection de fichier, upload,
transaction, nettoyage et revalidation. `RecipeForm` combine toutes les sections,
le brouillon et la sérialisation. `RealtimeRefresh` porte l'authentification du
canal, les abonnements, les événements navigateur, le debounce et le rendu.
Leur longueur apparente masque le nombre de contrats à maintenir ensemble.

**Correction :** extraire les responsabilités concrètes : helpers serveur pour
les photos et les erreurs, transformation du brouillon de recette, sections de
formulaire, contrôleur/hook Realtime et rendu de son statut. Garder les actions
comme orchestration explicite, et les données du formulaire dans un propriétaire
unique. Préserver `PortionAutosave` et le registre utilisé par la génération.

L'API actuelle de `ConfirmDialog` n'a pas de prolifération de variantes ; sa
conversion en une bibliothèque de composants composés n'est pas prioritaire.
La gestion des opérations en cours entre préparation et dialogue mérite en
revanche un test : la génération attend les portions, sans attendre explicitement
un ajout ou retrait de plat déjà lancé. Ce scénario reste à vérifier en navigateur.

**Validation :** contrats fonctionnels existants, nettoyage du canal, callbacks
d'un effet terminé, reconnexion, brouillon local et attente avant génération.

### R5 — P2 : les réponses JSON et les validations SQL peuvent diverger

Sources : [data.ts](../../src/lib/data.ts), lignes 20, 36 et 42 ;
[actions.ts](../../src/app/actions.ts), ligne 121 ;
[save_recipe](../../supabase/migrations/20261002210648_initial_recipes_and_shopping.sql),
ligne 107.

Les types générés disent `Returns: Json`. Les casts `as Recipe[]`,
`as Preparation` et `as ShoppingList` ne vérifient pas le format reçu. Une migration
peut modifier un champ et laisser TypeScript/compiler passer, puis casser le
consommateur React ou le calcul. Le cast constitue une frontière réellement non
typée, mais cette frontière n'a aucun contrat vérifié.

Un écart existe déjà : `save_recipe` accepte `p_steps = ARRAY[NULL]`. La condition
sur la longueur ne détecte pas NULL ; `get_recipes` renvoie alors `steps: [null]`,
contraire au type `string[]`. Une édition ultérieure utilise `step.trim()`.
Le formulaire normal bloque cet input via Zod, mais la RPC est directement
appelable par le compte authentifié.

**Preuve :** appel sous le rôle `authenticated` dans PGlite, après application
des trois migrations réelles : sauvegarde acceptée et lecture de `[null]`.
Ce défaut n'est pas un contournement des propriétaires ou des droits entre comptes.

**Correction :** rejeter les étapes NULL dans une nouvelle migration et définir
un décodage explicite des réponses aux frontières serveur, en réutilisant Zod.
Tester les contrats de forme SQL ↔ TypeScript. Conserver la validation serveur
et SQL : leur redondance protège deux points d'entrée distincts.

### R6 — P2 : le formulaire n'a pas de politique explicite de modification distante

Source : [recipe-form.tsx](../../src/components/recipe-form.tsx), lignes 16–30.

Titre, portions, ingrédients et étapes sont initialisés depuis `recipe` et ne
sont pas réconciliés lorsque ses props changent. En revanche, l'image lit les props
actuelles. Un rafraîchissement peut donc afficher une nouvelle photo avec un
ancien brouillon. Une sauvegarde renvoie tous les anciens champs et peut écraser
une modification distante, même si le formulaire local n'a pas été touché.

Le comportement découle de l'initialisation de
[`useState`](https://react.dev/reference/react/useState#parameters), ignorée après
le premier rendu, et de la conservation de l'état lors de `router.refresh()`
décrite dans la documentation Next.js installée. Le parcours navigateur n'a pas
été exécuté dans cette revue.

**Correction proposée :** suivre le brouillon modifié ; accepter les données
distantes lorsque le formulaire est intact ; conserver la saisie locale et
signaler un conflit lorsqu'elle a commencé. Évaluer une version de recette
vérifiée dans la transaction pour éviter l'écrasement silencieux. C'est une
évolution du comportement à documenter, pas un simple ajout d'effet qui remet
tous les champs à zéro.

### R7 — P2 : les tests SQL dépendent de leur ordre et la concurrence est partielle

Source : [database.test.ts](../../tests/database.test.ts), lignes 6–9 et 61–67.

`recipeId` et `list` sont remplis par certains tests et consommés par les suivants.
Le filtrage d'un cas devient inutilisable. Les scénarios de révision et de liste
périmée sont utiles, mais s'exécutent séquentiellement : ils ne prouvent pas
l'entrelacement de plusieurs connexions concurrentes au verrou PostgreSQL.

**Preuve :** `npm test -- tests/database.test.ts -t "persiste un état coché"`
échoue avec `Cannot read properties of undefined (reading 'items')` à la ligne 62,
alors que la suite complète passe.

**Correction :** fixtures autonomes par scénario et identité claire des données
préparées. Ajouter les tests d'actions des R1/R2 et des lectures R5. Pour prouver
le verrou sous concurrence, prévoir un PostgreSQL isolé avec plusieurs connexions ;
les mocks et PGlite restent utiles mais ont une autre portée. Reformuler la portée
des tests de concurrence dans le README.

### R8 — P2 : les échecs perdent leur contexte et certains résultats sont ignorés

Sources : [actions.ts](../../src/app/actions.ts), lignes 11–16, 34–37, 77–82
et 89–94 ; [data.ts](../../src/lib/data.ts), lignes 18–23.

Les erreurs sont traduites en messages génériques sans conserver de diagnostic
serveur. Le résultat de `signOut`, des suppressions Storage et de la signature des
URLs est ignoré. Une photo absente devient difficile à distinguer d'un échec du
service ; une déconnexion refusée peut rediriger vers une page qui renvoie ensuite
vers les recettes si la session demeure active.

**Correction :** garder des messages français sûrs, mais journaliser côté serveur
opération et code technique sans identifiants secrets ni contenu privé. Traiter
explicitement les erreurs retournées et distinguer échec métier et échec de
nettoyage. Éviter un wrapper générique qui cacherait la transaction.
La [documentation d'observabilité Supabase](https://supabase.com/docs/guides/observability)
fournit les sources de diagnostic du service en complément des erreurs applicatives.

### R9 — P3 : les lectures sont plus larges que les besoins des écrans

Sources : [data.ts](../../src/lib/data.ts), lignes 16–24 ;
[détail](<../../src/app/(private)/recettes/[id]/page.tsx>), ligne 6 ;
[édition](<../../src/app/(private)/recettes/[id]/modifier/page.tsx>), lignes 8–9 ;
[préparation](<../../src/app/(private)/preparer/page.tsx>), ligne 4.

Le détail et l'édition chargent toutes les recettes et signent toutes les photos
avant de sélectionner un ID. Préparer reçoit les recettes complètes et les
recettes embarquées dans les sélections, alors que l'interface utilise surtout
titre et nombre d'ingrédients. Elle demande également des URLs qu'elle n'affiche
pas. Chaque rafraîchissement Realtime répète ces lectures.

**Correction :** une lecture par ID pour le détail/édition et des projections
explicites pour le catalogue et la préparation. Adapter les contrats SQL/types
si nécessaire. Conserver l'authentification dédupliquée et les lectures parallèles
déjà présentes. Aucun ralentissement actuel n'a été mesuré : priorité inférieure
aux défauts fonctionnels et à la lisibilité.

### R10 — P3 : quelques règles et types sont dispersés

Sources : [domain.ts](../../src/lib/domain.ts), [portion-autosave.ts](../../src/lib/portion-autosave.ts),
[recipe-detail.tsx](../../src/components/recipe-detail.tsx),
[recipe-form.tsx](../../src/components/recipe-form.tsx).

Les limites et la validation des portions sont répétées dans Zod, l'autosave,
les champs HTML et le détail. La normalisation du catalogue est une fonction
locale au formulaire alors qu'elle représente une règle produit. Le type `Json`
défini dans `domain.ts` n'est pas utilisé ; un autre existe dans le fichier généré.

**Correction :** centraliser les constantes et fonctions TypeScript qui expriment
une même règle, tester leur cohérence avec SQL, et supprimer les exports inutiles.
Ne pas générer toute la validation SQL depuis Zod : préserver les garanties
indépendantes de la base et adapter seulement les duplications réellement utiles.

## Plan de correction

| Lot             | Travail                                                                                                      | Résultat attendu / critère d'acceptation                                                                  |
| --------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| 1 — R1/R2       | Ajouter les tests de panne et concurrence des actions, puis corriger le cycle de vie photo et le contrat RPC | Aucune référence à un objet supprimé dans les scénarios reproduits ; succès métier distinct du nettoyage  |
| 2 — R3/R7       | Formatage mécanique séparé ; fixtures SQL autonomes                                                          | Diffs lisibles ; tests filtrés exécutables sans dépendre d'autres cas                                     |
| 3 — R4/R8       | Extraire photos/erreurs côté serveur, puis brouillon/sections et contrôleur Realtime                         | Responsabilités explicites ; diagnostics conservés ; comportements existants inchangés                    |
| 4 — R5/R6       | Renforcer les contrats JSON/SQL et définir le comportement du formulaire face aux modifications distantes    | Réponse invalide détectée à la frontière ; étapes NULL refusées ; brouillon préservé et conflit explicite |
| 5 — R9/R10      | Lectures ciblées, projections et règles TypeScript communes                                                  | Chaque écran charge les données nécessaires ; validations cohérentes                                      |
| 6 — transversal | E2E isolés, contrôle PostgreSQL concurrent, documentation et éventuellement CI `npm run check`               | Parcours complet vérifié ; portée des tests et nouveaux contrats documentés                               |

Les tests associés accompagnent chaque correction ; ils ne sont pas différés au
dernier lot. Chaque lot applicatif termine par `npm run check`. Les mutations SQL
se vérifient sur une base isolée et s'ajoutent en migrations nouvelles. Mettre à
jour README/architecture/database/development selon le document propriétaire,
avec une décision d'architecture seulement pour un choix durable comme le contrat
de conflit. Aucun déploiement n'est inclus dans ce plan.

## Vérifications du diagnostic initial

- `npm run check` : réussi ; ESLint, TypeScript, 47 tests Vitest et build Next.js.
- Reproductions locales sur le code réel des actions, avec clients simulés :
  réponse RPC perdue, revalidation échouée, modification concurrente de photo.
- Appel RPC direct dans PGlite avec les migrations réelles et le rôle
  `authenticated` : étapes NULL acceptées, contrat incompatible confirmé.
- Test SQL filtré : échec confirmé dû à la fixture partagée, pas à la base distante.
- Playwright non exécuté : `.env.e2e.local` absent et aucun compte de test dédié
  identifié dans `.env.local`. Aucun compte du foyer utilisé.
- Aucun contrôle du déploiement, des logs distants ou de la configuration Auth
  hébergée ; aucune mesure de performance ni preuve de verrou multi-connexion.

## Mise en œuvre après la review de la PR — 8 octobre 2026

La première mise en œuvre contenait deux régressions : une édition conservant sa
photo supprimait son objet Storage, et la création sérialisait une révision NULL
convertie en zéro puis refusée par SQL. Les tests d'actions initiaux ne reproduisaient
pas ces contrats. Le bilan ci-dessous remplace les affirmations trop larges de
cette première version.

| Référence | Correction et preuve locale                                                                                                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R1        | Identité stable de création, empreinte de demande, réconciliation après réponse perdue et reprise sans doublon ; upload conservé si le résultat reste indéterminé. Tests action/SQL et création simultanée PostgreSQL.                                    |
| R2        | Intention photo transactionnelle, chemin final distinct du chemin détaché ; aucune suppression pour `keep`. Tests sur les objets Storage simulés, texte retardé, remplacement/retrait et suppression pendant upload.                                      |
| R3        | Formatage mécanique dans un commit distinct, Prettier épinglé et contrôle dans `npm run check`. Composants précédemment compacts remis en forme, CSS organisé par sections ; copies officielles, types générés et migrations exclus.                      |
| R4        | Sections, transformation de brouillon, helpers serveur et contrôleur Realtime séparés. Tests de nettoyage, callbacks tardifs, authentification, reconnexion et debounce. Attente des ajouts/retraits conservée ; E2E de retrait avec remplacement ajouté. |
| R5        | Réponses obligatoires validées sans valeur vide de substitution ; schémas Zod testés contre les vraies RPC. Étapes NULL interdites et anciennes valeurs réparées avec conservation de l'ordre. Création testée depuis le payload réel du formulaire.      |
| R6        | Brouillon intact réconcilié, saisie locale conservée avec conflit, révisions des recettes utilisant un rayon partagé invalidées. URL signée renouvelée à révision identique. E2E du formulaire intact ajouté et scénario de suppression corrigé.          |
| R7        | Fixtures autonomes, assertions complètes sur les instantanés et coches rétablies. Entrelacements d'actions et tests PostgreSQL avec deux connexions, observation du blocage et refus après déblocage.                                                     |
| R8        | Diagnostics sûrs des erreurs retournées et exceptions Auth/Storage ; erreurs de signature par fichier distinguées des photos absentes. Nettoyage et revalidation ne changent pas le succès métier.                                                        |
| R9        | Détail/édition ciblés ; résumés pour les plats disponibles ; projection dédiée des sélections et seul ID de liste active. Les ingrédients complets restent réservés au calcul serveur.                                                                    |
| R10       | Limites de portions utilisées dans Zod, les champs HTML, le détail et l'autosave ; validation TypeScript commune. Tests des bornes SQL/TS et de normalisation ; exports inutilisés retirés.                                                               |

Les contrats, la transition schéma/application et la portée des tests sont décrits
dans les documents propriétaires. La [décision sur les conflits et reprises](../decisions/0002-revisions-et-reprise-des-recettes.md)
explique les limites de l'identité de création et de la conservation prudente des
uploads. Les migrations déjà présentes n'ont pas été réécrites.

### Validation de cette correction

- `npm run check` : **réussi**, avec formatage, lint sans avertissement, TypeScript,
  **98 tests Vitest** et build Next.js.
- PostgreSQL local natif isolé : **3 tests réussis**, avec plusieurs connexions,
  sur les éditions périmées, les courses cochées et la même création simultanée.
  Le serveur temporaire a été arrêté après les tests.
- `npm run test:e2e -- --list` : **4 scénarios**, déclinés sur Chrome et WebKit
  mobile, soit **8 entrées**. Le listing ne prouve pas leur réussite.
- Playwright avec Supabase n'a pas été exécuté : aucun compte isolé n'est configuré
  dans l'environnement disponible. Aucun compte du foyer n'a été utilisé.
- Aucun déploiement ni SQL distant effectué. La transition documentée doit être
  validée sur un environnement Supabase isolé avant une livraison autorisée.
