# 0001 — Mutations métier transactionnelles via RPC

Statut : choix existant, décrit à partir du code et des migrations.

## Contexte

Deux appareils modifient la préparation et les courses d'un même compte. La
génération doit produire un instantané cohérent et refuser le remplacement d'une
liste qui a changé entre sa lecture et sa sauvegarde. Les comptes distincts doivent
rester isolés même lorsqu'un client appelle directement l'API Supabase.

## Décision

Les lectures utilisent les Server Components et les droits RLS. Les Server Actions
valident les entrées et appellent six RPC transactionnelles de mutation. Les rôles
clients n'ont pas d'écriture directe sur les tables métier.

Les RPC privilégiées ont un `search_path` vide, des contrôles explicites de session
et de propriétaire, et des droits EXECUTE limités. Un verrou de ligne par compte
sérialise les mutations ; la génération vérifie la révision de préparation et
l'identité de la liste active. Voir les [contrats SQL](../database.md).

## Raisons et alternatives

Des écritures directes sur les tables avec RLS pourraient assurer l'isolation des
lignes, mais ne suffiraient pas à imposer la transaction complète de remplacement
et ses contrôles de concurrence. Une succession d'appels SQL dans une action
serveur sans transaction ne garantirait pas non plus l'atomicité.

Les RPC regroupent ces garanties au niveau de la base. Une API SQL reposant sur un
autre mode transactionnel serait possible, mais ajouterait ici une autre connexion
et un contrat de permissions à maintenir.

## Conséquences

Les changements de contrat demandent une migration, des types à jour et des tests
SQL d'isolation et de concurrence. Les fonctions `SECURITY DEFINER` exigent une
revue explicite des contrôles et privilèges ; leur usage ne doit pas être étendu
pour contourner une erreur de permissions. Les avis Supabase concernant leur
exécution par `authenticated` doivent être interprétés à la lumière de ce contrat,
pas ignorés ni corrigés automatiquement en ouvrant l'écriture des tables.
