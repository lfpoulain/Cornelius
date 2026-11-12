# Les modules

Les modules apportent à Cornelius des informations (l’heure, la météo, les prochains passages) et des commandes (ouvrir le portail, lancer une scène). Cette page explique comment les installer et les régler dans l’administration. Elle s’adresse à la personne qui prépare le miroir pour le foyer.

Les modules viennent de deux endroits :

| | Où | Mis à jour |
| --- | --- | --- |
| **Modules livrés** : Heure, Météo, Transports, Ragator | `addons/`, dans Cornelius | avec Cornelius |
| **Modules installés** : Vacances et jours fériés, Vélos… | le dépôt officiel [cornelius-modules](https://github.com/lfpoulain/cornelius-modules) ou un autre dépôt, depuis **Installer des modules** | depuis la même rubrique (voir [Installer des modules](#installer-des-modules)) |
| **Dossier local** (développement) | un dépôt de modules cloné à côté de Cornelius | à part, par `git pull` (voir [Dossier local](#dossier-local)) |

Pour écrire un module, tout se passe dans [cornelius-modules](https://github.com/lfpoulain/cornelius-modules) : [tutoriel](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md), gabarit et commandes de test. Les règles du contrat sont dans la [référence](reference.md), ici, car elles décrivent le code de Cornelius.

## Les notions

- Un **module** est une capacité installée avec Cornelius. Dans le code, on l’appelle « addon » ; c’est le même objet.
- Une **source** est un réglage d’un module pour un usage précis : « Météo à la maison », « Bus pour le travail ». Un module peut avoir plusieurs sources.
- Chaque source a un **propriétaire** : le foyer ou une personne.
- Quand Cornelius lit une source, il affiche une **carte** sur le miroir et dit l’essentiel à voix haute. Trois cartes au plus restent visibles.

Tout se règle dans **Modules**, qui a deux onglets : **Informations** et **Commandes**.

## Le catalogue

La rubrique **Modules** range les modules en trois groupes.

| Groupe | Module | Ce qu’il fait | Détails |
| --- | --- | --- | --- |
| Au quotidien | Heure | Heure et date dans un fuseau horaire | [Fiche Heure](../../addons/clock/README.md) |
| Au quotidien | Météo | Prévisions d’une commune (jeton Météo Concept) | [Fiche Météo](../../addons/weather/README.md) |
| Au quotidien | Transports | Prochains passages en Île-de-France (jeton PRIM) | [Fiche Transports](../../addons/transit/README.md) |
| Au quotidien | Ragator | Réponses citées tirées des vidéos des Frères Poulain (serveur Ragator) | [Fiche Ragator](../../addons/ragator/README.md) |
| Maison | Home Assistant | Appareils et capteurs de la maison | [Home Assistant](../fonctionnalites/home-assistant.md) |
| Maison | Commandes HTTP | Les commandes HTTP, à créer, tester et valider dans le module lui-même | [plus bas](#les-commandes-http) |
| Capacités de Cornelius | Cartes | Nombre de cartes à l’écran, durée d’affichage, cartes raccourcies au second plan | [Le miroir](../utilisation/miroir.md) |
| Capacités de Cornelius | Web | Recherche sur Internet | [L’administration](../utilisation/administration.md#modules) |
| Capacités de Cornelius | Vision | Description de ce que voit la caméra, calculée sur place | [La vision locale](../fonctionnalites/vision-locale.md) |
| Capacités de Cornelius | Génération d’image | Images créées sur cet ordinateur ou avec OpenAI | [La génération d’images](../fonctionnalites/generation-d-images.md) |

Heure, Météo, Transports, Ragator et les modules externes reçoivent des sources. Les autres se règlent une fois pour tout le miroir.

Un module externe se présente comme un module livré : son nom, son icône, sa description et son groupe (« Au quotidien » ou « Maison ») viennent de lui. Sous chaque source, un aperçu reprend son dernier relevé (« 20 vélos · Mairie - Opéra »).

En haut de l’onglet, « Sources de » montre les sources de tout le monde, du foyer ou d’une personne. « Rechercher un module ou une source » filtre la liste. Une étoile place un module en tête de son groupe, dans ce navigateur.

Un module installé mais refusé au démarrage apparaît en bas, sous « Module non chargé », avec la raison.

### Installer des modules

La rubrique **Installer des modules** (groupe « Ce qu’il sait faire ») liste des dépôts git de modules. Le dépôt officiel [cornelius-modules](https://github.com/lfpoulain/cornelius-modules) y est toujours ; son catalogue est téléchargé au premier clic sur **Vérifier ce dépôt** (ou dès la première ouverture si `CORNELIUS_UPDATE_CHECK=1`).

- **Installer** ajoute un module ; **Désinstaller** le retire. Ses sources sont gardées : une réinstallation les retrouve telles quelles.
- **Vérifier ce dépôt** ou **Rechercher des mises à jour** cherche un commit plus récent. Avec `CORNELIUS_UPDATE_CHECK=1`, Cornelius le fait aussi seul une fois par jour ; par défaut, il attend un clic. Une mise à jour prête affiche le nombre de modules modifiés ou nouveaux, et la version suivante à côté de chaque module ; **Mettre à jour le dépôt** l’applique. Un dépôt dont aucun module n’est installé avance sans rien demander.
- **Ajouter un dépôt** prend l’adresse https d’un dépôt public (GitHub, GitLab, Gitea, Forgejo, Codeberg), et une branche si ce n’est pas celle par défaut. Le dépôt doit suivre la forme de cornelius-modules : un dossier par module, avec son `index.ts`. **Retirer le dépôt** désinstalle aussi ses modules ; le dépôt officiel ne se retire pas.

Installer, désinstaller ou mettre à jour prend effet au **redémarrage** : un bandeau le rappelle en haut de la rubrique, avec le bouton **Redémarrer Cornelius**. Un module en attente porte « Actif après redémarrage », ou « 1.0.0 en service, 1.1.0 au redémarrage ».

Ce qu’il faut savoir :

- Le catalogue est lu dans les fichiers du dépôt (titre et version de chaque module), sans exécuter son code. Le code d’un module ne s’exécute qu’une fois installé, **avec les mêmes droits que Cornelius** : il peut lire vos réglages et vos clés. N’ajoutez que des dépôts dont vous connaissez l’auteur.
- Un module ne s’installe pas s’il porte l’identifiant d’un module livré avec Cornelius ou d’un module déjà installé depuis un autre dépôt, ni s’il demande une version de Cornelius plus récente que celle installée. Une mise à jour de dépôt est refusée pour la même raison : mettez d’abord Cornelius à jour (rubrique **État du système**).
- Les dépôts sont copiés, à un commit précis, dans `data/modules/` (`CORNELIUS_MANAGED_MODULES_DIR` pour un autre dossier). Le dépôt entier est gardé, car ses modules partagent du code (`_lib/`). git n’est pas nécessaire : Cornelius lit le dépôt en HTTPS. Les dépôts privés ne sont pas pris.

### Dossier local

Pour écrire ou essayer des modules, un dépôt de modules peut aussi être cloné **à côté** du dossier de Cornelius (ou dans le dossier de `CORNELIUS_MODULES_DIR`). Tous ses modules sont chargés tels quels, et se mettent à jour par git, hors de l’administration. Depuis le dossier de Cornelius :

```bash
git clone https://github.com/lfpoulain/cornelius-modules.git ../cornelius-modules
```

```bash
git -C ../cornelius-modules pull
```

Redémarrez ensuite Cornelius : les modules ne sont lus qu’au démarrage. Un module du dossier local est refusé, avec la raison sous « Module non chargé », s’il porte l’identifiant d’un module livré avec Cornelius ou s’il demande une version de Cornelius plus récente que celle installée. Un module installé depuis **Installer des modules** remplace celui du même nom du dossier local.

## Ajouter une source

1. Dans le module, cliquez sur **Ajouter une source**.
2. Remplissez les réglages propres au module (voir sa fiche). Une étoile signale un champ obligatoire. Selon le module, un réglage peut être :
   - une liste déroulante (une zone scolaire, un carburant), avec « Aucun » ou « Tous » s’il est facultatif ;
   - une liste à compléter, une ligne par élément (un bac et ses jours de ramassage, par exemple) : **Ajouter** ajoute une ligne, la corbeille la retire. Une erreur s’affiche sous la case concernée.
3. Donnez un **Nom affiché**, par exemple « Heure de Paris ». Sous le champ, l’administration indique la phrase à prononcer : « Pour l’obtenir à la voix, dites : « l’heure de Paris ». »
4. Si besoin, ouvrez **Options** :
   - **Identifiant** : le mot court qui désigne la source à la voix. Laissé vide, il est déduit du nom : accents retirés, minuscules, tirets à la place des espaces (« Heure de Paris » donne `heure-de-paris`). S’il est déjà pris pour ce module, un suffixe est ajouté (`maison-2`). Deux sources du même propriétaire ne peuvent pas avoir le même identifiant ;
   - **Propriétaire** : « Le foyer » ou une personne ;
   - **État** : « Activée » ou « Désactivée ».
5. Cliquez sur **Ajouter**.

Chaque source affiche ensuite son état (« À jour », « Dernier relevé », « Pas encore de données ») et trois boutons :

- **Tester** interroge tout de suite le fournisseur, sans utiliser le cache. Le résultat s’affiche sous la source (« Réponse À jour · … » ou « Échec. … ») ;
- **Configurer** rouvre le formulaire ;
- **Supprimer** retire la source et son dernier relevé.

Le badge du module résume la situation : « Prêt », « À configurer », « Désactivé », « 1 source · à corriger » ou « Jeton manquant ».

## Les jetons des fournisseurs

Certains modules ont besoin d’un jeton personnel, obtenu gratuitement chez le fournisseur.

| Module | Variable du fichier `.env` |
| --- | --- |
| Météo | `CORNELIUS_METEO_CONCEPT_TOKEN` |
| Transports | `CORNELIUS_PRIM_API_KEY` |

Tant qu’un jeton manque, la carte du module dit « Ce module a besoin d’un jeton… », donne le lien d’inscription et grise « Ajouter une source ». Collez le jeton dans le champ de cette carte (ou dans **Clés et accès → Clés et jetons**) : il compte tout de suite. Vous pouvez aussi l’écrire dans le fichier `.env`, puis redémarrer :

```ini
CORNELIUS_METEO_CONCEPT_TOKEN=votre-jeton
CORNELIUS_PRIM_API_KEY=votre-jeton
```

```sh
systemctl --user restart cornelius        # avec les services systemd
scripts/restart.sh                        # sans systemd
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\restart.ps1
```

Les jetons restent dans `.env`. Ils ne sont jamais enregistrés dans la base ni écrits dans le journal, et l’administration voit seulement s’ils sont présents.

## Le foyer ou une personne

- Une source **du foyer** sert à tout le monde.
- Une source **personnelle** ne sert qu’à sa propriétaire, quand la caméra la reconnaît. Les sources des autres personnes ne sont jamais utilisées.

Quand on demande « la météo », Cornelius choisit la source ainsi :

- une seule source possible : il l’utilise ;
- plusieurs : il prend celle de la personne reconnue si elle en a une seule ;
- sinon, il demande laquelle. Prononcer la phrase de la source (« la météo de maison ») lève le doute.

Une source désactivée n’est jamais utilisée.

## L’affichage permanent

Heure, Météo, Transports et la plupart des modules externes peuvent rester affichés sur le miroir, sans rien demander. Dans la source, activez **Afficher en permanence sur le miroir** (désactivé par défaut). La source porte alors le badge « Affichage permanent ».

Ce qui s’affiche, et quand :

- les sources du foyer s’affichent dès qu’une présence est confirmée devant le miroir ;
- une source personnelle s’affiche quand sa propriétaire est reconnue ;
- quatre sources au plus sont visibles, sur le fond noir, à part des cartes de conversation ;
- ni le micro, ni une conversation, ni OpenAI ne sont nécessaires. Finir une conversation en restant devant le miroir garde l’affichage.

Ce qui le retire :

- le départ confirmé de la personne, la perte de sa reconnaissance, une panne de la caméra ou la fermeture de la page du miroir ;
- le mode vie privée, dès que plusieurs personnes sont présentes : toute la zone est masquée.

Les données se renouvellent seules, à la fin de leur durée de validité, tant que la source est visible. Ce qui dépend de l’heure suit l’heure sans attendre : l’horloge change à chaque minute, le compte à rebours des bus aussi, la météo passe au jour suivant à minuit, « Ce soir » apparaît à 17 h pour les poubelles. Les heures sont celles du foyer (`CORNELIUS_TIMEZONE`, Europe/Paris par défaut). Personne devant le miroir : aucune collecte. En cas de souci, le miroir indique « Actualisation… », « Aucune donnée disponible », « Source indisponible » ou « Dernière donnée connue » avec son ancienneté. Après une panne, les nouvelles tentatives s’espacent : 30 secondes, puis 1, 2 et 4 minutes, enfin 5 minutes au plus.

## Les commandes HTTP

Une commande appelle une adresse que vous enregistrez : la page d’une box domotique, un portail, un service maison. Cornelius la déclenche à la voix par son nom ; il ne choisit jamais l’adresse lui-même.

Dans **Modules**, ouvrez le module **Commandes HTTP**, puis cliquez sur **Nouvelle commande** :

| Réglage | Rôle |
| --- | --- |
| Nom affiché | Le nom de la commande, par exemple « Ouvrir le portail » |
| Identifiant | Le mot court qui la désigne à la voix (minuscules, chiffres et tirets) |
| Description (lue par Cornelius) | Quand l’utiliser, en une phrase de 200 caractères au plus |
| Adresse (http ou https) | L’adresse appelée |
| Propriétaire | Le foyer ou une personne |
| Confirmation | « Demander votre accord » (par défaut) ou « Sans accord » |
| État | Activée ou désactivée |
| Options avancées | « Méthode » (GET par défaut, ou POST), « En-têtes » et, en POST, « Corps de la requête » |

**Tester** envoie la requête une fois, sans l’inscrire dans les exécutions, et dit si la destination répond. Une adresse qui redirige ailleurs est refusée.

### La validation

Avec « Demander votre accord », Cornelius ne lance rien seul. Il annonce que la commande attend votre accord, et la demande apparaît dans **Modules → Commandes HTTP → Commandes à valider**, avec **Valider** et **Refuser**. Une demande expire au bout de deux minutes. Une fois la demande validée, Cornelius relance la commande.

L’administration ne s’ouvre que sur l’ordinateur du miroir : une commande sensible se valide donc sur place. Voir [L’administration](../utilisation/administration.md).

### Les secrets

Un mot de passe ou un jeton ne s’écrit pas en clair dans une commande. Dans un en-tête ou dans le corps, écrivez `${secret:NOM}`, puis ajoutez la variable `CORNELIUS_SECRET_NOM` dans le fichier `.env` et redémarrez. Par exemple, l’en-tête `Authorization` vaut `Bearer ${secret:PORTAIL_TOKEN}` et le fichier `.env` contient :

```ini
CORNELIUS_SECRET_PORTAIL_TOKEN=valeur-du-jeton
```

Le secret n’est jamais enregistré dans la base. Tant qu’il manque, la commande affiche « Un secret manque : ajoutez … » et ne part pas.

### Le journal des exécutions

**Dernières exécutions** liste ce que Cornelius a réellement déclenché, du plus récent au plus ancien, avec le résultat : « réussie », « échouée » ou « incertaine ». Une commande est incertaine quand la réponse s’est perdue ou que la destination a renvoyé une erreur serveur : elle a peut-être eu lieu. Cornelius ne la répète jamais de lui-même.

## Voir aussi

- [Référence du contrat des modules](reference.md)
- [cornelius-modules](https://github.com/lfpoulain/cornelius-modules) : modules externes, [tutoriel](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md) et gabarit
- [L’administration](../utilisation/administration.md)
- [Le miroir](../utilisation/miroir.md)
- [Home Assistant](../fonctionnalites/home-assistant.md)
- [Configuration](../reference/configuration.md)
- [Confidentialité](../reference/confidentialite.md)
