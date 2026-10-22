# Politique de confidentialité de DSNap

Dernière mise à jour : 21 octobre 2026. Version complète : https://cerfaless.fr/confidentialite.

**Responsable du traitement** : SASU EBO, société par actions simplifiée unipersonnelle, SIREN 992 652 024, siège à Toulouse (31400). Contact : https://cerfaless.fr/contact.

## 1. Ce qui reste sur votre ordinateur

DSNap fonctionne sur votre ordinateur. Les données nécessaires à la paie et à la DSN — identité du président (dont le numéro de sécurité sociale), adresse, rémunérations, frais, coordonnées bancaires de la société, fichiers DSN, bulletins, retours de net-entreprises — sont écrites dans le dossier de paie que vous choisissez (par défaut `DSNap` dans votre dossier personnel ; évitez un dossier synchronisé avec un service en ligne si vous ne voulez pas qu'elles y soient copiées). Les identifiants net-entreprises sont chiffrés dans le trousseau de votre système. **SASU EBO n'a accès à aucune de ces données**.

## 2. Ce qui est transmis, à qui, et pourquoi

| Destinataire | Données | Quand | Base légale |
|---|---|---|---|
| net-entreprises (GIP-MDS) | Identifiants net-entreprises ; fichier DSN ; demandes de retours | Quand vous testez la connexion, déposez une DSN ou consultez les retours | Obligation légale de déclaration (DSN), à votre demande |
| net-entreprises.fr (site public) | Aucune donnée personnelle (téléchargement des tables publiques) | Au plus toutes les 12 heures | Intérêt légitime (exactitude des contrôles) |
| Service d'abonnement DSNap (SASU EBO, cerfaless.fr) | Empreinte SHA-256 du SIREN, identifiant d'installation aléatoire, version de DSNap. Le service ne conserve rien lui-même : il interroge Stripe, sans journaliser d'adresse IP ni d'empreinte | Paie ou dépôt réel avec salaire, consultation de l'état | Exécution du contrat |
| Stripe (Stripe Payments Europe Ltd), base de données du service d'abonnement | Dès l'essai : empreinte du SIREN et date de début d'essai. À la souscription : adresse électronique, moyen de paiement, raison sociale, adresse et numéro de TVA de facturation (qui contient le SIREN), abonnement et factures | Essai, souscription et gestion de l'abonnement | Exécution du contrat, obligation légale (factures) |
| Anthropic (Claude) | Les résultats des outils affichés dans la conversation (montants, statuts, chemins de fichiers, messages de contrôle), sans numéro de sécurité sociale ni identifiants | À chaque utilisation | Votre usage de Claude, selon la politique d'Anthropic |

Aucune donnée n'est vendue, louée ni utilisée pour de la publicité.

## 3. Durées de conservation

- Données locales : tant que vous les gardez ; elles disparaissent quand vous supprimez le dossier de paie et le dossier de données de DSNap.
- Données d'essai et d'abonnement chez Stripe : pendant l'essai et l'abonnement, puis 3 ans ; supprimées plus tôt sur simple demande.
- Factures : 10 ans (obligation comptable).

## 4. Sécurité

Chiffrement des identifiants par le système (DPAPI, trousseau macOS, Secret Service) ou, à défaut, fichier chiffré AES-256-GCM avec une clé propre à l'ordinateur et à votre compte (protection plus faible qu'un trousseau, signalée sur la page) ; connexions HTTPS ; page de configuration limitée à votre ordinateur (127.0.0.1, adresse à jeton) ; numéros de sécurité sociale masqués dans toute réponse affichée à Claude ; réponses du service d'abonnement signées (Ed25519).

## 5. Vos droits

Accès, rectification, effacement, limitation, opposition, portabilité : https://cerfaless.fr/contact. Réponse sous un mois. Réclamation possible auprès de la CNIL (https://www.cnil.fr). DSNap ne s'adresse pas aux mineurs.

## 6. Hébergement et transferts hors de l'Union européenne

Le site et le service d'abonnement sont hébergés sur un serveur loué par SASU EBO (hébergeur indiqué dans les mentions légales de cerfaless.fr). Le paiement est assuré par Stripe, qui peut transférer des données hors de l'Union européenne dans le cadre de protection des données UE–États-Unis et des clauses contractuelles types de la Commission européenne. Pendant l'essai, le SIREN n'est pas transmis en clair, seulement son empreinte ; un SIREN pouvant être retrouvé à partir de son empreinte, elle est traitée comme une donnée personnelle. Une fois abonné, vos informations de facturation sont chez Stripe.
