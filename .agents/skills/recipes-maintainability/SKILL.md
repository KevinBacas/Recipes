---
name: recipes-maintainability
description: "Guider les évolutions du code de Recipes pour préserver ses responsabilités, ses contrats métier et sa lisibilité humaine. À utiliser avant une modification applicative, une refactorisation ou l'ajout d'une dépendance dans ce dépôt."
---

# Maintenir Recipes

Lire [l'architecture](../../../docs/architecture.md) et les fichiers concernés.
Pour du SQL ou des accès aux données, lire aussi
[les contrats SQL](../../../docs/database.md). Les liens sont relatifs à ce dossier ;
les chemins applicatifs ci-dessous sont relatifs à la racine du dépôt.

## Choisir la responsabilité du changement

- `src/app/` : routes, composition serveur et orchestration des mutations.
- `src/components/` : interactions et présentation ; réutiliser les éléments de
  `ui.tsx` et les styles existants lorsqu'ils répondent au besoin.
- `src/lib/domain.ts` : types métier, validation et calculs indépendants de React
  et de Supabase. Préserver `decimal.js` pour les quantités.
- `src/lib/data.ts` et `src/lib/supabase/` : session, lectures, clients et types SQL.
- `supabase/migrations/` : contraintes, droits, transactions et concurrence.

Garder les exports existants s'ils suffisent. Extraire un module lorsqu'il clarifie
une responsabilité ou supprime une duplication réelle ; ne pas imposer de découpage
par fonctionnalité, de couche repository générique ou de taille maximale de fichier.
Un petit composant explicite peut être plus lisible qu'une API de composition élaborée.

## Préserver les contrats

- Valider les entrées côté serveur ; revérifier la session dans les mutations.
  L'authentification du layout ne remplace pas celle des actions.
- Garder les écritures métier dans les RPC transactionnelles. Les appels Storage
  restent côté serveur et contrôlent le propriétaire et le format du fichier.
- `authenticatedClient` utilise `React.cache` pour la requête en cours. Ne pas
  partager un client SSR, une session ou des données privées entre requêtes.
- Préserver les instantanés de courses, la confirmation du remplacement, les
  contrôles de révision et les références appartenant au même propriétaire.
- Pour les portions, conserver la file de sauvegarde ordonnée et attendre sa
  résolution avant la génération. Un rafraîchissement ne doit pas écraser une
  saisie locale en cours.
- Pour Realtime, préserver l'authentification du canal, son nettoyage et sa
  recréation après reconnexion. Les révisions de `workspaces` signalent aussi les
  suppressions sans dépendre d'événements DELETE filtrés.

## Garder le changement compréhensible

Choisir des noms qui expriment la responsabilité, des types précis aux frontières
et des erreurs utiles dans l'interface française. Limiter les assertions de types
aux frontières réellement non typées ; ne pas remplacer une validation par un cast.
Commenter le motif d'une contrainte non évidente, plutôt que paraphraser le code.
Réutiliser les dépendances présentes avant d'en ajouter une ; expliquer le besoin
concret d'une dépendance ou d'un changement d'architecture.

Appliquer seulement les recommandations React/Supabase pertinentes. Une consigne
de performance ne justifie pas à elle seule SWR, un cache global, un provider ou
une refactorisation sans rapport avec la demande.

## Terminer

Choisir les contrôles dans [le guide de développement](../../../docs/development.md).
Tester les comportements ou contrats à risque, sans tests qui reproduisent simplement
l'implémentation. Pour les changements documentables, utiliser `recipes-docs-sync`
et mettre à jour les documents avec le code. Dans le bilan, indiquer ce qui a changé,
pourquoi et ce qui a réellement été vérifié.
