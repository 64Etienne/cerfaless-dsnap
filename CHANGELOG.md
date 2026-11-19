# Versions de DSNap

## 1.2.0 — novembre 2026

- DSNap passe à 2027 en gardant 2026 : les règles de paie et la norme DSN sont choisies d'après le mois déclaré. Mois de 2026 : règles 2026 et norme P26V01, y compris la DSN de décembre 2026 due le 15 janvier 2027 et les rattrapages faits en 2027. Mois de 2027 : norme P27V01 (cahier technique 2027.1).
- DSN néant de 2027 : prise en charge dès maintenant, en norme P27V01, sans les codes APEN et APET (S21.G00.06.003, S21.G00.11.002), supprimés par cette norme (le code APE, nomenclature NAF 2025, est transmis par le répertoire des déclarants).
- Paie avec salaire de 2027 : refusée avec un message clair tant que les barèmes 2027 ne sont pas publiés officiellement (taux de cotisations, Agirc-Arrco, grille du taux neutre, arrêté du plafond). Elle s'ouvrira sur le serveur de calcul dès leur parution, sans nouvelle version à installer.
- Contrôle d'un fichier : une norme qui ne correspond pas au mois déclaré est signalée ; une rubrique supprimée par la norme, ou une demande de sortie de la DSN (S21.G00.11.024, qui fait fermer le compte cotisant), sont des erreurs bloquantes. DSNap n'écrit jamais cette dernière rubrique.
- Tables de référence : P26V01 et P27V01 suivies ensemble (mise à jour automatique et copie de secours).
- Paquet npm `cerfaless-dsnap` : `npx -y cerfaless-dsnap` lance DSNap dans les autres clients MCP locaux (ChatGPT de bureau, Codex, Cursor, Antigravity), avec Node.js 18 ou plus récent.

## 1.1.0 — novembre 2026

- Le calcul d'une paie avec salaire se fait sur le serveur de Cerfaless : aucune règle de paie n'est livrée avec DSNap. Le salaire et les options de calcul sont envoyés, sans nom ni numéro de sécurité sociale, et ne sont pas conservés. Le fichier DSN et le bulletin restent fabriqués sur votre ordinateur. La DSN néant reste locale, gratuite et sans réseau.
- Essai sans carte : un aperçu de la paie (brut, net, coût total), 5 fois au plus. Abonnement sans compte à créer : 10 calculs par mois de paie, corrections comprises.
- Le message de chaque résultat d'outil (consignes, liens, avertissements) est aussi le premier champ des données structurées (`message`) : Claude Code 2.1.309 ne transmet au modèle que les données structurées quand il y en a (constaté le 31/10/2026 avec DSNap 1.0.0). Erreurs : `message` et `erreur: true`.
- Licence (audit du 03/11/2026) : une autre clé de licence (`DSNAP_CLE_LICENCE`) n'est acceptée que sur un banc d'essai, quand net-entreprises est lui aussi local ; paie avec salaire d'un mois à venir refusée (simulation libre) et dépôt réel d'une DSN avec salaire d'un mois à venir refusé ; jeton en cache refusé hors ligne si l'horloge de l'ordinateur recule ; mode démonstration sans fichier DSN réel (le dépôt réel simulé part du fichier de test).

## 1.0.0 — octobre 2026

Première version publique.
- Paie du président de SASU assimilé salarié (règles 2026), bulletin et note de frais en PDF, DSN P26V01 test et réelle.
- ACRE : ancien régime et régime des créations depuis 2026 (25 %).
- Contrôles : format, cahier technique, recalcul Urssaf, codes des tables officielles mises à jour automatiquement.
- Dépôt par l'API net-entreprises (mode logiciel de paie), bilans, retours, recherche des dépôts, garde-fous contre les doublons.
- Page de configuration locale, identifiants dans le trousseau du système, import de la dernière DSN.
- Mode démonstration avec simulateur de net-entreprises.
- Abonnement : DSN néant gratuite, essai de 7 jours, puis 6,90 €/mois ou 70 €/an.
