# Les prompts

Cette page explique où se trouvent les consignes que Cornelius donne aux modèles, les principes qu’elles suivent, et comment voir le texte réellement envoyé. Elle s’adresse aux personnes qui modifient le comportement de Cornelius. Elle ne recopie pas les prompts : le code fait foi et cette page indique où le lire.

## Les modèles en jeu

| Rôle | Modèle | Où il est choisi |
|---|---|---|
| Conversation vocale | `gpt-live-1`, voix `cedar` | `server/live/configuration.ts` |
| Recherches et actions (la « délégation », appelée Luna dans les consignes) | `gpt-6-luna` en mode « Normal » ou « Rapide », `gpt-6-astra` en « Ultra rapide » | `server/live/configuration.ts`, d’après **Voix et modèles → Délégation : recherches et actions** (`shared/delegation.ts`, « Rapide » par défaut) ; un **Modèle de délégation** choisi dans la même carte remplace le modèle du mode (`shared/live-endpoint.ts`) |
| Extraction de la mémoire après la conversation | `gpt-5.6-luna` | `server/memory-extractor.ts` |
| Description de la scène, sur la machine | LFM2.5-VL | `perception/scene.py` |

## Principes

- **Aucun fait dans le prompt d’ouverture.** Le prompt de conversation ne contient ni prénom, ni météo, ni horaires, ni souvenirs. Chaque fait vient d’un appel d’outil, vérifié par le serveur ; la seule exception est la description de la scène fournie par la caméra locale, datée et valable 10 s.
- **Les outils portent les identifiants.** Les sources et les commandes autorisées pour la personne figurent dans la description des outils construits pour la session. Le modèle les lit là et ne doit jamais les inventer.
- **Les faits viennent des outils, les directives du serveur.** En cours de conversation, le serveur ajoute des consignes par les canaux de la session (accueil, carte affichée, scène vue) au lieu de réécrire le prompt.
- **Les données ne sont jamais des consignes.** Texte lu dans une image, page web, souvenir, résultat de Hermes : les prompts demandent de les traiter comme des données. Le serveur les transmet sous forme JSON.
- **Un fragment par fonction active.** Les phrases sur la recherche web, la vision, les images, Home Assistant ou Hermes ne sont ajoutées que si l’outil correspondant est proposé à la session. Désactiver une fonction retire aussi les phrases qui la citent.
- **La personnalisation vient en dernier.** Le style du foyer, celui de la personne et ses repères sont ajoutés à la fin, sous forme de données. Ils règlent le ton, jamais les règles de silence, de confidentialité ou de confirmation.
- **Ne pas répéter.** Une consigne ajoutée en cours de session ne peut pas être retirée : chaque consigne part une seule fois par session, et le serveur évite de faire dire deux fois la même chose (une carte de module suffit, sans carte Luna en double).

## Où vivent les prompts

| Fichier | Contenu |
|---|---|
| `server/live/configuration.ts` | `liveConfiguration()` : prompt de la conversation vocale, prompt de la délégation, liste des outils (dont `web_search` et `ui__show_luna_card`), fragments ajoutés selon les outils présents (`vision__look`, `image__generate`, `mail__send`, `alarms__set`, `home_assistant__read`, `home_assistant__control`, `agents__start`), et la personnalisation (`personalityInstructions`, `personalContextInstructions`). |
| `server/live/transport.ts` | Consignes ajoutées pendant la session : accueil selon **Quand il écoute → Accueil à l’ouverture** (« Bonjour » et le prénom, accueil libre, ou pas d’accueil), annonce d’une carte affichée, description de la caméra en contexte silencieux (découpée en fragments de 400 octets), résultats de Hermes. |
| `server/live/card-overlap.ts` | Règle qui écarte une carte Luna répétant la carte d’un module. |
| `perception/scene.py` | Consignes de LFM2.5-VL (`INSTRUCTIONS`) : description générale à l’ouverture (`scene`) et réponse à une question visuelle (`tool`). |
| `server/memory-extractor.ts` | `memoryExtractionInstructions` : règles d’extraction de la mémoire après la conversation. |
| `server/addons/runtime.ts`, `server/actions.ts`, `server/vision.ts`, `server/image-generation.ts`, `server/mail.ts`, `server/memory.ts`, `server/home-assistant.ts`, `server/agents.ts` | Descriptions des outils et de leurs paramètres, construites pour le profil actif. |
| `addons/<id>/index.ts` | Description des outils de chaque module. |

Les schémas des paramètres viennent de `schemas/` (par exemple `luna-card.schema.json`, `vision-look.schema.json`). Le serveur valide toujours les arguments reçus, même quand le modèle est contraint par le schéma.

## Voir les prompts effectifs

Dans l’administration, **Personnaliser Cornelius → Ce que Cornelius reçoit** montre le texte complet transmis au début d’une conversation, pour le foyer ou pour la personne choisie, avec les outils réellement disponibles :

- **Conversation** : le prompt des réponses orales ;
- **Recherches et actions** : le prompt de la délégation.

Les préférences enregistrées apparaissent surlignées à la fin du texte ; sans préférence, la mention « aucun réglage enregistré » s’affiche. Cet aperçu ne contient pas les consignes ajoutées pendant la session (`server/live/transport.ts`) ni les descriptions des outils.

La rubrique **Journal** suit les étapes de chaque conversation (connexion, outils, fermeture), sans le contenu des prompts ni des paroles.

## Modifier un prompt

1. Modifiez le fichier concerné ci-dessus, en gardant les principes de cette page.
2. Mettez à jour les tests qui vérifient le texte ou les outils (`tests/live.test.ts`, `tests/personality.test.ts`, `tests/memory-extractor.test.ts`, `tests/python/test_scene.py`).
3. Redémarrez le serveur : une conversation déjà ouverte garde l’ancien prompt.
4. Vérifiez le résultat dans **Ce que Cornelius reçoit**, puis par une conversation réelle (voir [Tests et recette](tests-et-recette.md)).

## Voir aussi

- [Architecture](architecture.md)
- [Personnalité](../fonctionnalites/personnalite.md)
- [Mémoire](../fonctionnalites/memoire.md)
- [Vision locale](../fonctionnalites/vision-locale.md)
- [Référence des modules](../modules/reference.md)
