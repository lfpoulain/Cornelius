# Mot d’appel et musique

Cette page dit si « Cornelius » reste entendu pendant que le miroir joue de la musique ([le lecteur audio](../fonctionnalites/lecteur-audio.md)), comment on l’a mesuré sans matériel, et comment le vérifier dans la pièce. Elle s’adresse à la personne qui installe le miroir et aux développeurs.

## Où passe le son

Le mot d’appel est détecté sur l’ordinateur, par le service de perception ([perception/wake.py](../../perception/wake.py), modèle `models/cornelius.onnx`), à partir du micro du **navigateur du miroir** : la page capture le micro (annulation d’écho toujours active, réduction du bruit et gain automatique selon les réglages) et envoie des trames de 80 ms au serveur. La musique sort de **ce même navigateur**. Chrome et Edge retirent alors du micro, par l’annulation d’écho, une bonne partie de ce que la page joue : le détecteur entend moins la musique que la pièce. Ce gain dépend du matériel (micro, haut-parleur, distance, réverbération) et ne se mesure que dans la pièce.

Pendant une conversation, la musique baisse puis se coupe quand Cornelius parle ; le mot d’appel, lui, n’écoute qu’en dehors des conversations, donc **avec la musique à son volume réglé**.

## Le banc d’essai hors ligne

[perception/wake_music_bench.py](../../perception/wake_music_bench.py) passe au vrai détecteur, trame par trame comme le miroir, des prises du mot mélangées à des fonds sonores, à plusieurs rapports signal sur bruit (RSB : niveau de la voix sur niveau du fond, en dB), et compte les fausses détections sur les fonds seuls.

```powershell
.venv\Scripts\python.exe perception\wake_music_bench.py --wake ..\wakeword-generator\output\ecoute-cornelius-50 --background ..\wakeword-generator\data\background --features ..\wakeword-generator\data\preprocess
```

Mesure du 24 novembre 2026 sur le poste de développement : les 50 prises de `ecoute-cornelius-50` (voix de synthèse, quatre locuteurs, trois graphies), 40 fonds tirés parmi les 500 extraits AudioSet de 10 s du générateur (musique, voix, bruits de la vie courante, sans étiquettes), seuil 0,5. Chaque prise passe sur plusieurs fonds ; le mot arrive après 2,5 s de fond. Le RSB compare le niveau de la voix (parole seule) au niveau **moyen** du fond sur tout l’extrait.

| RSB | Détections | Score médian |
| --- | --- | --- |
| sans fond | 50 / 50 (100 %) | — |
| +20 dB | 212 / 255 (83 %) | 0,94 |
| +10 dB | 153 / 255 (60 %) | 0,86 |
| +5 dB | 111 / 255 (44 %) | 0,14 |
| 0 dB | 65 / 255 (25 %) | 0,00 |
| −5 dB | 37 / 255 (15 %) | 0,00 |
| −10 dB | 26 / 255 (10 %) | 0,00 |

Fausses détections sur les 500 fonds seuls (83 minutes) : 1, soit 0,7 par heure.

**Ce qu’on en tire.** Le détecteur seul supporte mal un fond sonore : dès que la musique arrive au niveau de la voix (0 dB), trois appels sur quatre sont manqués. Même à +20 dB, un appel sur six l’est : un fond dont le niveau moyen est faible peut avoir des passages forts (un refrain, une voix) au moment où l’on parle, que le niveau moyen ne reflète pas. Les fausses détections restent rares. Ces chiffres sont **le pire cas** : aucune annulation d’écho, comme un micro qui entendrait toute la musique. Ils sont aussi **optimistes** sur un point : les voix sont de la même famille de synthèse que celles de l’entraînement.

Sur le miroir, tout repose donc sur l’annulation d’écho du navigateur, qui retire du micro une partie de la musique que la page joue. Elle ne retire pas les autres sons de la pièce ; son efficacité réelle (souvent 20 à 30 dB, moins dans une pièce réverbérante ou avec un haut-parleur qui sature) se mesure avec le protocole ci-dessous. Si elle ne suffit pas, les leviers sont, dans l’ordre : un volume de départ plus bas, une légère baisse de la musique quand quelqu’un est devant le miroir (la caméra le sait avant le mot), puis un modèle entraîné avec des fonds musicaux plus forts dans [wakeword-generator](https://github.com/lfpoulain/wakeword-generator).

## Protocole d’essai dans la pièce

Le seul essai qui compte : le vrai micro, le vrai haut-parleur, l’annulation d’écho du navigateur. Compter une vingtaine de minutes.

**Préparer**

1. Miroir ouvert et voix activée, mot d’appel prêt (administration, « Le mot d’appel »), ouverture par « Cornelius ».
2. Un module de lecture installé avec une radio **musicale** et une radio **parlée** (informations), ou le module de démonstration `tests/e2e/modules/lecteur_demo` réglé sur deux flux https.
3. Un sonomètre de téléphone posé à l’endroit où l’on parle, pour noter le niveau de la musique (dB A).
4. Choisir un **Son d’ouverture** dans l’administration, rubrique **Conversation** : chaque détection s’entend et se voit (orbe ambre). Le mot d’appel du miroir n’est pas noté au journal : compter à l’oreille, ou filmer l’écran.

**Mesurer** : pour chaque condition, dire « Cornelius » **20 fois**, d’une voix normale, une fois toutes les dix secondes environ, sans attendre de réponse au-delà de l’ouverture (fermer la conversation d’un « merci, c’est tout » ou laisser se fermer). Noter le nombre d’ouvertures.

| Condition | Volume du lecteur | Distance | Contenu |
| --- | --- | --- | --- |
| A, témoin | rien ne joue | 1 m | — |
| B | 4 sur 10 | 1 m | musique |
| C | 6 sur 10 (départ) | 1 m | musique |
| D | 8 sur 10 | 1 m | musique |
| E | 6 sur 10 | 3 m | musique |
| F | 6 sur 10 | 1 m | radio parlée |

Puis **fausses ouvertures** : laisser jouer la radio parlée, puis la musique, 30 minutes chacune, sans parler ; compter les conversations ouvertes seules (son d’ouverture).

Pour voir le score en direct, le testeur de [wakeword-generator](https://github.com/lfpoulain/wakeword-generator) lit le micro **sans** annulation d’écho : lancé pendant que le miroir joue, il donne le pire cas, celui d’un micro qui entend toute la musique.

**Noter** pour chaque condition : volume, niveau au sonomètre, ouvertures sur 20, fausses ouvertures par demi-heure, micro et haut-parleur utilisés, réglages de réduction du bruit et de gain automatique.

**Lire le résultat**

- 18 sur 20 ou plus à 6 sur 10 et 1 m : le comportement actuel suffit.
- Une chute nette entre B et D : régler le volume par défaut du lecteur plus bas (`PLAYER_VOLUME_DEFAULT` dans [shared/player.ts](../../shared/player.ts)), ou baisser légèrement la musique en permanence pendant l’écoute du mot d’appel.
- Une chute forte même en B : l’annulation d’écho ne joue pas son rôle (haut-parleur sur une autre carte son que le micro, sortie choisie hors du navigateur) ; essayer avec le haut-parleur choisi dans l’administration et la même carte son que le micro.
- Des fausses ouvertures avec la radio parlée : relever un peu `CORNELIUS_WAKE_THRESHOLD` (0,5 par défaut), voir [Le mot d’appel](../fonctionnalites/mot-d-appel.md#régler-la-sensibilité).

Les résultats sont à reporter dans l’issue [#62](https://github.com/lfpoulain/Cornelius/issues/62).

## Voir aussi

- [Le lecteur audio](../fonctionnalites/lecteur-audio.md)
- [Le mot d’appel](../fonctionnalites/mot-d-appel.md)
- [Tests et recette](tests-et-recette.md)
