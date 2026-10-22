# Installer DSNap

DSNap a besoin d'un client Claude qui exécute des serveurs MCP **sur l'ordinateur de l'utilisateur** : l'app Claude de bureau (Windows, macOS), Claude Code, ou une session Cowork sur l'ordinateur. Claude sur le web seul ne suffit pas : il ne peut ni écrire dans le dossier de paie ni joindre net-entreprises avec les identifiants de l'utilisateur.

## Trois façons de l'installer

1. **Extension de bureau** (le plus simple sous Windows et macOS, aucun prérequis) : télécharger `dsnap.mcpb` sur https://cerfaless.fr/dsnap/installation, l'ouvrir (double-clic) ou le glisser dans Claude › Paramètres › Extensions, puis « Installer ». Les réglages de l'extension (identifiants, dossier) sont facultatifs : la page de configuration fait tout.
2. **Plugin** (répertoire de plugins de Claude, ou fichier `dsnap.plugin`) : contient ce skill et le serveur. Le serveur se lance avec Node.js 18 ou plus récent, qui doit être installé sur l'ordinateur (https://nodejs.org).
3. **Claude Code** : `claude plugin install` depuis le dépôt GitHub de DSNap, ou `claude mcp add dsnap -- node <chemin>/server/index.js`.

Puis demander à Claude : « Configure DSNap ».

## Dépanner

- **Outils absents** : vérifier que l'extension ou le plugin est activé, redémarrer Claude. Le journal technique `journal-serveur.log` (dossier de données de DSNap) indique si le serveur a démarré.
- **« DSNap demande Node.js 18 »** : installer Node.js, ou utiliser l'extension de bureau qui embarque son propre Node.
- **La page de configuration ne s'ouvre pas** : copier l'adresse donnée par `configurer_dsnap` dans le navigateur de l'ordinateur où tourne Claude.
- **Trousseau indisponible (Linux sans Secret Service)** : DSNap utilise un fichier chiffré avec une clé propre à l'ordinateur (protection plus faible qu'un trousseau), et le dit sur la page.
- **Proxy d'entreprise** : DSNap passe par `curl` si `fetch` échoue (certificat d'inspection, proxy système).
