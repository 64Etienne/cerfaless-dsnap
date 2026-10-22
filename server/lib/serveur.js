// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Serveur MCP de DSNap : JSON-RPC 2.0 sur l'entrée et la sortie standard, sans dépendance.
 * Journal de démarrage (sans aucune donnée personnelle) : <dossier de données>/journal-serveur.log.
 */
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { VERSION } = require('./version.js');
const chemins = require('./chemins.js');
const { OUTILS, INSTRUCTIONS, masquerSortie } = require('./outils.js');

/* Dernier filet : tout texte et toute valeur renvoyés au modèle passent par le masquage des numéros de sécurité
   sociale connus (configuration du dossier et fichiers lus). */
function masquerTout(x) {
  if (typeof x === 'string') return masquerSortie(x);
  if (Array.isArray(x)) return x.map(masquerTout);
  if (x && typeof x === 'object') { const o = {}; Object.keys(x).forEach(function (k) { o[k] = masquerTout(x[k]); }); return o; }
  return x;
}

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
function envoyer(o) { process.stdout.write(JSON.stringify(o) + '\n'); }
function repondre(id, result) { envoyer({ jsonrpc: '2.0', id: id, result: result }); }
function erreurRpc(id, code, message) { envoyer({ jsonrpc: '2.0', id: id, error: { code: code, message: message } }); }
function log() { try { process.stderr.write('[dsnap] ' + Array.prototype.join.call(arguments, ' ') + '\n'); } catch (e) { /* rien */ } }

let lignesJournal = 0;
function journal(texte) {
  if (lignesJournal > 60) return;
  lignesJournal++;
  try {
    const f = path.join(chemins.donnees(), 'journal-serveur.log');
    try { if (fs.statSync(f).size > 200000) fs.writeFileSync(f, ''); } catch (e) { /* absent */ }
    fs.appendFileSync(f, new Date().toISOString() + ' ' + texte + '\n');
  } catch (e) { /* facultatif */ }
}

async function appelerOutil(nom, args) {
  const outil = OUTILS.filter(function (o) { return o.name === nom; })[0];
  if (!outil) { const e = new Error('Outil inconnu : ' + nom); e.inconnu = true; throw e; }
  try {
    const r = await outil.run(args || {});
    return { content: [{ type: 'text', text: masquerSortie(r.texte) }], structuredContent: masquerTout(r.donnees || {}), isError: !!r.erreur };
  } catch (e) {
    if (!e.utilisateur) { log('erreur interne', e && e.stack); journal('erreur interne ' + nom + ' : ' + (e && e.message)); }
    const texte = masquerSortie(e.utilisateur ? e.message : 'Erreur interne de DSNap : ' + (e && e.message) + '. Réessayez ; si elle persiste, signalez-la sur https://cerfaless.fr/dsnap/aide.');
    return { content: [{ type: 'text', text: texte }], structuredContent: { erreur: texte, configuration: !!e.configuration, incertain: !!e.incertain }, isError: true };
  }
}

async function traiter(msg) {
  if (!msg || typeof msg !== 'object') return;
  const id = msg.id, methode = msg.method, params = msg.params || {};
  if (methode === undefined) return; // réponse JSON-RPC à une requête du serveur : rien à faire
  if (methode === 'initialize') {
    return repondre(id, {
      protocolVersion: VERSIONS.indexOf(params.protocolVersion) >= 0 ? params.protocolVersion : VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'dsnap', title: 'DSNap', version: VERSION },
      instructions: INSTRUCTIONS
    });
  }
  if (typeof methode === 'string' && methode.indexOf('notifications/') === 0) return;
  if (methode === 'ping') return repondre(id, {});
  if (methode === 'tools/list') return repondre(id, { tools: OUTILS.map(function (o) { return { name: o.name, title: o.title, description: o.description, inputSchema: o.inputSchema, annotations: Object.assign({ title: o.title }, o.annotations) }; }) });
  if (methode === 'tools/call') {
    try { return repondre(id, await appelerOutil(params.name, params.arguments)); }
    catch (e) { if (e.inconnu) return erreurRpc(id, -32602, e.message); throw e; }
  }
  if (methode === 'resources/list') return repondre(id, { resources: [] });
  if (methode === 'prompts/list') return repondre(id, { prompts: [] });
  if (id !== undefined && id !== null) erreurRpc(id, -32601, 'Méthode non prise en charge : ' + methode);
}

let demarre = false;
function demarrer() {
  if (demarre) return;
  demarre = true;
  journal('démarrage DSNap ' + VERSION + ' — Node ' + process.version + ' — ' + process.platform + ' — dossier ' + (chemins.dossierPaie() ? 'configuré' : 'non configuré'));
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', function (ligne) {
    if (!ligne.trim()) return;
    let msg;
    try { msg = JSON.parse(ligne); } catch (e) { erreurRpc(null, -32700, 'JSON invalide'); return; }
    if (msg && msg.method === 'initialize') journal('initialize reçu');
    Promise.resolve(traiter(msg)).catch(function (e) { log('erreur', e && e.stack); journal('erreur : ' + (e && e.message)); if (msg && msg.id !== undefined) erreurRpc(msg.id, -32603, 'Erreur interne'); });
  });
  rl.on('close', function () { process.exit(0); });
  log('prêt (v' + VERSION + ')');
}

module.exports = { demarrer, appelerOutil, traiter };
