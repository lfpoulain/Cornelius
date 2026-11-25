# Le fournisseur vocal

La conversation de Cornelius passe par un service en ligne qui écoute, comprend et parle. Par défaut, c’est GPT-Live d’OpenAI. Mistral (Voxtral 3) et xAI (Grok Voice) sont proposés en option. Cette page explique comment choisir, ce que change chaque option, ce qu’elle coûte et ses limites. Elle s’adresse à la personne qui règle le miroir pour la maison.

## Choisir le fournisseur

1. Dans **Clés et accès → Clés et jetons**, renseignez la clé du fournisseur : **Clé OpenAI**, **Clé Mistral** ou **Clé xAI**. Le compte Mistral doit avoir accès à l’API Voice Agents ; le compte xAI se crée sur [console.x.ai](https://console.x.ai), avec des crédits prépayés. Aucun autre service n’est à configurer.
2. Dans la carte **Voix de Cornelius** (rubrique **Voix et modèles**), choisissez le **Fournisseur de la conversation** : « OpenAI · GPT Live », « Mistral · Voxtral 3 » ou « xAI · Grok Voice ».

Le changement s’applique à la conversation suivante. Il est refusé pendant une conversation, et tant que la clé du fournisseur choisi manque. Les clés sont gardées séparément : sans la clé du fournisseur choisi, aucune conversation ne s’ouvre, et Cornelius ne bascule jamais seul sur un autre compte.

**Bloquer les services IA**, dans le panneau **Conversation**, coupe tous les fournisseurs à la fois.

## Ce que change Mistral

- **Voix et écoute.** Voxtral transcrit et parle en français, avec la voix Marie. Le choix de la voix GPT-Live ne s’applique pas.
- **Réponses et outils.** Mistral Small répond et appelle les mêmes outils que GPT-Live : modules, commandes, Home Assistant, agents Hermes, cartes, mémoire, e-mail. Ces outils restent exécutés par Cornelius, avec les mêmes autorisations et confirmations.
- **Mémoire.** L’extraction des souvenirs garde le choix de Mistral après la conversation, mais ce choix devient indépendant : il se règle dans **Clés et accès → Clés et jetons → Extraction des souvenirs**. Voir [La mémoire](memoire.md).
- **Images.** La génération d’images « Avec OpenAI » garde la clé OpenAI.
- **Recherche web.** Elle est faite par Mistral. Les sources s’affichent sur la carte quand Mistral les renvoie ; aucun lien n’est déduit du texte de sa réponse.
- **Délégation.** La carte **Délégation : recherches et actions** disparaît : elle ne concerne que GPT-Live.
- **Son.** Le navigateur envoie le son du micro au serveur Cornelius, par une connexion liée à la conversation, et le serveur le transmet à Mistral. La clé ne quitte jamais le serveur. Les satellites audio gardent leur fonctionnement.

## Coût et durée des conversations

Mistral facture Voice Agents à la minute de conversation : 0,04 $ la minute avec Mistral Small 4, selon la [tarification de Mistral](https://docs.mistral.ai/inference/pricing#voice-agents). Pour ne pas payer une conversation oubliée :

- la conversation se ferme après 20 secondes sans parole, réponse ni outil, dans tous les modes d’ouverture ;
- elle dure 15 minutes au plus ;
- chaque fermeture supprime la session chez Mistral, y compris une ouverture interrompue.

La carte **Voix et modèles → Temps de conversation** compte les minutes passées avec Mistral et, si vous saisissez son prix par minute, en estime le coût. Le temps passé avec OpenAI, facturé aux jetons, est compté à part et sans coût. Ce n’est qu’une estimation : fixez vos limites dans votre compte Mistral.

## Limites de Mistral

- **L’écho.** Le son de Mistral est joué hors de l’annulation d’écho du navigateur. Avec un haut-parleur, Cornelius peut entendre sa propre voix et s’interrompre seul. Un casque, ou un micro de conférence avec annulation d’écho intégrée, évite ce problème.
- **L’interruption.** Elle attend la transcription de ce que vous dites, donc arrive plus tard qu’avec GPT-Live.
- **Micro gardé prêt.** Dire « Cornelius, allume la lumière » d’une traite ne fonctionne qu’avec GPT-Live.
- **Accueil.** Le salut d’ouverture suit le réglage (phrase imposée, phrase libre, ou silence). Une personne reconnue après l’ouverture est appelée par son prénom au tour suivant, sans nouveau salut.
- **Interventions spontanées.** Une information ajoutée pendant la conversation, comme la fin d’une tâche Hermes, est prise en compte au tour suivant. Elle ne déclenche pas forcément une prise de parole.
- **Certificats.** Sous Linux, le paquet `ca-certificates` doit être installé : la connexion audio à Mistral en a besoin.

## Ce que change xAI (Grok Voice)

Grok Voice suit le même chemin que Mistral : le son passe par le serveur Cornelius, qui ouvre la session chez xAI (`wss://api.x.ai/v1/realtime`, modèle `grok-voice-3.0`). La clé ne quitte jamais le serveur.

- **Voix.** La liste **Voix de Grok**, sous le choix du fournisseur, propose Eve, Ara, Sal, Rex et Leo. Elle s’applique à la conversation suivante. Le choix de la voix GPT-Live ne s’applique pas.
- **Réponses et outils.** Grok répond et appelle les mêmes outils que GPT-Live, exécutés par Cornelius avec les mêmes autorisations et confirmations. La carte **Délégation : recherches et actions** disparaît.
- **Recherche web.** Elle est faite par xAI, si elle est autorisée.
- **Son.** PCM 16 kHz dans les deux sens, sans rééchantillonnage. xAI envoie la voix d’une réponse plus vite qu’elle ne se joue : le serveur la transmet au navigateur au rythme de la lecture, et l’abandonne si vous reprenez la parole.
- **Détection de la parole.** Faite par xAI, avec un seuil de 0,6 (0,85 par défaut chez xAI, trop strict pour un micro à distance).
- **Coût et durée.** xAI facture Grok Voice à la minute : 0,08 $ US la minute selon la [tarification de xAI](https://docs.x.ai/developers/pricing), plus la recherche web. Comme avec Mistral, la conversation se ferme après 20 secondes sans activité et dure 15 minutes au plus. La carte **Temps de conversation** estime le coût du temps passé avec Grok si vous saisissez son prix par minute. xAI n’offre pas de suppression de session : à la fermeture, la connexion est simplement coupée.
- **Limites.** Comme avec Mistral : l’écho avec un haut-parleur, le micro gardé prêt (GPT-Live seulement), les informations ajoutées en cours de conversation prises en compte au tour suivant. La mémoire et les images gardent leur propre fournisseur.

## Vérifier avec un vrai compte

Les tests automatiques simulent Mistral : ils ne prouvent ni l’accès de votre compte, ni le comportement de votre micro. Après avoir ajouté la clé :

1. Choisissez Mistral, ouvrez le miroir et activez la voix.
2. Dites « Cornelius, quelle heure est-il ? » : la réponse doit être parlée, avec la carte du module.
3. Posez une autre question, puis coupez la réponse à voix haute.
4. Essayez une lecture Home Assistant et une demande Hermes autorisées.
5. Fermez la conversation, vérifiez le retour en veille, puis revenez à OpenAI.

## Voir aussi

- [Confidentialité](../reference/confidentialite.md) : ce qui part chez chaque fournisseur.
- [L’administration](../utilisation/administration.md) : les cartes **Clés et jetons** et **Voix de Cornelius**.
- [Configuration](../reference/configuration.md) : `OPENAI_API_KEY`, `MISTRAL_API_KEY` et `XAI_API_KEY`.
