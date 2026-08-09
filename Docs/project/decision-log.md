# Journal de décisions

Ce journal conserve les arbitrages produit et techniques. Une décision n'est jamais effacée : une entrée ultérieure peut la remplacer en citant son identifiant.

Statuts : `PROPOSED`, `ACCEPTED`, `SUPERSEDED`, `REJECTED`.

## D-001 — Nouveau codebase guidé par EasyParty

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : construire EasyPlaylist comme un nouveau projet. Utiliser `D:\Bureau\work perso\EasyParty` uniquement pour extraire les intentions produit, sans reprendre sa stack ni copier son code.
- Pourquoi : le prototype contient sessions, playlists, OAuth et temps réel, mais aussi des placeholders et des incohérences entre schéma et services. Le besoin actuel privilégie une file live et un lecteur unique.
- Conséquence : toute réutilisation de code legacy demande une justification explicite et des tests indépendants.

## D-002 — Gouvernance par backlog et preuves

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : adapter l'organisation de `D:\Applications\Godot\td-roguelike` avec documentation canonique, backlog à états, journal de décisions, journal de validation et deux skills complémentaires.
- Pourquoi : l'ordre de travail, les frontières d'autonomie et les preuves restent lisibles pour l'utilisateur et les agents.
- Conséquence : un seul item peut être `IN_PROGRESS` et aucun item ne devient `DONE` sans preuve par critère.

## D-003 — Docker et séparation web/API

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : développer et valider container-first avec au minimum un service web et un service API séparés dans Docker Compose.
- Pourquoi : cela correspond à la préférence exprimée et rend le lancement reproductible.
- Conséquence : chaque service possède un healthcheck utile et le parcours Docker fait partie de la Definition of Done.

## D-004 — Monorepo TypeScript, React, Fastify et PostgreSQL

- Date : 2026-08-08
- Statut : `SUPERSEDED` par D-018
- Décision : utiliser npm workspaces, TypeScript strict, React/Vite pour le web, Fastify pour l'API, des contrats Zod, PostgreSQL, Vitest et Playwright.
- Pourquoi : une stack TypeScript partagée réduit la duplication de contrats tout en conservant les services séparés. Fastify reste léger pour une API temps réel et Vite convient à une interface mobile-first sans rendu serveur requis.
- Conséquence : `DISC-001` confirme les besoins structurants ; `FOUND-001` vérifie versions et bibliothèques actuelles avant d'accepter ou de remplacer cette décision.

## D-005 — PostgreSQL inclus dans le MVP

- Date : 2026-08-08
- Statut : `SUPERSEDED` par D-018
- Décision : conserver PostgreSQL comme troisième service dès le MVP.
- Pourquoi : lobbies reconnectables, file ordonnée, baux, idempotence, états OAuth à usage unique et jetons chiffrés doivent survivre aux redémarrages. Une mémoire de processus ne fournit pas ces garanties.
- Conséquence : une décision sans base doit expliciter la perte de reprise et proposer un stockage sûr des secrets ; sinon `FOUND-003` livre des migrations versionnées.

## D-006 — Une file live par lobby

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : limiter le MVP à une file ordonnée unique et un historique court, contrairement aux playlists multiples d'EasyParty.
- Pourquoi : le besoin actuel décrit une playlist de soirée partagée et un seul lecteur. La file unique réduit navigation et conflits tout en testant la valeur centrale.
- Conséquence : playlists nommées et import/export restent `POST-001`. Faire plusieurs playlists exige de remplacer cette décision.

## D-007 — Adaptateurs pilotés par capacités

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : isoler tous les fournisseurs derrière un port commun et déclarer leurs capacités par connexion. Ne jamais supposer qu'OAuth, recherche ou lecture impliquent les autres capacités.
- Pourquoi : Spotify, Deezer, SoundCloud et YouTube/YouTube Music ont des modèles et contraintes différents susceptibles d'évoluer.
- Conséquence : chaque affirmation de capacité réelle nécessite une source officielle datée et un test réel ; le domaine ne branche pas sur le nom du fournisseur.

## D-008 — Un bail exclusif pour l'appareil lecteur

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : représenter le navigateur lecteur par un bail serveur exclusif, renouvelé par heartbeat et récupérable après expiration.
- Pourquoi : un seul appareil doit être connecté à l'enceinte, mais une fermeture d'onglet ou perte réseau ne doit pas bloquer la soirée.
- Conséquence : les commandes de lecture vérifient le bail ; `PLAYER-001` teste perte, reprise et idempotence.

## D-009 — Invités sans compte permanent

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : identifier les participants par une identité invitée opaque dans un cookie sécurisé. Le pseudonyme est un attribut, pas une identité.
- Pourquoi : rejoindre doit rester immédiat et un compte musical ne doit pas être requis pour contribuer.
- Conséquence : la persistance inter-appareils et les profils permanents restent hors MVP ; l'autorisation vérifie toujours le membership au lobby.

## D-010 — Lecture dans le navigateur

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : utiliser le navigateur relié à l'enceinte comme unique sortie audio du MVP. Le domaine expose une abstraction de lecture, traduite par chaque SDK web officiel.
- Pourquoi : une abstraction depuis le navigateur suffit au besoin et évite de dépendre du pilotage d'une application native.
- Conséquence : `DISC-002` doit vérifier la disponibilité réelle de la lecture web. Le pilotage d'un appareil natif n'est pas requis au MVP.

## D-011 — Connexions musicales consenties à tout le lobby

- Date : 2026-08-08
- Statut : `SUPERSEDED` par D-017
- Décision : lorsqu'un participant connecte un compte musical, il consent à son utilisation par tous les membres du lobby pour rechercher, résoudre et lire pendant la durée du lobby.
- Pourquoi : la valeur centrale est de mutualiser les accès disponibles sans exiger un abonnement chez chaque invité.
- Conséquence : le consentement et la révocation sont visibles. Les refresh tokens restent côté API ; seul un credential éphémère peut être livré au navigateur lecteur si un SDK officiel l'exige. `DISC-002` vérifie que ce modèle respecte chaque fournisseur.

## D-012 — Spotify puis Deezer

- Date : 2026-08-08
- Statut : `SUPERSEDED` par D-017
- Décision : prioriser Spotify comme première intégration réelle, puis Deezer comme seconde.
- Pourquoi : c'est l'ordre produit demandé.
- Conséquence : `DISC-002` qualifie ces deux fournisseurs en priorité tout en documentant SoundCloud et YouTube/YouTube Music. Si une capacité nécessaire est officiellement impossible, le remplacement revient à l'utilisateur.

## D-013 — Déploiement public dès le MVP

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : construire un site public dès le MVP, tout en conservant Docker Compose pour le développement local.
- Pourquoi : les participants doivent rejoindre la soirée depuis leurs propres téléphones sans dépendre d'un réseau local configuré.
- Conséquence : HTTPS, domaine, callbacks OAuth publics, cookies `Secure`, gestion de secrets et protections d'abus font partie du parcours réel.

## D-014 — Collaboration ouverte dans le lobby

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : autoriser tous les membres à ajouter, retirer, réordonner, réclamer le bail lecteur et commander la lecture. Réserver seulement la fermeture définitive au créateur.
- Pourquoi : le lobby est un espace de confiance entre amis ; les rôles de modération ne sont pas souhaités au MVP.
- Conséquence : les politiques configurables sont reportées en V2. Le bail empêche plusieurs sorties audio simultanées mais ne constitue pas un rôle de modération.

## D-015 — Expiration courte par défaut

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : expirer un lobby 24 heures après sa création par défaut, avec fermeture anticipée par le créateur et purge des secrets.
- Pourquoi : cette hypothèse réversible correspond à une soirée et minimise la conservation de credentials ; aucune autre durée n'a été demandée pendant `DISC-001`.
- Conséquence : la valeur reste configurable avant déploiement et peut être remplacée par une décision utilisateur ultérieure.

## D-016 — Replanifier les fournisseurs réels du MVP

- Date : 2026-08-08
- Statut : `SUPERSEDED` par D-017
- Décision proposée : livrer d'abord le parcours complet avec le fournisseur fake, puis conditionner les intégrations réelles à une approbation fournisseur ou à un arbitrage explicite. L'option techniquement accessible à court terme est YouTube, avec un lecteur vidéo visible et sans prétendre intégrer YouTube Music.
- Pourquoi : la matrice officielle `DISC-002` montre que Spotify n'est pas accessible en quota public à un nouveau MVP et ne documente pas la délégation de commandes à des tiers ; Deezer ferme les nouveaux accès particuliers et limite la lecture au cercle familial ; SoundCloud interdit l'agrégation multi-services ; YouTube impose une expérience vidéo visible et un quota de recherche très bas.
- Conséquence si acceptée : D-012 et les critères `PROVIDER-002`, `PROVIDER-003` et `QA-001` devront être remplacés dans le même changement. Tant que l'utilisateur n'a pas arbitré, D-012 reste la décision acceptée et `DISC-002` demeure en vérification.

## D-017 — Spotify porté par l'organisateur en bêta fermée

- Date : 2026-08-08
- Statut : `SUPERSEDED` par D-027
- Remplace : D-011, D-012 et la proposition D-016.
- Décision : pour le MVP, seul le créateur du lobby connecte un compte Spotify Premium allowlisté. Tous les membres du lobby, même sans compte Spotify, peuvent rechercher le catalogue via l'API EasyPlaylist, ajouter et manipuler la file et envoyer des commandes. L'API utilise côté serveur la connexion de l'organisateur pour aligner recherche et disponibilité sur son marché ; seul le navigateur lecteur reçoit un access token éphémère lorsque le SDK officiel l'exige. Deezer et toute seconde intégration réelle sont reportés après le MVP.
- Pourquoi : un compte organisateur suffit techniquement à fournir recherche et lecture à tout le lobby sans exposer ses credentials. Le mode Development Spotify autorise jusqu'à cinq utilisateurs Spotify authentifiés, ce qui permet une bêta fermée avec de nombreux invités non authentifiés auprès de Spotify, mais pas un service où tout organisateur public connecte librement son compte.
- Conséquence : le site reste accessible par lien aux participants, mais la bêta réelle n'accepte que des organisateurs Spotify allowlistés. Le créateur est seul à connecter ou révoquer Spotify ; les droits collaboratifs ordinaires et le bail lecteur restent ouverts aux membres. `PROVIDER-002` prouve Spotify avec un vrai compte autorisé ; Deezer devient `POST-007`. Une ouverture libre-service reste conditionnée à un mode de quota Spotify approprié et à sa revue de conformité.

## D-018 — Socle TypeScript et PostgreSQL versionné

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Remplace : D-004 et D-005.
- Décision : utiliser npm workspaces avec le lockfile npm 11, TypeScript 7.0.2 en mode strict, React 19.2.8 avec Vite 8.2.1, Fastify 5.11.3, Zod 4.4.3, le pilote `pg` 8.22.0 et PostgreSQL 18.4. Les images d'exécution utilisent Node.js 24 Alpine et nginx 1.28 Alpine. L'API interroge PostgreSQL directement avec `pg` pour sa readiness ; le choix d'un accès typé et des migrations est reporté à `FOUND-003` afin de ne pas installer un ORM avant l'existence du modèle durable.
- Pourquoi : les versions installées et verrouillées sont compatibles avec le Node.js 22.19 local et les images Node.js 24. Les contrats Zod servent déjà deux consommateurs. PostgreSQL fournit dès le socle une dépendance réelle à tester sans préjuger de la future couche de persistance.
- Conséquence : `package-lock.json` est la source de reproductibilité JavaScript. Toute mise à niveau structurante doit repasser typecheck, builds et validation Compose. Vitest, Playwright, Socket.IO et la stratégie de migrations restent explicitement à livrer dans `FOUND-002` et `FOUND-003`.

## D-019 — Harnais qualité compatible avec TypeScript 7

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : utiliser Prettier 3.9.6 pour le formatage, Oxlint 1.77.0 pour le lint, Vitest 4.1.10 pour les tests et Playwright 1.62.1 avec Chrome local pour les parcours navigateur. Les tests PostgreSQL et E2E démarrent des projets Compose jetables avec ports dédiés, puis suppriment leurs volumes. Les builds Docker npm désactivent explicitement les scripts d'installation.
- Pourquoi : `typescript-eslint` 8.66.0 déclare TypeScript `< 6.1` et refuse le TypeScript 7 accepté par D-018. Oxlint couvre les sources TypeScript sans cette peer dependency. Les orchestrateurs Node rendent les commandes identiques sous Windows et en CI tout en gardant PostgreSQL interne dans la stack produit ; un override rend son réseau accessible à l'hôte uniquement pendant le test de fixture.
- Conséquence : les commandes racine et le skill de validation deviennent les sources d'exécution. La sonde rouge reste exclue de la suite normale ; `compose.test.yaml` est réservé aux tests et ne modifie pas l'isolation du Compose produit.

## D-020 — Migrations SQL, isolation composite et primitives cryptographiques natives

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : conserver `pg` sans ORM pour le modèle initial et appliquer au démarrage des migrations SQL immuables, transactionnelles et vérifiées par somme SHA-256. Ancrer les relations lobby-scopées par des clés étrangères composites. Signer l'identité invitée par HMAC-SHA-256 avec une expiration de 24 heures et chiffrer les credentials par AES-256-GCM dans une enveloppe portant une version de clé.
- Pourquoi : le modèle tient dans des contraintes PostgreSQL explicites et ne justifie pas encore une dépendance structurante. Les primitives `node:crypto` fournissent signature, comparaison constante et chiffrement authentifié sans exposer les secrets au navigateur. La version de clé permet de conserver les anciennes clés pendant une rotation.
- Conséquence : l'API refuse de démarrer si les clés externes requises sont absentes ou invalides, et elle applique les migrations avant d'écouter. Les pseudonymes restent des attributs de membership non uniques. Un déploiement HTTPS doit activer `COOKIE_SECURE` et remplacer toutes les valeurs locales documentées.

## D-021 — Contrat public d'entrée dans un lobby

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : résoudre l'identité invitée signée à la frontière de chaque route lobby ; créer le lobby et son membership créateur dans une seule requête PostgreSQL ; produire un code de six caractères sans `0`, `O`, `1`, `I` ou `L` ; retourner une même erreur publique pour un code inconnu, fermé ou expiré. Le DTO lobby expose uniquement le membership courant, un nombre de membres et un chemin d'invitation relatif.
- Pourquoi : la création doit rester indivisible, le lien doit fonctionner sur toute origine de déploiement et une tentative de jonction ne doit pas permettre d'énumérer les lobbies ni leur cycle de vie. Le membership courant suffit à l'écran sans publier les identifiants opaques des autres participants.
- Conséquence : `POST /lobbies`, `POST /lobbies/join` et `GET /lobbies/:id` partagent les schémas de `packages/contracts`. Le web construit l'URL absolue depuis son origine, et toute future liste de membres devra définir un DTO public distinct plutôt que sérialiser la table `memberships`.

## D-022 — Port fournisseur gardé par capacités et fake virtuel

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : définir un port `MusicProviderAdapter` complet et neutre, puis placer devant lui `CapabilityAwareMusicProvider`, qui refuse toute opération dont la capacité manque à la connexion avant d'appeler l'adaptateur. Livrer le fake comme connexion virtuelle déterministe en mémoire, sans credential ni ligne PostgreSQL, et exposer seulement son résumé public sur une route autorisée par membership.
- Pourquoi : une forme de port stable permet une suite de contrat commune, tandis que la garde centrale empêche les appelants de confondre présence d'une méthode et capacité effective. Persister un faux credential n'apporterait aucune garantie utile et mélangerait simulation et coffre OAuth.
- Conséquence : chaque adaptateur futur doit passer la même suite de contrat et rester derrière la garde de capacités. Le fake perd son état au redémarrage, ses limites sont visibles dans l'interface, et aucune réussite du fake ne prouve une capacité fournisseur réelle.

## D-023 — Recherche agrégée bornée et déduplication explicable

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : exposer la recherche par `GET /lobbies/:id/search` après autorisation du membership, avec requête de 2 à 100 caractères, pages de 1 à 20 résultats, curseur opaque limité à 200 caractères et timeout indépendant de 2 secondes par connexion. Dédupliquer d'abord par ISRC, puis, en son absence, par titre normalisé, artistes normalisés et durée arrondie à deux secondes ; conserver toutes les variantes et leur connexion.
- Pourquoi : les appels doivent rester parallèles et bornés sans laisser une source lente masquer les autres. Une empreinte multi-attributs évite la fusion dangereuse sur le seul titre tout en permettant un résultat logique lisible.
- Conséquence : les erreurs partielles, pannes et timeouts sont des issues publiques rattachées à une connexion et ne font pas échouer la réponse globale. La disponibilité de lecture provient exclusivement des capacités déclarées. Les exceptions brutes et credentials restent hors du contrat partagé, des logs métier et du navigateur.

## D-024 — File transactionnelle versionnée et snapshots Socket.IO

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : sérialiser chaque mutation de file sous verrou PostgreSQL du lobby, utiliser sa version comme contrôle optimiste, conserver un reçu portant l'empreinte de chaque commande et diffuser un snapshot public complet par Socket.IO 4.8.3 après commit. Le retrait et le réordonnancement exigent une version ; l'ajout peut suivre l'ordre de verrouillage serveur sans version afin que deux contributions concurrentes restent toutes deux acceptées. Les positions actives utilisent des plages monotones dérivées des versions pour ne jamais entrer en collision avec l'historique retiré.
- Pourquoi : PostgreSQL est déjà l'autorité durable et fournit l'atomicité requise sans opérateur distribué. Un snapshot complet borné à 200 titres rend une rupture de version récupérable et évite d'appliquer un delta incertain. L'empreinte empêche qu'un identifiant idempotent soit réutilisé avec un autre acteur ou contenu. Socket.IO était explicitement prévu par D-018 et apporte rooms, reconnexion et transport WebSocket avec un coût local limité.
- Conséquence : `GET /queue` et les trois mutations partagent les schémas Zod publics ; `queue:event` n'est émis qu'après commit et ne contient aucun secret. Un conflit retourne `409` avec le snapshot autoritaire. Le client recharge toutes les cinq secondes en mode dégradé et reçoit un snapshot initial à chaque reconnexion. Cette stratégie reste mono-instance pour le MVP ; une diffusion multi-instance nécessiterait une décision distincte et un adaptateur de transport partagé.

## D-025 — Bail court, snapshot personnalisé et progression automatique

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : persister un bail lecteur exclusif de six secondes, renouvelé toutes les deux secondes par navigateur et génération. Ouvrir `start`, `pause`, `resume` et `skip` à tous les membres lorsqu'un bail valide existe, mais réserver les rapports `ended` et `failed` au navigateur détenteur. Après fin, passage, échec ou variante devenue indisponible, archiver le titre et tenter automatiquement le prochain. Diffuser un événement sans identifiant de navigateur puis faire relire à chaque client un snapshot personnalisé.
- Pourquoi : un délai court rend la perte du lecteur récupérable sans opérateur ni tâche de fond, tandis que la génération empêche un ancien heartbeat ou rapport de ressusciter un bail remplacé. La relecture personnalisée indique au détenteur qu'il produit l'audio sans exposer son identifiant opaque aux autres membres. La progression automatique garde la soirée active malgré un titre terminé ou défaillant.
- Conséquence : `playback_leases`, `playback_states` et `command_receipts` restent l'autorité PostgreSQL. Les mutations de titre et de file sont sérialisées sous verrou du lobby, les changements sont publiés seulement après commit et chaque lobby possède sa propre instance du fake. Ces délais sont des constantes MVP locales et pourront devenir configurables avant le déploiement réel sans changer le contrat produit.

## D-026 — Fermeture atomique et purge bornée rejouable

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : fermer un lobby sous le même verrou PostgreSQL que ses mutations, libérer immédiatement son bail, tenter la révocation des adaptateurs capables puis supprimer leurs connexions chiffrées même en cas d'échec distant. Exécuter au démarrage puis périodiquement un lot borné utilisant `FOR UPDATE SKIP LOCKED` pour expirer les lobbies échus et reprendre toute purge incomplète. Garder 24 heures, 60 secondes entre passages et 100 lobbies par lot comme valeurs par défaut configurables.
- Pourquoi : le statut serveur doit arbitrer sans fenêtre ambiguë la course entre une dernière action et la fermeture, tandis qu'une interruption ou une panne fournisseur ne doit jamais prolonger indéfiniment la conservation d'un credential. Un lot borné et rejouable suffit au MVP mono-instance sans nouvel opérateur.
- Conséquence : seul le créateur accède à `DELETE /lobbies/:id`; après commit, HTTP et Socket.IO refusent les nouvelles actions et `lobby.closed` fait basculer les navigateurs vers l'écran final. `provider_connections` et le bail sont supprimés à la fermeture ou à l'expiration, mais l'historique non secret du lobby reste en base selon la politique éphémère actuelle. Une future révocation Spotify réelle devra se brancher sur le callback serveur avant la purge locale sans modifier ce contrat.

## D-027 — YouTube visible remplace Spotify pour le MVP

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Remplace : D-017 pour la source réelle du MVP.
- Décision : utiliser YouTube comme première source réelle du MVP. Tous les membres recherchent des vidéos publiques via l'API EasyPlaylist et les ajoutent à la file sans compte YouTube. Le navigateur qui détient le bail diffuse avec l'IFrame Player API officielle dans un lecteur vidéo visible ; EasyPlaylist ne masque pas la vidéo, n'isole pas l'audio et ne prétend pas intégrer YouTube Music. Spotify et Deezer restent reportés jusqu'à disponibilité des comptes et accès nécessaires.
- Pourquoi : l'utilisateur ne dispose pas de Spotify Premium, tandis que l'ancien accès Deezer testé autorise OAuth et données de profil mais que le SDK public actuel ne fournit plus le lecteur nécessaire. YouTube fournit officiellement recherche de vidéos publiques et lecture intégrée sans abonnement musical. Cette option préserve le modèle collaboratif au prix d'un quota de recherche Google et des contraintes d'affichage YouTube.
- Conséquence : `PROVIDER-003` remplace `PROVIDER-002` sur le chemin critique. Une clé YouTube Data API v3 restreinte reste nécessaire côté serveur pour la recherche réelle, mais aucun OAuth participant ni secret n'atteint le navigateur. Le lecteur doit rester visible avec ses contrôles et son attribution, et la disponibilité dépend de l'intégrabilité, du territoire, de l'âge, de l'autoplay et du quota. Le fake reste disponible pour le développement et les pannes.

## D-028 — Hiérarchie visuelle centrée sur la soirée

- Date : 2026-08-08
- Statut : `ACCEPTED`
- Décision : sur l'écran actif, présenter d'abord le lecteur puis la file collaborative, et placer la recherche après celle-ci. Regrouper le code, le lien d'invitation et la fermeture définitive dans un panneau de réglages compact. Retirer du parcours principal les cartes techniques de sources, capacités et simulation ; les erreurs fournisseur restent affichées dans la recherche ou le lecteur au moment où elles affectent l'utilisateur.
- Pourquoi : pendant une soirée, le groupe doit comprendre immédiatement ce qui joue et ce qui arrive ensuite. Le partage et la fermeture sont ponctuels, tandis que les cartes de capacités occupaient durablement l'espace sans aider à piloter la musique.
- Conséquence : l'API fournisseur et le fake restent inchangés et testables, mais leur diagnostic n'est plus une section permanente du lobby. Chaque ajout réussi reçoit un retour visuel local et une annonce accessible. La fermeture reste réservée au créateur et conserve sa confirmation définitive depuis les réglages.

## D-029 — Identité et extinction du lecteur à l'échelle de l'onglet

- Date : 2026-08-09
- Statut : `ACCEPTED`
- Décision : identifier chaque onglet par un UUID conservé dans `sessionStorage`, et non chaque origine de navigateur par une valeur partagée dans `localStorage`. Un rechargement conserve cet identifiant, mais un autre onglet doit réclamer son propre bail. À la perte du bail, le client met en pause, coupe le son puis détruit le lecteur YouTube.
- Pourquoi : deux onglets d'un même téléphone partageaient auparavant la même identité de lecteur et pouvaient tous deux interpréter un snapshot comme leur appartenant, ce qui créait une seconde sortie audio lorsqu'un onglet rejoignait pendant la lecture.
- Conséquence : un téléphone ou onglet non détenteur observe et commande la soirée sans instancier de média audible. La reprise après rechargement du même onglet reste transparente ; le transfert vers un autre onglet suit l'expiration ou la réclamation normale du bail et ne change ni les droits collaboratifs ni le contrat serveur.

## D-030 — Sous-domaine Caddy et services Docker privés

- Date : 2026-08-09
- Statut : `ACCEPTED`
- Décision : conserver le Caddy installé comme service système sur le VPS et faire coexister les applications par nom d'hôte. `guesstheappliance.com` reste relayé vers GuessThePolitician sur `127.0.0.1:8080`, tandis que `playlist.guesstheappliance.com` relaie vers le frontend EasyPlaylist sur `127.0.0.1:5173`. Le Compose principal EasyPlaylist publie uniquement ce frontend sur loopback ; l'API et PostgreSQL restent sur leurs réseaux Docker privés. `compose.production.yaml` force les cookies sécurisés et exige les secrets. Des overrides explicites publient les ports utiles sur loopback pour le développement et les tests.
- Pourquoi : un sous-domaine préserve les routes absolues, cookies et connexions Socket.IO de chaque application, contrairement à un sous-chemin qui demanderait de rendre toutes les couches conscientes d'un préfixe. L'exposition publique de ports applicatifs contournerait TLS et agrandirait inutilement la surface d'attaque, alors que Caddy occupe déjà les ports 80 et 443.
- Conséquence : Caddy reste configuré hors du dépôt et hors de Compose ; la mise en production nécessite un enregistrement DNS, des secrets uniques, `COOKIE_SECURE=true`, une validation Caddy puis son rechargement. Le déploiement et son retour arrière sont documentés sans mutation automatique du VPS. Toute future exposition directe d'un service ou migration de Caddy dans Docker exigera une nouvelle décision.
