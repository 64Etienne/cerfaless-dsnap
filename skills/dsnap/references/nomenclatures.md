# Tables de référence DSN (nomenclatures)

## Ce que sont ces tables

Pour chaque norme DSN (P26V01 pour 2026, P27V01 pour 2027), net-entreprises publie environ une fois par mois des tables de valeurs : codes risque AT (RAT), conventions collectives (IDCC), NAF, PCS-ESE, codes postaux (HEX), communes (INSEE), pays (PAY, PAYS), organismes (IVO, ICI, IBC, ODRT, RRC), organismes complémentaires et délégataires (PREV, MUT, ASSU, OCI, DLG…), barème du prélèvement à la source (BAR), etc. Chaque table indique les rubriques qu'elle contrôle et la date de validité de chaque code.

Page officielle, en accès libre : `https://www.net-entreprises.fr/nomenclatures-dsn-p26v01/` (remplacer `p26v01` par la norme). On y trouve :

- un tableau des tables : nom, abréviation, rubriques concernées, fournisseur, lien CSV, date de dernière mise à jour de la table ;
- le fichier qui regroupe toutes les tables (`…_CUMUL_P26V01.csv`, première cellule = date de publication), la release note de la dernière version (`…_RLN_P26V01.csv`), l'index des correspondances table → rubriques (`.xls`), une archive ZIP (tables séparées + cumul : même contenu) et la table des trigrammes des organismes (`.xls`) ;
- l'historique des versions (« Version P26V01 v13 du 24/09/2026 », …) ;
- un abonnement par courriel aux mises à jour (facultatif).

Le flux RSS du site (`https://www.net-entreprises.fr/feed/`) n'annonce pas chaque version des tables, mais publie les annonces importantes (catégorie « Nomenclatures », par exemple la nouvelle nomenclature NAF de janvier 2027).

Encodages : les tables et le cumul sont en ISO-8859-1, la release note en UTF-8 ; le lecteur reconnaît les deux.

## Où sont les tables

- **Cache local** (sur l'ordinateur de l'utilisateur, dans le dossier de données de DSNap) : `nomenclatures/<norme>.json.gz` et `nomenclatures/etat.json` (dernière vérification). Rempli au premier usage depuis net-entreprises.fr, puis tenu à jour.
- **Version embarquée** : l'extension de bureau (`dsnap.mcpb`) contient les tables P26V01 et P27V01 du jour de sa fabrication ; le plugin n'en contient pas (il les télécharge). Le contrôle utilise le plus récent des deux jeux.
- **Copie de secours** : si net-entreprises est injoignable et qu'aucune table n'est installée, DSNap prend la copie publiée sur cerfaless.fr, ou à défaut celle des versions publiées du projet sur GitHub (même contenu, empreinte SHA-256 vérifiée).

Format du jeu : `{ norme, version, datePublication, historique, fichiers, tables: { ABR: { nom, rubriques, fournisseur, maj, csv, n, codes: { code: [libellé, début, fin, trigramme] } } }, supprimes, nouveautes }`, dates au format AAAA-MM-JJ. Les adresses des 115 000 établissements FINESS (table EFE) ne sont pas conservées, seulement leurs codes et dates.

## Mise à jour (automatique, ou outil `mettre_a_jour_tables`)

DSNap vérifie les tables au plus toutes les 12 heures, avant une préparation ou un contrôle (et tout de suite si aucune table n'est installée). L'outil `mettre_a_jour_tables` force une vérification (`forcer` pour tout retélécharger, `verifier_seulement` pour comparer).


1. Lit la page de chaque norme connue et sonde les normes suivantes (`P27V01`, `P26V02`…) : une page qui répond avec ses tables signale une nouvelle norme, récupérée aussitôt.
2. Compare la date de chaque table et la version publiée à la version locale.
3. Télécharge seulement les tables republiées (fichier CSV de la table) ; le fichier complet (16 Mo) au premier passage, avec `forcer`, si plus de 8 tables ont changé, ou si une nouvelle version est publiée sans table visiblement modifiée (jamais de simple réétiquetage). Télécharge toujours la release note (son absence est signalée).
4. Garde les codes retirés : la table complète ne contient plus un code supprimé ; l'historique de la page (« Suppression de n code(s) », version par version, avec les dates) et la release note donnent sa période de validité. Il reste connu (`supprimes`, 99 codes pour P26V01 v2 à v13) pour contrôler les mois où il était valide.
5. Vérifie le résultat avant d'écrire, de façon atomique : toutes les tables présentes, non vides, datées et rattachées à au moins une rubrique ; date du fichier complet = date annoncée par la page ; une table absente du fichier complet est une erreur. Si le fichier d'une table est plus ancien que la date affichée sur la page, c'est la date du fichier qui est gardée (la table sera redemandée au passage suivant). En cas d'incohérence : statut `echec`, rien n'est écrit.
6. Lit le flux RSS et retient les actualités sur les nomenclatures et les normes depuis la dernière vérification (45 jours au premier passage).
7. Note dans `etat.json` les versions vues sur le site ; la date de dernière vérification n'avance que si les tables locales sont à jour (`a_jour` ou `mis_a_jour`). Une version publiée mais pas appliquée (échec, vérification seule, coupure) est donc signalée par le contrôle.

Réseau : `fetch` de Node, puis `curl` si `fetch` échoue (proxy, certificat) ; 25 s pour une page, 120 s pour un fichier. 404 : page ou fichier absent. 429, 5xx (maintenance) ou réseau coupé : statut `hors_ligne`, arrêt des appels suivants, tables locales utilisées. Page reçue mais illisible (structure modifiée) : statut `echec`, rien n'est écrit.

Résultat : `statut` (`a_jour`, `mis_a_jour`, `mise_a_jour_disponible`, `hors_ligne`, `echec`), normes (locale, distante, tables modifiées, nouveautés), nouvelles normes, actualités et un `message` d'une phrase pour l'utilisateur (vide si rien à signaler). Donne ce message tel quel quand il n'est pas vide.

## Contrôle des codes

Pour chaque rubrique de la DSN rattachée à une table (d'après la page officielle), dans la norme du fichier (S10.G00.00.006). La période de validité retenue dépend du bloc : le mois déclaré (S20.G00.05.005) en général ; de janvier de l'année précédente à la fin du mois pour la déclaration annuelle OETH (S21.G00.13, déposée en avril pour l'année N-1) ; existence du code seulement pour les anciennes valeurs d'un contrat modifié (S21.G00.41). Le barème BAR est celui de l'année de versement (S21.G00.50.001).

| Situation | Niveau |
|---|---|
| Code présent et valide pendant le mois | OK |
| Code présent mais hors de sa période de validité (pas encore ouvert, ou fermé) | Erreur bloquante |
| Code absent de toutes les tables de la rubrique | Erreur bloquante |
| Code absent, mois antérieur à la dernière mise à jour d'une des tables de la rubrique (code peut-être retiré depuis) | Vigilance |
| Même code à la casse près (`388A` au lieu de `388a`) | Vigilance |
| Valeur d'échappement (libellé « Valeur d'échappement ») | Vigilance (999ZZ : expliqué par le moteur) |
| Taux du prélèvement à la source (S21.G00.50.006) absent du barème BAR de l'année et du type (S21.G00.50.007) | Erreur bloquante |
| Taux présent dans le barème mais pas celui de la tranche de la base (S21.G00.50.013) | Vigilance |
| Taux personnalisé transmis par la DGFiP (type 01) | Pas de contrôle par le barème |
| Version plus récente vue sur net-entreprises mais pas encore appliquée | Vigilance |
| Tables non vérifiées sur net-entreprises depuis plus de 35 jours | Vigilance |

Le moteur contrôle aussi, indépendamment des tables, l'adresse de l'entreprise (CCH-11 de S21.G00.06.005) : code postal présent, ou bien code pays et code de distribution à l'étranger.

Ces contrôles portent sur les valeurs, pas sur toutes les règles du cahier technique : le dépôt en mode test reste la vérification officielle.

## Norme P27V01 (2027)

Publiée le 24/09/2026 (v1) : 38 tables, dont la nouvelle ERADS (éléments de revenu associés à des droits spécifiques, S21.G00.59.001). Les codes APEN et APET (S21.G00.06.003, S21.G00.11.002) n'y sont plus rattachés à la table NAF (nouvelle nomenclature NAF à partir de janvier 2027). Le moteur produit des fichiers P26V01 (mois de 2026) : les tables 2027 servent dès maintenant à contrôler un fichier P27V01 produit ailleurs, et prépareront le passage de DSNap à 2027.

## Trigrammes des organismes (table des trigrammes, P25V01)

Les tables IVO, ICI, IBC, ODRT et RRC portent un trigramme qui identifie la famille de l'organisme destinataire :

| Organisme | Trigramme |
|---|---|
| Agirc-Arrco (retraite complémentaire) | AAR |
| Caisse CIBTP · UCF-CIBTP | CIB · UCF |
| CAMIEG · CNIEG | CAM · CNI |
| CCVRP | CCV |
| Congés spectacles (Audiens) | AUD |
| CRPCEN · CRPNPAC | CRC · CRN |
| Organisme complémentaire FFA (assurances) · CTIP (prévoyance) · FNMF (mutuelles) · isolé | FFS · CTI · FNM · OCI |
| Délégataires de gestion d'un organisme complémentaire | DFF · DCT · DFN · DOC |
| Ircantec · MSA | IRC · MSA |
| France Travail (ex-Pôle emploi) | PES · PEM |
| Urssaf · DGFiP | URS · FIP |
| CNBF · RAEP | CNB · RAE |

## Confidentialité

Le NIR n'est jamais affiché : DSNap masque, dans toute sortie de ses outils, la valeur réellement présente dans les fichiers (même mal formée), le titre du contrôle NIR du moteur, la clé calculée, et tout nombre en forme de NIR dans les bilans et comptes rendus téléchargés.
