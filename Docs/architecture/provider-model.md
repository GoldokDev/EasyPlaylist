# Modèle de fournisseurs musicaux

## Objectif

Permettre d'ajouter des fournisseurs sans contaminer le lobby, la recherche, la file ou la lecture avec leurs formats particuliers. L'interface commune représente seulement des capacités démontrées.

## Principe

Un fournisseur déclare dynamiquement ses capacités pour une connexion donnée. L'abonnement, le pays, les scopes, le type d'appareil et l'état du compte peuvent modifier ces capacités.

Capacités envisagées :

- `catalog_search` ;
- `track_metadata` ;
- `web_playback` ;
- `remote_playback_control` ;
- `pause_resume` ;
- `seek` ;
- `queue_control` ;
- `token_refresh` ;
- `token_revoke`.

Le MVP ne suppose pas qu'un fournisseur possède toutes ces capacités.

## Port d'adaptateur livré

```ts
interface MusicProviderAdapter {
  readonly provider: string;
  getCapabilities(connection: ProviderConnectionRef): Promise<ProviderCapability[]>;
  getCredentialStatus(connection: ProviderConnectionRef): Promise<CredentialReport>;
  search(query: SearchQuery, connection: ProviderConnectionRef): Promise<SearchPage>;
  resolve(candidate: TrackCandidate, connection: ProviderConnectionRef): Promise<PlayableVariant>;
  start(command: PlaybackCommand, connection: ProviderConnectionRef): Promise<PlaybackReport>;
  pause(command: PlaybackCommand, connection: ProviderConnectionRef): Promise<PlaybackReport>;
  resume(command: PlaybackCommand, connection: ProviderConnectionRef): Promise<PlaybackReport>;
  skip(command: PlaybackCommand, connection: ProviderConnectionRef): Promise<PlaybackReport>;
  getPlaybackReport(commandId: string, connection: ProviderConnectionRef): Promise<PlaybackReport>;
  refreshCredentials(connection: ProviderConnectionRef): Promise<CredentialReport>;
  revokeCredentials(connection: ProviderConnectionRef): Promise<void>;
}
```

Le contrat exécutable se trouve dans `apps/api/src/provider/music-provider.ts`. Toutes les opérations restent présentes sur le port afin que les adaptateurs aient une forme testable commune. `CapabilityAwareMusicProvider` refuse une opération avant d'appeler l'adaptateur lorsque la capacité effective manque à la connexion. Une connexion et son adaptateur doivent déclarer le même fournisseur.

Les types `TrackCandidate`, `PlayableVariant` et `PlaybackReport` sont propres au domaine commun et ne contiennent aucun objet de SDK. Le DTO public de résumé d'une connexion est validé séparément dans `packages/contracts` et exclut structurellement credentials et tokens.

## Résultat normalisé

Un résultat de recherche conserve :

- un identifiant opaque propre à sa source ;
- fournisseur et type de catalogue ;
- titre, artistes, album, durée et image ;
- URL publique lorsque permise ;
- identifiants éditoriaux disponibles (par exemple ISRC) ;
- explicite flag de contenu, territoire ou restriction connue ;
- capacités de lecture observées, jamais déduites du seul nom du fournisseur.

## Enregistrement et variantes

La file contient un `TrackCandidate` logique et une ou plusieurs `PlayableVariant` liées à un fournisseur. La déduplication privilégie un identifiant éditorial fiable, puis une comparaison prudente et explicable. Deux résultats ne sont jamais fusionnés irréversiblement sur le seul titre.

Lors de la lecture :

1. sélectionner la variante YouTube publique autorisée dans le lobby pour le MVP ;
2. vérifier la forme de son identifiant vidéo et sa capacité `web_playback` ;
3. remettre au seul navigateur détenteur du bail l'identifiant public nécessaire à l'IFrame API, sans clé Google ;
4. conserver la vidéo et les contrôles officiels visibles ;
5. sur fin ou erreur signalée par ce navigateur, archiver l'item et passer au suivant.

En blind test, cette remise est séparée des métadonnées publiques : le détenteur reçoit uniquement `provider` et `providerTrackId` dans `playbackSource`, tandis que les autres membres reçoivent `null`. Le navigateur lecteur reste susceptible de voir la réponse dans l'IFrame YouTube officielle, qui ne peut être masquée ou recouverte ; aucun autre appareil ne reçoit l'identifiant vidéo.

Tout membre peut rechercher et demander la lecture sans compte fournisseur. `YOUTUBE_API_KEY` reste une configuration serveur globale et n'est ni une connexion participant ni un credential de lecture. `DISC-002` et D-027 bornent ce parcours aux vidéos publiques YouTube intégrables ; YouTube Music, l'audio isolé et la lecture masquée restent hors contrat.

## Recherche agrégée

- Interroger seulement les connexions consenties au lobby et capables de chercher.
- Lancer les appels en parallèle avec timeouts indépendants.
- Retourner résultats et erreurs par fournisseur.
- Dédupliquer sans perdre la provenance ni les variantes.
- Ne pas mettre en cache au-delà de ce que les règles du fournisseur autorisent.
- Attribuer consommation de quota et erreurs à la connexion utilisée.

`SEARCH-001` concrétise ce contrat par `GET /lobbies/:id/search`. La requête exige au moins deux caractères, accepte au plus cent caractères, borne chaque page entre un et vingt résultats et limite le curseur opaque à deux cents caractères. Chaque connexion éligible reçoit la même borne de page et dispose d'un timeout indépendant de deux secondes ; une panne, un timeout ou une erreur partielle devient une issue publique rattachée au fournisseur et à la connexion, sans annuler les résultats des autres sources.

Le regroupement utilise d'abord l'ISRC normalisé. Sans identifiant éditorial, il emploie une empreinte explicite composée du titre normalisé, de l'ensemble des artistes et d'une durée arrondie à deux secondes : le titre seul ne fusionne donc jamais deux enregistrements. Le résultat logique conserve chaque variante avec `provider`, `connectionId`, identifiant opaque du titre et disponibilité de lecture dérivée uniquement des capacités déclarées. Aucun message d'exception brut ni credential fournisseur n'entre dans le DTO public.

## Matrice de faisabilité

La [matrice datée du 2026-08-08](provider-feasibility.md) couvre Spotify, Deezer, SoundCloud et YouTube/YouTube Music à partir de sources officielles :

- OAuth et scopes ;
- recherche de catalogue ;
- mode de lecture disponible ;
- contrôle d'un appareil distant ;
- exigences d'abonnement et de compte développeur ;
- restrictions territoriales et navigateur ;
- quotas et rate limits ;
- règles de stockage des métadonnées ;
- contraintes de mise en production et comptes de test ;
- faisabilité d'un callback local puis HTTPS.

Elle a conclu qu'aucune paire ne satisfaisait le contrat public initial. D-027 retient YouTube comme seule intégration réelle accessible sans abonnement musical : la recherche passe par la Data API côté serveur et la lecture par l'IFrame API visible du navigateur détenteur du bail. Spotify, Deezer et les autres sources sont reportés.

## Adaptateur YouTube du MVP

`YoutubeMusicProviderAdapter` représente malgré son port musical une source `youtube`, jamais `youtube_music`. Avec une clé configurée, il déclare recherche, métadonnées, lecture web, pause/reprise et passage. Sans clé, il ne déclare que les capacités du lecteur IFrame et son résumé public marque la recherche indisponible ; le catalogue fake reste alors la source de développement.

La recherche appelle `search.list` avec `type=video`, la catégorie musique, `videoEmbeddable=true`, `videoSyndicated=true`, une région configurable et au plus vingt résultats, puis `videos.list` vérifie l'intégrabilité et récupère la durée. La clé est utilisée exclusivement par l'API. Les refus d'accès/quota et réponses invalides deviennent des codes bornés sans URL ni réponse brute dans le DTO public.

Le serveur ne prétend pas diffuser YouTube lui-même : l'adaptateur accepte les commandes coordonnées, tandis que le composant React charge l'IFrame Player API uniquement sur le navigateur détenteur du bail. Ses événements `ended`, erreur et autoplay bloqué alimentent respectivement la progression serveur, l'échec borné et une action utilisateur visible.

## Faux fournisseur

Avant les intégrations réelles, un adaptateur déterministe simule :

- résultats multiples et doublons contrôlés ;
- succès et échec partiel ;
- expiration et rafraîchissement ;
- titre introuvable au moment de la lecture ;
- progression, pause, fin et perte du lecteur.

Le fake teste le domaine et le temps réel. Son état de lecture est isolé par lobby afin qu'une soirée ne remplace jamais la simulation d'une autre. Il ne justifie jamais de marquer l'intégration YouTube `PROVIDER-003` comme terminée.

`PROVIDER-001` livre un fake en mémoire déterministe avec quatre scénarios configurables :

- `success` retourne toujours les mêmes résultats normalisés pour une même requête, résout un titre, simule pause/reprise/passage et atteint `ended` selon une horloge injectée ;
- `partial_failure` conserve des résultats utiles et ajoute une erreur de catalogue partielle explicite ;
- `expired` refuse les opérations jusqu'au rafraîchissement simulé des credentials ;
- `unavailable` signale une indisponibilité complète et bornée.

L'identifiant spécial `fake:unavailable` simule en plus un titre devenu introuvable au moment de la résolution. Le fake n'utilise ni compte, ni réseau, ni secret et perd son état au redémarrage de l'API. Ces limites sont retournées par `GET /lobbies/:id/providers` après vérification du membership puis affichées dans le lobby. La suite `music-provider-adapter.contract.ts` s'applique au fake et devra être enregistrée sans modification de ses invariants pour chaque futur adaptateur réel.
