# Ouverture et présence

Cette page explique comment une conversation avec Cornelius commence, ce qui la fait durer et ce qui la termine. Elle s’adresse à la personne qui règle le miroir pour la maison. Tous les réglages cités se trouvent dans l’administration, rubrique **Quand il écoute**, sauf mention contraire.

## Deux questions pour ouvrir la conversation

La carte **Quand il écoute → Ouverture de la conversation** pose deux questions indépendantes.

**Ce qui l’ouvre :**

- **La présence** : dès qu’une personne s’arrête devant le miroir.
- **Le regard** : quand une personne regarde franchement le miroir. C’est le choix le plus discret.
- **« Cornelius »** : seulement quand on dit « Cornelius », entendu sur l’ordinateur du miroir. Ce choix demande un modèle à installer (voir [Le mot d’appel](mot-d-appel.md)).

**Qui peut l’ouvrir :**

- **Tout le monde** : un membre du foyer ou un visiteur.
- **Les membres du foyer** : seulement une personne reconnue par la caméra. Avec « Cornelius », il faut être reconnu devant le miroir au moment où on le dit.

Au premier démarrage, Cornelius s’ouvre au **regard**, pour **tout le monde**.

Chaque choix est enregistré dès le clic. Sous les deux questions, un résumé dit en une phrase ce que fera Cornelius et si la caméra reste allumée en veille. Un avertissement apparaît quand le choix ne peut pas fonctionner pour l’instant : service caméra (perception) arrêté, mot « Cornelius » pas encore prêt, ou aucun visage mémorisé alors que l’ouverture est réservée aux membres du foyer.

## Les six combinaisons

| Ce qui l’ouvre | Qui peut l’ouvrir | Ce que fait Cornelius | Caméra en veille |
| --- | --- | --- | --- |
| La présence | Tout le monde | Il parle à toute personne qui s’arrête devant le miroir. | Allumée |
| La présence | Les membres du foyer | Il attend de reconnaître un membre du foyer devant le miroir. | Allumée |
| Le regard | Tout le monde | Il répond quand quelqu’un regarde le miroir. | Allumée |
| Le regard | Les membres du foyer | Il répond quand un membre du foyer reconnu regarde le miroir. | Allumée |
| « Cornelius » | Tout le monde | Le mot ouvre la conversation pour toute personne. | Éteinte, ou allumée avec la reconnaissance |
| « Cornelius » | Les membres du foyer | Le mot ouvre la conversation seulement si un membre du foyer est reconnu devant le miroir. | Allumée |

« Cornelius » réservé aux membres du foyer garde la caméra allumée en veille : c’est le seul moyen de savoir qui parle avant d’ouvrir la conversation.

Avec « Cornelius » pour tout le monde, la caméra reste éteinte en veille, sauf si la reconnaissance est cochée (voir la section suivante) : elle reste alors allumée pour reconnaître la personne sans délai. Sans reconnaissance, elle ne s’allume que pendant la conversation, et seulement pour la vision locale (voir [La vision locale](vision-locale.md)).

## Reconnaître la personne pendant la conversation

Avec « Cornelius » pour tout le monde, une case supplémentaire apparaît : **Reconnaître la personne pendant la conversation**. Elle est décochée au départ.

Cochée, la caméra reste allumée en veille, comme avec les autres ouvertures : les images restent sur cet ordinateur, et la personne est reconnue dès « Cornelius », sans attendre que la caméra démarre. Si une seule personne enregistrée est face à elle dans les 8 secondes, ses informations rejoignent la conversation sans la rouvrir : ses sources, sa mémoire, ses agents et Home Assistant quand il est réservé aux personnes reconnues. Sinon, la conversation reste celle du foyer. À la fin de la conversation, le profil est retiré.

Avec la présence pour tout le monde, la reconnaissance se fait aussi en cours de route : la conversation s’ouvre pour une personne inconnue, puis les informations de la personne s’ajoutent dès qu’elle est reconnue, sans rouvrir la conversation.

Avec le regard, la personne est en général reconnue avant l’ouverture. Si une autre personne est reconnue pendant la conversation, celle-ci se ferme puis se rouvre pour la nouvelle personne, selon les règles d’ouverture habituelles.

La ressemblance exigée pour reconnaître quelqu’un se règle dans **Caméra et reconnaissance → Exigence de la reconnaissance**, et la sensibilité au regard dans **Caméra et reconnaissance → Détection du regard** (voir [L’administration](../utilisation/administration.md)).

## Ce qui termine la conversation

Selon ce qui l’a ouverte :

- **La présence** : la conversation reste ouverte tant que la personne est là, même sans regarder le miroir. Elle se ferme quand le départ est confirmé.
- **Le regard** : la conversation se ferme aussi quand la personne ne regarde plus le miroir pendant le délai **Terminer après la perte du regard**. Une réponse de Cornelius en cours repousse cette fin, pour ne pas le couper au milieu d’une phrase ; la parole de la personne, elle, ne la repousse pas : parler à quelqu’un d’autre en détournant les yeux, ou de loin, laisse la conversation se fermer. La personne reste reconnue ; un nouveau regard confirmé rouvre la conversation.
- **« Cornelius » pour les membres du foyer** : comme pour la présence, la conversation se ferme au départ confirmé.
- **« Cornelius » pour tout le monde** : la caméra ne sert pas à voir la personne partir, même allumée pour la reconnaissance. Seul un silence termine la conversation (voir « Fin de parole » plus bas). L’écoute du mot « Cornelius » reprend aussitôt pour la prochaine demande.

Dans tous les cas avec caméra, la conversation se ferme aussi sans attendre ces délais quand la caméra tombe en panne plus d’une seconde, ou quand une deuxième personne arrive en mode vie privée.

## Délais de présence

Les délais se règlent dans **Quand il écoute → Réglages avancés → Délais de présence**, dans le repli **Réglage fin**. Ils sont en secondes ; 0 veut dire sans attente. Le bouton **Valeurs par défaut** remet les valeurs d’origine. Les valeurs s’appliquent dès l’enregistrement.

| Réglage | Par défaut | Plage | Effet |
| --- | --- | --- | --- |
| Confirmer une présence | 0,4 s | 0 à 5 s | Durée de détection continue avant de considérer qu’une personne est là. Évite de réagir à un passage très court. |
| Confirmer le regard | 0,35 s | 0 à 5 s | Durée du regard vers le miroir, une fois la présence établie, avant de considérer que la personne le regarde. |
| Confirmer un départ | 1,5 s | 0 à 30 s | Temps sans personne détectée avant de confirmer le départ. Un retour avant ce délai annule le départ. C’est aussi le temps laissé à la reconnaissance pour retrouver une personne dont le visage a été perdu. |
| Terminer après la perte du regard | 8 s | 0 à 60 s | Pendant une conversation, temps toléré sans visage détecté, et sans regard quand c’est le regard qui ouvre la conversation. S’il est plus long que la confirmation du départ, c’est lui qui compte pendant la conversation. |
| Garder l’identité sans nouvelle preuve | 8 s | 0 à 60 s | Temps pendant lequel une personne reconnue garde son profil quand son visage reste suivi sans être identifiable : tête tournée, trop loin, flou, ressemblance avec un proche. Une autre personne reconnue retire le profil tout de suite. |

Un délai de départ plus long évite les coupures quand la caméra perd brièvement un visage.

## Fin de parole

La carte **Quand il écoute → Fin de parole** ferme la conversation après un silence, même si la personne reste devant le miroir.

- Choix proposés : **Jamais**, 10 s, 20 s, 30 s, 1 min, 2 min et 5 min.
- Un autre délai se saisit dans **Réglage fin → Délai de silence (s)**, de 3 à 300 s. Enregistrer ce délai active la fin de parole.
- Par défaut, la fin de parole est désactivée (**Jamais**) et le délai préparé est de 20 s.
- Le délai repart chaque fois que la personne parle. Il attend aussi la fin de la réponse de Cornelius.

Avec « Cornelius » pour tout le monde, la fin de parole est toujours active : **Jamais** n’est pas disponible, puisque rien d’autre ne peut terminer la conversation.

La case **Fermer après la première réponse** (désactivée par défaut) donne une question et une réponse : la conversation se ferme 2 secondes après la fin de la première réponse de Cornelius. L’accueil (« Bonjour Prénom ») ne compte pas, seule une réponse à ce que la personne a dit ferme. Une réponse qui passe par un outil ou un agent attend la fin de la réponse complète. Si personne ne parle, seul le silence réglé au-dessus ferme la conversation.

La case **Fermer quand on dit merci** (désactivée par défaut) ferme la conversation quand la personne la clôt sans nouvelle demande : « merci », « merci, c’est tout », « c’est bon », « au revoir », « bonne nuit », « tu peux arrêter ». Cornelius répond d’une formule courte (« avec plaisir »), puis la conversation se ferme 2 secondes après la fin de sa réponse, et au plus tard 10 secondes après. La parole entendue ensuite dans la pièce ne la retient pas : on peut parler à quelqu’un d’autre sans que Cornelius continue d’écouter. Un « merci » suivi d’une autre demande ne ferme pas. Le serveur reconnaît la fin dans la transcription de la phrase, quand elle n’est faite que d’une formule de fin (« oui merci », qui répond à une question, ne ferme pas) ; le modèle peut aussi la reconnaître et appeler l’outil `conversation__end`. Le réglage vaut à partir de la conversation suivante. Une fois la case cochée, le champ **Autres formules de fin** ajoute celles du foyer, une par ligne, 20 au plus (« c’est bon Jarvis », « ciao ») : la phrase entière doit correspondre, à la ponctuation et à la casse près.

Après une fin sur silence ou après la réponse, la conversation ne se rouvre pas toute seule devant la même personne. Pour reprendre : regarder à nouveau le miroir après avoir détourné les yeux, s’éloigner puis revenir, ou dire « Cornelius » si c’est lui qui ouvre la conversation.

## Mode vie privée

La carte **Quand il écoute → Mode vie privée** est désactivée au départ. Activée, elle ferme la conversation en cours dès qu’une deuxième personne est détectée, et aucune nouvelle conversation ne s’ouvre tant qu’il y a du monde. Le profil reconnu reste affiché. Une personne choisie à la main dans l’administration reste prioritaire.

Avec « Cornelius » pour tout le monde, la caméra n’est allumée que pendant la conversation. Le mode vie privée ferme alors une conversation rattachée à une personne reconnue si plusieurs personnes apparaissent.

## Arrêter et reprendre à la main

Le panneau **Conversation**, en haut de chaque page de l’administration, propose **Arrêter la session** pendant une conversation. L’arrêt suspend le démarrage automatique : plus aucune conversation ne s’ouvre, même après un redémarrage de Cornelius.

Pour reprendre :

- **Démarrer la session** dans le même panneau réactive le démarrage automatique, selon l’ouverture choisie ;
- dire « Cornelius », quand le mot d’appel est prêt, vaut aussi une demande explicite et lève l’arrêt.

**Bloquer les services IA**, dans ce même panneau quand il est affiché en entier (rubrique **Quand il écoute**), coupe et interdit toute conversation tant qu’il n’est pas levé (voir [L’administration](../utilisation/administration.md)).

## Micro gardé prêt (bêta)

La carte **Quand il écoute → Réglages avancés → Micro gardé prêt** est désactivée au départ. C’est une fonction expérimentale : la réponse peut arriver plus tard qu’en parlant une fois la conversation ouverte. Activée, elle permet de dire « Cornelius, allume la lumière » d’une traite, ou de parler dès que la caméra vous voit.

Le navigateur du miroir garde alors en mémoire, sur l’ordinateur, la seconde qui précède l’ouverture et ce qui est dit pendant l’ouverture (16 secondes au plus). Ce son n’est envoyé à la conversation qu’une fois celle-ci ouverte. Si la conversation ne s’ouvre pas, rien ne part. Sans ce réglage, ce qui est dit avant que la conversation soit prête n’est pas entendu. Pour ne pas laisser la conversation en retard sur vous, les blancs de cet enregistrement (l’attente de l’ouverture, les pauses longues) sont raccourcis à 0,15 seconde jusqu’à rattraper le direct ; la parole, elle, n’est jamais accélérée.

## Accueil et son d’ouverture

**Quand il écoute → Accueil à l’ouverture** choisit ce que Cornelius dit en premier quand il reconnaît la personne :

- **« Bonjour » et le prénom** (par défaut) : toujours la même phrase, par exemple « Bonjour Sacha. » ;
- **Accueil libre** : une courte salutation dans le ton choisi dans « Personnaliser Cornelius » (voir [La personnalité](personnalite.md)) ;
- **Pas d’accueil** : Cornelius attend que la personne parle la première.

Sans personne reconnue, il ne salue jamais. Quand la conversation s’ouvre avec « Cornelius », la personne a déjà formulé sa demande : reconnue, elle est appelée par son prénom, sans salutation.

**Quand il écoute → Son d’ouverture** joue un son court sur le miroir dès qu’une conversation s’ouvre, avant même que Cornelius soit prêt à écouter. Par défaut, il n’y a aucun son. Six sons sont proposés : Carillon, Goutte, Cristal, Bulle, Cloche et Souffle. Le bouton **Écouter** le fait entendre. Le miroir ne joue ce son qu’après l’activation de la voix.

## Voir aussi

- [Le mot d’appel](mot-d-appel.md)
- [La mémoire](memoire.md)
- [La vision locale](vision-locale.md)
- [Le miroir](../utilisation/miroir.md)
- [L’administration](../utilisation/administration.md)
- [Premier démarrage](../installation/premier-demarrage.md)
- [Confidentialité](../reference/confidentialite.md)
