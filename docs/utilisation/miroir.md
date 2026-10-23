# Le miroir

Cette page décrit l’écran du miroir : ce qu’on y voit, comment activer la voix et comment parler à Cornelius. Elle s’adresse à toute la famille, et à la personne qui installe le miroir.

## Ouvrir le miroir

Le miroir est une page web servie par Cornelius. Ouvrez-la dans un navigateur, sur l’ordinateur qui fait tourner Cornelius :

- adresse : `http://127.0.0.1:3000/` (le port est celui de `PORT` dans le fichier `.env`, 3000 par défaut) ;
- aucun mot de passe n’est demandé ;
- pour un affichage sans bordure, passez le navigateur en plein écran (touche F11).

Depuis une tablette ou un autre ordinateur de la maison, le miroir s’ouvre à `https://<adresse de l’ordinateur>:3443/`, une fois l’appareil autorisé avec le mot de passe administrateur : voir [Accès depuis le réseau local](reseau-local.md).

Choisissez une adresse et gardez-la. `http://127.0.0.1:3000/` et `http://localhost:3000/` sont deux sites différents pour le navigateur : l’autorisation du micro et le choix du micro et des haut-parleurs ne passent pas de l’un à l’autre.

## Ce qu’on voit

L’écran est noir, pour laisser passer le reflet, sauf si l’[écran de veille](#lécran-de-veille) affiche des peintures quand personne n’est là. De haut en bas :

- en haut, le nom « cornelius / », une ligne d’état quand quelque chose bloque, et les informations permanentes ;
- au centre, l’orbe, et sous lui ce que fait Cornelius pendant une conversation ;
- en bas, les cartes « Réponse », puis les personnes détectées et le bouton « Activer la voix » quand il faut l’utiliser.

La disposition exacte dépend de l’orientation de l’écran (voir [Portrait et paysage](#portrait-et-paysage)).

### L’orbe

L’orbe montre l’état de Cornelius d’un coup d’œil. Sa taille se règle dans l’administration, rubrique « Personnaliser Cornelius » (« Taille de l’orbe »).

| Ce que fait l’orbe | Ce que cela veut dire |
|---|---|
| Petit point | Personne n’est détecté devant le miroir, ou la caméra est éteinte en veille. |
| Se déploie, gris, respire doucement | Quelqu’un est devant le miroir. Cornelius attend ce qui ouvre la conversation. Gris : aucune conversation n’est ouverte avec OpenAI, rien ne lui est envoyé (reconnaissance et mot d’appel restent sur l’ordinateur). |
| Fait un petit bond | Cornelius vient de reconnaître une personne du foyer, seule devant lui. |
| Ambre doré, pulse | La conversation s’ouvre. |
| Bleu | La conversation est ouverte, Cornelius attend que vous parliez. |
| Turquoise, avec un trait qui bouge dessous | Cornelius vous écoute. Le trait suit le niveau du micro. |
| Violet | Cornelius réfléchit. |
| Orange, avec des reflets | Cornelius parle. |
| Liseré rouge sur le bord | Cornelius cherche une information sur le web. |
| Rouge orangé, terne | La conversation se ferme. |
| Rouge sombre | La conversation est indisponible. La ligne d’état ou l’administration en donne la raison. |

Si l’ordinateur demande de réduire les animations (réglage d’accessibilité du système), l’orbe bouge à peine et ne fait plus de bond. Si le navigateur ne sait pas afficher l’orbe animé, un orbe simple le remplace.

### Le libellé sous l’orbe

Quand Cornelius prépare sa réponse, une ligne discrète sous l’orbe affiche « Je réfléchis… ». Rien ne s’écrit pendant qu’il écoute ou qu’il parle : l’orbe suffit. Quand le bouton « Activer la voix » est affiché, il passe avant ce libellé.

### La ligne d’état

Sous le nom « cornelius / », une phrase couleur ambre apparaît seulement quand quelque chose empêche Cornelius de répondre. Elle ne cite jamais de prénom, car l’écran est visible de tous. Quand le remède se trouve dans l’administration, son adresse est écrite à la suite, en toutes lettres : le miroir n’a souvent ni souris ni clavier pour suivre un lien.

| Phrase affichée | Que faire |
|---|---|
| « Cornelius n’est pas encore configuré : ouvrez l’administration sur cet ordinateur. » | La clé OpenAI manque. Suivez la rubrique « Mise en route » de l’administration. |
| « Accès à OpenAI bloqué depuis l’administration. » | Utilisez « Autoriser OpenAI » dans l’administration. |
| « Conversation arrêtée depuis l’administration. » | Utilisez « Démarrer la session » dans l’administration. Si le mot d’appel est prêt, la phrase se termine par « dites « Cornelius » pour reprendre » : le dire suffit. |
| « Service caméra arrêté : relancez Cornelius sur cet ordinateur. » | Le service caméra (perception) ne tourne pas. Voir [Dépannage](depannage.md). |
| « Écoute du mot « Cornelius » arrêtée : relancez Cornelius sur cet ordinateur. » | Même cause, quand « Cornelius » ouvre la conversation pour tout le monde (caméra éteinte en veille). |
| « Caméra du miroir indisponible : vérifiez-la dans l’administration. » | Choisissez ou rebranchez la caméra dans « Caméra et reconnaissance ». |
| « Conversation en pause : plusieurs personnes devant le miroir. » | Le mode vie privée est actif. La conversation reprend quand une seule personne reste. |
| « Mot d’appel indisponible : son modèle n’est pas prêt sur cet ordinateur. » | Le modèle du mot « Cornelius » manque. Voir [Le mot d’appel](../fonctionnalites/mot-d-appel.md). |
| « Cornelius est momentanément indisponible : voir l’administration. » | Le détail est dans le panneau Conversation de l’administration. |
| « Connexion au serveur perdue, nouvelle tentative… » | Le serveur ne répond plus depuis plus de 5 secondes. La page se reconnecte seule dès qu’il revient. |

Quand la voix n’est pas encore autorisée, la ligne reste vide : c’est le bouton « Activer la voix » qui le dit.

### Les cartes « Réponse »

Quand une réponse contient une date, un chiffre, une liste ou une comparaison, Cornelius l’affiche aussi sur une carte en verre, qui semble naître de l’orbe. Le nombre de cartes à l’écran, leur durée d’affichage et leur forme au second plan se règlent dans **Modules → Cartes**.

- Trois cartes au plus : une carte principale, et jusqu’à deux cartes complémentaires plus petites. Une nouvelle carte devient la principale.
- Le petit titre de la carte dit d’où elle vient : « Réponse » pour une réponse de Cornelius, ou le nom du module (« Heure », « Météo », « Bus »). Il se termine par « · hors ligne » quand la donnée n’a pas pu être rafraîchie.
- La teinte du verre change selon la famille de la carte : on reconnaît une carte météo ou une carte de transports avant de la lire.
- Une réponse tirée du web cite ses sources en bas de la carte.
- Une image créée par Cornelius s’affiche seule, sans titre ni texte.

Une carte s’efface d’elle-même au bout d’une minute environ, et toutes disparaissent à la fin de la conversation ou quand la personne change. Une carte personnelle ne s’affiche que pour la personne à qui elle est destinée.

### Les informations permanentes

En haut de l’écran, des informations restent visibles sans rien demander : l’heure, la météo, les prochains passages d’une ligne de transport. Elles ne demandent ni micro, ni conversation, ni OpenAI, et ne font jamais parler Cornelius.

- Chaque information porte le nom donné à sa source (par exemple « Météo maison »), puis sa valeur et l’heure du relevé (« Relevé 06/10 08:15 »).
- Une valeur qui n’a pas pu être rafraîchie reste affichée avec son ancienneté : « Dernière donnée connue, il y a 12 min ». Les autres états possibles sont « Actualisation… », « Aucune donnée disponible » et « Source indisponible ».
- Les sources du foyer s’affichent dès qu’une personne est devant le miroir. Les sources personnelles s’affichent quand leur propriétaire est reconnu.
- Rien ne s’affiche quand personne n’est détecté, quand la caméra est éteinte en veille (avec « Cornelius » ouvert à tout le monde, sans reconnaissance), ni en mode vie privée quand plusieurs personnes sont présentes.

L’affichage se règle source par source, dans l’administration : Modules → (le module) → Configurer → « Afficher en permanence sur le miroir ». Il est désactivé par défaut. Voir [Les modules](../modules/README.md).

### Les personnes détectées

En bas de l’écran, une pastille par personne détectée :

- le prénom de la personne si Cornelius la reconnaît, sinon « Personne inconnue » ;
- la pastille devient verte quand la personne regarde le miroir, et repasse au gris en fondu, seulement si le regard se perd plus d’une seconde ;
- la personne avec qui Cornelius converse a une pastille plus lumineuse.

Une pastille violette « Image en création » (ou « Illustration en cours ») s’ajoute pendant que Cornelius crée une image. Voir [La génération d’images](../fonctionnalites/generation-d-images.md).

Les prénoms des personnes reconnues sont donc visibles par tous ceux qui voient l’écran.

### L’écran de veille

Plutôt que de rester noir, le miroir peut afficher des peintures et vos photos quand personne n’est devant lui, comme un cadre d’art. Il est désactivé par défaut ; il s’active et se remplit dans l’administration, rubrique « Écran de veille ».

- **Quand.** Les images arrivent après un délai sans personne devant le miroir (30 s par défaut), sans conversation ni carte affichée. Elles changent à intervalle régulier (toutes les 5 minutes par défaut), par un long fondu, dans un ordre mélangé.
- **Ce qui fait revenir l’orbe.** Au choix : « Au moindre mouvement » (par défaut), dès qu’une personne passe, ou « Selon le réveil de Cornelius ». Dans ce second cas, l’écran de veille suit ce qui ouvre la conversation (rubrique « Quand il écoute ») : une personne qui se présente, une personne qui regarde le miroir, ou le mot « Cornelius ». Quelqu’un qui passe sans regarder, ou sans appeler, laisse l’image en place. Si l’ouverture est réservée aux membres du foyer, seule une personne reconnue réveille l’orbe. Une conversation qui s’ouvre le fait toujours revenir.
- **À l’écran.** Rien d’autre ne s’affiche : ni nom, ni informations permanentes. Par défaut, une image aux proportions de l’écran le remplit ; les autres s’y posent comme une toile, sur un fond tiré de leur propre flou. Deux autres affichages existent : l’image entière de bord à bord, ou plein écran. Une image n’est jamais étirée. Le titre et l’auteur d’une peinture s’écrivent discrètement en bas à droite.
- **Au réveil.** L’orbe réapparaît devant l’image, qui se grise puis s’efface selon la transition choisie, en une seconde par défaut (de 0,5 à 3 s, réglable). Le reste de l’écran revient ensuite. Les mêmes transitions, jouées à l’envers, font revenir les images :

  | Transition | Ce qu’on voit |
  |---|---|
  | Aspiration (par défaut) | L’image s’enroule et s’effondre dans l’orbe, en ouvrant un trou noir au centre. |
  | Cendres | L’image se consume depuis l’orbe, un liseré de braise en tête. |
  | Onde | Une onde partie de l’orbe traverse l’image et ne laisse que le noir derrière elle. |
  | Mosaïque | L’image se défait en carreaux qui tournent et fondent, de l’orbe vers les bords. |
  | Rideau | L’image s’ouvre en deux derrière l’orbe, chaque moitié glisse vers son bord. |
  | Fondu | L’image s’éteint doucement vers le noir, sans se griser. |
  | Au hasard | Un des cinq effets animés, différent à chaque fois. |
  | Sans transition | L’image disparaît d’un coup, et revient de même. |
- **Avec « Cornelius » ouvert à tout le monde.** La caméra reste éteinte en veille : les images restent jusqu’au mot d’appel.

Si l’ordinateur demande de réduire les animations, l’image apparaît et disparaît par un simple fondu.

## Activer la voix

Le navigateur ne laisse pas une page utiliser le micro et le son sans un geste de votre part. Au premier affichage, le miroir présente le bouton « Activer la voix », avec l’aide « Touchez pour autoriser le micro et le son. À refaire après un redémarrage du navigateur. ».

1. Touchez ou cliquez sur « Activer la voix ». Le bouton affiche « Autorisation du microphone… ».
2. Le navigateur demande l’autorisation d’utiliser le micro : acceptez.
3. Le bouton disparaît : la voix est prête.

En cas de problème, le message remplace l’aide, au-dessus du bouton, et un nouvel essai reste possible sans recharger la page. Les messages les plus courants sont « Microphone refusé. Autorisez-le pour ce site dans le navigateur, puis réessayez. » et « Micro occupé par une autre application. Fermez-la, puis réessayez. ». Leurs remèdes sont dans [Dépannage](depannage.md).

Bon à savoir :

- **Sans clavier ni souris sur le miroir.** Ouvrez l’administration dans le navigateur du miroir et utilisez « Activer et ouvrir le miroir », dans la rubrique « Mise en route » ou dans le panneau de conversation de « Quand il écoute » : le clic ouvre le miroir dans sa propre fenêtre et réactive le démarrage, en un seul geste. Si le navigateur demande encore un clic pour le son, touchez « Activer la voix » sur le miroir (ou autorisez une fois le son et le micro pour ce site, voir [Dépannage](depannage.md)).
- **Réactivation automatique.** Si le navigateur garde l’autorisation du micro et laisse jouer le son pour ce site, le miroir réactive la voix seul après un rechargement de la page. Il réessaie toutes les 5 secondes.
- **OpenAI bloqué.** Le bouton n’apparaît pas tant que l’accès à OpenAI est bloqué depuis l’administration.
- **Micro et haut-parleurs.** Le choix se fait dans l’administration, rubrique « Micro et haut-parleurs ». Il est propre au navigateur : faites-le dans le navigateur qui affiche le miroir, à la même adresse.

## Parler à Cornelius

Ce qui ouvre la conversation se règle dans l’administration, rubrique « Quand il écoute » : la présence d’une personne, son regard vers le miroir (réglage par défaut), ou le mot « Cornelius ». Voir [Ouverture et présence](../fonctionnalites/ouverture-et-presence.md) et [Le mot d’appel](../fonctionnalites/mot-d-appel.md).

- **À l’ouverture.** Le miroir peut jouer un son court. Si Cornelius vous reconnaît, il vous accueille par défaut d’un « Bonjour » suivi de votre prénom.
- **Parler.** Parlez normalement, sans mot magique. Cornelius répond à voix haute et affiche une carte quand c’est utile. Il est réglé pour ignorer la télévision, la musique ou une conversation voisine, et ne répondre que si on s’adresse à lui.
- **Interrompre.** Parlez pendant qu’il répond : il s’arrête et vous écoute.
- **Terminer.** La conversation se ferme quand vous partez, quand vous détournez le regard (si c’est le regard qui l’ouvre, après 8 secondes par défaut), après un silence si la « Fin de parole » est réglée, ou depuis l’administration avec « Arrêter la session ». Avec « Cornelius » ouvert à tout le monde, seuls le silence et l’administration la terminent, car la présence ne compte pas dans ce mode.
- **Reprendre.** Regardez à nouveau le miroir, éloignez-vous puis revenez, ou dites « Cornelius » si c’est lui qui ouvre la conversation.

## Plusieurs personnes et vie privée

Le miroir est un écran partagé. Quelques règles le protègent :

- la ligne d’état ne cite jamais de prénom, mais les pastilles des personnes détectées montrent le prénom des personnes reconnues ;
- les cartes et les sources personnelles ne s’affichent que pour leur propriétaire reconnu ;
- Cornelius ne retient des souvenirs que d’une conversation avec une seule personne, reconnue par la caméra (voir [La mémoire](../fonctionnalites/memoire.md)).

Sans le mode vie privée, une conversation continue quand quelqu’un arrive : la première personne reconnue garde son profil, avec ses sources, sa mémoire et ses agents. Faites attention à ce que vous demandez devant des invités.

Avec le **mode vie privée** (rubrique « Quand il écoute », désactivé par défaut) :

- dès qu’une deuxième personne est détectée, la conversation en cours se ferme ;
- aucune conversation ne s’ouvre tant qu’il y a plusieurs personnes, et la ligne d’état affiche « Conversation en pause : plusieurs personnes devant le miroir. » ;
- les informations permanentes sont masquées.

Les images de la caméra et les visages restent sur l’ordinateur. Le son du micro et le texte de la conversation partent chez OpenAI seulement pendant une conversation. Le détail est dans [Confidentialité](../reference/confidentialite.md).

## Miroir ouvert dans un autre onglet

Un seul onglet à la fois peut être le miroir : le dernier ouvert prend la main. L’onglet précédent affiche « Ce miroir est affiché dans un autre onglet. » et un bouton « Afficher ici ».

- Pour garder le miroir là où il est, fermez simplement l’autre onglet.
- Pour le reprendre dans cet onglet, touchez « Afficher ici ». L’autre onglet passe à son tour en attente. Il peut falloir activer à nouveau la voix.

Dans l’administration, « Voir le miroir » et « Activer et ouvrir le miroir » ouvrent le miroir dans sa propre fenêtre et laissent l’administration ouverte ; si cette fenêtre est déjà ouverte, elle revient au premier plan sans être rechargée. Un miroir déjà ouvert dans un autre onglet passe alors en attente.

## Portrait et paysage

Le miroir s’adapte à l’orientation de l’écran. La taille du texte suit la plus petite dimension de l’écran, pour rester lisible à distance.

**En paysage** (écran couché) :

- en haut : le nom et la ligne d’état à droite, les informations permanentes à gauche (trois au plus, quatre sur un très grand écran) ;
- au centre : l’orbe ;
- à gauche de l’orbe : la carte principale ; à droite : les cartes complémentaires ;
- en bas : les personnes détectées et le bouton « Activer la voix ».

Sur un écran couché peu haut, comme un téléphone, deux informations au plus restent affichées, réduites à leur valeur.

**En portrait** (écran debout, le cas habituel d’un miroir) :

- la moitié haute : le nom, la ligne d’état et deux informations permanentes (quatre sur un écran très haut) ;
- au centre : l’orbe ;
- la moitié basse : la carte principale, puis les cartes complémentaires côte à côte en format compact, puis les personnes détectées.

Sur un écran debout peu haut, les cartes complémentaires laissent la place au bouton « Activer la voix » quand il est affiché.

## Voir aussi

- [L’administration](administration.md)
- [Dépannage](depannage.md)
- [Premier démarrage](../installation/premier-demarrage.md)
- [Ouverture et présence](../fonctionnalites/ouverture-et-presence.md)
- [Les modules](../modules/README.md)
- [Confidentialité](../reference/confidentialite.md)
