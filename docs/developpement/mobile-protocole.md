# Protocole du miroir natif — version 1

L’app s’associe avec une invitation à usage unique créée par `POST /api/admin/mobile/invitations` (session administrateur, mot de passe par défaut interdit). Le QR/lien `cornelius://pair?data=<JSON encodé base64url>` porte `protocol=1`, `serverId`, `keyFingerprint` (SHA-256 SPKI DER), `endpoints`, `invitation`, `expiresAt` (ms). Chaque endpoint contient une URL HTTPS d’origine et `trust=pinned|system`. `system` est réservé aux adresses `.ts.net` avec vérification TLS standard ; une découverte Bonjour est seulement une indication et n’établit aucune confiance.

`POST /mobile/pair`, JSON `{invitation,name}`, rend `{protocol,serverId,deviceId,token}` une fois. Le registre SQLite garde seulement SHA-256(token). Les invitations sont volatiles et expirent après cinq minutes ; un redémarrage les invalide. `GET /api/admin/mobile` liste les appareils, `DELETE /api/admin/mobile/devices/:id` révoque et ferme les flux.

Toutes les routes suivantes exigent `Authorization: Bearer <token>`, indépendamment de l’IP ou des cookies :

- `GET /mobile/info` : version, identité stable du serveur et adresse Tailscale configurée.
- WebSocket `/mobile/events` : prend la main comme miroir actif, rend `{type:"mobile",protocol,serverId,generation,endpoints}`, puis les événements `StateEvent`/`HeartbeatEvent` existants. Une connexion remplacée ferme avec 1008 et n’est pas reprise automatiquement.
- Contrôle entrant : `heartbeat`, `media_ready` avec `ready` booléen, `background` avec `enabled` booléen, et les commandes miroir existantes. Contrôle sortant : `capture` avec `enabled` indique la politique caméra ; `snapshot` demande une capture plus détaillée pour une analyse de scène.
- WebSocket `/mobile/audio?generation=<UUID>` : lié au propriétaire actif et à cette génération. Chaque trame montante binaire contient `interactionId + LF + PCM16LE`, ou `- + LF + PCM16LE` en veille. PCM mono 16 kHz, exactement 2560 octets (80 ms). Préambule de veille borné à 480 ms, ouverture bornée à 2,4 s. L’audio de veille n’est envoyé qu’au détecteur local ; seul l’audio d’une interaction admise est relayé au fournisseur.
- Sortie audio : PCM16LE mono 16 kHz, messages binaires en ordre. Suivre la lecture réelle, ne pas inventer un événement fournisseur de fin de parole. Vider la file lorsque l’interaction change, se ferme ou que le VAD serveur passe à l’écoute. Files de sortie bornées.
- WebSocket `/mobile/camera?generation=<UUID>` : JPEG binaire, maximum 240000 octets et cinq images/s. La taille JPEG est vérifiée avant décodage (maximum 1920×1080). Réception datée par le serveur ; jamais de profil déclaré par l’app. Une seule dernière image est gardée, fraîche pendant moins de deux secondes. Les observations du worker doivent porter la génération courante.
- `GET /mobile/images/:id.webp` : uniquement pour une image encore visible dans le contexte courant, avec le jeton ; pas de clé dans l’URL.

Les canaux séparés empêchent une image d’engorger la file audio/contrôle. Le serveur reste seul responsable des profils, époques, contextes, cartes, outils et arbitrages. Les schémas web/satellites restent en version 1 ; `mobileMirror` est un champ d’état facultatif ajouté. Une déconnexion native ferme la conversation ; une reconnexion garde l’association mais crée une nouvelle génération de source.

L’entrée proxy optionnelle doit être publiée sur la boucle locale de l’hôte. Son marquage est interne au processus, jamais dérivé d’un en-tête fourni par le client. Son allowlist s’applique avant le routage HTTP et WebSocket. Voir le guide d’installation iOS pour Tailscale Serve.
