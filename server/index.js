// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
// Point d'entrée du serveur MCP de DSNap (lancé par Claude : plugin, extension de bureau ou Claude Code).
// Démarrage inconditionnel : Claude Desktop charge ce fichier avec son propre Node, sans « require.main ».
if (+process.versions.node.split('.')[0] < 18) {
  process.stderr.write('DSNap demande Node.js 18 ou plus récent (version actuelle : ' + process.version + ').\n');
  process.exit(1);
}
require('./lib/serveur.js').demarrer();
