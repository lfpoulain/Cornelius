# Configuration

Cette page liste tout ce qui se règle hors de l’administration : les variables du fichier `.env`, les ports et les dossiers où Cornelius range ses données. Elle s’adresse à la personne qui installe le miroir ou qui travaille sur son code. Les réglages faits dans l’administration sont décrits dans [L’administration](../utilisation/administration.md).

## Le fichier `.env`

Le fichier `.env` se trouve à la racine du projet. `npm run setup` le crée avec cinq lignes : `PORT`, `CORNELIUS_DATABASE`, `CORNELIUS_ADMIN_PASSWORD`, `CORNELIUS_PERCEPTION_TOKEN` (tiré au hasard) et `OPENAI_API_KEY` (vide). Relancé sur un fichier existant, il le garde, ajoute seulement le mot de passe, le jeton de la perception ou la ligne de la clé OpenAI s’ils manquent, et retire d’anciennes lignes devenues inutiles.

Le modèle `.env.example` décrit les autres lignes possibles. Copiez celles qui vous servent dans `.env`. Une ligne absente ou commentée (`#`) garde la valeur par défaut.

Quelques règles :

- une variable par ligne, sous la forme `NOM=valeur`, sans espace autour du `=` ;
- pas de commentaire en fin de ligne : la perception lirait le commentaire comme une partie de la valeur ;
- une variable déjà définie dans l’environnement du système l’emporte sur celle du fichier ;
- le fichier est lu au démarrage : **redémarrez Cornelius** après chaque modification (`scripts/restart.sh` sous Linux, `scripts\restart.ps1` sous Windows, ou `systemctl --user restart cornelius cornelius-perception` avec les services systemd).

Qui lit le fichier :

- le **serveur** (Node.js), lancé avec l’option `--env-file-if-exists=.env` par les scripts, par `npm start` et par le service systemd ;
- la **perception** (`perception/worker.py`) et le **générateur d’images** (`image_generation/worker.py`), qui le lisent eux-mêmes au démarrage ;
- **Vite**, en développement, qui y prend seulement `PORT` ;
- les **scripts** `scripts/*.sh` et `scripts/*.ps1`, qui y prennent seulement `PORT`.

Ne publiez jamais ce fichier : il contient le mot de passe et les clés. Il est déjà exclu de Git.

## Conversation et administration

| Variable | Défaut | Effet | Lue par |
|---|---|---|---|
| `OPENAI_API_KEY` | vide | Clé de l’API OpenAI, valeur de secours : une clé saisie dans **Mise en route → Clés et jetons** passe avant. Sans clé, aucune conversation ne s’ouvre et la mémoire ne retient rien. La rubrique **Mise en route** affiche alors l’étape **Clé OpenAI** à faire. | serveur |
| `CORNELIUS_ADMIN_PASSWORD` | `cornelius` (écrit par `npm run setup`) | Mot de passe de départ de l’administration, 4 caractères au moins. Un mot de passe choisi dans **Mise en route** le remplace (seule son empreinte est gardée en base). Le serveur refuse de démarrer sans lui. Tant qu’il vaut `cornelius`, la **Mise en route** demande de le changer. | serveur |
| `CORNELIUS_LOGIN_RATE_LIMIT` | `10` | Nombre de tentatives de connexion à l’administration permises par minute. Entier de 1 ou plus. | serveur |

## Serveur et base de données

| Variable | Défaut | Effet | Lue par |
|---|---|---|---|
| `PORT` | `3000` | Port du serveur, de 1024 à 65535, en HTTP sur la machine elle-même (`127.0.0.1`) seulement. La perception s’y connecte, et Vite y renvoie ses requêtes en développement. Les autres appareils passent par `CORNELIUS_HTTPS_PORT`. | serveur, perception, Vite, scripts |
| `CORNELIUS_DATABASE` | `data/cornelius.sqlite` | Chemin de la base SQLite, relatif à la racine du projet. Le journal s’écrit dans un dossier `logs/` placé à côté, et les copies de sécurité de la base aussi. La valeur spéciale `:memory:` garde la base en mémoire vive, sans fichier : elle sert aux tests. | serveur |
| `CORNELIUS_PERCEPTION_TOKEN` | créé par `npm run setup` | Jeton partagé entre le serveur et la perception, 32 caractères au moins. Sans lui, la perception refuse de démarrer et le serveur la refuse. | serveur, perception |

## Réseau local

Voir [Accès depuis le réseau local](../utilisation/reseau-local.md).

| Variable | Défaut | Effet | Lue par |
|---|---|---|---|
| `CORNELIUS_LAN` | `1` | `0`, `false`, `non` ou `no` : seul l’ordinateur lui-même ouvre le miroir et l’administration. Sinon, les appareils du réseau local y accèdent en HTTPS. | serveur |
| `CORNELIUS_HTTPS_PORT` | `PORT` + 443 (`3443`) | Port HTTPS ouvert au réseau local, de 1024 à 65535 et différent de `PORT`. | serveur |
| `CORNELIUS_TLS_CERT`, `CORNELIUS_TLS_KEY` | vides | Certificat et clé (fichiers PEM) à utiliser. Sans eux, Cornelius crée un certificat dans `data/tls` et le recrée quand l’adresse de la machine change, en gardant la même clé (celle que retiennent les satellites audio). | serveur |
| `CORNELIUS_MDNS` | `1` | `0`, `false`, `non` ou `no` : Cornelius ne s’annonce plus sur le réseau local (mDNS, service `_cornelius._tcp`) ; les [satellites audio](../fonctionnalites/satellites.md) ont alors besoin d’une adresse fixe. | serveur |
| `CORNELIUS_ALLOWED_HOSTS` | vide | Noms d’hôte acceptés en plus de `localhost`, des adresses IP locales et du nom de la machine (avec ou sans `.local`), séparés par des virgules. | serveur |

## Modules et commandes

| Variable | Défaut | Effet | Lue par |
|---|---|---|---|
| `CORNELIUS_METEO_CONCEPT_TOKEN` | vide | Jeton du service Météo Concept, utilisé par le module **Météo**. Un jeton saisi dans l’administration passe avant. Sans lui, le module affiche le badge « Jeton manquant ». | serveur |
| `CORNELIUS_PRIM_API_KEY` | vide | Jeton PRIM d’Île-de-France Mobilités, utilisé par le module **Transports**. Un jeton saisi dans l’administration passe avant. Sans lui, le module affiche le badge « Jeton manquant ». | serveur |
| `CORNELIUS_TIMEZONE` | `Europe/Paris` | Fuseau horaire du foyer (nom IANA, par exemple `Indian/Reunion` ou `America/Montreal`), donné aux modules : « aujourd’hui », « ce soir », les heures des rendez-vous et le changement de jour à minuit. Un nom inconnu est signalé au journal et remplacé par Europe/Paris. | serveur |
| `CORNELIUS_MODULES_DIR` | `cornelius-modules` à côté du dossier de Cornelius | Dossier des [modules externes](../modules/README.md#modules-externes), lu au démarrage en plus de `addons/`. Un chemin relatif part du dossier de lancement. | serveur |
| `CORNELIUS_SECRET_<NOM>` | aucune | Secret d’une commande HTTP (module **Commandes HTTP** de la rubrique **Modules**). Une commande l’utilise dans un en-tête ou dans son corps en écrivant `${secret:<NOM>}`. Par exemple, `CORNELIUS_SECRET_PORTAIL_TOKEN` se cite `${secret:PORTAIL_TOKEN}`. | serveur |

Les valeurs de `.env` ne sont jamais copiées dans la base ; un jeton saisi dans l’administration y est enregistré, sur cet ordinateur. Aucun n’est montré dans le journal, et les secrets `CORNELIUS_SECRET_*` ne se placent que dans `.env`. Où les obtenir est expliqué dans les fiches des modules ([Météo](../../addons/weather/README.md), [Transports](../../addons/transit/README.md)) et dans [Les modules](../modules/README.md).

## Caméra et vision locale

| Variable | Défaut | Effet | Lue par |
|---|---|---|---|
| `CORNELIUS_CAMERA_INDEX` | `0` | Numéro de la caméra (au sens d’OpenCV) ouverte par la perception au démarrage. | perception |
| `CORNELIUS_VISION_MODEL` | `450m` | Modèle de vision chargé au démarrage : `450m`, `1.6b` ou `3b`. Une autre valeur revient à `450m`. | perception, `perception/download_models.py` |
| `CORNELIUS_VISION_DEVICE` | `auto` | Calcul de la vision au démarrage : `auto` (carte graphique si disponible), `gpu` ou `cpu`. | perception, `perception/download_models.py` |
| `CORNELIUS_VISION_PROVIDER` | choix automatique | Moteur ONNX imposé : `CUDAExecutionProvider`, `MIGraphXExecutionProvider`, `ROCMExecutionProvider` (anciennes versions d’ONNX Runtime), `DmlExecutionProvider` ou `CPUExecutionProvider`. | perception, `perception/download_models.py` |
| `CORNELIUS_VISION_DEVICE_ID` | `0` | Numéro de la carte graphique utilisée par la vision. | perception |

`CORNELIUS_VISION_MODEL` et `CORNELIUS_VISION_DEVICE` ne donnent que la valeur de départ. Dès que la perception se connecte au serveur, le choix fait dans **Modules → Vision** (étape **Choisir le modèle** et réglage **Calcul**) les remplace. Voir [La vision locale](../fonctionnalites/vision-locale.md) et [Carte graphique](../installation/gpu.md).

## Mot d’appel

| Variable | Défaut | Effet | Lue par |
|---|---|---|---|
| `CORNELIUS_WAKE_MODEL` | `models/cornelius.onnx` | Fichier du modèle qui reconnaît « Cornelius ». Un chemin relatif part de la racine du projet. | perception |
| `CORNELIUS_WAKE_THRESHOLD` | `0.5` | Score à partir duquel le mot est reconnu, strictement entre 0 et 1. Une valeur hors de cette plage revient à `0.5`. Plus haut : moins de déclenchements par erreur, mais plus de mots manqués. | perception |

Voir [Le mot d’appel](../fonctionnalites/mot-d-appel.md).

## Génération d’images

Ces variables ne servent qu’au module **Génération d’image**. Les valeurs par défaut conviennent dans la plupart des cas : elles servent surtout aux cartes graphiques AMD et aux machines à mémoire partagée. Voir [Carte graphique](../installation/gpu.md).

| Variable | Défaut | Effet | Lue par |
|---|---|---|---|
| `CORNELIUS_IMAGE_BACKEND` | `auto` | Variante de PyTorch installée : `auto` (NVIDIA, sinon AMD avec ROCm, sinon processeur), `cuda`, `rocm` ou `cpu`. | installateur `image_generation/install.py` |
| `CORNELIUS_TORCH_VERSION` | `2.9.1` | Version de PyTorch à installer à la place de celle prévue. | installateur |
| `CORNELIUS_TORCH_INDEX_URL` | dépôt prévu pour la variante | Autre dépôt pip pour PyTorch, par exemple une préversion d’AMD. | installateur |
| `CORNELIUS_PYTHON` | `.venv`, sinon `python3` (`python` sous Windows) | Python qui lance l’installateur des images, et donc crée `.venv-image`. Pour l’installateur, cette variable passe avant `.venv`. Pour le téléchargement des modèles de vision, elle ne sert que si `.venv` manque. | serveur |
| `CORNELIUS_IMAGE_DEVICE` | `auto` | Calcul des images : `auto`, `cuda` (NVIDIA ou AMD avec ROCm), `mps` (Mac) ou `cpu`. | générateur d’images |
| `CORNELIUS_IMAGE_VRAM_GB` | vide (mémoire libre mesurée) | Mémoire graphique comptée, en Go. Utile sur un processeur Ryzen AI à mémoire partagée, où ROCm ne voit que la réserve fixée dans le BIOS. | générateur d’images |
| `CORNELIUS_IMAGE_CPU_OFFLOAD` | `auto` | Placement du modèle : `1` décharge vers le processeur, un composant à la fois ; `0` met tout en mémoire graphique ; toute autre valeur choisit selon la mémoire. | générateur d’images |
| `CORNELIUS_IMAGE_FP8` | `1` | `0` écarte l’étape intermédiaire en FP8, essayée quand le modèle ne tient pas entier en mémoire graphique. | générateur d’images |

Après un changement de `CORNELIUS_IMAGE_BACKEND`, `CORNELIUS_TORCH_VERSION` ou `CORNELIUS_TORCH_INDEX_URL`, réinstallez le modèle depuis **Modules → Génération d’image** pour qu’il soit pris en compte.

## Variables internes

Ces variables existent dans le code, mais ne se mettent pas dans `.env` en usage normal.

| Variable | Rôle | Lue par |
|---|---|---|
| `CORNELIUS_IMAGE_GENERATION_TOKEN` | Jeton entre le serveur et le générateur d’images. Le serveur en tire un au hasard à chaque démarrage et le transmet lui-même au générateur. | serveur, générateur d’images |
| `CORNELIUS_ORIGIN` | Adresse du serveur pour un générateur d’images lancé à la main. Le serveur passe déjà cette adresse au générateur qu’il lance. Défaut : `http://127.0.0.1:3000`. | générateur d’images |
| `PYTHONUTF8` | Mis à `1` par le serveur pour les programmes Python qu’il lance, afin que leurs messages restent lisibles sous Windows. | Python |
| `CORNELIUS_E2E_PORT` | Port du serveur lancé par les tests navigateur (`npm run test:e2e`). Défaut : `3101`. | `tests/e2e/env.ts`, `playwright.config.ts` |

## Les ports

| Port | Service | Réglage |
|---|---|---|
| `3000` | Le serveur sur cet ordinateur : miroir (`/`), administration (`/admin`), API et liaison avec la perception. | `PORT` dans `.env` |
| `3443` | Le même serveur en HTTPS, pour les autres appareils du réseau local. | `CORNELIUS_HTTPS_PORT` (désactivé par `CORNELIUS_LAN=0`) |
| `5173` | L’interface en développement (Vite), avec rechargement à chaud. Lancée seulement par `scripts/dev.sh` ou `scripts\dev.ps1`. | fixe, dans `vite.config.ts` |
| `3101` | Le serveur des tests navigateur. | `CORNELIUS_E2E_PORT` |
| `5353` (UDP) | L’annonce mDNS de Cornelius, pour que les satellites audio le trouvent. | `CORNELIUS_MDNS` |

Les ports `3000` et `5173` n’écoutent que sur `127.0.0.1`. Seul le port `3443` est ouvert au réseau, en HTTPS : il refuse les adresses publiques (« Accès réservé au réseau local. ») et les noms d’hôte inconnus (« Hôte non autorisé. »), et réserve la perception et le générateur d’images à l’ordinateur lui-même.

## Les dossiers

| Dossier | Contenu | Créé par |
|---|---|---|
| `data/cornelius.sqlite` | La base : profils, signatures des visages, souvenirs, réglages, sources des modules, connexions Home Assistant et Hermes. | le serveur |
| `data/cornelius.sqlite.backup-v…sqlite` | Copies de sécurité faites avant une mise à jour de la base. Les deux plus récentes sont gardées. | le serveur |
| `data/logs/cornelius.log` | Le journal du serveur (rubrique **Journal**). Au-delà de 5 Mo, il est renommé en `.1`, puis `.2` et `.3`, et une ancienne copie disparaît. | le serveur |
| `data/run/` | Numéros des processus lancés par les scripts (`*.pid`). | les scripts |
| `data/run/logs/` | Sortie des services lancés par les scripts : `backend.*.log` (serveur), `perception.*.log`, `frontend.*.log` (Vite). Avec systemd, lisez plutôt `journalctl --user -u cornelius`. | les scripts |
| `data/generated-images/` | Les trois dernières images créées. Vidé à chaque démarrage du serveur. | le serveur |
| `data/screensaver/` | Les images de l’écran de veille : photos envoyées et peintures téléchargées. | le serveur |
| `models/` | Modèles locaux : `yunet.onnx` (détection des visages), `sface.onnx` (reconnaissance), `silero.onnx` (détection de la parole), `lfm2.5-vl-450m/`, `lfm2.5-vl-1.6b/`, `lfm2.5-vl-3b/` (vision), `openwakeword/` et `cornelius.onnx` (mot d’appel), `image-generation/<modèle>/` (images). Les modèles de visages, de parole et de vision sont téléchargés avec leur licence. | `perception/download_models.py`, l’administration, `perception/install_wake_features.py` |
| `.venv/` | L’environnement Python 3.12 de la perception. | `scripts/install-linux.sh`, ou à la main sous Windows |
| `.venv-image/` | L’environnement Python séparé du générateur d’images (PyTorch, Diffusers). | l’installation d’un modèle depuis **Modules → Génération d’image** |
| `dist/web/` | L’interface compilée, servie en production. | `npm run build` (les scripts `start` le lancent si besoin) |
| `.local/` | Sorties jetables : captures et résultats des tests navigateur, outil `uv` de l’installateur Linux. Tout peut être supprimé. | tests, `scripts/install-linux.sh` |

`data/` et la base, `models/` (sauf `models/cornelius.onnx` et sa licence), `.venv/`, `.venv-image/`, `dist/`, `.local/` et `.env` sont exclus de Git. Avant de publier le dépôt, voir [Licences](licences.md#avant-de-publier-le-dépôt).

## Voir aussi

- [Installation sous Linux](../installation/linux.md)
- [Installation sous Windows](../installation/windows.md)
- [Carte graphique](../installation/gpu.md)
- [Confidentialité](confidentialite.md)
- [Dépannage](../utilisation/depannage.md)
- [Les modules](../modules/README.md)
