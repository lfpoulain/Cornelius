# Accès depuis le réseau local

Le miroir et l’administration s’ouvrent aussi depuis un téléphone, une tablette ou un autre ordinateur connecté à la même box que l’ordinateur de Cornelius. C’est activé par défaut.

## Les adresses

L’ordinateur de Cornelius garde son adresse habituelle, `http://127.0.0.1:3000/`. Les autres appareils passent par une adresse chiffrée (HTTPS) sur un second port, `3443` par défaut (`PORT` + 443) :

- le miroir : `https://<adresse de l’ordinateur>:3443/` ;
- l’administration : `https://<adresse de l’ordinateur>:3443/admin`.

L’adresse exacte s’affiche dans l’administration, rubrique **Mise en route**, carte **Accès depuis le réseau local**, et au démarrage du serveur (ligne « Réseau local · https://192.168.1.20:3443 »). Le nom de l’ordinateur suivi de `.local` fonctionne aussi sur la plupart des réseaux (par exemple `https://miroir.local:3443/`).

Une adresse tapée sans le « s » (`http://192.168.1.20:3443/`) renvoie d’elle-même vers l’adresse chiffrée. Le port `3000`, lui, ne répond qu’à l’ordinateur de Cornelius.

Le chiffrement est indispensable : sans lui, les navigateurs refusent le micro, et le mot de passe de l’administration passerait en clair sur le Wi‑Fi.

## Le certificat

Cornelius crée lui-même son certificat (dans `data/tls`), sans autorité extérieure. À la première visite, le navigateur affiche donc un avertissement (« Votre connexion n’est pas privée », « Attention : risque probable de sécurité »). Pour le passer en confiance :

1. comparez l’empreinte SHA‑256 du certificat, visible dans les détails de l’avertissement, avec celle de la carte **Accès depuis le réseau local** ;
2. si elles sont identiques, choisissez « Paramètres avancés », puis « Continuer vers le site ».

Le navigateur s’en souvient ensuite. Le certificat est recréé quand l’adresse de l’ordinateur change, ou 30 jours avant son expiration (il vaut un peu plus de deux ans) : l’avertissement revient alors une fois.

Pour utiliser votre propre certificat (par exemple celui d’un nom de domaine local), indiquez ses fichiers PEM dans `CORNELIUS_TLS_CERT` et `CORNELIUS_TLS_KEY`.

## Autoriser un appareil

L’administration demande son mot de passe, comme sur l’ordinateur. Le miroir, lui, n’a pas de mot de passe sur l’ordinateur de Cornelius, mais un autre appareil doit être autorisé une fois : la page du miroir demande le mot de passe administrateur, puis l’appareil reste autorisé, même après un redémarrage.

Le bouton **Retirer les autorisations**, dans la même carte, oublie tous les appareils autorisés. Chacun devra se reconnecter.

Tant que le mot de passe vaut `cornelius` (la valeur de départ), aucune connexion n’est acceptée depuis un autre appareil : changez-le d’abord dans l’administration, sur l’ordinateur de Cornelius (**Mise en route**, carte « Mot de passe administrateur »).

## Un seul miroir à la fois

Un seul miroir est actif : en ouvrir un sur la tablette ferme celui de l’écran, avec le message « Miroir ouvert dans un autre onglet ». Par défaut, la caméra reste celle du serveur Cornelius. Vous pouvez choisir [la caméra du navigateur](../fonctionnalites/camera-navigateur.md) : ses images sont alors envoyées au serveur par le réseau local chiffré. Le mot d’appel et la vision restent analysés sur le serveur ; le micro et le haut-parleur sont ceux de l’appareil qui affiche le miroir.

## Ce qui reste réservé à l’ordinateur

- La perception (caméra, mot d’appel) et le générateur d’images ne se connectent que depuis l’ordinateur lui-même.
- Une adresse publique (Internet, port redirigé par la box) est toujours refusée : « Accès réservé au réseau local. ». N’ouvrez pas le port 3443 sur votre box.
- Un nom d’hôte inconnu est refusé (« Hôte non autorisé. »), ce qui protège contre un site extérieur qui se ferait passer pour Cornelius. Pour accepter un autre nom, ajoutez-le à `CORNELIUS_ALLOWED_HOSTS` (liste séparée par des virgules).

## Le pare-feu

- **Windows** : au premier démarrage, Windows demande d’autoriser Node.js. Cochez « Réseaux privés » et confirmez. Vérifiez aussi que le réseau Wi‑Fi est classé « Privé » dans les paramètres Windows.
- **Linux** : avec `ufw`, ouvrez le port au réseau local seulement, par exemple `sudo ufw allow from 192.168.1.0/24 to any port 3443 proto tcp`.

## Désactiver l’accès réseau

Ajoutez `CORNELIUS_LAN=0` dans `.env`, puis redémarrez Cornelius : seul l’ordinateur lui-même ouvre alors le miroir et l’administration, et le port 3443 n’est plus ouvert.

## Voir aussi

- [L’administration](administration.md)
- [Le miroir](miroir.md)
- [Configuration](../reference/configuration.md#réseau-local)
- [Dépannage](depannage.md)
