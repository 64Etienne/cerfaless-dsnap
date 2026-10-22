// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Emplacements de DSNap sur l'ordinateur de l'utilisateur.
 *
 *  - dossier de données de l'application (réglages, identifiants chiffrés, licence, cache des tables) :
 *      Windows : %APPDATA%\DSNap · macOS : ~/Library/Application Support/DSNap · Linux : $XDG_CONFIG_HOME/dsnap
 *    (DSNAP_DONNEES le remplace, pour les tests) ;
 *  - dossier de paie, choisi par l'utilisateur (par défaut ~/DSNap, hors des dossiers souvent synchronisés) : configuration de la société, DSN
 *    produites, bulletins, retours de net-entreprises. DSNap ne lit et n'écrit des fichiers de paie que là.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const ENV = process.env;

function dossierDonnees() {
  if (ENV.DSNAP_DONNEES) return path.resolve(ENV.DSNAP_DONNEES);
  const home = os.homedir();
  if (process.platform === 'win32') return path.join(ENV.APPDATA || path.join(home, 'AppData', 'Roaming'), 'DSNap');
  if (process.platform === 'darwin') return path.join(home, 'Library', 'Application Support', 'DSNap');
  return path.join(ENV.XDG_CONFIG_HOME || path.join(home, '.config'), 'dsnap');
}
function assurer(d) { fs.mkdirSync(d, { recursive: true }); return d; }
function donnees() { return assurer(dossierDonnees()); }

// dans le dossier personnel plutôt que dans Documents, souvent synchronisé (iCloud, OneDrive) : les fichiers de paie
// contiennent le numéro de sécurité sociale
function dossierPaieParDefaut() { return path.join(os.homedir(), 'DSNap'); }

/* ------------------------------------------------------------------ réglages (non secrets) */
function cheminReglages() { return path.join(dossierDonnees(), 'reglages.json'); }
function lireReglages() {
  let r = {};
  try { r = JSON.parse(fs.readFileSync(cheminReglages(), 'utf8')) || {}; } catch (e) { r = {}; }
  if (!r.installation) {
    r.installation = crypto.randomUUID();
    try { ecrireReglages(r); } catch (e) { /* lecture seule : identifiant éphémère */ }
  }
  return r;
}
function ecrireReglages(r) {
  donnees();
  const f = cheminReglages(), tmp = f + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(r, null, 2));
  fs.renameSync(tmp, f);
  return r;
}
function modifierReglages(maj) { const r = lireReglages(); Object.assign(r, maj); return ecrireReglages(r); }

/**
 * Dossier de paie en vigueur : variable DSNAP_DOSSIER ou NE_DOSSIER (réglage de l'extension), sinon réglages,
 * sinon null (pas encore configuré).
 */
function dossierPaie() {
  const env = ENV.DSNAP_DOSSIER || ENV.NE_DOSSIER;
  if (env && !/^\$\{/.test(env)) return path.resolve(env);
  const r = lireReglages();
  return r.dossier ? path.resolve(r.dossier) : null;
}

module.exports = { dossierDonnees, donnees, assurer, dossierPaieParDefaut, lireReglages, ecrireReglages, modifierReglages, dossierPaie };
