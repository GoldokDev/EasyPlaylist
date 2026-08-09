# Backlog

## Utilisation

Prendre l'item `READY` de priorité la plus haute, puis appliquer [le processus](development-process.md). À priorité égale, l'ordre de ce document prévaut. Après un passage à `DONE`, réévaluer les dépendances et promouvoir les items éligibles.

Priorités :

- `P0` : nécessaire au MVP.
- `P1` : amélioration importante après la preuve MVP.
- `P2` : piste future non planifiée.

## État courant

| Ordre | ID | Priorité | Statut | Dépend de | Résultat |
| ---: | --- | --- | --- | --- | --- |
| 1 | DISC-001 | P0 | DONE | — | contrat produit de lecture et de collaboration accepté |
| 2 | DISC-002 | P0 | DONE | DISC-001 | Spotify organisateur retenu ; Deezer reporté après matrice officielle |
| 3 | FOUND-001 | P0 | DONE | DISC-001, DISC-002 | monorepo TypeScript et Docker Compose démarrables |
| 4 | FOUND-002 | P0 | DONE | FOUND-001 | harnais de qualité, tests et preuves navigateur |
| 5 | FOUND-003 | P0 | DONE | FOUND-001, FOUND-002 | persistance, identité invitée et coffre de secrets |
| 6 | LOBBY-001 | P0 | DONE | FOUND-003 | création et jonction d'un lobby |
| 7 | PROVIDER-001 | P0 | DONE | FOUND-002, FOUND-003 | contrat d'adaptateur et fournisseur fake déterministe |
| 8 | SEARCH-001 | P0 | DONE | LOBBY-001, PROVIDER-001 | recherche agrégée tolérante aux pannes |
| 9 | QUEUE-001 | P0 | DONE | LOBBY-001, SEARCH-001 | file partagée et idempotente en temps réel |
| 10 | PLAYER-001 | P0 | DONE | QUEUE-001, PROVIDER-001 | bail lecteur et lecture complète avec le fake |
| 11 | PROVIDER-002 | P1 | BLOCKED | DISC-002, PLAYER-001 | Spotify reporté ; attend un compte Premium allowlisté et des credentials de test |
| 12 | PROVIDER-003 | P0 | DONE | DISC-002, PLAYER-001 | YouTube réel validé : recherche serveur et lecture IFrame visible |
| 13 | LOBBY-002 | P0 | DONE | QUEUE-001, PLAYER-001 | reconnexion, expiration et fermeture/purge |
| 14 | UX-001 | P0 | DONE | QUEUE-001, PLAYER-001, PROVIDER-003 | interface du lobby recentrée sur la lecture et la file |
| 15 | PLAYER-002 | P0 | DONE | PLAYER-001, PROVIDER-003 | tout appareil qui rejoint sans détenir le bail reste silencieux |
| 16 | DEPLOY-001 | P0 | VERIFY | FOUND-001, PROVIDER-003, LOBBY-002 | Compose sûr derrière Caddy sur un sous-domaine HTTPS |
| 17 | SEC-001 | P0 | READY | PROVIDER-003, LOBBY-002 | qualification sécurité et résilience |
| 18 | QA-001 | P0 | TODO | UX-001, PLAYER-002, DEPLOY-001, SEC-001 | candidat MVP démontrable à trois appareils |

## Cadrage

### DISC-001 — Contrat produit de lecture

Objectif : lever les ambiguïtés qui changent le cœur du produit avant d'initialiser la technique.

Critères d'acceptation :

- Chaque question de `Docs/product/open-questions.md` possède une réponse explicite.
- Le rôle des comptes participants est distingué pour recherche, résolution et lecture.
- Le mode de sortie audio, les droits ouverts des membres, le bail lecteur et l'exception de fermeture sont définis.
- Le choix file unique ou playlists multiples est accepté.
- La durée de vie du lobby et la cible de déploiement initiale sont acceptées.
- `vision.md`, `mvp.md`, `technical-design.md` et le journal de décisions reflètent les réponses.
- L'utilisateur valide les choix qui traversent la frontière d'autonomie.

### DISC-002 — Faisabilité de Spotify et Deezer

Objectif : vérifier que Spotify puis Deezer peuvent réaliser le contrat de lecture navigateur et de connexions partagées, sans supposer que leurs API se valent.

Critères d'acceptation :

- Une matrice datée couvre Spotify, Deezer, SoundCloud et YouTube/YouTube Music.
- Chaque affirmation renvoie vers une documentation officielle actuelle.
- OAuth, recherche, lecture web/distante, abonnement, quotas, stockage et mise en production sont examinés.
- Les limites ou absences d'API sont écrites comme telles, sans contournement non officiel.
- Spotify et Deezer sont qualifiés en priorité, avec leur mode exact de lecture et leurs risques.
- Les comptes développeur et matériels nécessaires aux tests sont listés.
- Toute incompatibilité avec le partage au lobby ou la lecture navigateur est remontée avant scaffold ; aucun remplacement n'est décidé sans l'utilisateur.

## Fondation

### FOUND-001 — Monorepo et Docker Compose

Objectif : obtenir un socle minimal, reproductible et démarrable.

Critères d'acceptation :

- Le monorepo contient `apps/web`, `apps/api` et `packages/contracts` sans boilerplate inutile.
- Les choix de framework, versions, gestionnaire et accès base sont consignés.
- `compose.yaml` lance `web`, `api` et `db` avec réseaux, volumes et healthchecks.
- Un fichier `.env.example` documente toutes les variables sans secret réel.
- Le web affiche un écran de démarrage ; l'API expose readiness et liveness.
- L'API vérifie réellement PostgreSQL dans sa readiness.
- Une commande documentée construit et démarre le socle sur une base vierge.

### FOUND-002 — Harnais de qualité et validation

Objectif : rendre chaque futur critère prouvable localement et en CI.

Critères d'acceptation :

- Formatage, lint, typecheck, tests, build et E2E ont des scripts racine fiables.
- Les tests échouent avec un code non nul ; une sonde volontairement rouge le démontre sans rejoindre la suite normale.
- Des fixtures PostgreSQL isolées et nettoyées sont disponibles.
- Playwright peut lancer un parcours sur la stack Docker et enregistrer une capture dans `artifacts/validation`.
- Les logs contiennent un identifiant de requête mais filtrent cookies, autorisations et tokens.
- `$validate-web-delivery` contient les commandes réelles du dépôt.

### FOUND-003 — Persistance, identité et coffre de secrets

Objectif : poser les garanties de sécurité avant les lobbies et OAuth réels.

Critères d'acceptation :

- Les migrations créent lobbies, participants, memberships, connexions, file, bail et reçus d'idempotence.
- Une identité invitée opaque utilise un cookie signé et sécurisé selon l'environnement.
- Le pseudonyme n'est jamais une clé d'identité ou d'autorisation.
- Un service de chiffrement authentifié stocke une version de clé et refuse une charge altérée.
- DTO et sérialiseurs excluent structurellement les secrets.
- Les migrations passent sur base vide et un test de mise à niveau représentatif.
- Des tests prouvent isolation inter-lobby, expiration et absence de secrets dans les logs.

## Lobby et fournisseurs

### LOBBY-001 — Créer et rejoindre un lobby

Objectif : faire entrer un groupe sans compte permanent.

Critères d'acceptation :

- Un organisateur crée un lobby nommé et est enregistré comme créateur.
- Un code non ambigu et un lien partageable sont produits.
- Un invité rejoint par code avec un pseudonyme validé et devient membre.
- Un code invalide, expiré ou fermé retourne une erreur exploitable sans fuite d'information.
- Rafraîchir la page conserve l'identité invitée et l'appartenance.
- Deux lobbies restent strictement isolés.
- Le parcours mobile créer/rejoindre possède une capture examinée.

### PROVIDER-001 — Contrat et fournisseur fake

Objectif : valider l'architecture multi-fournisseurs sans dépendre d'une API externe.

Critères d'acceptation :

- Le port expose explicitement capacités, recherche, résolution, lecture et cycle des credentials.
- Une connexion déclare ses capacités effectives ; aucune capacité absente n'est appelée.
- Le fake déterministe simule succès, panne partielle, expiration, indisponibilité et fin de titre.
- Les types fournisseurs ne fuient pas dans les entités lobby/queue/playback.
- Des tests de contrat réutilisables vérifient tout adaptateur.
- Les limites du fake sont visibles dans l'interface et la documentation.

### SEARCH-001 — Recherche agrégée

Objectif : chercher dans les sources autorisées du lobby avec une réponse cohérente.

Critères d'acceptation :

- Une requête valide interroge en parallèle toutes les connexions capables et consenties.
- Les résultats portent source, connexion utilisée, métadonnées et disponibilité de lecture connue.
- La déduplication conserve toutes les variantes et n'utilise pas le seul titre.
- Timeout ou échec d'un fournisseur retourne une erreur partielle sans perdre les autres résultats.
- Entrées, quotas et pagination sont bornés.
- Aucun secret n'apparaît dans la réponse, les événements ou les logs.
- Tests : zéro connexion, doublons, panne partielle, timeout et résultats concurrents.

## File et lecture

### QUEUE-001 — File collaborative temps réel

Objectif : synchroniser une file serveur autoritaire entre tous les participants.

Critères d'acceptation :

- Un membre ajoute un résultat autorisé avec une clé d'idempotence.
- Tous les navigateurs reçoivent le même snapshot et les mêmes versions d'événements.
- Rejouer une commande ne crée pas de doublon.
- Une rupture de version provoque une resynchronisation complète.
- Tout membre peut supprimer et réordonner ; la concurrence respecte une règle déterministe.
- Les conflits concurrents ont un résultat déterministe et observable.
- Tests : reconnexion, doublon, conflit d'ordre, accès inter-lobby et panne WebSocket.

### PLAYER-001 — Bail lecteur et playback fake

Objectif : prouver qu'un seul appareil pilote la lecture pendant que tous contribuent.

Critères d'acceptation :

- Un appareil autorisé réclame un bail exclusif avec heartbeat et expiration.
- Un second navigateur ne peut pas produire l'audio tant que le bail est valide ; tout membre peut néanmoins envoyer les commandes au détenteur.
- Perdre le heartbeat libère le bail dans un délai documenté.
- Démarrer, terminer, passer et échouer un titre font avancer la file selon le contrat produit.
- Titre courant et état sont visibles en temps réel par tous.
- Les commandes rejouées sont idempotentes.
- Un E2E à trois contextes navigateur couvre ajout, lecture, perte et reprise du bail.

### PROVIDER-002 — Spotify réel

Objectif : remplacer le fake sur un premier parcours conforme aux API officielles.

Blocage : aucun compte Spotify Premium allowlisté ni credential d'application de test n'est disponible dans l'environnement du dépôt. Reprendre l'item lorsque ces éléments peuvent être fournis sans les verser au dépôt.

Critères d'acceptation :

- Seul le créateur peut lancer ou révoquer OAuth ; le flux utilise state à usage unique, scopes minimaux, callback autorisé et stockage chiffré.
- Un invité sans compte Spotify recherche le catalogue réel et ajoute un résultat via la connexion de l'organisateur, sans recevoir de token.
- Recherche, résolution et lecture navigateur fonctionnent sur un compte organisateur Premium allowlisté.
- Expiration, refresh si permis, révocation et erreur d'abonnement sont exercés.
- L'adaptateur passe la suite de contrat commune et des tests réels séparés.
- Les limites de territoire, appareil et compte sont expliquées dans l'interface.
- Les preuves datent provider, scopes, environnement et documentation officielle utilisée.

### PROVIDER-003 — YouTube réel

Objectif : livrer la première source réelle sans abonnement musical, avec recherche serveur et lecture vidéo visible conforme aux API officielles YouTube.

Critères d'acceptation :

- La clé YouTube Data API v3 est optionnelle, documentée, restreignable et ne quitte jamais le serveur ; son absence produit un état fournisseur indisponible explicite sans empêcher le fake.
- La recherche serveur retourne uniquement des vidéos intégrables, borne requête et pagination, et transforme identifiant, titre, chaîne, miniature et durée dans le contrat commun.
- Un résultat YouTube autorisé peut être ajouté à la file sans OAuth ni compte YouTube pour les participants.
- Seul le navigateur détenteur du bail crée le lecteur IFrame officiel ; la vidéo, les contrôles et l'attribution YouTube restent visibles et le produit ne propose ni audio isolé ni lecture en arrière-plan.
- Démarrage, pause, reprise, passage, fin et erreur du lecteur restent synchronisés avec l'état serveur et la progression automatique de la file.
- Les erreurs de quota, de configuration, de territoire, d'intégration et d'autoplay sont bornées et expliquées dans l'interface.
- L'adaptateur possède des tests avec réponses YouTube simulées et une preuve réelle séparée, datée, sans secret dans les logs, captures ou artefacts.

### UX-001 — Hiérarchie du lobby

Objectif : épurer l'écran actif pour donner la priorité au titre courant et à la file d'attente, sans retirer les actions de partage, de fermeture ou de recherche.

Critères d'acceptation :

- Le nom du lobby et le nombre de membres restent immédiatement visibles, tandis que le code, l'URL et la fermeture définitive sont regroupés dans des réglages compacts et accessibles au clavier.
- Les cartes de diagnostic « Source musicale » et « Mode démo » ne figurent plus dans le parcours principal.
- Le lecteur précède la file d'attente, qui précède elle-même la recherche sur mobile et bureau.
- Après un ajout réussi, le résultat concerné change visuellement d'état et une confirmation textuelle est annoncée aux technologies d'assistance.
- Les erreurs, états de chargement, temps réel dégradé, bail lecteur et contraintes du lecteur YouTube restent visibles au moment utile.
- Un parcours navigateur exerce ouverture des réglages, copie, ajout confirmé et fermeture, avec captures mobile et bureau examinées.

## Stabilisation

### DEPLOY-001 — Déploiement Compose derrière Caddy

Objectif : faire coexister EasyPlaylist avec GuessThePolitician sur le VPS Hostinger sans exposer directement l'API ou PostgreSQL.

Critères d'acceptation :

- Le Compose principal ne publie que le frontend sur l'interface loopback du VPS ; l'API et PostgreSQL restent exclusivement sur leurs réseaux Docker privés.
- Un override local/test permet encore d'exposer les ports nécessaires sur loopback sans rendre les services accessibles sur toutes les interfaces.
- Caddy route `playlist.guesstheappliance.com` vers le frontend EasyPlaylist, qui continue de relayer `/api` et `/socket.io` en interne.
- La configuration de production exige cookies sécurisés, secrets uniques et clé YouTube uniquement côté API.
- Les configurations Compose fusionnées sont valides et les stacks de base vierge, migrations, healthchecks, API, temps réel et navigateur restent fonctionnelles.
- La documentation fournit les commandes de démarrage, validation, rechargement Caddy et retour arrière sans publier ni modifier le VPS automatiquement.

### PLAYER-002 — Silence des appareils non lecteurs

Objectif : empêcher qu'un téléphone ou un nouvel onglet qui rejoint pendant une lecture YouTube produise du son sans détenir explicitement le bail lecteur.

Critères d'acceptation :

- Un nouvel appareil ou onglet reçoit l'état courant mais ne crée aucun lecteur multimédia capable de produire du son tant qu'il ne détient pas le bail.
- L'identité du lecteur distingue deux onglets d'un même navigateur tout en survivant au rechargement de l'onglet détenteur.
- La perte du bail coupe immédiatement la lecture locale avant de détruire le lecteur YouTube.
- Seul le détenteur courant peut traiter une fin ou une erreur du lecteur et renouveler le bail.
- Un test de régression navigateur rejoint un lobby en cours depuis un second onglet du même navigateur et prouve qu'il reste non lecteur et silencieux.
- Le parcours à plusieurs navigateurs, la lecture YouTube réelle et les contrôles collaboratifs restent fonctionnels.

### LOBBY-002 — Reconnexion, expiration et purge

Objectif : rendre une soirée récupérable et maîtrisable.

Critères d'acceptation :

- Tout membre peut retirer et réordonner ; seul le créateur peut fermer définitivement le lobby.
- Un participant reconnecté retrouve identité, file et état courant sans duplication.
- Le lecteur peut transférer ou perdre proprement son bail.
- La fermeture refuse les nouvelles actions, révoque si possible et supprime les secrets selon la politique acceptée.
- Une tâche bornée expire les lobbies après 24 heures par défaut, purge leurs secrets et peut être rejouée sans dommage.
- Tests : course fermeture/action, double purge, reconnexion et participant expulsé si retenu.

### SEC-001 — Sécurité et résilience

Objectif : qualifier les frontières sensibles avant la remise MVP.

Critères d'acceptation :

- Autorisation inter-lobby, CSRF OAuth, cookies, rate limits et validation d'entrée sont testés.
- Tokens, codes OAuth, cookies et clé de chiffrement sont absents des bundles, logs et artefacts.
- Les erreurs fournisseurs sont bornées par timeout et ne saturent pas l'API.
- La base redémarre sans corruption de file ; le lecteur récupère selon la règle documentée.
- Les dépendances critiques et images Docker sont auditées avec résultats consignés.
- Toute vulnérabilité P0/P1 découverte est corrigée ou bloque le passage à `QA-001`.

### QA-001 — Candidat MVP

Objectif : remettre une version testable qui démontre la promesse à trois appareils.

Critères d'acceptation :

- Tous les critères de `Docs/product/mvp.md` sont prouvés.
- La stack part d'une base et d'images Docker vierges avec la commande documentée.
- Un parcours utilise un lecteur et deux participants sur des tailles d'écran pertinentes.
- YouTube réel et le fake sont exercés séparément, dont une panne/quota YouTube et une vidéo indisponible.
- Perte/reprise du lecteur, reconnexion, conflit d'ajout et fermeture/purge sont démontrés.
- Aucun secret, accès inter-lobby, crash, erreur console non expliquée ou migration incohérente.
- Les principaux écrans possèdent des captures examinées.
- Un guide de test utilisateur court accompagne la remise.

## Après MVP

| ID | Priorité | Sujet |
| --- | --- | --- |
| POST-001 | P1 | playlists nommées et import/export |
| POST-002 | P1 | votes, limites d'ajout et modes de modération |
| POST-003 | P1 | Apple Music, Tidal et autres adaptateurs officiels |
| POST-004 | P1 | comptes permanents et historique de soirées |
| POST-005 | P1 | observabilité et déploiement multi-instance |
| POST-006 | P1 | application installable/PWA et notifications |
| POST-007 | P1 | réévaluer Deezer, ses nouveaux accès API et la résolution croisée après le MVP |
| FUTURE-001 | P2 | recommandations de groupe et analytics |
| FUTURE-002 | P2 | plusieurs lecteurs synchronisés après étude dédiée |
