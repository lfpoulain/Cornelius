# Installer Cornelius dans Home Assistant

Cette page explique comment faire tourner Cornelius comme application (anciennement « add-on ») de Home Assistant, sur la même box que la domotique. Elle s’adresse à la personne qui a déjà Home Assistant OS et veut éviter un ordinateur de plus. L’application vit dans un dépôt séparé, [cornelius-ha](https://github.com/lfpoulain/cornelius-ha).

## Ce qui change avec l’application

L’application contient le serveur et la perception. La box n’a pas d’écran : le miroir s’affiche toujours sur un autre appareil (un Raspberry Pi en kiosque, une tablette, un ordinateur), qui l’ouvre par le [réseau local](../utilisation/reseau-local.md).

| | Installation habituelle | Application Home Assistant |
|---|---|---|
| Miroir | sur l’ordinateur de Cornelius ou un autre appareil | sur un autre appareil seulement |
| Caméra | branchée sur l’ordinateur | [caméra du navigateur](../fonctionnalites/camera-navigateur.md) de l’appareil du miroir, ou caméra USB branchée sur la box |
| Mot d’appel, visages, parole | sur l’ordinateur | sur la box |
| [Vision locale](../fonctionnalites/vision-locale.md) | au choix | au choix sur un PC x86-64, retirée en mode petite machine |
| [Génération d’images](../fonctionnalites/generation-d-images.md) | sur l’ordinateur ou avec OpenAI | avec OpenAI |
| [Satellites audio](../fonctionnalites/satellites.md) | oui | oui |
| Mises à jour | `git pull` | nouvelle version de l’application, qui reconstruit l’image |

Rien n’est à installer dans Home Assistant lui-même : Cornelius s’y connecte comme d’habitude, avec un jeton (voir [Home Assistant](../fonctionnalites/home-assistant.md)).

## Ce qu’il faut

- **Home Assistant OS** (ou une installation « Supervised ») : les applications n’existent pas avec Home Assistant Container ou Core.
- Une box 64 bits : PC x86-64 ou ARM64 (Raspberry Pi 4 ou 5, Home Assistant Green ou Yellow). Les systèmes 32 bits ne conviennent pas.
- De la mémoire libre en plus de Home Assistant et de ses autres applications : la perception analyse la caméra en continu.
- Un appareil pour le miroir, avec un navigateur récent, un micro et un haut-parleur, et une caméra pour la reconnaissance.

## Installer l’application

1. Ajoutez le dépôt à la boutique de Home Assistant : ouvrez [ce lien](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2Flfpoulain%2Fcornelius-ha), ou dans **Paramètres → Applications**, ouvrez la boutique (bouton d’installation d’une application), menu **⋮ → Dépôts**, et collez `https://github.com/lfpoulain/cornelius-ha`.
2. Ouvrez **Cornelius** dans la boutique et installez-le. Home Assistant construit l’image sur la box : comptez plusieurs minutes, davantage sur un Raspberry Pi.
3. Dans l’onglet **Configuration**, choisissez le **mot de passe de l’administration** (8 caractères au moins, autre que `cornelius`). Collez la **clé OpenAI** ici ou plus tard dans l’administration.
4. Démarrez l’application et activez **Chien de garde**, qui la relance si elle s’arrête.
5. **Ouvrir l’interface web** : l’administration s’ouvre en HTTPS sur le port `3443` de la box.

L’application est au stade expérimental : Home Assistant l’affiche dans la boutique avec cette mention. Pour la modifier et l’essayer comme application locale, voir le [README de cornelius-ha](https://github.com/lfpoulain/cornelius-ha#-d%C3%A9veloppement).

Une application installée depuis la boutique et une application locale sont deux applications distinctes, chacune avec son dossier de données. Passer de l’une à l’autre repart d’un Cornelius vide : profils, visages et réglages ne suivent pas.

### Les options

| Option | Effet |
|---|---|
| Mot de passe de l’administration | `CORNELIUS_ADMIN_PASSWORD`. Un mot de passe choisi ensuite dans l’administration le remplace : l’option n’a alors plus d’effet. |
| Clé OpenAI | `OPENAI_API_KEY`, facultative : celle collée dans l’administration passe avant. |
| Petite machine | `auto`, `oui` ou `non` : voir [Raspberry Pi](raspberry-pi.md#ce-qui-change-sur-un-raspberry-pi). `auto` vaut `oui` sur Raspberry Pi, Home Assistant Green et Yellow, ODROID et Khadas (type de machine donné par Home Assistant), `non` ailleurs. |
| Port interne | `PORT`, `3000` par défaut, sur la boucle locale de la box. À changer s’il est déjà pris par une autre application. |
| Numéro de la caméra USB | `CORNELIUS_CAMERA_INDEX`, pour une caméra branchée sur la box. |
| Noms d’hôte acceptés | `CORNELIUS_ALLOWED_HOSTS`, en plus du nom de la box (`homeassistant`, `homeassistant.local`), toujours accepté. |

Le fuseau horaire est celui de Home Assistant. Le port HTTPS se change dans la rubrique **Réseau** de l’application.

## Ouvrir le miroir

1. Sur l’appareil du miroir, ouvrez `https://homeassistant.local:3443/`. Passez l’avertissement du certificat après avoir comparé son empreinte avec celle du **Journal** de l’application (voir [Le certificat](../utilisation/reseau-local.md#le-certificat)).
2. Autorisez l’appareil avec le mot de passe de l’administration.
3. Dans l’administration, **Caméra et reconnaissance → Emplacement de la caméra**, choisissez **Sur l’appareil qui affiche le miroir**, sauf si une caméra USB est branchée sur la box.
4. Touchez **Activer la voix** sur le miroir.

### Un Raspberry Pi comme miroir de la box

Un Raspberry Pi peut afficher le miroir sans faire tourner Cornelius. Suivez [Sans bureau (Raspberry Pi OS Lite)](raspberry-pi.md#sans-bureau-raspberry-pi-os-lite), avec quatre différences, car le miroir vient alors de la box, en HTTPS, avec le certificat de Cornelius :

1. Dans la règle de Chromium, remplacez `http://127.0.0.1:3000` par `https://homeassistant.local:3443`.
2. Relevez l’empreinte de la clé du certificat, que Chromium acceptera sans avertissement :

   ```sh
   openssl s_client -connect homeassistant.local:3443 </dev/null 2>/dev/null \
     | openssl x509 -pubkey -noout | openssl pkey -pubin -outform der \
     | openssl dgst -sha256 -binary | base64
   ```

3. Dans le script du kiosque, attendez la box avec `curl -skf -o /dev/null https://homeassistant.local:3443/api/health`, et lancez Chromium sur `https://homeassistant.local:3443/` en ajoutant `--user-data-dir="$HOME/.config/cornelius-kiosk" --ignore-certificate-errors-spki-list=<empreinte>`. Chromium n’applique cette exception qu’avec son propre dossier de profil.
4. Au premier lancement, le miroir demande le mot de passe de l’administration pour autoriser le Pi : branchez un clavier le temps de le saisir. L’autorisation est gardée dans ce profil.

L’empreinte change si Cornelius recrée sa clé (dossier de l’application effacé) : relevez-la de nouveau.

## Les satellites

Les [satellites audio](../fonctionnalites/satellites.md) trouvent la box seuls par mDNS : rien n’est à ouvrir, Home Assistant OS n’a pas de pare-feu. Dans l’administration, la box apparaît sous le nom du conteneur, `local-cornelius` ou celui de l’application installée depuis la boutique.

Un satellite se connecte au premier Cornelius qui répond. Si un autre ordinateur fait aussi tourner Cornelius sur le même réseau, arrêtez-le, ou donnez au satellite l’adresse de la box dans sa page de configuration, rubrique **Adresse fixe de Cornelius** (par exemple `wss://192.168.1.10:3443/satellite`).

## Connecter Home Assistant

Dans **Modules → Home Assistant**, l’adresse est `http://127.0.0.1:8123` : l’application partage le réseau de la box, le trafic ne sort pas. Si Home Assistant sert lui-même du HTTPS (`ssl_certificate` dans sa configuration), utilisez son adresse `https://` avec le nom de son certificat. Le jeton se crée comme d’habitude, de préférence avec un compte réservé à Cornelius (voir [Réduire le risque](../fonctionnalites/home-assistant.md#réduire-le-risque)).

## Sécurité

L’application demande le réseau de l’hôte (satellites par mDNS, HTTPS sur le réseau local, Home Assistant sur `127.0.0.1`) et l’accès vidéo (caméra USB facultative). Sur le réseau de l’hôte, `127.0.0.1` est partagé avec Home Assistant et ses autres applications : l’application lance Cornelius avec `CORNELIUS_TRUST_LOOPBACK=0`. Un programme de la box a alors les mêmes droits qu’un appareil du réseau local : il n’ouvre ni le miroir ni l’administration sans le mot de passe. La perception, elle, se connecte par la boucle locale avec son jeton (voir [Configuration](../reference/configuration.md#variables-internes)).

## Données et sauvegardes

Tout ce qui doit durer est dans le dossier de l’application (`/data` dans le conteneur) : la base, son journal et ses copies, le certificat HTTPS, les images de l’écran de veille, les images générées, le jeton de la perception et les modèles. Les sauvegardes de Home Assistant contiennent donc le jeton Home Assistant, les signatures des visages et les options (mot de passe, clé OpenAI) : gardez-les à l’abri.

Pendant une sauvegarde, l’application s’arrête le temps de copier son dossier (base, images, journal), puis repart. Les modèles ne sont pas sauvegardés : ceux de l’image sont remis au démarrage, et le modèle de vision se retélécharge depuis l’administration.

## Mettre à jour

L’image contient une version précise de Cornelius et du dépôt [cornelius-modules](https://github.com/lfpoulain/cornelius-modules), fixée par la version de l’application : chaque nouvelle version indique dans son historique le commit de Cornelius qu’elle contient. Une nouvelle version apparaît dans **Paramètres → Mises à jour** ; **Mettre à jour** reconstruit l’image, et la base est migrée au démarrage, comme d’habitude. Le certificat HTTPS et sa clé sont gardés : le miroir et les satellites déjà associés n’ont rien à refaire.

## Limites

- L’administration ne s’ouvre pas dans le panneau latéral de Home Assistant (Ingress) : le miroir a besoin de son propre HTTPS pour le micro, et Cornelius interdit l’affichage dans un cadre.
- La génération d’images locale n’est pas prévue : choisissez OpenAI. Un modèle local installé depuis l’administration serait perdu à chaque redémarrage de l’application.
- Le journal de l’application (onglet **Journal**) montre le serveur et la perception ; le journal détaillé reste dans l’administration.

## Voir aussi

- [Accès depuis le réseau local](../utilisation/reseau-local.md)
- [La caméra du navigateur](../fonctionnalites/camera-navigateur.md)
- [Home Assistant](../fonctionnalites/home-assistant.md)
- [Premier démarrage](premier-demarrage.md)
