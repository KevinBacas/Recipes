# Contrats de base de données

[Accueil du projet](../README.md) · [Architecture](architecture.md) · [Développement](development.md)

La source du schéma est [supabase/migrations](../supabase/migrations/).
Chaque enregistrement métier appartient au compte authentifié via `owner_id`.
Le produit utilise un compte commun sur plusieurs appareils ; le schéma et les
tests conservent néanmoins l'isolation entre comptes distincts.

## Modèle

| Table                | Rôle et contrat principal                                                            |
| -------------------- | ------------------------------------------------------------------------------------ |
| `workspaces`         | Une ligne par compte ; verrou et révision de la préparation                          |
| `ingredients`        | Catalogue du compte ; unicité du nom normalisé et rayon partagé                      |
| `recipes`            | Titre, portions d'origine, étapes, chemin de photo privé et révision de modification |
| `recipe_ingredients` | Ingrédients ordonnés d'une recette, quantité et unité                                |
| `meal_selections`    | Occurrences de recettes à préparer avec leurs propres portions                       |
| `shopping_lists`     | Une seule liste active par compte et nombre de plats au moment de la génération      |
| `shopping_items`     | Instantané du nom, rayon, quantité, unité et état coché                              |

Les clés étrangères composées avec `owner_id` interdisent les liens entre comptes.
`to_taste` exige une quantité NULL ; les autres unités exigent une quantité positive.
Le nom normalisé du catalogue ignore casse et espaces répétés, sans fusionner les
synonymes. La suppression d'une recette retire ses sélections, mais ne modifie pas
l'instantané de courses déjà généré.

## Accès et RPC

Les sept tables ont RLS et une policy SELECT du propriétaire. `authenticated` peut
lire ses lignes, sans INSERT, UPDATE ou DELETE directs. `anon` n'a aucun droit sur
ces tables. Les RPC de lecture `get_recipes`, `get_recipe`, `get_recipe_summaries`,
`get_preparation`, `get_preparation_view` et `get_shopping_list` sont `SECURITY INVOKER` et respectent
RLS. `get_recipe` cible un identifiant ; `get_recipe_summaries` ne renvoie que
les données utiles au choix des plats. `get_preparation_view` renvoie les sélections
avec un nombre d'ingrédients et uniquement l'identifiant de la liste active.
`get_preparation` conserve les quantités nécessaires au calcul serveur.

Les six RPC de mutation sont `save_recipe`, `delete_recipe`, `save_selection`,
`delete_selection`, `replace_shopping_list` et `set_shopping_item_checked`.
Elles sont `SECURITY DEFINER`, avec un `search_path` vide, des références SQL
qualifiées, des contrôles de propriétaire et un droit EXECUTE limité à
`authenticated`. Elles passent d'abord par `lock_workspace`, qui exige `auth.uid()`
et verrouille la ligne du compte avec `FOR UPDATE`. Cette fonction interne n'est
pas exécutable directement par les rôles publics.

Les mutations de recette et de sélection incrémentent la révision du workspace.
`save_recipe` prend une révision attendue pour les éditions existantes et compare
cette valeur sous verrou avec `recipes.revision`. Il reçoit aussi l'intention photo
(`keep`, `replace` ou `remove`) ; le résultat contient `photo_path`, le chemin final,
et `previous_photo_path`, uniquement le chemin détaché par un retrait/remplacement.
Pour `keep`, ce dernier vaut NULL. Une répétition de création retourne le chemin
final d'origine, ce qui permet de nettoyer son upload supplémentaire. `delete_recipe` retourne le chemin de la photo supprimée.
La création reçoit `p_creation_id`, une identité stable, et `p_photo_hash`, le
SHA-256 du fichier éventuel. L'empreinte initiale est conservée dans
`recipes.creation_fingerprint` : répéter la même demande retrouve la recette,
changer la demande avec le même UUID est refusé. Une édition n'utilise pas cette
identité. Un trigger interne, non exécutable par les rôles applicatifs, incrémente
les révisions des autres recettes quand leur rayon partagé change.
Voir la [décision sur les conflits et reprises](decisions/0002-revisions-et-reprise-des-recettes.md).

Le serveur ne compense un upload que lorsque PostgreSQL confirme le rollback ; une
réponse de transport incertaine ne prouve pas que la transaction a échoué.
`replace_shopping_list` refuse une révision NULL ou périmée (`PLAN_CHANGED`), une
identité de liste inattendue (`LIST_CHANGED`) et une préparation vide. Le remplacement
est atomique. `set_shopping_item_checked` refuse un article d'une liste remplacée ;
un état coché explicite rend les appels répétés idempotents.

Ce contrat est intentionnel : l'absence d'écriture directe impose aux clients les
contrôles des RPC. Une évolution doit préserver ou remplacer explicitement ces
garanties, avec des tests d'accès anonyme, entre comptes et de concurrence.

## Photos et Realtime

`recipe-photos` est un bucket privé limité à 5 Mo, avec JPG, PNG et WebP. Les policies
Storage autorisent SELECT, INSERT et DELETE pour les chemins sous l'identifiant
du compte. Les actions vérifient aussi la signature des fichiers ; elles créent
un nouveau chemin plutôt que faire un upsert. Les URLs de lecture sont signées
pour une heure dans `getRecipes` et `getRecipe`. Les erreurs de signature globales
et par objet sont journalisées sans chemin, titre ou contenu privé.

La publication `supabase_realtime` contient `recipes`, `meal_selections`,
`shopping_lists`, `shopping_items` et `workspaces`. L'application s'abonne aux trois
dernières tables : les révisions couvrent les changements de recettes et de
sélections, y compris les suppressions. Voir [l'architecture](architecture.md#synchronisation-entre-appareils).

## Migrations et types

Les migrations s'appliquent dans l'ordre de leur nom : schéma initial, garde de
révision et index de références, publication de `workspaces`, puis contrat des
photos et révisions de recettes, puis corrections de maintenabilité. Cette dernière
migration retire les éléments NULL des étapes héritées, conserve leur ordre et
incrémente les révisions concernées avant l'utilisation des nouveaux décodeurs. Ne pas réécrire
une migration déjà appliquée. Créer une nouvelle migration avec
`supabase migration new <nom>`, après avoir vérifié le `--help` de la CLI installée.
Ce dépôt utilise des migrations impératives, sans `supabase/schemas/`.

Valider le SQL sur une base locale ou isolée et dans les tests PGlite. Avant de
l'appliquer à un environnement distant, identifier cet environnement, vérifier
l'historique et respecter le périmètre de la demande. Ne pas exécuter un SQL de
diagnostic qui modifie la production pour produire ensuite une migration.

`database.types.ts` est généré depuis le schéma. `database.ts` adapte les paramètres
RPC qui acceptent NULL sans que le générateur puisse le déduire et porte les
contrats RPC et colonnes ajoutés après le snapshot généré. Ces extensions sont vérifiées contre
les migrations par les tests de contrat ; ne pas modifier le snapshot à la main. Mettre à jour les
types avec le schéma et conserver ces adaptations dans ce fichier séparé. La
commande de génération est dans le [README](../README.md#architecture-et-accès-privés).

Les tests PGlite appliquent toutes les migrations SQL triées par nom. Leurs schémas
Auth et Storage sont des doublures minimales : ils vérifient les contrats SQL, mais
ne prouvent pas à eux seuls le fonctionnement des services Supabase hébergés.

## Transition vers cette version

Les migrations de cette PR remplacent la signature historique de `save_recipe` et
le résultat de `delete_recipe`. L'application de `main` avant cette PR n'est pas
compatible avec ces mutations une fois la première nouvelle migration appliquée.
Il faut donc coordonner le schéma et l'application, et ne pas simplement appliquer
le SQL pendant que l'ancienne version est utilisée.

1. Sur un environnement isolé, appliquer l'historique existant, préparer les
   éventuelles étapes NULL, appliquer les deux nouvelles migrations et vérifier
   les lectures/actions avec la version applicative de la PR.
2. Avant une livraison autorisée, sauvegarder la base, vérifier l'historique de
   migrations et prévoir une fenêtre sans mutations ni onglets actifs sur les
   deux appareils. Suspendre l'accès applicatif pendant la transition.
3. Appliquer les migrations nouvelles dans l'ordre, déployer la version
   applicative compatible, puis vérifier création, édition avec photo conservée,
   conflit, déconnexion et courses avant de rétablir l'accès.
4. En cas de retour applicatif, conserver une version compatible avec ces RPC.
   Un retour au `main` antérieur exige une migration de compatibilité préparée et
   testée ; ne pas réécrire les migrations appliquées ni restaurer arbitrairement
   les données pour contourner l'incompatibilité.

Aucune migration distante ni livraison n'est implicite dans les tests locaux.
