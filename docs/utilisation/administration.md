# L’administration

Cette page fait le tour de l’administration de Cornelius : la connexion, le panneau de conversation et chacune des rubriques, dans l’ordre de la barre latérale. Elle s’adresse à la personne qui installe et règle le miroir.

## Ouvrir l’administration

L’administration est une page web servie par Cornelius, à l’adresse `http://127.0.0.1:3000/admin` (le port est celui de `PORT` dans le fichier `.env`, 3000 par défaut).

- **Depuis la maison seulement.** Sur cet ordinateur, à `http://127.0.0.1:3000/admin` ; depuis un téléphone ou un autre ordinateur du réseau local, à `https://<adresse de l’ordinateur>:3443/admin` (voir [Accès depuis le réseau local](reseau-local.md)). Une adresse Internet est toujours refusée.
- **Mot de passe.** L’écran « Espace administration » demande le « Mot de passe administrateur », défini au départ par `CORNELIUS_ADMIN_PASSWORD` dans le fichier `.env` (`cornelius` après `npm run setup`). Changez-le dans **Mise en route**, carte « Mot de passe administrateur » (8 caractères au moins) : il remplace aussitôt celui de `.env`, sans redémarrage, et les autres navigateurs connectés doivent se reconnecter. Tant que le mot de passe de départ reste en place, la rubrique « Mise en route » le signale.
- **Tentatives limitées.** Dix essais par minute au plus, réglables avec `CORNELIUS_LOGIN_RATE_LIMIT` dans `.env`.
- **Durée de la session.** Une connexion reste valable une heure, et chaque action la prolonge d’une heure. Elle se perd aussi quand le serveur redémarre. L’écran de connexion revient alors avec « Votre session a expiré ou le serveur a redémarré. Reconnectez cet espace. ».

Le miroir, lui, ne demande aucun mot de passe. Pour l’adresse du miroir et la différence entre `127.0.0.1` et `localhost`, voir [Le miroir](miroir.md).

## L’en-tête

En haut de chaque rubrique :

- le nom du groupe, le titre de la rubrique et une phrase qui dit à quoi elle sert ;
- une pastille « Serveur connecté », ou « Reconnexion… » quand le serveur ne répond plus ;
- **Voir le miroir** : ouvre le miroir dans sa propre fenêtre, à la taille de l’écran, et laisse l’administration ouverte. Un second clic ramène cette fenêtre au premier plan sans la recharger. Un miroir ouvert dans un autre onglet passe alors en attente (voir [Le miroir](miroir.md#miroir-ouvert-dans-un-autre-onglet)) ;
- **Se déconnecter** : ferme la session sur ce navigateur.

Quand la connexion au serveur se perd plus d’une seconde et demie, un bandeau « Connexion au serveur perdue. » s’affiche et les réglages sont grisés. Les rubriques « État du système » et « Journal » restent lisibles.

## Le panneau de conversation

Sous l’en-tête, un panneau résume l’état de la conversation : un titre (« Conversation en cours », « En veille attentive », « Configuration à terminer », « Session arrêtée », « Accès OpenAI bloqué »…) et, dessous, ce qu’attend Cornelius ou ce qui l’empêche de démarrer. Quand des étapes de la mise en route restent à faire, un lien « Voir la mise en route » donne leur nombre.

Dans la plupart des rubriques, le panneau tient sur une ligne, avec un seul bouton : « Démarrer la session » ou « Arrêter la session ». Il est complet dans la rubrique « Quand il écoute », avec :

- **Démarrer la session** : lève un arrêt manuel et réactive le démarrage automatique. Il reste grisé tant qu’un motif bloque le démarrage (clé absente, miroir fermé, caméra indisponible…), et le motif est écrit à côté.
- **Arrêter la session** : ferme la conversation en cours et suspend le démarrage automatique jusqu’au prochain « Démarrer la session ». Si le mot « Cornelius » ouvre la conversation, le dire suffit aussi pour reprendre.
- **Activer et ouvrir le miroir** : présent tant que le miroir n’est pas ouvert ou que la voix n’y est pas autorisée. En un seul clic, il ouvre le miroir dans sa propre fenêtre et réactive le démarrage ; le micro et le son se préparent dans la fenêtre du miroir (« Activer la voix » si le navigateur demande un clic). Quand OpenAI est bloqué, il devient « Autoriser OpenAI et ouvrir le miroir ».
- **Bloquer OpenAI** : coupe tout échange avec OpenAI. Plus aucune conversation ne s’ouvre et le miroir affiche « Accès à OpenAI bloqué depuis l’administration. ». Le bouton devient « Autoriser OpenAI » pour revenir en arrière. Le blocage est conservé après un redémarrage.
- **La présence devant le miroir** : nombre de personnes « Devant le miroir », personne « Reconnue », personne « Engagée » (qui regarde le miroir) et état du « Micro du miroir ». Quand la caméra est éteinte en veille, le panneau montre l’état du « Mot d’appel » à la place.

## La règle d’enregistrement

Une même règle vaut dans toutes les rubriques :

- **Les choix s’enregistrent tout de suite.** Un bouton d’option, un interrupteur ou un préréglage (« Souple », « Équilibrée », « Stricte »…) est enregistré au clic. Un message en bas de l’écran le confirme.
- **Les valeurs chiffrées attendent votre confirmation.** Elles se trouvent dans un repli « Réglage fin ». Dès qu’une valeur change, une barre « 1 modification non enregistrée » apparaît, avec **Enregistrer** et **Annuler**. Une valeur hors limites est expliquée sous la barre, et « Enregistrer » reste grisé.
- **Les textes** (personnalité, repères, sources, commandes) s’enregistrent de la même façon, avec Enregistrer et Annuler.

Si vous quittez une rubrique avec des modifications non enregistrées, l’administration demande : « Des modifications ne sont pas enregistrées. Quitter cette rubrique sans les enregistrer ? ».

Les réglages sont gardés sur le serveur et conservés après un redémarrage. Seul le choix du micro et des haut-parleurs est propre au navigateur.

## Mise en route

*Premiers réglages.* Ce qu’il reste à faire avant la première conversation, étape par étape. C’est la rubrique ouverte à l’arrivée tant qu’une étape reste à faire. Ensuite, l’administration s’ouvre sur « Quand il écoute ».

La carte « Avant la première conversation » (« Tout est prêt » une fois fini) liste les étapes dans l’ordre où elles se font. Chacune porte un état, « Fait », « À faire », « Bloqué » (elle attend une étape précédente) ou « Facultatif », et, quand il y a lieu, un bouton pour agir :

1. **Clé OpenAI** : à coller dans la carte **Clés et jetons**, juste en dessous (ou `OPENAI_API_KEY` dans `.env`, avec un redémarrage).
2. **Service caméra (perception)** : le service qui lit la caméra et entend le mot « Cornelius ». S’il est arrêté, relancez Cornelius avec `scripts/start.sh` (`scripts/start.ps1` sous Windows). La raison d’un échec est dans `data/run/logs/perception.err.log`. Bouton « Ouvrir le diagnostic ».
3. **Caméra choisie** : bouton « Choisir la caméra ». Facultatif si « Cornelius » ouvre la conversation pour tout le monde, sans reconnaissance ni vision locale.
4. **Miroir ouvert** : l’adresse du miroir est rappelée, avec « Activer et ouvrir le miroir ».
5. **Voix activée sur le miroir** : le micro et le son autorisés dans le navigateur du miroir.
6. **Visage enregistré** : nécessaire quand la conversation est réservée aux membres du foyer, facultatif sinon (il permet l’accueil par le prénom). Bouton « Enregistrer un visage ».
7. **Mot d’appel « Cornelius »** : seulement si le mot « Cornelius » ouvre la conversation. Le modèle doit se trouver dans `models/cornelius.onnx`. Bouton « Guide du mot d’appel ».
8. **Mot de passe administrateur** : à changer dans la carte du même nom, plus bas, s’il vaut encore celui de départ.
9. **Accès à OpenAI** : bouton « Autoriser OpenAI » s’il a été bloqué.

La liste se met à jour d’elle-même. Sous elle : la carte **Clés et jetons** (clé OpenAI et jetons des modules, pris en compte sans redémarrage), la carte **Mot de passe administrateur** et la carte **Accès depuis le réseau local**. Le parcours complet est décrit dans [Premier démarrage](../installation/premier-demarrage.md).

## Micro et haut-parleurs

*Premiers réglages.* Par où Cornelius vous entend, et par où il vous répond.

Carte « Audio de ce navigateur » :

- **Autoriser et vérifier le microphone** : demande l’autorisation au navigateur, puis affiche « Micro autorisé ». Le micro n’est allumé que le temps de la vérification, qui attend la fin d’une conversation en cours.
- **Microphone** et **Haut-parleurs** : « Périphérique par défaut » au départ. Un appareil débranché reste proposé comme « Périphérique enregistré (à reconnecter) ».
- **Tester le haut-parleur** : joue le son « Carillon ».

Ce choix appartient au navigateur où il est fait, et à l’adresse utilisée. Faites-le dans le navigateur qui affiche le miroir.

## Caméra et reconnaissance

*Premiers réglages.* La caméra du miroir, la reconnaissance des visages et le regard.

- **Caméra du miroir** : choisissez la « Caméra », puis « Utiliser cette caméra ». « Actualiser la liste » cherche une caméra qui vient d’être branchée, « Afficher l’aperçu » montre l’image en direct (rien n’est enregistré). « Résolution » (640 x 480, 1280 x 720 recommandée, 1920 x 1080) et « Images par seconde » (15, ou 30 recommandée) règlent l’image de la caméra ; un conseil s’affiche sous chaque liste, et « Image reçue » dit ce que la caméra a réellement accepté. Tant que cette page (ou « Reconnaissance des visages ») est ouverte, la caméra reste allumée pour le réglage, même si le mode d’ouverture l’éteint en veille ; elle reprend son fonctionnement habituel moins d’une minute après. Le choix n’est impossible que si le service caméra est arrêté ou pendant un enregistrement de visage. Pendant une conversation, il reste possible : la conversation peut seulement perdre la présence un instant. La raison ou la remarque est écrite sous la liste.
- **Exigence de la reconnaissance** : la ressemblance demandée avant de reconnaître une personne. « Très souple », « Souple », « Équilibrée » (par défaut) ou « Stricte ». Le chiffre exact se règle dans « Réglage fin », de 0,20 (souple) à 0,65 (stricte), 0,42 par défaut. « Tester en direct » montre le score de chaque personne face à l’exigence.
- **Détection du regard** : quand Cornelius estime que vous le regardez, d’après l’orientation et la taille du visage, sans suivre les yeux. « Souple », « Équilibrée » (par défaut, le réglage conseillé) ou « Stricte ». Dans « Réglage fin » : « Orientation de la tête acceptée », de 10 à 50 (30 par défaut), et « Taille minimale du visage (%) », de 5 à 30 (14 par défaut).

Voir [Ouverture et présence](../fonctionnalites/ouverture-et-presence.md).

## Le foyer et les visages

*Premiers réglages.* Les personnes que Cornelius connaît, et le visage de chacune.

- **Les membres du foyer** : la liste des profils. Pour chacun : « Personnaliser Cornelius », « Renommer » et « Supprimer ». La suppression efface le visage, les souvenirs, le style et les repères, les sources et commandes personnelles et la connexion à l’agent de la personne, copies de sécurité comprises. Elle propose aussi « Oublier seulement le visage ». Le bouton « Personnaliser Cornelius pour le foyer » mène au style commun.
- **Une nouvelle personne** : « Prénom ou nom d’affichage », puis « Ajouter au foyer ». La case « Laisser Cornelius retenir des souvenirs pour cette personne » est cochée par défaut, et modifiable ensuite dans la rubrique « Mémoire ». Après l’ajout, « Mémoriser le visage de … maintenant » lance l’enregistrement.
- **Reconnaissance des visages** : chaque personne mémorise son visage en cinq positions (de face, un côté, l’autre côté, vers le haut, vers le bas), seule devant le miroir. Aucune photo n’est gardée, seulement des signatures numériques sur cet ordinateur. Pour un visage déjà mémorisé : « Compléter » (ajouter des vues, par exemple le soir ou avec des lunettes), « Refaire » ou « Oublier ». « Tester en direct » montre qui est reconnu. Quand deux proches se ressemblent, un conseil s’affiche.

L’enregistrement d’un visage demande le service caméra. Quel que soit le mode d’ouverture, la caméra reste allumée tant que la page est ouverte.

## Quand il écoute

*Premiers réglages.* Ce qui ouvre la conversation, qui peut l’ouvrir et quand elle se termine. C’est la rubrique d’arrivée une fois la mise en route terminée, et la seule où le panneau de conversation est complet.

- **Ouverture de la conversation**, en deux questions :
  - « Ce qui l’ouvre » : « La présence », « Le regard » (par défaut) ou « « Cornelius » » ;
  - « Qui peut l’ouvrir » : « Tout le monde » (par défaut) ou « Les membres du foyer » ;
  - avec « Cornelius » pour tout le monde, la case « Reconnaître la personne pendant la conversation » (décochée par défaut) allume la caméra le temps de la conversation pour retrouver la personne.
  
  Un résumé dit ce que fait Cornelius et si la caméra reste allumée en veille. Un avertissement apparaît quand le choix ne peut pas fonctionner aujourd’hui (service caméra arrêté, mot d’appel pas prêt, aucun visage mémorisé). Voir [Ouverture et présence](../fonctionnalites/ouverture-et-presence.md) et [Le mot d’appel](../fonctionnalites/mot-d-appel.md).
- **Fin de parole** : « Fermer après un silence de » « Jamais » (par défaut), 10 s, 20 s, 30 s, 1 min, 2 min ou 5 min, même si la personne reste devant le miroir. Un autre délai, de 3 à 300 s, se règle dans « Réglage fin ». Avec « Cornelius » pour tout le monde, « Jamais » n’est pas disponible : la présence ne termine pas la conversation dans ce mode.
- **Mode vie privée** (désactivé par défaut) : dès qu’une deuxième personne est détectée, la conversation se ferme et aucune ne s’ouvre tant qu’il y a du monde. Voir [Le miroir](miroir.md#plusieurs-personnes-et-vie-privée).
- **Accueil à l’ouverture** : ce que Cornelius dit en premier quand il reconnaît la personne. « « Bonjour » et le prénom » (par défaut), « Accueil libre » (dans le ton choisi dans « Personnaliser Cornelius ») ou « Pas d’accueil ». Sans personne reconnue, il ne salue jamais.
- **Son d’ouverture** : « Aucun son » (par défaut), ou « Carillon », « Goutte », « Cristal », « Bulle », « Cloche », « Souffle ». Le son choisi est joué une fois pour l’écouter. Le miroir ne le joue qu’après l’activation de la voix.
- **Réglages avancés** (replié) :
  - **Micro gardé prêt** (bêta) : « Garder le micro prêt » (désactivé par défaut) permet de dire « Cornelius, allume la lumière » d’une traite. Le micro reste prêt sur cet ordinateur ; le son n’est envoyé qu’une fois la conversation ouverte ;
  - **Délais de présence** : cinq délais en secondes, avec un bouton « Valeurs par défaut ». « Confirmer un départ » (1,5 s, de 0 à 30), « Terminer après la perte du regard » (8 s, de 0 à 60), « Garder l’identité sans nouvelle preuve » (8 s, de 0 à 60), « Confirmer une présence » (0,4 s, de 0 à 5) et « Confirmer le regard » (0,35 s, de 0 à 5) ;
  - **Délégation : recherches et actions** : le modèle qui fait les recherches, les cartes et les commandes. « Normal », « Rapide » (par défaut) ou « Ultra rapide ». Changer de mode pendant une conversation la termine, après confirmation. « Ultra rapide » ne fonctionne pas si votre compte OpenAI garde ses données en Europe.

## Satellites audio

*Premiers réglages.* Les micros et haut-parleurs des autres pièces. Voir [Les satellites audio](../fonctionnalites/satellites.md).

- **Nouveaux satellites** (quand un satellite neuf attend) : « Faire clignoter », une pièce, puis « Associer » ; ou « Refuser ».
- Une fiche par satellite : en ligne ou non, firmware, micro coupé ; la pièce et « Conversations au nom de » (« Le foyer » par défaut), avec « Enregistrer » ; puis, enregistrés aussitôt, le volume (0 à 10), la couleur et la luminosité de l’anneau, la veilleuse et l’écoute attentive ; enfin « Nouveau jeton » et « Retirer ».
- Le formulaire « Pièce du nouveau satellite » crée un accès pour un satellite configuré à la main (développement) : le jeton est affiché une seule fois, avec les adresses et l’empreinte de la clé.

## Personnaliser Cornelius

*Au quotidien.* Son caractère, sa façon de parler à chacun, sa voix et la taille de son orbe.

- **Personnaliser pour** : « Tout le foyer », ou une personne. Changer de personne affiche ses réglages sans rien modifier.
- **Style commun du foyer** : « Comment parler à tout le monde », avec des idées à ajouter d’un clic (« Tutoiement », « Vouvoiement », « Réponses courtes », « Humour léger », « Sans répétitions »). « Revenir au caractère par défaut » vide le champ.
- **Réglages de …** (pour une personne) : « Comment parler à … », qui l’emporte sur le style du foyer en cas de désaccord, et « Ce qu’il faut savoir sur … » : des faits (lieux, surnoms, noms de pièces), transmis seulement quand la caméra reconnaît la personne. « Effacer les repères » vide ce champ ; « Voir ce que Cornelius a retenu » mène à sa mémoire.
- **Ce que Cornelius reçoit** : le texte complet transmis au modèle au début de chaque conversation, vos réglages surlignés à la fin.

Chaque texte compte 4 000 caractères au plus. Enregistrer s’applique aussitôt : une conversation en cours redémarre. Voir [La personnalité](../fonctionnalites/personnalite.md).

- **Voix de Cornelius** : l’une des 22 voix de GPT-Live. Cedar (par défaut) et Marin sont conseillées pour le français ; les autres peuvent garder un léger accent anglais. La nouvelle voix s’entend à la conversation suivante.
- **Taille de l’orbe** : de 50 à 150 % de sa taille d’origine, appliquée en direct sur le miroir ; « Revenir à 100 % » la remet à l’origine.

## Écran de veille

*Au quotidien.* Les peintures et les photos affichées quand personne n’est devant le miroir. Voir [L’écran de veille](miroir.md#lécran-de-veille).

- **Afficher des images au repos** : désactivé par défaut. Sans image, l’écran reste noir.
- **L’orbe revient** : « Au moindre mouvement » (par défaut) ou « Selon le réveil de Cornelius », qui suit ce qui ouvre la conversation (présence, regard ou mot « Cornelius », réglés dans « Quand il écoute »). La carte dit ce que cela donne avec vos réglages.
- **Transition** : « Aspiration » (par défaut), « Cendres », « Onde », « Mosaïque », « Rideau », « Fondu », « Au hasard » ou « Sans transition ».
- **Affichage des images** : « Entière, de bord à bord » (l’image entière, des bandes noires complètent), « Comme une toile » (par défaut : posée sur son propre flou, ou plein écran si ses proportions sont proches de celles de l’écran) ou « Plein écran » (bords coupés). Une image n’est jamais étirée.
- **Durée de l’effet** : 0,5, 1 (par défaut), 1,5, 2 ou 3 secondes pour la disparition de l’image ; son retour prend 1,6 fois plus longtemps.
- **Changer d’image toutes les** : 30 s, 1, 5 (par défaut) ou 15 minutes, ou 1 heure.
- **Revenir aux images après** : 5 s, 30 s (par défaut), 1 ou 5 minutes sans personne devant le miroir.
- **Images** : « Ajouter des photos » (JPEG, PNG ou WebP, 25 Mo au plus chacune, plusieurs à la fois) et « Télécharger 32 peintures » : une sélection de peintures célèbres du domaine public (Van Gogh, Monet, Hokusai, Vermeer, Léonard de Vinci…), dont 16 verticales pour un miroir en portrait, prises sur Wikimedia Commons. Pour en retirer, cochez les images (un clic sur la vignette), puis « Retirer (n) » et confirmez. Les filtres « Peintures », « Vos photos », « Verticales » et « Horizontales » limitent la grille, et « Tout sélectionner » coche ce qu’elle montre : retirer toutes les horizontales d’un miroir en portrait se fait en trois clics. Une peinture retirée revient avec « Compléter les peintures ».

## Modules

*Au quotidien.* Les sources de ses réponses et les commandes qu’il peut lancer.

Une seule liste, en trois groupes : un module peut aussi bien donner des informations que lancer des commandes (Home Assistant fait les deux). « Sources de » filtre les sources par personne (« Tout le monde », « Le foyer » ou un prénom), « Rechercher un module ou une source » filtre la liste, et une étoile place un module en tête de son groupe.

- **Au quotidien** : « Heure », « Météo » et « Transports ». Chaque module reçoit une ou plusieurs sources, avec « Ajouter une source », puis « Configurer » ou « Supprimer ». Dans une source, « Nom affiché » donne son nom, et « Afficher en permanence sur le miroir » (désactivé par défaut) la garde visible en haut du miroir. Le badge d’un module dit « Prêt », « À configurer », « Désactivé », « … à corriger » ou « Jeton manquant ». Météo demande un jeton Météo Concept et Transports un jeton PRIM : collez-le dans la carte du module (ou dans **Mise en route → Clés et jetons**). Voir [Les modules](../modules/README.md).
- **Maison** :
  - « Home Assistant » : « Adresse Home Assistant », « Jeton longue durée », « Connecter Home Assistant », puis le choix des appareils autorisés. « Autoriser Cornelius à utiliser la sélection » et « Réserver aux personnes reconnues » (désactivé par défaut). Voir [Home Assistant](../fonctionnalites/home-assistant.md) ;
  - « Commandes HTTP » : les adresses que Cornelius déclenche à la voix (ouvrir le portail, lancer une scène…), avec « Nouvelle commande », les « Commandes à valider » qui attendent votre accord, et les « Dernières exécutions ». Le badge du module compte les demandes à valider.
- **Capacités de Cornelius** :
  - « Cartes » : « Cartes à l’écran » (1 à 4, 3 par défaut), « Disparition après » (30 s, 1 minute par défaut, 2 ou 5 minutes) et « Raccourcir les cartes au second plan » (activé par défaut : une carte passée sur le côté garde son titre, sa valeur et deux lignes) ;
  - « Web » : « Autoriser la recherche web » (activé par défaut). Les sources s’affichent sur la carte ;
  - « Vision » : la description de ce que voit la caméra, calculée sur cet ordinateur, en trois étapes (« Choisir le modèle », « Installer », « Activer »). « Quand regarder » : « Jamais », « Au début de la conversation, puis sur demande » (par défaut) ou « Uniquement sur demande ». « Calcul » : automatique, carte graphique ou processeur. Voir [La vision locale](../fonctionnalites/vision-locale.md) ;
  - « Génération d’image » : « Où créer les images », sur ce PC (quatre modèles, de « Léger » à « Très précis », installés sur cet ordinateur en trois étapes) ou avec OpenAI (la même clé que la conversation, un modèle GPT Image et une qualité au choix, rien à installer). « Autoriser la création d’images », « Charger le modèle dès le démarrage » et « Illustrer automatiquement les cartes », tous trois désactivés par défaut. Voir [La génération d’images](../fonctionnalites/generation-d-images.md).

Voir [Les modules](../modules/README.md).

## Agents

*Au quotidien.* Les agents personnels reliés au miroir, et vos demandes en cours.

Un agent Hermes est un assistant personnel installé à part, à qui Cornelius peut confier des demandes longues. « Agent de » choisit la personne. Trois onglets :

- **Connexion** : carte « Connexion et délégation », avec « Adresse de Hermes », « Jeton de connexion » et « À quoi sert cet agent ? » ;
- **Capacités** : « Capacités transmises à Cornelius », avec une recherche ;
- **Demandes** : « Échanger avec Hermes » et le suivi des demandes.

Un badge résume l’état : « À configurer », « Désactivé », « Connexion à vérifier », « Connexion indisponible » ou « Disponible pour Cornelius ». Voir [Les agents Hermes](../fonctionnalites/agents-hermes.md).

## Mémoire

*Au quotidien.* Les souvenirs de chaque personne, à consulter, corriger ou oublier.

- **Souvenirs de** : la personne à afficher.
- **Mémoire de …** : l’interrupteur « Autoriser la mémoire », la recherche « Rechercher un souvenir », la liste des souvenirs (« Sujet », « Souvenir », « Durée », « Expiration ») avec « Oublier » pour chacun et « Tout oublier ».
- **Ce que Cornelius a retenu récemment** : le résultat de l’analyse après chaque conversation. Le texte de la conversation n’est pas conservé.

Les souvenirs ne sont retenus qu’après une conversation avec une seule personne, reconnue par la caméra. Voir [La mémoire](../fonctionnalites/memoire.md).

## État du système

*Diagnostic.* À consulter quand quelque chose ne répond pas.

La rubrique montre, sans rien modifier : l’« État des services » (connexion de l’administration, navigateur du miroir, session, microphone, caméra, présence, cartes en cours), le « Dernier signal » du serveur, l’état de la génération d’image et de la description de la scène, les « Sources et modules » avec leur dernier relevé, et les « Dernières exécutions d’actions ». « Actualiser » relit les sources et les actions. Hors connexion, la rubrique reste lisible et dit de quelle heure datent les valeurs.

La carte **Serveur** porte « Redémarrer le serveur », après confirmation : le serveur relit le fichier `.env`, la conversation en cours est coupée, le miroir et l’administration se reconnectent en quelques secondes et il faut se reconnecter à l’administration. Sous systemd, le service redémarre seul ; avec les scripts `start`, une nouvelle instance prend la place de l’ancienne.

Voir [Dépannage](depannage.md).

## Journal

*Diagnostic.* Tout ce que fait Cornelius, dans l’ordre, à joindre à une demande d’aide.

La carte « Journal détaillé » montre les 1 000 derniers événements depuis le démarrage, mis à jour toutes les 2 secondes. On peut filtrer par origine, cocher « Problèmes seulement », chercher un mot, mettre en « Pause » et « Exporter le journal filtré ». Le détail est dans [Dépannage](depannage.md#lire-et-exporter-le-journal).

## Dans une fenêtre étroite

Sous 760 pixels de large (une petite fenêtre, un écran de tablette), la barre latérale laisse la place à un bouton « Rubrique : … » en haut de la page. Il ouvre la liste des rubriques, rangées dans les mêmes trois groupes. Les boutons s’agrandissent pour le toucher.

Sur un téléphone du réseau local, l’administration s’ouvre par l’adresse HTTPS : voir [Accès depuis le réseau local](reseau-local.md).

Chaque rubrique a sa propre adresse (par exemple `http://127.0.0.1:3000/admin#voice`, ou `#modules/commandes`, qui ouvre le module Commandes HTTP) : un rechargement ou le bouton Précédent ramène au même endroit.

## Voir aussi

- [Le miroir](miroir.md)
- [Dépannage](depannage.md)
- [Premier démarrage](../installation/premier-demarrage.md)
- [Ouverture et présence](../fonctionnalites/ouverture-et-presence.md)
- [Les modules](../modules/README.md)
- [Configuration](../reference/configuration.md)
- [Confidentialité](../reference/confidentialite.md)
