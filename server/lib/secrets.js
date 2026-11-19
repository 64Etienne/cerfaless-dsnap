// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Identifiants net-entreprises (SIRET, nom, prénom, mot de passe), gardés chiffrés sur l'ordinateur :
 *
 *  - Windows : chiffrement DPAPI du compte Windows (PowerShell, ConvertFrom-SecureString), blob dans le dossier
 *    de données de DSNap ;
 *  - macOS : trousseau de session (commande security) ;
 *  - Linux : Secret Service / libsecret (commande secret-tool) ;
 *  - à défaut (aucun trousseau joignable) : fichier chiffré AES-256-GCM, clé dérivée de l'ordinateur et du compte
 *    (protection contre une lecture simple du fichier, plus faible qu'un trousseau : la page le signale).
 *
 * Les identifiants ne sont jamais écrits en clair, ni renvoyés au modèle. DSNAP_TROUSSEAU=fichier force le
 * fichier chiffré (tests).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const chemins = require('./chemins.js');

const SERVICE = 'DSNap';
const COMPTE = 'net-entreprises';

function executer(cmd, args, o) {
  o = o || {};
  return new Promise(function (resolve, reject) {
    let p;
    try { p = spawn(cmd, args, { env: Object.assign({}, process.env, o.env || {}), windowsHide: true }); }
    catch (e) { reject(e); return; }
    const out = [], err = [];
    const t = setTimeout(function () { try { p.kill(); } catch (e) { /* rien */ } reject(new Error(cmd + ' : délai dépassé')); }, o.delai || 20000);
    p.stdout.on('data', function (d) { out.push(d); });
    p.stderr.on('data', function (d) { err.push(d); });
    p.on('error', function (e) { clearTimeout(t); reject(e); });
    p.on('close', function (code) {
      clearTimeout(t);
      const so = Buffer.concat(out).toString('utf8'), se = Buffer.concat(err).toString('utf8');
      if (code === 0) resolve(so); else { const e = new Error(cmd + ' a échoué (' + code + ') ' + se.trim().slice(0, 200)); e.code = code; e.stderr = se; reject(e); }
    });
    if (o.entree !== undefined) p.stdin.end(o.entree); else p.stdin.end();
  });
}

/* ------------------------------------------------------------------ Windows (DPAPI) */
const LIRE_DPAPI = '$s=ConvertTo-SecureString -String $env:DSNAP_DONNEE; $p=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($s); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($p) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($p) }';
// chemin absolu : sous Windows, un nom nu peut désigner un exécutable du dossier courant
function powershell() { return path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'); }
function ps(script) { return ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', Buffer.from('$ErrorActionPreference="Stop";' + script, 'utf16le').toString('base64')]; }
const WIN = {
  nom: 'chiffrement Windows (DPAPI, lié à votre session)',
  fichier: function () { return path.join(chemins.dossierDonnees(), 'identifiants.dpapi'); },
  ecrire: async function (b64) {
    const blob = (await executer(powershell(), ps('$s=ConvertTo-SecureString -String $env:DSNAP_DONNEE -AsPlainText -Force; ConvertFrom-SecureString -SecureString $s'), { env: { DSNAP_DONNEE: b64 } })).trim();
    if (!/^[0-9a-f]{40,}$/i.test(blob)) throw new Error('réponse DPAPI inattendue');
    chemins.donnees();
    const f = this.fichier(), tmp = f + '.tmp';
    fs.writeFileSync(tmp, blob, { mode: 0o600 });
    // relecture avant de remplacer l'ancien blob (mode de langage restreint, profil itinérant…)
    const relu = (await executer(powershell(), ps(LIRE_DPAPI), { env: { DSNAP_DONNEE: blob } })).trim();
    if (relu !== b64) { try { fs.unlinkSync(tmp); } catch (e) { /* rien */ } throw new Error('lecture DPAPI non vérifiée'); }
    fs.renameSync(tmp, f);
  },
  lire: async function () {
    let blob; try { blob = fs.readFileSync(this.fichier(), 'utf8').trim(); } catch (e) { return null; }
    return (await executer(powershell(), ps(LIRE_DPAPI), { env: { DSNAP_DONNEE: blob } })).trim();
  },
  effacer: async function () { try { fs.unlinkSync(this.fichier()); } catch (e) { /* absent */ } }
};

/* ------------------------------------------------------------------ macOS (trousseau) */
const MAC = {
  nom: 'trousseau macOS',
  ecrire: async function (b64) {
    // par l'entrée standard de « security -i » : le secret n'apparaît pas dans la liste des processus
    // jamais en argument de commande (visible dans la liste des processus) : si « security -i » échoue, repli sur le
    // fichier chiffré
    await executer('/usr/bin/security', ['-i'], { entree: 'add-generic-password -U -a "' + COMPTE + '" -s "' + SERVICE + '" -l "DSNap (net-entreprises)" -w "' + b64 + '"\n' });
    const relu = await this.lire();
    if (relu !== b64) throw new Error('écriture dans le trousseau non vérifiée');
  },
  lire: async function () {
    try { return (await executer('/usr/bin/security', ['find-generic-password', '-a', COMPTE, '-s', SERVICE, '-w'])).trim(); }
    catch (e) { if (e.code === 44) return null; throw e; }
  },
  effacer: async function () { try { await executer('/usr/bin/security', ['delete-generic-password', '-a', COMPTE, '-s', SERVICE]); } catch (e) { /* absent */ } }
};

/* ------------------------------------------------------------------ Linux (libsecret) */
const LINUX = {
  nom: 'trousseau du système (Secret Service)',
  ecrire: async function (b64) {
    await executer('secret-tool', ['store', '--label=DSNap (net-entreprises)', 'service', SERVICE, 'account', COMPTE], { entree: b64 });
    const relu = await this.lire();
    if (relu !== b64) throw new Error('écriture dans le trousseau non vérifiée');
  },
  lire: async function () {
    try { const s = (await executer('secret-tool', ['lookup', 'service', SERVICE, 'account', COMPTE])).trim(); return s || null; }
    catch (e) { if (e.code === 1) return null; throw e; }
  },
  effacer: async function () { try { await executer('secret-tool', ['clear', 'service', SERVICE, 'account', COMPTE]); } catch (e) { /* absent */ } }
};

/* ------------------------------------------------------------------ repli : fichier chiffré */
function cleLocale() {
  let mid = '';
  ['/etc/machine-id', '/var/lib/dbus/machine-id'].some(function (f) { try { mid = fs.readFileSync(f, 'utf8').trim(); return !!mid; } catch (e) { return false; } });
  let user = ''; try { user = os.userInfo().username; } catch (e) { user = ''; }
  return crypto.scryptSync(mid + '|' + user + '|' + os.homedir() + '|' + os.hostname(), 'DSNap-identifiants-v1', 32);
}
const FICHIER = {
  nom: 'fichier chiffré sur cet ordinateur (aucun trousseau système disponible : protection plus faible qu\'un trousseau)',
  fichier: function () { return path.join(chemins.dossierDonnees(), 'identifiants.chiffres'); },
  ecrire: async function (b64) {
    const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', cleLocale(), iv);
    const ct = Buffer.concat([c.update(b64, 'utf8'), c.final()]);
    chemins.donnees();
    fs.writeFileSync(this.fichier(), JSON.stringify({ v: 1, iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') }), { mode: 0o600 });
  },
  lire: async function () {
    let o; try { o = JSON.parse(fs.readFileSync(this.fichier(), 'utf8')); } catch (e) { return null; }
    const d = crypto.createDecipheriv('aes-256-gcm', cleLocale(), Buffer.from(o.iv, 'base64'));
    d.setAuthTag(Buffer.from(o.tag, 'base64'));
    return Buffer.concat([d.update(Buffer.from(o.ct, 'base64')), d.final()]).toString('utf8');
  },
  effacer: async function () { try { fs.unlinkSync(this.fichier()); } catch (e) { /* absent */ } }
};

function systeme() {
  if (process.env.DSNAP_TROUSSEAU === 'fichier') return null;
  if (process.platform === 'win32') return WIN;
  if (process.platform === 'darwin') return MAC;
  if (process.platform === 'linux') return LINUX;
  return null;
}

let cache = null; // { valeur, stockage }

function encoder(o) { return Buffer.from(JSON.stringify(o), 'utf8').toString('base64'); }
function decoder(b64) { const o = JSON.parse(Buffer.from(b64, 'base64').toString('utf8')); return o && typeof o === 'object' ? o : null; }

/** Enregistre { siret, nom, prenom, motdepasse }. Renvoie le nom du stockage utilisé. */
async function ecrire(ident) {
  const propre = { siret: String(ident.siret || '').replace(/\s/g, ''), nom: String(ident.nom || '').trim(), prenom: String(ident.prenom || '').trim(), motdepasse: String(ident.motdepasse || '') };
  const b64 = encoder(propre);
  const sys = systeme();
  let stockage = FICHIER;
  if (sys) {
    try { await sys.ecrire(b64); stockage = sys; }
    catch (e) { stockage = FICHIER; }
  }
  if (stockage === FICHIER) await FICHIER.ecrire(b64);
  else await FICHIER.effacer();
  // de nouveaux identifiants lèvent le blocage posé après un refus de net-entreprises
  chemins.modifierReglages({ identifiants: { stockage: stockage.nom, siret: propre.siret, enregistreLe: new Date().toISOString() }, identifiantsRefuses: [] });
  cache = { valeur: propre, stockage: stockage.nom };
  return stockage.nom;
}

/** Lit les identifiants (null s'il n'y en a pas). */
async function lire() {
  if (cache) return cache.valeur;
  const sys = systeme();
  const essais = sys ? [sys, FICHIER] : [FICHIER];
  for (const b of essais) {
    try {
      const b64 = await b.lire();
      if (b64) { const v = decoder(b64); if (v) { cache = { valeur: v, stockage: b.nom }; return v; } }
    } catch (e) { /* stockage indisponible : on essaie le suivant */ }
  }
  return null;
}

async function effacer() {
  const sys = systeme();
  if (sys) await sys.effacer();
  await FICHIER.effacer();
  cache = null;
  const r = chemins.lireReglages(); delete r.identifiants; chemins.ecrireReglages(r);
}

function oublierCache() { cache = null; }

module.exports = { ecrire, lire, effacer, oublierCache, _interne: { executer, FICHIER, systeme } };
