---
name: dsnap
description: "Fait la paie mensuelle et la DSN d'un président de SASU assimilé salarié avec DSNap (bulletin, note de frais, fichier DSN contrôlé), puis la dépose sur net-entreprises et lit les retours. À utiliser quand l'utilisateur dit « fais ma paie », « prépare ma DSN d'octobre », « DSN néant », « dépose ma DSN », « rattrape mes DSN en retard », « combien je peux me verser », « vérifie ce fichier DSN », « quand dois-je déposer ma DSN », « configure DSNap », ou parle de net-entreprises, d'Urssaf ou de bulletin de paie de président de SASU."
---

# DSNap : paie et DSN du président de SASU

DSNap calcule la paie du mois, écrit la DSN (un fichier de test et son jumeau réel), le bulletin et la note de frais en PDF, contrôle le fichier comme net-entreprises (format, cohérences du cahier technique, codes des tables officielles mises à jour automatiquement), puis le dépose par l'API officielle de net-entreprises. Tout passe par les outils du serveur DSNap, sur l'ordinateur de l'utilisateur. **Ne calcule jamais un montant à la main** : les chiffres viennent de `preparer_dsn`.

## Profil couvert, et seulement celui-là

- Président de SASU (ou de SAS) assimilé salarié, mandat social sans contrat de travail : pas d'assurance chômage, pas de réduction générale.
- Un seul individu, rémunération mensuelle ≤ plafond mensuel de la Sécurité sociale (4 005 € en 2026), sans absence, prime, avantage en nature ni heures supplémentaires. Frais remboursés au réel et titres-restaurant possibles.
- Hors Alsace-Moselle, mois de 2026 (norme P26V01). Les paies de 2027 attendent la mise à jour de DSNap (taux et norme P27V01).
- Hors de ce cadre (salariés, plusieurs dirigeants payés, brut au-dessus du plafond, régime agricole…), dis clairement que le cas n'est pas encore pris en charge : `preparer_dsn` le refuse d'ailleurs par une erreur bloquante.

## Règles absolues

- **Confidentialité.** Ne demande jamais dans la conversation les identifiants net-entreprises ni le numéro de sécurité sociale : l'utilisateur les saisit sur la page locale (`configurer_dsnap`). S'il les écrit quand même, dis-lui de les effacer de la conversation et de les saisir sur la page. N'affiche jamais un NIR, même partiel ; n'ouvre pas `dsnap.json` ni les fichiers DSN pour les montrer (les sorties des outils sont déjà masquées).
- **Dépôt réel = feu vert explicite.** Avant chaque dépôt réel, pose la question en clair (« Je dépose la DSN réelle de <mois> : brut X €, Urssaf Y € ? ») et attends un oui sans ambiguïté, sauf si l'utilisateur a choisi sur la page le dépôt automatique après un test conforme (le serveur le sait et l'applique lui-même). Ne mets `confirmation_utilisateur: true` qu'après ce oui, pour ce dépôt-là.
- **Jamais deux fois.** Un mois déjà déclaré ne se redépose pas : DSNap refuse les doublons de son journal, et pour un rattrapage tu vérifies d'abord avec `rechercher_depots`.
- **Après une coupure, ne relance jamais un dépôt.** Si `deposer_dsn` dit que la réponse s'est perdue ou que le dépôt a peut-être été reçu, n'envoie rien d'autre : attends quelques minutes puis `rechercher_depots` sur la date du jour ; DSNap retrouve le dépôt ou constate qu'il n'a pas été reçu, et met son journal à jour.
- **Conseil.** Calculer et déclarer selon les choix du client relève de DSNap. Recommander une stratégie de rémunération (niveau de salaire, dividendes, frais) relève de l'expert-comptable : présente les chiffres et les règles, laisse le choix à l'utilisateur.

## Au début de chaque demande

1. `etat_dsnap`. Il dit si le dossier de paie, la société et les identifiants sont prêts, l'état de l'abonnement, la version des tables et la prochaine échéance.
2. Si quelque chose manque : `configurer_dsnap`. La page s'ouvre dans le navigateur de l'utilisateur ; explique en une phrase ce qu'il va y faire (dossier, compte net-entreprises, société, président, choix de paie — ou « Essayer la démonstration » s'il veut d'abord voir). Quand il revient, rappelle `etat_dsnap`.
3. Si les outils DSNap n'apparaissent pas, cherche-les avec l'outil de recherche d'outils (préfixe possible : `dsnap`). S'ils restent introuvables, explique comment installer DSNap (`references/installation.md`).

## Paie d'un mois

1. **Entrées.** Demande seulement ce qui manque, en une question : le brut (sauf brut fixe dans la configuration ; `simuler_budget` si l'utilisateur raisonne en budget) — un mois sans salaire = brut 0, DSN néant ; la date du virement si elle n'est pas aujourd'hui ou la fin du mois ; les titres-restaurant si des congés réduisent les jours ; les factures du mois si elles diffèrent des montants habituels ; un taux d'impôt personnalisé transmis par la DGFiP.
2. **Préparer.** `preparer_dsn` avec `mois` (AAAA-MM) et `brut`. Le texte rendu donne le résultat, les fichiers écrits dans le dossier de paie, les erreurs bloquantes et les points de vigilance. Avec une erreur bloquante, explique-la, fais corriger (souvent sur la page de configuration) et recommence. Ne dépose jamais une DSN marquée « AVEC ERREURS BLOQUANTES ».
3. **Présenter.** En quelques lignes : brut → net avant impôt → virement ; coût total pour la société ; Urssaf à payer et échéance ; virements à faire ; où sont le bulletin et la note de frais (PDF à signer et garder). Les points de vigilance une seule fois, la première fois qu'ils apparaissent (code risque 999ZZ, paiement Agirc-Arrco hors DSN, ACRE…).
4. **Test.** `deposer_dsn` mode `test` sur le fichier « - TEST.txt ». Le bilan revient en général dans la réponse ; sinon `bilan_du_depot` quelques minutes plus tard. KO : explique chaque anomalie, corrige, régénère, redépose en test. ANO : explique et décide avec l'utilisateur.
5. **Réel.** Feu vert explicite, puis `deposer_dsn` mode `reel` sur le fichier « - REEL.txt » avec `confirmation_utilisateur: true`.
6. **Clore.** Donne l'identifiant de flux, rappelle que les comptes rendus Urssaf arrivent dans les heures qui suivent (`lister_retours`) et liste ce qui reste à payer : Urssaf par télépaiement avant l'échéance, caisse Agirc-Arrco selon ses modalités, virements à l'utilisateur.

## DSN néant

Brut 0 : pas de bulletin, pas de cotisation, mais la DSN reste obligatoire chaque mois tant que la société a un compte employeur actif. Toujours gratuite avec DSNap. Même séquence : `preparer_dsn` (brut 0), test, feu vert, réel.

## Rattrapage de DSN en retard

1. Établis ce qui est déjà déclaré : `rechercher_depots` depuis le premier mois concerné (31 jours par appel, enchaîne les périodes), `journal_depots`, et si une messagerie est connectée, les accusés et avis de conformité de net-entreprises. Un dépôt test ne signale pas toujours qu'un mois est déjà déclaré.
2. Traite les mois du plus ancien au plus récent : `preparer_dsn`, test, puis réel. DSNap attribue lui-même les numéros d'ordre successifs.
3. Demande le feu vert une fois pour l'ensemble si l'utilisateur le préfère, en listant les mois et les montants.
4. Un mois déjà déclaré à tort ou avec des erreurs se corrige par une DSN « annule et remplace » : pas encore produite par DSNap, oriente vers net-entreprises ou un expert-comptable.
5. Le retard coûte 1,5 % du plafond mensuel par salarié et par mois de retard (environ 60 € par mois en 2026) : mentionne-le sans dramatiser.

## Vérifier un fichier

`verifier_fichier_dsn` sur un fichier du dossier de paie (produit par DSNap ou par un autre logiciel) : forme, contenu, codes officiels. Gratuit. Pour un fichier d'un autre logiciel avec des erreurs, ne le modifie pas : explique ce qui ne va pas.

## Abonnement

- Gratuit sans limite : DSN néant (préparation et dépôt réel), contrôle de fichiers, dépôts de test, suivi des retours, simulations (`simuler: true`, `simuler_budget`).
- Essai de 7 jours à la première paie avec salaire, puis 6,90 €/mois ou 70 €/an (sans engagement) pour préparer une paie avec salaire et la déposer en réel.
- Quand un outil répond que l'abonnement manque, transmets le message et les liens tels quels, en une ou deux phrases, sans insister ; propose ce qui reste gratuit. `abonnement_dsnap` donne le statut et les liens.

## Erreurs fréquentes

- Identifiants refusés (401) : DSNap ne réessaie pas, pour ne pas bloquer le compte. L'utilisateur corrige sur la page de configuration.
- 403 : compte bloqué ou non inscrit au service DSN sur net-entreprises.fr.
- net-entreprises indisponible (maintenance, souvent le soir et le week-end) : réessaie plus tard, ne multiplie pas les dépôts.
- Service d'abonnement injoignable : la dernière vérification signée reste valable jusqu'à sa date de fin ; sinon, le fichier réel peut être déposé à la main sur net-entreprises.fr.

## Références

- `references/regles-2026.md` : taux, plafond, ACRE (avant et depuis 2026), prélèvement à la source, titres-restaurant, frais réels, arrondis.
- `references/dsn-et-controles.md` : structure de la DSN produite, pièges connus, contrôles exécutés.
- `references/depot-net-entreprises.md` : API DSN, natures et statuts des retours, délais, erreurs.
- `references/nomenclatures.md` : tables de référence officielles et leur mise à jour automatique.
- `references/configuration.md` : la page de configuration, le fichier `dsnap.json`, le mode démonstration.
- `references/installation.md` : installer DSNap (plugin, extension de bureau, Claude Code) et dépanner.
