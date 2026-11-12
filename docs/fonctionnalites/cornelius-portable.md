# Cornelius portable

Cornelius portable met Cornelius sur votre téléphone, à la maison comme ailleurs, sans l’ouvrir à Internet. Le serveur et vos téléphones rejoignent un réseau privé chiffré, [Tailscale](https://tailscale.com) (gratuit pour un usage personnel) : seuls vos appareils voient Cornelius. Tout se règle depuis l’administration, rubrique **Clés et accès**, carte **Cornelius portable**.

L’adresse privée a un vrai certificat, reconnu par les navigateurs : plus d’avertissement comme sur le [réseau local](../utilisation/reseau-local.md), et « Installer l’application » devient possible. Cornelius s’ouvre alors en plein écran depuis l’écran d’accueil du téléphone.

## Dans l’administration

1. **Connecter ce serveur à Tailscale** : la carte affiche un lien de connexion et son code QR. Connectez-vous à votre compte Tailscale (Google, Microsoft, Apple ou GitHub) ; il est créé à la première connexion. La carte se met à jour seule.
2. **Ouvrir Cornelius portable** : l’interrupteur publie le miroir et l’administration sur le réseau privé seulement, à une adresse de la forme `https://cornelius.<votre réseau>.ts.net`.
3. **Ajouter un téléphone** : deux codes QR. Le premier mène à l’application Tailscale (Android ou iPhone) ; connectez-vous avec le même compte que le serveur, et activez de préférence le « VPN permanent » du téléphone. Le second ouvre Cornelius ; choisissez ensuite « Installer l’application » dans le menu du navigateur. Comme sur le réseau local, le mot de passe administrateur est demandé une seule fois par appareil.
4. **Déconnecter** : le bouton en bas de la carte déconnecte le serveur du compte, après confirmation. L’adresse privée disparaît.

La carte liste aussi les appareils du réseau privé, en ligne ou non.

Si l’interrupteur reste grisé, les certificats HTTPS ne sont pas permis sur votre réseau privé : dans la console Tailscale, page **DNS**, activez **MagicDNS** puis **HTTPS Certificates**.

## Ce qui reste fermé

- Rien n’est ouvert sur la box : Tailscale relie les appareils entre eux, sans redirection de port.
- Cornelius est publié avec `serve` (réseau privé), jamais avec `funnel` (Internet).
- Un téléphone retiré de votre compte Tailscale ne voit plus Cornelius. Pour retirer aussi son autorisation, utilisez **Retirer les autorisations** dans la carte **Accès depuis le réseau local**.

## Installation : le Tailscale voisin

Cornelius ne contient pas Tailscale : il pilote un `tailscaled` voisin par son interface locale (un socket Unix partagé). Sans ce voisin, la carte n’apparaît pas.

Avec Docker Compose, ajoutez un service à côté de Cornelius :

```yaml
services:
  cornelius:
    # … votre service Cornelius habituel …
    environment:
      - CORNELIUS_TAILSCALE_SOCKET=/var/run/tailscale/tailscaled.sock
      - CORNELIUS_TAILSCALE_TARGET=https+insecure://cornelius-serveur:3443
    volumes:
      - ./tailscale/run:/var/run/tailscale
    networks:
      default:
        aliases:
          - cornelius-serveur

  tailscale:
    image: tailscale/tailscale:v1.104.4
    # Le nom de l’appareil dans votre compte Tailscale, et la première partie de l’adresse.
    hostname: cornelius
    restart: unless-stopped
    volumes:
      - ./tailscale/state:/var/lib/tailscale
      - ./tailscale/run:/var/run/tailscale
    entrypoint:
      - tailscaled
      - --state=/var/lib/tailscale/tailscaled.state
      - --socket=/var/run/tailscale/tailscaled.sock
      - --tun=userspace-networking
```

- **Aucune clé à saisir** : le voisin démarre vierge, et c’est l’administration de Cornelius qui le relie au compte.
- **Réseau en espace utilisateur** (`--tun=userspace-networking`) : aucun privilège ni périphérique, et pas de conflit avec un autre Tailscale déjà installé sur la machine.
- **Le nom d’hôte du conteneur Tailscale ne doit pas être celui du service Cornelius.** Sinon, Tailscale se trouve lui-même en cherchant Cornelius, et le téléphone reçoit une erreur 502. D’où l’alias `cornelius-serveur` ci-dessus.
- Le démon est lancé directement, sans le script de démarrage de l’image : celui-ci n’accorde qu’une minute pour se connecter, puis redémarre et invalide le lien.

Le nom privé de Cornelius est accepté automatiquement : inutile de l’ajouter à `CORNELIUS_ALLOWED_HOSTS`.

## Voir aussi

- [Accès depuis le réseau local](../utilisation/reseau-local.md)
- [Configuration](../reference/configuration.md) : `CORNELIUS_TAILSCALE_SOCKET`, `CORNELIUS_TAILSCALE_TARGET`
