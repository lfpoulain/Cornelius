# Module Météo

Le module Météo donne les prévisions quotidiennes d’une commune française, fournies par Météo Concept. Météo Concept couvre la France seulement : ailleurs, installez plutôt Météo libre (Open-Meteo, sans jeton) depuis **Installer des modules** (voir [Installer des modules](../../docs/modules/README.md#installer-des-modules)). Cette fiche s’adresse à la personne qui règle le miroir et à celle qui lit le code du module (identifiant `weather`).

## Ce que fait le module

- Il répond à « quel temps fait-il ? » ou « et demain ? » et affiche une carte « Météo » : températures minimale et maximale du jour, temps prévu, puis une ligne par jour suivant (cinq au plus).
- Il cite le risque de pluie à l’oral quand il atteint 40 %.
- Une prévision reste en cache 30 minutes.

## Jeton requis

Le module a besoin d’un jeton Météo Concept (gratuit), à demander sur https://api.meteo-concept.com/. Collez-le dans la carte du module, dans l’administration : il compte tout de suite. Ou ajoutez-le dans le fichier `.env` puis redémarrez Cornelius :

```ini
CORNELIUS_METEO_CONCEPT_TOKEN=votre-jeton
```

Tant qu’il manque, la carte du module affiche « Jeton manquant » et le bouton « Ajouter une source » reste grisé.

## Réglages d’une source

Dans **Modules → Météo → Ajouter une source** :

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| Code INSEE | Code de la commune à 5 chiffres (Paris : 75056 ; Corse : 2A… ou 2B…) | vide |
| Latitude, Longitude | À utiliser à la place du code INSEE | vide |
| Jours de prévision | De 1 à 7 jours | 3 |

Il faut un code INSEE, ou bien la latitude et la longitude. Si les deux sont donnés, le code INSEE est utilisé.

## Limites

- Le code INSEE désigne une commune française : hors de France, aucune commune n’est trouvée. La carte « Météo » de l’administration le rappelle et renvoie vers Météo libre (Open-Meteo, sans jeton), dans **Installer des modules**. Le nom de la commune affiché vient du fournisseur.
- Le fournisseur renvoie plus de jours que nécessaire : le module garde de 1 à 7 jours selon le réglage.
- Un jeton refusé, un quota dépassé ou un service indisponible donnent une erreur claire. Après un premier succès, la dernière prévision reste affichée comme « dernier relevé connu ».

## Outil vocal et affichage permanent

L’outil s’appelle `weather__read`. Avec « Afficher en permanence sur le miroir », le miroir montre les températures du jour, la commune et le temps prévu. À minuit (heure du foyer), il passe aux prévisions du lendemain sans attendre une nouvelle collecte : un relevé de la veille ne montre jamais une journée passée.

## Voir aussi

- [Les modules](../../docs/modules/README.md)
- [Configuration](../../docs/reference/configuration.md)
- [Référence du contrat des modules](../../docs/modules/reference.md)
- Code : [index.ts](index.ts), [config.schema.json](config.schema.json)
