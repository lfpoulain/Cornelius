# Choisir OpenAI ou Mistral pour la voix

Dans **Administration → Mise en route**, renseignez la **Clé Mistral** dans **Clés et jetons**, puis choisissez **Mistral · Voxtral 3** dans **Voix de Cornelius → Fournisseur de la conversation**. Le compte Mistral doit avoir accès à l’API Voice Agents. Aucun identifiant LiveKit ni service supplémentaire n’est à configurer.

OpenAI reste le choix par défaut. Les deux clés sont conservées séparément côté serveur. Le changement de fournisseur exige de terminer la conversation en cours. Supprimer une clé la rend indisponible pour les prochaines conversations ; le fournisseur ne bascule jamais silencieusement sur l’autre compte.

Avec Mistral, Voxtral transcrit et parle en français avec la voix Marie. Mistral Small traite les réponses et appelle les outils existants de Cornelius. Les confirmations, les droits des profils, Home Assistant, Hermes, les modules, les cartes et les contrôles de mémoire restent exécutés par Cornelius. L’extraction des souvenirs utilise aussi Mistral. La génération d’images OpenAI utilise toujours sa propre clé.

Le navigateur envoie son audio au serveur Cornelius par une connexion WebSocket authentifiée et liée à la conversation ; les clés ne lui sont jamais transmises. Le serveur rejoint la session Mistral avec le SDK officiel et convertit le PCM16 mono de Cornelius (16 kHz) au format du SDK (48 kHz). Les satellites gardent leur protocole audio existant.

Le système qui exécute Cornelius doit fournir les certificats racine du système (`ca-certificates`) au transport TLS de LiveKit. Le SDK Mistral applique les mises à jour de contexte au prochain tour. Une notification Hermes reçue hors d’un appel d’outil ne déclenche donc pas nécessairement une prise de parole spontanée. Les citations web sont affichées lorsque l’outil Mistral renvoie des sources structurées ; aucun lien n’est déduit du texte du modèle.

## Vérification réelle

Après avoir ajouté une clé disposant de l’accès Voice Agents :

1. Choisir Mistral, ouvrir le miroir et activer le microphone.
2. Dire « Cornelius, quelle heure est-il ? » et vérifier la réponse vocale et la carte du module.
3. Poser une autre question, puis interrompre la réponse à voix haute.
4. Tester une lecture Home Assistant et une demande Hermes autorisées.
5. Fermer la conversation, vérifier le retour en veille, puis essayer OpenAI.

Les tests automatisés simulent les fournisseurs : ils valident les frontières de session, les outils, les conversions audio, les interruptions et les préférences, mais ne prouvent pas l’accès du compte Mistral ni l’acoustique du microphone réel.

## Coût et durée des sessions Mistral

La [tarification officielle](https://docs.mistral.ai/inference/pricing#voice-agents) facture Voice Agents à la minute de conversation : **0,04 $/min avec Mistral Small 4** et 0,08 $/min avec les modèles plus grands. Voxtral Realtime apparaît séparément à 0,008 $/min et Voxtral TTS 3 à 13 $/million de caractères ; Voice Agents regroupe la chaîne sous son tarif de conversation.

La [documentation du cycle de vie](https://docs.mistral.ai/studio/audio/voice-agents/sessions#lifecycle) précise que `close()` quitte la room et supprime la session côté serveur avec `DELETE /v1/audio/sessions/{id}`. Cornelius appelle donc la fermeture distante dès l’arrêt, la perte du navigateur ou l’échec du microphone. Pour éviter de facturer une session oubliée, le fournisseur Mistral active la fin après 20 secondes sans parole, réponse ou outil dans tous les modes, et applique une limite absolue de 15 minutes. Une connexion interrompue avant d’être prête est supprimée immédiatement.

## Limites de Mistral

L’interruption dépend de l’arrivée d’une transcription et peut donc être retardée. Le PCM joué dans le navigateur ne bénéficie pas de l’annulation d’écho WebRTC d’OpenAI ; utilisez un casque si le haut-parleur déclenche de fausses interruptions.

L’accueil initial respecte le réglage : phrase imposée, phrase libre générée selon la personnalité, ou silence. Une identité reconnue après la connexion actualise le contexte au prochain tour, sans déclencher de salut spontané. Les ajouts de contexte sont limités aux 16 000 derniers caractères ; les instructions de base et les règles du fournisseur sont conservées.
