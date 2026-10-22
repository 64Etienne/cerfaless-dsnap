# DSNap — suite Cerfaless

**La paie et la DSN du président de SASU, préparées, contrôlées et déposées sur net-entreprises depuis Claude.**

Vous êtes président de SASU (ou de SAS), assimilé salarié, et vous déposez chaque mois une DSN, avec ou sans salaire. Dites à Claude « Prépare ma DSN d'octobre » : DSNap calcule la paie, écrit le bulletin et la note de frais en PDF, fabrique la DSN, la contrôle comme net-entreprises, la dépose en test, puis en réel après votre feu vert, et lit les retours.

- **DSN néant gratuite, sans limite.** Un mois sans salaire se déclare en deux phrases.
- **Paie avec salaire :** essai de 7 jours, puis 6,90 € par mois ou 70 € par an, sans engagement.
- **Contrôles avant dépôt :** format et encodage, cohérences du cahier technique, recalcul du bordereau Urssaf CTP par CTP, et chaque code (NAF, PCS-ESE, risque AT, Urssaf, barème du prélèvement à la source…) vérifié dans les tables officielles de net-entreprises, mises à jour automatiquement.
- **Garde-fous :** pas de dépôt réel sans dépôt test conforme du même fichier ni sans votre accord explicite (sauf si vous choisissez vous-même le dépôt automatique) ; DSNap refuse de redéposer un mois qu'il a déjà déposé, et bloque le mois si un envoi est resté sans réponse, jusqu'à vérification sur net-entreprises.
- **Vos données restent chez vous :** identifiants net-entreprises chiffrés dans le trousseau de votre ordinateur, numéro de sécurité sociale saisi sur une page locale et masqué dans toutes les réponses de DSNap à Claude.

DSNap fait partie de **Cerfaless**, des outils qui font vos démarches administratives avec Claude et les déposent pour de vrai.

Site : https://cerfaless.fr/dsnap · Aide : https://cerfaless.fr/dsnap/aide

## Ce que DSNap couvre

Président de SASU ou de SAS assimilé salarié, sans contrat de travail, seul individu déclaré, rémunération mensuelle jusqu'au plafond de la Sécurité sociale (4 005 € en 2026), avec ou sans ACRE (ancien régime et régime 2026 à 25 %), frais remboursés au réel, titres-restaurant, impôt à la source au taux neutre ou au taux transmis par la DGFiP. Mois de 2026, norme DSN P26V01 ; le passage à 2027 (taux et norme P27V01) sera publié avant la première échéance de 2027.

Pas encore couvert : salariés, plusieurs dirigeants rémunérés, rémunération au-dessus du plafond, Alsace-Moselle, régime agricole, DSN « annule et remplace », signalements d'événements.

## Installation

DSNap a besoin d'un client Claude qui exécute un serveur MCP sur votre ordinateur : l'app Claude de bureau (Windows, macOS), Claude Code, ou une session Cowork sur votre ordinateur.

- **Extension de bureau** (aucun prérequis) : téléchargez `dsnap.mcpb` sur https://cerfaless.fr/dsnap/installation et ouvrez-le avec Claude.
- **Plugin** : installez DSNap depuis le répertoire de plugins de Claude, ou dans Claude Code :
  ```
  /plugin marketplace add 64Etienne/cerfaless-dsnap
  /plugin install dsnap@cerfaless
  ```
  Le serveur du plugin se lance avec Node.js 18 ou plus récent.

Puis demandez à Claude : « Configure DSNap ». Une page s'ouvre dans votre navigateur, servie par DSNap sur votre ordinateur, pour choisir le dossier de paie, enregistrer vos identifiants net-entreprises et renseigner la société (le plus simple : importer votre dernière DSN acceptée).

## Les outils

| Outil | Rôle |
|---|---|
| `etat_dsnap` | Où en est DSNap : dossier, société, identifiants, abonnement, tables, prochaine échéance. |
| `configurer_dsnap` | Ouvre la page de configuration locale (ou le mode démonstration). |
| `preparer_dsn` | Paie du mois : DSN test et réelle, bulletin et note de frais en PDF, contrôles. `brut: 0` = DSN néant. |
| `simuler_budget` | Brut maximal pour un budget mensuel. |
| `verifier_fichier_dsn` | Contrôle complet d'un fichier DSN, de DSNap ou d'un autre logiciel. |
| `deposer_dsn` | Dépôt test ou réel sur net-entreprises, bilan de conformité. |
| `bilan_du_depot`, `lister_retours`, `telecharger_retour` | Bilans et comptes rendus (Urssaf, Agirc-Arrco, DGFiP). |
| `rechercher_depots`, `lister_depots`, `journal_depots` | Dépôts déjà faits, sur net-entreprises et dans DSNap. |
| `tester_connexion` | Vérifie les identifiants net-entreprises. |
| `mettre_a_jour_tables` | Force la mise à jour des tables de référence. |
| `abonnement_dsnap` | Statut de l'abonnement et liens. |

## Ce que DSNap exécute, envoie et télécharge

DSNap est un serveur MCP en JavaScript lisible, sans dépendance (Node.js seul), lancé par Claude sur votre ordinateur (`node server/index.js`). Il :

- **lit et écrit** uniquement dans votre dossier de paie (configuration, DSN, PDF, retours, journal) et dans son dossier de données (`%APPDATA%\DSNap`, `~/Library/Application Support/DSNap` ou `~/.config/dsnap` : réglages, identifiants chiffrés, cache des tables, dernière réponse du service d'abonnement, journal technique sans donnée personnelle) ;
- **exécute**, pour chiffrer vos identifiants : `powershell.exe` (DPAPI) sous Windows, `/usr/bin/security` sous macOS, `secret-tool` sous Linux ; `curl` en secours si `fetch` échoue derrière un proxy ; la commande du système qui ouvre votre navigateur sur la page de configuration ;
- **ouvre** un serveur web local sur `127.0.0.1` (port aléatoire, adresse à jeton, fermé après 30 minutes d'inactivité) pour la page de configuration ;
- **envoie à net-entreprises** (`services.net-entreprises.fr`, `depot.dsnrg.net-entreprises.fr`, `consultation.dsnrg.net-entreprises.fr`, `telechargement*.dsnrg.net-entreprises.fr`), sur votre demande : vos identifiants pour l'authentification, vos fichiers DSN pour le dépôt, les demandes de retours ;
- **télécharge depuis net-entreprises.fr** les tables de référence officielles de la norme DSN et le flux d'actualités du site (au plus toutes les 12 heures) ; en secours, une copie de ces tables publiée sur `cerfaless.fr/dsnap/tables` ou, à défaut, dans les versions publiées du projet sur GitHub (`github.com/64Etienne/cerfaless-dsnap/releases`) ;
- **envoie au service d'abonnement de DSNap** (`cerfaless.fr/api/dsnap`), seulement lors d'une paie avec salaire ou d'un dépôt réel avec salaire, et quand vous consultez l'état : une empreinte SHA-256 du SIREN (donnée pseudonymisée : le SIREN n'est pas transmis, mais un SIREN connu peut y être rapproché), un identifiant d'installation aléatoire et la version de DSNap. Jamais de NIR, de nom, de montant ni d'identifiant net-entreprises.

En mode démonstration, rien n'est envoyé à net-entreprises ni au service d'abonnement : un simulateur local répond à la place de net-entreprises (seules les tables publiques peuvent être téléchargées).

## Politique de confidentialité

Éditeur : SASU EBO, Toulouse (France). Contact : https://cerfaless.fr/contact.

- **Données de paie** (identité du président dont le numéro de sécurité sociale, rémunérations, adresse, coordonnées bancaires de la société) : traitées et stockées uniquement sur votre ordinateur, dans votre dossier de paie. SASU EBO n'y a pas accès. Choisissez un dossier qui n'est pas synchronisé avec un service en ligne si vous ne voulez pas que ces fichiers y soient copiés (par défaut : `DSNap` dans votre dossier personnel). Elles sont transmises à net-entreprises seulement quand vous déposez une DSN, comme le prévoit la déclaration sociale nominative.
- **Identifiants net-entreprises** : chiffrés dans le trousseau de votre système, utilisés seulement pour vous authentifier auprès de net-entreprises. Jamais transmis à SASU EBO ni à Claude.
- **Ce que voit Claude** : les résultats des outils (montants, statuts, chemins de fichiers, messages de contrôle), numéros de sécurité sociale masqués. Les conversations relèvent de la politique de confidentialité d'Anthropic.
- **Service d'abonnement** : empreinte du SIREN, identifiant d'installation et version, vérifiés auprès de Stripe, qui conserve l'empreinte et les dates d'essai dès l'essai, puis les informations de facturation à la souscription ; conservés pendant l'essai et l'abonnement, puis 3 ans. Factures conservées 10 ans (obligation comptable). Paiement par Stripe (Stripe Payments Europe).
- **Vos droits** (RGPD) : accès, rectification, effacement, opposition, portabilité, via https://cerfaless.fr/contact ; réclamation auprès de la CNIL (www.cnil.fr). Effacer DSNap de votre ordinateur supprime toutes les données locales : désinstallez l'extension ou le plugin, puis supprimez le dossier de données et, si vous le souhaitez, le dossier de paie.

Politique complète : https://cerfaless.fr/confidentialite · fichier `PRIVACY.md`.

## Pour les relecteurs (English)

DSNap is a French payroll tool: it prepares, checks and files the monthly DSN (social security declaration) of a French single-shareholder company president through the official net-entreprises API, using the user's own credentials. To evaluate it without a French company or a net-entreprises account, ask Claude « Configure DSNap » and click « Essayer la démonstration » on the local page: a fictitious company is set up and every filing goes to a built-in simulator (no network request to net-entreprises or to the licensing service). Then try « Prépare la DSN de septembre 2026 avec un brut de 1 800 € », « Dépose-la en test », « Dépose-la en réel » (Claude must ask for explicit confirmation), « Prépare une DSN néant pour octobre ». Tests: `node --test tests/*.test.js` (no dependencies).

## Licence

© 2026 SASU EBO. Code source consultable ; utilisation selon les conditions du fichier `LICENSE`. Les tables de référence téléchargées appartiennent au GIP-MDS (net-entreprises) et à leurs fournisseurs.

DSNap n'est ni édité ni approuvé par net-entreprises, le GIP-MDS, l'Urssaf ou l'administration. DSNap est un outil : vous restez le déclarant et responsable de vos déclarations. Il ne remplace pas le conseil d'un expert-comptable.
