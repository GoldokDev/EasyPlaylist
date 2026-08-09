# Documentation du projet

Ce dossier contient les sources canoniques d'EasyPlaylist. Les notes historiques d'EasyParty ne sont pas copiées ici : les besoins retenus sont reformulés et traçables.

## Parcours de lecture

### Produit

- [Vision](product/vision.md) — problème, promesse et piliers.
- [MVP](product/mvp.md) — parcours cible, périmètre et critères de succès.
- [Décisions du cadrage](product/open-questions.md) — réponses aux questions structurantes et hypothèses réversibles.

### Technique

- [Architecture proposée](architecture/technical-design.md) — services, données, sécurité et règles de dépendance.
- [Déploiement VPS](architecture/deployment.md) — coexistence derrière Caddy, secrets, vérifications et retour arrière.
- [Modèle de fournisseurs](architecture/provider-model.md) — contrat de capacités et isolation des connecteurs.
- [Faisabilité des fournisseurs](architecture/provider-feasibility.md) — matrice officielle datée, contraintes de lecture et verdicts.

### Pilotage

- [Backlog](project/backlog.md) — ordre d'exécution et critères d'acceptation.
- [Processus de développement](project/development-process.md) — cycle d'un item et définition de terminé.
- [Journal de décisions](project/decision-log.md) — arbitrages produit et techniques.
- [Journal de validation](project/validation-log.md) — commandes, parcours et preuves.

## Hiérarchie

Une décision `ACCEPTED` peut préciser ou remplacer un document. Elle ne doit jamais être supprimée : une nouvelle entrée la marque `SUPERSEDED`. Le produit et l'architecture doivent ensuite être remis en cohérence dans le même item.

## Mise à jour

Une évolution significative met à jour ensemble :

1. le document produit ou technique concerné ;
2. le journal de décisions si un choix durable évolue ;
3. le backlog et ses dépendances ;
4. le journal de validation après vérification.
