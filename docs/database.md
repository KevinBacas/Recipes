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
`get_preparation` et `get_shopping_list` sont `SECURITY INVOKER` et respectent
RLS. `get_recipe` cible un identifiant ; `get_recipe_summaries` ne renvoie que
les données utiles au choix des plats.

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
(`keep`, `replace` ou `remove`) ; il retourne le chemin remplacé dans le même
résultat transactionnel. `delete_recipe` retourne le chemin de la photo supprimée.
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
pour une heure dans `getRecipes`.

La publication `supabase_realtime` contient `recipes`, `meal_selections`,
`shopping_lists`, `shopping_items` et `workspaces`. L'application s'abonne aux trois
dernières tables : les révisions couvrent les changements de recettes et de
sélections, y compris les suppressions. Voir [l'architecture](architecture.md#synchronisation-entre-appareils).

## Migrations et types

Les migrations s'appliquent dans l'ordre de leur nom : schéma initial, garde de
révision et index de références, publication de `workspaces`, puis contrat des
photos et révisions de recettes. Ne pas réécrire
une migration déjà appliquée. Créer une nouvelle migration avec
`supabase migration new <nom>`, après avoir vérifié le `--help` de la CLI installée.
Ce dépôt utilise des migrations impératives, sans `supabase/schemas/`.

Valider le SQL sur une base locale ou isolée et dans les tests PGlite. Avant de
l'appliquer à un environnement distant, identifier cet environnement, vérifier
l'historique et respecter le périmètre de la demande. Ne pas exécuter un SQL de
diagnostic qui modifie la production pour produire ensuite une migration.

`database.types.ts` est généré depuis le schéma. `database.ts` adapte les paramètres
RPC qui acceptent NULL sans que le générateur puisse le déduire. Mettre à jour les
types avec le schéma et conserver ces adaptations dans ce fichier séparé. La
commande de génération est dans le [README](../README.md#architecture-et-accès-privés).

Les tests PGlite appliquent toutes les migrations SQL triées par nom. Leurs schémas
Auth et Storage sont des doublures minimales : ils vérifient les contrats SQL, mais
ne prouvent pas à eux seuls le fonctionnement des services Supabase hébergés.
