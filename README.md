# EasyPlaylist

EasyPlaylist est une application web mobile-first de file musicale collaborative. Les invités recherchent des vidéos musicales YouTube publiques et pilotent la file depuis leur propre téléphone, sans compte musical ni abonnement Premium.

Le navigateur détenteur du bail diffuse avec le lecteur IFrame officiel, dont la vidéo et les contrôles restent visibles. La recherche nécessite une clé YouTube Data API v3 côté serveur ; la clé n'est jamais envoyée aux participants. Sans clé, le catalogue déterministe de démonstration reste disponible.

## Démarrage avec Docker

Prérequis : Docker avec le plugin Compose.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Une base PostgreSQL vierge est créée automatiquement au premier lancement. Quand les trois healthchecks sont au vert :

- interface : <http://127.0.0.1:5173> ;
- liveness API via le frontend : <http://127.0.0.1:5173/api/health/live> ;
- readiness API et PostgreSQL via le frontend : <http://127.0.0.1:5173/api/health/ready>.

Le Compose principal ne publie ni l'API ni PostgreSQL. Pour qu'un outil de développement local les joigne directement, utiliser l'override qui les lie exclusivement à loopback :

```powershell
docker compose -f compose.yaml -f compose.local.yaml up --build
```

L'API et PostgreSQL deviennent alors accessibles sur `127.0.0.1:3000` et `127.0.0.1:5432`.

Depuis l'interface, un organisateur saisit le nom de la soirée et son pseudonyme, puis partage le code ou le lien produit. Un invité ouvre ce lien, choisit son pseudonyme et retrouve ensuite le lobby après rafraîchissement grâce à son cookie signé.

Arrêter la stack sans supprimer les données :

```powershell
docker compose down
```

Les ports et identifiants PostgreSQL locaux sont documentés dans `.env.example`. Aucun secret réel n'est versionné.

Pour activer la recherche YouTube réelle, créer un projet dans [Google Cloud Console](https://console.cloud.google.com/), activer **YouTube Data API v3**, créer une clé limitée à cette API (et à l'adresse IP du serveur si elle est stable), puis renseigner `YOUTUBE_API_KEY` dans le fichier `.env` local. `YOUTUBE_REGION_CODE=FR` fixe la région de recherche par défaut. Il faut ensuite reconstruire/redémarrer le service API avec `docker compose up -d --build api`.

Une fois la stack saine, la preuve réelle peut être rejouée avec `npm run validate:youtube-real`. Ce parcours ouvre Chrome, consomme du quota YouTube, crée un lobby jetable, recherche et ajoute plusieurs vidéos, puis vérifie la lecture audible, la pause et la reprise. La suite E2E ordinaire force au contraire une clé vide afin de rester déterministe et de ne jamais consommer le quota réel.

L'API applique au démarrage les migrations SQL versionnées de `apps/api/migrations`. Pour les appliquer explicitement quand l'API tourne hors Docker :

```powershell
npm run db:migrate
```

Le cookie invité est `HttpOnly`, signé et limité à 24 heures. `COOKIE_SECURE=false` convient uniquement au HTTP local ; un déploiement HTTPS doit utiliser `COOKIE_SECURE=true`, une clé de signature unique et une clé de chiffrement de 32 octets encodée en base64.

Le déploiement sur le VPS Hostinger, le bloc Caddy pour `playlist.guesstheappliance.com` et la procédure de retour arrière sont détaillés dans [le guide de déploiement](Docs/architecture/deployment.md).

## Développement local

Prérequis : Node.js 22.12 ou plus récent et npm 11.

```powershell
npm install
npm run format:check
npm run lint
npm run typecheck
npm run test
npm run build
```

Les validations qui utilisent Docker sont isolées et suppriment leurs données de test :

```powershell
npm run test:postgres
npm run e2e
```

`npm run test:failure-probe:verify` exécute une sonde volontairement rouge hors de la suite normale et vérifie qu'elle termine avec un code non nul. Playwright utilise Chrome installé localement et enregistre sa preuve dans `artifacts/validation/`.

Le monorepo contient :

- `apps/web` : interface React/Vite ;
- `apps/api` : API Fastify, migrations PostgreSQL, identité invitée et coffre de secrets ;
- `packages/contracts` : contrats Zod partagés.

La documentation canonique commence dans [Docs/README.md](Docs/README.md). L'ordre de livraison se trouve dans [Docs/project/backlog.md](Docs/project/backlog.md) et les preuves dans [Docs/project/validation-log.md](Docs/project/validation-log.md).

## Sources historiques

`D:\Bureau\work perso\EasyParty` reste une source d'archéologie produit en lecture seule. Son code et son architecture ne sont pas repris.
