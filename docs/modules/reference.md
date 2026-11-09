# Référence du contrat des modules

Cette page fixe le contrat `apiVersion: 1` que doit respecter un module d’informations (un « addon » dans le code). Elle s’adresse aux développeurs et aux assistants de code qui écrivent ou relisent un module. Pour une première prise en main, suivez d’abord le [tutoriel](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md) du dépôt cornelius-modules.

Cette page vit avec le code qu’elle décrit : toute évolution du contrat la met à jour dans le même changement. Les modules, eux, s’écrivent à deux endroits, avec les mêmes règles :

| | Dossier | Quand |
| --- | --- | --- |
| Module externe | `<id>/` du dépôt [cornelius-modules](https://github.com/lfpoulain/cornelius-modules) | Par défaut : tout nouveau module |
| Module livré | `addons/<id>/` de Cornelius | Seulement pour un module indispensable au premier démarrage, mis à jour avec le cœur |

« DOIT » marque une règle du contrat, « DEVRAIT » une recommandation. En cas de doute, le code fait foi : [shared/addons.ts](../../shared/addons.ts) pour les types, [server/addons/registry.ts](../../server/addons/registry.ts) pour le chargement et [server/addons/runtime.ts](../../server/addons/runtime.ts) pour l’exécution.

## Choisir le mécanisme

| Besoin | Mécanisme |
| --- | --- |
| Lire une information : météo, horaires, disponibilités, agenda | Un module, décrit ici |
| Répondre à une question libre à partir d’un service | Un module avec un [outil à la demande](#loutil-à-la-demande) |
| Une lecture paramétrée par la voix (« samedi », « et le SP98 ? ») | Des [arguments typés](#les-arguments-typés) sur l’outil |
| Déclencher un effet : allumer une lampe, ouvrir un portail | Une [commande HTTP](README.md#les-commandes-http), réglée dans l’administration, sans code |
| Piloter les appareils de Home Assistant | L’intégration [Home Assistant](../fonctionnalites/home-assistant.md) |
| Confier une tâche longue à un agent personnel | Les [agents Hermes](../fonctionnalites/agents-hermes.md) |
| Afficher une information sans la demander | Le champ `ambient` d’un module, plus bas |
| Toucher à la caméra, au son ou à l’analyse d’image | Le cœur de Cornelius ; Vision et Génération d’image ne sont pas des modules de ce contrat |
| Envoyer une image ou un message à quelqu’un du foyer | Le module natif [E-mail](../fonctionnalites/envoi-par-e-mail.md), dans le cœur |
| Un réveil, un minuteur, un rappel | La fonction native [Alarmes et rappels](../fonctionnalites/alarmes-et-rappels.md), dans le cœur |
| Un nouveau type de carte, ou un outil qui agit | Une évolution du cœur, à concevoir à part |

## Vocabulaire

- **Module** : le code d’un dossier `addons/<id>/`, par exemple `weather`.
- **Source** (ou instance) : un réglage de ce module pour le foyer ou une personne, par exemple « Météo à la maison ». Les sources partagent le code, pas leurs réglages ni leur cache.
- **Relevé** (snapshot, type `ModuleSnapshot`) : l’enveloppe datée des données collectées. Elle appartient au cœur.
- **Présentation** : le texte structuré que le module produit à partir d’un relevé. Le cœur en fait la carte et le résultat de l’outil vocal.

## Responsabilités

| Le module fournit | Le cœur s’occupe de |
| --- | --- |
| Les schémas des réglages et des données | Créer les sources, leur propriétaire, leur activation |
| `collect` : lire, vérifier, normaliser | Le client HTTP, les secrets, l’horloge, l’annulation |
| Les données, la source et, s’il la connaît, la date d’observation | Le relevé, ses dates, sa révision, sa persistance |
| `present` (et `ambient.present`) : les faits de la carte et de l’oral | Le cache, le regroupement des lectures, le repli sur le dernier succès |
| La description de l’outil vocal et la recherche assistée | La liste des sources autorisées, la session, l’affichage |

Parcours d’une demande : question vocale, outil `<id>__read`, choix de la source autorisée, relevé frais en cache ou `collect`, `present`, puis carte et réponse. Aucune donnée d’un module n’est donnée au modèle à l’ouverture de la conversation.

Un module NE DOIT PAS accéder à SQLite, choisir un propriétaire, construire lui-même un relevé, afficher une carte ou piloter la session. Il NE DOIT PAS faire d’appel réseau au chargement, lancer sa propre boucle de collecte, ni garder des données de source dans une variable globale modifiable.

Un module s’exécute dans le processus du serveur : **ce contrat n’est pas un bac à sable**. Installer un module, c’est installer du code de confiance.

## La définition `AddonDefinition`

Le fichier `index.ts` DOIT exporter par défaut un objet `AddonDefinition<TConfig, TData>`.

| Champ | Règle |
| --- | --- |
| `id` | DOIT être égal au nom du dossier et suivre `^[a-z][a-z0-9_]{0,31}# Référence du contrat des modules

Cette page fixe le contrat `apiVersion: 1` que doit respecter un module d’informations (un « addon » dans le code). Elle s’adresse aux développeurs et aux assistants de code qui écrivent ou relisent un module. Pour une première prise en main, suivez d’abord le [tutoriel](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md) du dépôt cornelius-modules.

Cette page vit avec le code qu’elle décrit : toute évolution du contrat la met à jour dans le même changement. Les modules, eux, s’écrivent à deux endroits, avec les mêmes règles :

| | Dossier | Quand |
| --- | --- | --- |
| Module externe | `<id>/` du dépôt [cornelius-modules](https://github.com/lfpoulain/cornelius-modules) | Par défaut : tout nouveau module |
| Module livré | `addons/<id>/` de Cornelius | Seulement pour un module indispensable au premier démarrage, mis à jour avec le cœur |

« DOIT » marque une règle du contrat, « DEVRAIT » une recommandation. En cas de doute, le code fait foi : [shared/addons.ts](../../shared/addons.ts) pour les types, [server/addons/registry.ts](../../server/addons/registry.ts) pour le chargement et [server/addons/runtime.ts](../../server/addons/runtime.ts) pour l’exécution.

## Choisir le mécanisme

| Besoin | Mécanisme |
| --- | --- |
| Lire une information : météo, horaires, disponibilités, agenda | Un module, décrit ici |
| Répondre à une question libre à partir d’un service | Un module avec un [outil à la demande](#loutil-à-la-demande) |
| Une lecture paramétrée par la voix (« samedi », « et le SP98 ? ») | Des [arguments typés](#les-arguments-typés) sur l’outil |
| Déclencher un effet : allumer une lampe, ouvrir un portail | Une [commande HTTP](README.md#les-commandes-http), réglée dans l’administration, sans code |
| Piloter les appareils de Home Assistant | L’intégration [Home Assistant](../fonctionnalites/home-assistant.md) |
| Confier une tâche longue à un agent personnel | Les [agents Hermes](../fonctionnalites/agents-hermes.md) |
| Afficher une information sans la demander | Le champ `ambient` d’un module, plus bas |
| Toucher à la caméra, au son ou à l’analyse d’image | Le cœur de Cornelius ; Vision et Génération d’image ne sont pas des modules de ce contrat |
| Un nouveau type de carte, ou un outil qui agit | Une évolution du cœur, à concevoir à part |

## Vocabulaire

- **Module** : le code d’un dossier `addons/<id>/`, par exemple `weather`.
- **Source** (ou instance) : un réglage de ce module pour le foyer ou une personne, par exemple « Météo à la maison ». Les sources partagent le code, pas leurs réglages ni leur cache.
- **Relevé** (snapshot, type `ModuleSnapshot`) : l’enveloppe datée des données collectées. Elle appartient au cœur.
- **Présentation** : le texte structuré que le module produit à partir d’un relevé. Le cœur en fait la carte et le résultat de l’outil vocal.

## Responsabilités

| Le module fournit | Le cœur s’occupe de |
| --- | --- |
| Les schémas des réglages et des données | Créer les sources, leur propriétaire, leur activation |
| `collect` : lire, vérifier, normaliser | Le client HTTP, les secrets, l’horloge, l’annulation |
| Les données, la source et, s’il la connaît, la date d’observation | Le relevé, ses dates, sa révision, sa persistance |
| `present` (et `ambient.present`) : les faits de la carte et de l’oral | Le cache, le regroupement des lectures, le repli sur le dernier succès |
| La description de l’outil vocal et la recherche assistée | La liste des sources autorisées, la session, l’affichage |

Parcours d’une demande : question vocale, outil `<id>__read`, choix de la source autorisée, relevé frais en cache ou `collect`, `present`, puis carte et réponse. Aucune donnée d’un module n’est donnée au modèle à l’ouverture de la conversation.

Un module NE DOIT PAS accéder à SQLite, choisir un propriétaire, construire lui-même un relevé, afficher une carte ou piloter la session. Il NE DOIT PAS faire d’appel réseau au chargement, lancer sa propre boucle de collecte, ni garder des données de source dans une variable globale modifiable.

Un module s’exécute dans le processus du serveur : **ce contrat n’est pas un bac à sable**. Installer un module, c’est installer du code de confiance.

## La définition `AddonDefinition`

Le fichier `index.ts` DOIT exporter par défaut un objet `AddonDefinition<TConfig, TData>`.

| Champ | Règle |
| --- | --- |
 ; les préfixes des outils du cœur (`agents`, `alarms`, `home_assistant`, `http`, `image`, `mail`, `memory`, `ui`, `vision`, `web`) sont réservés |
| `apiVersion` | DOIT valoir `1` |
| `version` | Version du code, chaîne libre (par exemple `1.0.0`) |
| `minCoreVersion` | Facultatif : version minimale de Cornelius, `x.y.z` ; un cœur plus ancien refuse le module |
| `sourceLabel` | Nom public du fournisseur, sans secret ; nom du module dans l’administration à défaut de `display` |
| `display` | Facultatif : nom, description, icône, groupe, mots-clés, exemple et phrase vocale dans l’administration (voir [La présentation dans l’administration](#la-présentation-dans-ladministration)) |
| `secrets` | Facultatif : jetons attendus dans `.env` (voir [Les secrets](#les-secrets)) |
| `configVersion` | Entier ≥ 1, à incrémenter quand les réglages changent de forme |
| `configSchema` | JSON Schema des réglages d’une source |
| `configDefaults` | Préremplissage du formulaire de création ; jamais fusionné avec une source existante |
| `configMigrate` | Facultatif : `(fromVersion, config: unknown) => TConfig` |
| `dataVersion` | Entier ≥ 1, à incrémenter quand les anciennes données ne sont plus lisibles |
| `dataSchema` | JSON Schema des données normalisées (pas de l’enveloppe du relevé) |
| `freshMs` | Durée de validité d’un succès, en millisecondes, entier > 0, ramenée par le cœur entre 5 secondes et 24 heures |
| `tools` | Liste des outils vocaux ; fournir au moins `read`, ou un [outil à la demande](#loutil-à-la-demande) (le chargeur accepte une liste vide, mais la voix ne pourrait alors pas lire la source). Un outil peut déclarer des [arguments typés](#les-arguments-typés) |
| `search` | Facultatif : recherche assistée dans le formulaire |
| `ambient` | Facultatif : `{ present(snapshot, context) }` pour l’affichage permanent |
| `collect` | `async (context) => AddonCollection<TData>` |
| `present` | `(snapshot, context) => AddonPresentation`, synchrone |

Les schémas suivent JSON Schema 2020-12, compilés par Ajv en mode strict avec les formats standards ([shared/validation.ts](../../shared/validation.ts)). Ils DEVRAIENT déclarer `type: "object"`, `additionalProperties: false`, `required`, des bornes numériques et des longueurs maximales. Une valeur absente DOIT être modélisée (`null`, champ facultatif, liste vide), jamais inventée.

Le module DOIT importer le contrat par les alias `#cornelius/addons` et `#cornelius/validation` (champ `imports` du `package.json`), toujours résolus vers le cœur qui le charge. Ses tests importent de même `#cornelius/testing` (voir [Tester un module](#tester-un-module)).

Le chargeur lit `addons/`, puis le dossier des modules externes (`cornelius-modules` cloné à côté de Cornelius, ou `CORNELIUS_MODULES_DIR`), **au démarrage seulement** : redémarrer après tout ajout ou toute modification. Dans le dossier externe, un sous-dossier sans `index.ts` est ignoré sans message, et un identifiant déjà pris par un module de `addons/` est refusé. Un dossier dont le nom ne suit pas le motif (`_template`, `mon-module`) est ignoré sans message. Un dossier sans `index.ts`, une définition incomplète, un schéma qui ne compile pas ou un `id` différent du dossier sont refusés : la raison s’affiche dans **Modules** sous « Module non chargé » et dans le journal, et les autres modules se chargent normalement. Le chargeur ne vérifie ni les valeurs par défaut, ni la collecte, ni les longueurs de carte : les tests du module DOIVENT le faire.

## Le formulaire des réglages

L’administration construit le formulaire d’une source à partir de `configSchema`, propriété par propriété, dans l’ordre du schéma ; les interrupteurs viennent après les autres champs.

| Dans le schéma | Dans le formulaire |
| --- | --- |
| `title`, `description`, `examples[0]` | Libellé, texte d’aide, exemple dans le champ (« ex. demo ») |
| `type: "string"`, `"integer"`, `"number"` | Champ de texte ou de nombre ; un décimal se saisit avec la virgule |
| `type: "boolean"` | Interrupteur |
| Une propriété nommée `timeZone` | Liste des fuseaux horaires, par région |
| `enum` | Liste déroulante, valeurs affichées telles quelles |
| `oneOf: [{ const, title }]` | Liste déroulante avec un libellé par choix ; un `const: null` donne le choix « vide » (« Tous ») |
| Un type avec `"null"` | Champ facultatif ; une liste déroulante propose alors « Aucun », ou le `title` du choix `null` |
| `type: "array"` de textes ou de choix | Liste répétée : une ligne par élément, boutons **Ajouter** et **Retirer la ligne** |
| `type: "array"` d’objets simples (`items.properties`) | Liste répétée : une colonne par propriété de l’élément |
| `minItems`, `maxItems` | Bornes de la liste : retrait grisé au minimum, ajout grisé au maximum (20 par défaut) |
| `required`, `pattern`, `minimum`, `maximum`, `maxLength`, `minLength` | Contrôlés par le serveur à l’enregistrement ; chaque erreur s’affiche sous son champ, ou sous sa cellule dans une liste |

Il n’y a pas d’éditeur pour un objet hors d’une liste, ni pour une liste dans une liste : gardez des propriétés simples. Les champs remplis par la [recherche assistée](#la-recherche-assistée) sont masqués.

## La présentation dans l’administration

Avec `display`, facultatif, le module se présente lui-même dans **Modules**, comme les modules livrés. Sans lui, il prend son `sourceLabel`, l’icône de prise, le groupe « Au quotidien » et la phrase « la source de … ».

| Champ | Règle |
| --- | --- |
| `name` | Nom du module, 40 caractères au plus (« Météo ») |
| `description` | Ce qu’il apporte, une phrase de 160 caractères au plus |
| `icon` | Facultatif : un nom de la liste ci-dessous ; un autre nom refuse le module |
| `group` | Facultatif : `daily` (« Au quotidien », par défaut) ou `home` (« Maison », après Home Assistant et les commandes HTTP) |
| `keywords` | Facultatif : 20 mots de 40 caractères au plus, pour la recherche du catalogue |
| `example` | Facultatif : `{ label, ref }`, l’exemple proposé pour une nouvelle source (« Bus pour le travail », `travail`) |
| `spoken` | Facultatif : `{ head, repeats? }`. `head` commence la phrase vocale (« la météo ») ; les mots de `repeats` (minuscules sans accents) sont retirés de l’identifiant : `meteo-a-la-maison` donne « la météo de maison » |

Icônes proposées (noms [Lucide](https://lucide.dev/icons/)) : `bell`, `bike`, `book-open`, `bus`, `calendar`, `calendar-days`, `car`, `clapperboard`, `clock`, `cloud-sun`, `droplets`, `fuel`, `gift`, `graduation-cap`, `heart`, `history`, `house`, `leaf`, `map-pin`, `music`, `newspaper`, `package`, `party-popper`, `play`, `plug`, `scroll-text`, `shopping-cart`, `sun`, `thermometer`, `train-front`, `trash-2`, `tree-palm`, `tv`, `utensils`, `wind`, `zap`. La liste fait foi dans `addonIcons` ([shared/addons.ts](../../shared/addons.ts)).

L’aperçu d’une source sous son nom (« 20 vélos · Mairie - Opéra ») est calculé par le serveur : la valeur principale et le sous-titre de la carte du module, sur le dernier relevé, sans réseau.

## Les contextes

`collect(context)` reçoit :

| Valeur | Usage |
| --- | --- |
| `context.config` | Les réglages validés, après migration éventuelle : à utiliser pour la collecte |
| `context.instance` | La source (nom, propriétaire, identifiant) ; ne pas lire `instance.config`, qui n’est pas migré |
| `context.http.fetch(request)` | Le seul client réseau autorisé |
| `context.signal` | DOIT être transmis à chaque requête et respecté par tout travail long |
| `context.now()` | L’horloge en millisecondes, remplaçable en test ; à préférer à `Date.now()` |
| `context.secret(name)` | Un jeton déclaré et branché, ou `undefined` |
| `context.query` | La question d’un [outil à la demande](#loutil-à-la-demande), sinon `undefined` |
| `context.args` | Les [arguments typés](#les-arguments-typés) donnés par le modèle, déjà contrôlés ; absent pour une lecture ordinaire |
| `context.timeZone` | Le fuseau horaire du foyer (IANA, « Europe/Paris » par défaut, réglé par `CORNELIUS_TIMEZONE`) : « aujourd’hui », « ce soir » et les heures DOIVENT s’y calculer |

`present` et `ambient.present` reçoivent `{ instance, now(), timeZone }`. `search.find` reçoit `{ http, signal, secret, timeZone }`, sans source ni horloge.

## Le client HTTP

La requête accepte `url`, `method` (`GET` par défaut, ou `POST`), `headers`, `body` (une chaîne), `timeoutMs` (4 000 par défaut), `maxBytes` (256 Kio par défaut), `signal` et `cacheMs`. La réponse expose `status`, `headers`, `text()` et `json()`, tous deux **synchrones**, `truncated` et `url`. Il n’y a pas de propriété `ok`.

Le client du cœur ([server/addons/http.ts](../../server/addons/http.ts)) ne filtre pas les hôtes : le module DEVRAIT fixer l’adresse du fournisseur et encoder chaque partie variable (`encodeURIComponent`). Il garantit en revanche :

| Point | Règle |
| --- | --- |
| Redirections | Un GET suit trois redirections au plus, chaque adresse revalidée (http ou https, sans identifiants), jamais de https vers http. Seuls `Accept`, `Accept-Language` et `User-Agent` suivent un changement de domaine : un jeton n’est jamais renvoyé ailleurs. Un POST n’est jamais redirigé. `response.url` donne l’adresse finale |
| Encodage | Celui du `charset` de `Content-Type`, sinon celui que déclare un document XML (`<?xml … encoding="ISO-8859-1"?>`), sinon UTF-8 |
| Taille | Le corps est coupé à `maxBytes`, sans erreur : `response.truncated` vaut alors `true`, et le module DEVRAIT le dire (« agenda incomplet ») |
| User-Agent | `Cornelius/x.y.z (+https://github.com/lfpoulain/Cornelius)` si la requête n’en donne pas : certains services (Wikimedia) l’exigent |
| `cacheMs` | GET seulement, 10 minutes au plus : une réponse 200 est gardée en mémoire et **partagée entre sources et modules** pendant cette durée, et deux demandes identiques en vol n’en font qu’une. Pour un gros fichier commun (catalogue, état d’un réseau de vélos). La clé est l’adresse, les en-têtes et `maxBytes` ; 32 réponses et 16 Mo au plus |

Le client lève lui-même des `AddonCollectError` :

| Situation | Code |
| --- | --- |
| Adresse illisible, autre que http(s), ou avec identifiant et mot de passe | `invalid_params` |
| En-tête mal formé, corps sur un GET : rien n’est parti | `invalid_params` |
| Lecture annulée par `signal` | `unavailable` |
| Destination injoignable (nom inconnu, connexion refusée, certificat refusé) | `unavailable` |
| Délai `timeoutMs` dépassé | `timeout` |
| Connexion coupée en route | `upstream` |
| Plus de trois redirections, redirection d’un POST ou vers http | `upstream`, non relançable |

`json()` lève une `SyntaxError` ordinaire : le module DOIT l’intercepter et lever `malformed`.

## Les erreurs de collecte

En cas d’échec, `collect` DOIT lever `new AddonCollectError(code, message, retryable)`. Le message DOIT être compréhensible, de 1 à 300 caractères, sans jeton, adresse authentifiée ni corps brut du fournisseur : il est dit à l’oral et affiché dans l’administration, précédé du libellé du code (« Échec. Introuvable : Parking introuvable. » après **Tester**).

| Code | Cas habituel | Libellé dans l’administration |
| --- | --- | --- |
| `config_invalid` | Réglage ou jeton manquant | Réglage incomplet |
| `auth` | Jeton refusé | Identifiants refusés |
| `forbidden` | Accès interdit | Accès refusé |
| `not_found` | Ressource inconnue | Introuvable |
| `invalid_params` | Requête refusée | Requête invalide |
| `quota` | Quota du fournisseur atteint | Limite d’utilisation atteinte |
| `timeout` | Délai dépassé | Le service a mis trop de temps à répondre |
| `unavailable` | Fournisseur injoignable | Le service ne répond pas |
| `malformed` | Réponse illisible, champ manquant, date ou valeur incohérente | Réponse illisible |
| `upstream` | Autre erreur du fournisseur | Le service ne répond pas |

Les libellés viennent de [web/components/admin/format.ts](../../web/components/admin/format.ts).

Adaptez la correspondance aux statuts réels du fournisseur. `retryable` informe seulement : il ne programme aucune nouvelle tentative. Une autre exception est rapportée comme `upstream`, « Le module a rencontré une erreur inattendue. », et son texte va au journal (300 caractères au plus). Ne masquez jamais une panne par des données vides ou d’exemple.

`collect` renvoie `{ data, empty?, source?, observedAt?, freshMs?, cacheKey? }` :

- `data` DOIT respecter `dataSchema`, sinon la collecte échoue en `malformed` ;
- `empty: true` signale un succès **sans rien à signaler** : aucun passage cette nuit, rien de publié, une station sans prix. Le cœur appelle quand même `present` : si le module sait le dire (« Aucun passage prévu pour le moment »), sa carte et sa phrase sont utilisées, avec le statut d’outil `empty` ; s’il lève une exception, Cornelius dit « La source ne fournit aucune donnée utile pour le moment. ». Zéro place libre n’est pas vide, et une semaine sans rendez-vous DEVRAIT rester un succès ordinaire ;
- `source` `{ provider, sourceId }` (1 à 64 et 1 à 128 caractères) DEVRAIT accompagner chaque succès ;
- `observedAt` est la date du fournisseur en millisecondes ; à omettre plutôt qu’inventer ;
- `freshMs` remplace la valeur du module pour ce relevé (jusqu’à minuit, pour une donnée du jour) ;
- `cacheKey` est une simple étiquette : elle ne partage pas le cache entre sources.

## La carte et ses limites

`present` DOIT être synchrone, sans réseau, sans modèle de langage et sans effet de bord : mêmes données, même source et même heure donnent le même résultat. Il est appelé quand des données existent : relevé `ready`, repli sur le dernier succès (`status === 'stale'`) et relevé vide (`status === 'empty'`, voir plus haut), jamais pour une première erreur. Les jours et les heures DOIVENT se calculer dans `context.timeZone`.

| Champ | Limite |
| --- | --- |
| `title` | 1 à 80 caractères |
| `primaryValue` | `null` ou 1 à 120 caractères |
| `subtitle` | `null` ou 1 à 120 caractères |
| `description` | `null` ou 1 à 500 caractères |
| `items` | 5 lignes `{ label, value }` au plus ; 1 à 80 et 1 à 160 caractères |
| `sources` | Facultatif ; 3 chaînes distinctes au plus, de 1 à 128 caractères ; les modules fournis y mettent leur `id` |
| `summary` | 1 à 500 caractères : des faits courts à dire, pas une consigne au modèle |

Un champ vide vaut `null`, jamais `''`. Aucun HTML, code ou instruction : du texte et des faits. L’oral et la carte DOIVENT venir du même relevé. Un relevé `stale` DEVRAIT être annoncé comme « dernier relevé connu ».

Le cœur ajoute `schemaVersion`, `cardType`, `addonId`, `instanceRef`, `snapshotId` et `stale`, puis vérifie la carte. **En cas de refus** (champ trop long, trop de lignes, chaîne vide) ou si `present` lève une exception, l’outil échoue en `malformed` et Cornelius dit « Données reçues mais illisibles. ». Le journal note « Carte de module non conforme » avec les premières erreurs, ou « Présentation de carte impossible ». Le miroir garde trois cartes au plus.

## L’affichage permanent

`ambient.present(snapshot, context)` suit les mêmes règles que `present` et renvoie :

| Champ | Limite |
| --- | --- |
| `layout` | `'metric'` (une valeur en grand) ou `'list'` (des lignes) |
| `title` | 1 à 80 caractères |
| `value` | `null` ou 1 à 120 caractères |
| `subtitle` | `null` ou 1 à 120 caractères |
| `items` | 3 lignes `{ label, value }` au plus ; 1 à 80 et 1 à 160 caractères |
| `showCollectedAt` | Facultatif, vrai par défaut ; faux masque la date du relevé (utile pour un calcul local comme l’heure), sauf en repli |
| `refreshAt` | Facultatif : instant ISO 8601 où cette présentation cesse d’être juste sans nouvelle collecte |

Le cœur vérifie ce contenu ([schemas/ambient-presentation.schema.json](../../schemas/ambient-presentation.schema.json)). **En cas de refus** ou d’exception, la source s’affiche « Source indisponible ». Le cœur ajoute le nom de la source, son statut et sa date ; le miroir garde la typographie et en montre quatre au plus.

Sur le miroir ([web/components/AmbientModules.tsx](../../web/components/AmbientModules.tsx)), l’en-tête est le « Nom affiché » de la source, plus précis que le titre du module : `title` est obligatoire mais n’est pas affiché. Viennent ensuite `value`, `subtitle`, les lignes `items`, puis « Relevé » avec la date et l’heure de la collecte (sauf avec `showCollectedAt: false`). Un relevé en repli affiche à la place « Dernière donnée connue » et son ancienneté.

L’option « Afficher en permanence sur le miroir » n’est proposée que pour un module qui déclare `ambient`, et le serveur refuse de l’activer sinon. Le choix appartient à la source (désactivé par défaut), hors des réglages du module. Les règles de visibilité sont décrites dans [Les modules](README.md#laffichage-permanent).

Une présentation permanente est recalculée à chaque nouvelle collecte, et à l’instant `refreshAt` qu’elle donne, **sans réseau** : la minute suivante pour une horloge ou un compte à rebours, 17 h pour « ce soir, on sort les poubelles », la fin d’un rendez-vous, minuit pour « demain ». Sans `refreshAt`, un texte qui dépend de l’heure peut rester faux jusqu’à la collecte suivante.

Pendant l’affichage, le cœur ([server/addons/ambient.ts](../../server/addons/ambient.ts)) relance la collecte à l’expiration du relevé, avec le même cache que la voix. Après un échec, il réessaie au bout de 30 s, puis 60 s, 120 s, 240 s et au plus 5 minutes. Un départ, un changement de personne, de réglage ou la désactivation annule les lectures en cours.

## Cache, erreurs et propriétaires

La validité d’un succès vaut `freshMs`, ramenée entre 5 secondes et 24 heures, comptée depuis **la fin de la collecte**. Une donnée déjà ancienne chez le fournisseur DOIT être traitée par le module.

| Situation | Comportement |
| --- | --- |
| Relevé valide et même `dataVersion` | Réutilisé, sans collecte |
| Relevé absent ou expiré | Collecte à la demande, ou automatique pour une source affichée en permanence |
| Lectures simultanées d’une même source | Une seule collecte, partagée |
| Premier succès | Relevé `ready`, daté par le cœur |
| Succès avec `empty: true` | Relevé `empty` : la carte et la phrase du module s’il sait le dire (statut `empty`), sinon « aucune donnée utile », sans carte |
| Premier échec | Relevé `error` sans données ni dates ; l’outil échoue avec le message du module |
| Échec après un succès | Dernières données gardées en `stale`, dates et révision inchangées |
| Échec après un succès vide | Le relevé reste `empty` |
| Source modifiée ou supprimée pendant la lecture | Résultat tardif ignoré |

Modifier les réglages, le propriétaire ou l’identifiant d’une source efface son relevé. **Tester** force une collecte, alors qu’une question vocale peut utiliser le cache.

Le propriétaire est choisi dans l’administration : le foyer ou une personne. La voix ne voit que les sources actives du foyer et de la personne reconnue. Sans identifiant de source, le cœur prend la seule source possible, sinon la seule de la personne ; sinon il répond « Plusieurs sources existent : précisez laquelle. ». Un identifiant inconnu donne « Source « … » inconnue pour ce module. ».

## L’outil vocal

Chaque outil local (`read`) devient `<id>__<nom>`. Les noms DOIVENT suivre `^[a-zA-Z0-9_-]+$`, être uniques et donner un nom complet de 64 caractères au plus. Le schéma recommandé est celui des modules fournis :

```json
{
  "type": "object",
  "additionalProperties": false,
  "required": ["instanceRef"],
  "properties": { "instanceRef": { "type": ["string", "null"] } }
}
```

La description DEVRAIT dire en français ce que l’outil lit, donner deux ou trois formulations typiques et nommer la carte. Le cœur y ajoute la liste des sources autorisées : ne la codez pas en dur. Lire une source affiche d’office sa carte.

Tout outil déclaré déclenche la même lecture ; `collect` ne reçoit pas le nom de l’outil. Un paramètre ajouté à la main dans `parameters` n’arrive pas à `collect` : pour une lecture paramétrée, déclarez des [arguments typés](#les-arguments-typés), ou un [outil à la demande](#loutil-à-la-demande) pour une question libre.

### Les arguments typés

Extension compatible v1 (Cornelius 0.2.0), pour une lecture que la voix précise : « on fait quoi samedi ? », « et le SP98 ? ». L’outil déclare `arguments`, quatre au plus ; le cœur les ajoute lui-même aux `parameters` annoncés au modèle, facultatifs (type avec `null`) :

```ts
arguments: {
  debut: {
    type: 'integer',
    minimum: 0,
    maximum: 60,
    description: 'Premier jour à lire, compté depuis aujourd’hui : 0 aujourd’hui, 1 demain.',
  },
  carburant: { type: 'string', enum: ['gazole', 'sp98'], description: 'Carburant demandé.' },
  detail: { type: 'boolean', description: 'Réponse détaillée.' },
},
```

| Règle | Effet |
| --- | --- |
| Types | `integer` borné (`minimum`, `maximum`, écart de 10 000 au plus), `string` à choix (`enum` de 1 à 30 valeurs de 40 caractères au plus) ou `boolean` ; une description de 200 caractères au plus. Ni `instanceRef` ni `query` |
| Contrôle | Une valeur hors bornes ou hors liste est refusée en `invalid_params` (« Paramètre « jours » : entier de 1 à 14 attendu. ») sans appeler `collect` ; un entier écrit en chiffres (« 3 ») est accepté |
| Sans argument | Un argument absent ou `null` est omis ; sans aucun argument, c’est une lecture ordinaire, avec cache, et `context.args` est absent |
| Avec au moins un argument | Lecture à la demande, comme pour `query` : ni cache, ni regroupement, ni repli, rien d’enregistré ; le relevé de la source n’est pas touché |
| Données | `collect` reçoit `context.args` et DOIT en tenir compte dans ses données : `present` ne voit que le relevé |

Le module [Agenda](https://github.com/lfpoulain/cornelius-modules/tree/main/agenda) (`debut`, `jours`) et le module [Carburants](https://github.com/lfpoulain/cornelius-modules/tree/main/carburants) (`carburant`) en sont les exemples.

### L’outil à la demande

Extension compatible v1, pour un module qui répond à une question libre (une recherche dans des documents, par exemple). L’outil déclare `query: { maxLength }` (entier de 1 à 2 000) et un paramètre `query` de type chaîne dans `parameters` :

```ts
{
  name: 'ask',
  description: '… query : la question complète, sans pronom.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['instanceRef', 'query'],
    properties: { instanceRef: { type: ['string', 'null'] }, query: { type: 'string' } },
  },
  query: { maxLength: 1000 },
}
```

| Règle | Effet |
| --- | --- |
| Question absente, vide ou trop longue | Refusée par le cœur en `invalid_params`, sans appeler `collect` |
| `context.query` | La question, sans espaces autour ; absente pour une lecture ordinaire (**Tester**, outil sans `query`, affichage permanent) |
| Cache et regroupement | Aucun : chaque appel lance sa collecte |
| Relevé | Gardé en mémoire le temps de la réponse, jamais enregistré ; le dernier relevé de la source n’est pas touché |
| Échec | Pas de repli : la réponse à une autre question n’est jamais resservie ; le message du module est dit (« Source indisponible : … ») |
| Journal | La durée et le statut, jamais la question |

`collect` DOIT donc traiter les deux cas : avec `query`, la réponse ; sans, une vérification utile à **Tester** (le module [Ragator](../../addons/ragator/index.ts) lit l’état du corpus). `dataSchema` couvre les deux formes, et `present` aussi. Le délai `timeoutMs` reste celui du module : un service lent DEVRAIT le relever et le dire dans la description de l’outil, pour que Cornelius prévienne avant d’appeler.

## Les secrets

Déclarez chaque jeton dans `secrets` :

| Champ | Règle |
| --- | --- |
| `name` | Nom lu par `context.secret(name)`, motif `^[A-Za-z][A-Za-z0-9_]{0,63}$`, unique |
| `env` | Variable du fichier `.env`, motif `^[A-Z][A-Z0-9_]{0,99}$` |
| `label` | Le jeton précédé de « un » ou « une », 80 caractères au plus |
| `url` | Facultatif : page d’inscription, en http ou https |
| `note` | Facultatif : précision courte (40 caractères au plus), par exemple « gratuit » |

L’administration affiche alors « Ce module a besoin d’… » tant que le jeton manque, et grise « Ajouter une source ». Elle ne voit jamais la valeur.

La déclaration suffit à brancher le jeton : il se saisit dans la carte du module ou dans **Mise en route → Clés et jetons**, et sinon se lit dans la variable `env` du fichier `.env`. Il est masqué dans le journal dès qu’il est saisi. Les variables réservées au cœur (`OPENAI_API_KEY`, `CORNELIUS_ADMIN_PASSWORD`, `CORNELIUS_PERCEPTION_TOKEN`, `CORNELIUS_IMAGE_GENERATION_TOKEN`) sont ignorées. Documentez la variable, sans valeur, dans [.env.example](../../.env.example) et dans la fiche du module, et testez avec un jeton fictif : absent, refusé, accepté.

Dans le module, un jeton absent DOIT lever `config_invalid`. La syntaxe `${secret:NOM}` et les variables `CORNELIUS_SECRET_<NOM>` sont réservées aux commandes HTTP : `context.secret()` ne les lit pas.

## La recherche assistée

Pour choisir un arrêt, une station ou une direction sans taper d’identifiant, déclarez `search` : une liste `fields` et une fonction `find(input, context)`. Le module Transports ([addons/transit/index.ts](../../addons/transit/index.ts)) en est l’exemple :

```ts
fields: [
  {
    kind: 'place',
    label: 'Arrêt',
    target: 'stopAreaId',
    labelTarget: 'stopAreaLabel',
    placeholder: 'Nom de l’arrêt ou de la rue',
  },
  {
    kind: 'route',
    label: 'Direction',
    target: 'routeId',
    labelTarget: 'routeLabel',
    dependsOn: 'stopAreaId',
    placeholder: 'Ligne ou destination',
  },
],
```

- `target` reçoit l’identifiant choisi et `labelTarget` son libellé : ces champs DOIVENT exister dans `configSchema` et `configDefaults`. Le formulaire les masque.
- `dependsOn` grise la recherche tant que l’autre champ est vide ; changer un choix efface ceux qui en dépendent. Une cible facultative (type avec `null`) offre un bouton « Effacer la sélection », que `clearLabel` peut renommer (« Toutes les directions » pour Transports).
- `find` reçoit `{ kind, query, values }` : `values` est le formulaire en cours, en chaînes, pas une configuration validée. Le module DOIT le contrôler, renvoyer `[]` si une dépendance manque, imposer un minimum de lettres si utile et borner la liste de `{ id, label, detail? }`.
- La recherche part avec Entrée ou le bouton **Chercher**. Une liste vide affiche « Aucun résultat. ». Un message d’erreur levé par `find` s’affiche tel quel sous le champ.
- Le serveur limite `kind` à 32 caractères et `query` à 120. Le `signal` de `find` n’est jamais déclenché : bornez chaque requête par `timeoutMs`.

## Tester un module

`#cornelius/testing` fournit `createTestModule(t, addon, options)` : une source du foyer dans une base en mémoire (fermée à la fin du test), l’exécution réelle du cœur, une horloge réglable et un réseau simulé.

| Option | Effet |
| --- | --- |
| `config` | Réglages de la source, par-dessus `configDefaults` |
| `at` | Instant de départ, ISO ou millisecondes |
| `timeZone` | Fuseau du foyer (« Europe/Paris » par défaut) |
| `routes` | Réponses : `{ 'morceau d’adresse': réponse }`, la première clé contenue dans l’adresse répond ; ou une fonction de la requête. Une réponse est un objet (envoyé en JSON), une chaîne, ou `{ status, body?, headers?, truncated? }` ; sans correspondance, 404 |
| `secrets` | Jetons déclarés, par nom |
| `ref` | Identifiant de la source (`test` par défaut) |

Le résultat donne `read()` (lecture ordinaire, cache compris), `invoke(outil, arguments)` (appel tel que le modèle le ferait, arguments contrôlés), `ambient()`, `configure(réglages)`, `at(instant)`, `advance(ms)`, `route(réponses)`, `calls` (requêtes envoyées), `runtime`, `instances`, `instance`, et `contract(résultat)` : la liste des écarts au contrat (définition, relevé, carte, affichage permanent, résultat d’outil), vide si tout est conforme.

```ts
const f = createTestModule(t, addon, { routes: { '/parkings/': { name: 'Gare', available: 4 } } });
const result = await f.read();
assert.deepEqual(f.contract(result), []);
```

Les mêmes exports qu’avant restent disponibles : `validateAddonDefinition`, `openDatabase`, `AddonRepository`, `AddonRuntime`.

## Versions et migrations

`version` suit le code, `configVersion` les réglages, `dataVersion` les données. `apiVersion` est le contrat avec le cœur : le changer rend le module inchargeable. `minCoreVersion` marque une dépendance à un ajout compatible du cœur (une fonction de `#cornelius/addons`, un champ facultatif) : comparé à la `version` du `package.json` de Cornelius, il refuse le module proprement sur un cœur trop ancien.

| Cornelius | Ajouts compatibles v1 |
| --- | --- |
| 0.2.0 | `display` ; `arguments` des outils et `context.args` ; `context.timeZone` ; `refreshAt` de l’affichage permanent ; présentation d’un relevé vide ; fraîcheur jusqu’à 24 heures ; client HTTP : redirections, encodage, `truncated`, `url`, User-Agent, `cacheMs` ; formulaire : listes déroulantes et listes répétées ; `clearLabel` ; `createTestModule` |
| 0.1.0 | Contrat v1, outil à la demande (`query`), secrets, recherche assistée, affichage permanent, `minCoreVersion` |

Un module qui s’appuie sur un ajout de 0.2.0 DOIT déclarer `minCoreVersion: '0.2.0'`.

Quand `configVersion` augmente, `configMigrate` DOIT vérifier `fromVersion` et le contenu, garder les choix existants, compléter les nouveaux champs et refuser une version inconnue, sans réseau ni écriture. La migration s’applique en mémoire, à chaque collecte (le résultat est alors validé) et à l’ouverture du formulaire de l’administration, qui montre ainsi les nouveaux champs déjà remplis. Elle n’est jamais écrite en base d’elle-même : c’est l’enregistrement du formulaire qui valide son contenu contre le nouveau schéma et l’enregistre avec la nouvelle `configVersion`. Si `configMigrate` lève une erreur, le formulaire montre les réglages enregistrés tels quels et le journal garde « Migration des réglages impossible ».

Une nouvelle `dataVersion` force une collecte, et l’ancien relevé n’est plus utilisé en repli. Ne changez jamais le sens d’une donnée sans changer ce numéro.

## Que se passe-t-il si…

| Situation | Effet |
| --- | --- |
| Le dossier s’appelle `parking-gare` | Ignoré sans message (tiret interdit) |
| `id` diffère du nom du dossier | Refusé : « identifiant … différent du dossier. » |
| Un schéma ne compile pas | Refusé, avec la première erreur d’Ajv |
| Un module externe reprend l’identifiant d’un module livré | Refusé : « identifiant déjà pris par un module livré avec Cornelius. » |
| L’identifiant est un préfixe d’outil du cœur (`mail`, `image`…) | Refusé : « identifiant réservé à un outil de Cornelius. » |
| `minCoreVersion` dépasse la version installée | Refusé : « nécessite Cornelius … ou plus récent (installé : …). » |
| `display.icon` hors de la liste | Refusé : « icône « … » inconnue. » |
| Un argument d’outil mal déclaré | Refusé au chargement (« argument « … » : bornes entières attendues. ») |
| Le modèle donne un argument hors bornes | `invalid_params`, sans collecte |
| La source redirige vers une autre adresse | Suivie (GET, trois fois au plus) ; refusée vers http ou pour un POST |
| La réponse dépasse `maxBytes` | Coupée ; `response.truncated` vaut `true` |
| Rien à signaler (`empty: true`) | Carte et phrase du module, statut `empty` ; sans phrase du module, « aucune donnée utile » |
| Le jeton manque | « Jeton manquant », ajout de source grisé ; une source existante échoue en `config_invalid` |
| Le fournisseur ne répond pas | `timeout` après `timeoutMs` ; repli sur le dernier succès s’il existe |
| Les données ne respectent pas `dataSchema` | Échec `malformed`, traité comme une panne : repli sur le dernier succès s’il existe |
| La carte dépasse une limite | « Données reçues mais illisibles. », détail au journal |
| L’affichage permanent dépasse une limite | « Source indisponible » sur le miroir |
| Deux personnes demandent en même temps | Une seule collecte, partagée |
| La source change pendant une lecture | Résultat ignoré, nouvelle lecture à la prochaine demande |
| Le module lève une exception inattendue | `upstream`, message générique, texte au journal |
| Le module change de `dataVersion` | Nouvelle collecte ; pas de repli sur l’ancien relevé |

## Annexe : consigne pour un assistant de code

Pour un module externe, utilisez plutôt la consigne du [tutoriel](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md#avec-un-assistant-de-code) de cornelius-modules. Celle-ci sert à un module livré :

```text
Crée un module livré de Cornelius pour [besoin], identifiant [id] (minuscules, chiffres,
« _ »). Lis docs/modules/reference.md, shared/addons.ts, server/addons/runtime.ts,
server/addons/registry.ts et le module livré le plus proche (addons/clock, addons/weather
ou addons/transit ; addons/ragator pour une question libre). Pars d'une copie de
../cornelius-modules/_template dans addons/[id], sans garder son fournisseur fictif.

Source réelle : [documentation de l'API, adresses autorisées, format des réponses].
Réglages : [champs, titres, descriptions, valeurs par défaut].
Jeton : [nom de la variable .env, jamais sa valeur ; la déclaration dans secrets suffit].
Lecture : [ordinaire avec read, ou outil à la demande avec query et sa longueur maximale].
Fraîcheur : [durée, et traitement d'une donnée déjà ancienne].
Carte et oral : [faits prioritaires, comportement sans donnée].
Affichage permanent : [oui ou non ; metric ou list ; valeur et lignes].

Respecte le contrat v1 et ses limites. N'invente ni adresse, ni traitement par outil hors
de l'outil à la demande. Si le besoin dépasse le contrat, décris l'évolution
nécessaire avant de l'écrire. Ne modifie le cœur que pour un branchement indispensable
et explique-le. Livre la définition, les schémas, des réponses fictives, des tests lancés
par npm test et la fiche addons/[id]/README.md. Vérifie npm run check et npm test.
Indique ce qui est testé et ce qui reste à essayer avec le vrai fournisseur et à la voix.
```

## Voir aussi

- [Créer un module](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md), dans cornelius-modules
- [Les modules](README.md)
- [Architecture](../developpement/architecture.md)
- [Tests et recette](../developpement/tests-et-recette.md)
- [Configuration](../reference/configuration.md)
- Code : [shared/addons.ts](../../shared/addons.ts), [server/addons/](../../server/addons/), [gabarit](https://github.com/lfpoulain/cornelius-modules/tree/main/_template)
