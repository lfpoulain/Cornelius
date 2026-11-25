# Le lecteur audio

Cette page décrit l’écoute d’une radio, d’un podcast ou d’un son sur le miroir : ce qu’il faut installer, les phrases à dire et ce que fait le son pendant une conversation. Elle s’adresse à toute la famille ; les développeurs de modules trouveront le contrat dans la [référence](../modules/reference.md#loutil-de-lecture).

## Ce qu’il faut

Cornelius ne connaît aucune radio de lui-même : c’est un **module** qui sait où trouver les flux (une radio, un service de podcasts) et qui les propose à la voix. Installez-le depuis **Installer des modules** (voir [Le catalogue](../modules/README.md#le-catalogue)), puis ajoutez-lui une source comme pour tout module. Sans module de ce genre, Cornelius répond qu’il ne sait pas faire.

Le son sort du haut-parleur choisi pour la voix (**Le miroir → Micro et haut-parleurs** dans l’administration). Le navigateur du miroir doit avoir été autorisé une fois avec **Activer la voix** : sans ce geste, il refuse de jouer un son, et Cornelius le dit.

## Les phrases

| Vous dites | Cornelius |
| --- | --- |
| « Mets France Inter », « lance le dernier épisode de … » | Demande le flux au module, puis le joue sur le miroir. Il ne dit que ça joue qu’une fois le son arrivé |
| « Arrête la musique », « coupe la radio » | Arrête la lecture |
| « Remets la radio », « reprends » | Relance la dernière lecture |
| « Plus fort », « moins fort », « mets le son à 4 » | Règle le volume de la lecture, de 0 à 10 (6 au départ) |

Une nouvelle demande remplace ce qui joue : il n’y a qu’une lecture à la fois.

## Sur le miroir

En haut à gauche, un bandeau montre ce qui joue : le logo s’il y en a un, l’état (« En direct », « Lecture », « Connexion… »), le titre et sa précision (pour une radio en HLS qui l’annonce, le morceau en cours : « Debussy – Clair de lune »), et un bouton **Arrêter** pour un miroir tactile. Le son continue sous l’écran de veille.

## Pendant une conversation

Pour que Cornelius vous entende, et que vous l’entendiez :

| Moment | Radio en direct | Podcast, son |
| --- | --- | --- |
| Cornelius écoute ou réfléchit | Le son descend à 15 % | En pause |
| Cornelius parle | Coupé, le flux continue (pas de retard au retour) | En pause |
| Une alarme sonne | Coupé | En pause |
| La conversation est finie | Le volume revient | La lecture reprend |

Une conversation tenue par un **satellite** dans une autre pièce ne change rien au miroir. Le mot « Cornelius » reste écouté pendant la musique : le navigateur retire du micro, par l’annulation d’écho, une partie de ce que joue le miroir. Plus la musique est forte, plus « Cornelius » risque de ne pas être entendu : gardez un volume modéré, ou approchez-vous et parlez distinctement ; la mesure est décrite dans [Mot d’appel et musique](../developpement/mesure-mot-appel-musique.md).

## Ce qui n’est pas encore possible

- Écouter sur un **satellite** : la lecture se fait seulement sur le miroir. Demandée à un satellite, Cornelius le dit.
- Les listes de lecture m3u et pls : le module doit fournir le flux qu’elles contiennent. Les flux HLS (`.m3u8`, par exemple ICI Musique ou FIP) sont lus, sauf s’ils sont chiffrés.
- Plusieurs lectures en même temps.

## Si rien ne joue

| Ce qui se passe | Que faire |
| --- | --- |
| « Son bloqué par le navigateur » | Touchez le miroir ou utilisez **Activer la voix**, puis redemandez |
| « Flux introuvable », « Le flux est injoignable » | Le service du module ne répond pas ; réessayez plus tard ou signalez-le à l’auteur du module |
| « Liste de lecture non prise en charge » | Le module fournit une liste au lieu d’un flux : à corriger dans le module |
| « Flux chiffré (EXT-X-KEY) non pris en charge » | Ce service protège sa diffusion HLS : le miroir ne peut pas la lire |
| « Le miroir n’est pas connecté » | Ouvrez la page du miroir |

Chaque lecture laisse une trace dans **Journal**, origine « Lecteur audio » : la demande, le début, l’échec éventuel et l’arrêt, avec le nom du service seulement.

## Confidentialité

Le serveur ouvre le flux et le transmet au miroir : le navigateur du miroir ne contacte jamais le service de la radio. Pour un flux HLS, le serveur lit aussi la liste et chacun de ses morceaux ; le miroir ne voit que des adresses du serveur. Le service voit l’adresse de votre connexion à Internet, comme pour tout module. Rien de ce que vous écoutez n’est envoyé au modèle de langage, en dehors du titre rendu par l’outil.

## Voir aussi

- [Le miroir](../utilisation/miroir.md)
- [Les modules](../modules/README.md)
- [Le mot d’appel](mot-d-appel.md)
