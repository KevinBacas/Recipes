# Workflow des agents Recipes

[Accueil](../README.md) · [Consignes](../AGENTS.md) · [Développement](development.md)

## Périmètre et activation

Ce workflow organise les demandes dans le dépôt, en proportionnant le travail
à leur taille et à leur risque. L'agent principal conserve le contexte produit,
dialogue avec l'utilisateur et reste responsable du résultat. Les sous-agents
reçoivent des missions bornées ; ils ne relancent pas le workflow.

Les règles de déclenchement sont dans [AGENTS.md](../AGENTS.md). Les modèles et
le plafond de deux sous-agents simultanés sont configurés dans
[.codex/config.toml](../.codex/config.toml). Les trois rôles sont définis dans
[.codex/agents/](../.codex/agents/) :

| Rôle               | Modèle      | Raisonnement | Mission                                                                 |
| ------------------ | ----------- | ------------ | ----------------------------------------------------------------------- |
| Agent principal    | GPT-6.1 Sol | `medium`     | Cadrage, spécification, questions, intégration, validation et livraison |
| `implementer_luna` | GPT-6 Luna  | `high`       | Implémentation délimitée avec contrats établis                          |
| `implementer_sol`  | GPT-6.1 Sol | `high`       | Implémentation complexe ou sensible                                     |
| `reviewer_astra`   | GPT-6 Astra | `high`       | Revue indépendante, configurée en lecture seule                         |

Utiliser un client Codex local compatible, avec les modèles accessibles au compte
et la délégation activée. La configuration du projet nécessite que Codex lui
accorde sa confiance ; les paramètres explicites du client peuvent la remplacer.
Elle ne change pas le modèle d'un chat déjà ouvert. Après installation ou
modification, ouvrir un nouveau chat dans ce dépôt ; choisir GPT-6.1 Sol dans
l'application si le client conserve une sélection différente.

Ces fichiers guident l'agent ; ils ne constituent pas un pipeline qui impose
techniquement chaque étape. Aucun script d'orchestration ni déclencheur CI n'est
installé. Les permissions effectives restent celles imposées par le client et
l'environnement ; une instruction de rôle n'accorde pas de nouveaux accès.

## Choisir le circuit

| Demande                                                                              | Cadrage et implémentation                                                                      | Revue                                            |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Question, diagnostic sans modification ou spécification seule                        | Répondre dans le périmètre demandé ; exploration déléguée seulement si utile                   | Selon la demande                                 |
| Petite correction de texte, documentation ou présentation sans changement de logique | Plan bref ; agent principal ou Luna                                                            | Vérification proportionnée par l'agent principal |
| Fonctionnalité délimitée ou correction de logique                                    | Critères explicites par Sol ; tâche attribuée à Luna si les contrats sont établis              | Astra après intégration                          |
| Fonctionnalité transverse, bug difficile ou changement sensible                      | Diagnostic et contrats par Sol ; Sol implémente le cœur, Luna peut traiter les parties simples | Astra ; revue de conception en amont si utile    |
| Évolution du workflow ou de la configuration d'agents                                | Vérification des instructions et du format de configuration                                    | Astra                                            |

La sensibilité prime sur le nombre de lignes : les accès privés, Auth, RLS, RPC,
les migrations, les verrous, Realtime et Storage passent par Sol. Une petite
correction CSS devient une modification de comportement si elle change une
interaction ou son accessibilité. En cas de doute, retenir le circuit supérieur.

## 1. Cadrer et spécifier

Lire le README, la documentation du domaine, le code concerné et les skills requis.
Établir les critères d'acceptation et les scénarios d'échec avant de répartir le
travail. Poser une question si la réponse change le comportement, la sécurité ou
le périmètre ; continuer les travaux indépendants pendant l'attente. L'absence de
réponse ne valide pas une décision bloquante. Résoudre les choix techniques
ordinaires avec les conventions du dépôt sans demander une validation systématique.

Pour une petite correction, un plan dans le chat suffit. Pour une évolution
importante, créer ou actualiser `docs/specs/<sujet>.md`, avec :

- besoin, comportement attendu et périmètre exclu ;
- critères d'acceptation observables et cas limites ;
- contrats et invariants, fichiers ou domaines concernés ;
- éventuelle migration, effets entre appareils et scénarios d'échec ;
- tâches, dépendances, rôles attribués et contrôles attendus ;
- questions ouvertes et hypothèses à confirmer.

La spécification décrit un objectif, pas une preuve d'implémentation. L'actualiser
si une décision change pendant le développement. Une demande de spécification
seule s'arrête à ce livrable.

## 2. Déléguer et implémenter

Employer le rôle nommé lorsqu'il est disponible. Chaque mission contient :

- le besoin ou le chemin de la spécification et les critères à couvrir ;
- les contrats établis et les dépendances déjà prêtes ;
- les fichiers attribués et les fichiers partagés réservés à un autre agent ;
- les contrôles ciblés et le format du compte rendu attendu.

Stabiliser les interfaces partagées avant de lancer les tâches dépendantes.
Limiter à deux sous-agents simultanés ; leurs écritures ne doivent pas se
chevaucher, y compris avec celles de l'agent principal. Un fichier supplémentaire
nécessite une réattribution par ce dernier. Sérialiser les tâches couplées et
réserver les opérations Git à l'agent principal. Ne pas créer un worktree par
défaut ; suivre les consignes de la session si une isolation est nécessaire.

Luna rend compte des ambiguïtés et transfère à Sol les tâches devenues complexes
ou sensibles. L'agent principal lui demande alors un état des modifications et
des contrôles, attend son arrêt et ferme son thread devenu inutile avant de
transmettre la tâche à Sol. Aucun sous-agent ne crée à son tour des agents ni
ne contacte directement l'utilisateur.

Le compte rendu précise les fichiers modifiés, les critères couverts, les
contrôles exécutés avec leurs résultats et les limites restantes. Une commande
non exécutée ou un test présent dans le dépôt ne constitue pas une validation.

Le plafond de configuration compte les threads ouverts, même lorsque leur
travail est terminé. Après collecte du compte rendu et des informations utiles
à une reprise, fermer les threads devenus inutiles avec le mécanisme du client
avant toute nouvelle délégation. Si le client ne propose pas de fermeture,
réserver un emplacement pour Astra en utilisant un seul thread d'implémentation
et réutiliser les threads du même rôle lorsque possible. Si aucun emplacement
ne peut être libéré pour le rôle requis, signaler cette limite ; ne pas omettre
silencieusement la revue.

## 3. Intégrer et vérifier

L'agent principal attend les contributions nécessaires, examine le diff complet,
vérifie les contrats entre contributions et synchronise les documents propriétaires
avec `recipes-docs-sync`. Il exécute les contrôles du
[guide de développement](development.md#contrôles-selon-le-changement) : notamment
`npm run check` pour le code applicatif ou les migrations, les tests PostgreSQL
pour les verrous/RPC concernés et Playwright lorsque requis et possible sur un
compte isolé. Les contrôles ciblés d'un sous-agent ne remplacent pas ce bilan global.

Pour la documentation et la configuration d'agents seules, vérifier les liens,
le formatage, la syntaxe TOML et la conformité aux options documentées ; aucun
build ni test sur Supabase n'est nécessaire. Le chargement réel des rôles dans le
client est une vérification distincte, à signaler s'il n'a pas été observé.

## 4. Faire revoir et corriger

Après intégration et validation, transmettre à Astra la demande, les critères,
la spécification éventuelle, la base de comparaison et les fichiers concernés,
les résultats des contrôles et les limites connues. Lui donner accès au code
environnant, sans limiter sa lecture au résumé de l'implémenteur.

Avant son lancement, vérifier qu'un emplacement est disponible et fermer les
threads d'implémentation devenus inutiles. Après la revue, conserver son compte
rendu avant de fermer le thread, ou le réutiliser pour revoir les corrections.

Le reviewer reste indépendant et ne modifie ni fichiers ni services externes.
Son compte rendu donne les défauts par gravité (P0 critique, P1 majeur, P2 modéré,
P3 mineur), leur localisation, un scénario concret et leur impact. Il précise
les critères non vérifiés, même si aucun défaut n'est identifié.

L'agent principal corrige ou fait corriger les défauts retenus et justifie les
remarques écartées avec des preuves. Un défaut retenu reste ouvert tant qu'il
n'est pas corrigé ou explicitement accepté par l'utilisateur. Relancer les
contrôles affectés et faire revoir les corrections importantes ; une modification
du code applicatif après validation exige de nouveau `npm run check`.

Consigner la revue dans le chat. Pour une évolution importante ou à la demande
de l'utilisateur, conserver un bilan dans `docs/reviews/<date>-<sujet>.md`, avec
le périmètre exact, l'état final des défauts et les validations réellement faites.
Ne pas créer un journal pour chaque petite modification.

## 5. Livrer et gérer les limites

Le bilan final précise le résultat, les contrôles, la revue réellement effectuée
et les limites restantes. Le workflow ne vaut pas autorisation de commit, push,
déploiement ou migration distante ; suivre les instructions de l'utilisateur
et les règles de la session pour ces opérations.

Si les rôles personnalisés ne sont pas exposés mais que la délégation est
disponible, lancer un sous-agent avec le modèle, le raisonnement et les
instructions du fichier de rôle transmis explicitement. Pour le reviewer,
transmettre également la contrainte de lecture seule ; indiquer si elle est
seulement une instruction et n'est pas imposée par le client.

Si Luna est indisponible, l'agent principal ou un sous-agent Sol peut reprendre
son périmètre. Si Sol est indisponible, signaler la limite et privilégier Astra
s'il est accessible pour les tâches complexes ou sensibles. Si la délégation
ou Astra est indisponible, continuer les travaux autorisés et les contrôles
possibles, puis signaler que la revue indépendante Astra reste à effectuer.
Ne pas la remplacer silencieusement par une auto-revue et ne pas déclarer le
workflow complet. Respecter toute demande explicite d'attendre un modèle précis.

## Références Codex

Les fichiers suivent la documentation officielle consultée le 8 octobre 2026 :
[AGENTS.md](https://learn.chatgpt.com/docs/agent-configuration/agents-md),
[sous-agents et agents personnalisés](https://learn.chatgpt.com/docs/agent-configuration/subagents),
[configuration du projet](https://learn.chatgpt.com/docs/config-file/config-basic)
et [référence de configuration](https://learn.chatgpt.com/docs/config-file/config-reference).
Vérifier ces sources avant de modifier le format ou les options de configuration.
