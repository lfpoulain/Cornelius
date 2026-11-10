# Dépannage

Cette page aide à comprendre pourquoi Cornelius ne répond pas, ne démarre pas ou répond lentement, et à demander de l’aide. Elle s’adresse à la personne qui a installé le miroir.

## Par où commencer

1. **Regardez la ligne d’état du miroir.** Sous le nom « cornelius / », une phrase dit ce qui empêche Cornelius de répondre. Leur liste est dans [Le miroir](miroir.md#la-ligne-détat).
2. **Ouvrez l’administration** (`http://127.0.0.1:3000/admin`) **et suivez la rubrique « Mise en route ».** Chaque étape « À faire » dit quoi faire et porte un bouton pour agir. La liste se met à jour seule.
3. **Lisez le panneau de conversation**, en haut de chaque rubrique : il donne le premier motif qui bloque le démarrage.
4. **Consultez « État du système », puis « Journal »** si la cause n’est toujours pas claire.

## Problèmes courants

| Ce que vous voyez | Cause probable | Que faire |
|---|---|---|
| « Cornelius n’est pas encore configuré : ouvrez l’administration sur cet ordinateur. » sur le miroir ; « Clé OpenAI absente » dans l’administration | La clé OpenAI manque. | Collez-la dans **Clés et accès → Clés et jetons** : elle compte tout de suite. |
| « Service caméra arrêté : relancez Cornelius sur cet ordinateur. » ou « Écoute du mot « Cornelius » arrêtée » | Le service caméra (perception) ne tourne pas. Il lit la caméra et entend aussi le mot « Cornelius ». | Relancez Cornelius avec `scripts/start.sh` (`scripts\start.ps1` sous Windows), qui démarre aussi ce service. S’il s’arrête encore, lisez `data/run/logs/perception.err.log`. Si le script dit « Python de perception introuvable », l’environnement Python n’est pas installé : voir [Installation sous Linux](../installation/linux.md) ou [Installation sous Windows](../installation/windows.md). |
| Un réveil ou un minuteur s’affiche mais ne sonne pas | La voix n’est pas activée sur le miroir : le navigateur bloque le son tant qu’on n’a pas touché la page. | Touchez **Activer la voix** sur le miroir, et autorisez durablement le son pour ce site (voir la ligne sur « Activer la voix »). Vérifiez aussi la sortie audio dans **Micro et haut-parleurs**, et **Modules → Alarmes et rappels → Écouter**. |
| « Caméra du miroir indisponible : vérifiez-la dans l’administration. » | Aucune caméra choisie, caméra débranchée ou utilisée par un autre logiciel. | Administration → Caméra et reconnaissance → Caméra du miroir : « Actualiser la liste », choisissez la caméra, puis « Utiliser cette caméra ». Fermez une visioconférence qui l’occuperait. |
| « Microphone refusé. Autorisez-le pour ce site dans le navigateur, puis réessayez. » | Le navigateur a bloqué le micro pour cette adresse. | Dans les réglages du site (icône à gauche de l’adresse), autorisez le micro, puis touchez « Activer la voix ». |
| « Micro occupé par une autre application. » ou « Aucun micro détecté. » | Un autre logiciel tient le micro, ou aucun micro n’est branché. | Fermez l’autre logiciel ou branchez un micro, puis réessayez. Le choix du micro se fait dans Administration → Micro et haut-parleurs. |
| « Le micro choisi dans l’administration est introuvable. » | Le micro enregistré a été débranché. | Rebranchez-le, ou choisissez-en un autre dans Micro et haut-parleurs → Audio de ce navigateur → Microphone. |
| Cornelius vous comprend mal, s’entend lui-même ou se laisse mal couper | Sa voix revient dans le micro par le haut-parleur, ou le micro est trop faible ou trop traité. | Dans Micro et haut-parleurs → Audio de ce navigateur : essayez sans « Gain automatique du micro », puis sans « Réduction du bruit du navigateur », et vérifiez avec « Tester le micro ». Dans le système, mettez le micro vers 70 % et coupez ses « améliorations audio ». Prenez comme haut-parleurs la sortie par défaut du système, baissez-les et éloignez-les du micro. Un micro de conférence avec annulation d’écho intégrée règle souvent le problème. |
| « Micro inaccessible depuis cette adresse » | Le miroir est ouvert par une adresse que le navigateur juge non sûre (`http://` avec une adresse IP). | Sur l’ordinateur de Cornelius, ouvrez `http://127.0.0.1:3000/` ; depuis un autre appareil, l’adresse en `https://…:3443/` (voir [Accès depuis le réseau local](reseau-local.md)). |
| Le bouton « Activer la voix » revient à chaque rechargement, à chaque ouverture de la fenêtre du miroir ou redémarrage du navigateur | Le navigateur ne garde pas l’autorisation du micro, ou bloque le son tant qu’on n’a pas touché la page (Brave et Firefox le font par défaut). | Autorisez durablement le micro et la lecture automatique pour ce site. Brave : cadenas à gauche de l’adresse, « Paramètres du site », puis « Microphone » et « Lecture automatique » sur « Autoriser » (ou `brave://settings/content/autoplay`, ajouter l’adresse du miroir dans « Autorisé »). Chrome et Edge : « Son » et « Microphone » sur « Autoriser » dans les paramètres du site. Firefox : « Lecture automatique : Autoriser l’audio et la vidéo ». Le miroir réactive alors la voix seul après un rechargement. Gardez toujours la même adresse : `127.0.0.1` et `localhost` sont deux sites différents. |
| « Le son a été coupé par le navigateur. Activez à nouveau la voix. » | Le navigateur a suspendu le son de la page. | Touchez « Activer la voix ». |
| Badge « Jeton manquant » sur Météo ou Transports | Le jeton du service manque. | Collez-le dans la carte du module ou dans **Clés et accès → Clés et jetons** (ou ajoutez `CORNELIUS_METEO_CONCEPT_TOKEN`, `CORNELIUS_PRIM_API_KEY` dans `.env` et redémarrez). Les deux jetons sont gratuits. Voir [Configuration](../reference/configuration.md). |
| « Node.js v… détecté : Cornelius demande Node.js 24.2 ou plus récent » | Le Node.js installé est trop ancien. | Installez Node.js 24 (la version exacte est dans le fichier `.nvmrc`), puis relancez. |
| « listen EADDRINUSE: address already in use 127.0.0.1:3000 », ou « Serveur déjà actif sur le port 3000 » (« Backend déjà actif » sous Windows) suivi de « Serveur non confirmé » (« Backend non confirmé ») | Un autre programme utilise déjà le port du serveur. | Attention : `start` et `restart` arrêtent d’abord tout ce qui écoute sur le port du serveur et sur le port de l’interface de développement (5173, ou `CORNELIUS_DEV_PORT`), y compris un autre logiciel. `dev`, lui, croit le serveur déjà lancé. Si cet autre logiciel doit garder son port, choisissez un autre `PORT` dans `.env` (de 1024 à 65535). |
| « Ce miroir est affiché dans un autre onglet. » | Le miroir a été ouvert dans un autre onglet ou un autre navigateur, qui a pris la main. | Fermez l’autre onglet, ou touchez « Afficher ici » pour reprendre le miroir dans celui-ci. |
| « Accès aux services IA bloqué depuis l’administration. » | « Bloquer les services IA » a été utilisé. Le blocage reste après un redémarrage. | Administration → Quand il écoute → panneau de conversation → « Autoriser les services IA », ou l’étape « Accès aux services IA » de la Mise en route. |
| « Conversation arrêtée depuis l’administration. » | « Arrêter la session » a été utilisé. | « Démarrer la session » dans le panneau de conversation. Si le mot « Cornelius » ouvre la conversation, le dire suffit. |
| « Mot d’appel indisponible : son modèle n’est pas prêt sur cet ordinateur. » | Le fichier `models/cornelius.onnx` manque. | Voir [Le mot d’appel](../fonctionnalites/mot-d-appel.md). |
| « Connexion au serveur perdue, nouvelle tentative… » | Le serveur s’est arrêté ou redémarre. | Attendez quelques secondes : le miroir se reconnecte seul. Sinon, relancez Cornelius et lisez son journal de démarrage (ci-dessous). |
| Le script de démarrage dit « Le serveur s’est arrêté au démarrage » ou « Serveur non confirmé » (sous Windows : « Le backend s'est arrêté au démarrage » ou « Backend non confirmé ») | Une erreur empêche le serveur de démarrer. | Lisez la fin de `data/run/logs/backend.err.log` (voir ci-dessous). |
| « Hôte non autorisé. » | La page est ouverte sous un nom que Cornelius ne connaît pas. | Utilisez l’adresse IP de l’ordinateur, son nom suivi de `.local`, ou ajoutez le nom à `CORNELIUS_ALLOWED_HOSTS`. |
| « Accès réservé au réseau local. » | La demande vient d’Internet, ou `CORNELIUS_LAN=0` et elle vient d’un autre appareil. | Ouvrez Cornelius depuis la maison. Ne redirigez pas le port 3443 sur votre box. |
| Un autre appareil n’arrive pas à ouvrir `https://…:3443/` | Pare-feu, réseau Windows classé « Public », ou adresse de l’ordinateur changée. | Voir [Le pare-feu](reseau-local.md#le-pare-feu). Vérifiez l’adresse dans la carte **Accès depuis le réseau local**. |
| « Mot de passe par défaut : changez-le d’abord dans l’administration… » | La connexion vient d’un autre appareil alors que le mot de passe vaut encore `cornelius`. | Sur l’ordinateur de Cornelius, changez-le dans **Clés et accès**, carte « Mot de passe administrateur ». Sans écran (installation par SSH), lancez `npm run password` dans le dossier de Cornelius. |

## Le serveur ne démarre pas

Les scripts `start`, `restart` et `dev` lancent le serveur et le service caméra en arrière-plan. Chaque service écrit dans `data/run/logs/` : `backend.err.log` et `backend.out.log` pour le serveur, `perception.err.log` et `perception.out.log` pour le service caméra, `frontend.*.log` pour l’interface en développement. Quand le serveur s’arrête au démarrage, le script affiche déjà la fin de son journal.

Pour relire la fin du journal du serveur :

```sh
tail -n 50 data/run/logs/backend.err.log
```

```powershell
Get-Content data\run\logs\backend.err.log -Tail 50
```

Messages les plus fréquents :

- « Définissez CORNELIUS_ADMIN_PASSWORD (4 caractères minimum) dans .env, ou lancez npm run setup. » : le mot de passe manque ou fait moins de 4 caractères ;
- « PORT invalide. » : `PORT` doit être un nombre entier de 1024 à 65535 ;
- « listen EADDRINUSE » : le port est occupé (voir le tableau) ;
- « L’installation des dépendances a échoué (npm ci) » : fermez ce qui utilise le dossier du projet, supprimez `node_modules`, puis relancez le script de démarrage, qui réinstalle les dépendances tout seul ;
- « Fichier .env absent : lancez « npm run setup » à la racine du projet. » : l’installation n’est pas terminée.

### Redémarrer Cornelius

Après une modification du fichier `.env`, redémarrez Cornelius :

```sh
scripts/restart.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\restart.ps1
```

Pour tout arrêter : `scripts/stop.sh`, ou `scripts\stop.ps1` sous Windows.

## Lire et exporter le journal

Le journal raconte, dans l’ordre, tout ce que fait Cornelius : connexion à OpenAI, ouverture et fermeture des conversations, micro, caméra, modules, commandes, erreurs.

Dans l’administration, rubrique **Journal**, carte « Journal détaillé » :

- les 1 000 derniers événements depuis le démarrage du serveur, mis à jour toutes les 2 secondes ;
- un filtre par origine (« Toutes les origines », « Conversation », « OpenAI », « Navigateur », « Périphériques », « Modules », « Commandes », « Mémoire »…). Les requêtes réussies au serveur sont masquées par défaut : choisissez l’origine « Requêtes au serveur » pour les voir ;
- la case « Problèmes seulement », pour ne garder que les avertissements et les erreurs ;
- une recherche (« OpenAI, microphone, interaction… ») ;
- « Pause » pour figer la liste pendant la lecture, puis « Reprendre » ;
- **Exporter le journal filtré**, qui télécharge les événements affichés dans un fichier `cornelius-journal.jsonl`. L’export marche même quand le serveur ne répond plus.

Une copie est aussi écrite sur le disque, dans `data/logs/cornelius.log`. Au-delà de 5 Mo, le fichier est archivé en `cornelius.log.1`, `.2` puis `.3` : les démarrages précédents restent consultables.

Les clés, le mot de passe et les jetons sont masqués dans le journal. Le son, les images, les signatures des visages et le texte des conversations n’y sont pas écrits.

La rubrique **État du système** complète le journal : état des services, dernier signal, santé de chaque source et dernières exécutions de commandes.

## Mesurer la latence

Quand Cornelius semble lent à répondre, la commande suivante lit les mesures écrites dans le journal (`data/logs/cornelius.log` et ses archives) et les résume en tableau : délai de réponse, interruption, ouverture de la conversation, images par seconde de l’orbe, vision locale, fermetures.

```sh
npm run mesures
```

```powershell
npm run mesures
```

Les mesures viennent de conversations réelles : tenez-en quelques-unes devant le miroir avant de lancer la commande. Pour lire un autre fichier, donnez son chemin : `npm run mesures -- chemin/vers/cornelius.log`. Le protocole de recette complet est décrit dans [Tests et recette](../developpement/tests-et-recette.md).

## Demander de l’aide

Décrivez ce que vous faisiez, ce que vous attendiez et ce qui s’est passé. Joignez :

- le système (Linux et sa distribution, ou Windows), le navigateur du miroir, et la version de Node.js (`node --version`) ;
- l’état des étapes de la Mise en route (une capture de la rubrique suffit) ;
- l’export du journal, de préférence filtré avec « Problèmes seulement » autour du moment du problème ;
- en cas d’échec au démarrage, la fin de `data/run/logs/backend.err.log` ou de `data/run/logs/perception.err.log` ;
- pour une lenteur, le tableau de `npm run mesures`.

Avant d’envoyer quoi que ce soit, relisez-le. Le journal masque les clés et les mots de passe, mais il peut contenir des prénoms, des noms de sources, des adresses de votre réseau (Home Assistant, commandes) ou des traces techniques de votre ordinateur. Remplacez-les par des valeurs neutres. N’envoyez jamais le fichier `.env`, le dossier `data/` ni une capture de la caméra.

Pour signaler un problème ou proposer une correction, voir [Contribuer](../../CONTRIBUTING.md).

## Voir aussi

- [Le miroir](miroir.md)
- [L’administration](administration.md)
- [Premier démarrage](../installation/premier-demarrage.md)
- [Configuration](../reference/configuration.md)
- [Confidentialité](../reference/confidentialite.md)
