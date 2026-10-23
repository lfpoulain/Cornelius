# Contribuer à Cornelius

Merci de vouloir améliorer Cornelius. Cette page résume comment proposer un changement et ce qu’il faut vérifier avant de l’envoyer. Le détail (environnement, organisation du dépôt, architecture, tests) est dans [docs/developpement/](docs/developpement/README.md).

## Proposer un changement

1. Pour un défaut ou une idée, ouvrez d’abord un ticket qui décrit le comportement observé, le comportement attendu et, si possible, un extrait du journal (rubrique **Journal** de l’administration, bouton **Exporter le journal filtré**). Relisez l’export avant de le joindre : il peut contenir des détails techniques de votre installation.
2. Créez une branche à partir de la branche principale, avec un changement par branche.
3. Écrivez ou adaptez les tests qui couvrent le changement.
4. Ouvrez une demande de fusion qui explique le but, ce qui change pour l’utilisateur et comment vous l’avez vérifié (y compris sur le matériel, si le changement touche la caméra, le micro ou la voix).

Ne joignez jamais `.env`, le dossier `data/`, une base SQLite, une clé ou un jeton.

## Avant d’envoyer

Les mêmes vérifications tournent automatiquement à chaque envoi (`.github/workflows/check.yml`) :

```sh
npm run format:check
npm test
npm run build
npm run test:e2e
.venv/bin/python -m unittest discover -s tests/python -p "test_*.py" -v
shellcheck -x scripts/*.sh
```

`npm run format` corrige le formatage. La première fois, `npx playwright install chromium` installe le navigateur des tests. Voir [Tests et recette](docs/developpement/tests-et-recette.md) pour les commandes Windows et la recette manuelle. Le générateur du mot d’appel est un projet séparé, [wakeword-generator](https://github.com/lfpoulain/wakeword-generator), qui reçoit ses propres contributions.

## Conventions

- TypeScript strict ; aucun avertissement de `npm run check`.
- Textes en français (interface, messages, documentation), phrases courtes, sans tiret long.
- Outils vocaux nommés `<module>__<outil>`.
- Migrations SQLite ajoutées à la fin de la liste de `server/storage.ts`, jamais modifiées une fois publiées, et rejouables.
- Secrets jamais dans le client ni les journaux. Seuls les clés OpenAI et Groq et les jetons des modules peuvent être saisis dans l’administration (table `secrets`) ; le reste vit dans `.env`.
- Un nouveau module s’écrit dans [cornelius-modules](https://github.com/lfpoulain/cornelius-modules), à partir de son gabarit : voir [Créer un module](https://github.com/lfpoulain/cornelius-modules/blob/main/docs/creer-un-module.md). Toute évolution du contrat des modules met à jour [la référence](docs/modules/reference.md) dans le même changement.
- Si vous changez un libellé de l’interface, une valeur par défaut ou une commande, mettez à jour la documentation qui la cite et ajoutez une ligne à `CHANGELOG.md`.

## Licence des contributions

Cornelius est sous [PolyForm Noncommercial License 1.0.0](LICENSE) : partage et modification permis avec citation, usage commercial interdit. En proposant un changement, vous confirmez en être l’auteur ou avoir le droit de le proposer, et vous acceptez qu’il soit distribué sous cette licence. Vous autorisez aussi les auteurs de Cornelius à le distribuer sous d’autres conditions, notamment dans une licence commerciale accordée par écrit. Après un ajout ou une mise à jour de dépendance npm, lancez `npm run notices` pour tenir [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) à jour (un test le vérifie) ; une nouvelle ressource de tiers copiée dans le dépôt (police, image, code) y gagne une ligne avec sa notice.

## Voir aussi

- [Développer Cornelius](docs/developpement/README.md)
- [Architecture](docs/developpement/architecture.md)
- [Feuille de route](docs/developpement/feuille-de-route.md)
- [Documentation](docs/README.md)
