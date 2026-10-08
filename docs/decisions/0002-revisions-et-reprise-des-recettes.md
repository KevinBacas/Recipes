# 0002 — Révisions et reprise des créations de recettes

Statut : accepté pour la version de cette PR.

## Contexte

Deux appareils partagent le même compte. Realtime provoque des relectures serveur,
mais `router.refresh()` conserve le brouillon React. Une sauvegarde envoie la
recette entière ; une dernière écriture silencieuse peut donc perdre la saisie
d'un autre appareil. Le rayon appartient au catalogue d'ingrédients partagé, et
sa modification change aussi les autres recettes qui utilisent cet ingrédient.
Une réponse réseau perdue ne permet pas de savoir si une transaction a commité.

## Décision

Une édition porte la révision lue avec la recette. La RPC compare cette révision
sous le verrou du compte et refuse une version périmée. Modifier un rayon partagé
incrémente aussi les révisions des recettes concernées. Un formulaire intact
adopte la version distante ; un brouillon modifié reste visible et propose de
reprendre explicitement la dernière version. Cette reprise abandonne la saisie
locale. Le renouvellement d'une URL signée de photo n'est pas une édition métier.

Chaque nouveau formulaire possède une identité de création stable, réutilisée
lors d'une nouvelle tentative. La première transaction utilise cet UUID comme
identifiant de recette et conserve une empreinte de la demande. Une répétition
identique retourne le résultat enregistré sans modifier la recette ; une demande
différente avec la même identité est refusée. L'empreinte inclut les champs métier,
l'intention photo et le SHA-256 du fichier, mais pas son chemin d'upload aléatoire.
L'empreinte SQL sert à comparer les demandes, pas à autoriser leur exécution.

Après une réponse perdue, le serveur tente une lecture authentifiée de cette
identité. Si la recette est retrouvée, l'action retourne un succès. Sinon le
résultat reste explicitement indéterminé ; l'utilisateur peut réessayer la même
demande ou recharger le carnet. Une édition incertaine doit être relue avant une
nouvelle sauvegarde. L'identité n'est conservée que pendant la vie du formulaire :
après rechargement, rechercher d'abord une création incertaine dans le carnet.

Le résultat SQL distingue la photo finale du chemin détaché. `keep` retourne un
chemin détaché NULL. Le serveur ne supprime jamais le chemin final ; un upload
supplémentaire d'une répétition confirmée est nettoyé séparément. Les chemins sont
créés aléatoirement et ne sont pas réutilisés par l'application. Un rollback SQL
confirmé autorise le nettoyage de l'upload ; un résultat indéterminé conserve
l'objet. Le nettoyage et la revalidation ne changent pas le succès métier.

## Alternatives et conséquences

La dernière écriture gagnante est simple, mais perd des données. Une fusion par
champ demanderait des règles pour l'ordre des ingrédients, les étapes et les
photos ; elle dépasse le besoin actuel. Le choix retenu privilégie un refus
explicable et une reprise explicite, au prix d'une saisie à reprendre en cas de
conflit. Il ne constitue pas un éditeur collaboratif ni une file hors ligne.

La conservation prudente d'un upload après une panne peut laisser un objet
orphelin si l'utilisateur abandonne la tentative. Aucun nettoyage automatique
fondé sur une réponse réseau incertaine n'est autorisé. La reprise d'une création
supprimée n'a pas de tombstone durable : une tentative réutilisée après suppression
pourrait la recréer. Le formulaire normal quitte l'écran après un succès ; pour
un historique durable des tentatives, il faudrait un journal dédié.

Les contrats sont validés par des tests formulaire/action/SQL et par des tests de
verrou avec plusieurs connexions PostgreSQL. Les E2E hébergés restent distincts :
ils nécessitent un compte Supabase isolé.
