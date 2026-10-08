# Architecture de À table

[Accueil du projet](../README.md) · [Base de données](database.md) · [Développement](development.md)

## Responsabilités

| Emplacement                                   | Responsabilité                                                                   |
| --------------------------------------------- | -------------------------------------------------------------------------------- |
| `src/app/(private)/`                          | Pages protégées, chargement serveur, layout commun et états de chargement/erreur |
| `src/app/actions.ts`                          | Connexion, mutations validées avec Zod, RPC, gestion des photos et revalidation  |
| `src/app/api/ingredients/classify/route.ts`   | Classement ponctuel authentifié, sans écriture                                   |
| `src/components/`                             | Présentation et interactions, sans écriture directe des tables Supabase          |
| `src/lib/domain.ts`                           | Contrats métier, unités, validation, agrégation et affichage des quantités       |
| `src/lib/ingredient-classification.ts`        | Contrat partagé du classement et de ses rayons                                   |
| `src/lib/ingredient-classification-client.ts` | Coordination des suggestions et saisies manuelles côté formulaire                |
| `src/lib/server/ingredient-classification.ts` | Suggestion côté serveur avec AI Gateway facultative                              |
| `src/lib/portion-autosave.ts`                 | File de sauvegarde des portions, indépendante de React                           |
| `src/lib/data.ts`                             | Lectures authentifiées et URLs temporaires des photos                            |
| `src/lib/use-realtime-refresh.ts`             | Canal Realtime, reconnexion, nettoyage et rafraîchissement des lectures          |
| `src/lib/supabase/`                           | Clients SSR/navigateur, configuration, types générés et adaptation des RPC       |
| `src/proxy.ts`                                | Rafraîchissement de la session et propagation des cookies                        |
| `supabase/migrations/`                        | Schéma, droits, transactions et publication Realtime                             |

## Lecture et mutation

Une page privée charge ses données dans un Server Component via `data.ts`.
`authenticatedClient` vérifie les claims de la session ; il redirige vers
`/configuration` sans configuration et vers `/connexion` sans session valide.
`React.cache` déduplique ce travail dans une requête serveur. Le client SSR utilise
les cookies de cette requête et des appels `fetch` avec `cache: "no-store"`.
Le layout privé force le rendu dynamique ; le proxy ajoute `private, no-store`.

Une interaction appelle une Server Action qui valide ses entrées, vérifie la
session et appelle une RPC. La base contrôle les droits et la transaction ;
l'action renvoie un `ActionResult` avec une erreur compréhensible en cas d'échec,
puis revalide les routes concernées après un succès. Les contrôles du layout et
de l'interface ne remplacent pas les contrôles dans les actions et la base.

La route `POST /api/ingredients/classify` vérifie la session avec les claims
Supabase et limite la recherche du catalogue au compte courant. Un rayon trouvé
dans le catalogue est renvoyé directement ; sinon, si `AI_GATEWAY_API_KEY` est
configurée, le serveur demande une suggestion avec `openai/gpt-6-luna-decisions`
via le SDK Vercel AI et `@ai-sdk/gateway`, avec un délai maximal de cinq secondes
et sans nouvelle tentative. Seul le nom de l’ingrédient est transmis.
Cette route ne modifie pas la base : le rayon choisi est sauvegardé par le flux
normal de recette et ses RPC. Sans clé ou en cas d’échec, le formulaire conserve
la saisie manuelle.

Le navigateur emploie Supabase pour la session du canal Realtime et ses événements.
`useRealtimeRefresh` porte le cycle de vie du canal ; `RealtimeRefresh` n'affiche
que son état. `realtime-controller.ts` porte une durée de vie de souscription
injectable et testée, tandis que le hook décide de sa recréation. Les lectures métier passent par le serveur ; les écritures de tables
passent par les RPC appelées depuis le serveur. Les réponses RPC sont validées à
leur frontière avec Zod. Les photos passent par l'API Storage côté serveur : la
RPC exprime l'intention de conserver, remplacer ou retirer la photo dans la même
transaction que la recette. La révision de recette refuse une édition périmée ;
le détail et l'édition lisent uniquement la recette demandée.

## Portions et génération des courses

`PortionAutosave` conserve la valeur confirmée, la saisie locale et une file de
sauvegarde par plat. La saisie déclenche une sauvegarde après 350 ms ; la perte
de focus et la génération forcent la sauvegarde. Une valeur invalide ou un échec
empêche la génération. `reconcile` accepte une valeur serveur seulement quand
aucune édition ou sauvegarde locale n'est en cours.

La génération attend aussi les ajouts et retraits de plats déjà lancés. Dans le
formulaire de recette, une saisie intacte accepte les données distantes ; si elle
a été modifiée, une révision distante est signalée et doit être chargée explicitement
avant de remplacer son brouillon. Les changements de rayon partagé versionnent
aussi les recettes concernées. Les photos signées peuvent être renouvelées à
révision identique, sans écraser une saisie locale.

`recipe-draft.ts` transforme le brouillon en payload de création ou d'édition ;
l'état du formulaire reste dans un seul propriétaire. Les helpers de
`src/lib/server/` isolent les erreurs et les photos de l'orchestration des actions.
La création utilise une identité stable et tente une réconciliation après perte
de réponse. Les limites et compromis sont décrits dans la
[décision dédiée](decisions/0002-revisions-et-reprise-des-recettes.md).

`generateList` relit la préparation et sa révision, calcule les quantités avec
`aggregateShopping`. Les ajouts et retraits sont suivis avant les transitions
React pour bloquer immédiatement la génération pendant une mutation en attente.
La génération attend aussi leur résolution avant de lire la préparation.
Elle appelle ensuite `replace_shopping_list`. Les nombres sont
calculés avec `decimal.js`. La base vérifie la révision et l'identité de la liste
attendue avant de remplacer l'instantané. Les règles métier visibles sont décrites
dans le [README](../README.md#fonctionnement).

## Synchronisation entre appareils

Le layout monte un seul `RealtimeRefresh`, abonné aux INSERT et UPDATE privés
de `workspaces`, `shopping_lists` et `shopping_items`. Les mutations de recettes
et de préparation incrémentent `workspaces.revision`, ce qui signale aussi leurs
suppressions sans dépendre de payloads DELETE filtrés.

Le canal reçoit le JWT de la session avant de s'abonner. Les événements regroupent
les rafraîchissements avec un délai de 120 ms et appellent `router.refresh()`.
Le retour en ligne recrée le canal ; le focus et le retour à un onglet visible
rafraîchissent les données. Le nettoyage retire le canal, les écouteurs et le timer,
et ignore les callbacks d'un effet terminé. La synchronisation ne constitue pas
une file d'attente hors ligne.

## Faire évoluer l'architecture

Conserver les frontières ci-dessus tant qu'elles répondent au besoin. Une extraction
doit clarifier une responsabilité réelle ; une nouvelle couche ou bibliothèque doit
résoudre un problème concret. Les choix durables et leurs compromis sont conservés
dans les décisions sur les [mutations](decisions/0001-mutations-transactionnelles.md)
et les [révisions/reprises](decisions/0002-revisions-et-reprise-des-recettes.md).
