# Les alarmes et les rappels

Cornelius tient les réveils, les minuteurs et les pense-bêtes du foyer et de chaque personne. On les règle à la voix ou dans l’administration, ils sonnent sur le miroir à l’heure dite, et Cornelius les annonce à la bonne personne. Cette page explique comment les régler, ce qui se passe quand ça sonne, ce qu’affiche le miroir, et ce qui arrive pendant un arrêt du serveur. Elle s’adresse aux membres du foyer et à la personne qui règle le miroir.

## Le principe

- Trois sortes d’échéances : un **réveil** à une heure, une seule fois ou répété certains jours ; un **minuteur** d’une durée, de 5 secondes à 24 heures ; un **rappel**, un texte à redire à une date et une heure.
- Le serveur tient tout dans la base de l’ordinateur. Une échéance sonne même sans conversation en cours, sans clé OpenAI, ou avec les connexions IA bloquées.
- Une échéance appartient au foyer (visible et dite à tous) ou à une personne.

Le module **Alarmes et rappels** se trouve dans la rubrique **Modules**, groupe « Au quotidien ». Il est activé par défaut.

## Régler à la voix

- « Réveille-moi à 7 h », « réveille-moi à 6 h 45 en semaine », « mets un réveil tous les jours à 7 h ».
- « Mets un minuteur de 10 minutes pour les pâtes », « minuteur de 3 minutes ».
- « Rappelle-moi d’appeler le garage demain à 14 h », « rappelle-moi dans 20 minutes de sortir le gâteau », « rappelle-nous de sortir les poubelles tous les lundis à 20 h ».
- « Quels réveils j’ai ? », « il reste combien sur le minuteur ? ».
- « Annule le minuteur », « supprime le réveil de 7 h », « annule tous mes rappels ».

Cornelius redit l’heure calculée par le serveur (« mardi 3 novembre à 07:00, dans 22 h ») et l’affiche dans une carte. Une heure déjà passée aujourd’hui vise le lendemain. Si plusieurs échéances correspondent à une annulation (« annule le minuteur » avec deux minuteurs en cours), rien n’est annulé : Cornelius demande laquelle. Une demande répétée par erreur ne crée pas de doublon.

**Pour qui.** « Réveille-moi » vise la personne reconnue ; « pour tout le monde » ou « rappelle-nous » vise le foyer. Une personne que Cornelius ne reconnaît pas ne règle que des échéances du foyer. Sur un [satellite](satellites.md), seule la réponse est dite, sans carte.

## Régler dans l’administration

Sous **Nouvelle échéance** :

| Réglage | Effet |
| --- | --- |
| **Réveil**, **Minuteur**, **Rappel** | Le type d’échéance |
| **Pour** | **Le foyer** ou une personne |
| **Heure** | Réveil et rappel |
| **Date** | Vide : la prochaine fois que l’heure arrive. Désactivée quand des jours sont cochés |
| **Durée (minutes)** | Minuteur ; « 0,5 » pour trente secondes |
| **Nom (facultatif)** ou **Texte du rappel** | « pâtes », « travail » ; le texte est obligatoire pour un rappel |
| **Répéter** | Les jours de la semaine, **En semaine** ou **Tous les jours** |

La liste **Échéances** montre la prochaine fois, la répétition, l’état (**Sonne**, **Repoussé**, **Terminé**, **Manqué**) et la personne. **Arrêter** coupe ce qui sonne ; **Supprimer** retire l’échéance et ses prochaines occurrences. Les échéances terminées ou manquées restent affichées une semaine.

Vingt échéances en cours au plus par personne, et vingt pour le foyer. Une échéance se règle au plus un an à l’avance.

## Quand ça sonne

**Sur le miroir.** Une carte ambrée s’affiche au-dessus de l’orbe (« Réveil · 07:00 », « Minuteur », « Rappel pour Sacha ») et l’écran de veille se retire. La sonnerie démarre doucement et monte au maximum en trente secondes. Un rappel sonne avec un carillon doux, plus espacé.

Le miroir ne peut sonner qu’une fois la voix activée (bouton **Activer la voix**, voir [Le miroir](../utilisation/miroir.md#activer-la-voix)) : sans cela, seule la carte s’affiche.

**Avec Cornelius.** Ouvrir une conversation, comme d’habitude (regard, présence ou « Cornelius » selon [l’ouverture choisie](ouverture-et-presence.md)), coupe le son ; la carte reste. Cornelius annonce ce qui sonne et propose :

- « Arrête », « c’est bon » : la sonnerie s’arrête. Un réveil répété repart pour sa prochaine fois.
- « Encore dix minutes », « répète dans 5 minutes » : la sonnerie revient après ce délai (10 minutes si rien n’est précisé, une heure au plus).

N’importe qui dans la pièce peut arrêter ou repousser ce qui sonne.

**Sur un satellite.** Une échéance réglée sur un satellite y sonne : l’anneau clignote en ambre et le haut-parleur joue la sonnerie. « Cornelius » ouvre la conversation sur ce satellite, coupe la sonnerie, et Cornelius l’annonce comme sur le miroir. Un appui bref sur le bouton du satellite arrête aussi la sonnerie (en temps normal, il coupe le micro). Le serveur n’ouvre jamais seul une conversation pour une alarme : sans réponse, la sonnerie s’arrête après la **Durée de la sonnerie** (5 minutes par défaut) et l’échéance est notée manquée.

**Un rappel personnel** n’affiche et ne fait dire son texte qu’à son propriétaire, seul devant le miroir et reconnu. Sinon la carte dit seulement « Rappel pour Sacha », et Cornelius aussi.

## Ce qu’affiche le miroir en permanence

Au-dessus des [informations permanentes](../utilisation/miroir.md#les-informations-permanentes), avec la même typographie :

- **Minuteur** : son nom et le temps restant, à la seconde (« 9:29 ») ; les deux suivants en dessous s’il y en a plusieurs.
- **Réveil** : l’heure du prochain réveil et son jour (« 07:00 », « demain »).
- **Aujourd’hui** : les pense-bêtes du jour, avec leur heure (trois au plus).

Comme les informations permanentes, ce bandeau ne s’affiche que devant une personne : les échéances du foyer pour tout le monde, celles d’une personne quand elle est reconnue. Rien quand personne n’est détecté, ni en mode vie privée quand plusieurs personnes sont présentes.

## Manquées et arrêts du serveur

- Une échéance arrivée pendant un arrêt du serveur (ou une veille de l’ordinateur) sonne au retour si elle a moins d’un quart d’heure de retard. Au-delà, elle est notée **Manqué**.
- Une échéance qui a sonné sans réponse est aussi notée manquée.
- Un réveil répété manqué repart pour sa prochaine fois.
- À la conversation suivante sur le miroir, Cornelius dit une fois ce qui a été manqué : « le minuteur des pâtes a sonné à 9 h 10 sans réponse ». Un rappel personnel manqué n’est redit qu’à son propriétaire, seul et reconnu. Ce qui a été dit ne l’est plus, même après un redémarrage.
- **Activer les alarmes et rappels** éteint, rien ne sonne. Au retour, ce qui a plus d’un quart d’heure de retard est noté manqué.

## Les réglages

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| **Activer les alarmes et rappels** | Éteint, rien ne sonne et Cornelius ne propose plus d’en régler. Changer ce réglage relance la conversation en cours | activé |
| **Durée de la sonnerie** | Une sonnerie sans réponse s’arrête après 1 à 30 minutes | 5 min |
| **Sonnerie des réveils et minuteurs** | **Bips** (quatre bips rapides), **Alerte** (deux tons alternés) ou l’un des six sons d’ouverture, joués en boucle ; **Écouter** pour l’essayer | Bips |

## Limites

- Un minuteur réglé sur un satellite sonne dans sa pièce si son firmware sait sonner (0.4.0 ou plus récent) ; sinon, ou si le satellite est déconnecté, il sonne sur le miroir. Les échéances manquées ne sont dites que sur le miroir, où la caméra sait qui est là.
- Pas de « saute le réveil de demain seulement » : supprimez-le ou réglez-le à nouveau.
- Les heures suivent le fuseau du foyer (`CORNELIUS_TIMEZONE`, `Europe/Paris` par défaut). Une heure qui n’existe pas au passage à l’heure d’été (2 h 30) sonne une heure plus tard.
- Pas de son propre par échéance : tous les réveils et minuteurs partagent la sonnerie choisie.

## Confidentialité

- Les échéances restent dans la base locale. Supprimer un profil supprime ses échéances.
- Pendant une conversation, le fournisseur vocal reçoit ce qu’il faut pour répondre : l’échéance demandée, la liste demandée, ce qui sonne ou a été manqué et son texte, seulement pour la personne à qui il est destiné.
- Le journal note la création, la sonnerie et les manqués d’une échéance, avec son type et son heure, jamais son texte.

Voir [Confidentialité](../reference/confidentialite.md).

## Voir aussi

- [Le miroir](../utilisation/miroir.md)
- [L’administration](../utilisation/administration.md)
- [Ouverture et présence](ouverture-et-presence.md)
- [Les modules](../modules/README.md)
