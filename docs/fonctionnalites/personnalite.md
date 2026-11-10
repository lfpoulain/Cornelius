# La personnalité

Cette page explique comment régler le caractère de Cornelius pour toute la maison, sa façon de parler à chaque personne, et les repères qui l’aident à comprendre les demandes de chacun. Elle s’adresse à la personne qui règle le miroir.

## Où se trouve le réglage

Tout se règle dans l’administration, rubrique **Personnaliser Cornelius**. On y arrive aussi depuis **Le foyer et les visages**, avec le bouton **Personnaliser Cornelius** de chaque personne ou **Personnaliser Cornelius pour le foyer**.

En haut de la rubrique, la liste **Personnaliser pour** choisit ce que vous réglez :

- **Tout le foyer** : le style commun, pour tout le monde ;
- le prénom d’une personne : ses préférences et ses repères.

Changer de personne affiche ses réglages, sans rien modifier. Tant que des modifications ne sont pas enregistrées, la liste est verrouillée : enregistrez ou annulez d’abord.

## Le caractère par défaut

Sans réglage, Cornelius parle français, avec chaleur et concision, et glisse parfois de petites interjections (« mmh, je vois », « ah oui »). Pendant qu’il attend un résultat (météo, recherche, commande), il ne se contente jamais d’un « un instant » ou d’un « je recherche » sec : il peut dire qu’il cherche, mais il réfléchit à voix haute, avec des tournures à rallonge comme « bien sûr, c’est une très bonne question, évidemment, je pense tout de suite à… », jusqu’à l’arrivée du résultat, sans annoncer de fait avant lui. Il parle toujours en français de France (heures, dates et nombres dits à la française) et ne change de langue que si on le lui demande clairement. Sa voix se choisit dans **Personnaliser Cornelius → Voix de Cornelius** (Cedar par défaut, Marin aussi conseillée pour le français). Le style du foyer et celui de chaque personne s’ajoutent à ce caractère.

## Le style du foyer

Avec **Tout le foyer**, la carte **Style commun du foyer** propose le champ **Comment parler à tout le monde** : le ton, l’humour, le tutoiement ou le vouvoiement, la longueur des réponses.

Ce style s’applique à toute la maison, y compris aux personnes que Cornelius ne reconnaît pas. Laissé vide, Cornelius garde son caractère par défaut ; le bouton **Revenir au caractère par défaut** vide le champ.

Des **Idées** ajoutent une consigne d’un clic : Tutoiement, Vouvoiement, Réponses courtes, Humour léger, Sans répétitions. Choisir Tutoiement remplace Vouvoiement, et inversement.

## Le style d’une personne

Avec le prénom d’une personne, la carte **Réglages de …** propose deux champs. Le premier, **Comment parler à …**, règle le style pour cette personne : tutoiement ou vouvoiement, longueur des réponses, ton, humour. Les idées proposées sont Tutoiement, Vouvoiement, Réponse courte d’abord, Plus de détails et Ton direct.

Le style d’une personne s’ajoute à celui du foyer. En cas de désaccord, il l’emporte.

Tant que rien n’est enregistré pour elle, l’encadré **Hérité du foyer** montre le style qu’elle reçoit : celui du foyer, ou le caractère par défaut s’il n’y a pas de style commun. Le bouton **Revenir au style du foyer** vide le champ.

Ces réglages ne s’appliquent que lorsque la caméra reconnaît la personne. Si aucun visage n’est mémorisé pour elle, un message le signale, avec le bouton **Mémoriser le visage de …**.

## Ce qu’il faut savoir sur une personne

Le second champ, **Ce qu’il faut savoir sur …**, contient des repères : des faits, pas des consignes. Par exemple :

- « Quand je dis « mon bureau », je parle de la pièce appelée Pivoine. »
- « « Le grand » désigne mon fils Noé. »

Cornelius s’en sert pour comprendre la personne, sans les réciter. Ces repères :

- ne sont transmis que lorsque la caméra reconnaît cette personne, y compris quand elle est reconnue en cours de conversation ;
- ne sont jamais donnés au foyer, aux visiteurs ni aux autres personnes ;
- n’autorisent aucun appareil supplémentaire : pour piloter la maison, Cornelius choisit parmi les appareils déjà autorisés dans Home Assistant, ou demande une précision.

Le bouton **Effacer les repères** vide le champ ; enregistrez ensuite pour confirmer. Le bouton **Voir ce que Cornelius a retenu** mène à la mémoire de la personne.

## Priorités et limites

- Chaque champ accepte 4 000 caractères au plus. Un compteur l’indique sous le champ.
- Le style règle la manière de parler. Il ne change jamais les règles de silence, la confidentialité ni les confirmations demandées avant une action.
- Ces textes sont des préférences déclarées, pas des faits observés ni des souvenirs.
- Ils sont transmis à la conversation et au modèle qui fait les recherches et les actions pour Cornelius.

## Enregistrer et effet sur une conversation en cours

La barre d’enregistrement apparaît dès qu’un champ change. L’enregistrement s’applique aussitôt.

Si une conversation est en cours avec la personne concernée (ou avec n’importe qui, pour le style du foyer), elle se ferme puis se rouvre tout de suite avec les nouveaux réglages.

## Ce que Cornelius reçoit

La carte **Ce que Cornelius reçoit** montre, pour les réglages enregistrés, le texte complet transmis au modèle au début de chaque conversation :

- **Conversation**, pour les réponses orales ;
- **Recherches et actions**, pour les demandes qui utilisent des outils.

Vos réglages y apparaissent surlignés, à la fin. Cornelius ne prononce jamais ces textes. « Luna » y désigne le modèle chargé des recherches et des actions, réglé dans **Voix et modèles → Délégation : recherches et actions**.

Les fichiers qui construisent ces textes sont décrits dans [Les prompts](../developpement/prompts.md).

## Conservation

Le style et les repères sont conservés sur l’ordinateur du miroir, dans la base de Cornelius, et transmis à OpenAI pour la conversation. Supprimer une personne dans **Le foyer et les visages** efface aussi son style et ses repères.

Les repères sont distincts de la mémoire. Vous les écrivez vous-même et ils restent tels quels. La mémoire, elle, est retenue après les conversations (voir [La mémoire](memoire.md)).

## Voir aussi

- [La mémoire](memoire.md)
- [Ouverture et présence](ouverture-et-presence.md)
- [Home Assistant](home-assistant.md)
- [L’administration](../utilisation/administration.md)
- [Les prompts](../developpement/prompts.md)
- [Confidentialité](../reference/confidentialite.md)
