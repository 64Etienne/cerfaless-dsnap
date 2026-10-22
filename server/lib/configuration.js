// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Page de configuration locale de DSNap : http://127.0.0.1:<port>/c/<jeton>/ (lien à usage unique) puis /app/
 *
 * Ouverte dans le navigateur de l'utilisateur par l'outil configurer_dsnap. C'est là, et seulement là, que
 * l'utilisateur saisit ses identifiants net-entreprises (enregistrés chiffrés dans le trousseau du système) et les
 * données personnelles nécessaires à la DSN (NIR, état civil), écrites dans son dossier de paie. Rien de tout cela
 * ne transite par Claude.
 *
 * Sécurité : écoute sur 127.0.0.1 uniquement ; lien d'entrée à usage unique, échangé à la première ouverture contre
 * un cookie de session HttpOnly SameSite=Strict (le lien vu par Claude ne sert plus une fois ouvert dans le
 * navigateur) ; contrôle de l'en-tête Host (contre le DNS rebinding) ; en-tête X-DSNap obligatoire sur les requêtes
 * d'écriture (contre les requêtes d'autres sites) ; arrêt automatique après 30 minutes d'inactivité.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { spawn } = require('child_process');
const chemins = require('./chemins.js');
const secrets = require('./secrets.js');
const dossierMod = require('./dossier.js');
const paie = require('./paie.js');
const tables = require('./tables.js');
const demo = require('./demo.js');
const E = require('./engine.js');

const INACTIVITE = 30 * 60 * 1000;
const TABLES_AUTORISEES = ['IBC', 'PCSESE', 'RAT', 'NAF', 'PAYS', 'IDCC'];
let serveur = null, jeton = null, port = null, minuterie = null, session = null;
let contexte = null; // { testerConnexion: async () => {...}, version, apresConfiguration }
let brouillonNir = null; // NIR importé d'une DSN, en attente d'enregistrement (jamais renvoyé à la page)

function nirValide(n) {
  if (!/^[12]\d{2}(0[1-9]|1[0-2]|[2-9]\d)(\d{2}|2A|2B)\d{6}$/i.test(n)) return false;
  return true;
}

function dmyIso(s) { const m = /^(\d{2})(\d{2})(\d{4})$/.exec(s || ''); return m ? m[3] + '-' + m[2] + '-' + m[1] : ''; }
/** Champs plats du formulaire (le NIR n'y figure jamais : seulement l'indication qu'il est enregistré). */
function versFormulaire(st, cfg) {
  const h = st.hdr || {}, c = st.contrat || {}, i = st.indiv || {}, ct = st.contact || {}, bk = st.bank || {};
  const ch = cfg.choix || {}, fd = cfg.facturesParDefaut || {}, au = cfg.automatisation || {}, pas = cfg.pas || {};
  const v = function (x, d) { return x === undefined || x === null ? (d === undefined ? '' : d) : x; };
  return {
    raisonSociale: v(cfg.client || h['S10.G00.01.003']), siret: v(h['S21.G00.06.001'] || h['S10.G00.01.001']) + v(h['S21.G00.11.001'] || h['S10.G00.01.002']),
    ape: v(h['S21.G00.11.002'] || h['S21.G00.06.003']), adresse: v(h['S21.G00.11.003'] || h['S21.G00.06.004']), codePostal: v(h['S21.G00.11.004'] || h['S21.G00.06.005']),
    ville: v(h['S21.G00.11.005'] || h['S21.G00.06.006']), idcc: v(h['S21.G00.11.022'], '9999'), urssafSiret: v(cfg.urssafSiret),
    civiliteContact: v(h['S10.G00.02.001'], '01'), contactNom: v(ct.nom), contactMel: v(ct.mel), contactTel: v(ct.tel), iban: v(bk.iban), bic: v(bk.bic),
    nir: '', nirEnregistre: !!i['S21.G00.30.001'],
    nomNaissance: v(i['S21.G00.30.002']), nomUsage: v(i['S21.G00.30.003']), prenoms: v(i['S21.G00.30.004']), dateNaissance: dmyIso(i['S21.G00.30.006']),
    lieuNaissance: v(i['S21.G00.30.007']), adresseIndividu: v(i['S21.G00.30.008']), cpIndividu: v(i['S21.G00.30.009']), villeIndividu: v(i['S21.G00.30.010']),
    codificationUE: v(i['S21.G00.30.013'], '01'), paysNaissance: v(i['S21.G00.30.015'], 'FR'),
    debutMandat: dmyIso(c['S21.G00.40.001']), statutConventionnel: v(c['S21.G00.40.002'], '03'), statutCategoriel: v(c['S21.G00.40.003'], '01'), pcs: v(c['S21.G00.40.004']),
    libelleEmploi: v(c['S21.G00.40.006'], 'President'), numeroContrat: v(c['S21.G00.40.009']), codeRisque: v(c['S21.G00.40.040'], '999ZZ'),
    tauxAT: v(ch.tauxAT, 0), acre: ch.acreMode && ch.acreMode !== 'aucune' ? 'oui' : 'non', acreFin: v(ch.acreFin), acreRegime: v(ch.acreRegime),
    budgetMensuel: v(ch.budgetMensuel, 0), surfTotale: v(ch.surfTotale, 0), surfBureau: v(ch.surfBureau, 0), usagePro: v(ch.usagePro, 0), usageBox: v(ch.usageBox, 0), usageMobile: v(ch.usageMobile, 0),
    trFaciale: v(ch.trFaciale, 0), trPartPat: v(ch.trPartPat, 0), trJoursOuvres: ch.trJoursOuvres !== false,
    loyer: v(fd.loyer, 0), elec: v(fd.elec, 0), box: v(fd.box, 0), mobile: v(fd.mobile, 0), assurance: v(fd.assurance, 0),
    pasMode: pas.mode === 'dgfip' ? 'dgfip' : 'bareme', pasTaux: v(pas.taux), pasId: v(pas.id),
    brutMode: (au.brut && au.brut.mode) || 'demande', brutFixe: v(au.brut && au.brut.valeur), depotReel: au.depotReel || 'feu_vert',
    dsnReference: v(cfg.dsnReference)
  };
}
function nirDeReference(d, cfg) {
  if (!cfg || !cfg.dsnReference) return null;
  try { const x = paie.extraireReference(fs.readFileSync(d.dans(cfg.dsnReference))); return x.indiv && x.indiv['S21.G00.30.001'] || null; } catch (e) { return null; }
}

function lireCorps(req) {
  return new Promise(function (resolve, reject) {
    const parts = []; let taille = 0;
    req.on('data', function (d) { taille += d.length; if (taille > 6 * 1024 * 1024) { reject(new Error('requête trop volumineuse')); req.destroy(); return; } parts.push(d); });
    req.on('end', function () { try { resolve(parts.length ? JSON.parse(Buffer.concat(parts).toString('utf8')) : {}); } catch (e) { reject(new Error('JSON invalide')); } });
    req.on('error', reject);
  });
}
function envoyer(res, code, obj, type) {
  const corps = Buffer.from(type ? obj : JSON.stringify(obj), 'utf8');
  res.writeHead(code, { 'Content-Type': type || 'application/json; charset=utf-8', 'Content-Length': corps.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'X-Frame-Options': 'DENY', 'Content-Security-Policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'" });
  res.end(corps);
}

function dossierCourant() { const d = chemins.dossierPaie(); return d && fs.existsSync(d) ? dossierMod.ouvrir(d) : null; }

async function etat() {
  const reg = chemins.lireReglages();
  const d = reg.demo ? path.join(chemins.dossierDonnees(), 'demo', 'dossier') : chemins.dossierPaie();
  let cfg = null, formulaire = null, fichierConfig = null;
  try {
    const o = d && fs.existsSync(d) ? dossierMod.ouvrir(d) : null;
    cfg = o ? o.lireConfig() : null;
    if (cfg) { fichierConfig = path.basename(o.cheminConfig()); formulaire = versFormulaire(paie.etatDepuisConfig(o, cfg, '').st, cfg); }
  } catch (e) { cfg = null; }
  const ident = await secrets.lire().catch(function () { return null; });
  return {
    version: contexte && contexte.version, demo: !!reg.demo, plateforme: process.platform,
    dossier: d, dossierExiste: !!(d && fs.existsSync(d)), dossierParDefaut: chemins.dossierPaieParDefaut(),
    dossierImpose: !!(process.env.DSNAP_DOSSIER || (process.env.NE_DOSSIER && !/^\$\{/.test(process.env.NE_DOSSIER))),
    identifiants: ident ? { enregistres: true, siret: ident.siret, nom: ident.nom, prenom: ident.prenom, stockage: (reg.identifiants && reg.identifiants.stockage) || '' } : { enregistres: false },
    identifiantsExtension: !!(contexte && contexte.identifiantsExtension && contexte.identifiantsExtension()),
    configure: !!cfg, fichierConfig: fichierConfig, formulaire: formulaire,
    nirImporte: !!brouillonNir,
    tables: tables.resume()
  };
}

function nettoyer(s, max) { return String(s === undefined || s === null ? '' : s).trim().slice(0, max || 200); }

/** Construit la configuration à partir du formulaire, en gardant le NIR déjà enregistré s'il n'est pas ressaisi. */
function construireConfig(f, ancienne, nirRef) {
  const a = ancienne || {};
  const cfg = Object.assign({}, a);
  cfg.version = 1;
  cfg.profil = 'president-sasu-assimile-salarie';
  const siret = nettoyer(f.siret, 20).replace(/\s/g, '');
  if (!/^\d{14}$/.test(siret)) throw new Error('SIRET de la société : 14 chiffres.');
  const siren = siret.slice(0, 9), nic = siret.slice(9);
  const ape = nettoyer(f.ape, 5).toUpperCase().replace(/[.\s]/g, '');
  const voie = nettoyer(f.adresse, 50), cp = nettoyer(f.codePostal, 5), ville = nettoyer(f.ville, 50);
  if (!/^\d{5}$/.test(cp)) throw new Error('Code postal de la société : 5 chiffres.');
  cfg.client = nettoyer(f.raisonSociale, 80);
  cfg.entete = Object.assign({}, a.entete || {}, {
    'S10.G00.01.001': siren, 'S10.G00.01.002': nic, 'S10.G00.01.003': cfg.client, 'S10.G00.01.004': voie, 'S10.G00.01.005': cp, 'S10.G00.01.006': ville,
    'S10.G00.02.001': f.civiliteContact === '02' ? '02' : '01',
    'S21.G00.06.001': siren, 'S21.G00.06.002': nic, 'S21.G00.06.003': ape, 'S21.G00.06.004': voie, 'S21.G00.06.005': cp, 'S21.G00.06.006': ville,
    'S21.G00.11.001': nic, 'S21.G00.11.002': ape, 'S21.G00.11.003': voie, 'S21.G00.11.004': cp, 'S21.G00.11.005': ville,
    'S21.G00.11.022': nettoyer(f.idcc, 4) || '9999'
  });
  if (!cfg.entete['S20.G00.07.004']) cfg.entete['S20.G00.07.004'] = '01';
  // l'en-tête ne doit pas garder un code pays d'une ancienne adresse à l'étranger
  ['S21.G00.06.010', 'S21.G00.06.011'].forEach(function (k) { delete cfg.entete[k]; });
  cfg.urssafSiret = nettoyer(f.urssafSiret, 14);
  cfg.contact = { nom: nettoyer(f.contactNom, 80), mel: nettoyer(f.contactMel, 100), tel: nettoyer(f.contactTel, 20).replace(/[^\d+]/g, '') };
  cfg.banque = { iban: nettoyer(f.iban, 40).replace(/\s/g, '').toUpperCase(), bic: nettoyer(f.bic, 11).replace(/\s/g, '').toUpperCase() };
  // président : individu
  let nir = nettoyer(f.nir, 21).replace(/\s/g, '').toUpperCase();
  const ancienNir = a.individu && a.individu['S21.G00.30.001'];
  if (nir) {
    if (nir.length === 15) {
      const cle = E.nirKey(nir.slice(0, 13));
      if (!cle || cle !== nir.slice(13)) throw new Error('Numéro de sécurité sociale : la clé (2 derniers chiffres) ne correspond pas. Vérifiez le numéro sur votre carte Vitale.');
      nir = nir.slice(0, 13);
    }
    if (nir.length !== 13 || !nirValide(nir)) throw new Error('Numéro de sécurité sociale : 15 caractères attendus (13 + la clé), tel qu\'il figure sur la carte Vitale.');
  } else nir = brouillonNir || ancienNir || nirRef || '';
  if (!nir) throw new Error('Numéro de sécurité sociale du président manquant.');
  const naissance = nettoyer(f.dateNaissance, 10);
  const dn = /^(\d{4})-(\d{2})-(\d{2})$/.exec(naissance);
  if (!dn) throw new Error('Date de naissance du président manquante.');
  const depNaiss = nir.slice(5, 7).toUpperCase();
  const neEtranger = depNaiss === '99';
  cfg.individu = Object.assign({}, a.individu || {}, {
    'S21.G00.30.001': nir, 'S21.G00.30.002': nettoyer(f.nomNaissance, 80).toUpperCase(), 'S21.G00.30.004': nettoyer(f.prenoms, 80).toUpperCase(),
    'S21.G00.30.005': nir[0] === '1' ? '01' : '02', 'S21.G00.30.006': dn[3] + dn[2] + dn[1],
    'S21.G00.30.007': neEtranger ? nettoyer(f.lieuNaissance, 30).toUpperCase() : nettoyer(f.lieuNaissance, 30).toUpperCase(),
    'S21.G00.30.008': nettoyer(f.adresseIndividu, 50), 'S21.G00.30.009': nettoyer(f.cpIndividu, 5), 'S21.G00.30.010': nettoyer(f.villeIndividu, 50),
    'S21.G00.30.013': ['01', '02', '03', '04'].indexOf(f.codificationUE) >= 0 ? f.codificationUE : '01',
    'S21.G00.30.014': neEtranger ? '99' : depNaiss, 'S21.G00.30.015': nettoyer(f.paysNaissance, 2).toUpperCase() || 'FR'
  });
  if (nettoyer(f.nomUsage, 80)) cfg.individu['S21.G00.30.003'] = nettoyer(f.nomUsage, 80).toUpperCase(); else delete cfg.individu['S21.G00.30.003'];
  const debut = /^(\d{4})-(\d{2})-(\d{2})$/.exec(nettoyer(f.debutMandat, 10));
  if (!debut) throw new Error('Date de début du mandat (ou de la première rémunération) manquante.');
  const pcs = nettoyer(f.pcs, 4);
  if (!pcs) throw new Error('Profession (code PCS-ESE) manquante.');
  cfg.contrat = Object.assign({}, a.contrat || {}, {
    'S21.G00.40.001': debut[3] + debut[2] + debut[1], 'S21.G00.40.002': ['03', '04'].indexOf(f.statutConventionnel) >= 0 ? f.statutConventionnel : '03',
    'S21.G00.40.003': f.statutCategoriel === '04' ? '04' : '01', 'S21.G00.40.004': pcs, 'S21.G00.40.006': nettoyer(f.libelleEmploi, 120) || 'President',
    'S21.G00.40.007': '80', 'S21.G00.40.009': (nettoyer(f.numeroContrat, 20) || ('PRES' + debut[1] + debut[2] + debut[3])).toUpperCase().replace(/[^0-9A-Z]/g, ''),
    'S21.G00.40.019': siret, 'S21.G00.40.040': nettoyer(f.codeRisque, 6).toUpperCase() || '999ZZ'
  });
  // choix de paie
  const num = function (v) { const n = Number(String(v === undefined || v === null ? '' : v).replace(',', '.')); return isFinite(n) && n >= 0 ? n : 0; };
  cfg.choix = Object.assign({}, a.choix || {}, {
    tauxAT: num(f.tauxAT), acreMode: f.acre === 'oui' ? 'auto' : 'aucune', acreFin: f.acre === 'oui' ? nettoyer(f.acreFin, 10) : '', acreRegime: ['ancien', '2026'].indexOf(f.acreRegime) >= 0 ? f.acreRegime : '',
    budgetMensuel: num(f.budgetMensuel), surfTotale: num(f.surfTotale), surfBureau: num(f.surfBureau), usagePro: num(f.usagePro),
    usageBox: num(f.usageBox), usageMobile: num(f.usageMobile), trFaciale: num(f.trFaciale), trPartPat: num(f.trPartPat), trJoursOuvres: f.trJoursOuvres !== false
  });
  if (cfg.choix.acreMode === 'auto' && !/^\d{4}-\d{2}-\d{2}$/.test(cfg.choix.acreFin)) throw new Error('ACRE : indiquez la date de fin de l\'exonération.');
  cfg.facturesParDefaut = { loyer: num(f.loyer), elec: num(f.elec), box: num(f.box), mobile: num(f.mobile), assurance: num(f.assurance) };
  cfg.pas = f.pasMode === 'dgfip' ? { mode: 'dgfip', taux: num(f.pasTaux), id: nettoyer(f.pasId, 18).replace(/\D/g, '') } : { mode: 'bareme' };
  cfg.automatisation = {
    brut: f.brutMode === 'fixe' ? { mode: 'fixe', valeur: num(f.brutFixe) } : (f.brutMode === 'budget' ? { mode: 'budget' } : { mode: 'demande' }),
    depotReel: f.depotReel === 'automatique_si_bilan_ok' ? 'automatique_si_bilan_ok' : 'feu_vert',
    declenchement: 'demande'
  };
  delete cfg.logiciel;
  delete cfg.demo;
  return cfg;
}

async function traiter(req, res) {
  const u = new URL(req.url, 'http://127.0.0.1');
  const hote = String(req.headers.host || '');
  if (hote !== '127.0.0.1:' + port && hote !== 'localhost:' + port) return envoyer(res, 403, { erreur: 'hôte refusé' });
  // lien d'entrée : échangé une seule fois contre un cookie de session
  const entree = /^\/c\/([\w-]+)\/?$/.exec(u.pathname);
  if (entree) {
    if (!jeton || entree[1] !== jeton) return envoyer(res, 410, '<!doctype html><meta charset="utf-8"><title>Lien expiré</title><body style="font:17px system-ui;margin:40px;max-width:40em"><h1>Ce lien a déjà servi</h1><p>Pour votre sécurité, le lien de configuration ne s\'ouvre qu\'une fois. Si la page est déjà ouverte dans un autre onglet, utilisez-le ; sinon, demandez à Claude de rouvrir la configuration de DSNap.</p></body>', 'text/html; charset=utf-8');
    jeton = null;
    session = crypto.randomBytes(24).toString('base64url');
    res.writeHead(302, { Location: '/app/', 'Set-Cookie': 'dsnap_' + port + '=' + session + '; HttpOnly; SameSite=Strict; Path=/', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    rearmer();
    return res.end();
  }
  if (u.pathname.indexOf('/app/') !== 0) return envoyer(res, 404, { erreur: 'introuvable' });
  const cookie = new RegExp('(?:^|;\\s*)dsnap_' + port + '=([\\w-]+)').exec(String(req.headers.cookie || ''));
  if (!session || !cookie || cookie[1] !== session) return envoyer(res, 401, '<!doctype html><meta charset="utf-8"><title>Session expirée</title><body style="font:17px system-ui;margin:40px;max-width:40em"><h1>Session expirée</h1><p>Demandez à Claude de rouvrir la configuration de DSNap.</p></body>', 'text/html; charset=utf-8');
  rearmer();
  const route = u.pathname.slice('/app/'.length);
  if (req.method === 'GET' && (route === '' || route === 'index.html')) {
    return envoyer(res, 200, fs.readFileSync(path.join(__dirname, 'configuration.html'), 'utf8'), 'text/html; charset=utf-8');
  }
  if (req.method === 'POST' && req.headers['x-dsnap'] !== '1') return envoyer(res, 403, { erreur: 'requête refusée' });
  try {
    if (req.method === 'GET' && route === 'api/etat') return envoyer(res, 200, await etat());
    if (req.method === 'GET' && route.indexOf('api/table/') === 0) {
      const abr = route.slice('api/table/'.length).toUpperCase();
      if (TABLES_AUTORISEES.indexOf(abr) < 0) return envoyer(res, 404, { erreur: 'table inconnue' });
      return envoyer(res, 200, { table: abr, codes: tables.codes(abr) });
    }
    if (req.method !== 'POST') return envoyer(res, 405, { erreur: 'méthode non prise en charge' });
    const corps = await lireCorps(req);
    if (route === 'api/dossier') {
      let chemin = nettoyer(corps.chemin, 1000);
      if (!chemin) chemin = chemins.dossierPaieParDefaut();
      if (/^~(\/|\\|$)/.test(chemin)) chemin = path.join(require('os').homedir(), chemin.slice(1));
      if (!path.isAbsolute(chemin)) return envoyer(res, 400, { erreur: 'Indiquez un chemin complet (par exemple ' + chemins.dossierPaieParDefaut() + ').' });
      fs.mkdirSync(chemin, { recursive: true });
      chemins.modifierReglages({ dossier: path.resolve(chemin), demo: false });
      return envoyer(res, 200, await etat());
    }
    if (route === 'api/identifiants') {
      const ancien = await secrets.lire().catch(function () { return null; });
      const id = { siret: nettoyer(corps.siret, 20).replace(/\s/g, ''), nom: nettoyer(corps.nom, 80), prenom: nettoyer(corps.prenom, 80), motdepasse: String(corps.motdepasse || '') };
      if (!/^\d{14}$/.test(id.siret)) return envoyer(res, 400, { erreur: 'SIRET du compte net-entreprises : 14 chiffres.' });
      if (!id.nom || !id.prenom) return envoyer(res, 400, { erreur: 'Nom et prénom du compte net-entreprises requis.' });
      if (!id.motdepasse) { if (ancien && ancien.motdepasse) id.motdepasse = ancien.motdepasse; else return envoyer(res, 400, { erreur: 'Mot de passe requis.' }); }
      const stockage = await secrets.ecrire(id);
      if (contexte && contexte.identifiantsChanges) contexte.identifiantsChanges();
      return envoyer(res, 200, { ok: true, stockage: stockage });
    }
    if (route === 'api/tester') {
      if (!contexte || !contexte.testerConnexion) return envoyer(res, 500, { erreur: 'test indisponible' });
      try { const t = await contexte.testerConnexion(); return envoyer(res, 200, { ok: true, message: t }); }
      catch (e) { return envoyer(res, 200, { ok: false, message: e.message }); }
    }
    if (route === 'api/import') {
      const d = dossierCourant();
      if (!d) return envoyer(res, 400, { erreur: 'Choisissez d\'abord le dossier de paie.' });
      const buf = Buffer.from(String(corps.contenu || ''), 'base64');
      if (!buf.length || buf.length > 5 * 1024 * 1024) return envoyer(res, 400, { erreur: 'Fichier vide ou trop volumineux.' });
      let x; try { x = paie.extraireReference(buf); } catch (e) { return envoyer(res, 400, { erreur: e.message }); }
      const nom = dossierMod.nomSur(path.basename(String(corps.nom || 'derniere-dsn.txt'))) || 'derniere-dsn.txt';
      const dir = d.sous('reference');
      fs.writeFileSync(path.join(dir, nom), buf);
      brouillonNir = (x.indiv && x.indiv['S21.G00.30.001']) || null;
      const indiv = Object.assign({}, x.indiv); delete indiv['S21.G00.30.001'];
      const cfgImport = { urssafSiret: x.inp.urssafSiret || '', choix: { tauxAT: x.inp.atTaux ? x.inp.atTaux / 1000 : 0, acreMode: x.acre ? 'auto' : 'aucune' }, pas: x.inp.pasMode === 'dgfip' ? { mode: 'dgfip', taux: x.inp.pasTaux / 100, id: x.inp.pasId } : { mode: 'bareme' }, dsnReference: 'reference/' + nom };
      const form = versFormulaire({ hdr: x.hdr, contrat: x.contrat, indiv: x.indiv, contact: x.contact, bank: x.bank }, cfgImport);
      form.nirEnregistre = !!brouillonNir;
      void indiv;
      return envoyer(res, 200, { ok: true, fichier: 'reference/' + nom, formulaire: form, mois: x.inp.mois, neant: x.neant, acre: !!x.acre });
    }
    if (route === 'api/config') {
      const d = dossierCourant();
      if (!d) return envoyer(res, 400, { erreur: 'Choisissez d\'abord le dossier de paie.' });
      const ancienne = d.lireConfig();
      let cfg; try { cfg = construireConfig(corps, ancienne, nirDeReference(d, ancienne)); } catch (e) { return envoyer(res, 400, { erreur: e.message }); }
      if (corps.dsnReference) cfg.dsnReference = nettoyer(corps.dsnReference, 300);
      d.ecrireConfig(cfg);
      // dépôt réel automatique : choix de l'utilisateur, propre à ce dossier de paie
      const auto = chemins.lireReglages().reelSansConfirmation;
      const parDossier = auto && typeof auto === 'object' ? Object.assign({}, auto) : {};
      if (cfg.automatisation.depotReel === 'automatique_si_bilan_ok') parDossier[d.racine] = true; else delete parDossier[d.racine];
      chemins.modifierReglages({ reelSansConfirmation: parDossier });
      brouillonNir = null;
      // essai à blanc : le mois courant en simulation, pour signaler tout de suite ce qui manque
      let verification = null;
      try {
        const now = new Date();
        const mois = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const r = paie.preparer({ dossier: d, cfg: cfg, mois: mois, brut: 1000, simuler: true, controleurTables: tables.controleur(), version: contexte && contexte.version });
        verification = { pret: r.pret, erreurs: r.erreurs.filter(function (e) { return !/paies de|norme/.test(e); }).slice(0, 8) };
      } catch (e) { verification = { pret: false, erreurs: [e.message] }; }
      if (contexte && contexte.apresConfiguration) contexte.apresConfiguration();
      return envoyer(res, 200, { ok: true, fichier: path.basename(d.cheminConfig()), verification: verification });
    }
    if (route === 'api/demo') {
      if (corps.actif) {
        const dir = path.join(chemins.dossierDonnees(), 'demo', 'dossier');
        fs.mkdirSync(dir, { recursive: true });
        const d = dossierMod.ouvrir(dir);
        d.ecrireConfig(demo.configuration());
        chemins.modifierReglages({ demo: true, dossierAvantDemo: chemins.lireReglages().dossier || null, dossier: dir });
      } else {
        const reg = chemins.lireReglages();
        chemins.modifierReglages({ demo: false, dossier: reg.dossierAvantDemo || null });
      }
      if (contexte && contexte.identifiantsChanges) contexte.identifiantsChanges();
      return envoyer(res, 200, await etat());
    }
    if (route === 'api/oublier-identifiants') {
      await secrets.effacer();
      if (contexte && contexte.identifiantsChanges) contexte.identifiantsChanges();
      return envoyer(res, 200, await etat());
    }
    if (route === 'api/terminer') { envoyer(res, 200, { ok: true }); setTimeout(arreter, 300); return; }
    return envoyer(res, 404, { erreur: 'route inconnue' });
  } catch (e) {
    return envoyer(res, 500, { erreur: e.message });
  }
}

function rearmer() { if (minuterie) clearTimeout(minuterie); minuterie = setTimeout(arreter, INACTIVITE); if (minuterie.unref) minuterie.unref(); }
function arreter() { if (minuterie) clearTimeout(minuterie); minuterie = null; if (serveur) { try { serveur.close(); } catch (e) { /* déjà fermé */ } } serveur = null; jeton = null; session = null; port = null; brouillonNir = null; }

function ouvrirNavigateur(url) {
  if (process.env.DSNAP_SANS_NAVIGATEUR === '1') return false;
  try {
    let p;
    // Windows : rundll32 (chemin absolu) ouvre l'adresse dans le navigateur par défaut, sans passer par cmd
    if (process.platform === 'win32') p = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'rundll32.exe'), ['url.dll,FileProtocolHandler', url], { detached: true, stdio: 'ignore', windowsHide: true });
    else if (process.platform === 'darwin') p = spawn('open', [url], { detached: true, stdio: 'ignore' });
    else p = spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
    p.on('error', function () { /* pas de navigateur : l'adresse est donnée à l'utilisateur */ });
    p.unref();
    return true;
  } catch (e) { return false; }
}

/** Démarre (ou réutilise) la page et renvoie son adresse. */
function demarrer(ctx) {
  contexte = ctx || contexte;
  return new Promise(function (resolve, reject) {
    // chaque appel donne un nouveau lien d'entrée ; une page déjà ouverte garde sa session
    if (serveur && port) { jeton = crypto.randomBytes(18).toString('base64url'); rearmer(); resolve({ url: 'http://127.0.0.1:' + port + '/c/' + jeton + '/', dejaOuverte: true }); return; }
    jeton = crypto.randomBytes(18).toString('base64url');
    serveur = http.createServer(function (req, res) { traiter(req, res).catch(function (e) { try { envoyer(res, 500, { erreur: e.message }); } catch (x) { /* rien */ } }); });
    serveur.on('error', function (e) { reject(e); });
    serveur.listen(0, '127.0.0.1', function () {
      port = serveur.address().port;
      if (serveur.unref) serveur.unref();
      rearmer();
      resolve({ url: 'http://127.0.0.1:' + port + '/c/' + jeton + '/', dejaOuverte: false });
    });
  });
}

module.exports = { demarrer, arreter, ouvrirNavigateur, construireConfig, versFormulaire, _interne: { traiter: traiter, etat: etat } };
