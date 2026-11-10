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

/* Requêtes du serveur vers le client (MCP « elicitation ») : une question posée à l'utilisateur lui-même, dans une
   fenêtre de son application, dont la réponse ne passe pas par le modèle. */
let peutDemander = false, nDemandes = 0;
const demandes = new Map();
function demanderAuClient(methode, params, delaiMs) {
  const id = 'dsnap-' + (++nDemandes);
  return new Promise(function (resolve, reject) {
    const t = setTimeout(function () { demandes.delete(id); const e = new Error('Pas de réponse de l\'utilisateur dans le délai : rien n\'a été fait.'); e.utilisateur = true; reject(e); }, delaiMs);
    demandes.set(id, function (m) { clearTimeout(t); if (m.error) { const e = new Error('La fenêtre de confirmation n\'a pas pu s\'afficher (' + (m.error.message || m.error.code) + ') : rien n\'a été fait.'); e.utilisateur = true; reject(e); } else resolve(m.result || {}); });
    envoyer({ jsonrpc: '2.0', id: id, method: methode, params: params });
  });
}
/** Demande à l'utilisateur (formulaire de son application) ; null si le client ne sait pas le faire. */
const contexteOutils = {
  get eliciter() {
    if (!peutDemander) return null;
    return function (message, schema) { return demanderAuClient('elicitation/create', { message: message, requestedSchema: schema }, 5 * 60000); };
  }
};

let lignesJournal = 0;
function journal(texte) {
  if (lignesJournal > 60) return;
  lignesJournal++;
  // un seul descripteur, ouvert sans suivre de lien symbolique (O_NOFOLLOW, absent sous Windows) : la taille se lit et
  // le fichier se vide sur le fichier ouvert lui-même, sans fenêtre entre vérification et écriture (alerte CodeQL
  // js/file-system-race du 04/11/2026)
  let fd = null;
  try {
    const f = path.join(chemins.donnees(), 'journal-serveur.log');
    fd = fs.openSync(f, fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_CREAT | (fs.constants.O_NOFOLLOW || 0), 0o600);
    if (fs.fstatSync(fd).size > 200000) fs.ftruncateSync(fd, 0);
    fs.writeSync(fd, new Date().toISOString() + ' ' + texte + '\n');
  } catch (e) { /* facultatif (dont : lien symbolique refusé) */ }
  finally { if (fd !== null) try { fs.closeSync(fd); } catch (e) { /* rien */ } }
}

async function appelerOutil(nom, args) {
  const outil = OUTILS.filter(function (o) { return o.name === nom; })[0];
  if (!outil) { const e = new Error('Outil inconnu : ' + nom); e.inconnu = true; throw e; }
  try {
    const r = await outil.run(args || {}, contexteOutils);
    // le message est aussi le premier champ des données structurées : Claude Code (2.1.309, constaté le 31/10/2026) ne
    // transmet au modèle que structuredContent quand il existe, sans le texte. Il remplace le champ « message » de
    // certaines données (abonnement_dsnap, mettre_a_jour_tables), déjà repris dans le texte.
    return { content: [{ type: 'text', text: masquerSortie(r.texte) }], structuredContent: masquerTout(Object.assign({ message: r.texte }, r.donnees || {}, { message: r.texte })), isError: !!r.erreur };
  } catch (e) {
    if (!e.utilisateur) { log('erreur interne', e && e.stack); journal('erreur interne ' + nom + ' : ' + (e && e.message)); }
    const texte = masquerSortie(e.utilisateur ? e.message : 'Erreur interne de DSNap : ' + (e && e.message) + '. Réessayez ; si elle persiste, signalez-la sur https://cerfaless.fr/dsnap/aide.');
    return { content: [{ type: 'text', text: texte }], structuredContent: { message: texte, erreur: true, configuration: !!e.configuration, incertain: !!e.incertain }, isError: true };
  }
}

async function traiter(msg) {
  if (!msg || typeof msg !== 'object') return;
  const id = msg.id, methode = msg.method, params = msg.params || {};
  if (methode === undefined) { // réponse JSON-RPC à une requête du serveur
    const suite = demandes.get(id);
    if (suite) { demandes.delete(id); suite(msg); }
    return;
  }
  if (methode === 'initialize') {
    const version = VERSIONS.indexOf(params.protocolVersion) >= 0 ? params.protocolVersion : VERSIONS[0];
    // l'elicitation existe depuis la version 2025-06-18 du protocole, et seulement si le client l'annonce
    peutDemander = !!(params.capabilities && params.capabilities.elicitation) && version >= '2025-06-18';
    return repondre(id, {
      protocolVersion: version,
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

module.exports = { demarrer, appelerOutil, traiter, _journal: journal };
