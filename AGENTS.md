# EasyPlaylist — consignes du dépôt

## Mission

Construire une application web mobile-first de file musicale collaborative publique. Les participants rejoignent un lobby, partagent éventuellement l'accès à un fournisseur musical et manipulent librement la file. Un seul navigateur détient le bail lecteur et diffuse vers l'enceinte.

Le prototype `D:\Bureau\work perso\EasyParty` est une source d'archéologie produit en lecture seule. Ne jamais le modifier ni reprendre son architecture sans une décision explicite.

## Sources de vérité

Lire avant toute évolution significative :

1. `Docs/README.md` pour naviguer dans la documentation.
2. `Docs/product/vision.md`, `Docs/product/mvp.md` et `Docs/product/open-questions.md` pour le produit.
3. `Docs/architecture/technical-design.md` et `Docs/architecture/provider-model.md` pour l'implémentation.
4. `Docs/project/backlog.md` pour l'ordre de travail.
5. `Docs/project/decision-log.md` pour les choix déjà tranchés.

En cas de contradiction, la décision `ACCEPTED` la plus récente prime, puis les documents structurés ci-dessus.

## Façon de travailler

- Communiquer avec l'utilisateur en français. Écrire le code, les identifiants, les événements et les noms de fichiers en anglais. La documentation produit reste en français.
- Pour livrer un item, appliquer `$deliver-backlog-item` dans `.agents/skills/deliver-backlog-item`.
- Prendre par défaut l'item `READY` de plus haute priorité. Un seul item peut être `IN_PROGRESS` à la fois.
- Avancer en autonomie pour les choix locaux, réversibles et sans impact significatif sur le produit, les coûts ou la sécurité.
- Consigner toute décision durable dans `Docs/project/decision-log.md`. Demander l'avis de l'utilisateur si le choix change le contrat de lecture, le périmètre fournisseur, les coûts, l'hébergement, la confidentialité ou détruit des données.
- Ne pas élargir silencieusement un item. Ajouter au backlog tout besoin indépendant découvert.
- Préserver les changements non liés. Ne pas commit, push, publier ou contacter un fournisseur sans demande explicite.

## Règles produit et techniques

- Traiter le serveur comme autorité pour les membres, la file, l'ordre, les droits et le bail du lecteur.
- Garder le cœur métier indépendant des SDK fournisseurs. Tout fournisseur passe par le contrat de capacités documenté dans `provider-model.md`.
- Ne jamais promettre une capacité de fournisseur sans preuve issue de sa documentation officielle et datée.
- Ne jamais envoyer de refresh token musical au navigateur, aux logs ou aux événements temps réel. Un access token de lecture éphémère ne peut atteindre le navigateur lecteur que si le SDK officiel l'exige, avec scopes minimaux, livraison juste-à-temps et aucune persistance client.
- Chiffrer les secrets OAuth au repos, utiliser des scopes minimaux et prévoir expiration, rafraîchissement, révocation et suppression du lobby.
- Valider tous les contrats aux frontières HTTP, WebSocket, base et fournisseur. Partager les schémas, pas les objets d'ORM.
- Versionner les migrations PostgreSQL. Ne pas modifier un schéma en production par synchronisation implicite.
- Rendre les opérations de file idempotentes lorsque les reconnexions peuvent les rejouer.
- Autoriser chaque membre du lobby à ajouter, retirer, réordonner, réclamer le bail et commander la lecture. Réserver seulement la fermeture définitive au créateur dans le MVP.
- Concevoir mobile-first et accessible : clavier, focus, contrastes, états de chargement, erreurs et connexions dégradées.
- Garder le lancement local container-first avec Docker Compose. Un service doit exposer un healthcheck utile, pas seulement un port ouvert.
- Ne pas ajouter de dépendance structurante, service payant ou cache distribué sans décision enregistrée.

## Validation obligatoire

Appliquer `$validate-web-delivery` après toute modification de code, dépendance, configuration Docker, migration, contrat API, flux OAuth ou interface.

Au minimum, selon le périmètre :

- exécuter formatage, lint, vérification des types, tests ciblés et suite rapide ;
- construire les images et valider la configuration Docker Compose ;
- démarrer les services avec leurs healthchecks et inspecter les logs ;
- tester les migrations sur une base vide puis sur le chemin de mise à niveau concerné ;
- exercer l'API et le flux temps réel réels, avec au moins un cas d'échec pertinent ;
- parcourir l'interface dans un navigateur et produire une capture examinée pour tout changement visuel ;
- consigner les commandes, résultats et preuves dans `Docs/project/validation-log.md`.

Un item ne passe à `DONE` que si tous ses critères d'acceptation sont prouvés. Si une preuve externe ou manuelle manque, utiliser `VERIFY`.

## Documentation vivante

- Mettre à jour le backlog pendant le travail.
- Ajouter une nouvelle décision au journal au lieu de réécrire silencieusement l'historique.
- Mettre à jour les contrats produit et architecture dans la même livraison que leur comportement.
- Ne jamais marquer une intégration réelle comme validée à partir d'un mock.
- Inscrire dans le journal de validation l'environnement, les commandes, les parcours, les résultats et les chemins des captures.

## Code review

- Signaler toute logique fournisseur qui fuit dans le domaine commun.
- Signaler tout secret dans le client, les logs, les fixtures ou le dépôt.
- Signaler tout changement d'ordre de file non atomique, non autorisé ou sensible aux doublons de reconnexion.
- Signaler toute route ou événement sans validation, autorisation de lobby et test d'échec.
- Signaler tout item `DONE` sans preuves alignées sur chaque critère d'acceptation.
- Signaler toute divergence entre comportement, contrats partagés, migrations et documentation canonique.
