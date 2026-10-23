# Licences

Cette page recense les licences du code de Cornelius, des ressources qu’il contient et des modèles qu’il télécharge, puis donne la liste des vérifications à faire avant de publier le dépôt. Elle s’adresse à la personne qui publie ou redistribue Cornelius. Elle résume les conditions annoncées par chaque source, sans trancher de question juridique : lisez toujours le texte de la licence lui-même.

## Le code de Cornelius

Le code et la documentation écrits pour Cornelius sont distribués sous la **[PolyForm Noncommercial License 1.0.0](../../LICENSE)** (identifiant SPDX `PolyForm-Noncommercial-1.0.0`, déclaré dans `package.json`). Elle a été choisie parce qu’elle est écrite pour du logiciel et dit exactement ce qui est voulu :

| | |
|---|---|
| Utiliser, étudier, tester | permis pour tout usage non commercial : personnel, loisir, recherche, enseignement, association, administration |
| Partager des copies | permis, avec le texte de la licence (ou son adresse) et la ligne `Required Notice` |
| Modifier, créer un projet dérivé | permis pour un usage non commercial, aux mêmes conditions de partage |
| Citer | obligatoire : la ligne `Required Notice: Copyright (c) 2026 Entremakers SAS, Les Frères Poulain (https://github.com/lfpoulain/Cornelius)` accompagne toute copie, modifiée ou non |
| Usage commercial | interdit sans accord écrit des auteurs (une licence commerciale peut leur être demandée) |

La licence n’oblige pas à publier ses modifications (elle n’est pas « copyleft »). Comme elle exclut l’usage commercial, ce n’est pas une licence « open source » au sens de l’Open Source Initiative : le dire ainsi serait inexact.

Les attributions des projets de tiers sont réunies dans [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md), avec la liste complète des bibliothèques npm (`npm run notices` la met à jour, un test vérifie qu’elle l’est).

Le champ `"private": true` de `package.json` empêche seulement une publication sur npm.

La licence choisie pour le code ne s’applique pas aux polices, composants, modèles et données de tiers décrits ci-dessous : chacun garde la sienne.

## Ce que le dépôt contient

| Élément | Fichiers | Licence |
|---|---|---|
| Polices DM Sans, DM Mono et Epilogue | `web/assets/fonts/*.ttf` | SIL Open Font License 1.1, notices `dmsans-OFL.txt`, `dmmono-OFL.txt`, `epilogue-OFL.txt` dans le même dossier |
| Composants d’interface shadcn/ui | `web/components/ui/` | MIT, notice `web/components/ui/LICENSE.md` |
| Modèle du mot d’appel « Cornelius » | `models/cornelius.onnx` | CC BY-NC-SA 4.0, notice et attributions `models/cornelius.onnx.LICENSE` (voir [Le mot d’appel](#le-mot-dappel)) |

Gardez ces notices avec les fichiers, dans le dépôt comme dans toute copie distribuée.

Les bibliothèques installées par `npm ci` (Fastify, React, Three.js, Radix, la bibliothèque OpenAI…) et par `pip` (ONNX Runtime, OpenCV, NumPy, PyTorch, Diffusers, Transformers…) ne sont pas dans le dépôt. Elles sont sous des licences permissives (MIT, ISC, BSD, Apache 2.0, BlueOak, 0BSD), compatibles avec la licence non commerciale de Cornelius ; `npm run notices` en tient la liste à jour depuis `package-lock.json`. Leurs notices doivent suivre toute copie distribuée qui les contient, par exemple l’interface compilée `dist/web`. Leurs versions sont fixées dans `package-lock.json`, `perception/requirements*.txt` et `image_generation/requirements.txt`.

## Les modèles de la perception

Ces modèles sont téléchargés par `perception/download_models.py` dans `models/`, à une version précise, vérifiée par empreinte SHA-256. Le texte de la licence est téléchargé avec chaque modèle : `models/<nom>.onnx.LICENSE`, ou `LICENSE` dans le dossier du modèle. Les liens figurent dans `perception/models.json`.

| Modèle | Rôle | Licence |
|---|---|---|
| YuNet (OpenCV Zoo) | détecter les visages | MIT |
| SFace (OpenCV Zoo) | reconnaître les visages | Apache 2.0 |
| Silero VAD | détecter la parole | MIT |
| LFM2.5-VL 450M, 1.6B et 3B (Liquid AI) | vision locale | licence LFM propre à Liquid AI, avec des conditions pour l’usage commercial |

## Les modèles d’images

Ces modèles sont téléchargés depuis Hugging Face quand on les installe dans **Modules → Génération d’image**, vers `models/image-generation/`. Ils ne sont pas figés à une version précise : relisez la page du modèle avant toute redistribution.

| Modèle | Licence annoncée |
|---|---|
| [SDXL Turbo](https://huggingface.co/stabilityai/sdxl-turbo) (Stability AI) | licence communautaire Stability AI, à vérifier pour un usage commercial |
| [SANA-Sprint 0.6B](https://huggingface.co/Efficient-Large-Model/Sana_Sprint_0.6B_1024px_diffusers) | Apache 2.0, avec des conditions propres à son encodeur de texte (Gemma) |
| [FLUX.2 Klein 4B](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B) (Black Forest Labs) | Apache 2.0 |
| [Z-Image Turbo](https://huggingface.co/Tongyi-MAI/Z-Image-Turbo) (Tongyi-MAI) | Apache 2.0 |

## Le mot d’appel

| Élément | Licence annoncée | Ce qu’il faut savoir |
|---|---|---|
| Bibliothèque [openWakeWord](https://github.com/dscripka/openWakeWord) | [Apache 2.0](https://github.com/dscripka/openWakeWord/blob/main/LICENSE) pour le code | Ses modèles de mots d’appel déjà entraînés sont annoncés [CC BY-NC-SA 4.0](https://github.com/dscripka/openWakeWord#license). Cornelius n’en installe aucun. |
| Deux modèles de prétraitement partagés (`melspectrogram.onnx`, `embedding_model.onnx`) | à clarifier | Leur licence fait l’objet d’une [demande de clarification](https://github.com/dscripka/openWakeWord/issues/338). Ils sont téléchargés dans `models/openwakeword/` par `perception/install_wake_features.py`, depuis la version 0.5.1 d’openWakeWord. |
| Modèle « Cornelius » (`models/cornelius.onnx`) | CC BY-NC-SA 4.0, par prudence | Fourni dans le dépôt, entraîné avec [wakeword-generator](https://github.com/lfpoulain/wakeword-generator). Ses droits dépendent des données ci-dessous : il est diffusé pour un usage non commercial, sous les conditions de partage des caractéristiques négatives, avec les attributions des voix réunies dans `models/cornelius.onnx.LICENSE`. |
| Caractéristiques négatives [openwakeword_features](https://huggingface.co/datasets/davidscripka/openwakeword_features) | CC BY-NC-SA 4.0 | Usage non commercial et conditions de partage à examiner avant de diffuser un modèle entraîné avec elles. La licence des données ne suffit pas à fixer celle du modèle obtenu. |
| Réponses impulsionnelles [MIT environmental impulse responses](https://huggingface.co/datasets/davidscripka/MIT_environmental_impulse_responses) (pour simuler l’écho) | inconnue | À éclaircir, ou à remplacer par des enregistrements à licence explicite, avant de distribuer un corpus ou un modèle entraîné avec elles. |
| Voix Piper françaises | [Siwis : CC BY 4.0](https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD), [UPMC : CC BY-SA 4.0](https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/fr/fr_FR/upmc/medium/MODEL_CARD), [Tom : AGPL v3](https://huggingface.co/rhasspy/piper-voices/blob/v1.0.0/fr/fr_FR/tom/medium/MODEL_CARD) | Ces cartes décrivent les données des voix. Elles ne disent pas, à elles seules, le statut des sons générés ni du modèle entraîné. Gardez les attributions. |
| Moteur de synthèse [Piper](https://github.com/OHF-Voice/piper1-gpl) | GPL 3.0 | Utilisé seulement par le générateur, dans son image Docker d’entraînement. Il n’est ni installé ni distribué par Cornelius. |

Les bruits AudioSet et les autres enregistrements utilisés pendant l’entraînement doivent aussi être vérifiés un à un si un corpus audio est publié : les droits des vidéos d’origine [peuvent varier](https://github.com/dscripka/openWakeWord/discussions/174).

En pratique, le dépôt publie `models/cornelius.onnx` avec `models/cornelius.onnx.LICENSE`, pour un usage non commercial. Il ne publie ni les modèles de prétraitement, ni les voix Piper, ni aucun fichier WAV, NPY ou corpus. S’en servir commercialement demande de réentraîner le modèle avec des données aux droits explicites.

## Les peintures de l’écran de veille

L’écran de veille propose 32 peintures célèbres (liste dans `server/screensaver-collection.ts`), téléchargées seulement quand on clique sur « Télécharger les peintures ». Le dépôt n’en contient aucune.

| Élément | Statut | Ce qu’il faut savoir |
|---|---|---|
| Les œuvres | domaine public | Leurs auteurs sont morts depuis plus de 70 ans (le plus récent, Gustav Klimt, en 1918). |
| Les reproductions, sur [Wikimedia Commons](https://commons.wikimedia.org/) | domaine public | Chaque fichier y est marqué « Public domain » (vérifié le 23 octobre 2026). La photographie fidèle d’une œuvre plate du domaine public n’ouvre pas de nouveaux droits : c’est la position de Wikimedia, la jurisprudence américaine (*Bridgeman c. Corel*) et l’article 14 de la directive européenne 2019/790. |

Le titre et l’auteur de chaque peinture s’affichent sur le miroir. Aucune attribution n’est exigée, mais Commons demande un `User-Agent` qui identifie l’application : Cornelius envoie le sien. Les photos ajoutées depuis l’administration restent sous la responsabilité de la personne qui les ajoute.

## Avant de publier le dépôt

1. **Garder `LICENSE` et `THIRD_PARTY_NOTICES.md`** à la racine, et lancer `npm run notices` après tout changement de dépendance.
2. **Garder les notices** des polices (`web/assets/fonts/*-OFL.txt`), des composants (`web/components/ui/LICENSE.md`) et du modèle du mot d’appel (`models/cornelius.onnx.LICENSE`). Ajouter une ligne dans `THIRD_PARTY_NOTICES.md` pour toute autre ressource de tiers ajoutée au dépôt.
3. **Vérifier ce qui part réellement** :

   ```sh
   git status --short
   git ls-files
   git ls-files | grep -Ei '\.(onnx|onnx_data|wav|npy|safetensors|sqlite)$' | grep -v '^models/cornelius\.onnx$'
   ```

   La dernière commande ne doit rien afficher. Cherchez aussi les secrets (clé OpenAI, jetons) et les gros fichiers. `.gitignore` exclut `models/` (sauf `models/cornelius.onnx` et sa licence), `data/`, `.env`, `.venv/`, `.venv-image/` et `.local/`, mais il ne protège ni un fichier déjà suivi par Git, ni un ajout forcé avec `git add -f`.
4. **Pour partager un modèle de mot d’appel**, établir à part la provenance et les droits des exemples positifs et négatifs, des bruits, des réponses impulsionnelles et des modèles de prétraitement, puis documenter les attributions et les conditions d’usage du modèle.
5. **Pour distribuer une archive de modèles ou une image Docker complète**, l’examiner à part du code : chaque modèle y garde sa propre licence.

## Voir aussi

- [Le mot d’appel](../fonctionnalites/mot-d-appel.md)
- [wakeword-generator](https://github.com/lfpoulain/wakeword-generator), le générateur du mot d’appel
- [La vision locale](../fonctionnalites/vision-locale.md)
- [La génération d’images](../fonctionnalites/generation-d-images.md)
- [Configuration](configuration.md)
- [Confidentialité](confidentialite.md)
