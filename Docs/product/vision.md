# Vision produit

## Pitch

EasyPlaylist transforme les téléphones d'un groupe en télécommandes musicales collaboratives. Les invités rejoignent un lobby en quelques secondes, utilisent les comptes musicaux consentis au lobby, cherchent un morceau et l'ajoutent à une file commune. Un seul navigateur reste relié à l'enceinte et exécute la lecture.

## Problème

Lors d'une soirée, la musique dépend souvent du téléphone d'une personne, de son abonnement et de son catalogue. Faire circuler l'appareil, envoyer des liens hétérogènes ou reconstruire une playlist à la main casse le rythme et exclut certains invités.

## Promesse

Permettre à chacun de contribuer sans prendre le contrôle physique de l'enceinte, tout en donnant au groupe une file cohérente, visible et maîtrisable.

## Piliers

### Entrer sans friction

Un lien ou un code, un pseudonyme, puis le lobby. Un compte EasyPlaylist permanent ne doit pas être requis pour contribuer.

### Une file réellement partagée

Les ajouts, suppressions, changements d'ordre et commandes de lecture sont ouverts à tous les membres et visibles en temps réel. Le serveur reste l'autorité sur la file ; un bail garantit qu'un seul navigateur produit l'audio.

### Des fournisseurs extensibles, pas uniformisés de force

Chaque fournisseur expose des capacités et contraintes différentes. EasyPlaylist normalise l'expérience commune, affiche les limites et dégrade proprement les fonctions indisponibles.

### Un seul lecteur, plusieurs contributeurs

Le lobby désigne un appareil lecteur relié à l'enceinte. Les autres appareils proposent et pilotent selon leurs droits, sans tenter de synchroniser plusieurs sorties audio.

### Confiance minimale

Les invités n'ont besoin d'aucun compte musical. Pour le MVP, YouTube fournit la recherche publique et une lecture IFrame visible, sans OAuth participant ni abonnement Premium. La clé de données reste côté serveur et les règles YouTube d'affichage, d'attribution et de lecture sont explicites.

## Utilisateurs

- Le créateur ouvre le lobby, partage l'invitation et peut fermer définitivement le lobby.
- Le lecteur est le navigateur actif relié à l'enceinte ; n'importe quel membre peut réclamer ce bail lorsqu'il est disponible.
- Le participant peut chercher des vidéos musicales YouTube publiques, ajouter, retirer, réordonner et piloter la lecture sans compte YouTube.

## Résultat recherché

En moins de deux minutes, un organisateur doit pouvoir créer un lobby accessible par lien, faire rejoindre deux téléphones sans compte musical, rechercher et ajouter des vidéos puis entendre la file depuis un seul navigateur qui conserve le lecteur YouTube visible.

## Principes de périmètre

- Prouver le parcours réel avec YouTube visible ; reporter Spotify, Deezer et les autres fournisseurs après le MVP.
- Préférer une file live robuste à une bibliothèque complète de playlists.
- Rendre explicite toute limitation de lecture ou d'abonnement.
- Ne pas contourner les conditions d'utilisation ou les mécanismes officiels des fournisseurs.
