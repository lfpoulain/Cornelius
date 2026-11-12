# Installer Cornelius sous Linux

Cette page explique comment installer Cornelius sur un ordinateur Linux (Debian, Ubuntu, Arch ou une distribution dérivée), le faire démarrer seul et le mettre à jour. Elle s’adresse à la personne qui prépare le miroir. Il suffit de savoir ouvrir un terminal et taper une commande.

## Ce qu’il faut

- Un ordinateur x86-64 ou ARM64 sous Debian, Ubuntu, Arch ou une dérivée. Le script reconnaît les familles Debian (dont Ubuntu) et Arch. Sur Raspberry Pi, lisez aussi [Installer sur Raspberry Pi](raspberry-pi.md).
- Un compte avec `sudo`, pour installer les paquets du système.
- Une webcam, un micro, des haut-parleurs et un écran.
- Un navigateur récent, par exemple Chromium ou Google Chrome.
- Une clé OpenAI d’un compte payant : sans elle, Cornelius ne peut pas parler.
- Node.js 24 (version 24.2 ou plus récente) et Python 3.12. Le script d’installation les installe, avec l’aide de fnm pour Node.js (voir « Préparer Node.js 24 »).
- En option : une carte graphique (voir [GPU](gpu.md)), un jeton Météo Concept et un jeton PRIM pour les modules Météo et Transports.

## Récupérer le code

Git télécharge Cornelius ; curl et unzip servent à installer Node.js à l’étape suivante. Installez-les s’ils manquent, puis clonez le dépôt :

```sh
sudo apt install git curl unzip        # Debian, Ubuntu
sudo pacman -S git curl unzip          # Arch
git clone https://github.com/lfpoulain/Cornelius.git
cd Cornelius
```

Toutes les commandes de cette page se lancent depuis ce dossier `Cornelius`.

## Préparer Node.js 24

Vérifiez la version de Node.js :

```sh
node --version
```

Il faut `v24.2.0` ou plus récent dans la version 24. Ubuntu et Debian fournissent une version plus ancienne, ou aucune. Dans ce cas, installez fnm, un gestionnaire de versions de Node.js qui travaille dans votre dossier personnel, sans droits administrateur :

```sh
curl -fsSL https://fnm.vercel.app/install | bash
```

Fermez le terminal, ouvrez-en un nouveau (fnm n’est actif que dans les nouveaux terminaux), puis revenez dans le dossier :

```sh
cd Cornelius
```

Inutile d’installer Node.js vous-même : le script d’installation le fait avec fnm, à la version prévue. Si nvm est déjà installé (dans `~/.nvm` ou le dossier indiqué par `NVM_DIR`), il s’en sert de la même façon.

## Installer en une commande

```sh
scripts/install-linux.sh --system-deps --systemd
```

Le script peut être relancé autant de fois que nécessaire. Il garde le fichier `.env`, l’environnement Python et les modèles déjà vérifiés.

| Option | Effet |
|---|---|
| `--system-deps` | Installe les paquets du système avec `sudo` : apt sur Debian et Ubuntu, pacman sur Arch. |
| `--gpu auto\|cpu\|nvidia\|amd` | Moteur de calcul de la vision locale. `auto` (par défaut) choisit NVIDIA si une carte NVIDIA répond, sinon le processeur. `amd` est réservé aux Radeon dédiées avec ROCm. En ARM64, seuls `auto` et `cpu` sont acceptés. Voir [GPU](gpu.md). |
| `--wake` | Installe l’écoute locale du mot d’appel « Cornelius ». |
| `--no-models` | Ne télécharge pas les modèles (visages, détection de la voix, vision 450M). |
| `--no-build` | Ne compile pas l’interface. `scripts/start.sh` la compilera au premier démarrage. |
| `--systemd` | Installe et démarre les deux services qui lancent Cornelius au démarrage de l’ordinateur, même sans session ouverte (demande le mot de passe `sudo`). |
| `-h`, `--help` | Affiche l’aide. |

Voici ce que fait réellement le script, dans l’ordre :

1. Avec `--system-deps`, il installe `git`, `ca-certificates`, `curl`, `python3`, `python3-venv`, `iproute2` et `procps` (Debian, Ubuntu), ou `git`, `python`, `uv`, `iproute2` et `procps-ng` (Arch). Il n’installe pas Node.js.
2. Il cherche Node.js 24.2 ou plus récent, dans la version 24 (fichier `.nvmrc`). Si fnm ou nvm est présent, il installe et active la bonne version. Sinon, il s’arrête avec un message qui propose d’installer fnm : voir « Préparer Node.js 24 » ci-dessus, puis relancez le script.
3. Il lance `npm ci` (dépendances), `npm run setup` (crée `.env`, voir plus bas) et `npm run build` (compile l’interface, sauf avec `--no-build`).
4. Il crée l’environnement Python `.venv` en Python 3.12, la version validée. Ubuntu 24.04 fournit Python 3.12. Sur Debian 12 (Python 3.11), Debian 13 et Arch (versions plus récentes), il passe par [uv](https://docs.astral.sh/uv/), qui télécharge un Python 3.12 autonome sans toucher au Python du système. Un `.venv` existant est gardé ; s’il n’est pas en 3.12, un avertissement vous invite à le supprimer pour le recréer.
5. Il installe la perception (`perception/requirements.txt`), puis le moteur de la vision choisi par `--gpu`.
6. Il télécharge les modèles, chacun vérifié par son empreinte SHA-256, avec `perception/download_models.py --device auto`.
7. Avec `--wake`, il installe openWakeWord et prévient si le modèle `models/cornelius.onnx` manque. Ce modèle est fourni dans le dépôt : voir [Mot d’appel](../fonctionnalites/mot-d-appel.md).
8. Il liste les caméras `/dev/video*` et signale celles qui ne sont pas lisibles.
9. Avec `--systemd`, il installe et démarre les services, puis les autorise à tourner sans session ouverte (voir plus bas).
10. Si l’administration a encore le mot de passe de départ `cornelius`, il vous en demande un autre (8 caractères au moins, saisie masquée, Entrée pour le faire plus tard). Depuis un autre appareil, l’administration refuse de s’ouvrir avec le mot de passe de départ : sur une installation par SSH, c’est le moment de le changer. Hors d’un terminal (installation automatisée), il passe sans rien demander.

À la fin, il affiche l’adresse de l’administration, sur cet ordinateur et depuis un autre appareil du réseau, et rappelle la clé OpenAI si elle manque.

Si le script s’arrête en route, corrigez la cause puis relancez-le avec les mêmes options. Il refait chaque étape, mais garde ce qui est déjà prêt. Deux cas courants :

- un téléchargement de modèle échoue (connexion coupée, accès refusé par un proxy) : le message se termine par une erreur réseau, par exemple `<urlopen error ...>`. Relancez quand la connexion revient. Les petits modèles déjà vérifiés sont gardés ;
- le dernier message est `Failed to connect to bus` : systemd n’est pas disponible pour votre compte (conteneur, WSL sans systemd, session ouverte sans systemd). Tout le reste est installé : démarrez avec `scripts/start.sh` (voir [Sans systemd](#sans-systemd--les-scripts)) au lieu des services.

## Renseigner la clé OpenAI

`npm run setup` crée le fichier `.env` à la racine du dossier, lisible par vous seul. Il contient le port (`PORT=3000`), la base de données, le mot de passe de l’administration (`cornelius` au départ), un jeton privé pour la perception et une ligne `OPENAI_API_KEY=` vide. Sur un `.env` existant, il ne change rien et complète seulement les lignes manquantes.

Le plus simple : collez la clé dans l’administration, rubrique **Clés et accès**, carte **Clés et jetons** ; elle compte tout de suite. Vous pouvez aussi ouvrir `.env` avec un éditeur de texte et coller votre clé après le signe égal :

```sh
nano .env
```

```sh
OPENAI_API_KEY=sk-...
```

Le mot de passe de l’administration se change avec `npm run password`, dans le dossier de Cornelius : il compte aussitôt, sans redémarrage, comme celui choisi dans **Clés et accès**. Après une modification de `.env`, redémarrez le serveur pour qu’il lise le fichier :

```sh
systemctl --user restart cornelius        # avec les services systemd
scripts/restart.sh                        # sans systemd
```

La clé reste sur cet ordinateur : dans `.env`, ou dans la base si elle est collée dans l’administration. Elle n’est jamais renvoyée au navigateur, qui n’en voit que les quatre derniers caractères. Les autres réglages possibles de `.env` (jetons des modules, caméra, vision, images) sont décrits dans [Configuration](../reference/configuration.md) et commentés dans `.env.example`.

## Services systemd

Avec `--systemd`, le script crée deux services « utilisateur » dans `~/.config/systemd/user/`, puis les active et les démarre :

| Service | Rôle | En cas d’arrêt |
|---|---|---|
| `cornelius` | Le serveur : administration, page du miroir, conversation. Il lance lui-même le générateur d’images. | Relancé après 3 s. |
| `cornelius-perception` | La perception locale : caméra, détection de la voix, mot d’appel, vision. | Relancé après 3 s. |

Commandes utiles :

```sh
systemctl --user status cornelius cornelius-perception
systemctl --user restart cornelius cornelius-perception
systemctl --user stop cornelius-perception cornelius
journalctl --user -u cornelius -f
journalctl --user -u cornelius-perception -f
```

Par défaut, systemd ne fait tourner les services d’un compte que pendant une session ouverte : ils s’arrêteraient à la fermeture du terminal SSH et ne démarreraient pas avec l’ordinateur. Le script lève cette limite avec `sudo loginctl enable-linger "$USER"`, qui demande votre mot de passe. Sans droits `sudo`, il prévient : faites-le alors faire une fois par un administrateur. Pour vérifier :

```sh
loginctl show-user "$USER" -p Linger     # Linger=yes
```

Les services utilisent le chemin de Node.js trouvé pendant l’installation. Après un changement de version de Node.js, relancez `scripts/install-linux.sh --systemd` pour les mettre à jour.

Une variable propre à la machine (par exemple pour ROCm) se place dans `.env` : le serveur la lit au démarrage et la transmet au générateur d’images, la perception lit aussi `.env`. Pour une variable qui doit exister avant ce chargement, utilisez `systemctl --user edit cornelius-perception` et une ligne `Environment=`.

Avec les services systemd, n’utilisez pas `scripts/start.sh` ni `scripts/restart.sh` : systemd relancerait aussitôt ses propres processus et les deux copies se disputeraient le port.

## Sans systemd : les scripts

```sh
scripts/start.sh        # démarre Cornelius (production)
scripts/stop.sh         # arrête tout
scripts/restart.sh      # stop.sh puis start.sh
```

`scripts/start.sh` vérifie d’abord Node.js, les dépendances et `.env`, et s’arrête avec un message clair s’il manque quelque chose. Il compile l’interface si elle n’existe pas encore ou si le code a changé depuis la dernière compilation, arrête une instance précédente, puis lance le serveur et la perception en arrière-plan. Il attend enfin que le serveur réponde et affiche son adresse.

Options de `start.sh` et `restart.sh` :

- `--build` recompile l’interface même si elle est à jour ;
- `--no-perception` ne lance pas la perception ;
- `--timeout SECONDES` change l’attente du serveur (60 s par défaut).

`scripts/dev.sh` lance en plus l’interface de développement sur le port 5173 : il sert à modifier le code, pas au miroir. Voir [Développement](../developpement/README.md).

Les journaux de ces scripts sont dans `data/run/logs/` : `backend.out.log` et `backend.err.log` pour le serveur, `perception.out.log` et `perception.err.log` pour la perception. Le serveur écrit aussi son journal détaillé dans `data/logs/cornelius.log`, que l’administration affiche dans la rubrique « Journal ».

`scripts/stop.sh` arrête aussi tout programme qui écoute sur le port de Cornelius (3000 par défaut) ou sur le port de l’interface de développement (5173, ou `CORNELIUS_DEV_PORT`), et toute perception ou tout générateur d’images de Cornelius encore actif, même lancé depuis un autre dossier. Si une autre application utilise le port 3000, choisissez un autre `PORT` dans `.env` (de 1024 à 65535), puis relancez : les adresses deviennent alors `http://127.0.0.1:PORT/admin` et `http://127.0.0.1:PORT/`.

## Afficher le miroir

En HTTP, le serveur n’écoute que sur l’ordinateur lui-même (adresse `127.0.0.1`). Les autres appareils de la maison passent par HTTPS, voir [Accès depuis le réseau local](../utilisation/reseau-local.md). Le miroir et l’administration s’ouvrent donc dans un navigateur de cette machine :

- l’administration : `http://127.0.0.1:3000/admin` ;
- le miroir : `http://127.0.0.1:3000/`.

Le plus simple est de se connecter à l’administration, puis d’utiliser **Activer et ouvrir le miroir** (rubrique « Mise en route », étape « Miroir ouvert ») : ce bouton ouvre la page du miroir dans sa propre fenêtre, l’administration restant ouverte. Passez ensuite la fenêtre du miroir en plein écran avec la touche F11.

Le navigateur demande l’accès au micro la première fois : acceptez-le. Après un redémarrage du navigateur, touchez à nouveau **Activer la voix** sur le miroir. Si le navigateur se souvient de l’autorisation du micro et laisse cette page jouer du son sans geste, la voix se prépare toute seule et le bouton n’apparaît pas.

Utilisez toujours la même adresse, par exemple `http://127.0.0.1:3000`. Pour le navigateur, `localhost` et `127.0.0.1` sont deux sites différents : une autorisation donnée à l’un ne vaut pas pour l’autre.

Le premier réglage se fait ensuite pas à pas : voir [Premier démarrage](premier-demarrage.md).

## Caméra et micro

- La caméra est lue par la perception (OpenCV, pilote V4L2). Si l’installateur signale que `/dev/video0` n’est pas lisible, ajoutez votre compte au groupe `video`, puis reconnectez-vous. Si les services systemd tournent déjà, redémarrez plutôt l’ordinateur.

  ```sh
  sudo usermod -aG video "$USER"
  ```

- Le micro est capturé par le navigateur, qui gère aussi l’annulation d’écho. Aucune bibliothèque audio n’est nécessaire côté Python. Seul le testeur du [générateur de mot d’appel](https://github.com/lfpoulain/wakeword-generator), un projet séparé, demande `python3-tk` et `libportaudio2` (Debian, Ubuntu) ou `tk` et `portaudio` (Arch).
- Le choix du micro, des haut-parleurs et de la caméra se fait ensuite dans l’administration.

## Mettre à jour

Le plus simple : **État du système → Mettre à jour vers …** dans l’administration. Sur `main`, Cornelius suit les versions publiées (tag `vX.Y.Z`) ; sur une autre branche (`beta`), la branche distante. La mise à jour lance `scripts/update.sh`, qui arrête Cornelius, avance le dépôt, réinstalle les dépendances qui ont changé, recompile l’interface et relance les services systemd, ou `scripts/start.sh` sans eux. Elle est refusée si des fichiers de Cornelius ont été modifiés à la main ou si l’historique a divergé, et revient au commit de départ en cas d’échec. Le déroulé est dans `data/run/logs/update.log`. Le même script se lance aussi à la main (`--check` montre seulement la version proposée) :

```sh
scripts/update.sh
```

Le script garde une variante GPU d’ONNX Runtime déjà installée. Après une mise à jour qui change les dépendances du mot d’appel ou du GPU, ou pour tout remettre d’aplomb, relancez l’installateur comme ci-dessous.

Avec les services systemd, arrêtez-les, récupérez la nouvelle version, puis relancez l’installateur avec les mêmes options qu’au départ (par exemple `--gpu amd` si vous l’aviez utilisé). Il met à jour les dépendances Node et Python, recompile l’interface et redémarre les services :

```sh
systemctl --user stop cornelius-perception cornelius
git pull
scripts/install-linux.sh --systemd
```

Sans systemd, faites de même puis démarrez :

```sh
scripts/stop.sh
git pull
scripts/install-linux.sh
scripts/start.sh
```

Si la mise à jour ne touche que le code (`git pull` ne liste ni `package-lock.json` ni `perception/requirements.txt`), il suffit de `git pull` puis `scripts/restart.sh` : `start.sh` recompile l’interface quand le code a changé. Avec les services systemd, lancez alors `npm run build` puis `systemctl --user restart cornelius cornelius-perception`.

Au démarrage, le serveur met la base de données à jour si besoin, après en avoir fait une copie de sécurité.

Une ancienne installation lançait aussi le miroir en plein écran avec un service `cornelius-kiosk`. Ce mode n’existe plus : relancer l’installateur avec `--systemd` désactive et supprime ce service. Sans relancer l’installateur, faites-le à la main, puis supprimez le profil de navigateur qu’il utilisait :

```sh
systemctl --user disable --now cornelius-kiosk.service
rm -f ~/.config/systemd/user/cornelius-kiosk.service
systemctl --user daemon-reload
rm -rf data/kiosk-profile
```

## Administrer depuis un autre ordinateur

Ouvrez `https://<adresse de la machine>:3443/admin` depuis n’importe quel appareil du réseau local : voir [Accès depuis le réseau local](../utilisation/reseau-local.md), qui explique aussi le certificat et le pare-feu (`ufw`).

## Voir aussi

- [Premier démarrage](premier-demarrage.md)
- [GPU](gpu.md)
- [Installer sous Windows](windows.md)
- [Configuration](../reference/configuration.md)
- [Dépannage](../utilisation/depannage.md)
- [Mot d’appel](../fonctionnalites/mot-d-appel.md)
