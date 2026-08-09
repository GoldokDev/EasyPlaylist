# Processus de développement

## Objectif

Permettre à un agent de prendre un item, de le livrer, de le tester et de synchroniser la documentation avec un minimum d'interruptions, tout en conservant un environnement Docker démontrable.

## États du backlog

- `TODO` : défini mais dépendances non terminées ou priorité non ouverte.
- `READY` : critères compris, dépendances terminées, item prenable.
- `IN_PROGRESS` : travail actif ; un seul item à la fois.
- `VERIFY` : implémentation présente mais au moins une preuve manque.
- `DONE` : tous les critères sont démontrés.
- `BLOCKED` : obstacle externe explicite ; noter cause et condition de reprise.

## Definition of Ready

Un item peut passer à `READY` lorsque :

- son résultat utilisateur ou technique est formulé ;
- ses dépendances sont `DONE` ;
- ses critères d'acceptation sont observables ;
- son périmètre tient dans une tranche cohérente ;
- les décisions nécessaires sont acceptées ou peuvent être prises de façon locale et réversible ;
- les comptes, clés ou validations externes nécessaires sont disponibles, ou un fake suffit explicitement au périmètre.

## Cycle d'un item

1. Sélectionner l'item `READY` de priorité la plus haute et le passer à `IN_PROGRESS`.
2. Lire ses documents liés et les décisions existantes.
3. Vérifier le working tree et préserver les modifications non liées.
4. Relier chaque critère à une tâche et une preuve attendue.
5. Implémenter la plus petite tranche verticale satisfaisant l'item.
6. Ajouter ou mettre à jour les tests en même temps que le comportement.
7. Appliquer `$validate-web-delivery` au périmètre touché.
8. Corriger les échecs dans le périmètre et relancer les preuves.
9. Examiner réellement les captures et les logs produits.
10. Mettre à jour spécifications, décisions, backlog et journal de validation.
11. Passer à `DONE`, ou `VERIFY` si une preuve manque. Créer des items séparés pour les découvertes indépendantes.

## Règle d'autonomie

L'agent décide seul pour un choix local, réversible, compatible avec les décisions acceptées, sans coût récurrent ni effet significatif sur la sécurité ou le produit.

Demander une décision utilisateur avant de :

- changer le contrat de lecture ou la façon dont un compte participant est utilisé ;
- ajouter ou retirer un fournisseur du MVP ;
- introduire un service payant, une dépendance structurante ou un nouvel opérateur de données ;
- rendre les lobbies persistants ou les comptes permanents ;
- modifier la durée de conservation ou la politique de consentement ;
- étendre nettement le MVP ;
- supprimer ou migrer des données importantes ;
- publier, déployer, acheter ou contacter un tiers.

En cas d'ambiguïté mineure, choisir l'option la plus simple à tester et la consigner si elle devient durable.

## Definition of Done

Un item est `DONE` seulement si :

- chaque critère d'acceptation possède une preuve ;
- les tests ciblés et la suite rapide passent ;
- lint, types et build passent pour les packages touchés ;
- les images concernées se construisent et les services démarrent avec leurs healthchecks ;
- les migrations concernées sont vérifiées sur la trajectoire annoncée ;
- les flux API/temps réel affectés sont exercés en succès et en échec ;
- l'interface affectée est parcourue dans un vrai navigateur et toute capture requise est inspectée ;
- aucun secret ou donnée personnelle ne fuit dans le client, les logs ou les fixtures ;
- la documentation décrit le comportement réel ;
- aucune dette nécessaire au critère n'est cachée dans un `TODO` ;
- backlog et journal de validation sont à jour.

## Validation par niveau

### Domaine ou contrat

Tests unitaires ciblés, cas limites, validation des schémas et compatibilité de sérialisation.

### API, base ou temps réel

Tests d'intégration sur PostgreSQL isolé, autorisations, idempotence, reconnexion, erreurs et logs.

### Fournisseur

Tests de contrat avec fake, puis test réel séparé avec compte autorisé. Documenter provider, environnement, scopes et date. Un fake ne valide pas le réel.

### UI

Tests de composant utiles, parcours navigateur, tailles mobile et desktop pertinentes, accessibilité de base, sortie console et capture examinée.

### Jalon MVP

Parcours Docker depuis une base vierge, au moins trois navigateurs, perte/reprise du lecteur, panne partielle de fournisseur et fermeture/purge du lobby.

## Bugs découverts

- Corriger immédiatement un bug qui bloque les critères de l'item.
- Créer un item séparé pour une anomalie indépendante.
- Classer `P0` toute fuite de secret, corruption de file, accès inter-lobby, perte de contrôle du lecteur ou impossibilité de fermer/purger.
- Ajouter un test de régression avant de déclarer le bug corrigé.

## Validation utilisateur

Demander un retour aux jalons suivants :

1. contrat produit et choix des deux fournisseurs ;
2. première file collaborative complète avec fournisseur fake ;
3. première lecture réelle sur un fournisseur ;
4. candidat MVP avec deux fournisseurs.

Chaque remise indique comment lancer, quel parcours essayer, quelles limites restent imposées par les fournisseurs et quelles décisions méritent un retour.
