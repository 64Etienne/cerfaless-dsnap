// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Abonnement DSNap : vérification auprès du service de licences de DSNap.
 *
 *  - Toujours gratuit : DSN néant (préparation et dépôt réel), contrôle de fichiers, dépôts de test, suivi des
 *    retours, tables de référence, simulation d'une paie (aperçu).
 *  - Essai de 7 jours, sans carte : un aperçu de la paie (brut, net, coût total), 5 fois au plus.
 *  - Abonnement (6,90 €/mois ou 70 €/an), sans compte à créer : paie avec salaire (DSN, bulletin, note de frais), dépôt
 *    réel d'une DSN avec salaire, 10 calculs par mois de paie.
 *
 * Données envoyées : une empreinte du SIREN (SHA-256, le SIREN lui-même ne part pas), l'identifiant d'installation
 * et la version de DSNap. La réponse est signée (Ed25519) et gardée en cache : en cas de coupure du service, la
 * dernière réponse valide continue de s'appliquer jusqu'à sa date de fin.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const chemins = require('./chemins.js');

const CLE_OFFICIELLE = '-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEADyi2ScbKrJ6fWDUhg6d2YYI49UV9tG2E36pfkUIwmY4=\n-----END PUBLIC KEY-----\n';
/* Banc d'essai : net-entreprises remplacé par un service local (tests, démonstration hors ligne). Seul cas où une autre
   clé de licence (DSNAP_CLE_LICENCE) est acceptée : un faux service de licences ne débloque alors que des dépôts vers
   ce faux net-entreprises, jamais vers le vrai. DSNAP_API reste réglable : sans la clé privée de cerfaless.fr, une autre
   adresse ne peut rien signer. */
function bancEssai() {
  const local = /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:\d+)?\//;
  return local.test(process.env.NE_URL_AUTH || '') && local.test(process.env.NE_URL_DEPOT || '');
}
const CLE_PUBLIQUE = process.env.DSNAP_CLE_LICENCE && bancEssai() ? process.env.DSNAP_CLE_LICENCE : CLE_OFFICIELLE;
const APIS = (process.env.DSNAP_API || 'https://cerfaless.fr/api/dsnap').split(',').map(function (s) { return s.trim().replace(/\/+$/, ''); }).filter(Boolean);
const SITE = process.env.DSNAP_SITE || 'https://cerfaless.fr/dsnap';
const DELAI = 8000;
const HEURE = 3600000;
const STATUTS_OK = ['actif', 'essai', 'lancement', 'demo'];

function empreinteSiren(siren) { return crypto.createHash('sha256').update('dsnap|' + String(siren).replace(/\s/g, '')).digest('hex'); }
function b64u(s) { return Buffer.from(s, 'base64url'); }

function verifierJeton(jeton, hash) {
  if (typeof jeton !== 'string' || jeton.indexOf('.') < 0) return null;
  const [p, s] = jeton.split('.');
  let ok = false;
  try { ok = crypto.verify(null, Buffer.from(p, 'utf8'), crypto.createPublicKey(CLE_PUBLIQUE), b64u(s)); } catch (e) { ok = false; }
  if (!ok) return null;
  let o; try { o = JSON.parse(b64u(p).toString('utf8')); } catch (e) { return null; }
  if (!o || o.v !== 1 || o.s !== hash || !o.st || !o.fin) return null;
  return o;
}

function cheminCache() { return path.join(chemins.dossierDonnees(), 'licence.json'); }
function lireCache() { try { return JSON.parse(fs.readFileSync(cheminCache(), 'utf8')) || {}; } catch (e) { return {}; } }
function ecrireCache(c) { try { chemins.donnees(); fs.writeFileSync(cheminCache(), JSON.stringify(c, null, 2)); } catch (e) { /* cache facultatif */ } }

let baseJoignable = APIS[0];
function liens(hash, serveur) {
  const api = baseJoignable, site = api.replace(/\/api\/dsnap$/, '/dsnap').replace(/\/api$/, '');
  const l = {
    mensuel: api + '/abonnement?s=' + hash + '&plan=mensuel',
    annuel: api + '/abonnement?s=' + hash + '&plan=annuel',
    compte: site + '/compte',
    tarifs: site + '/tarifs'
  };
  // liens fournis par le service (adresse canonique du site), s'ils sont bien en https
  if (serveur && typeof serveur === 'object') Object.keys(l).forEach(function (k) { if (typeof serveur[k] === 'string' && /^https:\/\//.test(serveur[k])) l[k] = serveur[k]; });
  return l;
}

async function appelApi(corps) {
  let derniere = null;
  for (const base of APIS) {
    try {
      const r = await fetch(base + '/licence', { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'DSNap/' + (corps.version || '?') }, body: JSON.stringify(corps), signal: AbortSignal.timeout(DELAI) });
      if (r.status >= 500) { derniere = new Error('service de licences indisponible (HTTP ' + r.status + ')'); continue; }
      const j = await r.json().catch(function () { return null; });
      if (!r.ok || !j) { derniere = new Error('réponse inattendue du service de licences (HTTP ' + r.status + ')'); continue; }
      baseJoignable = base;
      return j;
    } catch (e) { derniere = e; }
  }
  const e = new Error('service de licences injoignable' + (derniere ? ' (' + (derniere.cause && derniere.cause.code || derniere.message) + ')' : ''));
  e.horsLigne = true;
  throw e;
}

/**
 * Statut de l'abonnement pour un SIREN.
 *  o.demarrer : true pour commencer l'essai s'il n'a jamais commencé (seulement lors d'une action payante)
 *  o.demo : mode démonstration (toujours autorisé, rien n'est envoyé)
 */
async function statut(siren, o) {
  o = o || {};
  if (o.demo) return { statut: 'demo', autorise: true, message: 'Mode démonstration : toutes les fonctions sont disponibles, rien n\'est envoyé à net-entreprises.' };
  if (!/^\d{9}$/.test(String(siren || ''))) return { statut: 'inconnu', autorise: false, message: 'SIREN de la société inconnu : terminez la configuration de DSNap.' };
  const hash = empreinteSiren(siren);
  const reg = chemins.lireReglages();
  const cache = lireCache();
  const maintenant = Date.now();
  try {
    const j = await appelApi({ s: hash, installation: reg.installation, version: o.version || '', demarrer: !!o.demarrer });
    let info = null;
    if (j.jeton) info = verifierJeton(j.jeton, hash);
    if (j.jeton && !info) throw Object.assign(new Error('réponse du service de licences non authentifiée'), { horsLigne: true });
    if (info) { cache[hash] = { jeton: j.jeton, verifieLe: new Date(maintenant).toISOString(), vu: Math.max(maintenant, (cache[hash] && cache[hash].vu) || 0) }; ecrireCache(cache); }
    // seule une réponse signée peut autoriser une action payante ; une réponse non signée ne vaut qu'information
    const st = info ? info.st : (j.statut === 'nouveau' ? 'nouveau' : 'inconnu');
    const fin = info ? info.fin : null;
    const valide = !!info && STATUTS_OK.indexOf(st) >= 0 && st !== 'demo' && Date.parse(fin) > maintenant;
    return {
      statut: st, autorise: valide, fin: fin, plan: info ? info.plan || null : null, finEssai: info ? info.essaiFin || null : (j.finEssai || null),
      liens: liens(hash, j.liens), message: j.message || message(st, fin, info ? info.essaiFin : null),
      derniereVersion: typeof j.derniereVersion === 'string' && /^\d+\.\d+\.\d+$/.test(j.derniereVersion) ? j.derniereVersion : null
    };
  } catch (e) {
    if (!e.horsLigne) throw e;
    const c = cache[hash];
    const info = c ? verifierJeton(c.jeton, hash) : null;
    // horloge du poste reculée (avant l'émission du jeton, ou avant son dernier usage) : le jeton en cache ne vaut plus,
    // sinon il resterait valable sans fin. Tolérance d'une heure (changement d'heure, petite dérive).
    const recul = info && (Date.parse(info.emis || c.verifieLe) - maintenant > HEURE || ((c.vu || 0) - maintenant > HEURE));
    if (recul) return { statut: 'injoignable', autorise: false, horsLigne: true, liens: liens(hash), message: 'Impossible de vérifier l\'abonnement : le service de licences est injoignable et l\'horloge de cet ordinateur est en retard sur la dernière vérification. Remettez l\'ordinateur à l\'heure, puis réessayez. Les DSN néant, les contrôles et les dépôts de test restent disponibles.' };
    if (info && STATUTS_OK.indexOf(info.st) >= 0 && Date.parse(info.fin) > maintenant) {
      c.vu = Math.max(maintenant, c.vu || 0); ecrireCache(cache);
      return { statut: info.st, autorise: true, horsLigne: true, fin: info.fin, plan: info.plan || null, finEssai: info.essaiFin || null, liens: liens(hash), message: message(info.st, info.fin, info.essaiFin) + ' (vérifié le ' + new Date(c.verifieLe).toLocaleDateString('fr-FR') + ', service de licences injoignable aujourd\'hui)' };
    }
    return { statut: 'injoignable', autorise: false, horsLigne: true, liens: liens(hash), message: 'Impossible de vérifier l\'abonnement : ' + e.message + '. Réessayez dans quelques minutes. Les DSN néant, les contrôles et les dépôts de test restent disponibles ; le fichier DSN peut aussi être déposé à la main sur net-entreprises.fr.' };
  }
}

function dateFr(iso) { return iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' }) : ''; }
function message(st, fin, essaiFin) {
  if (st === 'actif') return 'Abonnement DSNap actif' + (fin ? ' (période en cours jusqu\'au ' + dateFr(fin) + ')' : '') + '.';
  if (st === 'essai') return 'Essai gratuit de DSNap en cours, jusqu\'au ' + dateFr(essaiFin || fin) + '.';
  if (st === 'lancement') return 'Offre de lancement : toutes les fonctions de DSNap sont gratuites pour le moment.';
  if (st === 'expire') return 'Essai terminé : la paie avec salaire et son dépôt réel demandent un abonnement DSNap (6,90 €/mois ou 70 €/an, sans engagement). Les DSN néant restent gratuites.';
  if (st === 'nouveau') return 'Essai gratuit de 7 jours disponible : il commence à la première paie avec salaire. Les DSN néant sont gratuites, sans limite.';
  return '';
}

/** Autorisation d'une action payante : renvoie le statut ; autorise = false si l'abonnement manque. */
async function autoriser(siren, o) { return statut(siren, Object.assign({}, o, { demarrer: true })); }

/** Dernier jeton signé pour ce SIREN : sert de preuve au serveur de calcul si Stripe est en panne. */
function jetonEnCache(siren) { const c = lireCache()[empreinteSiren(siren)]; return c ? c.jeton : null; }

module.exports = { statut, autoriser, empreinteSiren, verifierJeton, jetonEnCache, liens, APIS, SITE };
