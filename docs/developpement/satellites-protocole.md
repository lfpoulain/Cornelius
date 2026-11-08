# Protocole des satellites audio

Cette page décrit le dialogue entre Cornelius et un satellite audio (micro et haut-parleur sur ESP32-S3, par exemple la carte Waveshare ESP32-S3-AUDIO-Board). Elle s’adresse aux personnes qui écrivent le firmware, développé dans un dépôt séparé, et à celles qui modifient le serveur. Le protocole est versionné : toute modification incompatible change son numéro.

État : **version 1**. Veille (mot d’appel), conversation en voix seule, découverte mDNS, association et réglages depuis l’administration, écoute attentive avec annulation d’écho, sonnerie des alarmes. Les ajouts compatibles (champ ou message nouveau) gardent le numéro : un satellite les annonce dans `features`, et chaque côté ignore ce qu’il ne connaît pas. Le guide d’installation est dans [Les satellites audio](../fonctionnalites/satellites.md).

## Principe

- Un satellite ne parle qu’à Cornelius, jamais à OpenAI : la clé reste sur l’ordinateur du miroir, qui relaie le son vers une session Live.
- En veille, le satellite envoie le son de son micro ; l’ordinateur y cherche « Cornelius » avec le même modèle que le miroir. Le son n’est envoyé que lorsque le serveur le demande (message `listen`).
- Une seule conversation à la fois dans toute la maison : miroir ou un satellite.
- Quand le miroir et un satellite entendent « Cornelius » en même temps, l’appareil au meilleur score l’emporte.
- Une conversation de satellite est **en voix seule** : ni carte, ni image, ni caméra. Elle se termine après un silence (réglage **Fin de parole**, 20 s par défaut), ou quand le satellite se déconnecte.
- Par défaut, elle est **anonyme** : ni mémoire personnelle ni outils propres à une personne. Dans **Administration → Satellites audio**, un satellite peut être rattaché à un profil : ses conversations se tiennent alors au nom de cette personne, mémoire comprise, quelle que soit la personne qui parle dans la pièce.
- L’ouverture réservée aux membres du foyer n’accepte que les satellites rattachés à un profil : les autres ne voient personne et reçoivent `busy`.

## Connexion

| | |
|---|---|
| Adresse | `wss://<ordinateur>:3443/satellite` depuis le réseau local (accès réseau local activé), `ws://127.0.0.1:3000/satellite` depuis l’ordinateur lui-même |
| Authentification | en-tête `Authorization: Bearer <jeton>`, jeton créé dans l’administration et montré une seule fois |
| Origine | aucun en-tête `Origin` : un satellite n’est pas un navigateur |
| TLS | certificat auto-signé de Cornelius, signé en SHA-256 ; il change avec les adresses de l’ordinateur, pas sa clé. Le satellite épingle l’**empreinte SHA-256 de la clé publique** (SubjectPublicKeyInfo), affichée dans **Administration → Satellites audio** |
| Maintien | le serveur envoie un ping WebSocket toutes les 15 s et coupe un satellite muet depuis 30 s |

Un jeton inconnu ou révoqué est refusé (403) avant l’ouverture du WebSocket.

## Son

Le son circule en messages binaires, toujours au même format : PCM 16 bits signé little-endian, mono, 16 000 Hz.

| Sens | Trames | Rythme |
|---|---|---|
| satellite → serveur | exactement **2 560 octets** (1 280 échantillons, 80 ms) | celui du micro, sans regroupement |
| serveur → satellite | taille variable (en pratique 100 ms) | temps réel, **silences compris**, pendant toute la conversation |

Une trame montante d’une autre taille ferme la connexion. La voix de Cornelius arrive au rythme où elle doit être jouée : un tampon de lecture de 200 à 300 ms suffit. Quand Cornelius est interrompu ou se tait, le flux continue avec du silence ; il n’y a pas de message pour vider le tampon.

**Semi-duplex.** Sans annulation d’écho, le serveur remplace par du silence le son du micro tant que Cornelius parle, et 600 ms après. Le satellite continue d’envoyer ses trames normalement. Un satellite qui annonce `"aec": true` (annulation d’écho faite sur la carte, avec la voie de référence du haut-parleur) et dont l’**écoute attentive** est activée dans l’administration garde son micro ouvert : on peut alors couper la parole à Cornelius. Mesuré sur la Waveshare (ESP-SR, mode communication) : la voix de Cornelius baisse de 35 à 55 dB, jusqu’au bruit de fond du micro.

## Messages

Les autres messages sont des objets JSON en texte, avec un champ `type`. Un message inconnu est ignoré par le serveur, sauf avant `hello`.

### Satellite → serveur

| Message | Quand | Effet |
|---|---|---|
| `{"type":"hello","protocol":1,"firmware":"0.4.0","aec":false,"features":["ring"]}` | premier message, dans les 5 s | le serveur répond `welcome`, ou ferme si le protocole n’est pas pris en charge |
| binaire, 2 560 octets | tant que `listen` vaut `true` | veille : cherché pour « Cornelius » ; conversation : envoyé à Live |
| `{"type":"mic","muted":true}` | bouton de vie privée | le serveur ignore le son tant que le micro est coupé |
| `{"type":"ring","action":"stop"}` | bouton pendant que le satellite sonne | arrête ce qui sonne sur ce satellite |
| `{"type":"session","action":"end"}` | bouton pendant une conversation de ce satellite | ferme la conversation (« Fin de conversation au bouton du satellite. ») ; ignoré si la conversation en cours est celle d’un autre satellite ou du miroir |
| `{"type":"log","message":"…"}` | mesure à suivre (niveaux d’écho…) | inscrite dans le journal de Cornelius ; 200 caractères, une par seconde au plus, jamais de son ni de conversation |

`firmware` est une chaîne de 1 à 32 caractères ; `aec`, facultatif (faux par défaut), annonce l’annulation d’écho ; `features`, facultatif (16 chaînes au plus), les ajouts que le firmware connaît : `ring` pour la sonnerie des alarmes.

### Serveur → satellite

| Message | Sens |
|---|---|
| `{"type":"welcome","protocol":1,"id":"…","name":"Chambre","volume":70,"features":["session_end"]}` | connexion acceptée ; `volume` de 0 à 100 ; `features` : ce que le serveur sait faire (`session_end` : il accepte `session` / `end`, le bouton peut fermer la conversation) |
| `{"type":"settings","volume":70,"led":{"color":"#00ffb4","brightness":6,"nightLight":false},"attentive":false}` | réglages de l’administration : après `welcome`, puis à chaque changement ; volume de 0 à 100, luminosité de 0 à 10 (0 : alertes seulement), veilleuse en veille, écoute attentive |
| `{"type":"volume","volume":40}` | ancien message, remplacé par `settings` ; toujours accepté par le firmware |
| `{"type":"listen","enabled":true}` | envoyer (`true`) ou cesser d’envoyer (`false`) le son du micro ; envoyé après `welcome` puis à chaque changement |
| `{"type":"wake","score":0.93}` | « Cornelius » a été entendu par ce satellite (signal lumineux) |
| `{"type":"busy"}` | la conversation ne s’ouvre pas ici : une autre est en cours, ou l’ouverture est réservée aux membres |
| `{"type":"session","state":"connecting"}` | la conversation s’ouvre ; le son continue d’être envoyé (il est gardé, puis rejoué) |
| `{"type":"session","state":"ready"}` | la conversation est ouverte : la voix de Cornelius arrive en binaire |
| `{"type":"session","state":"closed"}` | la conversation est finie : arrêter la lecture |
| `{"type":"ring","state":"start","sound":"bips","soft":false}` | seulement si `features` contient `ring` : un réveil, un minuteur ou un rappel demandé sur ce satellite sonne. Le satellite synthétise lui-même la sonnerie, en boucle, volume croissant (`sound` : `bips`, `alerte` ou un son d’ouverture ; un son inconnu joue `bips`) ; `soft` : un rappel seul, carillon doux et espacé. Un nouveau `start` remplace le précédent |
| `{"type":"ring","state":"stop"}` | plus rien ne sonne ici, ou une conversation s’ouvre sur ce satellite : se taire |

`listen` vaut `true` pendant la veille et pendant la conversation de ce satellite ; il passe à `false` quand le mot d’appel est désactivé ou pas prêt, ou qu’une conversation se tient ailleurs.

### Sonnerie des alarmes

Une échéance réglée à la voix sur un satellite y sonne, si ce satellite annonce `ring` et reste connecté ; sinon elle sonne sur le miroir, y compris quand le satellite se déconnecte en pleine sonnerie. Le serveur envoie `ring: stop` dès qu’une conversation s’ouvre sur ce satellite (le mot d’appel doit donc rester audible par-dessus la sonnerie), puis `ring: start` de nouveau si l’échéance sonne encore à la fin. Dans la conversation, Cornelius annonce ce qui sonne et répond à « arrête » ou « encore dix minutes ». Un appui bref sur le bouton pendant la sonnerie l’arrête (`ring: action stop`) au lieu de couper le micro. Voir [Les alarmes et les rappels](../fonctionnalites/alarmes-et-rappels.md).

### Déroulé d’une conversation

1. Le satellite envoie son micro ; « Cornelius » est entendu.
2. `wake`, puis `session: connecting`. Le serveur garde le son qui précède le mot (environ 0,5 s) et celui qui suit : la question peut suivre sans pause.
3. `session: ready` (environ 1 s plus tard) : le son gardé part vers Live, puis le micro en direct ; la voix de Cornelius arrive.
4. Après le silence réglé, `session: closed`, puis `listen` reprend sa valeur de veille.

## Découverte

Cornelius s’annonce sur le réseau local en mDNS, service `_cornelius._tcp`, sur le port HTTPS (3443), sur chacune de ses interfaces. Le texte du service donne `path=/satellite`, `protocol=1` et `key` (empreinte de la clé, à titre indicatif). `CORNELIUS_MDNS=0` retire l’annonce.

Le satellite utilise l’adresse fixe qu’on lui a donnée, sinon celle trouvée par mDNS. L’ordinateur annonce toutes ses adresses : le satellite prend celle de son propre sous-réseau. Injoignable pendant 30 s, Cornelius est recherché de nouveau, adresse fixe comprise.

## Association

Un satellite sans jeton ouvre `wss://<adresse>:3443/satellite/pair`, sans en-tête `Authorization`, et retient la clé de ce premier Cornelius (confiance au premier contact).

| Sens | Message | Sens |
|---|---|---|
| satellite → serveur | `{"type":"pair","protocol":1,"device":"cornelius-satellite-b0c6b4","firmware":"0.2.0"}` | premier message, dans les 5 s ; `device` : 3 à 48 caractères parmi a-z, 0-9 et « - » |
| serveur → satellite | `{"type":"waiting"}` | le satellite apparaît dans **Administration → Satellites audio → Nouveaux satellites** |
| serveur → satellite | `{"type":"identify"}` | « Faire clignoter » : l’anneau clignote quelques secondes |
| serveur → satellite | `{"type":"paired","name":"Chambre","token":"…"}` | associé : le satellite enregistre le jeton et l’empreinte de la clé, puis redémarre et se connecte à `/satellite` |

Aucun droit n’est accordé sans le clic « Associer ». Le serveur garde au plus 8 satellites en attente.

## Fermetures

| Code | Raison |
|---|---|
| 1008 | `hello` absent, invalide ou de protocole non pris en charge ; trame invalide ; satellite révoqué ou reconnecté ailleurs |
| 1001 | arrêt du serveur |

Après une fermeture, le satellite se reconnecte avec un délai croissant (1 s, 2 s, 4 s… jusqu’à 60 s). Une déconnexion pendant la conversation la termine.

## Essayer sans matériel

Créer un satellite et afficher son jeton, dans **Administration → Satellites audio**, ou en ligne de commande :

```sh
npx tsx --env-file-if-exists=.env scripts/satellite-ajouter.ts "Bureau"
```

Puis simuler le satellite avec un enregistrement WAV (PCM mono 16 kHz) qui contient « Cornelius » et une question :

```sh
npx tsx scripts/satellite-sim.ts --token <jeton> --wav question.wav
```

Le simulateur envoie du silence, puis l’enregistrement, au rythme réel, affiche les messages du serveur et enregistre la voix de Cornelius dans `data/satellite-sim.wav`. Avec `--wake-only`, il s’arrête après la détection, sans conversation ni appel à OpenAI.

## À venir

- Mot d’appel détecté sur le satellite (`wake` envoyé par le satellite avec le son qui précède), vérifié par le serveur.
- Bouton d’action, mise à jour du firmware.
