# MVP

## Contrat principal

Une soirée utilise un lobby éphémère accessible par lien et une file ordonnée unique. Un navigateur relié à l'enceinte détient un bail de lecture exclusif. Tous les membres utilisent EasyPlaylist pour rechercher des vidéos musicales YouTube publiques, les mettre en file et commander la lecture. Aucun compte musical ni abonnement Premium n'est requis ; la vidéo YouTube reste visible sur le navigateur lecteur.

Un téléphone ou un nouvel onglet qui rejoint pendant un titre reçoit le titre courant et les commandes collaboratives, mais reste silencieux : il ne crée aucun lecteur multimédia tant que son propre onglet ne détient pas le bail lecteur.

Le MVP cible YouTube selon D-027. La recherche utilise une clé YouTube Data API v3 côté serveur et la lecture l'IFrame Player API officielle côté navigateur. EasyPlaylist n'intègre pas YouTube Music, n'isole pas l'audio et ne masque pas le lecteur ou ses contrôles. Spotify et Deezer sont reportés.

Le créateur peut activer à tout moment un mode blind test persistant. La file publique devient alors un simple compteur, le titre courant est remplacé par le pseudonyme de son auteur et les transitions ne révèlent aucune réponse. Retrait et réordonnancement sont suspendus côté serveur, tandis que recherche, ajout, bail et commandes de lecture restent disponibles. Seul le détenteur du bail reçoit l'identifiant fournisseur minimal ; son IFrame YouTube reste visible conformément à D-027. Désactiver le mode restaure immédiatement la présentation normale, sans mécanisme de reveal, minuteur ou score.

## Parcours nominal

1. L'organisateur crée un lobby nommé et reçoit un code et un lien.
2. Il rejoint automatiquement avec un pseudonyme et devient propriétaire.
3. Deux invités rejoignent depuis leur téléphone, sans compte permanent.
4. L'instance EasyPlaylist possède une clé YouTube Data API v3 restreinte côté serveur ; aucun participant ne connecte de compte YouTube.
5. N'importe quel membre fait réclamer à son navigateur le bail lecteur et le relie à l'enceinte.
6. Les participants recherchent depuis EasyPlaylist des vidéos musicales YouTube publiques intégrables dans leur région.
7. Chacun ajoute un titre ; la file se met à jour pour tous.
8. N'importe quel membre démarre, met en pause si disponible ou passe ; en mode normal, il peut aussi retirer ou réordonner. Le navigateur détenteur du bail produit l'audio et l'état courant est diffusé au lobby.
9. Le créateur ferme le lobby, ou celui-ci expire après 24 heures, ce qui provoque la purge planifiée des secrets associés.

Pour le MVP, le bail lecteur expire après six secondes sans heartbeat et le navigateur le renouvelle toutes les deux secondes. Une fin, un passage ou un échec fait avancer automatiquement la file vers le prochain titre jouable ; l'échec reste visible comme dernière transition.

Sur l'écran du lobby, la hiérarchie visuelle suit l'usage pendant la soirée : lecteur en cours, file collaborative, puis recherche. Le partage et la fermeture restent disponibles dans les réglages compacts ; les diagnostics de fournisseur ne sont affichés que lorsqu'une erreur affecte la recherche ou la lecture.

## Inclus

- création et jonction par code/lien ;
- identité invitée locale, droits collaboratifs ouverts et créateur identifié pour la fermeture ;
- présence et file synchronisées en temps réel ;
- clé YouTube Data API v3 gardée côté serveur et configuration régionale ;
- recherche normalisée avec provenance et erreurs partielles ;
- une file ordonnée, historique court et titre courant ;
- un bail exclusif et transférable pour le navigateur lecteur ;
- lecture navigateur via l'IFrame Player API officielle dans une vidéo visible avec contrôles YouTube ;
- recherche YouTube accessible à tous les membres via l'API serveur, sans token ni compte YouTube ;
- mode blind test activable par le créateur, avec file et lecture expurgées pour les participants non lecteurs ;
- contrôles ouverts à tous : ajouter, démarrer, pause si disponible et passer, plus retirer et réordonner hors blind test ;
- expiration à 24 heures par défaut et purge des secrets ;
- Docker Compose pour le web, l'API et PostgreSQL ;
- tests de contrats, API, temps réel et parcours navigateur.

## Hors MVP

- comptes EasyPlaylist permanents et profils sociaux ;
- plusieurs playlists nommées dans un lobby ;
- synchronisation de plusieurs enceintes ou appareils audio ;
- crossfade, mixage, normalisation audio ou téléchargement ;
- recommandations, votes, chat et statistiques avancées ;
- reveal automatisé, minuteur, réponses et score de blind test ;
- import/export de bibliothèques complètes ;
- application mobile native ;
- Spotify, Deezer, SoundCloud, YouTube Music et toute seconde intégration réelle ;
- audio YouTube isolé, lecteur masqué, lecture en arrière-plan ou téléchargement ;
- permissions configurables ou rôles de modération ;
- haute disponibilité multi-instance ou cache distribué.

## Critères de succès

- Le parcours nominal fonctionne sur un environnement Docker vierge.
- Deux navigateurs mobiles et un navigateur lecteur observent le même ordre et le même titre courant après reconnexion.
- Une action rejouée à cause d'une reconnexion ne crée pas de doublon dans la file.
- Aucun secret fournisseur n'apparaît dans le navigateur, les événements temps réel ou les logs.
- La perte du navigateur lecteur n'arrête pas le lobby : le bail expire et peut être réclamé par n'importe quel membre.
- Un invité sans compte YouTube peut chercher des vidéos réelles, ajouter un résultat et commander la lecture sans recevoir de clé API.
- Une panne ou un quota YouTube épuisé ne bloque ni l'accès au lobby ni la manipulation de la file ; il produit un état fournisseur dégradé explicite.
- Les limites d'abonnement, de disponibilité ou de lecture sont expliquées avant l'ajout ou au moment de l'échec.
- En blind test, deux participants non lecteurs ne reçoivent ni métadonnée de file ni identifiant YouTube et retrouvent le même compteur et le même pseudonyme après reconnexion.

## Jalon de validation utilisateur

Le candidat MVP est remis avec un script de démonstration court : un organisateur ouvre le site et crée un lobby ; deux invités sans compte musical rejoignent, recherchent et ajoutent au moins quatre vidéos ; plusieurs membres modifient et pilotent la file ; le créateur active le blind test et les appareils non lecteurs ne voient que le compteur et le pseudonyme de l'auteur ; le navigateur lecteur affiche et diffuse la vidéo YouTube, le groupe perd/reprend le bail, repasse en mode normal, passe un titre et ferme le lobby.
