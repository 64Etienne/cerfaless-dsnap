# Dépôt sur net-entreprises

## Principe

L'API DSN de net-entreprises (guide d'implémentation v6.9) permet à un « logiciel de paie » de déposer pour le déclarant avec ses propres identifiants : SIRET, nom, prénom, mot de passe, service 25 (DSN régime général). Aucune charte ni inscription particulière n'est demandée dans ce mode ; il faut seulement que le déclarant soit inscrit au service DSN sur net-entreprises. (Déposer pour le compte de plusieurs entreprises depuis un service central relève au contraire du mode « concentrateur », qui exige la signature d'une charte et une inscription.)

Le serveur DSNap tourne sur l'ordinateur de l'utilisateur (plugin, extension de bureau ou Claude Code). Les identifiants sont saisis sur la page de configuration locale et gardés chiffrés dans le trousseau du système (DPAPI sous Windows, trousseau macOS, Secret Service sous Linux). DSNap ne lit et n'écrit que dans le dossier de paie, et y tient `retours/journal-depots.json`. En mode démonstration, les requêtes vont à un simulateur local et rien ne part vers net-entreprises.

## Outils

| Outil | Rôle |
|---|---|
| `tester_connexion` | Authentifie le déclarant, sans dépôt. Un refus n'est jamais retenté (risque de blocage du compte). |
| `verifier_fichier_dsn` | Contrôle local avant envoi : forme du flux, contenu (cahier technique, recalculs), codes des tables officielles. |
| `deposer_dsn` | Dépôt `test` (fichier 01) ou `reel` (fichier 02). Le réel exige un dépôt test du même contenu dont le bilan n'est pas KO, `confirmation_utilisateur: true` sauf réglage choisi par l'utilisateur, aucun dépôt réel accepté du même mois dans le journal, et l'abonnement pour une DSN avec salaire. |
| `bilan_du_depot` | Attend et télécharge le bilan de conformité (nature 11). |
| `rechercher_depots` | Tous les dépôts du déclarant sur une période (31 jours au plus), y compris hors DSNap. |
| `lister_retours` | Retours d'un flux, avec leur statut. |
| `telecharger_retour` | Enregistre un retour dans `retours/` et renvoie son contenu s'il est lisible. |
| `lister_depots` | Dépôts d'une journée (la recherche net-entreprises est limitée à 24 heures). |
| `journal_depots` | Journal local des dépôts faits par DSNap dans le dossier de paie. |

## Natures de retour utiles

| Nature | Retour | Quand |
|---|---|---|
| 10 | Accusé d'enregistrement électronique (AEE) ou avis de rejet | immédiat, renvoyé par le dépôt |
| 11 | Certificat de conformité / bilan d'anomalies | quelques minutes |
| 20 | Bilan d'identification des salariés | DSN normale |
| 60 / 61 | Accusé de réception / compte rendu Urssaf (cotisations agrégées) | dans les heures qui suivent ; aussi en mode test (vers H+4) |
| 70 / 71 | Accusé de réception / compte rendu Agirc-Arrco | après distribution |

Statuts : OK, ANO (anomalies non bloquantes), KO (bloquant), EN COURS.

## Séquence type

1. `verifier_fichier_dsn` sur le fichier TEST, puis `deposer_dsn` mode `test`. Noter l'identifiant de flux.
2. Patienter quelques minutes ; `lister_retours` jusqu'à obtenir la nature 11. La lire avec `telecharger_retour`.
3. Bilan OK (ou ANO acceptées par l'utilisateur) : obtenir le feu vert, puis `deposer_dsn` mode `reel` sur le fichier REEL avec `confirmation_utilisateur: true`.
4. Plus tard : `lister_retours` sur le flux réel pour les comptes rendus Urssaf et Agirc-Arrco.

Le dépôt réel est refusé si le fichier réel diffère du fichier test ailleurs que sur S10.G00.00.005 : régénérer les deux fichiers ensemble et redéposer en test après toute correction.

## Erreurs

- 401 à l'authentification : identifiants refusés. DSNap ne réessaie pas tant que les identifiants n'ont pas été changés sur la page de configuration.
- 403 : compte bloqué ou non inscrit au service DSN ; à régler sur net-entreprises.fr.
- Dépôt en HTTP 422 : avis de rejet, enregistré dans `retours/` ; lire son contenu et corriger.
- Délai dépassé ou serveur indisponible : réessayer plus tard ; ne pas multiplier les dépôts réels.

## Repli manuel

Si le dépôt par l'API est impossible (abonnement, service indisponible), le fichier `… - REEL.txt` reste dans le dossier de paie : l'utilisateur peut le déposer lui-même sur net-entreprises.fr (rubrique DSN, dépôt de fichier), après un dépôt test du fichier `… - TEST.txt`.
