# Décisions issues des questions produit

Les questions structurantes de `DISC-001` ont été tranchées le 2026-08-08. Ce document conserve les réponses et leurs conséquences. Une évolution ultérieure doit ajouter une entrée au journal de décisions.

## Q-001 — Usage des comptes connectés

- Question : le lobby peut-il exploiter le compte musical connecté par un participant ?
- Décision remplacée par D-027 : aucun participant ne connecte de compte musical pour le MVP. Tous les membres recherchent et mettent en file des vidéos publiques via la clé YouTube Data API du serveur.
- Garde-fous : la clé ne quitte jamais l'API ; le navigateur lecteur reçoit seulement l'identifiant public de la vidéo et utilise l'IFrame API officielle visible.
- Statut : `RESOLVED`.

## Q-002 — Sortie audio

- Question : faut-il piloter une application native ou lire dans le navigateur relié à l'enceinte ?
- Décision : une abstraction de lecture depuis le navigateur suffit au MVP. Chaque adaptateur traduit cette abstraction vers le mécanisme web officiel réellement disponible.
- Conséquence : le navigateur lecteur est l'unique sortie audio ; le pilotage d'un appareil natif reste une capacité future éventuelle.
- Statut : `RESOLVED`.

## Q-003 — File ou playlists

- Question : un lobby contient-il une seule file live ou plusieurs playlists nommées ?
- Décision : une seule file live pour le MVP.
- Conséquence : les playlists nommées et l'import/export restent post-MVP.
- Statut : `RESOLVED`.

## Q-004 — Fournisseurs prioritaires

- Question : quels fournisseurs intégrer en premier ?
- Décision remplacée par D-027 : YouTube est la seule intégration réelle du MVP, avec recherche de vidéos publiques et lecteur visible. Spotify et Deezer sont reportés.
- Garde-fou : le fake reste obligatoire et aucune capacité réelle n'est validée sans test avec une clé Google restreinte et une vidéo intégrable.
- Statut : `RESOLVED`.

## Q-005 — Participants sans fournisseur

- Question : un invité sans compte musical connecté peut-il utiliser les connexions du lobby ?
- Décision : oui. Tout membre du lobby peut rechercher, ajouter et lancer des vidéos publiques YouTube sans compte YouTube sur son propre appareil.
- Conséquence : les invités ne reçoivent aucune clé Google et ne s'authentifient jamais auprès de YouTube.
- Statut : `RESOLVED`.

## Q-006 — Droits dans le lobby

- Question : faut-il réserver la modération ou les contrôles à certains rôles ?
- Décision : non pour le MVP. Tous les membres peuvent ajouter, réclamer l'appareil lecteur et envoyer des commandes de lecture. Ils peuvent retirer et réordonner en mode normal ; D-031 suspend ces deux actions lorsque le blind test cache structurellement la file.
- Garde-fou : le bail garantit qu'un seul navigateur produit l'audio. La fermeture définitive du lobby reste réservée à son créateur afin d'éviter une suppression accidentelle par un invité.
- Suite : des politiques de permissions configurables sont prévues en V2.
- Statut : `RESOLVED`.

## Q-007 — Durée de vie et historique

- Question : combien de temps un lobby et ses connexions survivent-ils ?
- Décision de travail : expiration 24 heures après création par défaut, avec fermeture anticipée par le créateur et purge des secrets. Cette valeur est réversible par configuration avant le déploiement.
- Pourquoi : une durée courte correspond à une soirée et minimise la conservation des jetons.
- Statut : `RESOLVED_BY_ASSUMPTION`.

## Q-008 — Première cible de déploiement

- Question : l'application est-elle locale/LAN ou publique dès le MVP ?
- Décision : publique dès le MVP, avec développement local sous Docker Compose.
- Conséquence : HTTPS, domaine, cookies sécurisés, callbacks OAuth publics et gestion de secrets font partie du parcours réel.
- Statut : `RESOLVED`.

## Q-009 — Fournisseurs réels après vérification officielle

- Question : faut-il décaler les fournisseurs réels après un MVP au fake, accepter les contraintes du lecteur YouTube visible, ou changer plus profondément le contrat de lecture ?
- Décision remplacée par D-027 : accepter YouTube avec un lecteur vidéo visible, sans prétendre intégrer YouTube Music. Spotify et Deezer sont reportés.
- Limite acceptée : quota de recherche Google, vidéo et contrôles visibles, disponibilité territoriale et d'intégration, et éventuel geste utilisateur contre le blocage d'autoplay.
- Statut : `RESOLVED`.
