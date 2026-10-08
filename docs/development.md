# Développer et maintenir Recipes

[Accueil du projet](../README.md) · [Architecture](architecture.md) · [Base de données](database.md)

## Environnement et conventions

Utiliser Node.js 22 ou supérieur et `npm ci` avec le lockfile. Le
[README](../README.md#démarrage-rapide) décrit les variables et le lancement.
Les scripts `dev` et `build` utilisent Webpack ; conserver ce choix tant qu'une
évolution ne justifie pas de changer le moteur et de vérifier l'environnement.

Les textes visibles et les documents du projet sont en français ; les symboles
TypeScript et SQL suivent les noms anglais existants. Garder les types métier
dans `domain.ts`, les fichiers serveur hors des imports client et les classes CSS
et composants UI existants quand ils répondent au besoin. Préférer des noms qui
expliquent le rôle et des commentaires qui expliquent une contrainte inhabituelle.

## Contrôles selon le changement

| Changement                                           | Vérification                                                                 |
| ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| Code applicatif, migration ou configuration du build | `npm run check` : lint, types, Vitest et build                               |
| Calcul ou autosave                                   | Tests ciblés pendant le travail, puis `npm run check`                        |
| Schéma, RLS ou RPC                                   | Tests SQL PGlite et contrôles de droits/concurrence concernés                |
| Interaction, Auth, Realtime ou Storage               | Playwright sur un compte isolé, en complément des contrôles locaux           |
| Documentation ou skills seulement                    | Frontmatter des skills locaux, liens, chemins et exactitude des instructions |

Les commandes des tests ciblés utilisent les fichiers réels, par exemple :

```sh
npm test -- tests/domain.test.ts tests/portion-autosave.test.ts
npm test -- tests/database.test.ts
```

Les tests ciblés du classement sont `npm test -- tests/ingredient-classification.test.ts tests/ingredient-classification-route.test.ts`.
Le premier simule le modèle pour contrôler les critères de choix, les réponses
invalides, le délai et l’absence de clé, sans appeler AI Gateway. Le second vérifie
la validation, la session, la lecture limitée au catalogue du compte et les réponses
de la route. Pour une vérification manuelle, `AI_GATEWAY_API_KEY` est facultative et
reste côté serveur ; ne pas consigner les noms d’ingrédients ni la clé dans les logs.
Ces tests ne prouvent pas un appel réel au modèle ni la configuration de la production.

Les E2E nécessitent un build et un compte Supabase de test, dont les données sont
supprimées par les scénarios. Leur configuration et leurs commandes sont dans le
[README](../README.md#vérifications). Ne jamais utiliser le compte du foyer.
Le projet Playwright `chrome` utilise une fenêtre desktop ; `safari-mobile` utilise
WebKit et un profil iPhone. `E2E_BASE_URL` permet de choisir une URL distante sans
démarrer le serveur local. Vérifier la cible avant un test qui écrit des données.

Un résultat local réussi ne prouve ni une migration distante ni un déploiement.
Dans le bilan, préciser les contrôles exécutés et les limites de l'environnement.

## Formatage et concurrence PostgreSQL

`npm run format` et `npm run format:check` utilisent la version de Prettier du
lockfile. `npm run check` inclut le contrôle de formatage. Les skills copiés, le
snapshot des types générés et les migrations sont exclus du formatage automatique.
Les nouvelles migrations sont mises en forme à la main ; les migrations appliquées
restent immuables. Séparer une remise en forme mécanique des changements de logique.

`npm run test:postgres` démarre un conteneur PostgreSQL 17 temporaire si Docker est
disponible, puis le retire, même en cas d'échec. Il ne monte aucun volume de données.
Pour utiliser un autre PostgreSQL **local isolé**, créer une base vide dédiée et
fournir `TEST_POSTGRES_URL`, par exemple :

```sh
TEST_POSTGRES_URL=postgresql://postgres:mot-de-passe-local@127.0.0.1:55439/recipes_test_review npm run test:postgres
```

Le script refuse les hôtes distants et les noms qui ne commencent pas par
`recipes_test_`. La suite refuse une base contenant déjà des tables métier. Les
rôles Auth et Storage sont des doublures minimales ; les tests observent un blocage
réel dans `pg_stat_activity`, puis vérifient la révision, la reprise d'une création
et l'instantané complet après déblocage. Cette suite distincte n'est pas lancée
par `npm run check`, afin de ne pas imposer Docker pour chaque modification.
Elle doit être exécutée pour une modification des verrous ou des RPC concernées.

Les tests d'actions de contrat relient le payload sérialisé du formulaire aux
migrations PGlite et à un Storage simulé. Les tests de lectures passent les vraies
réponses SQL dans les schémas Zod ; les valeurs invalides doivent être rejetées,
et seules les absences prévues par le contrat sont acceptées. Une erreur de service
ne doit pas être transformée silencieusement en liste vide.

## Travail avec les agents

Le [workflow des agents](agent-workflow.md) décrit le cadrage par Sol, la
délégation à Luna ou Sol et la revue indépendante par Astra selon le changement.
[AGENTS.md](../AGENTS.md) en fixe les déclencheurs ; `.codex/` contient les modèles
et les rôles du dépôt. Consulter le guide pour l'activation dans le client,
les missions, les replis et les critères de livraison.

## Skills du bundle 2

Les six skills sont stockés en fichiers réels dans `.agents/skills/`, pour être
partageables avec le dépôt. [AGENTS.md](../AGENTS.md) décrit leurs déclencheurs.
`recipes-maintainability` guide les évolutions de code ; `recipes-docs-sync` relie
chaque changement aux documents dont il faut vérifier l'actualité.

Les quatre skills officiels sont copiés sans modification depuis Vercel et Supabase.
Le [manifeste des sources](../.agents/skill-sources.json) conserve les commits,
chemins et empreintes des copies installées. C'est un manifeste propre à ce dépôt,
pas un lockfile du CLI `skills`. Les deux skills Recipes sont maintenus ici.
La licence Supabase est conservée dans `.agents/licenses/`. Les skills Vercel
conservent leur déclaration de licence MIT dans leurs fichiers amont ; leur dépôt
source ne fournit pas de fichier de licence racine à ce commit.

`.gitattributes` laisse les espaces Markdown et les lignes finales des copies
officielles inchangés lors des contrôles Git. Le fichier de types Supabase généré
conserve également sa ligne finale vide ; les autres fichiers restent soumis aux
contrôles habituels de whitespace.

Si un plugin fournit déjà un de ces skills, suivre une seule copie pour la tâche,
en privilégiant celle du dépôt. Garder les adaptations propres à Recipes dans
AGENTS.md et les skills locaux, afin de pouvoir comparer les copies officielles
à leurs versions amont.

Pour une mise à jour, lire les changements du dépôt officiel, choisir un commit
précis et installer la nouvelle copie dans un dossier temporaire. Comparer le
contenu avant de remplacer la copie du dépôt, puis actualiser le manifeste et
vérifier les références. Ne pas utiliser une mise à jour globale qui modifierait
les skills d'autres projets.

## Documentation et dépannage

Mettre à jour le document propriétaire avec le code, en suivant
`recipes-docs-sync`. Pour un choix structurant, conserver son motif et ses
compromis dans `docs/decisions/` ; les corrections ordinaires n'exigent pas d'ADR.

En cas de problème de configuration, vérifier les noms de variables de
`.env.example` sans afficher les secrets. Pour Supabase, conserver le code d'erreur
et consulter la documentation actuelle avant de modifier un contrat SQL ou une
policy. En cas de partage interrompu, inspecter l'état du canal et la publication
de `workspaces` ; le symptôme ne justifie pas un élargissement des droits.
Les paramètres et callbacks Next.js se vérifient dans la documentation embarquée
`node_modules/next/dist/docs/`, correspondant à la version installée.
