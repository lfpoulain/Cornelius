# Installer Cornelius sous macOS

Cette page explique comment installer Cornelius sur un Mac, le faire démarrer seul et le mettre à jour. Elle s’adresse à la personne qui prépare le miroir. Il suffit de savoir ouvrir le Terminal et taper une commande.

## Ce qu’il faut

- Un Mac à puce Apple (M1 ou plus récent). Les Mac Intel ne sont pas pris en charge : ONNX Runtime et PyTorch, utilisés par la perception et les images, n’y sont plus publiés dans les versions de Cornelius.
- [Homebrew](https://brew.sh), pour installer git, Node.js 24 et Python 3.12.
- Une webcam (celle du Mac convient), un micro, des haut-parleurs et un écran.
- Un navigateur récent, par exemple Google Chrome, Chromium ou Safari.
- Une clé OpenAI d’un compte payant : sans elle, Cornelius ne peut pas parler.
- En option : un jeton Météo Concept et un jeton PRIM pour les modules Météo et Transports.

## Récupérer le code

```sh
brew install git
git clone https://github.com/lfpoulain/Cornelius.git
cd Cornelius
```

Toutes les commandes de cette page se lancent depuis ce dossier `Cornelius`.

## Installer en une commande

```sh
scripts/install-macos.sh --system-deps --launchd
```

Le script peut être relancé autant de fois que nécessaire. Il garde le fichier `.env`, l’environnement Python et les modèles déjà vérifiés.

| Option | Effet |
|---|---|
| `--system-deps` | Installe `git`, `node@24` et `python@3.12` avec Homebrew. |
| `--wake` | Installe l’écoute locale du mot d’appel « Cornelius ». |
| `--no-models` | Ne télécharge pas les modèles (visages, détection de la voix, vision 450M). |
| `--no-build` | Ne compile pas l’interface. `scripts/start.sh` la compilera au premier démarrage. |
| `--launchd` | Installe et démarre les deux services qui lancent Cornelius à l’ouverture de session. |
| `-h`, `--help` | Affiche l’aide. |

Voici ce que fait le script, dans l’ordre :

1. Il vérifie qu’il tourne sur un Mac à puce Apple.
2. Avec `--system-deps`, il installe `git`, `node@24` et `python@3.12` avec Homebrew. Ces deux dernières versions ne sont pas ajoutées au `PATH` par Homebrew : le script les trouve tout seul.
3. Il cherche Node.js 24.2 ou plus récent, dans la version 24 (fichier `.nvmrc`) : celui de Homebrew, sinon fnm ou nvm s’ils sont installés.
4. Il lance `npm ci`, `npm run setup` (crée `.env`) et `npm run build` (sauf avec `--no-build`).
5. Il crée l’environnement Python `.venv` en Python 3.12, avec `python3.12` s’il existe, sinon avec [uv](https://docs.astral.sh/uv/). Un `.venv` existant est gardé.
6. Il installe la perception (`perception/requirements.txt`), avec PyObjC qui permet de lister les caméras sous macOS.
7. Il télécharge les modèles, chacun vérifié par son empreinte SHA-256.
8. Avec `--wake`, il installe openWakeWord.
9. Il liste les caméras détectées.
10. Avec `--launchd`, il installe et démarre les services (voir plus bas).

## Renseigner la clé OpenAI

Comme sous Linux : collez la clé dans l’administration, rubrique **Mise en route**, carte **Clés et jetons**, ou ajoutez-la dans `.env` (`open -e .env`) après `OPENAI_API_KEY=`, puis redémarrez Cornelius. Changez aussi le mot de passe de l’administration (`cornelius` au départ).

## Autoriser la caméra

macOS protège la caméra : la première fois que la perception l’ouvre, il demande l’autorisation pour l’application qui l’a lancée (Terminal, iTerm…). Acceptez. Si la caméra reste « inaccessible » dans l’administration, ouvrez **Réglages Système → Confidentialité et sécurité → Caméra** et activez l’application concernée.

Avec les services launchd, c’est le Python de la perception qui demande l’accès, sans fenêtre pour le faire : lancez d’abord Cornelius une fois avec `scripts/start.sh` depuis le Terminal pour accepter la demande. Si la caméra reste refusée sous launchd, ajoutez le Python de `.venv` (le vrai fichier, donné par `readlink -f .venv/bin/python`) dans la liste **Caméra** des réglages ci-dessus.

Le micro, lui, est capturé par le navigateur : c’est lui qui demande l’autorisation.

## Services launchd

Avec `--launchd`, le script crée deux agents dans `~/Library/LaunchAgents/`, puis les démarre :

| Service | Rôle | En cas d’arrêt |
|---|---|---|
| `fr.cornelius.server` | Le serveur : administration, page du miroir, conversation. Il lance lui-même le générateur d’images. | Relancé après 3 s. |
| `fr.cornelius.perception` | La perception locale : caméra, détection de la voix, mot d’appel, vision. | Relancé après 3 s. |

Ils démarrent à l’ouverture de votre session. Pour que le miroir démarre seul, activez l’ouverture de session automatique dans **Réglages Système → Utilisateurs et groupes**.

Commandes utiles :

```sh
launchctl print gui/$(id -u)/fr.cornelius.server | head -20
launchctl kickstart -k gui/$(id -u)/fr.cornelius.server
launchctl kickstart -k gui/$(id -u)/fr.cornelius.perception
tail -f data/run/logs/server.err.log data/run/logs/perception.err.log
```

Pour arrêter et retirer les services :

```sh
launchctl bootout gui/$(id -u)/fr.cornelius.perception
launchctl bootout gui/$(id -u)/fr.cornelius.server
rm ~/Library/LaunchAgents/fr.cornelius.*.plist
```

Avec les services launchd, n’utilisez pas `scripts/start.sh` ni `scripts/restart.sh` : launchd relancerait aussitôt ses propres processus. Après un changement de version de Node.js, relancez `scripts/install-macos.sh --launchd`.

## Sans launchd : les scripts

Les scripts de Linux fonctionnent tels quels :

```sh
scripts/start.sh        # démarre Cornelius (production)
scripts/stop.sh         # arrête tout
scripts/restart.sh      # stop.sh puis start.sh
```

Leurs options et leurs journaux sont décrits dans [Installer sous Linux](linux.md#sans-systemd--les-scripts).

## Afficher le miroir

Ouvrez `http://127.0.0.1:3000/admin`, puis **Activer et ouvrir le miroir** (rubrique « Mise en route »). Sur Mac, le plein écran se fait avec **Ctrl + Cmd + F** (au lieu de F11). Pour éviter que l’écran se mette en veille, réglez **Réglages Système → Écran verrouillé**, ou laissez tourner `caffeinate -d` dans un Terminal.

Depuis un autre appareil, utilisez `https://<adresse du Mac>:3443/` : au premier démarrage, macOS demande s’il faut accepter les connexions entrantes pour `node` ; acceptez-les. Voir [Accès depuis le réseau local](../utilisation/reseau-local.md).

## Vision locale et images

- La vision locale tourne sur le processeur (graphes q4) : les puces Apple s’en sortent bien avec le modèle 450M.
- La génération d’images locale installe PyTorch depuis PyPI ; le générateur utilise alors le GPU de la puce Apple (MPS).

## Mettre à jour

Avec les services launchd, récupérez la nouvelle version puis relancez l’installateur : il arrête les services, met à jour les dépendances, recompile l’interface et redémarre les services.

```sh
git pull
scripts/install-macos.sh --launchd
```

Sans launchd :

```sh
scripts/stop.sh
git pull
scripts/install-macos.sh
scripts/start.sh
```

## Voir aussi

- [Premier démarrage](premier-demarrage.md)
- [Installer sous Linux](linux.md)
- [Configuration](../reference/configuration.md)
- [Dépannage](../utilisation/depannage.md)
