# Caméra de l’appareil qui affiche le miroir

Par défaut, Cornelius utilise une caméra branchée au serveur. Vous pouvez choisir à la place la caméra du Mac, du PC, de la tablette ou du téléphone qui affiche le miroir, sans installer Python sur cet appareil. La perception Python reste nécessaire sur le serveur.

## Mise en route

1. Dans **Caméra et reconnaissance → Emplacement de la caméra**, choisissez **Sur l’appareil qui affiche le miroir**.
2. Ouvrez le miroir sur cet appareil, en HTTPS sur le réseau local (ou HTTP sur localhost). Autorisez d’abord l’appareil comme miroir avec le mot de passe administrateur si demandé.
3. Acceptez l’autorisation caméra du navigateur si elle est demandée. La caméra par défaut démarre automatiquement, sans commande ajoutée au miroir. Activez aussi la voix pour parler à Cornelius.

Le mode de veille de Cornelius continue de décider quand une caméra est nécessaire. Si la caméra est suspendue par ce mode, le périphérique est libéré et reprend à son prochain allumage, tant que la page reste ouverte. Le retour à **Sur le serveur Cornelius** retrouve la caméra locale précédemment choisie.

## Transport et confidentialité

Les images JPEG voyagent sur un WebSocket dédié, chiffré en WSS sur le réseau local, vers le serveur Cornelius, puis vers sa perception par la boucle locale. Il n’y a ni serveur relais externe, ni port supplémentaire à ouvrir, ni clé de perception transmise au navigateur. La route exige la même origine, un appareil autorisé et le miroir actif. Une nouvelle page du miroir retire l’ancien flux ; une page d’administration ne peut pas produire d’images.

Les images sont traitées en mémoire par les mêmes modèles que la caméra du serveur : présence, regard, reconnaissance, enregistrement des signatures de visage et analyse de scène selon vos réglages. Elles ne sont pas enregistrées et ne sont pas envoyées à OpenAI. Les descriptions de scène peuvent entrer dans le contexte de conversation comme avec la caméra du serveur.

Le flux est limité à 10 images/s, 1920 × 1080 et 250 000 octets par image. Une seule image peut être en vol : l’image suivante attend la confirmation de décodage de la perception. Le flux caméra est séparé de l’audio et des événements. Une image vieille de plus de deux secondes est inutilisable ; une interruption de cinq secondes ferme le flux et réinitialise la capture. La reconnexion utilise un délai progressif borné. Aucun retard d’images n’est rejoué.

## Dépannage

- **Service caméra arrêté** : lancez la perception sur le serveur ; la caméra du navigateur remplace le périphérique de capture, pas les modèles d’analyse.
- **Accès refusé** : vérifiez l’autorisation caméra dans le navigateur, puis réessayez.
- **Caméra introuvable** : choisissez une caméra disponible ou la caméra par défaut.
- **Caméra en pause** : vérifiez que cette page est le miroir actif et que la connexion est établie. Certains navigateurs suspendent la capture en arrière-plan : gardez le miroir visible.
- **Image trop volumineuse** : réduisez la résolution dans l’administration.

Aucun flux ne revient silencieusement à la caméra du serveur en cas de panne : le choix reste explicite et l’absence d’images fait apparaître la perception comme indisponible.
