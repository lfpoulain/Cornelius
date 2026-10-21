# Historique des changements

Cette page retrace les grandes étapes de Cornelius, de la plus récente à la plus ancienne. Elle s’appuie sur l’historique Git et sur les notes datées des anciens documents. Aucune version n’est encore publiée : tout se trouve sous « Non publié ».

Le fonctionnement actuel est décrit dans la [documentation](docs/README.md). Ce qui reste à faire est dans la [feuille de route](docs/developpement/feuille-de-route.md).

## Non publié

### 2026-10-21 : macOS

**Ajouté**

- Installation sur Mac à puce Apple : `scripts/install-macos.sh` (Homebrew, Python 3.12, modèles, services launchd avec `--launchd`) et sa page [Installer sous macOS](docs/installation/macos.md).
- Perception : caméras lues avec AVFoundation sous macOS, listées grâce à PyObjC (installé seulement sur Mac).

**Modifié**

- `scripts/start.sh`, `stop.sh`, `restart.sh` et `dev.sh` fonctionnent aussi sous macOS (`stat` BSD).
- Génération d’images sous macOS : PyTorch vient de PyPI et utilise le GPU de la puce Apple (MPS).

### 2026-10-20 : contrat des modules 0.2.0

Cornelius passe en 0.2.0. Ces ajouts restent compatibles `apiVersion: 1` ; un module qui s’en sert déclare `minCoreVersion: '0.2.0'`.

**Ajouté**

- Affichage permanent recalculé à l’heure dite (`refreshAt`), sans réseau : l’horloge à chaque minute, le compte à rebours des bus, la météo à minuit.
- Arguments typés des outils vocaux (entier borné, choix, oui-non), contrôlés par le cœur et passés aux modules : « on fait quoi samedi ? », « et le SP98 ? ».
- Fuseau horaire du foyer donné aux modules (`CORNELIUS_TIMEZONE`, Europe/Paris par défaut).
- Les modules se présentent eux-mêmes dans l’administration (`display`) : nom, description, icône, groupe, mots-clés, exemple et phrase vocale. L’aperçu de chaque source vient de sa carte.
- Formulaire des sources : listes déroulantes (`enum`, `oneOf`) et listes répétées (`type: "array"`), erreurs sous chaque case.
- Client HTTP des modules : redirections GET suivies (trois au plus, sans passage à http ni jeton renvoyé ailleurs), encodage respecté, réponse coupée signalée (`truncated`), User-Agent par défaut, cache partagé facultatif (`cacheMs`).
- `createTestModule` dans `#cornelius/testing` : un module se teste en quelques lignes, contrat vérifié par `contract()`.

**Modifié**

- Un relevé vide est présenté par le module s’il sait le dire (« Aucun passage prévu »), avec le statut « empty » ; sinon la phrase générique, comme avant.
- Fraîcheur d’un relevé bornée à 24 heures au lieu d’une.
- Modules livrés : l’horloge, la météo (jours passés écartés, changement de jour à minuit) et les bus (compte à rebours, « aucun passage ») suivent l’heure du foyer.
- `npm test` et `npm run test:modules` n’affichent plus l’avertissement de SQLite.

### 2026-10-20 : modules externes

**Ajouté**

- Modules externes : Cornelius charge aussi le dépôt `cornelius-modules` cloné à côté de lui (ou `CORNELIUS_MODULES_DIR`), mis à jour sans mettre à jour Cornelius. Un module externe ne remplace jamais un module livré. `npm run test:modules` lance leurs tests.
- Champ facultatif `minCoreVersion` du contrat v1 : un module qui demande un Cornelius plus récent est refusé avec la raison.

**Modifié**

- Client HTTP des modules : une adresse qui redirige donne « La source renvoie vers une autre adresse : utiliser son adresse finale. » au lieu de « Connexion interrompue avant la réponse. ».
- Le tutoriel « Créer un module » et le gabarit `_template` passent dans [cornelius-modules](https://github.com/lfpoulain/cornelius-modules), où s’écrivent les nouveaux modules. Cornelius garde la page d’utilisation des modules et la référence du contrat.
- Les modules importent le contrat par `#cornelius/addons` et `#cornelius/validation`, et leurs tests le cœur par `#cornelius/testing`, au lieu de chemins `../../shared/` et `../../server/`.

### 2026-10-19 : satellites audio

**Ajouté**

- Satellites audio (Waveshare ESP32-S3-AUDIO-Board, firmware ESP-IDF séparé) : « Cornelius » entendu dans une autre pièce ouvre une conversation en voix seule, relayée par l’ordinateur vers OpenAI (session Live en WebSocket, PCM 16 kHz). Une seule conversation à la fois dans la maison ; le miroir affiche « Conversation en cours : » et la pièce.
- Mot d’appel sur plusieurs flux à la fois (un état openWakeWord par appareil) et départage du miroir et des satellites au meilleur score.
- Installation sans saisie : réseau de configuration du satellite pour le Wi-Fi, annonce mDNS de Cornelius (`_cornelius._tcp`, `CORNELIUS_MDNS`), association dans **Administration → Satellites audio**.
- Réglages de chaque satellite : pièce, conversations au nom d’une personne ou du foyer, volume, couleur et luminosité de l’anneau, veilleuse, écoute attentive (couper la parole à Cornelius grâce à l’annulation d’écho du satellite).
- Protocole des satellites documenté pour le firmware ; simulateur de satellite et sonde Live (`scripts/satellite-sim.ts`, `scripts/satellite-sonde.ts`).

**Modifié**

- Certificat du réseau local signé en SHA-256, et même clé gardée quand il est recréé : les satellites retiennent l’empreinte de cette clé.
- L’extracteur de souvenirs ne prend plus « Cornelius », l’assistant qu’on interpelle, pour le sujet d’un fait.

### 2026-10-15 : préparation de la publication

**Ajouté**

- `models/cornelius.onnx.LICENSE` : licence (CC BY-NC-SA 4.0) et attributions du modèle du mot d’appel, suivies par Git avec lui.
- `perception/install_wake_features.py` vérifie l’empreinte SHA-256 des deux modèles de prétraitement d’openWakeWord, et remplace un fichier abîmé.

**Modifié**

- Le générateur du mot d’appel quitte le dépôt et devient un projet séparé, [wakeword-generator](https://github.com/lfpoulain/wakeword-generator). Cornelius garde le modèle `models/cornelius.onnx`, prêt à l’emploi.
- Exemples et données de test neutres : prénoms, pièces et arrêts de bus fictifs ou génériques.

### 2026-10-08 : réglages depuis l’administration et miroir plus lisible

**Ajouté**

- Mot de passe administrateur changé depuis **Mise en route** (empreinte scrypt en base, prioritaire sur `.env`), les autres navigateurs étant déconnectés.
- Bouton « Redémarrer le serveur » dans **État du système** (systemd, ou nouvelle instance avec les scripts).
- Caméra : choix de la résolution (640 x 480, 1280 x 720 recommandée, 1920 x 1080) et des images par seconde (15, 30 recommandée), avec un conseil et l’image réellement reçue ; aperçu plus net.
- Taille de l’orbe réglable de 50 à 150 % dans **Personnaliser Cornelius**.
- Module « Cartes » : nombre de cartes à l’écran (1 à 4), durée d’affichage et cartes raccourcies ou entières au second plan.
- Caméra plus simple à régler : elle reste allumée tant que la page Caméra ou Visages est ouverte (même quand le mode d’ouverture l’éteint en veille), la liste ne se vide plus et le choix n’est plus grisé pendant une conversation ; un visage se mémorise quel que soit le mode d’ouverture.
- « Voir le miroir » et « Activer et ouvrir le miroir » ouvrent le miroir dans sa propre fenêtre, l’administration restant ouverte ; un second clic ramène la même fenêtre sans la recharger.
- Génération d’image avec OpenAI (images 1024 × 1024 acceptées par le miroir) : choix « Sur ce PC » ou « Avec OpenAI » dans le module, avec la même clé que la conversation (GPT Image 2.5 Flare par défaut, Sunburst ou GPT Image 1 mini, trois qualités) ; le générateur local s’arrête alors.
- Voix de Cornelius au choix parmi les 22 voix de GPT-Live (Cedar par défaut, Marin conseillée aussi pour le français) ; consignes de langue renforcées pour un français de France.

**Modifié**

- Caractère par défaut : pendant l’attente d’un résultat, Cornelius réfléchit à voix haute avec des tournures à rallonge au lieu de « je vais chercher ».
- Orbe grise en veille : rien n’est envoyé à OpenAI tant qu’aucune conversation n’est ouverte.
- Pastille de regard : maintenue 1,2 s et passage vert / gris en fondu, sans clignotement.
- Cartes du miroir un cinquième plus petites sur grand écran.
- Modules : une seule liste ; les commandes HTTP sont un module comme les autres (plus d’onglets Informations et Commandes).
- Home Assistant : après une commande, le nouvel état est guetté jusqu’à 3 secondes ; un appareil lent n’est plus annoncé « non confirmé ».
- Administration : écart entre les cartes de Mise en route et d’État du système.
- Carte Transports : plus de mention « (théorique) » ; Cornelius le précise seulement à l’oral.

**Corrigé**

- « Cornelius » pour tout le monde avec reconnaissance : la conversation se coupait juste après la question, sans reconnaître la personne. L’ouverture de la caméra bloquait l’écoute du micro par la perception ; elle se fait désormais en tâche de fond, et les 8 secondes pour reconnaître la personne comptent à partir de la première image de la caméra.
- Avec la reconnaissance cochée, « Cornelius » pour tout le monde garde la caméra allumée en veille : la personne est reconnue dès le mot d’appel. La perception ouvre directement la caméra et la résolution enregistrées, au lieu de l’entrée par défaut puis de la bonne.
- Micro gardé prêt signalé « Bêta » : il reste expérimental.
- Micro gardé prêt : la phrase dite pendant l’ouverture n’est plus rejouée avec ses blancs. Les silences sont raccourcis jusqu’à rattraper le direct, et Cornelius répond plusieurs secondes plus tôt.

### 2026-10-06 : réseau local, clés dans l’administration et licence

**Ajouté**

- Accès depuis le réseau local, en HTTPS (port 3443 par défaut) : miroir et administration sur un téléphone, une tablette ou un autre ordinateur ; certificat créé par Cornelius, appareils autorisés une fois par le mot de passe administrateur. `CORNELIUS_LAN=0` revient à l’ordinateur seul.
- Carte « Clés et jetons » dans Mise en route, et champ de saisie dans les modules : clé OpenAI et jetons Météo et Transports pris en compte sans redémarrage.
- Licence PolyForm Noncommercial 1.0.0 (`LICENSE`) et notices des projets tiers (`THIRD_PARTY_NOTICES.md`, `npm run notices`).

**Modifié**

- Miroir : plus de « Je vous écoute… » ni de « Je parle… » sous l’orbe ; seul « Je réfléchis… » reste.
- Miroir : informations permanentes un quart plus petites sur grand écran (1920 x 1080 et au-delà).

**Corrigé**

- Scripts de démarrage (Windows et Linux) : des dépendances incomplètes ou périmées sont réinstallées (`npm ci`) au lieu d’échouer sur « 'tsc' n’est pas reconnu » ou « Cannot find package …tsx ».

### 2026-10-06 : premier lancement, interface et documentation

**Ajouté**

- Rubrique « Mise en route » en tête de l’administration : elle liste ce qu’il reste à faire (clé OpenAI, service caméra, caméra, miroir, voix, visages, mot d’appel, mot de passe, accès OpenAI) et mène au bon réglage.
- Le miroir affiche en langage courant la raison pour laquelle Cornelius ne répond pas, sans motif technique.
- Le miroir signale quand il est affiché dans un autre onglet et propose **Afficher ici**.
- Les modules déclarent les jetons dont ils ont besoin : le badge « Jeton manquant » apparaît avant l’ajout d’une source.
- Un identifiant de source est déduit du nom affiché, et la phrase à dire pour obtenir l’information est proposée.
- Installation de la vision et de la génération d’images en trois étapes : choisir, installer, puis activer.
- Champs décimaux avec virgule, contraste élevé, confirmations accessibles au clavier et au lecteur d’écran.

**Modifié**

- Les demandes de l’administration au serveur sont limitées à 15 s, avec des messages compréhensibles.
- La session administrateur dure une heure après la dernière action, et la plus ancienne laisse sa place au lieu de refuser une nouvelle connexion.
- « Quand il écoute » : cartes réordonnées, réglages avancés repliés, « Micro gardé prêt » au lieu de « Tampon audio avancé ».
- Une seule barre « Enregistrer » / « Annuler » pour les réglages chiffrés, avec une garde avant de quitter la page.
- Miroir lisible à distance, en portrait comme en paysage, avec une seule ligne d’état.
- « Le foyer et les visages » : membres d’abord, consentement à la mémoire dès la création, noms uniques, suppression détaillée.
- Le vocabulaire de l’interface dit « Cornelius » au lieu de « Luna », et « service caméra » au lieu de « perception ».
- `scripts/start.sh` et `start.ps1` recompilent l’interface quand le code a changé.

**Documentation**

- Documentation réécrite et rangée par thème dans `docs/`, avec un README court à la racine. Les anciens documents datés sont supprimés : leur contenu encore exact est repris dans les nouvelles pages.

### 2026-10-05 : ouverture en deux questions, Linux et navigateur ordinaire

**Ajouté**

- Ouverture de la conversation en deux questions indépendantes : « Ce qui l’ouvre » (la présence, le regard ou « Cornelius ») et « Qui peut l’ouvrir » (tout le monde ou les membres du foyer). Elles remplacent les quatre modes et les cases qui se recouvraient. Les anciens réglages sont convertis au démarrage.
- Installation Linux (Debian, Ubuntu, Arch) avec `scripts/install-linux.sh` et deux services systemd (serveur et perception).
- Scripts de cycle de vie : `dev` (développement), `start` (production), `stop` et `restart`, en `.sh` et en `.ps1`.
- Son d’ouverture facultatif, au choix parmi six sons synthétisés sur place.
- **Fin de parole** : fermeture après un silence réglable (de 3 à 300 s, désactivée par défaut), même si la personne reste devant le miroir.
- **Reconnaître la personne pendant la conversation** avec « Cornelius » pour tout le monde : la caméra s’allume le temps de la conversation.
- **Accueil à l’ouverture** réglable : « Bonjour » et le prénom, accueil libre selon la personnalité, ou aucun accueil.
- Recherche web activable ou non dans **Modules**.
- Home Assistant : lecture des capteurs, import de la sélection Assist et option **Réserver aux personnes reconnues**.
- Génération d’images : préchargement du modèle, interruption réelle, rappel des trois dernières images, placement selon la mémoire graphique libre, PyTorch choisi selon la carte graphique (NVIDIA ou AMD).
- Gabarit de module dans `addons/_template`.

**Modifié**

- Présence plus stable : une identité confirmée tient tant que le visage reste suivi (8 s par défaut, réglable).
- Ouverture vocale plus rapide : la connexion n’attend plus le micro, et la session est prête plus tôt.
- Copies de sécurité de la base : seules les deux plus récentes sont gardées, et l’effacement d’un profil, d’un visage ou d’un souvenir s’y applique aussi.
- La description d’une image vue par la vision locale n’est plus dite deux fois.
- Cartes : une carte qui répète celle d’un module n’est plus empilée ; animation née de l’orbe.
- `start.ps1` explique pourquoi le serveur ne démarre pas.
- Tests rangés par outil (`tests/e2e`, `tests/python`), intégration continue sur la version de `.nvmrc`, avec contrôle du formatage.

**Retiré**

- Le lancement automatique d’un navigateur dédié au miroir (service systemd, profil de navigateur et scripts). Le miroir s’affiche désormais dans un navigateur ordinaire, en plein écran (F11).

### 2026-09-29 : licences

- Inventaire des licences du code, des polices, des composants et des modèles, avec une liste de vérifications avant publication.

### 2026-09-23 : agents Hermes et premier dépôt Git

- Connexion d’un agent personnel Hermes par personne : délégation de demandes longues, suivi des réponses, questions et accords.
- Premier enregistrement du projet dans Git.

### 2026-09-22 : mémoire, vision et affichage permanent

- Mémoire personnelle : extraction des souvenirs après la conversation, rappel à la demande, rubrique « Mémoire » pour consulter, corriger ou oublier.
- Vision locale : un seul modèle de description de scène (LFM2.5-VL, en 450M, 1,6B ou 3B), installable depuis l’administration. Le détecteur d’objets séparé est retiré.
- Questions visuelles ciblées, par exemple « De quelle couleur est ma tasse ? ».
- Affichage permanent des sources sur le miroir, sans demande vocale.
- Recherche web native dans la délégation, avec les liens des sources sur la carte.
- Démarrage audio accéléré : confirmations de présence et de regard raccourcies, micro préparé dès le premier visage.

### 2026-09-21 : outils seulement et modules découverts

- Plus aucun fait n’est préchargé à l’ouverture de la conversation : chaque information vient d’un appel d’outil.
- Les modules du dossier `addons/` sont découverts au démarrage et validés ; un module invalide est ignoré sans bloquer les autres.
- Audit complet du fonctionnement et des priorités.

### 2026-09-18 : étapes 3 et 4 validées

- Modules Météo (Météo Concept) et Transports (PRIM) vérifiés avec de vraies données, commandes HTTP, contrat des modules figé en version 1.
- Écran de diagnostic (santé des sources, dernières commandes) et recette guidée (`npm run recette`).
- Orbe plus lisible : états de connexion, d’écoute, de réflexion et de parole distincts.
- Trois modes d’ouverture (détection, identification, regard) et mode vie privée.

### 2026-09-17 : voix et caméra

- Conversation vocale en WebRTC, contrôlée par le serveur, avec délégation des recherches et des outils.
- Reconnaissance des visages (YuNet et SFace) et détection locale de la voix (Silero), premiers essais sous Windows.
- Accueil parlé quand une personne est reconnue.

### 2026-09-15 : spécification

- Architecture et plan de développement de la première version : miroir familial pour mini-PC Linux, conversation vocale, profils, cartes et modules.
