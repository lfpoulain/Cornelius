# Album Google Photos dans l’écran de veille

L’écran de veille peut afficher un album Google Photos partagé à la place des images locales.
Il s’agit d’une connexion **expérimentale et non officielle** : Cornelius lit la page de partage,
sans API Google Photos, sans clé API, sans OAuth et sans accès à votre compte Google.
Google peut changer cette page et rendre le connecteur inutilisable.

L’intégration fait partie du cœur de l’écran de veille : le contrat actuel des modules ne
permet que des présentations de texte ou de valeurs et ne fournit aucun point d’extension pour
remplacer le diaporama plein écran. Le choix entre images locales et Google Photos reste dans
la rubrique « Orbe et écran de veille » de l’administration.

## Choisir l’album

1. Dans Google Photos, ouvrez l’album souhaité, puis choisissez **Partager → Créer un lien**.
2. Vérifiez que ce lien s’ouvre dans une fenêtre privée sans connexion à Google.
3. Dans Cornelius, ouvrez **Administration → Écran de veille → Source des images**.
4. Choisissez **Album Google Photos**, collez le lien partagé et réglez l’actualisation
   (30 minutes par défaut, entre 5 minutes et 24 heures).
5. Choisissez **Enregistrer**. Le nombre de photos, la dernière vérification et un aperçu
   indiquent le résultat. Activez aussi **Afficher des images au repos**.

Les liens `https://photos.app.goo.gl/…` et les liens longs
`https://photos.google.com/share/…?key=…` sont acceptés. L’adresse privée `/album/…` ne convient pas.
Pour changer de galerie, remplacez le lien et enregistrez. **Actualiser maintenant** relit l’album
enregistré, au plus une fois par minute. Les ajouts et suppressions sont pris en compte à la
prochaine vérification réussie, même si le miroir est déjà ouvert.

**Toute personne possédant le lien partagé peut consulter l’album.** Utilisez un album dédié
aux photos qui peuvent apparaître sur cet écran partagé. Désactivez la collaboration dans
Google Photos si les visiteurs ne doivent pas ajouter de contenu.

L’administration affiche cet avertissement de manière visible lors du choix de la source
Google Photos. Un lien partagé ne doit pas être traité comme un album privé authentifié.

## Évolution prévue : Google Photos Ambient API

Une prochaine évolution envisagée est une connexion officielle à **Google Photos Ambient API**,
pour choisir des albums depuis le parcours Google et afficher les photos avec l’autorisation du
compte, sans devoir fournir de lien d’album partagé.

Elle dépend d’une acceptation préalable de Cornelius dans le **programme partenaire Google
Photos**. Avant le lancement de cette intégration, Google demande aussi la vérification OAuth
et une revue de l’intégration Google Photos. Une simple clé API ne débloque pas cet accès.
Cette évolution n’est pas incluse dans le connecteur expérimental actuel et son admission
par Google n’est pas acquise. Voir les [conditions du programme partenaire](https://developers.google.com/photos/partner-program/overview)
et le [parcours Ambient API](https://developers.google.com/photos/ambient/guides/get-started).

## Affichage et limites

- Les photos sont demandées à Google par le serveur Cornelius. Un cache uniquement en mémoire
  conserve les images téléchargées pendant 5 minutes au maximum, dans une limite de 32 Mio.
  Les demandes simultanées de la même photo partagent un téléchargement ; jusqu’à 8 photos
  distinctes peuvent être téléchargées à la fois. Une photo indisponible (y compris une réponse
  404 lors d’une saturation) est sautée au profit de la suivante, avec ou sans WebGL.
  Ce relais permet les transitions existantes sans ouvrir le navigateur à des domaines tiers.
- Aucun fichier photo Google n’est ajouté à `data/screensaver/`. Le serveur garde seulement
  la liste et le cache en mémoire, avec une taille demandée de 2560 × 2560
  au maximum. Le navigateur garde nécessairement l’image affichée en mémoire.
- Seule la page initiale de l’album est lue, avec un maximum de 500 entrées. Les grands albums
  peuvent être incomplets : la pagination interne de Google n’est pas prise en charge.
- Les vidéos ne sont pas lues. Une vignette peut apparaître si Google la présente comme une image.
- En cas de coupure réseau, de délai dépassé ou de réponse HTTP 408, 429 ou 5xx, la dernière
  liste connue est conservée. L’administration signale l’erreur et une nouvelle tentative est faite
  après environ une minute, puis le rythme configuré reprend après une lecture réussie.
  Le cache ne garantit pas un diaporama complet hors connexion : seules les images encore en
  cache peuvent être servies, et les autres sont sautées.
- Un album vide, un partage refusé ou supprimé (notamment HTTP 403, 404 ou 410), une page de
  consentement ou un format non reconnu produit une erreur et retire la liste et le cache.
  Les suppressions et changements d’adresse de photo invalident aussi les entrées concernées
  après une actualisation réussie. Un changement de source ou de lien vide le cache.
  Une image déjà chargée dans le navigateur peut rester visible pendant la transition de sortie.
  Le miroir utilise temporairement les images locales si aucune photo distante ne peut être affichée. La source configurée reste Google Photos et le miroir reprend l’album dès que possible.
- Le serveur ne détecte pas immédiatement une suppression ou la révocation du partage :
  cette détection dépend de l’actualisation. Il ne peut pas effacer une image déjà reçue par un appareil.

Choisissez **Images locales**, puis **Enregistrer**, pour retrouver les photos et les peintures
précédentes. Elles ne sont pas supprimées par le changement de source. Pour oublier aussi le lien,
effacez le champ avant d’enregistrer.

## Données et réseau

Le lien de partage et les réglages sont conservés dans la base SQLite locale et ses sauvegardes.
Ils sont accessibles à l’administration, jamais à la conversation ni à l’état public du miroir.
Les erreurs ne contiennent ni lien partagé ni adresse de photo. Protégez la base et ses sauvegardes.

Le serveur doit pouvoir joindre en HTTPS `photos.app.goo.gl`, `photos.google.com` et
`lh3.googleusercontent.com` à `lh6.googleusercontent.com`. Les hôtes, chemins et redirections
sont vérifiés sur chaque requête ; les réponses ont une durée et une taille limitées. Aucun cookie
Google n’est envoyé. Le lien de l’album et les photos ne sont pas transmis aux fournisseurs IA.

## Vérifier une contribution

Les tests utilisent uniquement des données synthétiques. Ne joignez aucun lien privé, cookie,
photo personnelle ou page HTML réelle dans un ticket ou une demande de fusion.

Pour la recette manuelle, utilisez un album de test partagé : vérifiez l’aperçu puis le diaporama,
ajoutez et retirez une photo, actualisez après une minute, rechargez le miroir et redémarrez le
serveur. Vérifiez aussi une coupure réseau et la désactivation du partage. Revenez enfin aux
images locales. Les tests automatiques ne garantissent pas que Google conserve son format.
