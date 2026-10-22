# Configuration de DSNap

## La page de configuration

`configurer_dsnap` ouvre dans le navigateur de l'utilisateur une page servie par DSNap sur son ordinateur (adresse `http://127.0.0.1:<port>/c/<jeton>/`, fermée après 30 minutes d'inactivité). C'est le seul endroit où l'utilisateur saisit :

1. **Le dossier de paie** : où DSNap range la configuration, les DSN, les bulletins et les retours (par défaut `DSNap` dans le dossier personnel, hors des dossiers souvent synchronisés avec iCloud ou OneDrive : les fichiers contiennent le NIR). Une société par dossier.
2. **Le compte net-entreprises** : SIRET, nom, prénom et mot de passe d'un compte inscrit au service DSN. Chiffrés dans le trousseau du système (DPAPI sous Windows, trousseau macOS, Secret Service sous Linux ; à défaut, fichier chiffré avec une clé propre à l'ordinateur, protection plus faible signalée sur la page). Bouton « Tester la connexion ».
3. **La société** : import de la dernière DSN acceptée (le plus simple : tous les champs sont repris, NIR compris, sans passer par Claude), ou saisie : raison sociale, SIRET, APE, adresse, Urssaf (liste officielle), convention collective, contact, IBAN et BIC (prélèvement de l'impôt à la source), code risque et taux AT.
4. **Le président** : numéro de sécurité sociale (15 caractères, clé vérifiée), état civil, naissance, adresse, nationalité, début du mandat, profession (code PCS-ESE de la table officielle), numéro de contrat (garder celui des DSN précédentes).
5. **Les choix de paie** : mode du brut (demandé chaque mois, fixe, ou maximum pour un budget), ACRE (date de fin et régime), taux d'impôt DGFiP, frais remboursés au réel (logement, box, mobile), titres-restaurant, dépôt réel (feu vert à chaque fois, ou automatique après un test conforme).

À l'enregistrement, DSNap fait un essai de calcul et liste ce qui manque encore.

## Le fichier `dsnap.json`

Écrit par la page à la racine du dossier de paie. Ne le montre pas et ne le modifie pas à la main : il contient le NIR. Structure, pour comprendre une erreur :

| Clé | Contenu |
|---|---|
| `client` | Raison sociale |
| `entete` | Rubriques S10.G00.01, S10.G00.02.001, S21.G00.06, S21.G00.11 (SIREN, NIC, APE, adresses, convention) |
| `contrat` | Rubriques S21.G00.40 (début du mandat, statuts, PCS-ESE, numéro de contrat, code risque) |
| `individu` | Rubriques S21.G00.30 (identité du président) |
| `contact`, `banque` | Contact DSN ; IBAN et BIC de la société |
| `urssafSiret` | SIRET de l'Urssaf destinataire du bordereau |
| `choix` | `tauxAT`, `acreMode`, `acreFin`, `acreRegime`, `budgetMensuel`, surfaces et parts d'usage, titres-restaurant |
| `facturesParDefaut` | `loyer`, `elec`, `box`, `mobile`, `assurance` (montants mensuels habituels) |
| `pas` | `{ mode: "bareme" }` ou `{ mode: "dgfip", taux, id }` |
| `automatisation` | `brut` (`demande`, `fixe` + `valeur`, `budget`) et `depotReel` (`feu_vert`, `automatique_si_bilan_ok`) |
| `dsnReference` | DSN importée (facultatif) ; la configuration la complète et la remplace rubrique par rubrique |

Un dossier de l'ancien skill « paie-dsn » (`paie-dsn.json`, `paie-dsn-etat.json`) est lu tel quel ; la page le convertit en `dsnap.json` au premier enregistrement.

## Le mode démonstration

« Essayer la démonstration » sur la page : société fictive DEMO DSNAP SASU (SIREN 999 999 998), présidente fictive, dossier de paie à part. Les dépôts vont à un simulateur local : accusé, bilan OK ou KO selon le contrôle du fichier, doublon détecté, comptes rendus. Rien ne part vers net-entreprises ni vers le service d'abonnement ; seule la société fictive est utilisable dans ce mode. « Quitter la démonstration » revient au dossier précédent.

## Ce que DSNap garde, et où

- Dossier de paie (choisi par l'utilisateur) : configuration, DSN, bulletins, notes de frais, récapitulatifs, retours de net-entreprises, journal des dépôts.
- Dossier de données de DSNap (`%APPDATA%\DSNap`, `~/Library/Application Support/DSNap` ou `~/.config/dsnap`) : réglages, identifiants chiffrés, cache des tables, dernière réponse signée du service d'abonnement, journal technique du serveur (sans donnée personnelle).
- Rien n'est envoyé à DSNap, sauf l'empreinte du SIREN (SHA-256, donnée pseudonymisée), l'identifiant d'installation et la version, lors de la vérification de l'abonnement.
