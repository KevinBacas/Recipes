---
name: recipes-docs-sync
description: "Synchroniser la documentation du dépôt Recipes avec le code après un changement de comportement, d'architecture, de configuration, de schéma ou de procédure, ou lors d'une demande de revue documentaire."
---

# Synchroniser la documentation de Recipes

Les liens sont relatifs au dossier du skill ; les chemins de la table sont
relatifs à la racine du dépôt. Lire les fichiers modifiés et leurs appels pour
établir le comportement final. Utiliser le diff Git lorsqu'il est disponible ;
sinon comparer avec les fichiers de départ connus dans la tâche.

## Identifier le document propriétaire

| Changement | Document à revoir |
| --- | --- |
| Fonction visible, limite produit, démarrage ou configuration | [README.md](../../../README.md) |
| Responsabilités, frontières serveur/client ou parcours des données | [docs/architecture.md](../../../docs/architecture.md) |
| Table, RLS, RPC, Storage, Realtime, migration ou types SQL | [docs/database.md](../../../docs/database.md) |
| Commande, dépendance de développement, vérification ou dépannage | [docs/development.md](../../../docs/development.md) |
| Convention durable ou déclenchement de skill | [AGENTS.md](../../../AGENTS.md) |
| Choix structurant avec alternatives et compromis durables | Un document dans `docs/decisions/` |

## Mettre à jour avec des preuves

1. Vérifier les affirmations dans le code, les migrations, les configurations et
   les tests concernés. Un test présent ne signifie pas qu'il a été exécuté.
2. Modifier le document propriétaire et les liens de navigation nécessaires.
   Préférer un lien à une seconde explication identique. Le README reste le point
   d'entrée d'un humain ; les skills décrivent comment travailler sur le projet.
3. Décrire le fonctionnement implémenté, ses limites et les prérequis réels.
   Signaler comme proposition ce qui n'est pas encore réalisé. Une configuration
   locale ne prouve pas la configuration ou le déploiement de la production.
4. Vérifier les chemins, noms d'API, variables et commandes contre les fichiers
   réels. Utiliser des valeurs fictives pour les secrets et les comptes.
5. Relire les liens relatifs et la cohérence entre les documents touchés.

Écrire en français, avec des noms de fichiers et symboles exacts. Expliquer les
décisions non évidentes sans recopier tout le schéma SQL ni tout le catalogue
des fonctions. Ne pas modifier les fichiers générés ou les skills officiels pour
adapter la documentation au projet.

Une correction visuelle sans changement de contrat peut ne nécessiter aucune
mise à jour documentaire ; le signaler simplement si une revue a été demandée.
Ne pas créer un journal pour chaque modification.

## Décisions et remise du travail

Pour un choix structurant, ajouter un fichier nommé `docs/decisions/NNNN-sujet.md`
en suivant les numéros existants. Expliquer le contexte, la décision, les raisons,
les alternatives utiles et les conséquences. Ne pas créer de fichier vide ou
d'ADR pour une simple correction.

Résumer les documents actualisés et les vérifications réellement faites. Pour
une tâche uniquement documentaire, vérifier les liens et les instructions ; ne
pas lancer les tests qui écrivent dans Supabase ou un déploiement pour valider
une reformulation.
