# Installer Cornelius sous Windows

Cette page explique comment installer Cornelius sur un ordinateur Windows 10 ou 11, le démarrer, l’arrêter et le mettre à jour. Il n’y a pas d’installateur : l’installation se fait en une dizaine de commandes à taper dans PowerShell, une seule fois.

## Ce qu’il faut

- Windows 10 ou 11, en 64 bits.
- [Node.js](https://nodejs.org/) 24, version 24.2 ou plus récente dans la version 24 (celle du fichier `.nvmrc`). Si le site propose une version plus récente, choisissez la 24. Vérifiez avec `node --version`.
- [Python](https://www.python.org/downloads/windows/) 3.12, installé depuis python.org avec le lanceur `py` (proposé par l’installateur). Dans la liste, prenez une version 3.12 qui propose un « Windows installer (64-bit) ». Vérifiez avec `py -3.12 --version`. C’est la version validée pour Cornelius, et la seule pour laquelle AMD publie PyTorch sous Windows.
- [Git pour Windows](https://git-scm.com/download/win).
- Une webcam, un micro, des haut-parleurs et un navigateur récent (Google Chrome ou Microsoft Edge).
- Une clé OpenAI d’un compte payant : sans elle, Cornelius ne peut pas parler.
- En option : une carte graphique (voir [GPU](gpu.md)), un jeton Météo Concept et un jeton PRIM pour les modules Météo et Transports.

Ouvrez PowerShell après avoir installé ces logiciels, pour qu’il les trouve.

## Récupérer le code et préparer le serveur

```powershell
git clone https://github.com/lfpoulain/Cornelius.git
cd Cornelius
npm ci
npm run setup
notepad .env
```

- `npm ci` installe les dépendances exactes du projet.
- `npm run setup` crée le fichier `.env` : le port (`PORT=3000`), la base de données, le mot de passe de l’administration (`cornelius` au départ), un jeton privé pour la perception et une ligne `OPENAI_API_KEY=` vide. Sur un `.env` existant, il ne change rien et complète seulement les lignes manquantes.
- Dans le Bloc-notes, choisissez un autre mot de passe dans `CORNELIUS_ADMIN_PASSWORD` (4 caractères au moins), puis enregistrez. La clé OpenAI peut se coller ici après `OPENAI_API_KEY=`, ou plus tard dans l’administration (**Mise en route → Clés et jetons**), sans redémarrage.

Les autres réglages possibles de `.env` (jetons des modules, caméra, vision, images) sont décrits dans [Configuration](../reference/configuration.md) et commentés dans `.env.example`.

Toutes les commandes de cette page se lancent depuis le dossier `Cornelius`.

Si `npm ci` répond « Impossible de charger le fichier …\npm.ps1, car l’exécution de scripts est désactivée sur ce système », voir [Pourquoi `-ExecutionPolicy Bypass`](#pourquoi--executionpolicy-bypass) plus bas.

## Préparer la perception

La perception est le programme Python qui lit la caméra, détecte la voix, écoute le mot d’appel et décrit la scène. Elle a son propre environnement Python, le dossier `.venv` :

```powershell
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install --upgrade pip
.venv\Scripts\python -m pip install -r perception\requirements.txt
.venv\Scripts\python perception\download_models.py
.venv\Scripts\python perception\worker.py --check
```

- `download_models.py` télécharge les modèles de visages, de détection de la voix et de vision (version 450M), chacun vérifié par son empreinte SHA-256, dans le dossier `models`. Les versions 1,6B et 3B de la vision s’installent ensuite depuis l’administration.
- `worker.py --check` ouvre la caméra, vérifie les modèles et affiche un résumé. `"camera": true` signifie que la caméra répond. Sinon, vérifiez qu’aucune autre application ne l’utilise et que Windows autorise les applications de bureau à accéder à la caméra (Paramètres de Windows, rubrique Confidentialité, Caméra). Ajoutez `--with-vision` pour charger aussi le modèle de vision (plus lent).

### En option : la vision sur la carte graphique

Par défaut, la vision tourne sur le processeur. Pour utiliser une carte graphique, remplacez le moteur ONNX Runtime par sa version GPU. Il ne doit y en avoir qu’un seul.

Carte NVIDIA :

```powershell
.venv\Scripts\python -m pip uninstall -y onnxruntime
.venv\Scripts\python -m pip install -r perception\requirements-gpu.txt
.venv\Scripts\python perception\download_models.py --device auto
```

Carte AMD ou Intel (DirectML) :

```powershell
.venv\Scripts\python -m pip uninstall -y onnxruntime
.venv\Scripts\python -m pip install onnxruntime-directml==1.24.4
.venv\Scripts\python perception\download_models.py --device auto
```

La dernière commande télécharge la version de la vision adaptée au GPU. Les détails, et la génération d’images, sont dans [GPU](gpu.md).

### En option : le mot d’appel « Cornelius »

```powershell
.venv\Scripts\python -m pip install -r perception\requirements-wake.txt
.venv\Scripts\python -m pip install --no-deps openwakeword==0.6.0
.venv\Scripts\python perception\install_wake_features.py
```

Le modèle du mot « Cornelius » est fourni dans le dépôt, dans `models\cornelius.onnx`. Voir [Mot d’appel](../fonctionnalites/mot-d-appel.md).

## Démarrer

```powershell
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

Le script :

1. vérifie Node.js, les dépendances et le fichier `.env`, et s’arrête avec un message clair s’il manque quelque chose ;
2. compile l’interface si elle n’existe pas encore ou si le code a changé depuis la dernière compilation ;
3. arrête une instance précédente de Cornelius ;
4. lance le serveur et la perception en arrière-plan, sans fenêtre ;
5. attend que le serveur réponde et affiche son adresse : `Backend  prêt : http://127.0.0.1:3000`.

Options : `-Build` recompile l’interface même si elle est à jour, `-NoPerception` ne lance pas la perception, `-TimeoutSeconds 60` change l’attente du serveur.

Ouvrez ensuite `http://127.0.0.1:3000/admin` dans un navigateur de cet ordinateur et suivez [Premier démarrage](premier-demarrage.md). Le serveur n’écoute que sur l’ordinateur lui-même : l’administration et le miroir ne sont pas accessibles depuis un autre appareil du réseau. Pour afficher le miroir, utilisez **Activer et ouvrir le miroir** dans l’administration, puis passez le navigateur en plein écran avec F11.

Cornelius ne démarre pas tout seul avec Windows : relancez `start.ps1` après un redémarrage de l’ordinateur.

### Pourquoi `-ExecutionPolicy Bypass`

Par défaut, Windows interdit d’exécuter des scripts PowerShell (fichiers `.ps1`). `-ExecutionPolicy Bypass` lève cette interdiction pour ce seul lancement, sans modifier le réglage de Windows. Les scripts fonctionnent avec Windows PowerShell 5.1, fourni avec Windows, comme avec PowerShell 7.

La même règle peut bloquer `npm` lui-même, avec un message du type « Impossible de charger le fichier …\npm.ps1, car l’exécution de scripts est désactivée sur ce système ». Tapez alors `npm.cmd` à la place de `npm` (par exemple `npm.cmd ci`), ou autorisez les scripts locaux pour votre seul compte :

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

## Arrêter et redémarrer

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
powershell -ExecutionPolicy Bypass -File scripts\restart.ps1
```

`stop.ps1` arrête le serveur, la perception et le générateur d’images. Il arrête aussi tout programme qui écoute sur le port de Cornelius (3000 par défaut) ou sur le port de l’interface de développement (5173, ou `CORNELIUS_DEV_PORT`) : si une autre application utilise le port 3000, choisissez un autre `PORT` dans `.env` (de 1024 à 65535). `restart.ps1` enchaîne `stop.ps1` et `start.ps1`, avec les mêmes options que ce dernier. Redémarrez après chaque modification de `.env`.

`scripts\dev.ps1` lance en plus l’interface de développement sur le port 5173 : il sert à modifier le code, pas au miroir. Voir [Développement](../developpement/README.md).

## Journaux

Les scripts écrivent les journaux dans `data\run\logs` : `backend.out.log` et `backend.err.log` pour le serveur, `perception.out.log` et `perception.err.log` pour la perception. Le serveur écrit aussi son journal détaillé dans `data\logs\cornelius.log`, que l’administration affiche dans la rubrique « Journal ».

## Messages de start.ps1

Les problèmes s’affichent en jaune, précédés de « AVERTISSEMENT : » (« WARNING: » sur un Windows en anglais). Une erreur bloquante s’affiche en rouge et arrête le script.

| Message | Ce qu’il veut dire | Que faire |
|---|---|---|
| Node.js est introuvable dans le PATH | Node.js n’est pas installé, ou PowerShell a été ouvert avant son installation. | Installez Node.js 24, puis rouvrez PowerShell. |
| Node.js … détecté : Cornelius demande Node.js 24.2 ou plus récent | La version de Node.js est trop ancienne. | Installez Node.js 24.2 ou une version 24 plus récente. |
| Dépendances absentes, incomplètes ou à mettre à jour : installation (npm ci) | `node_modules` manque, est incomplet (un `npm ci` interrompu ou gêné par un fichier ouvert) ou date d’avant un `git pull`. | Rien : le script arrête Cornelius et réinstalle tout seul. |
| L’installation des dépendances a échoué (npm ci, code …) | `npm ci` n’a pas pu terminer, souvent parce qu’un fichier de `node_modules` est ouvert ailleurs. | Fermez l’éditeur et les autres terminaux ouverts sur le projet, supprimez le dossier `node_modules`, puis relancez `start.ps1`. |
| Fichier .env absent : lancez « npm run setup » | La configuration n’a pas été créée. | Lancez `npm run setup`, puis renseignez la clé OpenAI. |
| Cornelius ne peut pas démarrer : corrigez les points ci-dessus puis relancez. | Résumé des messages précédents. | Corrigez chaque point listé au-dessus. |
| npm est introuvable dans le PATH. | L’interface doit être compilée, mais npm manque. | Réinstallez Node.js (npm est fourni avec). |
| La compilation a échoué (code …). | La compilation de l’interface a rencontré une erreur. | Relancez `npm ci`, puis `start.ps1 -Build`. Le détail est affiché juste au-dessus. |
| « 'tsc' n’est pas reconnu… » ou « Cannot find package …\node_modules\tsx\index.js » | `node_modules` est incomplet (version antérieure des scripts). | Lancez `stop.ps1`, supprimez le dossier `node_modules`, puis `npm ci` et `start.ps1`. |
| Python de perception introuvable | Le dossier `.venv` n’existe pas. Le serveur démarre quand même, sans caméra ni voix. | Suivez « Préparer la perception » ci-dessus. |
| Perception déjà active | Une perception tourne déjà. | Rien à faire. |
| Le backend s’est arrêté au démarrage (code …) | Le serveur s’est arrêté aussitôt. La fin de son journal est affichée en dessous. | Lisez le journal : un mot de passe trop court dans `.env` (« Définissez CORNELIUS_ADMIN_PASSWORD (4 caractères minimum) »), un `PORT` invalide ou un port déjà occupé (« EADDRINUSE »). |
| Backend non confirmé après 60 s. | Le serveur n’a pas répondu à temps. | Attendez puis ouvrez l’administration, ou relancez avec `-TimeoutSeconds 120`. Consultez `data\run\logs\backend.err.log`. |

Le script ne vérifie pas que la perception reste lancée. Si elle s’arrête, la rubrique « Mise en route » de l’administration l’indique à l’étape « Service caméra (perception) », et la raison est dans `data\run\logs\perception.err.log`.

## Mettre à jour

```powershell
powershell -ExecutionPolicy Bypass -File scripts\stop.ps1
git pull
npm ci
.venv\Scripts\python -m pip install -r perception\requirements.txt
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

`npm ci` est facultatif ici : `start.ps1` réinstalle les dépendances quand `package-lock.json` a changé, puis recompile l’interface quand le code a changé. Au démarrage, le serveur met la base de données à jour si besoin, après en avoir fait une copie de sécurité.

Si vous utilisez un moteur ONNX pour GPU, la commande `pip install -r perception\requirements.txt` réinstalle le moteur pour processeur à côté : refaites ensuite l’installation du moteur GPU comme indiqué dans [GPU](gpu.md#changer-de-moteur-onnx).

## Voir aussi

- [Premier démarrage](premier-demarrage.md)
- [GPU](gpu.md)
- [Installer sous Linux](linux.md)
- [Configuration](../reference/configuration.md)
- [Dépannage](../utilisation/depannage.md)
- [Mot d’appel](../fonctionnalites/mot-d-appel.md)
