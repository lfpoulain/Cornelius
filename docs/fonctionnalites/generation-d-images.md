# La génération d’images

Cornelius peut dessiner une image à la voix et l’afficher sur le miroir, soit sur l’ordinateur du miroir, soit avec OpenAI. Cette page présente les deux moteurs, les modèles proposés, leur installation, la façon de demander, de remontrer ou d’interrompre une image, et ce qui est conservé. Elle s’adresse à la personne qui règle le miroir pour la maison.

## Le principe

En haut de la carte, **Où créer les images** propose deux moteurs :

- **Sur ce PC** (par défaut) : l’image est calculée sur l’ordinateur du miroir, par un modèle installé depuis l’administration. Elle n’est envoyée à aucun service d’image en ligne. Il faut une carte graphique bien dotée.
- **Avec OpenAI** : l’image est créée par l’API d’images d’OpenAI, avec la clé OpenAI déjà utilisée pour la conversation. Rien à installer, mais la description part chez OpenAI et chaque image est facturée sur votre compte. Voir [Avec OpenAI](#avec-openai).

Dans les deux cas, la conversation vocale passe par OpenAI comme d’habitude : c’est elle qui comprend la demande et rédige la description de l’image.

Sur un Raspberry Pi, seul **Avec OpenAI** est proposé : le choix du moteur n’apparaît pas. Voir [Installer sur Raspberry Pi](../installation/raspberry-pi.md).

Toutes les images sont carrées, au format WebP : 512 × 512 pixels sur ce PC, 1024 × 1024 avec OpenAI. La fonction est commune au foyer : le moteur, le modèle et les réglages valent pour tous les profils.

La carte **Génération d’image** se trouve dans la rubrique **Modules**, groupe « Capacités de Cornelius ».

## Les modèles

| Choix | Modèle | Mémoire graphique | Disque | Licence annoncée |
| --- | --- | --- | --- | --- |
| **Léger** | SDXL Turbo | environ 7 Go | environ 7 Go | Licence communautaire Stability AI, à vérifier pour un usage commercial |
| **Équilibré** | SANA-Sprint 0.6B | environ 9 Go | environ 9 Go | Apache 2.0, avec des conditions propres à son encodeur de texte (Gemma) |
| **Précis** (par défaut) | FLUX.2 Klein 4B | environ 13 Go | environ 16 Go | Apache 2.0 |
| **Très précis** | Z-Image Turbo | environ 20 Go | environ 43 Go, dont 31 Go téléchargés | Apache 2.0 |

Plus le modèle est précis, plus il demande de mémoire graphique et de place. Le premier modèle installé ajoute environ 4 Go pour l’environnement de calcul (Python et bibliothèques d’image), installé une seule fois. Z-Image Turbo prépare en plus, au premier chargement, une copie adaptée à la carte graphique (environ 11,5 Go).

SDXL Turbo et FLUX.2 Klein calculent directement en 512 × 512. SANA-Sprint et Z-Image calculent en 1024 × 1024 puis réduisent l’image. Les licences complètes sont résumées dans [Licences](../reference/licences.md).

## Avec OpenAI

Choisissez **Avec OpenAI** en haut de la carte. Les étapes deviennent :

1. **Clé OpenAI** : la clé de Cornelius (rubrique **Clés et accès**, carte « Clés et jetons », ou `OPENAI_API_KEY` dans `.env`) sert aussi aux images. Si elle manque, ou si les connexions OpenAI sont bloquées, l’étape le dit. OpenAI peut demander de vérifier votre organisation (platform.openai.com, rubrique Organization) avant d’autoriser ses modèles d’image : sans cela, Cornelius répond que le modèle est refusé pour ce compte.
2. **Choisir le modèle et la qualité** :
   - **Modèle OpenAI** : **GPT Image 2.5 Flare** (par défaut, le plus rapide, conseillé), **GPT Image 2.5 Sunburst** (plus précis sur les détails et le texte, plus lent) ou **GPT Image 1 mini** (le plus économique).
   - **Qualité** : **Rapide** (par défaut, conseillée pour le miroir), **Équilibrée** ou **Soignée**. Une qualité plus élevée ajoute des détails, mais l’image arrive plus tard et coûte plus cher.
3. **Activer** : **Autoriser la création d’images** et **Illustrer automatiquement les cartes**, comme sur ce PC. Avec OpenAI, chaque illustration automatique est aussi une image facturée.

Choisir OpenAI arrête le générateur local et libère la mémoire graphique ; revenir à **Sur ce PC** le relance avec le modèle installé. Les tarifs sont ceux de votre compte OpenAI (facturation à l’usage, selon le modèle et la qualité).

## Installer et activer (sur ce PC)

La carte **Génération d’image** guide l’installation en trois étapes.

1. **Choisir le modèle** : cliquez sur l’un des quatre choix. Ce choix ne télécharge rien. Un badge indique le modèle « Utilisé » et ceux déjà « Installé ».
2. **Installer** : cliquez sur **Installer « … »…**. Une confirmation indique la taille à télécharger et une durée estimée ; validez avec **Installer**. L’installation se fait en deux étapes affichées à l’écran : les outils de calcul, puis le modèle. Vous pouvez quitter la page : elle continue sur le serveur. Si le modèle est déjà installé, le bouton devient **Utiliser ce modèle**, et **Vérifier l’installation** contrôle celui en place.
3. **Activer** : une fois le modèle installé, allumez **Autoriser la création d’images**.

L’installation crée l’environnement Python séparé `.venv-image`, choisit la version de PyTorch adaptée à la carte graphique, puis télécharge le modèle depuis Hugging Face dans `models/image-generation/`. Une fois la création autorisée, le générateur démarre tout seul avec le serveur, et redémarre seul s’il s’arrête. Aucune commande ni clé n’est nécessaire.

Une seule installation à la fois. En cas d’échec, **Réessayer** garde les fichiers déjà téléchargés, et **Voir les détails** affiche le message technique.

## Les réglages

À l’étape **Activer** de **Modules → Génération d’image** :

- **Autoriser la création d’images** (désactivé par défaut) : Cornelius crée une image quand on le lui demande. Désactivé, il ne peut ni créer ni remontrer d’image, et le générateur est arrêté, ce qui libère la mémoire graphique.
- **Charger le modèle dès le démarrage** (désactivé par défaut) : la première image arrive plus vite, mais la mémoire graphique reste occupée en permanence. Sinon, le modèle se charge à la première demande.
- **Illustrer automatiquement les cartes** (désactivé par défaut) : après une carte descriptive de Cornelius ou d’un module, une image s’affiche en seconde carte. Les cartes seulement chiffrées, périmées ou hors ligne restent sans image, de même quand le générateur est déjà occupé.
- **Qualité du modèle équilibré** (avec SANA-Sprint seulement) : **Rapide, 2 étapes (réglage conseillé)**, par défaut, ou **Soignée, 4 étapes (plus lent)**. Seule la prochaine image change.

Le modèle choisi reste en mémoire entre deux images. Changer de modèle redémarre le générateur, ce qui libère l’ancien avant de charger le nouveau.

## Demander une image

Demandez simplement, par exemple « Dessine une affiche minimaliste d’un phare dans la brume » ou « Imagine un chat astronaute ». Cornelius transmet une description fidèle de la demande, sans ajouter de personne, de marque ou de texte non demandés.

Pendant le calcul, un petit badge « Image en création » s’affiche sur le miroir (« Illustration en cours » pour une illustration automatique). L’image apparaît ensuite en carte, sans texte ajouté, et Cornelius annonce une seule fois qu’elle est affichée. Selon le modèle et la machine, cela prend de quelques secondes à plusieurs dizaines de secondes.

Une simple demande d’affichage d’informations (« affiche la météo ») produit une carte d’information, pas une image.

## Interrompre

Une image en cours s’arrête :

- quand on demande une nouvelle image : la nouvelle demande remplace la précédente, et le calcul est réellement arrêté ;
- quand la conversation se termine ;
- quand on désactive **Autoriser la création d’images** ;
- au bout de 3 minutes sans résultat.

Une illustration automatique ne passe jamais devant une demande : elle est abandonnée dès qu’une image est demandée.

## Remontrer une image

Les trois dernières images demandées peuvent être réaffichées à la voix, sans nouveau calcul : « Remontre l’image du phare », « L’image d’avant ». Cornelius les retrouve par leur position (la plus récente, l’avant-dernière, la plus ancienne) ou par quelques mots de leur sujet.

Une image créée pour une personne reconnue n’est remontrée que pour elle. Une image créée sans personne reconnue est commune. Les illustrations automatiques ne se remontrent pas.

## Envoyer une image

Avec le module **E-mail**, « Envoie-moi cette image » ou « Envoie l’image du phare à Baptiste » envoie l’image affichée, ou l’une des trois dernières, en pièce jointe, aux seuls destinataires réglés dans l’administration. Les mêmes règles de partage s’appliquent : une image créée pour une personne ne part que si Cornelius la reconnaît. Voir [L’envoi par e-mail](envoi-par-e-mail.md).

## Ce qui est conservé

- Les images sont rangées dans `data/generated-images/`. Il y en a au plus trois, illustrations comprises : au-delà, une illustration part en premier, puis l’image la plus ancienne.
- Le dossier est vidé à chaque démarrage du serveur.
- Le journal note le modèle, la durée et les erreurs, jamais la description de l’image.
- Sous les réglages, la carte indique « Images gardées : … / 3 ».

## Mémoire graphique

Au chargement, le générateur compare la taille du modèle à la mémoire graphique libre. Il garde tout sur la carte graphique s’il tient, sinon il compacte une partie du modèle, et en dernier recours il le déplace par morceaux vers la mémoire de l’ordinateur, ce qui est plus lent. Le placement retenu s’affiche dans **Modules → Génération d’image → Détails techniques**, avec la carte graphique utilisée et le modèle chargé.

La vision locale utilise aussi la carte graphique. Pour aller au plus vite, gardez la vision en **Léger** ou sur le processeur, et activez **Charger le modèle dès le démarrage**. Le matériel conseillé, l’installation des pilotes et les variables `CORNELIUS_IMAGE_*` sont décrits dans [La carte graphique](../installation/gpu.md).

## Vérifier

La carte **État du système → Génération d’image** montre si l’outil est activé, l’état de l’installation et du générateur, le modèle sélectionné et le modèle chargé, la taille de calcul, le périphérique et la durée de la dernière image.

## Voir aussi

- [La carte graphique](../installation/gpu.md)
- [La vision locale](vision-locale.md)
- [L’envoi par e-mail](envoi-par-e-mail.md)
- [L’administration](../utilisation/administration.md)
- [Configuration](../reference/configuration.md)
- [Licences](../reference/licences.md)
- [Confidentialité](../reference/confidentialite.md)
