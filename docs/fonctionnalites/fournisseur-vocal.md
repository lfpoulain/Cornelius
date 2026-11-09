# Le fournisseur vocal

La conversation de Cornelius passe par un service en ligne qui écoute, comprend et parle. Par défaut, c’est GPT-Live d’OpenAI. Mistral (Voxtral 3) est proposé en option. Cette page explique comment choisir entre les deux, ce que change Mistral, ce qu’il coûte et ses limites. Elle s’adresse à la personne qui règle le miroir pour la maison.

## Choisir le fournisseur

1. Dans **Mise en route → Clés et jetons**, renseignez la clé du fournisseur : **Clé OpenAI** ou **Clé Mistral**. Le compte Mistral doit avoir accès à l’API Voice Agents. Aucun autre service n’est à configurer.
2. Dans la carte **Voix de Cornelius** (rubrique **Mise en route**), choisissez le **Fournisseur de la conversation** : « OpenAI · GPT Live » ou « Mistral · Voxtral 3 ».

Le changement s’applique à la conversation suivante. Il est refusé pendant une conversation, et tant que la clé du fournisseur choisi manque. Les deux clés sont gardées séparément : sans la clé du fournisseur choisi, aucune conversation ne s’ouvre, et Cornelius ne bascule jamais seul sur l’autre compte.

**Bloquer les services IA**, dans le panneau **Conversation**, coupe les deux fournisseurs à la fois.

## Ce que change Mistral

- **Voix et écoute.** Voxtral transcrit et parle en français, avec la voix Marie. Le choix de la voix GPT-Live ne s’applique pas.
- **Réponses et outils.** Mistral Small répond et appelle les mêmes outils que GPT-Live : modules, commandes, Home Assistant, agents Hermes, cartes, mémoire, e-mail. Ces outils restent exécutés par Cornelius, avec les mêmes autorisations et confirmations.
- **Mémoire.** L’extraction des souvenirs garde le choix de Mistral après la conversation, mais ce choix devient indépendant : il se règle dans **Mise en route → Clés et jetons → Mémoire personnalisée**. Voir [La mémoire](memoire.md).
- **Images.** La génération d’images « Avec OpenAI » garde la clé OpenAI.
- **Recherche web.** Elle est faite par Mistral. Les sources s’affichent sur la carte quand Mistral les renvoie ; aucun lien n’est déduit du texte de sa réponse.
- **Délégation.** La carte **Délégation : recherches et actions** disparaît : elle ne concerne que GPT-Live.
- **Son.** Le navigateur envoie le son du micro au serveur Cornelius, par une connexion liée à la conversation, et le serveur le transmet à Mistral. La clé ne quitte jamais le serveur. Les satellites audio gardent leur fonctionnement.

## Coût et durée des conversations

Mistral facture Voice Agents à la minute de conversation : 0,04 $ la minute avec Mistral Small 4, selon la [tarification de Mistral](https://docs.mistral.ai/inference/pricing#voice-agents). Pour ne pas payer une conversation oubliée :

- la conversation se ferme après 20 secondes sans parole, réponse ni outil, dans tous les modes d’ouverture ;
- elle dure 15 minutes au plus ;
- chaque fermeture supprime la session chez Mistral, y compris une ouverture interrompue.

La carte **Mise en route → Temps de conversation** compte les minutes passées avec Mistral et, si vous saisissez son prix par minute, en estime le coût. Le temps passé avec OpenAI, facturé aux jetons, est compté à part et sans coût. Ce n’est qu’une estimation : fixez vos limites dans votre compte Mistral.

## Limites de Mistral

- **L’écho.** Le son de Mistral est joué hors de l’annulation d’écho du navigateur. Avec un haut-parleur, Cornelius peut entendre sa propre voix et s’interrompre seul. Un casque, ou un micro de conférence avec annulation d’écho intégrée, évite ce problème.
- **L’interruption.** Elle attend la transcription de ce que vous dites, donc arrive plus tard qu’avec GPT-Live.
- **Micro gardé prêt.** Dire « Cornelius, allume la lumière » d’une traite ne fonctionne qu’avec GPT-Live.
- **Accueil.** Le salut d’ouverture suit le réglage (phrase imposée, phrase libre, ou silence). Une personne reconnue après l’ouverture est appelée par son prénom au tour suivant, sans nouveau salut.
- **Interventions spontanées.** Une information ajoutée pendant la conversation, comme la fin d’une tâche Hermes, est prise en compte au tour suivant. Elle ne déclenche pas forcément une prise de parole.
- **Certificats.** Sous Linux, le paquet `ca-certificates` doit être installé : la connexion audio à Mistral en a besoin.

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
- [Configuration](../reference/configuration.md) : `OPENAI_API_KEY` et `MISTRAL_API_KEY`.
