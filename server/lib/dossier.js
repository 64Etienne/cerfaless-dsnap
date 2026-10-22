// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Dossier de paie d'une société (choisi par l'utilisateur, sur son ordinateur) :
 *
 *   dsnap.json                 configuration de la société et du président (écrite par la page de configuration)
 *   dsnap-etat.json            état tenu par DSNap (numéros d'ordre des DSN fabriquées chaque mois civil)
 *   reference/                 dernière DSN acceptée importée (facultatif : en-tête, identité, contrat)
 *   AAAA/AAAA-MM Mois/         fichiers du mois : DSN test et réelle, bulletin, note de frais, récapitulatif
 *   retours/                   réponses de net-entreprises, bilans, journal des dépôts (journal-depots.json)
 *
 * Compatibilité : un dossier de l'ancien skill « paie-dsn » (paie-dsn.json, paie-dsn-etat.json) est lu tel quel.
 * Tous les chemins reçus du modèle sont résolus dans le dossier ; un chemin qui en sort est refusé.
 */
const fs = require('fs');
const path = require('path');

const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];

function fail(msg, extra) { const e = new Error(msg); e.utilisateur = true; if (extra) Object.assign(e, extra); return e; }

function ouvrir(racine) {
  if (!racine) throw fail('Aucun dossier de paie configuré : ouvrez la configuration de DSNap (outil configurer_dsnap).', { configuration: true });
  if (!fs.existsSync(racine)) throw fail('Le dossier de paie configuré est introuvable : ' + racine + '. Ouvrez la configuration de DSNap pour en choisir un autre.', { configuration: true });
  const reel = fs.realpathSync(racine);

  function dans(p) {
    const abs = path.resolve(reel, String(p || ''));
    const r = fs.existsSync(abs) ? fs.realpathSync(abs) : abs;
    const rel = path.relative(reel, r);
    if (rel.startsWith('..') || path.isAbsolute(rel)) throw fail('Fichier hors du dossier de paie : ' + p);
    return r;
  }
  function relatif(abs) { return path.relative(reel, abs).split(path.sep).join('/'); }
  function sous(nom) { const d = path.join(reel, nom); fs.mkdirSync(d, { recursive: true }); return d; }

  function cheminConfig() {
    const n = path.join(reel, 'dsnap.json'), a = path.join(reel, 'paie-dsn.json');
    return fs.existsSync(n) || !fs.existsSync(a) ? n : a;
  }
  function lireConfig() {
    const f = cheminConfig();
    if (!fs.existsSync(f)) return null;
    try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { throw fail('Configuration illisible (' + path.basename(f) + ' n\'est pas un JSON valide) : ouvrez la configuration de DSNap (outil configurer_dsnap) pour la réenregistrer.', { configuration: true }); }
  }
  function ecrireConfig(cfg) {
    const f = path.join(reel, 'dsnap.json'), tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
    fs.renameSync(tmp, f);
    return f;
  }

  function lireEtat() {
    const e = { ordre: {} };
    ['paie-dsn-etat.json', 'dsnap-etat.json'].forEach(function (n) {
      try {
        const o = JSON.parse(fs.readFileSync(path.join(reel, n), 'utf8'));
        Object.keys(o.ordre || {}).forEach(function (k) { e.ordre[k] = Math.max(e.ordre[k] || 0, o.ordre[k]); });
      } catch (x) { /* absent */ }
    });
    return e;
  }
  function ecrireEtat(e) { fs.writeFileSync(path.join(reel, 'dsnap-etat.json'), JSON.stringify(e, null, 2)); }

  function dossierMois(mois) {
    const m = /^(\d{4})-(\d{2})$/.exec(mois);
    return path.join(reel, m[1], mois + ' ' + MOIS[+m[2] - 1]);
  }

  function retours() { return sous('retours'); }
  function cheminJournal() { return path.join(retours(), 'journal-depots.json'); }
  // Le journal protège contre les doublons : il s'écrit de façon atomique, et un journal illisible bloque les
  // dépôts au lieu d'être ignoré.
  function lireJournal() {
    let t;
    try { t = fs.readFileSync(cheminJournal(), 'utf8'); } catch (e) { if (e.code === 'ENOENT') return []; throw fail('Journal des dépôts illisible (' + e.code + ') : DSNap ne dépose rien tant qu\'il ne peut pas vérifier les dépôts déjà faits.'); }
    try { const j = JSON.parse(t); if (!Array.isArray(j)) throw new Error('format'); return j; }
    catch (e) { throw fail('Journal des dépôts endommagé (retours/journal-depots.json) : DSNap ne dépose rien tant qu\'il ne peut pas vérifier les dépôts déjà faits. Restaurez une copie du fichier, ou renommez-le et vérifiez les dépôts avec rechercher_depots.'); }
  }
  function ecrireJournal(j) {
    const f = cheminJournal(), tmp = f + '.' + process.pid + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(j, null, 2));
    fs.renameSync(tmp, f);
  }
  function ajouterJournal(entree) { const j = lireJournal(); j.push(entree); ecrireJournal(j); return entree; }
  function majJournal(idflux, champs) {
    if (!idflux) return;
    const j = lireJournal(); let fait = false;
    j.forEach(function (e) { if (e.idflux === idflux) { Object.assign(e, champs); fait = true; } });
    if (fait) ecrireJournal(j);
  }
  function majEntree(id, champs) {
    const j = lireJournal(); let fait = false;
    j.forEach(function (e) { if (e.id === id) { Object.assign(e, champs); fait = true; } });
    if (fait) ecrireJournal(j);
  }
  /** Verrou de dépôt partagé entre processus (fichier exclusif, périmé après 10 minutes). */
  function verrouiller() {
    const f = path.join(retours(), '.depot-en-cours');
    try {
      const fd = fs.openSync(f, 'wx'); fs.writeSync(fd, String(process.pid) + ' ' + new Date().toISOString()); fs.closeSync(fd);
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let age = 0; try { age = Date.now() - fs.statSync(f).mtimeMs; } catch (x) { age = 0; }
      if (age < 10 * 60000) throw fail('Un autre dépôt est en cours dans ce dossier de paie : attendez sa fin avant d\'en lancer un nouveau.');
      fs.writeFileSync(f, String(process.pid) + ' ' + new Date().toISOString());
    }
    return function () { try { fs.unlinkSync(f); } catch (e) { /* déjà libéré */ } };
  }

  /** Fichiers DSN du dossier (au plus 3 niveaux), sans les retours. */
  function fichiersDsn() {
    const out = [];
    (function parcourir(d, niveau) {
      let noms = []; try { noms = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
      noms.forEach(function (x) {
        const p = path.join(d, x.name);
        if (x.isDirectory()) { if (niveau < 3 && x.name !== 'retours' && x.name[0] !== '.') parcourir(p, niveau + 1); return; }
        if (!/\.(txt|dsn|edi)$/i.test(x.name)) return;
        try {
          const fd = fs.openSync(p, 'r'), b = Buffer.alloc(32); fs.readSync(fd, b, 0, 32, 0); fs.closeSync(fd);
          if (/^S10\.G00\.00\.001,/.test(b.toString('latin1'))) out.push(relatif(p));
        } catch (e) { /* illisible */ }
      });
    })(reel, 0);
    return out.sort();
  }

  return { racine: reel, dans, relatif, sous, cheminConfig, lireConfig, ecrireConfig, lireEtat, ecrireEtat, dossierMois, retours, cheminJournal, lireJournal, ajouterJournal, majJournal, majEntree, verrouiller, fichiersDsn };
}

function nomSur(s) { return String(s).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120); }

module.exports = { ouvrir, nomSur, MOIS };
