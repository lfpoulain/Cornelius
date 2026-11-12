# Le satellite Android

> **Application communautaire.** Le satellite Android n’est pas une application de
> Cornelius : elle est écrite et publiée à part, par un particulier, et le projet n’en
> assure ni la maintenance ni le support. L’APK s’installe depuis un dépôt tiers
> ([Malvu/cornelius-android](https://github.com/Malvu/cornelius-android)), en acceptant
> l’installation d’applications inconnues : chaque installation reste sous la
> responsabilité de la personne qui la fait. Le modèle du mot d’appel, embarqué dans
> l’APK, est en **CC BY-NC-SA 4.0** : usage familial et non commercial, attributions à
> conserver (voir `LICENCES.md` du dépôt de l’application).

Un téléphone peut servir de satellite audio, comme une carte ESP32 : on dit
« Cornelius », on pose sa question, et la réponse arrive par le haut-parleur. L’application
est séparée du dépôt : elle s’installe sur le téléphone et parle le
[protocole des satellites](../developpement/satellites-protocole.md). **Rien à changer sur
Cornelius.**

## Ce qu’elle apporte par rapport à un onglet

| | Onglet du navigateur | Application |
|---|---|---|
| Écran éteint, application en arrière-plan | non | oui, service au premier plan |
| Mot d’appel calculé sur le téléphone | non | oui, avec ONNX Runtime |
| Réseau quand personne ne parle | le son part en continu | rien ne part en mode économie |
| Son | compressé par WebRTC | PCM 16 kHz, comme un satellite |

## Ce qu’il faut

- Un téléphone sous Android 8 ou plus récent.
- Cornelius accessible en HTTPS sur le réseau local (`https://<adresse>:3443`), avec un
  mot de passe administrateur qui n’est plus celui de départ : sinon aucun appareil n’est
  accepté ([Accès depuis le réseau local](../utilisation/reseau-local.md)).
- L’application, depuis [son dépôt](https://github.com/Malvu/cornelius-android).

## Installer et associer

1. Copier l’APK sur le téléphone, l’ouvrir, accepter « Installer une application inconnue ».
2. Lancer l’application, vérifier l’adresse de Cornelius, puis **Démarrer l’écoute** et
   accepter le micro.
3. Dans Cornelius : **Administration → Satellites audio → Nouveaux satellites**. Le
   téléphone apparaît sous un nom du genre `cornelius-android-a1b2c3`.
4. Cliquer **Associer** et lui donner une pièce : « Téléphone », « Cuisine »…

L’association n’est faite qu’une fois : le téléphone garde son jeton.

## Les deux modes

**Économie** (par défaut). Le téléphone calcule lui-même le mot d’appel, sans rien
demander au réseau : les trois modèles ONNX viennent avec l’APK (2,6 Mo) et sont lus sur
place. Le modèle « Cornelius » est celui du dépôt de Cornelius ; les deux autres, le
prétraitement, viennent d’openWakeWord. Le téléphone n’envoie du son qu’après avoir
entendu « Cornelius ». Il garde deux secondes d’avance pour ne pas couper le début de la
phrase. C’est le mode à préférer en 4G : presque rien ne part sur le réseau.

**Direct**. Le son part en continu vers Cornelius, qui cherche le mot d’appel, comme avec
une carte ESP32. À essayer si le mode économie rate trop souvent.

Le seuil de reconnaissance (50 % par défaut) se règle dans l’application. Plus bas : plus
sensible, mais plus de fausses ouvertures.

## Hors du réseau local

Cornelius n’accepte que les adresses privées : il n’y a donc **aucun port à ouvrir sur le
serveur**, et une adresse publique restera refusée. Le téléphone rejoint la maison par un
tunnel WireGuard et se présente avec l’adresse du tunnel (`10.6.0.x`). Le serveur voit un
appareil du réseau local, avec le même jeton et le même certificat.

Côté maison :

- un serveur WireGuard, dans le routeur quand il en propose un, sinon sur l’ordinateur de
  Cornelius, sinon sur une box qui sait le faire ;
- un nom pour suivre l’adresse publique, qui change parfois (DuckDNS, asuscomm) ;
- **un seul port UDP ouvert**, `51820` par défaut.

Côté téléphone :

- un profil WireGuard dont les **adresses autorisées** sont limitées au réseau de
  Cornelius (`192.168.50.0/24`), sinon tout le trafic du téléphone passe par la maison ;
- l’application **Cornelius** dans la liste des applications du tunnel, sinon elle sort en
  direct et échoue hors du Wi-Fi ;
- le mode **économie**.

L’adresse dans l’application ne change pas : `192.168.50.3:3443`. Le certificat de
Cornelius ne contient que son adresse sur le réseau local ; c’est le tunnel qui porte les
paquets, pas le nom.

Vérifié le 10 novembre 2026, Wi-Fi coupé, en 4G : ouverture du miroir en **186 ms**,
conversation complète, et le journal de Cornelius montre la connexion venant de `10.6.0.3`.

## Les quatre pièges

1. **Une règle de redirection affichée active mais désactivée** en réalité. Lire l’état
   réel dans l’interface de la box, pas la couleur de l’interrupteur.
2. **Deux routeurs empilés.** La redirection se pose sur celui qui reçoit l’adresse
   publique, pas sur celui qui porte Cornelius. Un `tracert` le montre tout de suite.
3. **Un profil WireGuard limité à une autre application.** Le satellite échoue partout,
   y compris à la maison, sans message explicite.
4. **L’adresse publique qui change** sans nom pour la suivre : le profil et l’adresse de
   terminaison sont à retoucher.

## Limites

- **Voix seule** : pas de cartes, pas d’images. C’est le protocole des satellites.
- **Une conversation à la fois** dans la maison, comme avec un satellite du commerce.
- **Certificat** : Cornelius s’auto-signe, l’application retient l’empreinte au premier
  contact et refuse de continuer s’il change. Il faut alors appuyer sur « Oublier le
  certificat ».
- **Un jeton par téléphone** : deux téléphones associés font deux satellites distincts.
- **Licence** : le modèle du mot d’appel est en CC BY-NC-SA 4.0 ; l’application est
  personnelle, sans usage commercial (voir l’encadré en tête de page).

## Voir aussi

- [Les satellites audio](satellites.md)
- [Le protocole des satellites](../developpement/satellites-protocole.md)
- [Accès depuis le réseau local](../utilisation/reseau-local.md)
- [Confidentialité](../reference/confidentialite.md)
