# Premier démarrage

Cette page vous guide de la fin de l’installation jusqu’à la première conversation avec Cornelius. Elle suit la rubrique « Mise en route » de l’administration, qui indique à chaque instant ce qu’il reste à faire. Comptez une demi-heure, devant le miroir.

## Avant de commencer

- Cornelius est installé et démarré : voir [Installer sous Linux](linux.md) ou [Installer sous Windows](windows.md).
- Le plus simple est de tout faire sur l’ordinateur du miroir. L’administration s’ouvre aussi depuis un autre appareil de la maison, une fois le mot de passe changé : voir [Accès depuis le réseau local](../utilisation/reseau-local.md).
- Utilisez toujours la même adresse, `http://127.0.0.1:3000` (le port est celui de `PORT` dans `.env`). Pour le navigateur, `localhost` et `127.0.0.1` sont deux sites différents : l’autorisation du micro donnée à l’un ne vaut pas pour l’autre.

## 1. Se connecter

Ouvrez `http://127.0.0.1:3000/admin`. Saisissez le « Mot de passe administrateur », puis cliquez sur **Ouvrir cet espace**.

Le mot de passe est la valeur de `CORNELIUS_ADMIN_PASSWORD` dans le fichier `.env`, `cornelius` au départ. Changez-le dès maintenant dans **Mise en route**, carte « Mot de passe administrateur » (8 caractères au moins) : il remplace celui de `.env`, sans redémarrage. Dans un terminal, `npm run password` fait la même chose.

```sh
systemctl --user restart cornelius        # Linux, avec les services systemd
scripts/restart.sh                        # Linux, sans systemd
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\restart.ps1
```

Un redémarrage ferme la session d’administration : reconnectez-vous avec le nouveau mot de passe. Sans activité, la session se ferme aussi au bout d’une heure.

## 2. Lire la mise en route

Tant qu’il reste quelque chose à faire, l’administration s’ouvre sur la rubrique « Mise en route ». Chaque étape porte un état :

- « Fait » ;
- « À faire », avec un bouton qui mène au bon endroit ;
- « Bloqué » : l’étape attend d’abord une étape précédente ;
- « Facultatif » : l’étape ne sert pas avec vos réglages actuels.

La liste se met à jour d’elle-même. Voici les étapes, dans l’ordre :

| Étape | Où agir |
|---|---|
| Clé OpenAI | **Mise en route → Clés et jetons**, ou le fichier `.env` |
| Service caméra (perception) | Les scripts de démarrage (bouton **Ouvrir le diagnostic**) |
| Caméra choisie | Rubrique « Caméra et reconnaissance » (bouton **Choisir la caméra**) |
| Miroir ouvert | Bouton **Activer et ouvrir le miroir** |
| Voix activée sur le miroir | Bouton **Activer et ouvrir le miroir**, ou **Activer la voix** sur le miroir |
| Visage enregistré | Rubrique « Le foyer et les visages » (bouton **Enregistrer un visage**) |
| Mot d’appel « Cornelius » | Seulement si la conversation s’ouvre au mot « Cornelius » (bouton **Guide du mot d’appel**) |
| Mot de passe administrateur | **Mise en route → Mot de passe administrateur**, ou le fichier `.env` (étape 1 ci-dessus) |
| Accès aux services IA | Bouton **Autoriser les services IA**, si l’accès a été bloqué |

En haut de chaque page, le panneau de la conversation résume l’état de Cornelius sur une ligne (par exemple « Configuration à terminer » ou « En veille attentive ») et propose **Démarrer la session** ou **Arrêter la session**. Le lien « Voir la mise en route » ramène à cette liste.

Quand tout est prêt, la carte affiche « Tout est prêt » et l’administration s’ouvre désormais sur « Quand il écoute ».

## 3. Clé OpenAI

Sans clé, Cornelius ne peut pas parler. Créez une clé dans votre compte OpenAI (page [API keys](https://platform.openai.com/api-keys)), sur un compte payant. Collez-la dans la carte **Clés et jetons**, plus bas dans la même rubrique, puis **Enregistrer** : elle compte tout de suite, sans redémarrage. (Elle peut aussi s’écrire dans `.env` après `OPENAI_API_KEY=`, avec un redémarrage.)

La clé reste sur cet ordinateur : l’administration n’en montre ensuite que les quatre derniers caractères. Chaque conversation est facturée par OpenAI, aux jetons. Cornelius compte la durée des conversations (carte **Temps de conversation**) mais n’estime pas la facture OpenAI : fixez une limite dans votre compte OpenAI. Le bouton **Bloquer les services IA**, dans le panneau de la conversation de « Quand il écoute », coupe et interdit toute connexion à OpenAI jusqu’à **Autoriser les services IA**.

## 4. Service caméra (perception)

La perception est le programme local qui lit la caméra, détecte la voix et entend le mot « Cornelius ». Les scripts de démarrage et les services systemd la lancent avec le serveur. L’étape indique « Lancé et connecté. » quand tout va bien.

Si elle indique « Arrêté », relancez Cornelius (voir l’étape 1). Avec les services systemd, relancez seulement la perception :

```sh
systemctl --user restart cornelius-perception
```

La raison d’un échec est dans `data/run/logs/perception.err.log` (scripts) ou dans `journalctl --user -u cornelius-perception` (systemd). Le bouton **Ouvrir le diagnostic** mène à « État du système », qui affiche aussi la dernière erreur.

## 5. Choisir la caméra

Dans **Caméra et reconnaissance → Caméra du miroir**, choisissez la caméra dans la liste « Caméra », puis cliquez sur **Utiliser cette caméra**. Si elle n’apparaît pas, branchez-la puis cliquez sur **Actualiser la liste**. Tant qu’aucune caméra n’est détectée, la liste affiche « Aucune caméra détectée » et l’étape « Caméra configurée introuvable. Choisissez un périphérique. » : le message disparaît dès qu’une caméra est choisie. **Afficher l’aperçu** montre l’image en direct pour vérifier le cadrage : aucune image n’est enregistrée. Le choix est conservé après un redémarrage.

Cette étape est « Facultatif » quand la conversation s’ouvre au mot « Cornelius » pour tout le monde, sans reconnaissance ni vision : la caméra ne sert alors pas.

## 6. Ouvrir le miroir et activer la voix

Cliquez sur **Activer et ouvrir le miroir**, à l’étape « Miroir ouvert ». Ce bouton réactive le démarrage automatique et ouvre la page du miroir dans sa propre fenêtre, l’administration restant ouverte. Acceptez l’accès au micro quand le navigateur le demande (touchez « Activer la voix » sur le miroir s’il l’affiche), puis passez la fenêtre du miroir en plein écran avec F11. Si l’accès aux services IA est bloqué, le bouton s’appelle **Autoriser les services IA et ouvrir le miroir** et lève aussi le blocage.

Tant que la clé OpenAI manque, le miroir affiche seulement l’orbe et « Cornelius n’est pas encore configuré : ouvrez l’administration sur cet ordinateur. », suivi de l’adresse de l’administration. C’est normal : l’étape « Miroir ouvert » est quand même validée.

Pour revenir à l’administration, ouvrez un nouvel onglet à l’adresse `http://127.0.0.1:3000/admin` : le miroir reste ouvert dans le sien. Un seul miroir est actif à la fois : si la page du miroir s’ouvre dans un autre onglet, l’ancien affiche « Ce miroir est affiché dans un autre onglet. » et un bouton **Afficher ici**.

Le miroir affiche **Activer la voix** quand le micro ou le son ne sont pas autorisés. Touchez-le : c’est à refaire après un redémarrage du navigateur, sauf si celui-ci se souvient de l’autorisation du micro et laisse la page jouer du son sans geste.

Pour choisir un autre micro ou d’autres haut-parleurs, ouvrez **Micro et haut-parleurs → Audio de ce navigateur** dans le navigateur du miroir : ce réglage vaut pour le miroir ouvert dans ce navigateur. Vous y trouverez **Autoriser et vérifier le microphone** et **Tester le haut-parleur**.

## 7. Les personnes et leur visage

Dans **Le foyer et les visages → Une nouvelle personne**, saisissez le « Prénom ou nom d’affichage ». Une case permet à Cornelius de retenir des souvenirs pour cette personne : ils sont extraits par OpenAI après la conversation, et se gèrent dans la rubrique « Mémoire ». Cliquez ensuite sur **Ajouter au foyer**.

Pour que Cornelius reconnaisse la personne, mémorisez son visage : bouton **Mémoriser le visage de … maintenant**, ou plus tard **Mémoriser ce visage** dans la carte « Reconnaissance des visages ». La personne se place seule devant le miroir et suit les cinq positions : « De face », « Un côté », « L’autre côté », « Vers le haut », « Vers le bas ». Aucune photo n’est conservée : seulement des signatures numériques, sur cet ordinateur.

Ensuite :

- **Compléter** ajoute des vues prises dans un autre éclairage ou avec des lunettes ;
- **Refaire** remplace toutes les vues ;
- **Oublier** efface le visage.

Pour vérifier la reconnaissance, utilisez **Tester en direct** dans **Caméra et reconnaissance → Exigence de la reconnaissance**.

Un visage est facultatif si tout le monde peut ouvrir la conversation : il permet alors l’accueil par le prénom. Il est indispensable si seuls les membres du foyer peuvent l’ouvrir. Avec « Cornelius » pour tout le monde, la caméra reste éteinte et aucun visage ne peut être mémorisé : choisissez le temps de l’enregistrement une ouverture par la présence ou le regard (étape suivante).

## 8. Choisir l’ouverture de la conversation

Dans **Quand il écoute → Ouverture de la conversation**, deux questions indépendantes :

- « Ce qui l’ouvre » : « La présence » (dès qu’une personne s’arrête devant le miroir), « Le regard » (quand une personne regarde franchement le miroir) ou « Cornelius » (seulement quand on dit ce mot) ;
- « Qui peut l’ouvrir » : « Tout le monde » ou « Les membres du foyer ».

Au départ, c’est « Le regard » pour « Tout le monde ». Le choix est enregistré aussitôt. Une phrase résume l’effet obtenu et l’état de la caméra en veille ; un avertissement apparaît si le choix ne peut pas encore fonctionner (service caméra arrêté, aucun visage mémorisé, mot d’appel absent).

Avec « Cornelius » pour tout le monde, une case supplémentaire, **Reconnaître la personne pendant la conversation**, allume la caméra le temps de la conversation. Le mot « Cornelius » demande un modèle à installer : voir [Mot d’appel](../fonctionnalites/mot-d-appel.md). Le détail de chaque combinaison est dans [Ouverture et présence](../fonctionnalites/ouverture-et-presence.md).

## 9. Premier essai vocal

Avec les réglages de départ, placez-vous devant le miroir et regardez-le. Le miroir affiche « Ouverture de la conversation… », puis « Je vous écoute… » sous l’orbe. Si Cornelius vous reconnaît, il vous dit « Bonjour » avec votre prénom (réglage **Quand il écoute → Accueil à l’ouverture**).

Posez une question, par exemple « Quelle est la hauteur de la tour Eiffel ? ». Cornelius répond à voix haute et peut afficher une carte. Parlez pendant qu’il répond pour l’interrompre.

La conversation se termine quelques secondes après votre départ, ou quand vous ne regardez plus le miroir. **Arrêter la session**, dans le panneau de la conversation, la ferme aussi et suspend les ouvertures automatiques jusqu’à **Démarrer la session**.

Si rien ne se passe, la ligne d’état du panneau de la conversation, et celle du miroir, disent ce qui manque.

## 10. Heure, météo et transports

Dans **Modules → Informations**, le groupe « Au quotidien » réunit **Heure**, **Météo** et **Transports**. Cliquez sur la ligne d’un module pour la déplier, puis sur **Ajouter une source**. Remplissez le formulaire, puis cliquez sur **Ajouter**. Le bouton **Tester** vérifie ensuite que la source répond.

Champs communs :

- « Nom affiché » : son aide indique la phrase à dire pour obtenir l’information à la voix ;
- **Afficher en permanence sur le miroir** : l’information reste affichée, sans demande vocale, dès que son propriétaire est reconnu (ou pendant la présence pour une source du foyer) ;
- dans les options : « Identifiant », « Propriétaire » (le foyer ou une personne) et « État ».

Champs propres à chaque module :

- **Heure** : « Fuseau horaire », choisi dans une liste (par exemple Paris), « Afficher la date », « Afficher les secondes ». Aucun réseau ni jeton nécessaire.
- **Météo** : un jeton gratuit de [Météo Concept](https://api.meteo-concept.com/) est nécessaire. Collez-le dans la carte du module (ou dans **Clés et jetons**). Indiquez ensuite le « Code INSEE » de la commune (Paris : 75056), ou sa « Latitude » et sa « Longitude », et les « Jours de prévision » (de 1 à 7).
- **Transports** : réservé à l’Île-de-France. Un jeton PRIM gratuit d’[Île-de-France Mobilités](https://prim.iledefrance-mobilites.fr/) est nécessaire : collez-le dans la carte du module (ou dans **Clés et jetons**). L’« Arrêt » et la « Direction » se choisissent par recherche.

Tant qu’un jeton manque, la carte du module l’explique et **Ajouter une source** reste grisé. `npm run setup` n’ajoute pas ces lignes : copiez-les depuis `.env.example`. Les fiches [Heure](../../addons/clock/README.md), [Météo](../../addons/weather/README.md) et [Transports](../../addons/transit/README.md) détaillent chaque module.

## En cas de problème

- La rubrique « État du système » montre l’état de chaque service ; la rubrique « Journal » retrace tout ce que fait Cornelius, avec un export à joindre à une demande d’aide.
- Les symptômes courants et leurs solutions sont dans [Dépannage](../utilisation/depannage.md).

## Voir aussi

- [Utiliser le miroir](../utilisation/miroir.md)
- [Administration](../utilisation/administration.md)
- [Ouverture et présence](../fonctionnalites/ouverture-et-presence.md)
- [Modules](../modules/README.md)
- [Confidentialité](../reference/confidentialite.md)
- [Dépannage](../utilisation/depannage.md)

## Caméra d’un autre appareil

Le serveur peut analyser [la caméra du navigateur qui affiche le miroir](../fonctionnalites/camera-navigateur.md), par exemple celle d’un Mac. La perception reste à lancer sur le serveur.
