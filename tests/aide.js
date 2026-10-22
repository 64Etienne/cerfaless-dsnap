'use strict';
/* Outils de test : serveur MCP lancé dans un processus, faux net-entreprises, faux service de licences. */
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const zlib = require('zlib');
const crypto = require('crypto');

const SERVEUR = path.join(__dirname, '..', 'server', 'index.js');

function tmp(nom) { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'dsnap-' + nom + '-')); return d; }

/** Lance le serveur MCP ; renvoie { appeler(outil, args), rpc(methode, params), sorties[], fermer() }. */
function lancer(env) {
  const p = spawn(process.execPath, [SERVEUR], { env: Object.assign({}, process.env, { DSNAP_TROUSSEAU: 'fichier', DSNAP_SANS_NAVIGATEUR: '1' }, env), stdio: ['pipe', 'pipe', 'pipe'] });
  let tampon = '', n = 0;
  const attente = {}, sorties = [];
  p.stdout.on('data', function (d) {
    tampon += d.toString('utf8');
    let i;
    while ((i = tampon.indexOf('\n')) >= 0) {
      const l = tampon.slice(0, i); tampon = tampon.slice(i + 1);
      if (!l.trim()) continue;
      sorties.push(l);
      const m = JSON.parse(l);
      if (attente[m.id]) { attente[m.id](m); delete attente[m.id]; }
    }
  });
  let stderr = '';
  p.stderr.on('data', function (d) { stderr += d; });
  function rpc(methode, params) {
    const id = ++n;
    return new Promise(function (resolve, reject) {
      const t = setTimeout(function () { reject(new Error('délai dépassé : ' + methode + '\n' + stderr)); }, 60000);
      attente[id] = function (m) { clearTimeout(t); resolve(m); };
      p.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: id, method: methode, params: params || {} }) + '\n');
    });
  }
  async function appeler(nom, args) {
    const m = await rpc('tools/call', { name: nom, arguments: args || {} });
    if (m.error) throw new Error(m.error.message);
    return { texte: m.result.content[0].text, donnees: m.result.structuredContent, erreur: m.result.isError };
  }
  return { rpc, appeler, sorties, fermer: function () { p.stdin.end(); p.kill(); }, stderr: function () { return stderr; } };
}

/** Faux net-entreprises (HTTP local). Les dépôts sont gardés en mémoire ; bilans OK sauf si bilanKO(). */
function fauxNetEntreprises(o) {
  o = o || {};
  const etat = { depots: [], auth: 0, refus: 0, bilan: 'OK', motdepasse: o.motdepasse || 'secret' };
  const jetons = new Set();
  const srv = http.createServer(function (req, res) {
    const parts = [];
    req.on('data', function (d) { parts.push(d); });
    req.on('end', function () {
      const corps = Buffer.concat(parts), u = req.url;
      const rep = function (code, obj, type) { const b = Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj)); res.writeHead(code, { 'Content-Type': type || 'application/json' }); res.end(b); };
      if (u.indexOf('/auth') === 0) {
        etat.auth++;
        const x = corps.toString('utf8');
        if (x.indexOf('<motdepasse>' + etat.motdepasse + '</motdepasse>') < 0) { etat.refus++; return rep(401, 'refus', 'text/plain'); }
        const j = 'J' + crypto.randomBytes(8).toString('hex'); jetons.add(j);
        res.writeHead(200, { 'Content-Type': 'text/plain', Expires: new Date(Date.now() + 1800000).toUTCString() }); return res.end(j);
      }
      const a = /jeton=(\S+)/.exec(req.headers.authorization || '');
      if (!a || !jetons.has(a[1])) return rep(401, 'jeton', 'text/plain');
      if (u.indexOf('/depot/') === 0) {
        const dsn = zlib.gunzipSync(corps).toString('latin1');
        if (etat.coupure === 'avant') { etat.coupure = null; req.socket.destroy(); return; }
        const id = 'F' + (100000 + etat.depots.length);
        const val = function (c) { const m = new RegExp(c.replace(/\./g, '\\.') + ",'([^']*)'").exec(dsn); return m ? m[1] : ''; };
        etat.depots.push({ id: id, dsn: dsn, reel: val('S10.G00.00.005') === '02', mois: val('S20.G00.05.005'), date: new Date() });
        if (etat.coupure === 'apres') { etat.coupure = null; req.socket.destroy(); return; }
        if (etat.coupure === '502') { etat.coupure = null; return rep(502, 'passerelle'); }
        return rep(200, { envoi_etat: 'OK', idflux: id });
      }
      if (u.indexOf('/retours/') === 0) {
        const id = decodeURIComponent(u.split('/').pop());
        const d = etat.depots.find(function (x) { return x.id === id; });
        if (!d) return rep(200, { retours: { flux: [] } });
        return rep(200, { retours: { flux: [{ id: id, retour: [{ nature: '10', statut: 'OK' }, { nature: '11', statut: etat.bilan, url: 'http://127.0.0.1:' + srv.address().port + '/telechargement/' + id }] }] } });
      }
      if (u.indexOf('/depots/') === 0) {
        const ne = function (d) { const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d); const g = function (t) { return p.find(function (x) { return x.type === t; }).value; }; return g('year') + g('month') + g('day') + g('hour') + g('minute') + g('second'); };
        return rep(200, { depots: { declarant: [{ depot: etat.depots.map(function (d) { return { idflux: d.id, date: ne(d.date), statut: 'Traité' }; }) }] } });
      }
      if (u.indexOf('/telechargement/') === 0) {
        // le bilan cite le NIR du salarié, comme certains bilans réels : il doit être masqué dans la réponse au modèle
        const d = etat.depots.find(function (x) { return x.id === u.split('/').pop(); });
        const nir = d ? (/S21\.G00\.30\.001,'([^']*)'/.exec(d.dsn) || [])[1] || '' : '';
        return rep(200, '<bilan><statut>' + etat.bilan + '</statut><individu>' + nir + '</individu></bilan>', 'application/xml');
      }
      rep(404, 'inconnu', 'text/plain');
    });
  });
  return new Promise(function (resolve) {
    srv.listen(0, '127.0.0.1', function () {
      const b = 'http://127.0.0.1:' + srv.address().port;
      resolve({ etat: etat, fermer: function () { srv.close(); }, env: { NE_AUTORISER_HTTP: '1', NE_URL_AUTH: b + '/auth/', NE_URL_DEPOT: b + '/depot/', NE_URL_RETOURS: b + '/retours/', NE_URL_DEPOTS: b + '/depots/', NE_URL_TELECHARGEMENT: b + '/telechargement/' } });
    });
  });
}

/** Faux service de licences : réponse signée avec une clé de test ; statut réglable (essai, actif, expire, panne). */
function fauxLicences() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const etat = { statut: 'essai', appels: [], panne: false };
  const srv = http.createServer(function (req, res) {
    const parts = [];
    req.on('data', function (d) { parts.push(d); });
    req.on('end', function () {
      const corps = JSON.parse(Buffer.concat(parts).toString('utf8') || '{}');
      etat.appels.push(corps);
      if (etat.panne) { res.writeHead(503); return res.end('panne'); }
      if (etat.statut === 'nouveau' && !corps.demarrer) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ statut: 'nouveau' })); }
      const fin = etat.statut === 'expire' ? new Date(Date.now() - 86400000) : new Date(Date.now() + 7 * 86400000);
      const p = Buffer.from(JSON.stringify({ v: 1, s: corps.s, st: etat.statut, fin: fin.toISOString(), emis: new Date().toISOString(), essaiFin: fin.toISOString(), plan: etat.statut === 'actif' ? 'mensuel' : null })).toString('base64url');
      const sig = crypto.sign(null, Buffer.from(p), privateKey).toString('base64url');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ jeton: p + '.' + sig }));
    });
  });
  return new Promise(function (resolve) {
    srv.listen(0, '127.0.0.1', function () {
      resolve({ etat: etat, fermer: function () { srv.close(); }, env: { DSNAP_API: 'http://127.0.0.1:' + srv.address().port + '/api', DSNAP_CLE_LICENCE: publicKey.export({ type: 'spki', format: 'pem' }) } });
    });
  });
}

/** Ouvre la page de configuration (lien à usage unique) et renvoie le cookie de session. */
function ouvrirSession(url) {
  const u = new URL(url);
  return new Promise(function (resolve, reject) {
    http.get({ hostname: u.hostname, port: u.port, path: u.pathname }, function (res) {
      res.resume();
      const c = (res.headers['set-cookie'] || [])[0] || '';
      resolve({ status: res.statusCode, cookie: c.split(';')[0], base: 'http://' + u.host + '/app/' });
    }).on('error', reject);
  });
}
const sessions = {};
/** Requête vers la page de configuration locale (session ouverte au premier appel pour ce lien). */
async function page(url, route, corps, entetes) {
  if (!sessions[url]) sessions[url] = await ouvrirSession(url);
  const sess = sessions[url];
  return requetePage(sess.base, route, corps, Object.assign({ Cookie: sess.cookie }, entetes || {}));
}
function requetePage(base, route, corps, entetes) {
  const u = new URL(route, base);
  return new Promise(function (resolve, reject) {
    const b = corps === undefined ? null : Buffer.from(JSON.stringify(corps));
    const req = http.request({ method: b ? 'POST' : 'GET', hostname: u.hostname, port: u.port, path: u.pathname, headers: Object.assign(b ? { 'Content-Type': 'application/json', 'X-DSNap': '1', 'Content-Length': b.length } : {}, entetes || {}) }, function (res) {
      const parts = []; res.on('data', function (d) { parts.push(d); });
      res.on('end', function () { const t = Buffer.concat(parts).toString('utf8'); let j = null; try { j = JSON.parse(t); } catch (e) { j = null; } resolve({ status: res.statusCode, json: j, texte: t }); });
    });
    req.on('error', reject);
    if (b) req.write(b);
    req.end();
  });
}

/** Formulaire de configuration d'une société de test (NIR fictif à clé correcte). */
function formulaireTest() {
  return {
    raisonSociale: 'TEST SASU', siret: '99999999800001', ape: '6201Z', adresse: '10 RUE DES TESTS', codePostal: '31000', ville: 'TOULOUSE', urssafSiret: '53514650000017', idcc: '9999',
    civiliteContact: '01', contactNom: 'JEAN TEST', contactMel: 'jean@example.com', contactTel: '0600000000', iban: 'FR7630004000031234567890143', bic: 'BNPAFRPPXXX',
    codeRisque: '999ZZ', tauxAT: '0', nir: '185073100500150', nomNaissance: 'Test', prenoms: 'Jean', dateNaissance: '1985-07-01', lieuNaissance: 'Toulouse', paysNaissance: 'FR',
    adresseIndividu: '10 rue des tests', cpIndividu: '31000', villeIndividu: 'Toulouse', codificationUE: '01', debutMandat: '2025-10-01', libelleEmploi: 'President', pcs: '388a',
    numeroContrat: '', statutCategoriel: '01', brutMode: 'demande', budgetMensuel: '2200', acre: 'oui', acreFin: '2026-09-30', pasMode: 'bareme',
    surfTotale: '45', surfBureau: '10', usagePro: '50', loyer: '700', elec: '50', assurance: '10', box: '30', usageBox: '50', mobile: '10', usageMobile: '50', trFaciale: '0', trPartPat: '0', depotReel: 'feu_vert'
  };
}

module.exports = { lancer, fauxNetEntreprises, fauxLicences, page, requetePage, ouvrirSession, tmp, formulaireTest };
