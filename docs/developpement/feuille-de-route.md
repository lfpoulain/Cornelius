# Feuille de route

Cette page fait le point sur ce qui reste à faire dans Cornelius : les fonctions écrites et testées automatiquement mais pas encore validées sur le miroir réel, puis les chantiers ouverts. Elle s’adresse aux personnes qui contribuent au code ou qui préparent une livraison. Ce qui a déjà été fait, et quand, est dans `CHANGELOG.md`.

## Fait, à valider sur le matériel

Ces fonctions sont en place et couvertes par les tests automatiques. Il manque une validation sur le miroir final (mini-PC, verre, caméra, micro et haut-parleurs prévus), avec la [recette guidée](tests-et-recette.md#recette-guidée) :

- **Critères de livraison.** Aucun n’a encore été mesuré en conditions réelles (registre ci-dessous).
- **Conversation et modules.** Météo, transports, heure et commandes HTTP à la voix, avec l’affichage de la carte du module et la même information à l’oral.
- **Ouverture et présence.** Les six réglages d’ouverture, le mode vie privée, la fin de parole, le maintien de l’identité et la réouverture après un départ. Les gains de l’ouverture plus rapide, les faux déclenchements et la charge du processeur restent à mesurer avec `npm run mesures`.
- **Mot d’appel.** Détection de « Cornelius » avec un modèle produit par le générateur, et reconnaissance de la personne au mot d’appel.
- **Mémoire.** Un souvenir retenu revient à la conversation suivante, avec la vraie reconnaissance des visages et sans changer de propriétaire.
- **Vision locale.** Qualité des descriptions sur de vraies scènes ; délais des modèles 1,6B et 3B, sur processeur et sur GPU. Une installation réussie ne prouve pas que l’analyse tient dans le délai de 10 s.
- **Génération d’images.** Demande, interruption et réaffichage à la voix ; mémoire GPU des différents modèles.
- **Home Assistant.** Commandes et lectures à la voix avec les noms réels des appareils, et les repères personnels qui y renvoient.
- **Agents Hermes.** Une tâche lancée à la voix, suivie après le départ du miroir, puis restituée à son propriétaire.
- **Informations permanentes.** Affichage dès la reconnaissance, masquage en mode vie privée, sur le miroir réel.
- **GPU.** NVIDIA, Radeon avec ROCm et Ryzen AI à mémoire partagée, pour la vision comme pour les images.
- **Installation.** `scripts/install-linux.sh` sur une machine neuve de chaque distribution ; les commandes Windows de la documentation sur un poste neuf ; l’accès depuis le réseau local (certificat, pare-feu Windows et `ufw`, tablette en miroir).

### Registre de recette

| Domaine | Seuil | Résultat |
|---|---|---|
| Compréhension | au moins 49 sur 50 | à mesurer |
| Réactivité | première information en moins de 2 s dans au moins 95 % des cas | à mesurer |
| Interruption | moins de 500 ms sur au moins 19 sur 20 | à mesurer |
| Présence | au moins 19 engagements sur 20 ; au plus 1 ouverture injustifiée sur 50 | à mesurer |
| Affichage | 30 images par seconde sous charge | à mesurer |

Les critères complets et les scénarios à jouer sont dans [Tests et recette](tests-et-recette.md#critères-de-livraison). Reportez ici chaque résultat mesuré, avec le matériel utilisé.

## À faire

### Connexion officielle Google Photos Ambient

Remplacer à terme la lecture expérimentale des albums partagés de l’écran de veille par
une intégration Google Photos Ambient API, avec choix des albums dans Google et autorisation
du compte. Le connecteur actuel impose un lien consultable par toute personne qui le possède.

Prérequis : admission au [programme partenaire Google Photos](https://developers.google.com/photos/partner-program/overview),
puis vérification OAuth et revue de l’intégration avant lancement. Cet accès n’est pas acquis ;
la fonctionnalité reste conditionnée à la validation de Google. Il faudra ensuite développer
l’association de l’écran, le choix des albums, la gestion des autorisations et leur révocation.

### Interpellation

Cornelius ne parle aujourd’hui que lorsqu’on s’adresse à lui (en dehors de l’accueil par le prénom). L’interpellation lui permettrait d’annoncer de lui-même une information utile et fraîche (un bus qui arrive, une minuterie terminée), une fois qu’une personne le regarde et que la conversation est prête :

- une annonce au plus par engagement, jamais en boucle ;
- renoncer si la personne a déjà commencé à parler, et rester interruptible ;
- plages horaires, délai minimal entre deux annonces et désactivation dans l’administration ;
- seulement des informations du foyer ou du profil reconnu.

Le canal existe déjà : le serveur sait demander une parole au modèle (c’est ainsi que part l’accueil). Il reste à choisir l’information, à fixer les règles et à les tester.

### Sauvegarde et restauration

Aujourd’hui, seules les deux copies faites avant une migration de la base existent (`server/backups.ts`). Il manque :

- des sauvegardes régulières et chiffrées, avec une durée de conservation ;
- une restauration documentée et testée, sans réactiver les données d’un profil supprimé ni rejouer de commande ;
- une durée de conservation des journaux : ils tournent aujourd’hui par taille (5 Mo, trois archives), pas par ancienneté.

### Mise à jour des outils pendant une conversation

Modifier la personnalité, les repères, la mémoire, un profil, la recherche web, la vision, la génération d’images, Home Assistant ou un agent rouvre la conversation en cours avec les nouveaux outils. Ajouter, modifier ou supprimer une **source de module** ou une **commande HTTP** ne le fait pas encore : la conversation en cours garde l’ancienne liste jusqu’à la suivante. Les droits restent vérifiés à chaque appel, donc rien d’interdit ne s’exécute ; seule une nouvelle source n’est pas proposée tout de suite.

### Types partagés de l’administration

Les vues de l’administration recopient encore plusieurs types du serveur (`web/components/admin/types.ts`). Les partager dans `shared/`, ou les dériver des schémas, éviterait qu’un champ ajouté côté serveur soit oublié côté interface.

### Installateur Windows

Sous Windows, l’installation se fait à la main ([installation Windows](../installation/windows.md)). Un installateur équivalent à `scripts/install-linux.sh` (Node, Python 3.12, environnement de la perception, modèles, démarrage avec la session) reste à écrire.

### Petites corrections

- Le serveur de développement Vite ne relaie pas `/wake-audio` : le mot d’appel ne fonctionne pas sur le port 5173 (`vite.config.ts`).

### Idées pour plus tard

Agenda, état du trafic routier, outils MCP, diagnostic guidé dans l’administration. Aucune ne conditionne une livraison.

**Messages en direct pendant une session** (idée gardée de côté). Pousser une information à Cornelius depuis Home Assistant ou une adresse HTTP, selon trois modes : contexte (il la reçoit sans la dire), annonce (il la dit à la prochaine pause, ou tout de suite si urgent) et carte (affichée sans parole). Sources envisagées : un événement Home Assistant `cornelius_message` écouté sur la connexion déjà ouverte, et `POST /api/messages` avec un jeton dédié, réservé au réseau local. Garde-fous : texte traité comme une donnée, jamais comme une consigne ; présence devant le miroir, mode vie privée et heures calmes respectés ; message personnel seulement pour la personne reconnue ; limite de fréquence, dédoublonnage et historique dans l’administration. Sans conversation ouverte : le contexte attend la suivante (historique de départ de l’API Live) et la carte s’affiche aussitôt. Reste à choisir pour une annonce : ouvrir une courte conversation (voix de Cornelius, facturée), un carillon et une carte, ou une voix de synthèse locale. À vérifier d’abord : l’ajout d’un message et la demande de réponse en cours de conversation avec l’API Live.

## Voir aussi

- [Tests et recette](tests-et-recette.md)
- [Architecture](architecture.md)
- [Développer Cornelius](README.md)
- [Contribuer](../../CONTRIBUTING.md)
