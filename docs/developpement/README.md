# Développer Cornelius

Cette page s’adresse aux personnes qui modifient le code de Cornelius. Elle décrit l’environnement de travail, le lancement en développement, les scripts, l’organisation du dépôt, les conventions et la vérification automatique. Pour installer le miroir et s’en servir au quotidien, voir plutôt [l’installation sous Linux](../installation/linux.md) ou [sous Windows](../installation/windows.md).

## Environnement

Cornelius assemble trois environnements, chacun dans son dossier :

| Partie | Outil | Où | Créé par |
|---|---|---|---|
| Serveur et interface | Node.js 24, version exacte dans `.nvmrc` (24.2 ou plus récent, moins de 25) | `node_modules/` | `npm ci` |
| Perception (caméra, visages, voix, vision) | Python 3.12 | `.venv/` | `scripts/install-linux.sh`, ou à la main (voir ci-dessous) |
| Génération d’images (facultative) | Python, PyTorch et Diffusers | `.venv-image/` | l’administration, **Modules → Génération d’image → Installer** (`image_generation/install.py`) |

Les dépendances Node sont verrouillées dans `package-lock.json`, celles de Python dans `perception/requirements*.txt` et `image_generation/requirements.txt`. Les modèles téléchargés vont dans `models/`, la base et les journaux dans `data/`. Ces dossiers, `.env`, `.venv/` et `.venv-image/` restent hors du dépôt (voir `.gitignore`), sauf `models/cornelius.onnx` et sa licence, fournis avec le code.

Préparer le dépôt sous Linux :

```sh
npm ci
npm run setup
python3.12 -m venv .venv
.venv/bin/python -m pip install -r perception/requirements.txt
.venv/bin/python perception/download_models.py
```

Sous Windows :

```powershell
npm ci
npm run setup
py -3.12 -m venv .venv
.venv\Scripts\python.exe -m pip install -r perception\requirements.txt
.venv\Scripts\python.exe perception\download_models.py
```

`npm run setup` crée `.env` (port, base, mot de passe administrateur par défaut, jeton de la perception, clé OpenAI vide) ou complète un fichier existant. Ajoutez ensuite `OPENAI_API_KEY` et, si besoin, les autres variables décrites dans [la configuration](../reference/configuration.md). `.venv/bin/python perception/worker.py --check` vérifie la caméra et les modèles sans serveur ni cloud.

## Lancer en développement

Le script de développement lance le serveur, l’interface Vite (rechargement à chaud) et la perception :

```sh
scripts/dev.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1
```

L’interface de développement est alors sur `http://127.0.0.1:5173` (miroir) et `http://127.0.0.1:5173/admin` (administration) ; si un autre projet occupe déjà ce port, choisissez-en un autre avec `CORNELIUS_DEV_PORT` dans `.env`. Vite relaie `/api/`, `/events` et `/audio` vers le serveur, qui suit le `PORT` de `.env` (3000 par défaut). Arrêtez tout avec `scripts/stop.sh` ou `scripts\stop.ps1`.

Options : `--no-frontend`, `--no-perception` et `--timeout SECONDES` sous Linux ; `-NoFrontend`, `-NoPerception` et `-TimeoutSeconds` sous Windows.

Sans les scripts, lancez le serveur puis Vite dans deux terminaux, et la perception à part si vous en avez besoin :

```sh
npm start
npm run dev:web
.venv/bin/python perception/worker.py
```

Le mot d’appel passe par `/wake-audio`, que Vite ne relaie pas : pour l’essayer, ouvrez le miroir sur le port du serveur après `npm run build`.

## Scripts

Scripts npm (`package.json`) :

| Commande | Effet |
|---|---|
| `npm start` | Lance le serveur (`server/index.ts`) avec `.env`, sur `127.0.0.1` et le `PORT` choisi. Sert l’interface compilée si `dist/web` existe. |
| `npm run dev:web` | Lance Vite sur `127.0.0.1:5173` (ou `CORNELIUS_DEV_PORT`). |
| `npm run build` | Vérifie les types (`tsc --noEmit`) puis compile l’interface dans `dist/web`. |
| `npm run check` | Vérifie les types seulement. |
| `npm test` | Tests TypeScript (`tests/*.test.ts` et `addons/*/*.test.ts`). |
| `npm run test:e2e` | Tests navigateur Playwright (`tests/e2e`). |
| `npm run format` | Formate le code avec Prettier. |
| `npm run format:check` | Vérifie le formatage sans rien modifier (lancé par la vérification automatique). |
| `npm run setup` | Crée ou complète `.env`. |
| `npm run recette` | Guide la recette manuelle sur le matériel. |
| `npm run mesures` | Résume les mesures enregistrées dans le journal. |

Scripts du dossier `scripts/` :

| Linux | Windows | Effet |
|---|---|---|
| `dev.sh` | `dev.ps1` | Développement : serveur, Vite et perception. |
| `start.sh` | `start.ps1` | Production : compile l’interface si elle manque ou si le code a changé (`--build` ou `-Build` pour forcer), arrête une instance précédente, puis lance serveur et perception sur le seul port du serveur. |
| `stop.sh` | `stop.ps1` | Arrête serveur, Vite, perception et worker d’images. |
| `restart.sh` | `restart.ps1` | `stop` puis `start`, avec les mêmes options que `start`. |
| `install-linux.sh` | | Installation complète sous Debian, Ubuntu ou Arch (options dans `scripts/install-linux.sh --help`). |
| `lib.sh` | `lib.ps1` | Fonctions partagées par les scripts ci-dessus. |

Les scripts Linux écrivent leurs fichiers de suivi et leurs journaux dans `data/run/` et `data/run/logs/`. `scripts/setup.ts`, `scripts/recette.ts`, `scripts/recette-lib.ts`, `scripts/mesures.ts` et `scripts/wait-server.mjs` (attente du serveur) servent les commandes npm et les scripts de lancement.

Les satellites audio (en développement) ont trois outils, lancés avec `npx tsx` : `scripts/satellite-ajouter.ts` crée un satellite et affiche son jeton, `scripts/satellite-sim.ts` simule un satellite sans matériel, `scripts/satellite-sonde.ts` vérifie une session Live en PCM 16 kHz. Le dialogue avec le firmware est décrit dans [le protocole des satellites](satellites-protocole.md).

## Organisation du dépôt

```text
server/              serveur Fastify : état, sessions, outils, données
  index.ts           point d’entrée (écoute sur 127.0.0.1)
  app.ts             routes HTTP, WebSocket, sécurité, assemblage des services
  controller.ts      contrôleur : présence, profil actif, ouverture et fermeture
  live/              session vocale OpenAI (configuration.ts : prompts et outils ; transport.ts)
  addons/            chargement des modules, exécution, cache, affichage permanent
  storage.ts         base SQLite et migrations ; backups.ts : copies avant migration
  memory*.ts         mémoire personnelle ; vision.ts ; image-generation*.ts
  home-assistant*.ts, agents*.ts, hermes-client.ts, actions.ts
shared/              types, validations et règles communes au serveur et à l’interface
  opening.ts         ouverture de la conversation en deux questions
  readiness.ts       liste « Mise en route » et raisons affichées sur le miroir
web/                 interface React (miroir et administration)
  components/        Mirror.tsx, Orb.tsx, Admin.tsx
    admin/           une carte ou un réglage par fichier
    ui/              composants de base shadcn/ui
  audio/             micro, WebRTC, son d’ouverture, mot d’appel, mesures
perception/          worker Python : caméra, visages, détection de parole, vision, mot d’appel
image_generation/    worker Python de génération d’images et son installateur
addons/              modules livrés : clock, weather, transit, ragator (les autres : cornelius-modules)
schemas/             contrats JSON ; examples/ : un exemple valide par contrat
scripts/             lancement, arrêt, installation, recette et mesures
tests/               tests TypeScript ; e2e/ navigateur ; python/ ; recette/protocol.json
models/              cornelius.onnx (mot d’appel) et sa licence ; le reste est téléchargé
docs/                documentation
```

Hors dépôt : `data/` (base, journaux, images générées), `models/` (sauf `cornelius.onnx` et sa licence), `dist/`, `.env`, `.venv/`, `.venv-image/` et `.local/` (sorties jetables des tests, comme les captures d’écran).

## Rubriques de l’administration et composants

L’administration (`web/components/Admin.tsx`) range ses rubriques dans l’adresse : `/admin#voice` ouvre directement **Quand il écoute**. Le panneau **Conversation** (`SessionControls.tsx`) reste en haut de toutes les rubriques. Les fichiers ci-dessous sont dans `web/components/admin/`.

| Rubrique | Ancre | Composants principaux |
|---|---|---|
| Mise en route | `#start` | `GettingStarted.tsx`, d’après `shared/readiness.ts` |
| Micro et haut-parleurs | `#audio` | `Devices.tsx` → `AudioDevices.tsx` |
| Caméra et reconnaissance | `#camera` | `Devices.tsx` → `Camera.tsx`, `RecognitionSettings.tsx`, `RecognitionTester.tsx`, `EngagementSettings.tsx` |
| Le foyer et les visages | `#profiles` | `Profiles.tsx`, `FaceEnrollment.tsx` |
| Quand il écoute | `#voice` | `Devices.tsx` → `SessionMode.tsx`, `SilenceCloseSettings.tsx`, `PrivacyMode.tsx`, `GreetingSettings.tsx`, `AdmissionSoundSettings.tsx` ; dans **Réglages avancés** : `AdvancedAudioBuffer.tsx`, `PresenceTimingSettings.tsx`, `DelegationSettings.tsx` |
| Personnaliser Cornelius | `#personality` | `Personality.tsx` |
| Modules | `#modules` | `Addons.tsx`, `AddonForm.tsx`, `WebSearchSettings.tsx`, `VisionSettings.tsx`, `ImageGenerationSettings.tsx`, `HomeAssistant.tsx`, `ModelInstall.tsx` |
| Modules, module Commandes HTTP ouvert | `#modules/commandes` | `Actions.tsx`, `ActionForm.tsx` |
| Agents | `#agents` | `Agents.tsx` |
| Mémoire | `#memory` | `Memory.tsx` |
| État du système | `#diagnostic` | `Diagnostics.tsx` |
| Journal | `#logs` | `Logs.tsx`, `log-view.ts` |

`shared.tsx`, `FineTuning.tsx` et `FormOptions.tsx` regroupent les éléments communs (sections repliables, sélecteur de personne, règle d’enregistrement des réglages). Le miroir lui-même est `web/components/Mirror.tsx`, avec l’orbe (`Orb.tsx`) et les informations permanentes (`AmbientModules.tsx`).

## Conventions

- **TypeScript strict** (`tsconfig.json` : `strict`, `noUncheckedIndexedAccess`, `noUnusedLocals`, `noUnusedParameters`). `npm run check` doit passer.
- **Formatage** : `npm run format` avant de valider ; la vérification automatique lance `npm run format:check`. Prettier ne touche ni `docs/` ni `schemas/` (`.prettierignore`).
- **Textes en français**, pour l’interface, les messages d’erreur, les journaux lisibles et la documentation. Phrases courtes, sans tiret long. Le miroir est visible de tous : les raisons qu’il affiche quand il ne répond pas ne citent jamais de prénom (`shared/readiness.ts`).
- **Noms des outils vocaux** : `<module>__<outil>`, avec deux tirets bas (par exemple `weather__read`, `vision__look`, `memory__recall`). L’identifiant d’un module respecte `^[a-z][a-z0-9_]{0,31}$`. Voir [la référence des modules](../modules/reference.md).
- **Migrations SQLite** : la liste `migrations` de `server/storage.ts` est définitive. Une migration publiée n’est jamais modifiée ; la suivante s’ajoute à la fin. Écrivez-la rejouable (`CREATE TABLE IF NOT EXISTS`, `INSERT OR IGNORE`) et donnez des valeurs par défaut qui gardent le comportement existant. Le serveur copie la base avant de migrer (`server/backups.ts`).
- **Contrats** : un format échangé entre parties a son schéma dans `schemas/` et un exemple dans `schemas/examples/`. Le serveur valide toujours ce qu’il reçoit, même si le modèle est déjà contraint.
- **Secrets** : jamais dans le client ou les journaux. Le mot de passe et les jetons internes restent dans `.env` ; la clé OpenAI et les jetons des modules peuvent aussi être saisis dans l’administration (`server/secrets.ts`, table `secrets`), qui n’en renvoie que les quatre derniers caractères.

## Vérification automatique

`.github/workflows/check.yml` tourne à chaque envoi et à chaque demande de fusion, en deux parties :

- **check** : `npm ci`, `npm run format:check`, `npm test`, `npm run build`, installation de Chromium, `npm run test:e2e` ;
- **perception** : Python 3.12, `pip install -r perception/requirements.txt`, tests de `tests/python`, puis `shellcheck` sur `scripts/*.sh`.

Les mêmes commandes se lancent en local : voir [Tests et recette](tests-et-recette.md).

## Mettre à jour la documentation

La documentation cite les libellés de l’interface tels qu’ils s’affichent, sous la forme « Rubrique → Carte → Réglage ». Quand vous renommez une rubrique, une carte, un réglage ou un bouton :

- cherchez l’ancien libellé dans `docs/` et dans les fiches `addons/*/README.md`, puis corrigez chaque page, en particulier [l’administration](../utilisation/administration.md) ;
- vérifiez aussi les chemins de documentation cités par le code (`shared/readiness.ts`, les scripts, `.env.example`) ;
- notez le changement visible dans `CHANGELOG.md`.

Une page décrit l’état actuel, sans date ni historique. Une valeur par défaut ou une plage se recopie depuis le code qui la définit (`shared/*.ts`, `server/config.ts`, `server/storage.ts`).

## Voir aussi

- [Architecture](architecture.md)
- [Tests et recette](tests-et-recette.md)
- [Les prompts](prompts.md)
- [Feuille de route](feuille-de-route.md)
- [Référence des modules](../modules/reference.md)
- [Configuration](../reference/configuration.md)
- [Contribuer](../../CONTRIBUTING.md)
