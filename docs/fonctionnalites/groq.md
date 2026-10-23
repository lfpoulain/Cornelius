# Utiliser Groq

Cornelius peut utiliser une clé [Groq](https://console.groq.com/keys) pour la conversation et la mémoire personnelle, sans clé OpenAI. Ce mode est destiné au miroir dans le navigateur. OpenAI reste le fournisseur par défaut.

## Activer

1. Installez une voix de synthèse française sur l’ordinateur qui affiche le miroir. Le navigateur doit l’exposer comme une voix **locale** via Web Speech (`speechSynthesis`). Sa disponibilité dépend du système et du navigateur ; vérifiez-la avant de choisir ce mode. Une voix distante n’est pas acceptée.
2. Ajoutez `CORNELIUS_AI_PROVIDER=groq` dans le fichier `.env`, à la racine de Cornelius.
3. Redémarrez Cornelius avec `scripts/restart.sh` (ou le script PowerShell correspondant).
4. Dans **Mise en route → Clés et jetons**, collez votre **Clé Groq**. Elle compte immédiatement. Vous pouvez aussi définir `GROQ_API_KEY` dans `.env` puis redémarrer ; une valeur saisie dans l’administration passe avant celle du fichier.
5. Ouvrez le miroir, cliquez sur **Activer la voix** et autorisez le microphone. Après votre phrase, laissez une courte pause : Cornelius transcrit, prépare puis lit la réponse.

Les modèles par défaut sont `whisper-large-v3-turbo` pour la transcription et `openai/gpt-oss-20b` pour la conversation et la mémoire. Malgré son nom, ce dernier est servi par **Groq** : aucune requête de conversation ne part chez OpenAI. Pour les changer, définissez `CORNELIUS_GROQ_TRANSCRIPTION_MODEL` et `CORNELIUS_GROQ_MODEL`, puis redémarrez. Le modèle de conversation doit accepter les appels de fonctions et le mode JSON.

Pour revenir au parcours vocal OpenAI, remplacez la valeur par `CORNELIUS_AI_PROVIDER=openai` et redémarrez. Les deux clés restent indépendantes.

## Fonctionnement et différences

- La transcription est française. La fin de phrase est détectée par l’énergie audio après environ 700 ms de silence ; un environnement calme améliore le résultat. Chaque extrait est limité à 30 secondes.
- La conversation fonctionne par tours : le micro n’est pas transmis pendant le traitement ou la lecture. Attendez la fin de la réponse pour parler à nouveau. L’interruption vocale et le tampon avancé du parcours OpenAI ne sont pas disponibles.
- Les cartes, les modules, la mémoire, la vision locale et les commandes autorisées utilisent les contrôles habituels du serveur.
- La recherche web native OpenAI, les modes de vitesse de délégation OpenAI, le choix des voix GPT-Live et les satellites audio ne s’appliquent pas à Groq. Les satellites sont refusés avec un message explicite. La voix dépend des voix françaises locales installées, et la sortie audio est celle du système.
- La génération d’images locale reste disponible. Le choix « Avec OpenAI » conserve sa clé OpenAI distincte.
- Une erreur de clé ou de quota ferme la session avec un diagnostic, sans rejouer automatiquement une requête ni une action.

## Confidentialité

La clé reste côté serveur. Le son part vers Groq seulement pendant un tour de conversation ouvert ; les extraits, l’historique et les transcriptions restent en mémoire vive. Les voix distantes du navigateur sont refusées. La fermeture de session, le blocage des services IA ou le changement de clé annulent les requêtes en cours et écartent leurs résultats tardifs. Voir [Confidentialité](../reference/confidentialite.md).

## Références du fournisseur

- [Compatibilité OpenAI de Groq](https://console.groq.com/docs/openai)
- [Transcription](https://console.groq.com/docs/speech-to-text)
- [Modèles](https://console.groq.com/docs/models)
- [Synthèse vocale Groq](https://console.groq.com/docs/text-to-speech) : anglais et arabe, d’où le choix d’une voix française locale.
