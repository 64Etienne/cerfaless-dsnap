# Versions de DSNap

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
