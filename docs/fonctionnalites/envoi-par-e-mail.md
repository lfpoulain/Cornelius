# L’envoi par e-mail

Cornelius peut envoyer par e-mail, sur le téléphone d’une personne du foyer, une image qu’il vient de créer ou un court message. Cette page explique comment préparer un compte d’envoi, choisir les destinataires, demander un envoi à la voix, et ce qui est permis ou non. Elle s’adresse à la personne qui règle le miroir pour la maison.

## Le principe

- On demande à la voix : « Envoie-moi cette image », « Envoie l’image du phare à Baptiste », « Envoie-moi l’adresse du restaurant ».
- L’e-mail part d’une boîte de messagerie du foyer (Gmail, iCloud, votre fournisseur d’accès…), par une connexion SMTP chiffrée. Il arrive dans la boîte de la personne, donc sur son téléphone.
- Les destinataires sont fixés dans l’administration. La conversation ne connaît que leurs noms : Cornelius n’écrit à personne d’autre et n’invente jamais d’adresse.

La carte **E-mail** se trouve dans la rubrique **Modules**, groupe « Capacités de Cornelius ».

## Préparer un compte d’envoi

Le plus simple est une boîte dédiée au miroir, par exemple `cornelius.maison@gmail.com`, plutôt qu’une boîte personnelle. Son mot de passe d’application ne donne accès qu’à cette boîte.

**Avec Gmail :**

1. Activez la validation en deux étapes du compte Google.
2. Créez un mot de passe d’application sur [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), nommé par exemple « Cornelius ». Google affiche seize lettres en quatre groupes.
3. Dans la carte **E-mail**, cliquez sur **Gmail**, saisissez l’adresse Gmail dans **Adresse d’envoi**, puis **Enregistrer**.
4. Collez le mot de passe d’application dans **Mot de passe**, puis **Enregistrer**. Les espaces sont retirés.

**Avec iCloud :** créez un mot de passe pour app sur [account.apple.com](https://account.apple.com) (rubrique « Connexion et sécurité »), cliquez sur **iCloud**, et donnez l’adresse iCloud comme adresse d’envoi.

**Avec un autre fournisseur :** les boutons **Orange**, **Free**, **SFR** et **OVH** remplissent le serveur, le port et le chiffrement. L’identifiant et le mot de passe sont ceux de la messagerie. Vérifiez ces valeurs dans l’aide de votre fournisseur : certains demandent d’autoriser l’envoi depuis un logiciel.

| Réglage | Effet | Par défaut |
| --- | --- | --- |
| **Serveur SMTP** | L’adresse du serveur d’envoi, par exemple `smtp.gmail.com` | vide |
| **Port** | 465 avec TLS, 587 avec STARTTLS | 465 |
| **Chiffrement** | **TLS** (connexion chiffrée dès le départ) ou **STARTTLS** (chiffrée juste après). Jamais sans chiffrement. | TLS |
| **Adresse d’envoi** | Celle du compte : les e-mails partent de cette adresse | vide |
| **Nom de l’expéditeur** | Ce que le téléphone affiche comme expéditeur | Cornelius |
| **Identifiant SMTP** | Vide : l’adresse d’envoi, comme chez la plupart des fournisseurs | vide |
| **Mot de passe** | Rangé avec les clés (`CORNELIUS_SMTP_PASSWORD`) : il apparaît aussi dans **Clés et accès → Clés et jetons**, et peut venir du fichier `.env` | aucun |

**Tester la connexion** vérifie le serveur, le chiffrement et le mot de passe, sans rien envoyer.

## Les destinataires

Sous **Destinataires**, une ligne par adresse :

- **Nom** : celui que vous dites pour demander l’envoi. Avec « Baptiste », on dit « envoie l’image à Baptiste ». Cornelius ne connaît que ces noms ; il retrouve l’adresse sur l’ordinateur. Deux lignes ne peuvent pas porter le même nom, sans tenir compte des accents ni des majuscules. « Moi » est réservé.
- **Adresse e-mail** : celle que la personne lit sur son téléphone.
- **Profil relié** (facultatif) : quand Cornelius reconnaît ce profil, « envoie-moi » vise sa première adresse. Sans profil, « envoie-la à Mamie » fonctionne, mais pas « envoie-moi ». Choisir le profil en premier remplit le nom.

Un profil peut avoir plusieurs adresses, chacune sous son nom : « Artus » pour l’adresse personnelle, « Artus travail » pour l’autre. « Envoie-moi » prend la première de la liste ; « envoie-la sur mon adresse du travail » ou « envoie-la à Artus travail » prend l’autre.

**Envoyer un essai** envoie un e-mail d’essai à l’adresse. La liste compte vingt adresses au plus. Supprimer un profil supprime aussi ses adresses.

## Activer

Une fois le compte, le mot de passe et au moins un destinataire en place, allumez **Autoriser l’envoi par e-mail**. Le badge de la carte indique **Prêt**, **À compléter** (avec ce qui manque) ou **Désactivé**. Une conversation en cours redémarre pour en tenir compte.

## Demander un envoi

- « Envoie-moi cette image » : l’image affichée sur le miroir, illustration automatique comprise. Sans image affichée, la plus récente.
- « Envoie l’image d’avant à Baptiste », « envoie-moi l’image du phare » : l’une des trois dernières images, retrouvée par sa position ou par quelques mots de son sujet, comme pour [remontrer une image](generation-d-images.md#remontrer-une-image).
- « Envoie-moi l’adresse du restaurant » : un court message, sans image.

Cornelius dit que c’est envoyé seulement quand le serveur de messagerie a accepté le message. L’e-mail a pour objet « Image de Cornelius : … » suivi du sujet de l’image, rappelle la demande d’origine, porte l’image en pièce jointe et se termine par « Envoyé par Cornelius, le miroir de la maison, à la demande de … ».

## Ce qui est permis

- Seulement aux destinataires de la liste.
- Seulement les images du foyer, ou celles de la personne qui parle : une image créée pour Léa ne part que si Cornelius reconnaît Léa.
- « Envoie-moi » exige une personne reconnue : seule devant le miroir, ou sur un satellite rattaché à elle. Sinon, Cornelius demande à qui envoyer.
- Jamais une photo de la caméra : Cornelius n’en garde aucune.
- Vingt e-mails par heure au plus.
- Aucune validation n’est demandée avant l’envoi : la liste fixe des destinataires en tient lieu.
- Si la connexion se coupe juste après l’envoi, Cornelius dit que l’envoi est incertain et ne le renvoie pas : vérifiez la boîte de réception.

## Limites

- Les images sont au format WebP. Gmail, Apple Mail (iOS 14 ou plus récent) et Outlook les affichent ; de vieux logiciels de messagerie non.
- Seules les trois dernières images créées sont disponibles, et elles sont effacées au redémarrage du serveur.
- Aucune autre pièce jointe : ni fichier, ni carte d’information.
- Les e-mails figurent aussi dans les « Envoyés » de la boîte d’envoi.
- Le premier e-mail peut arriver dans les indésirables : ajoutez l’adresse d’envoi aux contacts de la personne.

## Les messages courants

| Message | Que faire |
| --- | --- |
| « Identifiant ou mot de passe SMTP refusé. » | Vérifier l’identifiant ; avec Gmail ou iCloud, utiliser un mot de passe d’application |
| « Certificat du serveur SMTP refusé » | Vérifier l’adresse du serveur, sans faute de frappe |
| « Connexion chiffrée impossible » | Accorder port et chiffrement : 465 avec TLS, 587 avec STARTTLS |
| « Le serveur SMTP ne répond pas : sur le port 465, choisir le chiffrement TLS. » | Passer le chiffrement à TLS |
| « Le serveur SMTP ne propose pas STARTTLS » | Passer au port 465 avec TLS |
| « Serveur SMTP injoignable » | Vérifier l’adresse, le port, la connexion à Internet et le pare-feu |
| « Adresse d’envoi refusée par le serveur SMTP » | L’adresse d’envoi doit être celle du compte |
| « Trop d’e-mails envoyés cette dernière heure » | Attendre un peu |

Le dernier envoi (réussi, en échec ou incertain) est rappelé en bas de la carte.

## Confidentialité

- Les réglages et les adresses restent dans la base locale. Elles ne sont jamais diffusées au miroir ni données à la conversation : OpenAI ne reçoit que les noms des destinataires.
- Le mot de passe est rangé dans la base locale (ou lu dans `.env`). L’administration n’en montre que les quatre derniers caractères, et le journal le masque.
- Le journal note le nom du destinataire, la présence d’une image et sa taille, jamais l’adresse, l’objet ni le texte.
- L’e-mail passe par votre fournisseur de messagerie, comme tout e-mail.

Voir [Confidentialité](../reference/confidentialite.md).

## Voir aussi

- [La génération d’images](generation-d-images.md)
- [L’administration](../utilisation/administration.md)
- [Configuration](../reference/configuration.md)
- [Confidentialité](../reference/confidentialite.md)
