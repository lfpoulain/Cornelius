# Home Assistant

Cornelius peut allumer et éteindre les lumières et les prises de la maison, et lire les capteurs, à travers Home Assistant. Cette page explique comment le connecter, choisir les appareils autorisés, qui peut s’en servir, et ce que deviennent le jeton et les données. Elle s’adresse à la personne qui règle le miroir pour la maison.

## Ce que fait le connecteur

Home Assistant est un logiciel de domotique installé à part. Cornelius s’y connecte directement : aucun module complémentaire, blueprint ni intégration n’est à installer dans Home Assistant. Cornelius peut aussi tourner lui-même sur la box, comme add-on (voir [Installer dans Home Assistant](../installation/home-assistant.md)) : la connexion décrite ici reste la même.

- **Lumières et prises** (`light.*` et `switch.*`) : allumer, éteindre, lire l’état, et régler la luminosité des lumières qui le permettent (de 1 à 100 %).
- **Capteurs**, en lecture seule : capteurs et détecteurs, minuteries, dates et heures, nombres, interrupteurs virtuels, listes de choix, compteurs, thermostats, volets et serrures. Un capteur n’est jamais commandé : Cornelius peut dire si une serrure est fermée, pas l’ouvrir.

Dans Home Assistant, un « switch » peut piloter autre chose qu’une prise. Ne cochez que les appareils que Cornelius doit vraiment commander.

La configuration est commune au foyer. La carte **Home Assistant** se trouve dans la rubrique **Modules**, groupe « Maison ». Elle s’affiche quand **Sources de** vaut « Tout le monde » ou « Le foyer ».

## Se connecter

1. Dans Home Assistant, ouvrez votre profil, onglet **Sécurité**, rubrique **Jetons d’accès longue durée**, et créez un jeton pour Cornelius. De préférence, faites-le depuis un compte réservé à Cornelius, sans droits d’administrateur (voir [Réduire le risque](#réduire-le-risque)).
2. Dans **Modules → Home Assistant**, renseignez **Adresse Home Assistant**, par exemple `http://homeassistant.local:8123`. Donnez l’adresse de base, sans chemin ni paramètres.
3. Collez le jeton dans **Jeton longue durée**.
4. Cliquez sur **Connecter Home Assistant**.

Une fois connecté, le badge de la carte passe à « Connecté ». En cas d’échec, la raison s’affiche sous le formulaire, à côté du champ en cause.

Pour un contrôle local, choisissez l’adresse locale de Home Assistant plutôt qu’une adresse d’accès à distance.

## Choisir les appareils

Sous la connexion, la liste montre les lumières, prises et capteurs trouvés, avec leur état. Cochez ceux que Cornelius peut utiliser, puis cliquez sur **Enregistrer** dans la barre qui compte les modifications non enregistrées (**Annuler** revient à la sélection enregistrée).

Pour s’y retrouver :

- **Rechercher un appareil** cherche dans les noms, les identifiants et les autres noms ;
- les boutons **Tout**, **Lumières et prises** et **Capteurs** filtrent par type ;
- **Afficher uniquement la sélection** ne montre que les appareils cochés, même avant l’enregistrement ;
- **Actualiser les appareils** relit la liste dans Home Assistant ;
- **Retirer les appareils disparus de la sélection** apparaît quand un appareil coché n’existe plus.

La sélection est limitée à 100 appareils, capteurs compris.

**Reprendre la sélection Assist** coche les appareils que vous exposez déjà à Assist, l’assistant vocal de Home Assistant. Il faut un jeton d’un compte administrateur Home Assistant. Cette reprise prépare seulement les cases : vérifiez-les, puis enregistrez. Elle ne modifie rien dans Home Assistant, et elle ne suit pas les changements faits ensuite dans Assist : relancez-la si besoin. Au-delà de 100 appareils exposés, seuls les 100 premiers sont cochés et un message le signale.

Les autres noms (alias) définis dans Home Assistant sont lus automatiquement et suivis quand ils changent. Ils apparaissent sous chaque appareil (« Autres noms ») et aident Cornelius à comprendre « la lampe du salon ». Un alias ne donne jamais accès à un appareil non coché.

Les boutons **Allumer** et **Éteindre** de la liste servent à tester. Ils fonctionnent pour toutes les lumières et prises, même non cochées, et ne changent pas les autorisations de Cornelius.

## Autoriser Cornelius

Deux interrupteurs règlent l’accès :

- **Autoriser Cornelius à utiliser la sélection** : Cornelius allume ou éteint les lumières et prises cochées, et lit les capteurs cochés. Sans cette autorisation, il n’utilise pas Home Assistant.
- **Réserver aux personnes reconnues** (désactivé par défaut) : voir la section suivante.

Une modification des autorisations ou de la sélection s’applique aussi aux demandes en cours : elles sont annulées. Une commande déjà envoyée à Home Assistant ne peut pas être annulée.

## Réserver aux personnes reconnues

Désactivé, toute personne qui parle au miroir, même inconnue, peut commander la sélection et lire ses capteurs, une serrure par exemple.

Activé, Home Assistant n’est proposé que pendant une conversation avec une personne reconnue, ou avec une personne choisie dans l’administration. Une demande arrivée trop tard, après la perte de la reconnaissance, est refusée.

Ce choix dépend de la façon dont la conversation s’ouvre (voir [Ouverture et présence](ouverture-et-presence.md)) :

- avec la présence ou le regard, la personne est reconnue par la caméra ;
- avec « Cornelius » pour tout le monde, la caméra est éteinte en veille : il faut cocher **Reconnaître la personne pendant la conversation**. Sinon, personne n’est reconnu et Home Assistant reste indisponible.

Quand une personne est reconnue en cours de conversation, Home Assistant devient disponible sans rouvrir la conversation.

## Pendant la conversation

Une fois les appareils autorisés, on peut demander par exemple :

- « Allume la lampe du salon à 40 % » ;
- « Éteins la prise du bureau » ;
- « Quelle température dans la chambre ? » ;
- « Dans combien de temps se termine le lave-linge ? ».

Pour une commande, Cornelius relit l’état de l’appareil, vérifie qu’il est autorisé, envoie l’ordre puis guette le nouvel état pendant 3 secondes au plus (beaucoup d’appareils Zigbee, Z-Wave ou Wi-Fi le remontent avec un léger retard). Il ne dit que l’appareil a changé d’état que si Home Assistant le confirme. Sinon, il dit que la commande est acceptée mais pas encore confirmée. Cette confirmation est celle que donne Home Assistant, pas une vérification physique. Une commande interrompue n’est jamais renvoyée automatiquement.

Pour un capteur, Cornelius relit toujours l’état actuel, jamais une valeur gardée en mémoire. Pour une minuterie, la fin d’un programme (lave-linge, lave-vaisselle…) ou une date, le serveur calcule lui-même l’heure de fin et le temps restant. Un capteur « indisponible » ou « inconnu » est signalé comme tel.

Cornelius ne peut utiliser que les deux actions marche et arrêt, et la luminosité. Aucune autre commande, adresse ou donnée ne peut lui être dictée par la conversation.

## Connexion et coupures

Cornelius reste connecté à Home Assistant et suit les changements d’état en direct. La liste de l’administration indique « États suivis en direct », ou « Derniers états connus » quand la connexion est perdue.

En cas de coupure, Cornelius se reconnecte seul, en espaçant les essais de 1 à 30 secondes. Un jeton refusé arrête les essais : il faut le corriger.

## Le jeton et les données

- Le jeton est enregistré sur l’ordinateur du miroir, dans la base de Cornelius (`data/cornelius.sqlite` par défaut). Il n’y est **pas chiffré**. Les copies de la base faites avant une mise à jour peuvent aussi le contenir.
- Il n’est jamais renvoyé au navigateur, à la conversation ni au journal. Le champ **Jeton longue durée** affiche seulement « Jeton enregistré (masqué) ».
- Laissez le champ vide pour garder le jeton enregistré. Ce n’est possible qu’à la même adresse : une nouvelle adresse demande un nouveau jeton.
- Changer d’adresse ou de jeton vide la sélection et retire l’autorisation de Cornelius, jusqu’à un nouvel enregistrement.
- **Supprimer la connexion** efface le jeton, la sélection et l’autorisation. Le réglage **Réserver aux personnes reconnues** est conservé. Révoquez aussi le jeton dans Home Assistant pour l’invalider.
- Le jeton garde les droits du compte Home Assistant qui l’a créé. C’est Cornelius qui limite ce que la conversation peut faire, pas le jeton.
- Cornelius refuse les redirections vers une autre adresse. Les réglages de Home Assistant ne sont accessibles que depuis l’administration.
- La base et ses copies ne sont lisibles que par le compte système qui fait tourner Cornelius (fichiers en `0600`, dossier `data/` en `0700`). Une sauvegarde de `data/` contient le jeton : gardez-la à l’abri comme un mot de passe.

## Réduire le risque

Home Assistant ne permet pas de limiter un jeton à quelques appareils. Quiconque lit la base, ou une copie de `data/`, peut utiliser le jeton avec tous les droits du compte qui l’a créé, hors de Cornelius. Deux précautions réduisent ce risque.

**Un compte dédié, sans droits d’administrateur.**

1. Dans Home Assistant, **Paramètres → Personnes**, ajoutez une personne « Cornelius » et autorisez-la à se connecter. Laissez **Administrateur** désactivé et, si l’option est proposée, cochez **Connexion depuis le réseau local uniquement**.
2. Connectez-vous une fois avec ce compte, créez le jeton dans son profil, puis collez-le dans Cornelius.

Ce que ce compte limite : sans droits d’administrateur, le jeton ne donne pas accès à la configuration de Home Assistant (intégrations, utilisateurs, automatisations, modules complémentaires, sauvegardes). Ce qu’il ne limite pas : le jeton peut toujours lire tous les états et commander tous les appareils de la maison, y compris ceux que Cornelius n’a pas le droit d’utiliser, comme une serrure ou une alarme. Seule **Reprendre la sélection Assist** demande un compte administrateur : cochez alors les appareils à la main.

**Changer de jeton.** Un jeton longue durée reste valable dix ans. Pour le changer, après une fuite possible ou simplement de temps en temps :

1. Créez un nouveau jeton dans Home Assistant.
2. Collez-le dans **Jeton longue durée** et cliquez sur **Connecter Home Assistant**, puis recochez la sélection et l’autorisation.
3. Dans Home Assistant, supprimez l’ancien jeton : c’est ce qui l’invalide, y compris dans les copies et sauvegardes qui le contiennent encore.

## Limites

- Ne sont pas pris en charge : la couleur des lumières, les scènes, la commande des volets, des serrures et des thermostats, et des droits différents selon la personne.
- Une intégration Home Assistant qui dépend d’un service en ligne en dépend toujours.
- Les commandes réelles peuvent varier selon la version de Home Assistant et l’intégration de chaque appareil. Essayez-les avec les boutons **Allumer** et **Éteindre** avant de les confier à Cornelius.

## Voir aussi

- [Ouverture et présence](ouverture-et-presence.md)
- [L’administration](../utilisation/administration.md)
- [Les modules](../modules/README.md)
- [Confidentialité](../reference/confidentialite.md)
- [Dépannage](../utilisation/depannage.md)
