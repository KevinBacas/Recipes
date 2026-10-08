# Travailler sur Recipes / À table

Application privée en français, pensée pour deux téléphones utilisant un compte
commun. Lire le [README](README.md) et la documentation du domaine concerné avant
de modifier son comportement.

## Stratégie d'agents

Pour chaque demande, l'agent principal applique le
[workflow du dépôt](docs/agent-workflow.md) dans le périmètre demandé par
l'utilisateur. Une question ou une demande de spécification seule ne déclenche
pas d'implémentation. Une instruction explicite de l'utilisateur prévaut sur ce
workflow.

- L'agent principal, GPT-6.1 Sol par défaut, cadre la demande, pose les questions
  nécessaires, définit les critères d'acceptation et reste responsable de
  l'intégration et de la livraison.
- Pour les tâches de développement délimitées, déléguer explicitement à
  `implementer_luna` ; utiliser `implementer_sol` pour les tâches complexes ou
  sensibles (Auth, droits, SQL, concurrence, Realtime, Storage).
- Les petites corrections de texte, documentation ou présentation peuvent être
  traitées directement. Toute fonctionnalité, correction de logique ou évolution
  sensible, ainsi que toute modification de cette stratégie ou de sa
  configuration, reçoit une revue indépendante par `reviewer_astra`.
- Avant de déléguer, fournir le besoin, les contrats, les critères d'acceptation,
  les fichiers attribués et les contrôles attendus. Limiter à deux sous-agents
  simultanés et à un rédacteur par fichier ; stabiliser les contrats avant de
  paralléliser les implémentations.
- Attendre les contributions, intégrer, exécuter les contrôles adaptés puis
  demander la revue. Après collecte des résultats, fermer les threads devenus
  inutiles avant de lancer un autre rôle : le plafond compte les threads ouverts,
  même terminés. Corriger les défauts retenus, justifier ceux écartés et faire
  revoir les corrections importantes avant de livrer.
- Les sous-agents suivent leur mission et les consignes du dépôt, sans lancer
  ce workflow à nouveau ni créer d'autres sous-agents. L'agent principal prend
  en charge les questions à l'utilisateur et les opérations Git.
- Si un modèle, un rôle ou la délégation n'est pas disponible, signaler la limite
  et appliquer le repli décrit dans le guide ; ne pas présenter une auto-revue
  comme une revue indépendante Astra.

## Skills du dépôt

Les skills sont dans `.agents/skills/`. Lire leur `SKILL.md` quand le déclencheur
ci-dessous s'applique, puis seulement les références utiles à la tâche.

| Changement | Skill à utiliser |
| --- | --- |
| Code applicatif, refactorisation ou dépendance | `recipes-maintainability`, avant de modifier le code |
| Composant React, page Next.js, chargement des données | `vercel-react-best-practices` |
| API de composant, variantes ou partage d'état à revoir | `vercel-composition-patterns` |
| Intégration, Auth, Storage ou Realtime Supabase | `supabase` |
| SQL, schéma, migration, droits ou diagnostic PostgreSQL | `supabase` et `supabase-postgres-best-practices` |
| Comportement, architecture, configuration, schéma ou procédure modifiés | `recipes-docs-sync`, avant de terminer |

Si un plugin fournit le même skill, utiliser une seule copie, de préférence celle
du dépôt pour rendre les consignes reproductibles. Les noms de skills ne sont pas
une invitation à charger toute leur documentation.

## Conventions essentielles

- Garder les responsabilités décrites dans [l'architecture](docs/architecture.md).
  Les Server Components lisent les données ; les Server Actions valident les
  entrées et appellent les RPC transactionnelles ; la logique de calcul reste pure.
- Les [contrats SQL](docs/database.md) font partie du comportement du produit.
  Ne pas remplacer les RPC par des écritures navigateur ou des droits directs
  sur les tables pour contourner un problème de permissions.
- Adapter les recommandations générales au projet : privilégier la lisibilité,
  les conventions et les frontières de sécurité avant une micro-optimisation.
  Ne pas introduire de cache partagé pour les données privées ni de bibliothèque
  de données sans besoin établi.
- Garder les migrations existantes immuables et ajouter une migration pour toute
  évolution du schéma. Expérimenter sur une base locale ou isolée, jamais sur la
  production par défaut. Le skill Supabase ne change pas cette règle.
- Les six RPC de mutation `SECURITY DEFINER` sont un choix documenté et testé :
  préserver leurs contrôles explicites, leurs droits limités et leur `search_path`
  vide. Une recommandation générique ne justifie pas de supprimer ce contrat.
- Préserver le périmètre produit du README ; une évolution demandée peut le
  modifier, et doit alors être documentée.

## Vérification et documentation

Suivre [le guide de développement](docs/development.md) pour choisir les contrôles.
Pour du code applicatif ou des migrations, lancer `npm run check` avant de livrer ;
compléter avec Playwright quand le parcours navigateur est concerné et qu'un compte
de test isolé est disponible. Décrire tout contrôle qui n'a pas pu être exécuté.
Une modification uniquement documentaire ne nécessite pas les tests navigateur
ou un nouveau build.

Mettre à jour les documents concernés avec le code, sans recopier les mêmes règles
dans plusieurs fichiers. Ajouter une décision d'architecture seulement pour un
choix durable dont le motif et les compromis seront utiles à un humain.

<!-- BEGIN:nextjs-agent-rules -->

## Documentation Next.js de la version installée

Avant d'écrire du code Next.js, lire le guide pertinent dans
`node_modules/next/dist/docs/`, résolu depuis la racine du projet. Cette copie
correspond à la version installée ; vérifier les changements d'API et les avis de
dépréciation. `next dev` peut actualiser ce bloc géré sans modifier les règles du
projet placées au-dessus.

<!-- END:nextjs-agent-rules -->
