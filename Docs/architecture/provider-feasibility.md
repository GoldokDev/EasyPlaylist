# Faisabilité officielle des fournisseurs

## Statut et méthode

- Vérification : 2026-08-08.
- Périmètre : Spotify, Deezer, SoundCloud et YouTube/YouTube Music.
- Sources : documentation, conditions et canaux de support officiels uniquement.
- Niveau de preuve : documentaire. Aucun compte développeur, credential, abonnement ou test de lecture réel n'a été utilisé.

Une capacité est déclarée `OUI` seulement lorsque la documentation officielle actuelle décrit le parcours. `LIMITÉ` signifie que le parcours existe mais ne satisfait pas sans réserve le contrat EasyPlaylist. `NON PROUVÉ` signifie que l'absence de documentation publique empêche de promettre la capacité.

## Conclusion décisionnelle

La paire Spotify puis Deezer retenue par D-012 ne permet pas de livrer le MVP public décrit aujourd'hui :

1. Spotify fournit bien recherche, contrôle distant et lecture web, mais son mode de développement est limité à cinq utilisateurs Spotify autorisés. L'accès public étendu est réservé aux organisations établies qui opèrent déjà un service lancé avec au moins 250 000 utilisateurs actifs mensuels. En outre, les sources publiques n'autorisent pas explicitement des membres du lobby non authentifiés par Spotify à commander le compte d'un tiers.
2. Deezer ne crée plus de nouveaux accès API pour les particuliers. Ses conditions réservent la lecture complète aux comptes Premium+ et limitent l'usage du contenu à un cadre strictement privé et familial, incompatible avec le contrat générique d'un lobby public entre amis.
3. SoundCloud possède une API moderne et un lecteur web, mais ses conditions interdisent une expérience de lecture qui agrège ses contenus avec ceux d'autres services.
4. YouTube permet recherche et lecture dans un navigateur sans connexion musicale partagée, mais impose un lecteur vidéo visible, interdit l'audio isolé et la lecture en arrière-plan, et limite par défaut `search.list` à 100 appels par jour. Aucune API officielle de catalogue ou de lecture YouTube Music n'est publiée ; l'API Data Portability ne sert qu'à exporter les données d'un utilisateur.

D-027 tranche finalement ces constats : faute de compte Spotify Premium et de lecteur Deezer public actuel exploitable, le MVP utilise YouTube avec une recherche serveur et un lecteur IFrame visible. Les participants n'ont aucun compte fournisseur à connecter. Spotify, Deezer et l'ouverture multi-fournisseurs sont reportés après le MVP.

## Matrice synthétique

| Sujet | Spotify | Deezer | SoundCloud | YouTube / YouTube Music |
| --- | --- | --- | --- | --- |
| OAuth / credentials | `OUI` — Authorization Code côté serveur ou PKCE ; scopes de lecture dédiés | `BLOQUÉ` — mécanisme historique conditionné à un App ID, mais plus de nouvel accès particulier | `OUI` — OAuth 2.1 + PKCE ; client credentials pour ressources publiques | `OUI` — clé API pour données publiques, OAuth 2.0 pour données/actions utilisateur ; aucun OAuth requis pour l'embed public |
| Recherche catalogue | `OUI` — albums, artistes, playlists et titres ; maximum 10 résultats par requête en Development Mode | `LIMITÉ` — Search figure dans l'API contractuelle, mais la référence est derrière authentification et aucun nouvel accès n'est délivré | `OUI` — titres, utilisateurs et playlists ; filtre `access=playable` | `OUI` pour YouTube — vidéos/chaînes/playlists ; `NON PROUVÉ` pour un catalogue YouTube Music |
| Lecture navigateur | `OUI` — Web Playback SDK, navigateur transformé en appareil Spotify Connect | `LIMITÉ` — les conditions décrivent plugins/lecteur exportable ; lecture complète Premium+, sinon 30 secondes, sans référence SDK publique exploitable | `OUI` — widget ou flux dans un lecteur personnalisé avec attribution | `OUI` — IFrame Player visible ; vidéo et publicités intactes |
| Contrôle distant | `OUI` — Web API Player vers l'appareil Connect actif | `NON PROUVÉ` — aucune API publique actuelle vérifiable pour piloter un autre appareil | `NON PROUVÉ` — commandes documentées dans le widget/navigateur, pas vers un appareil tiers | `NON` — commandes JavaScript dans l'iframe locale, pas de pilotage officiel d'un appareil YouTube distant |
| Abonnement | Premium obligatoire pour le Web Playback SDK et les endpoints Player ; propriétaire d'app Premium en Development Mode | Premium+ obligatoire pour le titre complet | Artist Pro obligatoire pour enregistrer l'application ; disponibilité d'écoute selon le titre | Aucun abonnement documenté pour l'embed standard ; restrictions propres à la vidéo, au pays et à l'âge |
| Quotas | Fenêtre glissante de 30 s, seuil non publié ; cinq utilisateurs autorisés en développement ; quota partagé par compte développeur | Aucun quota chiffré public actuel ; Deezer peut restreindre ou retirer l'accès sans préavis | 15 000 requêtes de lecture par 24 h ; 50 jetons client credentials/12 h/app et 30/h/IP | 100 appels `search.list`/jour par défaut ; 10 000 unités/jour pour les autres endpoints ; extension après audit |
| Stockage | Pas de stockage indéfini ; cache temporaire seulement ; suppression des données personnelles à la déconnexion | Aucun droit sur le contenu n'est accordé ; politique de cache détaillée non publiée dans les sources accessibles | Téléchargement/stockage du contenu interdit ; suppression après révocation de l'accès | Données stockées à supprimer ou rafraîchir sous 30 jours ; suppression des données utilisateur sur demande |
| Production publique | `BLOQUÉ POUR LE MVP` — extended quota inaccessible à un nouveau projet ; streaming commercial interdit | `BLOQUÉ` — nouveaux accès particuliers désactivés, usage non commercial et familial | `BLOQUÉ POUR L'AGRÉGATION` — agrégation de lecture multi-services interdite | `LIMITÉ MAIS POSSIBLE` — audit pour plus de recherches, lecteur visible, pas d'arrière-plan/audio seul, politique de confidentialité |
| Connexion consentie au lobby | `NON PROUVÉ` — le consentement EasyPlaylist ne démontre pas la permission Spotify de déléguer les commandes à des tiers | `INCOMPATIBLE` hors cercle familial | Sans objet pour contenu public ; l'agrégation reste interdite | Sans objet pour contenu public ; le lecteur peut exécuter des commandes du lobby dans la page visible |
| Callback local / réel | `OUI` — `http://127.0.0.1` en local, HTTPS hors loopback ; `localhost` refusé | `NON PROUVÉ` avec un nouvel App ID indisponible | `OUI` — URI enregistrée et exacte ; le CLI officiel sait utiliser un callback local ou un appairage distant | Clé API sans callback pour le parcours public ; OAuth éventuel utilise les redirects Google déclarés |
| Verdict | Prototype privé limité techniquement faisable ; MVP public et délégation non validés | Non faisable pour EasyPlaylist dans les conditions actuelles | Non faisable comme second catalogue agrégé | Seul candidat techniquement accessible, au prix d'un changement explicite du contrat d'affichage/lecture |

## Spotify

### Capacités démontrées

- La [recherche Web API](https://developer.spotify.com/documentation/web-api/reference/search) couvre notamment titres, artistes, albums et playlists, avec marché et pagination. Les changements Development Mode de février 2026 réduisent le maximum à 10 résultats par appel dans le [guide de migration officiel](https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide).
- Le [Web Playback SDK](https://developer.spotify.com/documentation/web-playback-sdk) crée un appareil Spotify Connect dans Chrome, Firefox, Safari et Edge sur mobile et desktop. Le [tutoriel](https://developer.spotify.com/documentation/web-playback-sdk/tutorials/getting-started) et la [référence](https://developer.spotify.com/documentation/web-playback-sdk/reference) exigent un access token Premium et signalent les contraintes d'autoplay, notamment sur iOS.
- Les scopes minimaux utiles sont `streaming`, `user-read-playback-state` et `user-modify-playback-state`, selon la [liste officielle des scopes](https://developer.spotify.com/documentation/web-api/concepts/scopes). Les endpoints Player, dont [Start/Resume Playback](https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback), ciblent l'appareil actif et exigent Premium.
- Pour une API avec backend, Spotify accepte Authorization Code ; PKCE est recommandé pour un client sans secret. Le [guide Spotify pour les intégrations](https://developer.spotify.com/documentation/web-api/tutorials/building-with-ai) confirme ces flux, le stockage serveur du secret et le rafraîchissement des tokens.
- Les [URI de redirection](https://developer.spotify.com/documentation/web-api/concepts/redirect_uri) doivent être HTTPS hors loopback. En local, `http://127.0.0.1` ou `[::1]` est permis, mais `localhost` ne l'est pas.

### Limites structurantes

- Le [mode de quota](https://developer.spotify.com/documentation/web-api/concepts/quota-modes) limite une application de développement à cinq utilisateurs Spotify allowlistés et exige Premium pour le propriétaire. Depuis le 15 mai 2025, l'extended quota n'accepte que des organisations établies avec un service déjà lancé et au moins 250 000 MAU, après revue pouvant prendre jusqu'à six semaines.
- Le [rate limit](https://developer.spotify.com/documentation/web-api/concepts/rate-limits) utilise une fenêtre glissante de 30 secondes dont le seuil dépend du mode ; `429` et `Retry-After` doivent être gérés. Depuis juillet 2026, le quota Development Mode est partagé par compte développeur, selon l'[annonce officielle](https://developer.spotify.com/blog/2026-07-23-web-api-quota-updates).
- La [Developer Policy](https://developer.spotify.com/policy) interdit les intégrations de streaming commerciales, la diffusion non interactive et les usages professionnels publics. Les [Developer Terms](https://developer.spotify.com/terms) interdisent le stockage indéfini du contenu Spotify et limitent le cache au strict nécessaire ; les données personnelles doivent être supprimées après déconnexion.
- Les [règles de design](https://developer.spotify.com/documentation/design) imposent attribution, liens Spotify et présentation distincte dans une agrégation multi-services.
- Les scopes autorisent l'application à contrôler la lecture de l'utilisateur qui a consenti. Aucune source publique consultée ne confirme que l'application peut déléguer ce contrôle à tous les membres d'un lobby qui n'ont ni compte Spotify ni relation avec ce consentement. Cette conformité doit être obtenue explicitement de Spotify avant de promettre le modèle D-011.

### Compte et matériel de preuve réelle

- Une organisation/propriétaire d'application Spotify et un App ID.
- Un compte propriétaire Premium actif ; jusqu'à cinq comptes Spotify allowlistés pour les connexions testées en Development Mode.
- Un domaine HTTPS public et un callback déclaré ; `127.0.0.1` pour le local.
- Chrome, Firefox, Safari et Edge, dont Safari iOS avec interaction utilisateur ; une enceinte connectée au navigateur lecteur.
- Une approbation extended quota et une clarification écrite sur la délégation des commandes seraient nécessaires pour revendiquer le MVP public. Les demander constitue une action externe non réalisée.

## Deezer

### Capacités documentaires restantes

- Les [conditions Deezer for Developers](https://developers.deezer.com/termsofuse) décrivent une API contenant notamment Album, Artist, Playlist, Search, Track et User, ainsi que des plugins, widgets et un lecteur exportable.
- Ces mêmes conditions réservent la lecture intégrale aux utilisateurs Premium+ ; les autres n'obtiennent que 30 secondes.

### Incompatibilités

- Le 19 octobre 2025, le Community Manager Deezer a confirmé sur le [canal communautaire officiel](https://en.deezercommunity.com/features-feedback-44/api-auth-impossible-80857) que la création de nouveaux accès API pour les particuliers avait été désactivée à cause d'abus, sans calendrier de réouverture. Au 9 mai 2026, le même canal indiquait que des tokens existants pouvaient encore fonctionner mais qu'aucun nouveau token n'était disponible ; cette seconde réponse n'émane pas d'un employé et n'est retenue que comme corroboration, pas comme garantie.
- Les conditions limitent les services et leur contenu à un but non commercial, dans un environnement non commercial, et la lecture à un usage strictement privé dans le cercle familial. Un lobby public entre amis ne peut pas être qualifié conforme sur cette base.
- Tout autre usage doit être préalablement examiné et approuvé par Deezer. Deezer peut modifier, restreindre ou supprimer l'accès à tout moment sans préavis.
- La référence API actuelle redirige vers une connexion développeur. Sans App ID nouvellement disponible, il est impossible de vérifier officiellement les scopes, quotas, callbacks, navigateurs et méthodes de lecture actuels ou d'exécuter un test réel.

### Compte et matériel de preuve réelle

- Un App ID Deezer existant et encore actif, ou une approbation explicite de Deezer.
- Un compte Premium+ et un groupe de test réellement limité au cercle familial si l'on suit les conditions publiques actuelles.
- Un domaine/callback approuvé et les navigateurs supportés, à confirmer après accès au portail.

Ces prérequis ne sont pas disponibles dans le dépôt et ne rendraient toujours pas le contrat public entre amis conforme sans approbation spécifique.

## SoundCloud

### Capacités démontrées

- Le [guide API](https://developers.soundcloud.com/docs/api/) documente OAuth 2.1 avec PKCE, des tokens d'environ une heure, des refresh tokens à usage unique, la recherche et la lecture. Client Credentials suffit aux ressources publiques ; Authorization Code sert aux ressources utilisateur.
- Les titres publics jouables peuvent être lus via le widget ou un flux dans un lecteur personnalisé, avec attribution. Un titre peut toutefois être `playable`, `preview` ou `blocked` selon l'uploader, le paywall et le territoire.
- L'[enregistrement d'une application](https://developers.soundcloud.com/docs/api/register-app) exige un compte Artist Pro, des métadonnées exactes et l'acceptation des conditions. Le script officiel peut ouvrir un callback local ou présenter un lien d'appairage depuis une machine distante.
- Les [rate limits](https://developers.soundcloud.com/docs/api/rate-limits.html) annoncent 15 000 lectures par fenêtre de 24 heures, 50 jetons Client Credentials par 12 heures et par application, et 30 par heure et par IP.

### Incompatibilité

- Les [API Terms](https://developers.soundcloud.com/docs/api/terms-of-use) interdisent explicitement un service à la demande qui agrège et diffuse des contenus de plusieurs utilisateurs, ainsi qu'une expérience de lecture combinant SoundCloud et un autre service. Elles imposent aussi l'attribution et la suppression des données après révocation.
- Le [Help Center officiel](https://help.soundcloud.com/hc/en-us/articles/115003446727-SoundCloud-public-APIs) indique que le téléchargement ou stockage du contenu n'est pas permis et que l'accès peut être révoqué.
- Le widget est contrôlable dans le navigateur, mais aucune documentation officielle consultée n'expose le pilotage d'un appareil SoundCloud distant équivalent à Spotify Connect.

SoundCloud ne peut donc pas remplacer Deezer dans le modèle multi-fournisseurs actuel sans autorisation spécifique ou abandon de l'agrégation de lecture.

## YouTube et YouTube Music

### Capacités démontrées pour YouTube

- La [YouTube Data API](https://developers.google.com/youtube/v3/getting-started) utilise une clé API pour les données publiques et OAuth 2.0 pour les actions ou données privées. `search.list` recherche vidéos, chaînes et playlists et accepte des filtres de région et d'intégrabilité.
- L'[IFrame Player API](https://developers.google.com/youtube/iframe_api_reference) charge, lit, met en pause, change de vidéo et publie les événements de fin ou d'erreur dans le navigateur. Elle signale également les blocages d'autoplay.
- Aucun abonnement n'est documenté pour un embed public standard. La disponibilité reste propre à chaque vidéo : l'uploader peut désactiver l'intégration, le territoire peut bloquer le contenu et les vidéos avec restriction d'âge ne fonctionnent généralement pas sur un site tiers, selon l'[aide YouTube officielle](https://support.google.com/youtube/answer/171780).
- La connexion d'un compte musical n'est pas nécessaire pour rechercher et lire du contenu public. Le navigateur détenteur du bail peut donc recevoir les commandes EasyPlaylist et piloter son iframe locale.

### Contraintes

- Depuis juin 2026, la [politique de quota](https://developers.google.com/youtube/v3/guides/quota_and_compliance_audits) attribue 100 appels `search.list` par jour, 100 uploads et 10 000 unités pour les autres endpoints. Une hausse requiert un audit de conformité.
- Les [politiques développeur](https://developers.google.com/youtube/terms/developer-policies) exigent de supprimer ou rafraîchir les API Data stockées après 30 jours, une politique de confidentialité et le contrôle de ses données par l'utilisateur.
- Le [guide de conformité](https://developers.google.com/youtube/terms/developer-policies-guide) interdit d'isoler ou promouvoir l'audio, de lire en arrière-plan, de masquer/modifier le lecteur et de bloquer les publicités. Les [fonctions minimales](https://developers.google.com/youtube/terms/required-minimum-functionality) imposent un lecteur visible d'au moins 200 × 200 px et interdisent les overlays qui le cachent.
- L'IFrame API ne pilote que le lecteur intégré à la page. Aucune API officielle de contrôle à distance d'une application YouTube ou YouTube Music n'est documentée.
- Les résultats YouTube peuvent côtoyer d'autres sources s'ils restent clairement identifiés, mais la vidéo YouTube doit rester visible et inchangée.

### YouTube Music

- Le catalogue officiel des API consulté ne publie pas d'API YouTube Music de recherche ou de lecture pour une application tierce.
- La [Data Portability API](https://developers.google.com/data-portability/schema-reference/youtube) sait exporter les uploads et la bibliothèque YouTube Music de l'utilisateur ; elle ne fournit ni recherche de catalogue ni playback.
- EasyPlaylist devrait donc déclarer un adaptateur `youtube`, pas `youtube_music`, et ne pas promettre l'équivalence avec le catalogue ou l'abonnement YouTube Music.

### Compte et matériel de preuve réelle

- Un compte Google, un projet Google Cloud, une clé limitée à YouTube Data API v3 et, si possible, à l'adresse IP stable du serveur qui effectue la recherche.
- Un domaine HTTPS public, une politique de confidentialité et les liens vers les conditions YouTube/Google pour le lecteur intégré.
- Des navigateurs mobile/desktop avec lecteur visible, cas autoplay bloqué, vidéo non intégrable, restriction territoriale, restriction d'âge et publicité.
- Un audit de conformité si le MVP doit dépasser 100 recherches quotidiennes.

## Conséquences pour l'architecture

- Conserver le port piloté par capacités : les écarts constatés confirment D-007.
- Séparer `catalog_search`, `browser_embedded_playback`, `browser_drm_playback` et `remote_playback_control`. Le seul booléen `web_playback` masquerait des obligations essentielles, notamment lecteur vidéo visible et autoplay.
- Ajouter aux capacités effectives les contraintes `requires_subscription`, `requires_visible_player`, `allows_background_playback`, `allows_cross_provider_aggregation` et `max_search_requests`, sans encoder le nom du fournisseur dans le domaine.
- Ne jamais déduire `allows_shared_lobby_control` du seul succès OAuth. Cette capacité requiert une permission officielle explicite.
- Le fake de `PROVIDER-001` doit simuler au minimum lecteur visible obligatoire, abonnement manquant, quota épuisé, contenu territorialement indisponible et connexion non partageable.

Ces précisions sont réversibles au niveau du contrat d'adaptateur. D-027 accepte le lecteur YouTube visible comme première intégration réelle et reporte Spotify, Deezer ainsi que toute seconde intégration.
