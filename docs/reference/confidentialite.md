# Confidentialité

Cette page dit ce qui reste sur l’ordinateur du miroir, ce qui part chez OpenAI ou ailleurs, et à quel moment. Elle décrit aussi ce qui est enregistré, où, et comment l’effacer. Elle s’adresse aux membres du foyer comme à la personne qui installe Cornelius.

## En bref

- La caméra, les visages et la vision restent sur l’ordinateur. Aucune image ne quitte la machine.
- En veille, le son du micro reste sur l’ordinateur. Celui d’un satellite audio va à l’ordinateur par le réseau local, chiffré, et n’en sort pas.
- Pendant une conversation, la voix et le texte de l’échange partent chez OpenAI. Après la conversation, le texte dit par une personne reconnue peut repartir chez OpenAI pour choisir les souvenirs à garder.
- Cornelius n’enregistre ni image, ni son, ni transcription de conversation sur le disque.

## Ce qui reste sur l’ordinateur

- **Les images de la caméra.** La caméra est lue par le service caméra (la perception), sur l’ordinateur. Les images restent en mémoire vive et ne sont jamais écrites sur le disque.
- **Les visages.** L’enregistrement d’un visage garde des signatures numériques, calculées à partir des images : ce sont des nombres, pas des photos. Elles sont rangées dans la base. La reconnaissance se fait sur l’ordinateur.
- **La vision locale.** La description d’une image est calculée sur l’ordinateur par le modèle LFM2.5-VL. Seul le texte de cette description rejoint la conversation, donc OpenAI. Elle n’est jamais écrite dans la mémoire. Voir [La vision locale](../fonctionnalites/vision-locale.md).
- **Le mot d’appel.** « Cornelius » est reconnu sur l’ordinateur, avec openWakeWord. Aucun service en ligne n’est appelé pour cela.
- **Les images créées.** Par défaut, la génération d’images tourne sur l’ordinateur. Si vous choisissez « Avec OpenAI » dans le module, la description de l’image (jamais une image de la caméra) part chez OpenAI, qui renvoie l’image. Dans les deux cas, les trois dernières images sont gardées dans `data/generated-images/`, puis effacées au prochain démarrage du serveur.

## Où va le son du micro

La caméra est lue par la perception, mais le micro est lu par le navigateur qui affiche le miroir, car la conversation passe par la page. Selon les réglages de **Quand il écoute** :

- **Le mot « Cornelius » ouvre la conversation.** Après **Activer la voix**, le micro reste ouvert pendant la veille. Le son va seulement au serveur, sur l’ordinateur (`127.0.0.1`), puis à la perception qui guette le mot. Rien ne sort de la machine.
- **Micro gardé prêt** (dans **Quand il écoute → Réglages avancés**). Le micro reste prêt sur l’ordinateur. Le son n’est envoyé à la conversation qu’une fois celle-ci ouverte, avec le début de la phrase.
- **Sans mot d’appel ni micro gardé prêt.** Le micro préparé est relâché après 15 secondes si aucune conversation ne s’ouvre.
- **Pendant une conversation.** Le son part chez OpenAI, le temps de la conversation seulement. Il passe aussi par la détection locale de la parole.

**Les satellites audio.** Un satellite envoie le son de son micro à l’ordinateur, par le réseau local et chiffré (WebSocket sécurisé, port `3443`), seulement quand Cornelius écoute « Cornelius » ou pendant sa propre conversation. L’ordinateur y cherche le mot, puis transmet la conversation à OpenAI comme pour le miroir. Une conversation de satellite rattaché à une personne nourrit la mémoire de cette personne ; sinon, elle ne laisse aucun souvenir. Le bouton du satellite coupe son micro. Voir [Les satellites audio](../fonctionnalites/satellites.md).

Pour couper tout envoi vers OpenAI, utilisez **Bloquer OpenAI** (voir plus bas).

## Ce qui part chez OpenAI, et quand

**Pendant une conversation**, OpenAI reçoit :

- la voix et le texte de l’échange ;
- les consignes de Cornelius, le style du foyer et, si la personne est reconnue, son prénom, son style et ses repères (**Personnaliser Cornelius → Ce que Cornelius reçoit** montre ce texte) ;
- les descriptions de la caméra, si la vision est active ;
- les résultats des modules, des commandes, de Home Assistant et des agents, et les souvenirs consultés quand une question porte sur eux ;
- les recherches sur le web, faites par OpenAI, si **Modules → Web → Autoriser la recherche web** est activé.

Les conversations sont ouvertes avec l’option `store: false` d’OpenAI, qui demande de ne pas conserver la réponse pour la consulter ensuite. Cette option ne dit rien des autres règles de conservation d’OpenAI : voir les conditions de votre compte.

**Après une conversation**, si la personne était seule, reconnue, et que sa mémoire est autorisée, le texte de ce qu’elle a dit et ses souvenirs actuels sont envoyés à OpenAI, qui propose quoi retenir. Ce texte est ensuite effacé. Voir [La mémoire](../fonctionnalites/memoire.md).

**À aucun moment** OpenAI ne reçoit d’image de la caméra, de signature de visage, ni le son de la veille.

## Ce qui part ailleurs

- **Météo** et **Transports** interrogent leur fournisseur (Météo Concept, Île-de-France Mobilités) avec le lieu ou l’arrêt réglé dans la source, et leur jeton.
- **Les commandes** (**Modules → Commandes HTTP**) envoient leur requête à l’adresse que vous avez saisie.
- **Home Assistant** reçoit les commandes des appareils autorisés, à l’adresse de votre installation.
- **Les agents** (Hermes) reçoivent la demande confiée par la personne reconnue, à l’adresse de votre agent.
- **Les modèles** sont téléchargés depuis leurs sites (GitHub, Hugging Face) lors de leur installation.
- **Les peintures de l’écran de veille** sont téléchargées depuis Wikimedia Commons, seulement quand vous cliquez sur « Télécharger les peintures ». Vos photos ne quittent jamais l’ordinateur.

## Les données enregistrées

Tout est sur l’ordinateur du miroir, dans le dossier `data/` (voir [Configuration](configuration.md#les-dossiers)) :

| Donnée | Où |
|---|---|
| Profils, signatures des visages, souvenirs, style et repères, sources et commandes, réglages | la base `data/cornelius.sqlite` |
| Jeton Home Assistant et jeton de connexion de chaque agent | la base, **sans chiffrement** |
| Copies de sécurité de la base | à côté de la base, `cornelius.sqlite.backup-v…sqlite` |
| Journal technique | `data/logs/cornelius.log` |
| Trois dernières images créées | `data/generated-images/`, vidé à chaque démarrage |
| Images de l’écran de veille (vos photos et les peintures) | `data/screensaver/` ; leur titre dans la base |
| Mot de passe de l’administration | le fichier `.env` au départ ; s’il est changé dans **Mise en route**, une empreinte (scrypt) dans la base, jamais le mot de passe lui-même |
| Secrets des commandes (`CORNELIUS_SECRET_*`) | le fichier `.env`, jamais dans la base |
| Clé OpenAI, jetons Météo et Transports | la base locale s’ils sont saisis dans l’administration (ils y passent avant ceux de `.env`), sinon le fichier `.env`. L’administration n’en montre que les quatre derniers caractères, et le journal les masque. |

Sous Linux, la base, ses copies, `.env` et le journal ne sont lisibles que par leur propriétaire.

Le jeton Home Assistant et ceux des agents ne sont jamais renvoyés au navigateur, à la conversation ni au journal. Ils sont pourtant lisibles par quiconque peut lire la base. Protégez l’accès à l’ordinateur et ne copiez pas `data/` n’importe où. Voir [Home Assistant](../fonctionnalites/home-assistant.md) et [Les agents Hermes](../fonctionnalites/agents-hermes.md).

## Les copies de sécurité et l’effacement

Avant de mettre à jour la structure de la base, Cornelius en fait une copie dans le même dossier. Seules les deux copies les plus récentes sont gardées.

Quand on efface une donnée personnelle, elle disparaît aussi de ces copies :

- **supprimer un profil** ;
- **Oublier le visage** (**Le foyer et les visages → Reconnaissance des visages**) ;
- **Oublier** un souvenir ou **Tout oublier** (rubrique **Mémoire**).

La base efface vraiment les données supprimées, au lieu de seulement libérer leur place. Une copie illisible est supprimée plutôt que gardée.

Ce qui n’est pas retiré des copies : l’ancienne version d’un souvenir corrigé, un jeton Home Assistant ou d’agent supprimé par **Supprimer la connexion**, et les autres réglages. Ces copies disparaissent d’elles-mêmes au fil des mises à jour suivantes. Pour un effacement immédiat, arrêtez Cornelius et supprimez les fichiers `cornelius.sqlite.backup-v…sqlite`.

Il n’existe pas encore de sauvegarde chiffrée ni de restauration. Ne publiez jamais `data/` ni `.env`.

## Supprimer un profil

Dans **Le foyer et les visages**, **Supprimer** puis **Supprimer … définitivement** efface, sans retour possible :

- le profil et ses signatures de visage ;
- ses souvenirs, son réglage de mémoire et le résultat de ses analyses ;
- son style et ses repères ;
- ses sources et commandes personnelles, avec leurs derniers relevés, leur historique et leurs confirmations en attente ;
- la connexion à son agent et ses demandes en cours.

Tout cela est aussi retiré des copies de sécurité. Les données du foyer (style commun, sources et commandes du foyer) ne sont pas touchées.

## Le journal

Le journal (rubrique **Journal**, fichier `data/logs/cornelius.log`) ne note que des informations techniques. Avant l’écriture, il masque :

- la clé OpenAI, le mot de passe, les jetons de la perception, du générateur d’images, de Météo et de Transports ;
- tout texte qui ressemble à une clé OpenAI ou à un jeton d’accès (`Bearer …`) ;
- tout champ dont le nom évoque un jeton, un secret, un mot de passe, un cookie, une clé, une transcription, du son, une image ou une signature de visage.

Il ne contient donc ni la parole, ni les images, ni le texte des conversations. Relisez-le tout de même avant de le joindre à une demande d’aide : il peut contenir des noms de profils, de sources ou d’adresses.

## L’administration

L’administration demande le mot de passe administrateur (celui de `.env`, ou celui choisi dans **Mise en route**). La connexion reste ouverte une heure après la dernière action, puis il faut se reconnecter. Un redémarrage du serveur ferme toutes les connexions.

Le miroir, lui, ne demande aucun mot de passe. Le miroir et l’administration répondent à l’ordinateur lui-même et, en HTTPS, aux appareils du réseau local (désactivable avec `CORNELIUS_LAN=0`), jamais à Internet. Un autre appareil n’ouvre le miroir qu’après avoir été autorisé une fois avec le mot de passe administrateur.

## Les dépenses OpenAI

Cornelius ne compte pas ce que coûtent les conversations et ne les bloque pas pour ce motif. Fixez vos limites de dépense dans votre compte OpenAI. Les modes **Rapide** et **Ultra rapide** de **Quand il écoute → Réglages avancés → Délégation : recherches et actions** coûtent plus cher que **Normal**.

Le bouton **Bloquer OpenAI**, dans le panneau **Conversation** de la rubrique **Quand il écoute** (le seul où ce panneau est complet), ferme la conversation en cours et interdit toute nouvelle connexion à OpenAI, extraction de souvenirs comprise. Le blocage reste après un redémarrage. **Autoriser OpenAI** le lève. La caméra, la reconnaissance et la vision locale continuent de fonctionner.

## Voir aussi

- [La mémoire](../fonctionnalites/memoire.md)
- [Le mot d’appel](../fonctionnalites/mot-d-appel.md)
- [La vision locale](../fonctionnalites/vision-locale.md)
- [Home Assistant](../fonctionnalites/home-assistant.md)
- [Les agents Hermes](../fonctionnalites/agents-hermes.md)
- [Configuration](configuration.md)
- [Licences](licences.md)
