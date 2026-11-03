# La mémoire

Cette page explique ce que Cornelius retient des conversations, à quel moment, et comment consulter, corriger ou effacer ces souvenirs. Elle s’adresse aux membres du foyer et à la personne qui règle le miroir.

## Ce qui est retenu, et quand

Cornelius peut retenir des faits qu’une personne déclare elle-même et qui serviront à une prochaine conversation. Par exemple, « Je préfère des réponses courtes » ou « Mon plat préféré, ce sont les lasagnes ».

Un souvenir n’est possible que si trois conditions sont réunies pendant que la personne parle :

- elle est **seule** devant le miroir ;
- elle est **reconnue** par la caméra ;
- sa mémoire est **autorisée**.

À plusieurs, ou si la caméra ne sait pas qui parle, rien n’est retenu. Ce qui a été dit avant que la personne soit reconnue ne lui est jamais attribué après coup. Une personne choisie à la main dans l’administration ne reçoit pas les paroles d’une autre personne présente devant le miroir. La caméra ne distingue pas une voix hors champ : l’attribution reste une estimation prudente, fondée sur qui est devant le miroir.

Avec « Cornelius » ouvert à tout le monde, personne n’est reconnu, sauf si la case **Reconnaître la personne pendant la conversation** est cochée (voir [Ouverture et présence](ouverture-et-presence.md#reconnaître-la-personne-pendant-la-conversation)). Dans ce cas, la personne reconnue retrouve sa mémoire, et ses paroles ne sont retenues que tant qu’elle reste seule et visible par la caméra.

## Comment les souvenirs sont choisis

Pendant la conversation, le texte de ce que dit la personne reste en mémoire vive sur l’ordinateur. Il n’est jamais écrit sur le disque.

Après la conversation, ce texte et les souvenirs actuels de la personne sont envoyés au fournisseur mémoire choisi, qui propose quoi retenir, corriger ou oublier. La dernière phrase de Cornelius avant chaque réponse l’accompagne, pour comprendre une réponse courte. Cornelius vérifie ensuite que chaque proposition s’appuie bien sur des phrases de cette personne, puis l’enregistre. Le texte de la conversation est alors effacé : seul reste, pour chaque souvenir, le nombre de phrases à son origine.

## Qui lit la conversation

Le fournisseur mémoire se choisit dans **Mise en route → Clés et jetons → Mémoire personnalisée** : OpenAI (par défaut), Mistral, ou une API compatible OpenAI, par exemple un modèle installé sur une machine de la maison. On y renseigne l’URL de base, la clé `CUSTOM_OPENAI_API_KEY` et le modèle ; « Détecter les modèles » les liste depuis le serveur, ou le modèle se saisit à la main. Ce choix ne change ni le fournisseur de la conversation ni la génération d’images.

Une proposition reçue est vérifiée avec le même schéma avant d’être appliquée, quel que soit le fournisseur.

Le champ **Secours mémoire** décide où va l’extraction quand le serveur personnalisé ne répond pas : « Aucun » (par défaut avec ce fournisseur), OpenAI ou Mistral. Avec « Aucun », rien n’est envoyé ailleurs et la conversation concernée ne produit tout simplement aucun souvenir. Un serveur de la maison attend 55 secondes avant de céder, comme avec OpenAI.

Comme avec les autres services, **Bloquer les services IA** arrête les extractions en cours et empêche les suivantes, y compris vers un serveur local.

Ne sont pas retenus : les suppositions, les secrets et mots de passe, les questions, les citations, les faits sur d’autres personnes. Les paroles de Cornelius, ce que voit la caméra et les résultats des modules ne deviennent jamais des souvenirs. Une extraction ne modifie aucun autre réglage.

Demander à voix haute d’ajouter, de corriger ou d’oublier quelque chose est seulement une proposition, traitée après la conversation. Cornelius ne confirme pas un changement avant qu’il soit appliqué. Pour un oubli immédiat, passez par l’administration.

Bloquer les services IA, ou arrêter Cornelius, annule les extractions en cours.

## Comment Cornelius s’en sert

Aucun souvenir n’est donné à Cornelius à l’ouverture de la conversation. Quand une question porte sur un souvenir, il les consulte, par mots-clés ou parmi les plus récents, dix au plus à la fois. Il ne peut consulter que les souvenirs de la personne seule et reconnue devant le miroir.

## Le consentement à la création du profil

En ajoutant une personne dans **Le foyer et les visages → Une nouvelle personne**, la case **Laisser Cornelius retenir des souvenirs pour cette personne (extraits par OpenAI après la conversation)** est cochée au départ. Décochez-la pour créer le profil sans mémoire. Ce choix reste modifiable à tout moment dans la rubrique **Mémoire**.

## Gérer la mémoire

Dans l’administration, rubrique **Mémoire**, choisissez la personne dans la liste **Souvenirs de**. Chaque personne a ses propres souvenirs.

La carte **Mémoire de …** propose :

- **Autoriser la mémoire** : activé, Cornelius peut retenir des faits et s’en servir quand on le lui demande. Désactivé, il ne retient plus rien et ne consulte plus ces souvenirs ; ils restent visibles dans l’administration.
- **Actualiser les souvenirs** : recharge la liste et le résultat des dernières analyses.
- **Écrire un fait permanent** : mène aux repères de la personne, dans **Personnaliser Cornelius** (voir plus bas).
- **Tout oublier** : efface tous les souvenirs de la personne, après confirmation. C’est définitif.

Sous la carte :

- **Rechercher un souvenir** filtre la liste par sujet ou par texte.
- Chaque souvenir indique son sujet, son texte et son origine (« Retenu de … phrases dites par … » ou « Corrigé dans l’administration »). Un souvenir temporaire porte sa date d’expiration.
- **Corriger** permet de modifier le **Sujet**, le **Souvenir** et la **Durée** (**Durable** ou **Temporaire**, avec une **Expiration**).
- **Oublier** efface ce souvenir, après confirmation. C’est définitif.

Le repli **Ce que Cornelius a retenu récemment** donne le résultat de l’analyse après chaque conversation : Analyse en cours, Conversation analysée, Proposition écartée, Analyse impossible ou Analyse annulée.

Corriger, oublier ou changer l’autorisation ferme la conversation en cours avec cette personne, pour qu’elle reparte avec la mémoire à jour. Si la mémoire a changé entre-temps (par une analyse qui vient de finir, par exemple), l’administration recharge la liste et demande de recommencer.

## Conservation et effacement

- Les souvenirs sont conservés sur l’ordinateur du miroir, dans la base de Cornelius. Une personne peut en avoir 256 au plus.
- Un souvenir temporaire disparaît à son expiration.
- **Oublier** et **Tout oublier** effacent aussi le souvenir des copies de sécurité de la base, celles que Cornelius crée avant une mise à jour de la base.
- Supprimer une personne dans **Le foyer et les visages** efface ses souvenirs avec le reste de son profil, copies de sécurité comprises.
- Désactiver la mémoire n’efface rien.

Voir aussi [Confidentialité](../reference/confidentialite.md).

## Souvenirs et repères

La mémoire et les repères de **Personnaliser Cornelius → Ce qu’il faut savoir sur …** sont deux choses différentes :

| | Souvenirs | Repères |
| --- | --- | --- |
| Qui les écrit | Cornelius, après une conversation (vous pouvez les corriger) | Vous, dans l’administration |
| Quand Cornelius les utilise | Quand une question porte sur un souvenir | Dans toute conversation où la personne est reconnue |
| Exemple | « Préfère les réponses courtes » | « Mon bureau, c’est la pièce Pivoine » |

Pour un fait qui doit toujours être connu, préférez un repère : il ne dépend pas d’une analyse. Voir [La personnalité](personnalite.md).

## Voir aussi

- [La personnalité](personnalite.md)
- [Ouverture et présence](ouverture-et-presence.md)
- [L’administration](../utilisation/administration.md)
- [Confidentialité](../reference/confidentialite.md)
- [Architecture](../developpement/architecture.md)
