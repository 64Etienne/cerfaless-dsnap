# Règles de calcul 2026 (président de SASU assimilé salarié)

Toutes ces règles sont codées dans le moteur de DSNap (`server/lib/engine.js`, objet `P`). Ce document sert à les expliquer, pas à recalculer à la main : les montants viennent toujours de `preparer_dsn`.

## Plafond et assiettes

- Plafond mensuel de la Sécurité sociale (PMSS) 2026 : 4 005 €. Base plafonnée = min(brut, PMSS).
- Assiette CSG/CRDS : 98,25 % du brut (abattement de 1,75 % pour frais professionnels).
- Chaque cotisation est arrondie au centime sur le bulletin et dans les blocs nominatifs de la DSN (78, 81).

## Taux

| Cotisation | Base | Salarié | Employeur | Code DSN |
|---|---|---|---|---|
| Maladie | brut | — | 7,00 % | 075 |
| Complément maladie (taux plein, pas de taux réduit pour un mandataire) | brut | — | 6,00 % | 907 |
| Accident du travail | brut | — | taux notifié (0 % avec 999ZZ) | 045 |
| Contribution solidarité autonomie | brut | — | 0,30 % | 068 |
| Vieillesse plafonnée | plafonnée | 6,90 % | 8,55 % | 076 (base 02) |
| Vieillesse déplafonnée | brut | 0,40 % | 2,11 % | 076 (base 03) |
| Agirc-Arrco tranche 1 | plafonnée | 3,15 % | 4,72 % | 131 / 142 |
| Contribution d'équilibre général T1 | plafonnée | 0,86 % | 1,29 % | 131 / 142 |
| Apec (cadre) | brut | 0,024 % | 0,036 % | 132 |
| Allocations familiales | brut | — | 3,45 % | 074 |
| Complément allocations familiales (taux plein) | brut | — | 1,80 % | 102 |
| FNAL (moins de 50 salariés) | plafonnée | — | 0,10 % | 049 |
| Contribution au dialogue social | brut | — | 0,016 % | 100 |
| Formation professionnelle (moins de 11 salariés) | brut | — | 0,55 % | 128 |
| Taxe d'apprentissage | brut | — | 0,59 % | 130 |
| CSG déductible / non déductible | 98,25 % du brut | 6,80 % / 2,40 % | — | 072 |
| CRDS | 98,25 % du brut | 0,50 % | — | 079 |

Pas d'assurance chômage ni d'AGS (mandataire sans contrat de travail), pas de réduction générale des cotisations.

## ACRE

Cotisations concernées : maladie, allocations familiales et vieillesse de base (salariales et patronales), soit 13 + 5,25 + 15,45 + 2,51 = 36,21 % du brut. Ni la CSG/CRDS, ni la retraite complémentaire, ni l'accident du travail, ni le FNAL, ni les autres contributions. Durée : 12 mois à compter du début d'activité (`choix.acreFin` = dernier jour couvert). Mode `auto` : complète les mois entièrement couverts, prorata des jours couverts le mois de la fin (règle à confirmer avec l'Urssaf), aucune ensuite.

**Sociétés créées ou reprises avant le 1er janvier 2026 (ancien régime).**
- Totale si le brut ≤ 75 % du PMSS (3 003,75 €) ; dégressive entre 75 % et 100 % du PMSS : 3 × 36,21 % × (PMSS − brut) ; nulle au-delà. L'Urssaf apprécie ces seuils sur l'année : le calcul mensuel est indicatif dans la zone dégressive.
- Exonération = brut × 36,21 % arrondi une fois (méthode des logiciels de paie du marché, vérifiée sur des bulletins et des DSN acceptées). Part salariale exonérée = vieillesse salariale ; le reste est la part patronale.

**Créations et reprises depuis le 1er janvier 2026** (LFSS 2026, art. 23 ; décret n° 2026-69 du 6 février 2026).
- Exonération ramenée à 25 % des cotisations concernées sous 75 % du plafond, dégressive jusqu'à 100 %, nulle au-delà : DSNap applique 25 % du montant de l'ancien régime dans chaque zone, réparti entre parts salariale et patronale au prorata.
- L'ACRE n'est plus automatique : la demande se fait auprès de l'Urssaf au plus tard le 60e jour suivant la création. Ne l'active dans DSNap que si l'Urssaf l'a accordée.
- Le régime se déduit de la date de fin de l'ACRE (`choix.acreRegime` : `ancien` ou `2026` pour l'imposer).

## Prélèvement à la source

- Base : net imposable = net avant impôt + CSG non déductible + CRDS.
- Sans taux transmis par la DGFiP : grille du taux neutre métropole en vigueur depuis le 01/05/2026 (BOI-BAREME-000037) : 0 % sous 1 635 €, 0,5 % jusqu'à 1 698 €, 1,3 % jusqu'à 1 807 €, 2,1 % jusqu'à 1 928 €, 2,9 % jusqu'à 2 060 €, 3,5 % jusqu'à 2 170 €, 4,1 % jusqu'à 2 315 €, 5,3 % jusqu'à 2 738 €, 7,5 % jusqu'à 3 135 €, 9,9 % jusqu'à 3 571 €, 11,9 % jusqu'à 4 019 €… (grille complète dans `P.pasGrid`).
- Avec un taux transmis : type 01, identifiant du taux obligatoire (rubrique 50.008).
- Dès que l'impôt prélevé est positif, la DSN contient un bloc Versement DGFiP (prélèvement SEPA, IBAN et BIC de la société, montant arrondi à l'euro).

## Titres-restaurant

- Un titre par jour réellement travaillé ; par défaut les jours ouvrés du mois (lundi–vendredi hors jours fériés).
- Part employeur exonérée si elle est comprise entre 50 % et 60 % de la valeur du titre et ne dépasse pas 7,32 € (2026). Exemple : titre de 12,20 €, 60 % = 7,32 € pour la société, 4,88 € retenus sur le salaire net.
- La retenue de la part salariale ne modifie ni le net imposable ni le « net versé » de la DSN : elle réduit seulement le virement.

## Frais professionnels remboursés au réel

- Quote-part du logement = surface utilisée pour travailler ÷ surface totale × part du temps d'usage professionnel (exemple : 15 ÷ 45 × 50 % = 16,67 %), appliquée au loyer charges comprises, à l'électricité et à l'assurance habitation.
- Box et mobile : part d'usage professionnel (souvent 50 %).
- Remboursement sur justificatifs, hors bulletin et hors DSN. Au-delà d'environ un sixième du logement, il faut pouvoir justifier un usage professionnel exclusif de la pièce.

## Montants Urssaf : nominatif contre agrégé

- Blocs nominatifs (78, 81) : montants au centime, tels que sur le bulletin.
- Bloc 23 (cotisations agrégées par code type de personnel) et bordereau 22 : chaque assiette et chaque montant arrondi à l'euro le plus proche (guide Urssaf de déclaration en DSN, §1.6). Le bordereau est la somme des CTP, chacun recalculé (assiette arrondie × taux) puis arrondi à l'euro ; une déduction (CTP 401, ACRE) est déclarée sans signe, le CTP porte le signe moins.
- CTP utilisés : 027 dialogue social, 260 CSG/CRDS (9,70 %), 332 FNAL plafonné, 401 ACRE, 863 mandataires sociaux (920 : 21,06 % + taux AT ; 921 : 15,45 %), 959 formation professionnelle, 992 taxe d'apprentissage.

## Paiements et échéances

- DSN et cotisations Urssaf : le 15 du mois suivant (entreprise de moins de 50 salariés payant à la fin du mois), reporté au jour ouvré suivant quand le 15 tombe un samedi, un dimanche ou un jour férié. Paiement Urssaf hors DSN par télépaiement ou virement (pas de bloc Versement Urssaf).
- Retard : pénalité de 1,5 % du plafond mensuel par salarié et par mois ou fraction de mois de retard (60,08 € en 2026 pour le président seul).
- Agirc-Arrco : cotisations déclarées dans la DSN ; le règlement dépend de la caisse de la société (prélèvement, adhésion, paiement direct).

## Sources

- Cahier technique DSN 2026.1 (norme P26V01), net-entreprises.
- Guide Urssaf « Comment déclarer et régulariser les cotisations Urssaf en DSN ».
- BOI-BAREME-000037 (grille du taux neutre au 01/05/2026).
- Guide d'implémentation de l'API DSN v6.9 (dépôt et retours).
- LFSS 2026 (loi n° 2025-1403 du 30 décembre 2025), art. 23, et décret n° 2026-69 du 6 février 2026 (ACRE).
- Plafond 2027 : 4 075 € par mois annoncé à titre provisoire (arrêté attendu en décembre 2026) ; DSNap passera aux taux 2027 et à la norme P27V01 avant la première échéance de 2027.
