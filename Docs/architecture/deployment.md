# Déploiement sur le VPS Hostinger

## Topologie retenue

Le Caddy installé comme service système reste l'unique point d'entrée HTTP et HTTPS du VPS. Les deux applications coexistent par nom d'hôte, sans sous-chemin et sans port public supplémentaire :

```text
Internet
  └─ Caddy :80/:443
       ├─ guesstheappliance.com          -> 127.0.0.1:8080 (GuessThePolitician)
       └─ playlist.guesstheappliance.com -> 127.0.0.1:5173 (EasyPlaylist)
                                              └─ /api et /socket.io -> api:3000
                                                                        └─ db:5432
```

Le Compose principal EasyPlaylist publie uniquement le frontend sur `127.0.0.1`. L'API et PostgreSQL n'ont aucun port hôte ; nginx relaie `/api` et `/socket.io` vers l'API à travers le réseau Docker `frontend`. Le réseau `backend` reste interne à Docker. L'override `compose.production.yaml` force les cookies sécurisés et rend obligatoires les secrets de production.

## DNS

Créer un enregistrement `A` pour `playlist.guesstheappliance.com` vers l'adresse IPv4 du VPS. Ajouter un enregistrement `AAAA` seulement si le VPS est réellement joignable en IPv6. Caddy demandera automatiquement le certificat TLS lorsque le DNS sera propagé et que les ports 80 et 443 atteindront le serveur.

## Configuration de production

Dans `/opt/EasyPlaylist/.env`, remplacer toutes les valeurs locales. Ne jamais afficher ni versionner ce fichier. Au minimum :

```dotenv
WEB_PORT=5173
POSTGRES_DB=easyplaylist
POSTGRES_USER=easyplaylist
POSTGRES_PASSWORD=<secret-unique>
COOKIE_SECURE=true
GUEST_COOKIE_SIGNING_KEY=<secret-unique>
SECRETS_ACTIVE_KEY_VERSION=1
SECRETS_ENCRYPTION_KEY_V1=<32-octets-en-base64>
YOUTUBE_API_KEY=<cle-restreinte-cote-serveur>
YOUTUBE_REGION_CODE=FR
```

Des secrets compatibles peuvent être générés sur le VPS sans les copier dans un historique de commandes partagé :

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -base64 32
```

La clé YouTube doit être restreinte à YouTube Data API v3 et, si possible, à l'adresse IP publique stable du VPS. Elle reste uniquement dans l'environnement du service `api`.

## Démarrage et vérification

Depuis `/opt/EasyPlaylist` :

```bash
docker compose -f compose.yaml -f compose.production.yaml config --quiet
docker compose -f compose.yaml -f compose.production.yaml up -d --build --wait
docker compose -f compose.yaml -f compose.production.yaml ps
curl --fail --silent --show-error http://127.0.0.1:5173/healthz
curl --fail --silent --show-error http://127.0.0.1:5173/api/health/ready
```

La commande `ps` doit montrer les trois services sains. Seul `web` doit afficher un port publié, sous la forme `127.0.0.1:5173->80/tcp`.

## Configuration Caddy

Après sauvegarde de `/etc/caddy/Caddyfile`, conserver le site existant et ajouter le second bloc :

```caddyfile
guesstheappliance.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:8080
}

playlist.guesstheappliance.com {
    encode zstd gzip
    reverse_proxy 127.0.0.1:5173
}
```

Valider avant de recharger le service :

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
curl --fail --silent --show-error https://playlist.guesstheappliance.com/healthz
curl --fail --silent --show-error https://playlist.guesstheappliance.com/api/health/ready
```

En cas d'échec TLS ou de proxy, consulter `sudo journalctl -u caddy --since "10 minutes ago" --no-pager` et les logs applicatifs avec `docker compose -f compose.yaml -f compose.production.yaml logs --tail 200`.

## Développement local

Le Compose principal suffit pour utiliser l'application à travers son frontend :

```bash
docker compose up -d --build --wait
```

Si un outil local doit joindre directement l'API ou PostgreSQL, sélectionner explicitement l'override prévu à cet effet :

```bash
docker compose -f compose.yaml -f compose.local.yaml up -d --build --wait
```

Les ports 3000 et 5432 sont alors publiés sur `127.0.0.1`, jamais sur toutes les interfaces.

## Retour arrière

Pour retirer EasyPlaylist du trafic sans toucher à GuessThePolitician, restaurer le Caddyfile sauvegardé ou supprimer uniquement le bloc `playlist.guesstheappliance.com`, valider, puis recharger Caddy. Arrêter ensuite la pile avec `docker compose -f compose.yaml -f compose.production.yaml down`. Ne pas ajouter `--volumes`, afin de conserver PostgreSQL.

Le port `8080` de GuessThePolitician fonctionne déjà derrière Caddy. Le resserrer ultérieurement de `0.0.0.0:8080` vers `127.0.0.1:8080` est recommandé, mais ce changement appartient à son propre dépôt et n'est pas requis pour démarrer EasyPlaylist.
