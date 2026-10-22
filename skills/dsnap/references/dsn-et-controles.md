# La DSN produite et ses contrôles

## Deux fichiers par mois

`preparer_dsn` écrit le même contenu deux fois : `… - TEST.txt` (S10.G00.00.005 = 01) et `… - REEL.txt` (02). Format : une rubrique par ligne `RUBRIQUE,'valeur'`, caractères ASCII uniquement (donc valide en ISO-8859-1), fins de ligne CR+LF, pas de saut de ligne final, S90.G00.90.001 = nombre total de lignes, une seule déclaration par fichier (dépôt unitaire).

## Structure d'une DSN normale (environ 220 lignes)

1. En-tête : S10.G00.00 (logiciel, norme P26V01, test ou réel, envoi normal), S10.G00.01 et .02 (émetteur, contact), S20.G00.05 (DSN mensuelle, normale, fraction 11, numéro d'ordre, mois, date de fabrication, déclaration totale, euro), S20.G00.07 (contact), S21.G00.06 (entreprise), S21.G00.11 (établissement, convention 9999). L'en-tête vient de la configuration (ou de la DSN de référence importée), sauf l'identification du logiciel (DSNAP, SASU EBO, version).
2. S21.G00.20 : uniquement si de l'impôt est prélevé (versement DGFiP : DGFIP, DGFIP_PAS, BIC, IBAN, montant arrondi à l'euro, mode 05).
3. S21.G00.22 : bordereau Urssaf (montant arrondi à l'euro), puis S21.G00.23 : un bloc par CTP, montants arrondis à l'euro.
4. S21.G00.30 (individu), S21.G00.40 (contrat : mandat social 80, statut 03, cadre 01, PCS-ESE du métier exercé…), S21.G00.71 (RUAA).
5. S21.G00.50 (versement : date, net imposable, net versé **avant** impôt, taux et type du PAS, montant du PAS, montant soumis au PAS).
6. Quatre S21.G00.51 (types 001, 002, 003, 010, tous au brut), un S21.G00.53 sous le 001 (01, jours calendaires du mois, unité 40), S21.G00.58 type 03 (montant net social).
7. S21.G00.78 base 02 (plafonnée) avec les S21.G00.81 049, 076, 131, 142 ; base 03 (brute) avec 011, 045, 068, 074, 075, 076, 100, 102, 128, 130, 132, 907 ; base 04 (CSG) avec 072, 079.
8. S21.G00.86 (ancienneté en jours), puis S90.

## DSN néant (mois sans salaire)

S10.G00.00.008 = 02 et S20.G00.05.002 = 02 (déclaration sans individu), pas d'individu, un bordereau Urssaf à 0.00. Environ 45 lignes.

## Pièges déjà rencontrés

- **Net versé (50.004)** : le prélèvement à la source n'est pas déduit (cahier technique). Le virement réel, lui, est diminué de l'impôt et de la part salariale des titres-restaurant.
- **Bloc 23** : assiettes et montants arrondis à l'euro ; certains logiciels écrivent des centimes (sans effet sur le bordereau, mais à éviter).
- **Taux 81.007 du code 100** : 0,016 % s'écrit `00.016` (trois décimales autorisées).
- **Numéro d'ordre (S20.G00.05.004)** : rang du fichier parmi les DSN fabriquées dans le même mois civil, remis à zéro chaque mois. Avec la date de fabrication, il forme l'identifiant de la déclaration : deux DSN fabriquées le même mois ne doivent pas porter le même numéro.
- **Codification UE (30.013)** : nationalité du salarié ; 01 pour une personne de nationalité française. Des fichiers d'autres logiciels portent parfois 04 (« reste du monde ») pour un Français : à corriger sur la page de configuration.
- **Code risque 999ZZ** : prévu tant que la CARSAT n'a notifié aucun code risque ; le taux AT ne figure alors pas dans le bloc 40 mais sur la ligne 863/920 du bloc 23. Si un taux a été notifié (compte AT/MP sur net-entreprises), déclarer ce code et ce taux.
- **Localités** (S10.G00.01.006, S21.G00.06.006, S21.G00.11.005, S21.G00.30.010) : lettres, chiffres et espaces seulement ; DSNap remplace tirets et apostrophes par des espaces.
- **Agirc-Arrco** : les cotisations figurent dans la DSN sans bloc Versement ; leur paiement se fait selon les modalités de la caisse du client.
- **Adresse de l'entreprise (S21.G00.06.004 à 006)** : une DSN sans adresse d'entreprise est rejetée (S21.G00.06.005/CCH-11, bloquant). Pour une entreprise à un seul établissement, DSNap recopie voie, code postal et localité de l'établissement, et bloque ce cas avant tout dépôt.
- **Mois déjà déclaré** : un dépôt test ne signale pas toujours qu'un mois a déjà été déclaré (constaté en 2026 : seuls certains mois ont remonté l'anomalie B1-208-09). Avant un rattrapage, vérifier l'historique des dépôts (`rechercher_depots`) et les accusés reçus, pas seulement le bilan du test.
- **Adhésion TESE** : l'adhésion au Titre emploi service entreprise fait transmettre la DSN par l'Urssaf. Une société adhérente qui dépose aussi ses DSN elle-même risque des déclarations en double : choisir un seul canal.
- **Comptable ou autre logiciel** : si un expert-comptable ou un autre logiciel dépose déjà les DSN, DSNap ne doit pas déposer en plus.

## Contrôles exécutés par le moteur

- Structure : format des lignes, encodage, rubriques vides ou « A RENSEIGNER », total S90, une seule déclaration, ordre des rubriques et des blocs.
- Formats : dates, montants, taux, SIREN et SIRET (clé de Luhn), NIR (format, département, sexe, clé), localités, numéro d'ordre.
- Cohérences du cahier technique : fin de période ≥ début, régime de retraite complémentaire selon le statut (CCH-16 et CCH-17 de 40.003), 999ZZ sans taux AT, PAS = base × taux à 1 € près, identifiant du taux DGFiP, bloc Versement DGFiP si impôt prélevé, date de versement, montant net social présent, bloc Activité, numéro de contrat repris, rubriques obligatoires du bloc Individu.
- Recalculs : bordereau CTP par CTP comme l'Urssaf, assiettes du bloc 23 face aux bases du bloc 78, cotisations individuelles = base × taux, net imposable = net versé + CSG non déductible + CRDS, montant net social = net versé, cohérence de l'exonération ACRE entre niveaux individuel et agrégé.
- Paie : bornes de la part patronale des titres-restaurant, nombre de titres face aux jours ouvrés, quote-part du logement, budget mensuel.
- Adresse de l'entreprise : code postal, ou bien code pays et code de distribution à l'étranger (CCH-11 de S21.G00.06.005).
- Tables de référence officielles (`references/nomenclatures.md`) : chaque rubrique codée face à sa table pour le mois déclaré (code inconnu ou hors validité, valeur d'échappement, barème BAR du prélèvement à la source), fraîcheur des tables.

Ces contrôles ne remplacent pas ceux de net-entreprises : le dépôt en mode test reste la vérification officielle.
