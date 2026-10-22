// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Tables de référence DSN (nomenclatures net-entreprises) : cache local, mise à jour automatique et contrôle.
 *
 *  - cache : <dossier de données>/nomenclatures/<norme>.json.gz et etat.json ;
 *  - version embarquée : server/nomenclatures/ (présente dans l'extension .mcpb, absente du plugin) ;
 *  - mise à jour : page officielle de chaque norme sur net-entreprises.fr (seules les tables republiées sont
 *    téléchargées), sonde de la norme suivante, flux RSS ; au plus une fois toutes les 12 heures automatiquement ;
 *  - secours : si net-entreprises est injoignable et qu'aucune table n'est installée, copie publiée par DSNap
 *    (même contenu, empreinte SHA-256 vérifiée).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const NM = require('./nomenclatures.js');
const chemins = require('./chemins.js');

const EMBARQUE = path.join(__dirname, '..', 'nomenclatures');
const INTERVALLE = 12 * 3600 * 1000;
const MIROIRS = process.env.DSNAP_SITE ? [process.env.DSNAP_SITE.replace(/\/+$/, '') + '/tables/'] : ['https://cerfaless.fr/dsnap/tables/', 'https://github.com/64Etienne/cerfaless-dsnap/releases/latest/download/'];
const NORME_COURANTE = 'P26V01';

function racine() { return chemins.donnees(); }
function controleur() { return NM.controleur({ dossier: racine(), dossierSkill: EMBARQUE }); }
function normes() { return NM.normesDisponibles(racine(), EMBARQUE); }
function jeu(norme) { try { return NM.charger({ dossier: racine(), norme: norme || NORME_COURANTE, dossierSkill: EMBARQUE }); } catch (e) { return null; } }
function cheminEssai() { return path.join(racine(), 'nomenclatures', 'dernier-essai.json'); }

function message(r) {
  const parts = [];
  (r.normes || []).forEach(function (n) {
    const d = n.distant ? n.distant.version + ' du ' + NM.dateFR(n.distant.date) : '';
    if (n.action === 'mis_a_jour') {
      const tabs = n.nouveautes ? Object.keys(n.nouveautes) : [];
      const res = tabs.length > 6 ? tabs.length + ' tables concernées'
        : tabs.map(function (t) { return t + ' (' + Object.keys(n.nouveautes[t]).map(function (k) { return n.nouveautes[t][k] + ' ' + k.toLowerCase(); }).join(', ') + ')'; }).join(' ; ');
      parts.push('Tables ' + n.norme + ' mises à jour : ' + d + (res ? ' — nouveautés : ' + res : '') + '.');
    } else if (n.action === 'mise_a_jour_disponible') parts.push('Mise à jour disponible pour ' + n.norme + ' : ' + d + '.');
    else if (n.action === 'echec') parts.push('Échec de la mise à jour ' + n.norme + ' : ' + n.erreur + ' — contrôles faits avec les tables locales' + (n.local ? ' (' + n.local.version + ' du ' + NM.dateFR(n.local.date) + ')' : '') + '.');
    if (n.avertissements && n.avertissements.length) parts.push(n.norme + ' : ' + n.avertissements.join(' ; ') + '.');
  });
  (r.nouvellesNormes || []).forEach(function (n) { parts.push('Nouvelle norme publiée : ' + n.norme + ' (' + n.version + ' du ' + NM.dateFR(n.date) + ').'); });
  if (r.statut === 'hors_ligne') {
    const loc = (r.normes || []).filter(function (n) { return n.local; }).map(function (n) { return n.norme + ' ' + n.local.version + ' du ' + NM.dateFR(n.local.date); }).join(', ');
    parts.push('net-entreprises injoignable : contrôles faits avec les tables locales' + (loc ? ' (' + loc + ')' : '') + '.');
  }
  if (r.miroir) parts.push(r.miroir);
  (r.actualites || []).forEach(function (x) { parts.push('Actualité net-entreprises du ' + NM.dateFR(x.date) + ' : ' + x.titre); });
  return parts.join(' ');
}

/** Copie de secours publiée par DSNap, si aucune table n'est installée. */
async function depuisMiroir(norme) {
  let derniere = null;
  for (const m of MIROIRS) {
    try { return await depuisUnMiroir(m, norme); } catch (e) { derniere = e; }
  }
  throw derniere || new Error('copie DSNap indisponible');
}
async function depuisUnMiroir(MIROIR, norme) {
  const r = await fetch(MIROIR + 'manifest.json', { signal: AbortSignal.timeout(15000) });
  if (!r.ok) throw new Error('copie DSNap indisponible (HTTP ' + r.status + ')');
  const m = await r.json();
  const e = m && m.normes && m.normes[norme];
  if (!e || !e.fichier || !e.sha256) throw new Error('norme ' + norme + ' absente de la copie DSNap');
  const f = await fetch(MIROIR + e.fichier, { signal: AbortSignal.timeout(120000) });
  if (!f.ok) throw new Error('téléchargement de la copie DSNap impossible (HTTP ' + f.status + ')');
  const buf = Buffer.from(await f.arrayBuffer());
  if (crypto.createHash('sha256').update(buf).digest('hex') !== e.sha256) throw new Error('empreinte de la copie DSNap incorrecte');
  const cible = path.join(racine(), 'nomenclatures', norme + '.json.gz');
  fs.mkdirSync(path.dirname(cible), { recursive: true });
  const tmp = cible + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, buf);
  try { NM.lireJeu(tmp); } catch (x) { fs.unlinkSync(tmp); throw new Error('copie DSNap illisible'); }
  const actuel = jeu(norme), nouveau = NM.lireJeu(tmp);
  if (actuel && NM.plusRecent(actuel, nouveau) === actuel) { fs.unlinkSync(tmp); return { version: actuel.version, date: actuel.datePublication, remplace: false }; }
  fs.renameSync(tmp, cible);
  return { version: nouveau.version, date: nouveau.datePublication, remplace: true };
}

/**
 * Mise à jour depuis net-entreprises. o.forcer : tout retélécharger ; o.verifier : comparer seulement ;
 * o.transport : transport de remplacement (tests).
 */
async function mettreAJour(o) {
  o = o || {};
  let rapport;
  try {
    rapport = await NM.mettreAJour({ dossier: racine(), dossierSkill: EMBARQUE, verifier: !!o.verifier, forcer: !!o.forcer, transport: o.transport, rss: o.rss !== false, sonde: o.sonde !== false, normes: [NORME_COURANTE] });
  } catch (e) {
    rapport = { statut: 'echec', erreur: e.message, normes: [], nouvellesNormes: [], actualites: [], avertissements: [] };
  }
  if (!jeu(NORME_COURANTE) && rapport.statut !== 'a_jour' && rapport.statut !== 'mis_a_jour' && o.miroir !== false) {
    try { const m = await depuisMiroir(NORME_COURANTE); rapport.miroir = 'Tables ' + NORME_COURANTE + ' ' + m.version + ' du ' + NM.dateFR(m.date) + ' installées depuis la copie publiée par DSNap.'; }
    catch (e) { rapport.miroir = 'Aucune table installée (' + e.message + ') : les codes ne seront pas vérifiés tant que net-entreprises.fr reste injoignable.'; }
  }
  try { fs.mkdirSync(path.dirname(cheminEssai()), { recursive: true }); fs.writeFileSync(cheminEssai(), JSON.stringify({ le: new Date().toISOString(), statut: rapport.statut })); } catch (e) { /* facultatif */ }
  rapport.message = message(rapport);
  return rapport;
}

/** Mise à jour automatique, au plus toutes les 12 heures (ou tout de suite si aucune table n'est installée). */
async function siNecessaire(o) {
  if (process.env.DSNAP_TABLES_AUTO === '0') return null;
  let dernier = 0;
  try { dernier = Date.parse(JSON.parse(fs.readFileSync(cheminEssai(), 'utf8')).le) || 0; } catch (e) { dernier = 0; }
  if (jeu(NORME_COURANTE) && Date.now() - dernier < INTERVALLE) return null;
  return mettreAJour(o);
}

function resume() {
  return normes().map(function (n) { const j = jeu(n); return j ? { norme: n, version: j.version, date: j.datePublication, origine: j.origine, tables: Object.keys(j.tables).length } : { norme: n }; });
}

/** Codes d'une table (pour les listes de la page de configuration). */
function codes(abr, norme) {
  const j = jeu(norme);
  if (!j || !j.tables[abr]) return [];
  const t = j.tables[abr];
  return Object.keys(t.codes).filter(function (c) { const e = t.codes[c]; return !e[2] || e[2] >= new Date().toISOString().slice(0, 10); }).map(function (c) { return { code: c, libelle: t.codes[c][0] || '' }; });
}

module.exports = { controleur, mettreAJour, siNecessaire, resume, codes, jeu, normes, depuisMiroir, EMBARQUE, NORME_COURANTE };
