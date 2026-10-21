<div align="center">

<img src="docs/assets/banniere.svg" alt="Cornelius, le miroir intelligent de la famille" width="100%" />

<h3>Un miroir qui vous reconnaît, vous écoute et vous répond, en français.</h3>

<p>
  <a href="https://www.youtube.com/@LesFreresPoulain"><img alt="Vu sur YouTube : Les Frères Poulain" src="https://img.shields.io/badge/YouTube-Les%20Fr%C3%A8res%20Poulain-FF0000?style=for-the-badge&logo=youtube&logoColor=white" /></a>
</p>

<p>
  <img alt="Linux, macOS et Windows" src="https://img.shields.io/badge/Linux%20%7C%20macOS%20%7C%20Windows-0b1312?style=flat-square&logo=linux&logoColor=white" />
  <img alt="Node.js 24" src="https://img.shields.io/badge/Node.js-24-3fb7a3?style=flat-square&logo=nodedotjs&logoColor=white" />
  <img alt="Python 3.12" src="https://img.shields.io/badge/Python-3.12-3fb7a3?style=flat-square&logo=python&logoColor=white" />
  <img alt="En français" src="https://img.shields.io/badge/langue-fran%C3%A7ais-3fb7a3?style=flat-square" />
  <a href="LICENSE"><img alt="Licence PolyForm Noncommercial 1.0.0" src="https://img.shields.io/badge/licence-PolyForm%20NC%201.0.0-b39dff?style=flat-square" /></a>
</p>

<p>
  <a href="#-ce-que-fait-cornelius">Fonctionnalités</a> ·
  <a href="#-installer">Installer</a> ·
  <a href="#-premiers-pas">Premiers pas</a> ·
  <a href="docs/README.md">Documentation</a> ·
  <a href="#-confidentialité">Confidentialité</a> ·
  <a href="#-licence">Licence</a>
</p>

</div>

---

Cornelius transforme un écran, tel quel ou glissé derrière un miroir sans tain, en assistant pour toute la famille. Il reconnaît qui se présente devant lui, ouvre la conversation quand on le regarde ou qu’on l’appelle par son nom, et répond à la voix avec des cartes qui s’affichent sur le miroir : la météo, le prochain bus, la lumière du salon, un souvenir, une image…

La caméra, les visages et l’écoute du mot d’appel restent sur l’ordinateur du miroir. Seule la conversation passe par OpenAI, et seulement quand elle est ouverte.

## ✨ Ce que fait Cornelius

<table>
  <tr>
    <td width="50%" valign="top">
      <h4>🗣️ Il converse à la voix</h4>
      En français, avec une voix naturelle, et affiche ses réponses sous forme de cartes sur le miroir.
    </td>
    <td width="50%" valign="top">
      <h4>👋 Il sait quand on lui parle</h4>
      Il ouvre la conversation quand une personne se présente, le regarde ou dit « Cornelius ». Le modèle du mot d’appel est fourni et tourne en local.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>🙂 Il reconnaît le foyer</h4>
      Les visages sont reconnus sur l’ordinateur lui-même, avec un mode vie privée quand plusieurs personnes sont devant le miroir.
    </td>
    <td valign="top">
      <h4>🌤️ Il informe d’un coup d’œil</h4>
      L’heure, la météo et les prochains passages de bus ou de RER, à la demande ou affichés en permanence.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>🏠 Il commande la maison</h4>
      Avec Home Assistant ou des commandes HTTP, et il confie les tâches longues à des agents Hermes.
    </td>
    <td valign="top">
      <h4>🧠 Il se souvient</h4>
      Des souvenirs propres à chaque personne, que chacun peut consulter, corriger ou effacer.
    </td>
  </tr>
  <tr>
    <td valign="top">
      <h4>👁️ Il voit et il dessine</h4>
      En option, il décrit ce que montre la caméra et crée des images, sur l’ordinateur ou avec OpenAI.
    </td>
    <td valign="top">
      <h4>🧩 Il s’enrichit</h4>
      Des modules ajoutent de nouvelles informations et de nouveaux outils vocaux. Les modules externes vivent dans <a href="https://github.com/lfpoulain/cornelius-modules">cornelius-modules</a> et se mettent à jour à part.
    </td>
  </tr>
</table>

## 🧰 Ce qu’il faut

| | |
|---|---|
| 💻 **Ordinateur** | x86-64 sous Linux (Debian, Ubuntu, Arch ou une dérivée) ou Windows 10 et 11, ou un Mac à puce Apple (M1 ou plus récent) |
| 🎥 **Matériel** | une webcam, un micro, des haut-parleurs et un écran (seul, ou derrière un miroir sans tain) |
| 🛠️ **Logiciels** | Node.js 24 (24.2 ou plus récent), Python 3.12 et Git |
| 🔑 **Clé OpenAI** | d’un compte payant : sans elle, Cornelius ne peut pas parler |
| ➕ **En option** | une carte graphique pour la vision et les images, un jeton [Météo Concept](https://api.meteo-concept.com/) pour la météo, un jeton [PRIM](https://prim.iledefrance-mobilites.fr/) pour les transports d’Île-de-France, des [satellites audio](docs/fonctionnalites/satellites.md) (Waveshare ESP32-S3-AUDIO-Board) pour parler à Cornelius depuis d’autres pièces |

## 🚀 Installer

### 🐧 Linux

Récupérez les outils de base et le code (sur Arch : `sudo pacman -S git curl unzip`) :

```sh
sudo apt install git curl unzip
git clone https://github.com/lfpoulain/Cornelius.git
cd Cornelius
node --version
```

> [!TIP]
> Si la dernière commande n’affiche pas `v24.2` ou plus récent dans la version 24 (cas d’Ubuntu et Debian), installez fnm, un gestionnaire de versions de Node.js sans droits administrateur, puis ouvrez un nouveau terminal et revenez dans le dossier :
>
> ```sh
> curl -fsSL https://fnm.vercel.app/install | bash
> ```

Lancez ensuite l’installation. Elle installe Node.js 24 avec fnm, les dépendances, la perception et ses modèles, puis crée deux services qui démarrent avec la session :

```sh
scripts/install-linux.sh --system-deps --systemd
```

Sans l’option `--systemd`, démarrez ensuite avec `scripts/start.sh`. Toutes les options : [Installer sous Linux](docs/installation/linux.md).

### 🍎 macOS

Avec [Homebrew](https://brew.sh) installé, récupérez le code puis lancez l’installation. Elle installe git, Node.js 24 et Python 3.12 avec Homebrew, les dépendances, la perception et ses modèles, puis crée deux services launchd qui démarrent avec la session :

```sh
brew install git
git clone https://github.com/lfpoulain/Cornelius.git
cd Cornelius
scripts/install-macos.sh --system-deps --launchd
```

Sans l’option `--launchd`, démarrez ensuite avec `scripts/start.sh`. Au premier démarrage, macOS demande l’accès à la caméra : acceptez-le. Toutes les options : [Installer sous macOS](docs/installation/macos.md).

### 🪟 Windows

Il n’y a pas d’installateur : l’installation se fait en une dizaine de commandes PowerShell. Suivez [Installer sous Windows](docs/installation/windows.md).

### 🔑 Après l’installation

Ouvrez l’administration et collez votre clé OpenAI dans **Mise en route → Clés et jetons** : elle compte tout de suite.

> [!IMPORTANT]
> Le mot de passe de départ de l’administration est `cornelius`. Changez-le tout de suite dans **Mise en route → Mot de passe administrateur**.

## ▶️ Lancer

Avec les services systemd sous Linux ou launchd sous macOS, Cornelius démarre tout seul. Sinon, utilisez les scripts (ceux de Linux servent aussi sous macOS) :

| Action | Linux et macOS | Windows (PowerShell) |
|---|---|---|
| Démarrer | `scripts/start.sh` | `powershell -ExecutionPolicy Bypass -File scripts\start.ps1` |
| Arrêter | `scripts/stop.sh` | `powershell -ExecutionPolicy Bypass -File scripts\stop.ps1` |
| Redémarrer | `scripts/restart.sh` | `powershell -ExecutionPolicy Bypass -File scripts\restart.ps1` |
| Avec systemd | `systemctl --user restart cornelius cornelius-perception` | |

`start` compile l’interface si besoin, puis lance le serveur et la perception (le programme local qui lit la caméra et écoute le mot d’appel).

Ouvrez ensuite, dans un navigateur de la même machine :

| | Adresse | |
|---|---|---|
| 🪞 **Le miroir** | <http://127.0.0.1:3000/> | Touchez **Activer la voix**, puis passez en plein écran avec F11. |
| ⚙️ **L’administration** | <http://127.0.0.1:3000/admin> | La rubrique **Mise en route** indique ce qu’il reste à faire. |

📱 Depuis un téléphone ou un autre ordinateur de la maison, utilisez `https://<adresse de l’ordinateur>:3443/` : voir [Accès depuis le réseau local](docs/utilisation/reseau-local.md).

## 👣 Premiers pas

1. Connectez-vous à l’administration et lisez la rubrique **Mise en route**.
2. Choisissez la caméra dans **Caméra et reconnaissance**.
3. Cliquez sur **Activer et ouvrir le miroir** et acceptez l’accès au micro.
4. Ajoutez les personnes du foyer et mémorisez leur visage dans **Le foyer et les visages**.
5. Choisissez ce qui ouvre la conversation dans **Quand il écoute**, puis dites « Cornelius » !

Le pas à pas complet est dans [Premier démarrage](docs/installation/premier-demarrage.md).

## 📚 Documentation

Toute la documentation part de [l’index](docs/README.md).

| | |
|---|---|
| **Installer** | [Linux](docs/installation/linux.md) · [macOS](docs/installation/macos.md) · [Windows](docs/installation/windows.md) · [Carte graphique](docs/installation/gpu.md) |
| **Utiliser** | [Le miroir](docs/utilisation/miroir.md) · [L’administration](docs/utilisation/administration.md) · [Dépannage](docs/utilisation/depannage.md) |
| **Fonctionnalités** | [Ouverture et présence](docs/fonctionnalites/ouverture-et-presence.md) · [Mot d’appel](docs/fonctionnalites/mot-d-appel.md) · [Mémoire](docs/fonctionnalites/memoire.md) · [Home Assistant](docs/fonctionnalites/home-assistant.md) · [Agents Hermes](docs/fonctionnalites/agents-hermes.md) · [Vision locale](docs/fonctionnalites/vision-locale.md) · [Images](docs/fonctionnalites/generation-d-images.md) |
| **Modules** | [Les utiliser](docs/modules/README.md) · [Le contrat](docs/modules/reference.md) · [En créer un](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md) (dépôt cornelius-modules) |
| **Développer** | [Développement](docs/developpement/README.md) · [Architecture](docs/developpement/architecture.md) · [Contribuer](CONTRIBUTING.md) · [Historique](CHANGELOG.md) |
| **Référence** | [Configuration](docs/reference/configuration.md) · [Confidentialité](docs/reference/confidentialite.md) · [Licences](docs/reference/licences.md) · [Glossaire](docs/reference/glossaire.md) |

## 🔒 Confidentialité

- 🎥 Les images de la caméra et les visages restent sur l’ordinateur du miroir.
- 🎙️ Le mot « Cornelius » est reconnu en local : en veille, le son ne quitte pas l’ordinateur.
- 💬 La voix et le texte partent chez OpenAI seulement pendant une conversation. Cornelius n’enregistre ni image, ni son, ni transcription sur le disque.

> [!CAUTION]
> Le dossier `data/` (base de données, signatures des visages, souvenirs) et le fichier `.env` ne doivent jamais être publiés.

Le détail est dans [Confidentialité](docs/reference/confidentialite.md).

## 🎙️ Le mot d’appel « Cornelius »

Le modèle qui reconnaît « Cornelius » est fourni dans `models/cornelius.onnx`, prêt à l’emploi. Il a été entraîné à partir de voix françaises de synthèse avec [wakeword-generator](https://github.com/lfpoulain/wakeword-generator), notre générateur de mots d’appel en français, publié à part. Vous pouvez vous en servir pour entraîner votre propre version, ou un tout autre mot.

## 📜 Licence

Cornelius est distribué sous la [PolyForm Noncommercial License 1.0.0](LICENSE).

| ✅ Permis | ❌ Interdit |
|---|---|
| L’utiliser, le partager et le modifier pour un usage non commercial (personnel, associatif, éducatif, recherche), en gardant la ligne `Required Notice` du fichier `LICENSE` | Tout usage commercial, sauf accord écrit des auteurs |

Ce n’est pas une licence « open source » au sens de l’OSI, puisqu’elle exclut l’usage commercial. Les bibliothèques, polices et modèles utilisés gardent leur propre licence : voir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) et [Licences](docs/reference/licences.md). Le modèle du mot d’appel est sous CC BY-NC-SA 4.0 (voir `models/cornelius.onnx.LICENSE`).

---

<div align="center">

Fait avec ❤️ par **[Les Frères Poulain](https://www.youtube.com/@LesFreresPoulain)**

Si le projet vous plaît, laissez une ⭐ au dépôt et passez voir la chaîne !

</div>
