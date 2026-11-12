# Glossaire

Cette page définit les mots employés dans l’administration, la documentation et le code de Cornelius. Elle s’adresse à tous les lecteurs, en particulier à ceux qui découvrent le projet. Les termes sont rangés par ordre alphabétique.

## Termes

**Addon.** Nom d’un module dans le code (dossier `addons/`). Voir « Module ».

**Agent Hermes.** Assistant personnel externe, relié à une personne du foyer, à qui Cornelius confie des demandes longues. Voir [Les agents Hermes](../fonctionnalites/agents-hermes.md).

**Carte.** Encadré affiché sur le miroir pendant une conversation pour montrer une réponse : météo, passages, liste, image. Les cartes disparaissent avec la conversation.

**Commande HTTP.** Action configurée dans **Modules → Commandes HTTP** (ouvrir un portail, lancer une scène), que Cornelius exécute en appelant une adresse web. Voir [Les modules](../modules/README.md).

**Conversation, ou session.** Période pendant laquelle Cornelius écoute et répond, entre son ouverture et sa fermeture. La voix ne part chez OpenAI que pendant une conversation.

**Délégation.** Second modèle d’OpenAI, à qui le modèle vocal confie les recherches, les cartes et les commandes. Son mode se règle dans **Voix et modèles → Délégation : recherches et actions**.

**Foyer.** L’ensemble des personnes enregistrées dans **Le foyer et les visages**. Une source « du foyer » sert à tout le monde, même à une personne inconnue.

**GPT-Live.** Le modèle vocal d’OpenAI (`gpt-live-1`) qui écoute et parle pendant la conversation.

**Information permanente.** Information d’une source (heure, météo, passages) affichée sur le miroir sans demande vocale, quand **Afficher en permanence sur le miroir** est coché.

**Jeton.** Code d’accès personnel à un service (Météo Concept, PRIM, Home Assistant, Hermes). Les jetons des modules se placent dans `.env`. Voir [Configuration](configuration.md).

**LFM2.5-VL.** Modèle de vision de Liquid AI qui décrit la scène sur l’ordinateur, en trois tailles (450M, 1,6B et 3B). Voir [La vision locale](../fonctionnalites/vision-locale.md).

**Luna et Astra.** Noms des modèles de délégation dans le code (`gpt-6-luna`, `gpt-6-astra` pour le mode « Ultra rapide »). L’interface dit simplement « Cornelius ».

**Miroir.** La page affichée sur l’écran derrière le verre, à l’adresse `http://127.0.0.1:3000/`. Dans le code, son rôle s’appelle encore `kiosk`.

**Mise en route.** Rubrique de l’administration qui liste ce qu’il reste à faire avant la première conversation. Voir [Premier démarrage](../installation/premier-demarrage.md).

**Module.** Brique qui apporte des informations (Heure, Météo, Transports) ou une fonction (Web, Vision, Génération d’image, Home Assistant). Voir [Les modules](../modules/README.md).

**Mot d’appel.** Le mot « Cornelius », reconnu sur l’ordinateur par openWakeWord, qui peut ouvrir la conversation. Voir [Le mot d’appel](../fonctionnalites/mot-d-appel.md).

**Orbe.** La sphère animée au centre du miroir. Sa couleur et son mouvement indiquent si Cornelius attend, écoute, réfléchit ou parle. Voir [Le miroir](../utilisation/miroir.md).

**Perception.** Programme Python local (`perception/worker.py`) qui lit la caméra, reconnaît les visages, détecte la voix, entend le mot d’appel et fait tourner la vision. L’interface l’appelle « service caméra ».

**Présence.** Une personne est « présente » quand la caméra la voit de façon stable devant le miroir. La présence peut ouvrir la conversation. Voir [Ouverture et présence](../fonctionnalites/ouverture-et-presence.md).

**Profil.** Une personne du foyer, avec son nom, son visage, ses sources, ses souvenirs et ses réglages.

**Regard.** Une personne « regarde » le miroir quand son visage est tourné vers lui et assez proche. Le regard peut ouvrir la conversation.

**Repères.** Ce qu’une personne déclare dans **Personnaliser Cornelius** pour l’aider à comprendre ses demandes (« mon bureau, c’est Pivoine »). À ne pas confondre avec les souvenirs. Voir [La personnalité](../fonctionnalites/personnalite.md).

**Silero.** Modèle local qui détecte quand quelqu’un parle, pour savoir quand Cornelius doit écouter ou se taire.

**Source.** Un réglage précis d’un module, par exemple « la météo de Lyon » ou « le bus de l’école ». Une source appartient au foyer ou à une personne.

**Souvenir.** Fait retenu d’une conversation pour une personne reconnue, consultable dans la rubrique « Mémoire ». Voir [La mémoire](../fonctionnalites/memoire.md).

**Vie privée (mode).** Réglage qui ferme la conversation dès qu’une deuxième personne est devant le miroir.

**YuNet et SFace.** Modèles locaux qui détectent puis reconnaissent les visages. Seules des signatures numériques sont gardées, jamais de photo.

## Voir aussi

- [Index de la documentation](../README.md)
- [Configuration](configuration.md)
- [Confidentialité](confidentialite.md)
- [Architecture](../developpement/architecture.md)
