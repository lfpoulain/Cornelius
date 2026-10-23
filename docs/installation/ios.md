# Cornelius sur iPhone

L’app est native (SwiftUI, Metal, AVFoundation), compatible iOS 18 et suivants. Elle utilise le serveur Cornelius de la maison : micro, haut-parleur et caméra sont ceux de l’iPhone ; reconnaissance, mot d’appel, mémoire, outils et droits restent sur le serveur. Une seule conversation est active dans le foyer. L’administration reste sur le web.

## Associer l’iPhone

1. Démarrez le serveur et son worker de perception, avec HTTPS activé et un mot de passe administrateur personnel.
2. Ouvrez **Administration → Mise en route → App iPhone**. Vérifiez l’adresse HTTPS locale : sous Docker, indiquez l’adresse de l’hôte, pas l’adresse du conteneur.
3. Choisissez **Associer un iPhone**. Dans l’app, scannez le QR code ; sur le même iPhone, utilisez le lien ou copiez-le dans l’app. L’invitation expire après cinq minutes et fonctionne une seule fois.
4. Autorisez réseau local, caméra et micro. L’app mémorise le jeton et la clé du serveur dans le Trousseau, sans synchronisation iCloud. Aucun certificat à installer.

Le QR code accorde l’accès au miroir : ne le partagez pas. Pour retirer l’accès, révoquez l’iPhone depuis cette même carte. Oublier le serveur dans l’app efface seulement son association locale.

Bonjour retrouve Cornelius sur le réseau local. Certaines configurations Docker ou Wi-Fi invité bloquent multicast ou communications entre appareils ; le QR code et l’adresse manuelle restent disponibles. Une nouvelle adresse locale ne change jamais la clé attendue : si le serveur est réinstallé avec une autre clé, réassociez l’app.

## Accès extérieur avec Tailscale

Aucun serveur Cornelius central, aucune ouverture de port sur la box. Tailscale nécessite un compte et sa coordination externe ; une liaison peut utiliser ses relais chiffrés. Le serveur de la maison doit rester allumé.

1. Installez/connectez Tailscale sur l’hôte du serveur et l’iPhone, dans le même réseau Tailscale. Sur Unraid, utilisez l’intégration de l’hôte. Ne démarrez pas deux démons pour ce même hôte.
2. Activez l’entrée HTTP **réservée au proxy mobile** :

```dotenv
CORNELIUS_MOBILE_PROXY_PORT=3444
CORNELIUS_MOBILE_PROXY_HOST=127.0.0.1
CORNELIUS_MOBILE_REMOTE_URL=https://nom-machine.nom-tailnet.ts.net
```

L’URL doit être celle de la machine Tailscale, sans chemin. Le serveur fournit automatiquement cette adresse aux apps associées ; un nouveau QR code n’est pas nécessaire.

### Docker / Unraid

L’écoute du proxy doit être joignable dans le conteneur, mais son port doit être publié **uniquement sur la boucle locale de l’hôte** :

```text
Variable : CORNELIUS_MOBILE_PROXY_PORT=3444
Variable : CORNELIUS_MOBILE_PROXY_HOST=0.0.0.0
Publication Docker : 127.0.0.1:3444:3444/tcp
```

Conservez la publication HTTPS LAN existante. Redémarrez Cornelius après modification de son environnement/template. Ne publiez pas le port HTTP habituel du serveur et n’exposez pas 3444 sur toutes les interfaces de l’hôte.

3. Sur l’hôte, `scripts/tailscale-mobile.sh` vérifie l’état et affiche la commande Serve ainsi que l’URL à reporter. Le mode par défaut ne change rien. `--apply` active uniquement le proxy, à condition qu’aucune configuration Serve ne soit déjà en place.
4. Testez depuis l’iPhone avec son Wi-Fi désactivé. Tailscale doit être connecté. L’app utilise HTTPS avec validation système pour cette adresse ; en LAN elle vérifie directement la clé du serveur issue de l’association.

L’entrée proxy filtre HTTP et WebSocket sur les routes `/mobile/*` prévues par le protocole. Chaque accès aux données exige son jeton mobile, même depuis la boucle locale. Elle ne sert pas `/admin`, `/api/admin`, `/perception` ou le générateur d’images. Aucun élargissement global des adresses LAN acceptées.

## Caméra et arrière-plan

Les images passent chiffrées de l’iPhone au serveur de la maison pour être analysées par les mêmes modèles que la webcam. Elles restent uniquement dans une mémoire bornée. L’app ne transporte pas les modèles ou gabarits faciaux et ne peut pas envoyer une identité reconnue.

La source active possède une génération propre ; ses images et résultats ne peuvent pas être réutilisés après changement d’appareil. Au premier plan, l’orbe et la caméra suivent les règles de présence du serveur. Une seconde caméra distante ne crée pas une seconde conversation.

Lorsque l’app passe en arrière-plan ou que l’iPhone est verrouillé, la caméra s’arrête. Seule la conversation déjà ouverte continue ; aucune nouvelle conversation ne s’ouvre en arrière-plan. Les fonctions demandant une caméra fraîche, dont la collecte de mémoire personnelle et la vision, sont suspendues. Le silence termine la conversation selon le réglage du serveur, avec vingt secondes par défaut si la fin sur silence était désactivée. À sa fin, la capture audio s’arrête. Un appel téléphonique interrompt la conversation.

## Construire l’app

Ouvrez `ios/Cornelius.xcodeproj` avec Xcode 27.1, choisissez le schéma **Cornelius** et un simulateur ou votre iPhone. Pour un appareil physique, sélectionnez votre équipe Apple dans Signing. Aucun CocoaPods ni package Swift externe.

`ios/project.yml` permet de régénérer le projet avec XcodeGen si ses sources/cibles changent. Le projet Xcode généré est versionné : XcodeGen n’est pas nécessaire pour compiler un checkout normal.

```sh
xcodebuild -project ios/Cornelius.xcodeproj -scheme Cornelius -sdk iphonesimulator \
  -destination 'platform=iOS Simulator,name=iPhone Duo' CODE_SIGNING_ALLOWED=NO test
```

Utilisez un dossier DerivedData temporaire borné et nettoyez-le après les vérifications. Les arguments `-demo -snapshot` affichent un état synthétique déterministe, sans permission micro/caméra, compte ni appel réseau. Ce mode ne prouve pas une conversation réelle.

## Recette à effectuer sur appareil

- Association, expiration, refus d’autorisation, révocation et serveur indisponible.
- Visage connu/inconnu, plusieurs personnes, départ et changement de source ; cartes et sources personnelles masquées si la reconnaissance n’est plus fraîche.
- Conversation LAN puis réseau cellulaire/Tailscale ; interruption vocale, écho, Bluetooth, appel téléphonique, verrouillage et fin sur silence.
- Duo fermé, ouvert, plié, tourné et en Split View ; aucune commande ni carte sous une région de caméra ou de pliure ; conservation de la conversation pendant redimensionnement.
- VoiceOver, gros texte, réduction des animations et mode économie d’énergie.

Les tests de contrat et captures simulateur sont distincts de cette recette physique. La publication App Store/TestFlight et l’activation sur le serveur de production ne font pas partie de la livraison du code.
