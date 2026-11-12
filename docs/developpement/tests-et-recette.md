# Tests et recette

Cette page explique comment vérifier une modification de Cornelius : les tests automatiques à lancer sur un poste de développement, puis la recette manuelle sur le miroir réel et les critères qui décident d’une livraison. Elle s’adresse aux personnes qui modifient le code ou qui valident une installation.

## Tests automatiques

Les tests n’appellent ni OpenAI ni un service réel : ils utilisent des bases SQLite en mémoire ou temporaires, des fournisseurs et des périphériques simulés. Aucune clé n’est nécessaire.

| Commande | Ce qu’elle vérifie |
|---|---|
| `npm test` | Tests TypeScript du serveur, des règles partagées, de l’audio du navigateur et des modules (`tests/*.test.ts`, `addons/*/*.test.ts`). |
| `npm run check` | Types TypeScript, sans compiler. |
| `npm run format:check` | Formatage Prettier. Corrigez avec `npm run format`. |
| `npm run build` | Types puis compilation de l’interface dans `dist/web`. |
| `npm run test:e2e` | Parcours dans un vrai navigateur (Chromium) contre un serveur de test. |

Lancer toute la vérification TypeScript, dans l’ordre de la vérification automatique :

```sh
npm run format:check
npm test
npm run build
npm run test:e2e
```

Un seul fichier de test se lance avec `npx tsx --test`, un seul parcours navigateur avec `npx playwright test` :

```sh
npx tsx --test tests/memory.test.ts
npx playwright test tests/e2e/memory.spec.ts
```

### Tests navigateur

Installez Chromium une fois pour Playwright (sous Linux, `--with-deps` ajoute les bibliothèques du système) :

```sh
npx playwright install chromium
```

`npm run test:e2e` démarre lui-même un serveur de test (`playwright.config.ts`) avec une base en mémoire et un mot de passe dédié, sur le port 3101, fermé au réseau local. Les specs se connectent avec `login(page, '/admin#…')` de `tests/e2e/env.ts`. Ce serveur sert l’interface compilée : lancez `npm run build` d’abord. Si le port est déjà pris, choisissez-en un autre :

```sh
CORNELIUS_E2E_PORT=3199 npm run test:e2e
```

```powershell
$env:CORNELIUS_E2E_PORT = 3199; npm run test:e2e
```

Les résultats et les captures d’écran des parcours vont dans `.local/` (ignoré par git).

### Tests Python

Les tests de la perception, de la vision, du mot d’appel et de l’installateur d’images sont dans `tests/python`. Ils se lancent avec l’environnement de la perception :

```sh
.venv/bin/python -m unittest discover -s tests/python -p "test_*.py" -v
```

```powershell
.venv\Scripts\python.exe -m unittest discover -s tests/python -p "test_*.py" -v
```

### Scripts shell

La vérification automatique contrôle les scripts shell avec `shellcheck -x scripts/*.sh`.

Le générateur du mot d’appel est un projet séparé, avec ses propres tests : [wakeword-generator](https://github.com/lfpoulain/wakeword-generator).

## Organisation de tests/

| Dossier ou fichier | Contenu |
|---|---|
| `tests/*.test.ts` | Un fichier par sujet : `controller`, `live`, `api`, `storage`, `backups`, `memory*`, `vision`, `image-generation*`, `home-assistant*`, `agents*`, `addons*`, `actions*`, `opening`, `readiness`, `audio*`… |
| `tests/helpers/` | Faux serveurs Home Assistant et Hermes ; `demo-addon/`, module de démonstration des tests. |
| `tests/e2e/` | Parcours Playwright (`*.spec.ts`) ; `env.ts` fixe le port et le dossier des captures. |
| `tests/e2e/modules/` | Seul dossier de modules externes des parcours (`CORNELIUS_MODULES_DIR` de `playwright.config.ts`) : le module `formulaire` exerce les listes déroulantes et les listes répétées. Un `cornelius-modules` cloné à côté n’entre pas dans les parcours. |
| `tests/python/` | Tests `unittest` de `perception/` et `image_generation/`. |
| `tests/recette/protocol.json` | Protocole de la recette manuelle (questions, interruptions, nombre d’approches et de passages). |
| `addons/<id>/*.test.ts` | Tests propres à un module livré, lancés par `npm test`. Ceux des modules externes : `npm run test:modules`. Les deux s’écrivent avec `createTestModule` de `#cornelius/testing` ([référence](../modules/reference.md#tester-un-module)). |

Tests ciblés par fonction :

| Fonction | Tests TypeScript | Parcours navigateur |
|---|---|---|
| Home Assistant | `tests/home-assistant.test.ts`, `tests/home-assistant-api.test.ts`, `tests/addons-live.test.ts` | `tests/e2e/home-assistant.spec.ts` |
| Agents Hermes | `tests/agents.test.ts`, `tests/agents-api.test.ts`, `tests/live.test.ts` | `tests/e2e/agents.spec.ts` |
| Mémoire | `tests/memory.test.ts`, `tests/memory-api.test.ts`, `tests/memory-extractor.test.ts` | `tests/e2e/memory.spec.ts` |
| Ouverture et écoute | `tests/opening.test.ts`, `tests/controller.test.ts`, `tests/listening-settings.test.ts` | `tests/e2e/session-mode.spec.ts`, `tests/e2e/listening-settings.spec.ts` |
| Vision | `tests/vision.test.ts` | `tests/e2e/vision.spec.ts` |
| Génération d’images | `tests/image-generation.test.ts`, `tests/image-generation-runtime.test.ts`, `tests/image-illustration.test.ts` | `tests/e2e/image-generation.spec.ts` |

## Recette sur le matériel

Les tests automatiques ne remplacent pas un essai sur le miroir réel : caméra, micro, haut-parleurs, verre, éclairage, réseau et compte OpenAI. La recette se fait avec le serveur et la perception lancés normalement ([installation](../installation/linux.md)), la voix activée sur le miroir.

### Recette guidée

```sh
npm run recette
```

Le script déroule le protocole de `tests/recette/protocol.json` et attend votre validation entre chaque étape : 20 approches, 50 questions, 20 interruptions et 50 passages de tiers. Il ne produit aucun son et ne pilote ni la caméra ni la session : c’est vous qui vous approchez et posez les questions à voix haute, le serveur ouvre et ferme la conversation selon votre présence réelle.

| Option | Effet |
|---|---|
| `--list` | Affiche le protocole sans le dérouler. |
| `--questions N` | Limite le nombre de questions. |
| `--interruptions N` | Limite le nombre d’interruptions. |
| `--approaches N` | Limite le nombre d’approches. |
| `--passages N` | Limite le nombre de passages de tiers. |

Les options passent après `--` :

```sh
npm run recette -- --list
npm run recette -- --questions 5 --interruptions 2 --approaches 3 --passages 3
```

La compréhension (question entièrement comprise ou non) se compte à la main pendant la recette.

### Mesures

Le serveur et le miroir enregistrent leurs mesures dans le journal `data/logs/cornelius.log`. Après la recette, ou après quelques conversations réelles :

```sh
npm run mesures
npm run mesures -- chemin/vers/cornelius.log
```

Le rapport donne un tableau des critères de livraison (réactivité, interruption, affichage, présence) et le détail des étapes, avec médiane et 95e centile :

| Mesure | Début → fin |
|---|---|
| `detection_admission` | Première observation reçue par le serveur → conversation admise |
| `admission_pret` | Admission → session prête (WebRTC connecté et contrôle du serveur attaché) |
| `detection_pret` | Première observation → session prête |
| `wake_pret` | Mot d’appel détecté → session prête |
| `audio_microphone` | Attente du micro après le début de la préparation |
| `audio_preparation_locale` | Début de la session dans le navigateur → offre et traitement audio prêts |
| `audio_reponse_serveur` | Envoi de l’offre → réponse du serveur |
| `audio_webrtc_connecte` | Début de la session dans le navigateur → WebRTC connecté |
| `audio_openai` | Envoi de l’offre → `session.started` |
| `audio_demarrage` | Début de la session dans le navigateur → `session.started` |
| `audio_preparation_reutilisee` | Préparation locale réutilisée (1) ou non (0) |
| `vision_scene`, `vision_tool`, `vision_echec` | Durée d’une analyse d’ouverture, d’une question visuelle, ou échec et sa raison |

Les mesures de détection ne concernent que la première admission d’un cycle de présence. Elles comprennent les attentes d’identification, d’autorisation ou de déblocage : pour comparer des vitesses, faites les essais avec le même réglage d’ouverture.

## Critères de livraison

Une version se livre quand ces critères passent sur le matériel final :

| Domaine | Critère |
|---|---|
| Compréhension | Au moins 49 questions sur 50 comprises entièrement, prononcées après « prêt », aux distances et dans le bruit prévus. |
| Réactivité | Sans outil réseau, première information utile moins de 2 s après la fin de la question dans au moins 95 % des cas. |
| Interruption | Réponse coupée en moins de 500 ms dans au moins 19 interruptions sur 20, sans perdre la demande. |
| Présence | Au moins 19 engagements corrects sur 20 approches ; au plus 1 ouverture injustifiée sur 50 passages de tiers. |
| Affichage | 30 images par seconde visées sous charge ; la vision ne bloque pas la voix. |
| Profils et mémoire | Aucune donnée, carte ou écriture attribuée au mauvais profil dans les scénarios ci-dessous. |
| Commandes | Aucun effet en double après un événement répété ou une reconnexion ; un résultat incertain est signalé. |

Une connexion qui dépasse 5 s est arrêtée (« Connexion trop longue. Réessayez. ») et comptée à part.

Scénarios à jouer :

1. Changement de personne pendant une réponse, une carte et une extraction de mémoire lente.
2. Deux personnes, choix explicite d’un profil, puis départ de la personne choisie.
3. Caméra ou détection de parole bloquée, miroir fermé, connexion OpenAI perdue puis rétablie.
4. Fermeture non confirmée par OpenAI puis redémarrage : aucune conversation ne reste bloquée.
5. Première collecte d’un module en erreur, cache expiré, deux sources simultanées.
6. Commande HTTP envoyée mais réponse perdue ; confirmation devenue invalide.
7. Vision lente ou périmée.
8. Suppression d’un profil : ses données, ses cartes et ses commandes ne reviennent pas.

L’état de la recette est suivi dans la [feuille de route](feuille-de-route.md).

## Voir aussi

- [Développer Cornelius](README.md)
- [Architecture](architecture.md)
- [Feuille de route](feuille-de-route.md)
- [Dépannage](../utilisation/depannage.md)
- [Le GPU](../installation/gpu.md)
