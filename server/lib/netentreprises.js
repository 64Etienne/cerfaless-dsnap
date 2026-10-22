// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Client de l'API DSN de net-entreprises, en mode « logiciel de paie » (guide d'implémentation de l'API DSN v6.9) :
 *   1. authentification du déclarant (SIRET, nom, prénom, mot de passe ; service 25 = DSN régime général) ;
 *   2. dépôt unitaire d'un flux DSN (corps gzip, fichier ISO-8859-1) ;
 *   3. consultation et téléchargement des retours, recherche des dépôts du déclarant.
 *
 * Les identifiants viennent d'un fournisseur (trousseau du système, ou réglages de l'extension) : ils ne sont
 * jamais écrits sur disque en clair ni renvoyés au modèle. En mode démonstration, les requêtes vont à un
 * simulateur local (demo.js) : rien ne part vers net-entreprises.
 */
const https = require('https');
const http = require('http');
const zlib = require('zlib');
const crypto = require('crypto');

const ENV = process.env;
const URLS = {
  auth: ENV.NE_URL_AUTH || 'https://services.net-entreprises.fr/authentifier/1.0/',
  depot: ENV.NE_URL_DEPOT || 'https://depot.dsnrg.net-entreprises.fr/deposer-dsn/2.0/',
  retoursFlux: ENV.NE_URL_RETOURS || 'https://consultation.dsnrg.net-entreprises.fr/lister-retours-flux/2.0/',
  depots: ENV.NE_URL_DEPOTS || 'https://consultation.dsnrg.net-entreprises.fr/lister-depots/2.0/',
  telechargement: (ENV.NE_URL_TELECHARGEMENT || 'https://telechargement.dsnrg.net-entreprises.fr/,https://telechargement-edit.dsnrg.net-entreprises.fr/').split(',')
};
const URLS_DEMO = {
  auth: 'https://demo.dsnap.invalid/authentifier/1.0/',
  depot: 'https://demo.dsnap.invalid/deposer-dsn/2.0/',
  retoursFlux: 'https://demo.dsnap.invalid/lister-retours-flux/2.0/',
  depots: 'https://demo.dsnap.invalid/lister-depots/2.0/',
  telechargement: ['https://demo.dsnap.invalid/telechargement/']
};
const ALLOW_HTTP = ENV.NE_AUTORISER_HTTP === '1'; // réservé aux tests contre un faux serveur local
const SERVICE = ENV.NE_SERVICE || '25';

const NATURES = {
  '10': 'Accusé d\'enregistrement électronique (AEE) ou avis de rejet',
  '11': 'Certificat de conformité / bilan d\'anomalies',
  '20': 'Bilan d\'identification des salariés',
  '21': 'Contrôles inter-déclarations',
  '30': 'Accusé de réception CNAM', '31': 'Bilan de traitement AT', '34': 'Compte rendu AT',
  '40': 'Accusé de réception France Travail', '44': 'Attestation employeur / CRM fin de contrat',
  '50': 'Accusé de distribution à l\'organisme complémentaire', '51': 'Compte rendu de l\'organisme complémentaire',
  '60': 'Accusé de réception Urssaf', '61': 'Compte rendu Urssaf (cotisations agrégées)',
  '70': 'Accusé de réception Agirc-Arrco', '71': 'Compte rendu Agirc-Arrco',
  '80': 'Retour DGFiP (prélèvement à la source)'
};

function fail(msg, extra) { const e = new Error(msg); e.utilisateur = true; if (extra) Object.assign(e, extra); return e; }
function xmlEsc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]; }); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function decode(buf) {
  try { return new (require('util').TextDecoder)('utf-8', { fatal: true }).decode(buf); } catch (e) { return Buffer.from(buf).toString('latin1'); }
}
function extrait(buf, n) { const t = Buffer.isBuffer(buf) ? decode(buf) : String(buf); return t.length > n ? t.slice(0, n) + '…' : t; }
/* Dates des services de recherche : yyyyMMddHHmmss, heure de Paris. */
function dateNE(d) {
  const p = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).formatToParts(d);
  const g = function (t) { return (p.filter(function (x) { return x.type === t; })[0] || {}).value; };
  return g('year') + g('month') + g('day') + (g('hour') === '24' ? '00' : g('hour')) + g('minute') + g('second');
}

/* ------------------------------------------------------------------ HTTP */
function requeteReseau(ua) {
  return function (methode, url, entetes, corps) {
    return new Promise(function (resolve, reject) {
      let u;
      try { u = new URL(url); } catch (e) { reject(fail('Adresse invalide : ' + url)); return; }
      if (u.protocol !== 'https:' && !(ALLOW_HTTP && u.protocol === 'http:')) { reject(fail('Seules les adresses https sont autorisées.')); return; }
      const mod = u.protocol === 'https:' ? https : http;
      const h = Object.assign({ 'User-Agent': ua, 'Accept': '*/*' }, entetes || {});
      if (corps) h['Content-Length'] = corps.length;
      const req = mod.request({ method: methode, hostname: u.hostname, port: u.port || undefined, path: u.pathname + u.search, headers: h, timeout: 90000 }, function (res) {
        const parts = [];
        res.on('data', function (c) { parts.push(c); });
        res.on('end', function () {
          let body = Buffer.concat(parts);
          const enc = String(res.headers['content-encoding'] || '').toLowerCase();
          try { if (enc === 'gzip') body = zlib.gunzipSync(body); else if (enc === 'deflate') body = zlib.inflateSync(body); } catch (e) { /* corps laissé tel quel */ }
          resolve({ status: res.statusCode, headers: res.headers, body: body });
        });
      });
      req.on('timeout', function () { req.destroy(fail('Délai dépassé en contactant ' + u.hostname)); });
      req.on('error', function (e) { reject(e.utilisateur ? e : fail('Connexion impossible à ' + u.hostname + ' : ' + e.message, { reseau: true })); });
      if (corps) req.write(corps);
      req.end();
    });
  };
}

/* ------------------------------------------------------------------ vérification d'un flux DSN avant envoi */
function utf8Multioctet(buf) {
  for (let i = 0; i < buf.length; i++) {
    const b = buf[i];
    if (b < 0x80) continue;
    const n = (b & 0xE0) === 0xC0 ? 1 : (b & 0xF0) === 0xE0 ? 2 : (b & 0xF8) === 0xF0 ? 3 : 0;
    if (!n || i + n >= buf.length) continue;
    let ok = true;
    for (let k = 1; k <= n; k++) if ((buf[i + k] & 0xC0) !== 0x80) { ok = false; break; }
    if (ok) return true;
  }
  return false;
}
/**
 * Contrôle de forme d'un flux avant dépôt. hash : empreinte du contenu sans la rubrique S10.G00.00.005, si bien
 * qu'un fichier TEST et son jumeau RÉEL ont la même empreinte.
 */
function verifierFlux(buf, siretCompte) {
  const erreurs = [], avert = [];
  if (!buf.length) return { ok: false, erreurs: ['Fichier vide.'], avertissements: [] };
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) erreurs.push('Le fichier commence par une marque UTF-8 (BOM) : enregistrez-le en ISO-8859-1.');
  else if (utf8Multioctet(buf)) erreurs.push('Le fichier contient des caractères encodés en UTF-8 : net-entreprises attend de l\'ISO-8859-1.');
  const texte = buf.toString('latin1');
  const lignes = texte.split(/\r?\n/);
  if (lignes.length && lignes[lignes.length - 1] === '') lignes.pop();
  const val = {}, compte = {};
  lignes.forEach(function (l, i) {
    const m = /^(S\d{2}\.G\d{2}\.\d{2}\.\d{3}),'(.*)'$/.exec(l);
    if (!m) { if (erreurs.length < 8) erreurs.push('Ligne ' + (i + 1) + ' illisible (format RUBRIQUE,\'valeur\' attendu, sans espace après la valeur).'); return; }
    if (!(m[1] in val)) val[m[1]] = m[2];
    compte[m[1]] = (compte[m[1]] || 0) + 1;
  });
  if (!/^S10\.G00\.00\.001,/.test(lignes[0] || '')) erreurs.push('Le fichier ne commence pas par S10.G00.00.001.');
  if ((compte['S20.G00.05.001'] || 0) !== 1) erreurs.push('Le dépôt doit contenir exactement une déclaration (un seul bloc S20) ; trouvé : ' + (compte['S20.G00.05.001'] || 0) + '.');
  if (String(lignes.length) !== val['S90.G00.90.001']) erreurs.push('S90.G00.90.001 vaut ' + val['S90.G00.90.001'] + ' alors que le fichier compte ' + lignes.length + ' lignes.');
  const essai = val['S10.G00.00.005'];
  if (essai !== '01' && essai !== '02') erreurs.push('S10.G00.00.005 doit valoir 01 (test) ou 02 (réel).');
  const siret = (val['S21.G00.06.001'] || '') + (val['S21.G00.11.001'] || '');
  if (siretCompte && siret && siret !== String(siretCompte).trim()) avert.push('Le SIRET déclaré (' + siret + ') diffère du SIRET du compte net-entreprises (' + String(siretCompte).trim() + ') : possible si ce compte déclare pour plusieurs établissements, sinon vérifiez.');
  const normal = lignes.filter(function (l) { return l.indexOf('S10.G00.00.005,') !== 0; }).join('\n');
  const mois = val['S20.G00.05.005'] || '';
  return {
    ok: erreurs.length === 0, erreurs: erreurs, avertissements: avert, essaiReel: essai, nbLignes: lignes.length,
    mois: mois.length === 8 ? mois.slice(4) + '-' + mois.slice(2, 4) : mois, siret: siret, siren: val['S21.G00.06.001'] || '',
    norme: val['S10.G00.00.006'] || '', nature: val['S20.G00.05.001'] || '', typeDeclaration: val['S20.G00.05.002'] || '',
    type: val['S20.G00.05.002'] === '02' || val['S20.G00.05.002'] === '05' ? 'néant' : 'normale',
    hash: crypto.createHash('sha256').update(normal, 'latin1').digest('hex')
  };
}

/* ------------------------------------------------------------------ lecture des réponses */
function chercher(obj, cle) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) { for (let i = 0; i < obj.length; i++) { const r = chercher(obj[i], cle); if (r !== null) return r; } return null; }
  for (const k of Object.keys(obj)) {
    if (k.toLowerCase() === cle && (typeof obj[k] === 'string' || typeof obj[k] === 'number')) return String(obj[k]);
  }
  for (const k of Object.keys(obj)) { const r = chercher(obj[k], cle); if (r !== null) return r; }
  return null;
}
function enListe(x) { return x === undefined || x === null ? [] : (Array.isArray(x) ? x : [x]); }
function analyserRetours(texte) {
  let j = null;
  try { j = JSON.parse(texte); } catch (e) { j = null; }
  const flux = [];
  if (j && j.retours) {
    enListe(j.retours.flux).forEach(function (f) {
      flux.push({ id: f.id, retours: enListe(f.retour).map(function (r) { return { nature: String(r.nature), libelle: NATURES[String(r.nature)] || 'Retour ' + r.nature, statut: r.statut, publication: r.publication, production: r.production, url: r.url || null, ops: r.ops || null }; }) });
    });
    return flux;
  }
  // repli XML (service 1.0)
  const re = /<flux>([\s\S]*?)<\/flux>/g; let m;
  while ((m = re.exec(texte))) {
    const id = (/<id>([^<]+)<\/id>/.exec(m[1]) || [])[1];
    const rs = []; const rr = /<retour>([\s\S]*?)<\/retour>/g; let n;
    while ((n = rr.exec(m[1]))) {
      const g = function (t) { const x = new RegExp('<' + t + '>([\\s\\S]*?)</' + t + '>').exec(n[1]); return x ? x[1].replace(/\s+/g, '') : null; };
      rs.push({ nature: g('nature'), libelle: NATURES[g('nature')] || 'Retour ' + g('nature'), statut: g('statut'), publication: g('publication'), production: g('production'), url: g('url') });
    }
    flux.push({ id: id, retours: rs });
  }
  return flux;
}
function depotsDeReponse(texte) {
  let j = null; try { j = JSON.parse(texte); } catch (e) { j = null; }
  return j && j.depots ? enListe(j.depots.declarant).reduce(function (acc, dcl) { return acc.concat(enListe(dcl.depot)); }, []) : [];
}

/* ------------------------------------------------------------------ client */
// Identifiants refusés par net-entreprises : jamais réessayés (le compte se bloque après plusieurs échecs), y compris
// par un autre processus (o.refus garde l'empreinte sur le disque). Saisir d'autres identifiants lève le blocage.
const REFUSES = new Set();
/**
 * o.identifiants : async () → { siret, nom, prenom, motdepasse } | null
 * o.demo : simulateur (objet avec requete(methode, url, entetes, corps)) ou null
 * o.ua : User-Agent
 */
function client(o) {
  const urls = o.demo ? URLS_DEMO : URLS;
  const requete = o.demo ? o.demo.requete : requeteReseau(o.ua || 'Client-DSN (DSNap)');
  let jeton = null, expiration = 0, siretJeton = null, enCours = null;
  const refus = o.refus || { contient: function (e) { return REFUSES.has(e); }, ajouter: function (e) { REFUSES.add(e); } };
  function estRefuse(e) { return REFUSES.has(e) || refus.contient(e); }
  function noterRefus(e) { REFUSES.add(e); try { refus.ajouter(e); } catch (x) { /* mémoire seulement */ } }

  async function ident() {
    const id = await o.identifiants();
    const manquants = [['siret', 'SIRET'], ['nom', 'nom'], ['prenom', 'prénom'], ['motdepasse', 'mot de passe']].filter(function (k) { return !id || !id[k[0]]; }).map(function (k) { return k[1]; });
    if (manquants.length) throw fail('Identifiants net-entreprises absents ou incomplets (' + manquants.join(', ') + ') : ouvrez la configuration de DSNap (outil configurer_dsnap) pour les enregistrer sur cet ordinateur.', { configuration: true });
    return id;
  }
  // une seule authentification à la fois : des appels d'outils parallèles ne multiplient pas les tentatives
  function authentifier(forcer) {
    if (enCours) return enCours;
    enCours = authentifierUneFois(forcer).finally(function () { enCours = null; });
    return enCours;
  }
  async function authentifierUneFois(forcer) {
    const id = await ident();
    const empreinte = crypto.createHash('sha256').update([id.siret, id.nom, id.prenom, id.motdepasse].join('\u0000')).digest('hex');
    if (estRefuse(empreinte)) throw fail('net-entreprises a déjà refusé ces identifiants : je ne réessaie pas (plusieurs échecs bloquent le compte). Corrigez-les dans la configuration de DSNap.', { identifiants: true });
    if (!forcer && jeton && siretJeton === empreinte && Date.now() < expiration - 60000) return jeton;
    const corps = '<identifiants><siret>' + xmlEsc(String(id.siret).trim()) + '</siret><nom>' + xmlEsc(String(id.nom).trim()) + '</nom><prenom>' + xmlEsc(String(id.prenom).trim()) +
      '</prenom><motdepasse>' + xmlEsc(id.motdepasse) + '</motdepasse><service>' + xmlEsc(SERVICE) + '</service></identifiants>';
    const res = await requete('POST', urls.auth, { 'Content-Type': 'application/xml' }, Buffer.from(corps, 'utf8'));
    if (res.status === 200) {
      jeton = res.body.toString('utf8').trim(); siretJeton = empreinte;
      const exp = Date.parse(res.headers.expires || '');
      expiration = isNaN(exp) ? Date.now() + 30 * 60000 : exp;
      return jeton;
    }
    jeton = null;
    if (res.status === 401 || (res.status >= 400 && res.status < 500 && res.status !== 403 && res.status !== 429)) { noterRefus(empreinte); throw fail('net-entreprises a refusé les identifiants (SIRET, nom, prénom ou mot de passe). Je ne réessaie pas : plusieurs échecs peuvent bloquer le compte. Corrigez-les dans la configuration de DSNap (outil configurer_dsnap).', { identifiants: true }); }
    if (res.status === 403) { noterRefus(empreinte); throw fail('Compte bloqué ou non inscrit au service DSN (HTTP 403). Débloquez-le ou inscrivez-vous au service « DSN - Déclaration Sociale Nominative » sur net-entreprises.fr. DSNap ne réessaiera pas avec ces identifiants.', { identifiants: true }); }
    if (res.status >= 500 || res.status === 429) throw fail('net-entreprises est indisponible pour le moment (HTTP ' + res.status + ', souvent une maintenance) : réessayez plus tard.', { reseau: true });
    throw fail('Authentification impossible (HTTP ' + res.status + ') : ' + extrait(res.body, 300));
  }
  async function appel(methode, url, entetes, corps) {
    let t = await authentifier(false);
    let res = await requete(methode, url, Object.assign({ Authorization: 'DSNLogin jeton=' + t }, entetes || {}), corps);
    if (res.status === 401) { t = await authentifier(true); res = await requete(methode, url, Object.assign({ Authorization: 'DSNLogin jeton=' + t }, entetes || {}), corps); }
    return res;
  }
  async function retoursFlux(idflux) {
    const res = await appel('GET', urls.retoursFlux + encodeURIComponent(idflux));
    if (res.status !== 200) throw fail('Consultation des retours impossible (HTTP ' + res.status + ') : ' + extrait(res.body, 300));
    const flux = analyserRetours(decode(res.body));
    const tous = [].concat.apply([], flux.map(function (f) { return f.retours; }));
    return { flux: flux, tous: tous, bilan: tous.filter(function (r) { return r.nature === '11'; }).pop() || null };
  }
  async function depotsEntre(debut, fin) {
    const res = await appel('GET', urls.depots + dateNE(debut) + '/' + dateNE(fin));
    if (res.status !== 200) throw fail('Consultation des dépôts impossible (HTTP ' + res.status + ') : ' + extrait(res.body, 300));
    return depotsDeReponse(decode(res.body));
  }
  async function depotsJour(aaaammjj) {
    const res = await appel('GET', urls.depots + aaaammjj + '000000/' + aaaammjj + '235959');
    if (res.status !== 200) throw fail('Consultation des dépôts impossible (HTTP ' + res.status + ') : ' + extrait(res.body, 300));
    return depotsDeReponse(decode(res.body));
  }
  function urlTelechargementAutorisee(url) {
    return urls.telechargement.some(function (p) { return url.indexOf(p) === 0; }) || (ALLOW_HTTP && /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url));
  }
  async function telecharger(url) {
    if (!urlTelechargementAutorisee(url)) throw fail('Adresse de téléchargement non reconnue : utilisez une URL fournie par lister_retours.');
    const res = await appel('GET', url);
    if (res.status !== 200) throw fail('Téléchargement impossible (HTTP ' + res.status + ') : ' + extrait(res.body, 300));
    return res;
  }
  /*
   * Dépôt : l'authentification a lieu avant l'envoi ; une erreur pendant l'envoi lui-même est marquée pendantEnvoi
   * (le fichier a pu être reçu : l'appelant ne doit pas renvoyer). Un 401 sur le dépôt (jeton expiré) n'a rien
   * enregistré : on se réauthentifie et on renvoie une fois.
   */
  async function deposer(buf) {
    const corps = zlib.gzipSync(buf);
    const envoyer = async function (t) {
      try { return await requete('POST', urls.depot, { Authorization: 'DSNLogin jeton=' + t, 'Content-Type': 'text/plain', 'Content-Encoding': 'gzip' }, corps); }
      catch (e) { e.pendantEnvoi = true; throw e; }
    };
    let res = await envoyer(await authentifier(false));
    if (res.status === 401) res = await envoyer(await authentifier(true));
    return res;
  }
  async function siretCompte() { try { const id = await o.identifiants(); return id && id.siret ? String(id.siret).trim() : null; } catch (e) { return null; } }
  function etatJeton() { return { connecte: !!jeton && Date.now() < expiration, expiration: expiration ? new Date(expiration).toISOString() : null }; }
  function oublier() { jeton = null; expiration = 0; }

  return { authentifier, appel, retoursFlux, depotsEntre, depotsJour, telecharger, deposer, siretCompte, etatJeton, oublier, urls: urls, demo: !!o.demo };
}

module.exports = { client, verifierFlux, analyserRetours, chercher, dateNE, decode, extrait, NATURES, URLS, fail };
