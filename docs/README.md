# Documentation de Cornelius

Cette page est l’index de la documentation. Elle indique par où commencer, puis donne une ligne par page, rangées par thème. Pour une présentation rapide du projet, voir le [README](../README.md) à la racine du dépôt.

## Par où commencer

1. Installer Cornelius : [sous Linux](installation/linux.md) ou [sous Windows](installation/windows.md).
2. Suivre le [premier démarrage](installation/premier-demarrage.md), de la connexion à la première conversation.
3. En cas de souci, ouvrir le [dépannage](utilisation/depannage.md).

## Je veux…

| Je veux… | Page |
|---|---|
| installer Cornelius | [Linux](installation/linux.md), [Raspberry Pi](installation/raspberry-pi.md), [Windows](installation/windows.md), [Home Assistant](installation/home-assistant.md), puis [carte graphique](installation/gpu.md) si besoin |
| réussir le premier lancement | [Premier démarrage](installation/premier-demarrage.md) |
| choisir ce qui ouvre la conversation | [Ouverture et présence](fonctionnalites/ouverture-et-presence.md), [Mot d’appel](fonctionnalites/mot-d-appel.md) |
| parler à Cornelius depuis une autre pièce | [Les satellites audio](fonctionnalites/satellites.md) |
| utiliser mon téléphone comme satellite | [Le satellite Android](fonctionnalites/satellite-android.md) |
| ajouter la météo, les transports ou une commande | [Les modules](modules/README.md) |
| recevoir une image du miroir sur mon téléphone | [L’envoi par e-mail](fonctionnalites/envoi-par-e-mail.md) |
| régler un réveil, un minuteur ou un rappel | [Les alarmes et les rappels](fonctionnalites/alarmes-et-rappels.md) |
| écrire mon propre module | [Créer un module](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md), dans le dépôt cornelius-modules |
| comprendre pourquoi rien ne se passe | [Dépannage](utilisation/depannage.md) |
| converser avec Mistral plutôt qu’OpenAI | [Le fournisseur vocal](fonctionnalites/fournisseur-vocal.md) |
| savoir ce qui part sur Internet | [Confidentialité](reference/confidentialite.md) |
| modifier le code | [Développer Cornelius](developpement/README.md), [Contribuer](../CONTRIBUTING.md) |

## Installation

- [Installer sous Linux](installation/linux.md) : le script d’installation, les services systemd, les mises à jour.
- [Installer sur Raspberry Pi](installation/raspberry-pi.md) : Raspberry Pi 4 et 5, ce qui est retiré (vision locale, images locales), le miroir au démarrage.
- [Installer sous Windows](installation/windows.md) : l’installation manuelle dans PowerShell, le démarrage et l’arrêt.
- [Installer dans Home Assistant](installation/home-assistant.md) : l’add-on depuis la boutique, le miroir sur un autre appareil, les satellites, les données et les sauvegardes.
- [Premier démarrage](installation/premier-demarrage.md) : la rubrique « Mise en route », étape par étape.
- [Carte graphique (GPU)](installation/gpu.md) : quel matériel convient à la vision et aux images, et comment l’installer.

## Utilisation

- [Le miroir](utilisation/miroir.md) : ce qu’on voit à l’écran, l’écran de veille, activer la voix, parler à Cornelius.
- [L’administration](utilisation/administration.md) : chaque rubrique, dans l’ordre de la barre latérale.
- [Accès depuis le réseau local](utilisation/reseau-local.md) : ouvrir le miroir et l’administration depuis un autre appareil, le certificat, le pare-feu.
- [Dépannage](utilisation/depannage.md) : symptômes courants, journal, mesure de la latence, demander de l’aide.

## Fonctionnalités

- [Ouverture et présence](fonctionnalites/ouverture-et-presence.md) : ce qui ouvre, fait durer et ferme une conversation.
- [Le mot d’appel](fonctionnalites/mot-d-appel.md) : ouvrir la conversation en disant « Cornelius ».
- [Les satellites audio](fonctionnalites/satellites.md) : un micro et un haut-parleur dans une autre pièce, installés et associés sans saisie.
- [Le satellite Android](fonctionnalites/satellite-android.md) : un téléphone comme satellite vocal, y compris hors du réseau local.
- [La personnalité](fonctionnalites/personnalite.md) : le caractère de Cornelius et les repères de chaque personne.
- [La mémoire](fonctionnalites/memoire.md) : ce que Cornelius retient et comment le gérer.
- [La vision locale](fonctionnalites/vision-locale.md) : décrire ce qui se trouve devant le miroir, sans envoyer d’image.
- [La génération d’images](fonctionnalites/generation-d-images.md) : dessiner une image à la voix, sur l’ordinateur.
- [L’envoi par e-mail](fonctionnalites/envoi-par-e-mail.md) : envoyer une image ou un message sur le téléphone d’une personne du foyer.
- [Les alarmes et les rappels](fonctionnalites/alarmes-et-rappels.md) : réveils, minuteurs et pense-bêtes, qui sonnent sur le miroir et sont dits à la bonne personne.
- [Home Assistant](fonctionnalites/home-assistant.md) : lumières, prises et capteurs de la maison.
- [Les agents Hermes](fonctionnalites/agents-hermes.md) : confier des demandes longues à un agent personnel.
- [Le fournisseur vocal](fonctionnalites/fournisseur-vocal.md) : converser avec OpenAI (par défaut) ou Mistral, coût et limites.

## Modules

- [Les modules](modules/README.md) : sources d’informations, affichage permanent, modules externes, commandes HTTP.
- [Référence du contrat des modules](modules/reference.md) : les règles complètes, pour les développeurs.
- Fiches des modules livrés : [Heure](../addons/clock/README.md), [Météo](../addons/weather/README.md), [Transports](../addons/transit/README.md), [Ragator](../addons/ragator/README.md).
- [cornelius-modules](https://github.com/lfpoulain/cornelius-modules) : le dépôt des modules externes, avec le [tutoriel](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md) et le [gabarit](https://github.com/lfpoulain/cornelius-modules/tree/main/_template) d’un nouveau module.

## Développement

- [Développer Cornelius](developpement/README.md) : environnement, scripts, organisation du dépôt, conventions.
- [Architecture](developpement/architecture.md) : comment les parties du système fonctionnent ensemble.
- [Tests et recette](developpement/tests-et-recette.md) : tests automatiques et vérification sur le miroir réel.
- [Le protocole des satellites](developpement/satellites-protocole.md) : le dialogue entre Cornelius et un satellite audio, pour écrire ou modifier son firmware.
- [Les prompts](developpement/prompts.md) : où vivent les consignes données aux modèles.
- [Feuille de route](developpement/feuille-de-route.md) : ce qui reste à valider et à construire.
- [Contribuer](../CONTRIBUTING.md) : proposer une modification.
- [Historique des changements](../CHANGELOG.md).

## Référence

- [Configuration](reference/configuration.md) : variables du fichier `.env`, ports et dossiers.
- [Confidentialité](reference/confidentialite.md) : ce qui reste local, ce qui part chez OpenAI, ce qui est enregistré.
- [Licences](reference/licences.md) : code, ressources et modèles, et vérifications avant publication.
- [Glossaire](reference/glossaire.md) : les mots de Cornelius, de « carte » à « vie privée ».
- [wakeword-generator](https://github.com/lfpoulain/wakeword-generator) : le projet séparé qui a créé le modèle du mot « Cornelius ».

## Voir aussi

- [README du projet](../README.md)
- [Premier démarrage](installation/premier-demarrage.md)
- [Dépannage](utilisation/depannage.md)
