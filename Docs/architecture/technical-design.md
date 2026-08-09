# Architecture technique

## Statut

Le socle exécutable est fixé par D-018. D-027 retient YouTube comme seule intégration réelle du MVP : l'API recherche des vidéos publiques intégrables avec une clé serveur et le navigateur détenteur du bail utilise un lecteur IFrame officiel visible.

## Vue d'ensemble

```text
Navigateurs mobiles ─┐
                     ├─ HTTP + temps réel ─> API ─> PostgreSQL
Navigateur lecteur ──┘                       │
                                             └─> APIs/SDK officiels des fournisseurs
```

Docker Compose lance trois services de produit :

- `web` sert l'application React mobile-first ;
- `api` porte l'autorité métier, OAuth, la file et les connexions temps réel ;
- `db` conserve l'état durable et les secrets chiffrés dans PostgreSQL.

Le reverse proxy Caddy déjà installé sur le VPS termine TLS et route les noms d'hôte vers les frontends liés à loopback. Il reste extérieur aux stacks Compose. Redis, un worker séparé et l'orchestration multi-instance restent hors MVP.

## Stack du socle

- Monorepo npm workspaces, lockfile npm 11 et TypeScript 7.0.2 strict.
- `apps/web` : React 19.2.8, Vite 8.2.1 et client Socket.IO 4.8.3.
- `apps/api` : Fastify 5.11.3, API JSON et serveur Socket.IO 4.8.3 livré par `QUEUE-001`.
- `packages/contracts` : Zod 4.4.3 et types dérivés partagés.
- PostgreSQL 18.4 ; la readiness utilise `pg` 8.22.0 et exécute `SELECT 1`. Les migrations SQL ordonnées et contrôlées par somme SHA-256 sont appliquées avant l'écoute HTTP, sans ORM.
- Images Node.js 24 Alpine et nginx 1.28 Alpine, Dockerfiles multi-stage et Compose avec healthchecks.
- Le harnais `FOUND-002` utilise Prettier 3.9.6, Oxlint 1.77.0, Vitest 4.1.10 et Playwright 1.62.1. Les fixtures PostgreSQL et les E2E emploient des projets Compose jetables. `FOUND-003` conserve `pg` et des migrations SQL explicites afin de ne pas introduire d'ORM sans besoin métier démontré.

Le socle n'installe pas d'ORM avant que le modèle persistant existe. Aucun framework n'est hérité d'EasyParty.

## Arborescence cible

```text
EasyPlaylist/
├── apps/
│   ├── api/
│   └── web/
├── packages/
│   └── contracts/
├── tests/
│   └── e2e/
├── artifacts/
│   └── validation/
├── Docs/
├── .agents/skills/
├── compose.yaml
├── package.json
└── AGENTS.md
```

Ne pas créer de package partagé tant qu'il n'a pas au moins deux consommateurs réels. `contracts` est justifié dès le premier endpoint consommé par le web.

## Contextes métier

### Lobby

Responsable du code d'invitation, du cycle de vie, des membres, de la présence et de la fermeture. Les actions ordinaires sont ouvertes à tous ; le créateur conserve uniquement la fermeture définitive.

### Provider connection

Responsable du consentement OAuth à l'usage par le lobby, des jetons chiffrés, des capacités déclarées, de l'expiration et de la révocation. Le domaine ne manipule jamais un SDK directement.

Le port exécutable `MusicProviderAdapter` reste interne à l'API. `CapabilityAwareMusicProvider` protège chaque appel optionnel par les capacités effectives de la connexion. Le fake déterministe est une connexion virtuelle en mémoire : il exerce le contrat sans créer de credential ou de ligne OAuth et ne constitue aucune preuve YouTube. L'adaptateur YouTube garde la clé Data API au serveur ; seul l'identifiant vidéo public rejoint le navigateur lecteur.

### Catalog search

Interroge en parallèle les adaptateurs éligibles, normalise les résultats, conserve leur provenance et retourne les erreurs partielles sans masquer les résultats valides.

Le service `CatalogSearchService` reçoit uniquement des couples connexion/adaptateur déjà consentis au lobby, filtre la capacité `catalog_search`, applique un timeout indépendant et agrège les réponses dans le contrat partagé. La route HTTP autorise d'abord le membership via le service lobby. Les bornes de requête et de pagination sont validées dans `packages/contracts`; les erreurs d'adaptateur sont converties en codes et messages bornés avant sérialisation.

### Queue

Autorité sur le titre courant, l'ordre, l'historique court et les mutations idempotentes. Chaque mutation porte un identifiant de commande et une version attendue ou une règle de conflit explicite.

`QueueService` verrouille la ligne du lobby dans une transaction PostgreSQL avant toute mutation. L'ajout accepte une version optionnelle et sérialise les ajouts concurrents ; le retrait et le réordonnancement exigent la version observée. Le premier réordonnancement concurrent gagne et les suivants reçoivent `QUEUE_VERSION_CONFLICT` avec le snapshot autoritaire. Les reçus lient l'identifiant de commande à l'acteur, au type et à l'empreinte du contenu ; un rejeu identique ne remute pas la file et une réutilisation différente est refusée.

Les positions durables sont allouées de façon monotone. Un réordonnancement utilise une plage dérivée de la nouvelle version, afin que les lignes historiques retirées ne puissent pas entrer en collision avec l'ordre actif. Un snapshot public contient au plus 200 titres, leur auteur, la version du lobby et les variantes autorisées, sans credential.

### Playback

Gère un bail exclusif sur le navigateur lecteur, les contrôles communs et la traduction vers les capacités du fournisseur actif. Tous les membres peuvent envoyer une commande ; l'API valide le lobby et coordonne l'état, tandis que le navigateur détenteur du bail exécute la lecture web officielle.

`PLAYER-001` concrétise ce contrat avec un bail PostgreSQL de six secondes renouvelé toutes les deux secondes par le navigateur détenteur. Une réclamation concurrente reçoit `LEASE_HELD`; après expiration, le prochain membre peut remplacer atomiquement le détenteur avec une nouvelle génération. L'identifiant opaque du navigateur reste local et n'est jamais publié dans un snapshot ou un événement.

Depuis `PLAYER-002`, cet identifiant est propre à l'onglet et conservé dans `sessionStorage` : un rechargement du même onglet conserve le bail, tandis qu'un second onglet du même navigateur reçoit une autre identité et reste silencieux. Le client ne crée l'IFrame YouTube que lorsque le snapshot personnalisé confirme `heldByCurrentDevice`; lorsqu'il perd ce droit, il applique `pause`, `mute`, puis détruit immédiatement le lecteur avant de retirer l'IFrame.

Les commandes `start`, `pause`, `resume` et `skip` sont ouvertes à tout membre tant qu'un bail valide existe. Seul le détenteur présentant navigateur et génération courants peut signaler `ended` ou `failed`. Fin, passage et échec archivent le titre courant puis démarrent atomiquement le prochain titre jouable ; un titre que l'adaptateur ne peut plus résoudre est marqué en échec et contourné. Chaque commande mutationnelle porte un reçu d'idempotence. Le fake conserve une instance de lecture séparée par lobby. Pour YouTube, le snapshot indique la variante publique au détenteur, qui crée l'IFrame visible et traduit l'état serveur en `playVideo` ou `pauseVideo` ; les événements du lecteur déclenchent les rapports autorisés.

## Modèle de données initial

- `Lobby` : identifiant, nom, code unique, statut, expiration, dates.
- `Participant` : identifiant invité opaque, création et dernière activité. Le cookie signé référence cet identifiant, jamais un pseudonyme.
- `Membership` : lobby, participant, pseudonyme dans ce lobby, indicateur de créateur, statut de présence logique. Sa clé composite ancre les autorisations et les références dans un lobby unique.
- `ProviderConnection` : modèle persistant réservé aux futurs fournisseurs OAuth ; YouTube et le fake sont des sources virtuelles sans credential ni ligne par lobby dans le MVP.
- `QueueItem` : lobby, position stable, enregistrement normalisé, variantes fournisseur, auteur, état, dates.
- `PlaybackLease` : lobby, participant/appareil, connexion sélectionnée, expiration, heartbeat.
- `PlaybackState` : item courant, état, position déclarée, version et dernière mise à jour.
- `CommandReceipt` : clé d'idempotence, acteur, résultat et expiration.

Les tables filles sensibles emploient des clés étrangères composites `(lobby_id, …)` vers le membership, la connexion ou l'item concerné. PostgreSQL refuse ainsi structurellement une association entre deux lobbies. `schema_migrations` conserve nom, somme SHA-256 et date d'application ; modifier une migration déjà appliquée fait échouer le démarrage.

La présence de jetons OAuth, la reprise après redémarrage et l'idempotence rendent PostgreSQL utile dès le MVP. Si une version sans base est souhaitée, elle doit renoncer explicitement à ces garanties et remplacer la décision proposée.

## Identité et autorisation

- Créer une identité invitée UUID opaque dans un cookie HMAC-SHA-256 `HttpOnly`, `Secure` en production et `SameSite=Lax`. Sa signature et son expiration à 24 heures sont vérifiées avant chaque reprise ; une valeur expirée ou altérée est remplacée.
- Ne pas utiliser le pseudonyme comme identité.
- Vérifier l'appartenance au lobby sur chaque route et événement.
- Distinguer appartenance au lobby, qualité de créateur et possession du bail lecteur. L'appartenance suffit pour les mutations ordinaires et commandes de lecture.
- L'appartenance au lobby suffit pour rechercher YouTube et commander la lecture EasyPlaylist ; aucune connexion de compte fournisseur n'est créée dans le MVP D-027.
- Conserver le contrat OAuth générique pour un futur fournisseur, sans l'exposer tant qu'aucun parcours réel ne l'utilise.

## Secrets et confidentialité

- Stocker refresh tokens et secrets OAuth uniquement dans l'API et chiffrés en AES-256-GCM avec une clé externe à la base. L'enveloppe authentifiée porte `keyVersion`, IV, ciphertext et tag ; toute altération est refusée.
- Si un SDK web officiel exige un access token, émettre au seul navigateur lecteur un credential éphémère, minimal et juste-à-temps ; ne jamais le persister côté client.
- Ne jamais sérialiser les secrets dans les DTO, erreurs, logs, traces ou messages temps réel.
- Filtrer les en-têtes sensibles dans la journalisation.
- Définir une purge à la fermeture/expiration du lobby et tester sa suppression.
- Utiliser les scopes minimaux nécessaires à la capacité activée.
- Prévoir un identifiant de version de clé pour permettre une rotation future.

## API

Les contrats publics sont validés par les schémas Zod de `packages/contracts`.

- `POST /lobbies` — crée atomiquement le lobby et le membership créateur pour l'identité invitée résolue depuis le cookie. L'entrée contient `name` et `displayName`.
- `POST /lobbies/join` — rejoint par `code` et `displayName`. Le code est normalisé en majuscules ; les codes inconnus, fermés et expirés retournent tous `LOBBY_UNAVAILABLE` sans distinguer leur état.
- `GET /lobbies/:id` — reprend l'état uniquement si l'identité invitée courante possède un membership actif dans ce lobby. Une absence ou un accès inter-lobby retourne le même `LOBBY_NOT_FOUND`.
- `GET /lobbies/:id/providers` — retourne les capacités et limites publiques des sources utilisables après vérification du membership ; aucun token, secret ou propriétaire interne n'est sérialisé. YouTube y apparaît configuré ou indisponible, et le fake reste explicitement identifié comme simulation.
- `GET /lobbies/:id/search?q=` — recherche agrégée bornée après vérification du membership.
- `GET /lobbies/:id/queue` — retourne un snapshot cohérent de la file et sa version après verrou partagé du lobby.
- `POST /lobbies/:id/queue/items` — ajoute un résultat provenant d'une connexion autorisée avec un identifiant de commande idempotent.
- `DELETE /lobbies/:id/queue/items/:itemId` — retire un titre en tant que membre avec contrôle de version.
- `PUT /lobbies/:id/queue/order` — soumet l'ordre complet des titres actifs avec contrôle de version et conflit observable.
- `GET /lobbies/:id/player?deviceId=` — retourne l'état de lecture et une vue personnalisée du bail après autorisation du membership.
- `POST /lobbies/:id/player/claim` — réclame ou renouvelle explicitement le bail avec une commande idempotente.
- `POST /lobbies/:id/player/heartbeat` — prolonge le bail seulement pour son navigateur et sa génération courants.
- `POST /lobbies/:id/playback/:command` — soumet `start`, `pause`, `resume` ou `skip` en tant que membre.
- `POST /lobbies/:id/playback/report` — permet au seul navigateur lecteur de signaler une fin ou un échec.
- `DELETE /lobbies/:id` — ferme définitivement le lobby si l'identité courante est son créateur, libère le bail et purge les connexions fournisseur après tentative de révocation.

La réponse lobby contient le nom, le code, les dates, le nombre de membres, le membership courant et un `invitePath`. Elle n'expose ni identifiant participant, ni modèle de persistence. Le web transforme `invitePath` en URL absolue avec son origine publique. Les codes produits comportent six caractères pris dans `ABCDEFGHJKMNPQRSTUVWXYZ23456789`, sans `0`, `O`, `1`, `I` ou `L`.

Routes prévues pour les tranches suivantes :

- `POST /lobbies/:id/providers/:provider/authorize` — démarrer OAuth.
- `GET /oauth/:provider/callback` — terminer OAuth côté serveur.

## Temps réel

- Joindre une room par lobby après authentification HTTP.
- Envoyer des événements versionnés contenant seulement des DTO publics.
- Utiliser un snapshot initial, puis des événements ordonnés par version de lobby.
- En cas de trou de version, demander un nouveau snapshot au lieu d'appliquer un état incertain.
- Publier l'événement seulement après la mutation durable réussie.
- Les heartbeats de présence et de bail sont bornés et expirables.

`QUEUE-001` concrétise ce flux avec Socket.IO derrière `/socket.io`. Le client émet `queue:join` avec le lobby, l'API réauthentifie le cookie et rejoint une room seulement après autorisation. `queue:event` transporte soit `queue.snapshot`, soit `queue.updated`, toujours avec le snapshot public complet. Un événement en avance de plus d'une version déclenche `GET /queue` au lieu d'être appliqué. Après une déconnexion, l'interface affiche l'état dégradé, continue les mutations HTTP et recharge le snapshot toutes les cinq secondes jusqu'à la reconnexion ; la reconnexion renvoie systématiquement un snapshot initial complet.

Le client lecteur émet séparément `playback:join`. `playback:event` ne contient que le lobby et la version de lecture : chaque navigateur relit ensuite `GET /player` avec son identifiant local pour calculer `heldByCurrentDevice` sans divulguer l'identifiant du détenteur aux autres membres. Les changements de titre publient aussi un snapshot de file après commit.

`LOBBY-002` ajoute `lobby:event` avec le seul événement public `lobby.closed`. La fermeture et les mutations ordinaires se sérialisent sur la ligne du lobby : selon l'ordre du verrou, une action déjà engagée termine avant la fermeture ou reçoit ensuite `LOBBY_NOT_FOUND`, mais aucune action ne peut valider sur un lobby fermé. Le client remplace immédiatement l'écran actif par l'état de fin de soirée ; toute relecture HTTP, jonction Socket.IO ou nouvelle jonction est également refusée par le statut serveur.

## Cycle de vie et purge

- La durée est de 24 heures par défaut et peut être configurée par `LOBBY_TTL_HOURS` avant déploiement, conformément à D-015.
- Le créateur ferme par une mutation atomique qui passe le lobby à `closed`, incrémente sa version et supprime son bail. L'adaptateur fournisseur est révoqué lorsqu'il expose cette capacité ; la suppression PostgreSQL des connexions et de leurs credentials est exécutée même si la révocation distante échoue.
- Au démarrage puis toutes les `LOBBY_EXPIRATION_SWEEP_INTERVAL_MS` millisecondes, l'API traite au plus `LOBBY_EXPIRATION_BATCH_SIZE` lignes. La sélection ordonnée utilise `FOR UPDATE SKIP LOCKED`, passe les lobbies ouverts échus à `expired`, libère leurs baux et supprime leurs connexions fournisseur.
- Le balayage reprend aussi un lobby déjà fermé ou expiré qui posséderait encore une connexion après une interruption. Une seconde exécution ne trouve plus de secret et ne modifie plus sa version : la purge est rejouable sans dommage.
- Les bornes par défaut sont 60 secondes et 100 lobbies par passage ; elles n'ajoutent ni service externe ni cache distribué.

## Résilience

- Isoler chaque appel fournisseur avec timeout, annulation et erreur typée.
- Retourner une recherche partielle si un fournisseur échoue.
- Rafraîchir un jeton au serveur avec verrouillage par connexion pour éviter les courses.
- Ne pas bloquer la file si un titre est indisponible : marquer l'échec, informer et appliquer la politique décidée (passer ou demander une variante).
- Exposer des healthchecks séparant état du processus, disponibilité de la base et readiness.

## Dépendances

```text
web -> contracts
api transport -> application -> domain
api provider adapters -> provider ports
api persistence -> repository ports
domain -> aucune dépendance web, ORM ou fournisseur
```

Les adaptateurs dépendent du domaine et implémentent ses ports ; le domaine ne dépend jamais d'eux.

## Environnements

- Local : Docker Compose principal avec seulement le frontend publié sur loopback ; l'override `compose.local.yaml` publie explicitement l'API et PostgreSQL sur loopback lorsqu'un outil local en a besoin. Le faux fournisseur reste déterministe.
- Test : base isolée, horloge contrôlable, adaptateurs fake, navigateur headless.
- Réel MVP : `compose.production.yaml` exige les secrets, force les cookies sécurisés et conserve l'exposition du frontend sur loopback. `playlist.guesstheappliance.com` est servi en HTTPS par le Caddy système vers `127.0.0.1:5173`. L'API et PostgreSQL restent privés dans Docker. La clé YouTube Data API v3 est restreinte côté Google Cloud et le lecteur IFrame reste visible. La politique de confidentialité et les liens vers les conditions YouTube/Google restent requis. Spotify et Deezer restent hors MVP.

Un mock prouve le contrat interne, pas la conformité ni la capacité d'une API réelle.
