# Les satellites audio

Cette page explique comment installer un satellite audio dans une autre pièce, le régler et s’en servir. Elle s’adresse à la personne qui installe et règle Cornelius. Le dialogue technique entre Cornelius et un satellite est décrit dans [le protocole des satellites](../developpement/satellites-protocole.md).

## Ce qu’est un satellite

Un satellite est un petit boîtier avec un micro, un haut-parleur et un anneau lumineux, posé dans une autre pièce. On lui parle comme au miroir : « Cornelius, quelle heure est-il ? », et Cornelius répond par son haut-parleur.

- La conversation est **en voix seule** : ni carte, ni image, ni caméra.
- **Une seule conversation à la fois** dans la maison : sur le miroir ou sur un satellite. Un satellite qui entend « Cornelius » pendant ce temps clignote en ambre.
- Quand le miroir et un satellite entendent le même « Cornelius », l’appareil qui l’a le mieux entendu répond.
- Pendant la conversation d’un satellite, le miroir reste au repos et affiche « Conversation en cours : » suivi du nom de la pièce.
- La conversation se termine après un silence (réglage **Fin de parole** de **Quand il écoute**, 20 secondes par défaut).

Matériel pris en charge : la carte **Waveshare ESP32-S3-AUDIO-Board**, avec le firmware **cornelius-satellite** (dépôt séparé, à compiler et flasher une fois avec ESP-IDF ; voir son README).

## Avant de commencer

- Le mot d’appel « Cornelius » doit être activé : **Quand il écoute → Ce qui l’ouvre → « Cornelius »** (voir [Le mot d’appel](mot-d-appel.md)).
- L’accès depuis le réseau local doit être activé (il l’est par défaut, voir [Accès depuis le réseau local](../utilisation/reseau-local.md)).
- Le satellite rejoint un Wi-Fi en **2,4 GHz**, sur le même réseau que l’ordinateur de Cornelius.
- Le pare-feu de l’ordinateur doit laisser entrer le port `3443` (TCP) et l’annonce du réseau local (mDNS, port `5353` en UDP) pour Node.js. Rien n’est à ouvrir avec l’[application Home Assistant](../installation/home-assistant.md#les-satellites).

## Installer un satellite

1. **Branchez le satellite.** Neuf, son anneau respire en bleu : il ouvre un réseau Wi-Fi « **Cornelius-Satellite-XXXX** ».
2. **Choisissez votre Wi-Fi.** Connectez un téléphone à ce réseau. La page de configuration s’ouvre seule (sinon, allez sur `http://192.168.4.1`). Choisissez le Wi-Fi de la maison, saisissez son mot de passe, puis **Enregistrer**. Le satellite redémarre.
3. **Il trouve Cornelius.** Le satellite rejoint votre Wi-Fi et trouve Cornelius tout seul sur le réseau. Son anneau respire en blanc : il attend d’être associé.
4. **Associez-le.** Remettez le téléphone sur votre Wi-Fi habituel. Dans l’administration, **Satellites audio**, la carte « **Nouveaux satellites** » le présente (son nom commence par `cornelius-satellite-`). **Faire clignoter** allume son anneau pour le reconnaître parmi plusieurs. Donnez-lui une pièce, puis **Associer**.

Le satellite reçoit alors sa clé d’accès, redémarre et se connecte : il est prêt. Rien n’est accordé à un satellite tant que personne n’a cliqué sur **Associer**.

Le satellite retient l’identité de Cornelius au moment de l’association, et ne se connecte ensuite qu’à lui. Associez-le donc sur votre propre réseau, quand Cornelius tourne normalement.

## Les réglages d’un satellite

Chaque satellite a sa fiche dans **Administration → Satellites audio**, avec son état (en ligne ou non, version du firmware, micro coupé).

| Réglage | Effet |
|---|---|
| **Pièce** | Le nom affiché sur le miroir pendant sa conversation. |
| **Conversations au nom de** | **Le foyer** par défaut : conversation sans mémoire personnelle. Choisir une personne donne à la conversation sa mémoire et ses outils, quelle que soit la personne qui parle dans la pièce. Un satellite rattaché à une personne peut ouvrir même quand l’ouverture est réservée aux membres du foyer ; les autres ne le peuvent pas, puisqu’ils ne voient personne. |
| **Volume** | De 0 à 10, appliqué aussitôt. |
| **Couleur de l’anneau** | La couleur de l’écoute, de l’ouverture et de la conversation. Les alertes gardent la leur. |
| **Luminosité** | De 0 à 10. À 0, l’anneau ne s’allume plus que pour les alertes. |
| **Veilleuse** | En veille, une lueur faible de la couleur choisie montre que le satellite est prêt. |
| **Écoute attentive** | Le micro reste ouvert pendant que Cornelius parle : on peut lui couper la parole (« attends, plutôt la météo »). Possible seulement avec un satellite qui annule l’écho de son haut-parleur, ce que la fiche indique. Sans elle, le micro est coupé pendant que Cornelius parle. |

**Nouveau jeton** remplace la clé d’accès du satellite : il faudra le réassocier. **Retirer** le déconnecte et oublie son accès.

## L’anneau lumineux

| Anneau | Sens |
|---|---|
| bleu qui respire | réseau de configuration ouvert : choisissez le Wi-Fi |
| bleu qui tourne | recherche du Wi-Fi |
| blanc qui respire | en attente d’association dans l’administration |
| blanc qui clignote | **Faire clignoter** a été demandé |
| orange qui respire | Cornelius injoignable |
| éteint, ou veilleuse | veille |
| couleur choisie, bref | « Cornelius » entendu |
| couleur choisie qui tourne | la conversation s’ouvre |
| couleur choisie, plus vive quand il parle | conversation en cours |
| ambre qui clignote | occupé : une conversation se tient ailleurs |
| rouge | micro coupé |
| rouge qui clignote | remise à zéro |

## Le volume à la voix

Pendant une conversation sur un satellite, « parle plus fort », « moins fort » ou « mets le volume à 5 » règle son haut-parleur (outil `satellite__volume`, de 0 à 10, deux crans pour plus fort ou moins fort). Le réglage est enregistré comme depuis l’administration et envoyé aussitôt au satellite. Il n’existe pas sur le miroir.

## Le bouton BOOT

- **Appui bref pendant une conversation** (l’anneau allumé) : ferme la conversation tout de suite, sans attendre le silence. Demande un firmware qui envoie `session` / `end` ; un firmware plus ancien coupe le micro à la place.
- **Appui bref** en veille : coupe ou rouvre le micro. Micro coupé, le satellite n’envoie plus aucun son, même après un redémarrage. Appuyez de nouveau pour le rouvrir.
- **Tenu 5 secondes** : remise à zéro. Le satellite oublie le Wi-Fi, son accès et ses réglages, puis repart de l’étape 1 de l’installation.

N’appuyez pas sur **RST** en tenant **BOOT** : la carte passerait en mode de programmation (un appui sur **RST** seul la fait repartir).

## Où va le son

- **En veille**, le satellite envoie le son de son micro à l’ordinateur de Cornelius, par le réseau local et chiffré, seulement quand Cornelius écoute « Cornelius ». C’est l’ordinateur qui cherche le mot, avec le même modèle que pour le miroir. Rien ne part sur Internet.
- **Pendant la conversation**, le son passe par l’ordinateur de Cornelius, qui le transmet à OpenAI, comme pour le miroir. La voix de Cornelius revient par le même chemin.
- **Micro coupé** (bouton BOOT), le satellite n’envoie rien.

Voir aussi [Confidentialité](../reference/confidentialite.md).

## Quand il ne répond pas

| Ce qu’on voit | Que faire |
|---|---|
| Anneau bleu qui tourne longtemps | Le Wi-Fi ne répond pas. Après quelques essais, le satellite rouvre son réseau de configuration : vérifiez le mot de passe, et que le réseau est en 2,4 GHz. |
| Anneau orange | Cornelius est éteint, injoignable, ou l’accès depuis le réseau local est désactivé. Vérifiez que Cornelius tourne, et le pare-feu (port `3443`). Le satellite le recherche de lui-même toutes les 30 secondes. |
| Il n’apparaît pas dans « Nouveaux satellites » | Le satellite ne trouve pas Cornelius : vérifiez le pare-feu (mDNS, port `5353` en UDP) et que l’ordinateur est sur le même réseau. |
| « Cornelius » n’ouvre rien | Le mot d’appel doit être activé et prêt (**Quand il écoute**). Si l’ouverture est réservée aux membres du foyer, rattachez le satellite à une personne. |
| Cornelius s’interrompt tout seul | L’écoute attentive est active alors que l’écho n’est pas annulé : désactivez-la dans la fiche du satellite. |

Le journal de Cornelius (rubrique **Journal**) note la connexion de chaque satellite, le mot d’appel entendu et, pendant que Cornelius parle, les mesures d’écho envoyées par le satellite (« Journal du satellite »).

## Voir aussi

- [Le protocole des satellites](../developpement/satellites-protocole.md)
- [Le mot d’appel](mot-d-appel.md)
- [Ouverture et présence](ouverture-et-presence.md)
- [Accès depuis le réseau local](../utilisation/reseau-local.md)
- [Confidentialité](../reference/confidentialite.md)
