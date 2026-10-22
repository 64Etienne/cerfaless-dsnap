// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Tables de référence (nomenclatures) de la norme DSN publiées par net-entreprises.
 *
 *  - lecture de la page officielle d'une norme (liste des tables, rubriques concernées,
 *    date de dernière mise à jour de chaque table, liens de téléchargement, historique des versions
 *    et codes retirés à chaque version) ;
 *  - lecture des fichiers CSV (une table, ou le fichier « cumul » qui les regroupe toutes)
 *    et de la release note (RLN) de la dernière version ;
 *  - construction d'un jeu de tables compact (JSON compressé en gzip), un fichier par norme ;
 *  - chargement : version embarquée (extension), ou celle du cache local si elle est plus récente ;
 *  - contrôle des rubriques codées d'une DSN (code connu, valide pour la période déclarée, valeur d'échappement,
 *    taux du barème du prélèvement à la source).
 *
 * Aucune dépendance : Node 18 ou plus récent (fetch, zlib).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFile } = require('child_process');

const FORMAT = 1;
const DOSSIER_SKILL = path.join(__dirname, '..', 'nomenclatures');
const SOUS_DOSSIER = 'nomenclatures';
const FLUX_RSS = 'https://www.net-entreprises.fr/feed/';
const UA = 'Mozilla/5.0 (compatible; DSNap nomenclatures)';
const JOURS_AVANT_ALERTE = 35;
const DELAI_PAGE = 25000;       // page d'une norme, sonde, flux RSS
const DELAI_FICHIER = 120000;   // fichiers CSV (le cumul pèse 16 Mo)
const TABLES_SANS_LIBELLE = ['EFE']; // 115 000 établissements FINESS : on garde les codes et les dates, pas les adresses

function urlPage(norme) { return 'https://www.net-entreprises.fr/nomenclatures-dsn-' + norme.toLowerCase() + '/'; }

/* ------------------------------------------------------------------ utilitaires */

function decoder(buf) {
  if (typeof buf === 'string') return buf.replace(/^﻿/, '');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, ''); }
  catch (e) { return Buffer.from(buf).toString('latin1'); }
}

const RE_DATE = /^(\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2})$/;
/** JJ/MM/AAAA (ou déjà AAAA-MM-JJ) → AAAA-MM-JJ ; '' si illisible. */
function dateISO(s) {
  s = String(s || '').trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return m[3] + '-' + m[2] + '-' + m[1];
  m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? s : '';
}
function dateFR(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : ''; }
function finDeMois(y, m) { return y + '-' + String(m).padStart(2, '0') + '-' + String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, '0'); }

const ENTITES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', eacute: 'é', egrave: 'è', ecirc: 'ê', euml: 'ë', agrave: 'à', acirc: 'â', ccedil: 'ç', ocirc: 'ô', ucirc: 'û', ugrave: 'ù', icirc: 'î', iuml: 'ï', Eacute: 'É', Egrave: 'È', Agrave: 'À', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—', hellip: '…', laquo: '«', raquo: '»', deg: '°', oelig: 'œ' };
function entites(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, e) {
    if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return isFinite(n) ? String.fromCodePoint(n) : all; }
    return ENTITES[e] !== undefined ? ENTITES[e] : all;
  });
}
function texte(html) { return entites(String(html).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(); }

/* ------------------------------------------------------------------ page officielle */

/** Codes retirés à chaque version, d'après l'historique « Dernières mises à jour » de la page. */
function lireRetraits(html, norme) {
  const out = [];
  const reV = new RegExp('release_note_version_nom[^>]*>\\s*Version\\s+' + norme + '\\s+(v\\d+)\\s+du\\s+(\\d{2}\\/\\d{2}\\/\\d{4})', 'gi');
  const pos = [];
  let v;
  while ((v = reV.exec(html))) pos.push({ i: v.index, version: v[1].toLowerCase() });
  pos.forEach(function (p, k) {
    const seg = html.slice(p.i, k + 1 < pos.length ? pos[k + 1].i : html.length);
    const re = /<summary>([\s\S]*?)<\/summary>|<li class="release_note_li_valeur">([\s\S]*?)<\/li>/gi;
    let table = '', rubrique = '', m;
    while ((m = re.exec(seg))) {
      if (m[1] !== undefined) {
        const t = texte(m[1]), mt = /^Modification de la table\s+([A-Z0-9]+)/i.exec(t);
        if (mt) { table = mt[1].toUpperCase(); rubrique = ''; } else rubrique = t;
      }
      else if (table && /^Suppression de/i.test(rubrique)) {
        // « CODE - LIBELLÉ - JJ/MM/AAAA - JJ/MM/AAAA », la fin pouvant manquer, ou « CODE - LIBELLÉ » (tables sans dates)
        const li = /^(.+?) - (.*?)(?: - (\d{2}\/\d{2}\/\d{4}) -(?: (\d{2}\/\d{2}\/\d{4}))?)?$/.exec(texte(m[2]));
        if (li) out.push({ version: p.version, table: table, code: li[1].trim(), libelle: li[2].trim(), debut: dateISO(li[3] || ''), fin: dateISO(li[4] || '') });
      }
    }
  });
  return out;
}

/** Lit la page « Tables de référence de la norme DSN » d'une norme. Renvoie null si ce n'est pas la bonne page. */
function lirePage(html, normeAttendue) {
  html = decoder(html);
  const norme = String(normeAttendue).toUpperCase();
  const tables = {};
  const reLien = new RegExp('telechargeFichierCsv/NEODESP\\d{2}-([A-Z0-9]+)-' + norme + '\\.csv', 'i');
  const lignes = html.match(/<tr[^>]*>[\s\S]*?<\/tr>/gi) || [];
  lignes.forEach(function (tr) {
    const lien = reLien.exec(tr);
    if (!lien) return;
    const tds = (tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []).map(function (td) { return td.replace(/^<td[^>]*>|<\/td>$/gi, ''); });
    const href = /href="([^"]+)"/i.exec(tr);
    const abr = lien[1].toUpperCase();
    const dates = tds.map(function (td) { return texte(td); }).filter(function (t) { return RE_DATE.test(t); });
    const rubriques = Array.from(new Set(texte(tds[2] || '').match(/S\d{2}\.G\d{2}\.\d{2}\.\d{3}/g) || []));
    tables[abr] = {
      nom: texte(tds[0] || ''),
      rubriques: rubriques,
      fournisseur: texte(tds[3] || ''),
      maj: dateISO(dates[dates.length - 1] || ''),
      csv: href ? entites(href[1]) : ''
    };
  });
  if (!Object.keys(tables).length) return null;

  const fichiers = {};
  const reGen = /href="([^"]*telechargeFichier(?:Genere|Compl)\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  let g;
  while ((g = reGen.exec(html))) {
    const url = entites(g[1]), t = texte(g[2]), d = /\((\d{2}\/\d{2}\/\d{4})\)/.exec(t);
    const type = /_CUMUL_/i.test(url) ? 'cumul' : /_RLN_/i.test(url) ? 'rln' : /_INDEX_/i.test(url) ? 'index' : /_ZIP_/i.test(url) ? 'zip' : /TRIGRAMME/i.test(url) ? 'trigrammes' : null;
    if (type && !fichiers[type]) fichiers[type] = { url: url, date: d ? dateISO(d[1]) : '' };
  }

  const historique = [];
  const reV = new RegExp('Version\\s+' + norme + '\\s+(v\\d+)\\s+du\\s+(\\d{2}\\/\\d{2}\\/\\d{4})', 'gi');
  const plat = texte(html);
  let v;
  while ((v = reV.exec(plat))) {
    if (!historique.some(function (h) { return h.version === v[1].toLowerCase(); })) historique.push({ version: v[1].toLowerCase(), date: dateISO(v[2]) });
  }
  historique.sort(function (a, b) { return parseInt(b.version.slice(1), 10) - parseInt(a.version.slice(1), 10); });

  const datePublication = (fichiers.cumul && fichiers.cumul.date) || (historique[0] && historique[0].date) ||
    Object.keys(tables).map(function (k) { return tables[k].maj; }).sort().pop() || '';
  return { norme: norme, page: urlPage(norme), version: historique[0] ? historique[0].version : '', datePublication: datePublication, historique: historique, tables: tables, fichiers: fichiers, retraits: lireRetraits(html, norme) };
}

/* ------------------------------------------------------------------ fichiers CSV */

function decouper(txt) { return decoder(txt).split(/\r?\n/).filter(function (l) { return l.trim() !== ''; }); }

/** Une table seule (ex. NEODESP26-RAT-P26V01.csv). La dernière colonne de l'en-tête porte la date de la table. */
function lireCsvTable(txt) {
  const lignes = decouper(txt);
  if (!lignes.length) throw new Error('fichier vide');
  const ent = lignes[0].split(';').map(function (c) { return c.trim().toLowerCase(); });
  let date = '';
  if (RE_DATE.test(ent[ent.length - 1])) date = dateISO(ent.pop());
  if (!/^code/.test(ent[0])) throw new Error('en-tête inattendu : ' + lignes[0]);
  const iLib = ent.findIndex(function (c) { return c.indexOf('libell') === 0; });
  const fin = iLib >= 0 ? ent.slice(iLib + 1) : ent.slice(1);
  const codes = {};
  for (let i = 1; i < lignes.length; i++) {
    const f = lignes[i].split(';');
    while (f.length > ent.length && f[f.length - 1] === '') f.pop();
    while (f.length < ent.length) f.push('');
    const queue = f.slice(f.length - fin.length);
    const lib = iLib >= 0 ? f.slice(1, f.length - fin.length).join(';') : '';
    const val = function (nom) { const k = fin.findIndex(function (c) { return c.indexOf(nom) === 0; }); return k >= 0 ? queue[k].trim() : ''; };
    const code = f[0].trim();
    if (code) codes[code] = [lib.trim(), dateISO(val('date de début')), dateISO(val('date de fin')), val('trigramme')];
  }
  return { date: date, codes: codes };
}

/** Le fichier qui regroupe toutes les tables (NEODESP26_CUMUL_P26V01.csv). La première cellule porte sa date. */
function lireCumul(txt) {
  const lignes = decouper(txt);
  if (!lignes.length) throw new Error('fichier vide');
  const ent = lignes[0].split(';');
  const date = dateISO(ent[0]);
  if (!date || !/code/i.test(ent[1] || '')) throw new Error('en-tête du fichier cumul inattendu : ' + lignes[0]);
  const tables = {};
  for (let i = 1; i < lignes.length; i++) {
    const f = lignes[i].split(';');
    if (f.length < 6) throw new Error('ligne ' + (i + 1) + ' : ' + f.length + ' colonnes au lieu de 6');
    const t = f[0].trim().toUpperCase(), code = f[1].trim();
    const finV = f[f.length - 1], debV = f[f.length - 2], tri = f[f.length - 3], lib = f.slice(2, f.length - 3).join(';');
    if (!tables[t]) tables[t] = { date: '', codes: {} };
    if (code) tables[t].codes[code] = [lib.trim(), dateISO(debV), dateISO(finV), tri.trim()];
  }
  return { date: date, tables: tables };
}

/** Release note de la dernière version (NEODESP26_RLN_P26V01.csv). */
function lireRln(txt) {
  const lignes = decouper(txt);
  if (!lignes.length || !/abr[ée]viation/i.test(lignes[0])) throw new Error('en-tête de release note inattendu');
  return lignes.slice(1).map(function (l) {
    const f = l.split(';');
    while (f.length < 7) f.push('');
    return {
      table: f[0].trim().toUpperCase(), typeTable: f[1].trim(), typeCode: f[2].trim(), code: f[3].trim(),
      libelle: f.slice(4, f.length - 2).join(';').trim(), debut: dateISO(f[f.length - 2]), fin: dateISO(f[f.length - 1])
    };
  });
}

/** Résumé lisible d'une release note : { RAT: { 'Ajout de code': 3 }, EFE: { 'Ajout': 1 } } */
function resumerRln(lignes) {
  const r = {};
  (lignes || []).forEach(function (l) {
    const k = l.typeCode || l.typeTable || 'Modification';
    r[l.table] = r[l.table] || {};
    r[l.table][k] = (r[l.table][k] || 0) + 1;
  });
  return r;
}

/* ------------------------------------------------------------------ jeu de tables */

/**
 * Construit le jeu de tables d'une norme.
 *  page      : résultat de lirePage (noms, rubriques, dates par table, codes retirés) — ou une page reconstituée hors ligne
 *  donnees   : { ABR: { date, codes } } pour les tables téléchargées
 *  complet   : true si donnees vient du fichier complet : chaque table de la page doit y figurer
 *  precedent : jeu précédent (tables non modifiées reprises telles quelles, codes retirés conservés)
 *  rln       : lignes de la release note de la version publiée
 */
function construire(o) {
  const page = o.page, prec = o.precedent && o.precedent.norme === page.norme ? o.precedent : null;
  const ds = {
    format: FORMAT, norme: page.norme, version: page.version || '', datePublication: page.datePublication,
    historique: page.historique || [], page: page.page || urlPage(page.norme), fichiers: page.fichiers || {},
    source: o.source || 'net-entreprises.fr', construitLe: (o.maintenant || new Date()).toISOString(),
    tables: {}, supprimes: {}, nouveautes: null
  };
  Object.keys(page.tables).sort().forEach(function (abr) {
    const meta = page.tables[abr];
    const neuf = o.donnees && o.donnees[abr];
    const ancien = prec && prec.tables[abr];
    if (!neuf && o.complet) throw new Error('table ' + abr + ' absente du fichier regroupant toutes les tables');
    if (!neuf && !ancien) throw new Error('table ' + abr + ' : aucune donnée (ni téléchargée, ni dans la version précédente)');
    let codes = neuf ? neuf.codes : ancien.codes;
    if (TABLES_SANS_LIBELLE.indexOf(abr) >= 0) {
      const c2 = {};
      Object.keys(codes).forEach(function (k) { const e = codes[k]; c2[k] = ['', e[1], e[2], e[3]]; });
      codes = c2;
    }
    // date de la table : celle de son fichier s'il la porte (elle fait foi), sinon celle de la page
    const maj = (neuf && neuf.date) || meta.maj || (ancien && ancien.maj) || '';
    ds.tables[abr] = { nom: meta.nom, rubriques: meta.rubriques, fournisseur: meta.fournisseur, maj: maj, csv: meta.csv, n: Object.keys(codes).length, codes: codes };
    if (TABLES_SANS_LIBELLE.indexOf(abr) >= 0) ds.tables[abr].libellesOmis = true;
  });
  // codes retirés des tables : on les garde avec leur date de fin, pour contrôler les mois passés
  function retirer(table, code, lib, deb, fin, version) {
    if (!code) return;
    ds.supprimes[table] = ds.supprimes[table] || {};
    ds.supprimes[table][code] = [lib || '', deb || '', fin || '', '', version || ''];
  }
  if (prec && prec.supprimes) Object.keys(prec.supprimes).forEach(function (t) { ds.supprimes[t] = Object.assign({}, prec.supprimes[t]); });
  (page.retraits || []).slice().sort(function (a, b) { return parseInt(a.version.slice(1), 10) - parseInt(b.version.slice(1), 10); })
    .forEach(function (r) { retirer(r.table, r.code, r.libelle, r.debut, r.fin, r.version); });
  (o.rln || []).forEach(function (l) { if (/suppression de code/i.test(l.typeCode)) retirer(l.table, l.code, l.libelle, l.debut, l.fin, ds.version); });
  Object.keys(ds.supprimes).forEach(function (t) {
    Object.keys(ds.supprimes[t]).forEach(function (c) { if (ds.tables[t] && ds.tables[t].codes[c]) delete ds.supprimes[t][c]; });
    if (!Object.keys(ds.supprimes[t]).length) delete ds.supprimes[t];
  });
  if (o.rln) ds.nouveautes = { version: ds.version, date: page.fichiers && page.fichiers.rln ? page.fichiers.rln.date : ds.datePublication, resume: resumerRln(o.rln), lignes: o.rln.length };
  else if (prec && prec.nouveautes && prec.version === ds.version) ds.nouveautes = prec.nouveautes;
  return ds;
}

/** Vérifie un jeu construit face à la page : tables présentes, non vides, datées, rattachées à des rubriques. */
function verifierJeu(ds, page, o) {
  o = o || {};
  const erreurs = [], avertissements = [];
  Object.keys(page.tables).forEach(function (abr) {
    const t = ds.tables[abr], p = page.tables[abr];
    if (!t) { erreurs.push('table ' + abr + ' absente'); return; }
    if (!t.n) erreurs.push('table ' + abr + ' vide');
    if (!t.maj) erreurs.push('table ' + abr + ' sans date de mise à jour (format de la page modifié ?)');
    if (!t.rubriques.length) erreurs.push('table ' + abr + ' rattachée à aucune rubrique (format de la page modifié ?)');
    const prec = o.precedent && o.precedent.tables[abr];
    if (prec && prec.rubriques.length > t.rubriques.length) avertissements.push('table ' + abr + ' : ' + (prec.rubriques.length - t.rubriques.length) + ' rubrique(s) en moins qu\'avant');
    if (o.datesCsv && o.datesCsv[abr] && p.maj && o.datesCsv[abr] !== p.maj) avertissements.push('table ' + abr + ' : le fichier est daté du ' + dateFR(o.datesCsv[abr]) + ', la page annonce le ' + dateFR(p.maj) + ' ; elle sera retéléchargée au prochain passage');
  });
  Object.keys(ds.tables).forEach(function (abr) {
    const codes = ds.tables[abr].codes;
    Object.keys(codes).forEach(function (c) {
      const e = codes[c];
      if ((e[1] && !/^\d{4}-\d{2}-\d{2}$/.test(e[1])) || (e[2] && !/^\d{4}-\d{2}-\d{2}$/.test(e[2]))) erreurs.push('table ' + abr + ', code ' + c + ' : date illisible');
    });
  });
  return { erreurs: erreurs.slice(0, 20), avertissements: avertissements };
}

function ecrireJeu(ds, fichier) {
  fs.mkdirSync(path.dirname(fichier), { recursive: true });
  const tmp = fichier + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, zlib.gzipSync(Buffer.from(JSON.stringify(ds)), { level: 9 }));
  fs.renameSync(tmp, fichier);
}
function lireJeu(fichier) {
  const ds = JSON.parse(zlib.gunzipSync(fs.readFileSync(fichier)).toString('utf8'));
  if (ds.format !== FORMAT || !ds.norme || !ds.tables) throw new Error('jeu de tables illisible : ' + fichier);
  return ds;
}

function dossierCache(dossierClient) { return dossierClient ? path.join(dossierClient, SOUS_DOSSIER) : null; }

/** Normes disponibles localement (embarquées dans le skill ou en cache dans le dossier du client). */
function normesDisponibles(dossierClient, dossierSkill) {
  const s = new Set();
  [dossierSkill || DOSSIER_SKILL, dossierCache(dossierClient)].forEach(function (d) {
    if (!d) return;
    try { fs.readdirSync(d).forEach(function (f) { const m = /^(P\d{2}V\d{2})\.json\.gz$/i.exec(f); if (m) s.add(m[1].toUpperCase()); }); } catch (e) { /* dossier absent */ }
  });
  return Array.from(s).sort();
}

/** Le plus récent de deux jeux : date de publication, puis date de construction. */
function plusRecent(a, b) {
  if (!a) return b; if (!b) return a;
  if (a.datePublication !== b.datePublication) return a.datePublication > b.datePublication ? a : b;
  return (a.construitLe || '') >= (b.construitLe || '') ? a : b;
}

/** Charge le jeu le plus récent d'une norme, entre celui du skill et celui du dossier du client. */
function charger(o) {
  o = o || {};
  const norme = String(o.norme || '').toUpperCase();
  let skill = null, client = null;
  const fs1 = path.join(o.dossierSkill || DOSSIER_SKILL, norme + '.json.gz');
  if (fs.existsSync(fs1)) { skill = lireJeu(fs1); skill.origine = 'version embarquée'; }
  const cache = dossierCache(o.dossier);
  if (cache) {
    const fc = path.join(cache, norme + '.json.gz');
    if (fs.existsSync(fc)) { try { client = lireJeu(fc); client.origine = 'cache local'; } catch (e) { /* cache abîmé : on l'ignore */ } }
  }
  return plusRecent(client, skill);
}

function lireEtat(dossierClient) {
  const d = dossierCache(dossierClient);
  if (!d) return {};
  try { return JSON.parse(fs.readFileSync(path.join(d, 'etat.json'), 'utf8')); } catch (e) { return {}; }
}
function ecrireEtat(dossierClient, etat) {
  const d = dossierCache(dossierClient);
  if (!d) return;
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'etat.json'), JSON.stringify(etat, null, 2));
}

/* ------------------------------------------------------------------ contrôle d'une DSN */

let LIBELLES = {};
try { LIBELLES = require('./rub.json'); } catch (e) { /* libellés facultatifs */ }
function libelle(c) { return LIBELLES[c] ? ' (' + LIBELLES[c] + ')' : ''; }

function indexRubriques(ds) {
  if (ds._index) return ds._index;
  const idx = {};
  Object.keys(ds.tables).forEach(function (abr) {
    ds.tables[abr].rubriques.forEach(function (r) { (idx[r] = idx[r] || []).push(abr); });
  });
  Object.defineProperty(ds, '_index', { value: idx, enumerable: false });
  return idx;
}

function valideAu(e, deb, fin) { return (!e[1] || !fin || e[1] <= fin) && (!e[2] || !deb || e[2] >= deb); }
function periode(e) { return (e[1] ? 'du ' + dateFR(e[1]) : 'depuis toujours') + (e[2] ? ' au ' + dateFR(e[2]) : ', sans date de fin'); }
function nombre(s) { const n = parseFloat(String(s).replace(',', '.')); return isFinite(n) ? n : NaN; }
function moisAnnee(iso) { return iso ? iso.slice(5, 7) + '/' + iso.slice(0, 4) : ''; }

/**
 * Période sur laquelle un code doit être valide, selon le bloc :
 *  - S21.G00.13 (déclaration annuelle OETH, en avril pour l'année précédente) : de janvier N-1 à la fin du mois ;
 *  - S21.G00.41 (changement de contrat : anciennes valeurs) : existence du code seulement ;
 *  - sinon : le mois principal déclaré.
 */
function fenetre(rubrique, an, deb, fin) {
  if (rubrique.indexOf('S21.G00.13.') === 0 && an) return { deb: (an - 1) + '-01-01', fin: fin, libelle: 'l\'année ' + (an - 1) + ' ou ' + moisAnnee(deb) };
  if (rubrique.indexOf('S21.G00.41.') === 0) return { deb: '', fin: '', libelle: '' };
  return { deb: deb, fin: fin, libelle: moisAnnee(deb) };
}

/** Contrôle du taux non personnalisé du prélèvement à la source (table BAR) pour un bloc Versement S21.G00.50. */
function controlerBareme(ds, bloc, anMois, sortie) {
  const taux = bloc['006'], type = bloc['007'];
  if (taux === undefined || !type || type === '01') return; // 01 : taux personnalisé transmis par la DGFiP
  const bar = ds.tables.BAR;
  if (!bar) return;
  const dv = /^(\d{2})(\d{2})(\d{4})$/.exec(bloc['001'] || '');
  let an = dv ? +dv[3] : anMois; // barème de l'année du versement
  // la grille 2026 n'est entrée en vigueur que le 1er mai 2026 : de janvier à avril 2026, grille 2025
  if (an === 2026 && dv && +dv[2] < 5) an = 2025;
  const prefixe = an + '/' + type + '/';
  const grille = Object.keys(bar.codes).filter(function (c) { return c.indexOf(prefixe) === 0; }).map(function (c) {
    const p = c.split('/');
    return { min: nombre(p[3]), max: nombre(p[4]), taux: nombre(bar.codes[c][0]) };
  });
  if (!grille.length) { sortie.push({ lvl: 'warn', title: 'Barème du prélèvement à la source ' + an + ' (type ' + type + ') absent de la table BAR', detail: 'Taux ' + taux + ' non vérifié.', ref: 'Table BAR' }); return; }
  const t = nombre(taux);
  if (!grille.some(function (g) { return g.taux === t; })) {
    sortie.push({ lvl: 'err', title: 'S21.G00.50.006 = ' + taux + ' : taux absent du barème ' + an + ' (type ' + type + ')', detail: 'Taux possibles : ' + Array.from(new Set(grille.map(function (g) { return g.taux; }))).join(' · '), ref: 'Table BAR' });
    return;
  }
  const base = nombre(bloc['013'] !== undefined ? bloc['013'] : bloc['002']);
  if (isFinite(base)) {
    const tr = grille.find(function (g) { return base >= g.min && base <= g.max; });
    if (tr && tr.taux !== t) { sortie.push({ lvl: 'warn', title: 'S21.G00.50.006 = ' + taux + ' : le barème ' + an + ' donne ' + tr.taux + ' % pour une base de ' + base.toFixed(2) + ' €', detail: 'Tranche ' + tr.min.toFixed(2) + ' € – ' + tr.max.toFixed(2) + ' €.', ref: 'Table BAR' }); return; }
  }
  sortie.push({ lvl: 'ok', title: 'Taux de prélèvement à la source ' + taux + ' conforme au barème ' + an + ' (table BAR)', detail: '', ref: 'Table BAR' });
}

/**
 * Crée un contrôleur. o.dossier : dossier du client (cache des tables) ; o.maintenant : date du jour (tests) ;
 * o.jeux : jeux fournis directement (tests) ; o.etat : état fourni directement (tests).
 * controler(lignes) prend les lignes { c, v } du moteur et renvoie des contrôles { lvl, title, detail, ref }.
 */
function controleur(o) {
  o = o || {};
  const jeux = {};
  function jeu(norme) {
    if (!(norme in jeux)) { try { jeux[norme] = o.jeux && o.jeux[norme] ? o.jeux[norme] : charger({ dossier: o.dossier, norme: norme, dossierSkill: o.dossierSkill }); } catch (e) { jeux[norme] = null; } }
    return jeux[norme];
  }
  function controler(lignes) {
    const out = [];
    const one = function (c) { const l = lignes.find(function (x) { return x.c === c; }); return l ? l.v : null; };
    const norme = (one('S10.G00.00.006') || '').toUpperCase();
    const ds = norme ? jeu(norme) : null;
    if (!ds) {
      out.push({ lvl: 'warn', title: 'Tables de référence ' + (norme || '(norme absente)') + ' indisponibles : codes non vérifiés', detail: 'Lancez la mise à jour des tables (outil mettre_a_jour_tables) pour les récupérer sur net-entreprises.fr.', ref: '' });
      return out;
    }
    const m = /^(\d{2})(\d{2})(\d{4})$/.exec(one('S20.G00.05.005') || '');
    const an = m ? +m[3] : null, mois = m ? +m[2] : null;
    const deb = m ? m[3] + '-' + m[2] + '-01' : '', fin = m ? finDeMois(an, mois) : '';
    const idx = indexRubriques(ds);
    let verifies = 0, problemes = 0;
    const blocs50 = [];
    lignes.forEach(function (l) {
      if (l.c.indexOf('S21.G00.50.') === 0) {
        if (l.c === 'S21.G00.50.001' || !blocs50.length) blocs50.push({});
        blocs50[blocs50.length - 1][l.c.slice(11)] = l.v;
      }
      const tabs = idx[l.c];
      if (!tabs || l.v === '' || l.v === 'A RENSEIGNER') return;
      if (tabs.indexOf('BAR') >= 0) return; // contrôlé bloc par bloc ci-dessous
      verifies++;
      const w = fenetre(l.c, an, deb, fin);
      const trouves = [];
      tabs.forEach(function (abr) {
        const t = ds.tables[abr];
        if (t && t.codes[l.v]) trouves.push({ abr: abr, e: t.codes[l.v], supprime: false });
        else if (ds.supprimes[abr] && ds.supprimes[abr][l.v]) trouves.push({ abr: abr, e: ds.supprimes[abr][l.v], supprime: true });
      });
      const noms = tabs.map(function (a) { return a + (ds.tables[a] ? ' (' + ds.tables[a].nom + ')' : ''); }).join(', ');
      const bon = trouves.find(function (x) { return valideAu(x.e, w.deb, w.fin); });
      if (bon) {
        // valeur d'échappement : signalée, sauf 999ZZ (code risque AT) que le moteur explique déjà en détail
        if (/[ée]chappement/i.test(bon.e[0]) && bon.abr !== 'RAT') {
          problemes++;
          out.push({ lvl: 'warn', title: l.c + libelle(l.c) + ' = ' + l.v + ' : valeur d\'échappement de la table ' + bon.abr, detail: 'Acceptée par net-entreprises, elle signale une information manquante : remplacez-la dès que le vrai code est connu.', ref: 'Table ' + bon.abr + ' ' + ds.norme });
        }
        return;
      }
      problemes++;
      if (trouves.length) {
        const x = trouves[0];
        out.push({ lvl: 'err', title: l.c + libelle(l.c) + ' = ' + l.v + ' : code hors de sa période de validité pour ' + (w.libelle || 'ce mois'), detail: 'Table ' + x.abr + ' : ' + (x.e[0] ? x.e[0] + ', ' : '') + 'valide ' + periode(x.e) + (x.supprime ? ' (code retiré de la table en ' + (x.e[4] || 'dernière version') + ')' : '') + '.', ref: 'Table ' + x.abr + ' ' + ds.norme });
        return;
      }
      const proche = tabs.map(function (a) { return ds.tables[a] ? Object.keys(ds.tables[a].codes).find(function (k) { return k.toLowerCase() === l.v.toLowerCase(); }) : null; }).filter(Boolean)[0];
      if (proche) { out.push({ lvl: 'warn', title: l.c + libelle(l.c) + ' = ' + l.v + ' : la table connaît « ' + proche + ' » (majuscules et minuscules différentes)', detail: 'Reprenez le code exactement comme dans la table ' + noms + '.', ref: ds.norme }); return; }
      // code absent : s'il s'agit d'un mois antérieur à la dernière mise à jour d'une des tables, il a pu être retiré depuis
      const majTables = tabs.map(function (a) { return ds.tables[a] ? ds.tables[a].maj : ''; }).filter(Boolean).sort().pop() || '';
      if (fin && majTables && fin < majTables) out.push({ lvl: 'warn', title: l.c + libelle(l.c) + ' = ' + l.v + ' : absent des tables actuelles', detail: 'Le code a pu être retiré après ' + moisAnnee(deb) + ' (table mise à jour le ' + dateFR(majTables) + '). Vérifiez-le dans ' + noms + '.', ref: ds.norme });
      else out.push({ lvl: 'err', title: l.c + libelle(l.c) + ' = ' + l.v + ' : code inconnu des tables officielles', detail: 'Tables consultées : ' + noms + ' — ' + ds.norme + ' ' + ds.version + ' du ' + dateFR(ds.datePublication) + '.', ref: ds.norme });
    });
    if (an) blocs50.forEach(function (b) { const avant = out.length; controlerBareme(ds, b, an, out); if (out.length > avant && out[out.length - 1].lvl !== 'ok') problemes++; });
    out.unshift({ lvl: problemes ? 'info' : 'ok', title: verifies + ' rubrique(s) codée(s) vérifiée(s) dans les tables officielles ' + ds.norme + ' ' + ds.version + ' du ' + dateFR(ds.datePublication), detail: 'Tables ' + (ds.origine === 'cache local' ? 'mises à jour depuis net-entreprises.fr' : 'embarquées dans l\'extension') + '.', ref: ds.page });
    // fraîcheur : version plus récente vue sur net-entreprises mais pas appliquée, ou vérification trop ancienne
    const etat = o.etat || lireEtat(o.dossier);
    const vue = etat.normes && etat.normes[ds.norme];
    if (vue && vue.date && vue.date > ds.datePublication) out.push({ lvl: 'warn', title: 'Tables ' + ds.norme + ' plus récentes publiées (' + (vue.version || '') + ' du ' + dateFR(vue.date) + ') mais pas encore appliquées', detail: 'Contrôle fait avec la version ' + ds.version + ' du ' + dateFR(ds.datePublication) + '. DSNap les appliquera à la prochaine préparation (ou outil mettre_a_jour_tables).', ref: ds.page });
    const derniere = etat.derniereVerification || ds.construitLe;
    const jours = derniere ? Math.floor(((o.maintenant || new Date()) - new Date(derniere)) / 86400000) : null;
    if (jours === null || jours > JOURS_AVANT_ALERTE) out.push({ lvl: 'warn', title: 'Tables de référence vérifiées sur net-entreprises il y a ' + (jours === null ? '?' : jours) + ' jours', detail: 'Mettez-les à jour (outil mettre_a_jour_tables) : les tables sont publiées environ une fois par mois.', ref: '' });
    return out;
  }
  return { controler: controler, jeu: jeu };
}

/* ------------------------------------------------------------------ transports */

function horsLigne(msg) { const e = new Error(msg); e.horsLigne = true; return e; }

/**
 * Transport réseau : fetch de Node, puis curl si fetch n'aboutit pas (proxy, certificat…).
 * 404 → null ; 429 et 5xx (maintenance) ou réseau coupé → erreur « hors ligne ».
 */
function transportReseau() {
  // curl du système (chemin absolu sous Windows : pas de binaire pris dans le dossier courant), sans bloquer le serveur
  function binCurl() {
    if (process.platform !== 'win32') return 'curl';
    const p = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'curl.exe');
    return fs.existsSync(p) ? p : null;
  }
  function parCurl(url, delai) {
    return new Promise(function (resolve, reject) {
      const bin = binCurl();
      if (!bin) { reject(new Error('curl absent')); return; }
      const tmp = path.join(os.tmpdir(), 'dsnap-' + process.pid + '-' + Date.now() + '.dl');
      execFile(bin, ['-sS', '-L', '--max-time', String(Math.ceil(delai / 1000)), '-A', UA, '-o', tmp, '-w', '%{http_code}', url], { encoding: 'utf8', windowsHide: true, timeout: delai + 5000 }, function (err, stdout) {
        const code = String(stdout || '').trim();
        const fin = function (f) { try { f(); } finally { try { fs.unlinkSync(tmp); } catch (e) { /* rien */ } } };
        if (err && !code) { fin(function () { reject(err); }); return; }
        fin(function () {
          if (code === '404') return resolve(null);
          if (code === '429' || /^5\d\d$/.test(code)) return reject(horsLigne('net-entreprises indisponible (HTTP ' + code + ')'));
          if (!/^2\d\d$/.test(code)) return reject(new Error('HTTP ' + code + ' pour ' + url));
          resolve(fs.readFileSync(tmp));
        });
      });
    });
  }
  return {
    nom: 'réseau',
    get: async function (url, opt) {
      const delai = (opt && opt.delai) || DELAI_FICHIER;
      let r;
      try { r = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow', signal: AbortSignal.timeout(delai) }); }
      catch (e) {
        try { return await parCurl(url, delai); }
        catch (e2) { if (e2.horsLigne) throw e2; throw horsLigne('net-entreprises injoignable (' + (e.cause && e.cause.code || e.name || e.message) + ' ; curl : ' + String(e2.message).split('\n')[0] + ')'); }
      }
      if (r.status === 404) return null;
      if (r.status === 429 || r.status >= 500) throw horsLigne('net-entreprises indisponible (HTTP ' + r.status + ')');
      if (!r.ok) throw new Error('HTTP ' + r.status + ' pour ' + url);
      return Buffer.from(await r.arrayBuffer());
    }
  };
}

/**
 * Transport « fichiers » : sert les fichiers déposés dans un dossier (téléchargés à la main), reconnus par la fin
 * de leur nom. Pour la page d'une norme : page-P26V01.html, ou tout fichier .html qui en contient les tables.
 */
function transportFichiers(dossier) {
  const noms = fs.readdirSync(dossier);
  function trouver(url) {
    const base = decodeURIComponent(url.split('?')[0].replace(/\/+$/, '').split('/').pop());
    const court = base.replace(/^NEODESP\d{2}_P\d{2}V\d{2}_/, '');
    const cands = [base, court];
    const pg = /nomenclatures-dsn-(p\d{2}v\d{2})/i.exec(url);
    if (pg) cands.push('page-' + pg[1].toUpperCase() + '.html', 'nomenclatures-dsn-' + pg[1].toLowerCase() + '.html');
    if (/\/feed\/?$/.test(url)) cands.push('feed.xml');
    for (const c of cands) { const f = noms.find(function (n) { return n === c || n.endsWith('-' + c) || n.endsWith('_' + c); }); if (f) return path.join(dossier, f); }
    if (pg) {
      for (const n of noms.filter(function (x) { return /\.html?$/i.test(x); })) {
        const p = path.join(dossier, n);
        try { if (lirePage(fs.readFileSync(p), pg[1].toUpperCase())) return p; } catch (e) { /* fichier illisible */ }
      }
    }
    return null;
  }
  return { nom: 'fichiers', get: async function (url) { const f = trouver(url); return f ? fs.readFileSync(f) : null; }, trouver: trouver };
}

/* ------------------------------------------------------------------ flux RSS (actualités) */

function lireRss(xml) {
  xml = decoder(xml);
  return (xml.match(/<item>[\s\S]*?<\/item>/gi) || []).map(function (it) {
    const t = function (b) { const m = new RegExp('<' + b + '>([\\s\\S]*?)</' + b + '>', 'i').exec(it); return m ? entites(m[1].replace(/^<!\[CDATA\[|\]\]>$/g, '')).replace(/\s+/g, ' ').trim() : ''; };
    const cats = (it.match(/<category>[\s\S]*?<\/category>/gi) || []).map(function (c) { return entites(c.replace(/<\/?category>|<!\[CDATA\[|\]\]>/gi, '')).trim(); });
    const d = new Date(t('pubDate'));
    return { titre: t('title'), lien: t('link'), date: isNaN(d) ? '' : d.toISOString().slice(0, 10), categories: cats };
  });
}
function filtrerActualites(items, depuisISO) {
  return items.filter(function (i) {
    // la catégorie « DSN » du site couvre aussi salons et partenariats : on retient les nomenclatures et les normes
    const pertinent = i.categories.some(function (c) { return /^(Nomenclatures?|Normes?( DSN)?|Cahier technique)$/i.test(c); }) || /nomenclature|norme|cahier technique|tables? de r[ée]f[ée]rence|P\d{2}V\d{2}/i.test(i.titre);
    return pertinent && (!depuisISO || !i.date || i.date >= depuisISO.slice(0, 10));
  }).slice(0, 10);
}

/* ------------------------------------------------------------------ mise à jour */

function suivantes(norme) {
  const m = /^P(\d{2})V(\d{2})$/.exec(norme);
  if (!m) return [];
  return ['P' + String(+m[1] + 1).padStart(2, '0') + 'V01', 'P' + m[1] + 'V' + String(+m[2] + 1).padStart(2, '0')];
}

async function pageDistante(norme, transport) {
  const buf = await transport.get(urlPage(norme), { delai: DELAI_PAGE });
  return buf ? lirePage(buf, norme) : null;
}

function comparer(local, page) {
  const r = { modifiees: [], ajoutees: [], retirees: [], meta: false, version: false, aJour: true };
  if (!local) { r.ajoutees = Object.keys(page.tables).sort(); r.aJour = false; return r; }
  Object.keys(page.tables).sort().forEach(function (abr) {
    const l = local.tables[abr], p = page.tables[abr];
    if (!l) r.ajoutees.push(abr);
    else if (p.maj && l.maj !== p.maj) r.modifiees.push(abr);
    else if (l.rubriques.join() !== p.rubriques.join() || l.nom !== p.nom) r.meta = true;
  });
  Object.keys(local.tables).forEach(function (abr) { if (!page.tables[abr]) r.retirees.push(abr); });
  r.version = local.datePublication !== page.datePublication || !!(page.version && local.version !== page.version);
  r.aJour = !r.modifiees.length && !r.ajoutees.length && !r.retirees.length && !r.meta && !r.version;
  return r;
}

function resume(ds) { return ds ? { version: ds.version, date: ds.datePublication, origine: ds.origine || '', tables: Object.keys(ds.tables).length } : null; }

/** Télécharge ce qui a changé et construit le nouveau jeu. */
async function telechargerEtConstruire(page, local, diff, transport, o) {
  o = o || {};
  const aCharger = diff.ajoutees.concat(diff.modifiees);
  const donnees = {}, datesCsv = {}, avertissements = [];
  // nouvelle version publiée sans table visiblement modifiée : on ne réétiquette pas l'ancien contenu, on prend le fichier complet
  const parCumul = !local || o.forcer || aCharger.length > 8 || (!aCharger.length && diff.version) || !aCharger.every(function (a) { return page.tables[a].csv; });
  if (parCumul) {
    if (!page.fichiers.cumul) throw new Error('lien du fichier regroupant toutes les tables introuvable sur la page');
    const buf = await transport.get(page.fichiers.cumul.url);
    if (!buf) throw new Error('fichier regroupant toutes les tables introuvable : ' + page.fichiers.cumul.url);
    const cumul = lireCumul(buf);
    if (page.fichiers.cumul.date && cumul.date !== page.fichiers.cumul.date) throw new Error('le fichier téléchargé est daté du ' + dateFR(cumul.date) + ', la page annonce le ' + dateFR(page.fichiers.cumul.date));
    Object.keys(cumul.tables).forEach(function (a) { donnees[a] = { date: '', codes: cumul.tables[a].codes }; });
  } else {
    for (const abr of aCharger) {
      const buf = await transport.get(page.tables[abr].csv);
      if (!buf) throw new Error('table ' + abr + ' introuvable : ' + page.tables[abr].csv);
      const t = lireCsvTable(buf);
      donnees[abr] = t; datesCsv[abr] = t.date;
    }
  }
  let rln = null;
  if (page.fichiers.rln) {
    try {
      const b = await transport.get(page.fichiers.rln.url);
      if (b) rln = lireRln(b); else avertissements.push('release note introuvable : codes retirés repris de l\'historique de la page seulement');
    } catch (e) { if (e.horsLigne) throw e; avertissements.push('release note illisible (' + e.message + ') : codes retirés repris de l\'historique de la page seulement'); }
  }
  const ds = construire({ page: page, donnees: donnees, complet: parCumul, precedent: local, rln: rln, source: transport.nom === 'fichiers' ? 'fichiers déposés' : 'net-entreprises.fr', maintenant: o.maintenant });
  const v = verifierJeu(ds, page, { datesCsv: datesCsv, precedent: local });
  if (v.erreurs.length) throw new Error('jeu de tables incohérent : ' + v.erreurs.join(' · '));
  return { ds: ds, avertissements: avertissements.concat(v.avertissements), mode: parCumul ? 'fichier complet' : 'tables modifiées (' + aCharger.join(', ') + ')' };
}

/**
 * Vérifie et applique les mises à jour.
 *  o.dossier   : dossier du client (cache nomenclatures/ et etat.json)
 *  o.sortie    : dossier où écrire les jeux (par défaut <dossier>/nomenclatures)
 *  o.verifier  : true → ne rien télécharger, seulement comparer
 *  o.forcer    : true → tout retélécharger
 *  o.normes    : normes à suivre en plus de celles déjà connues
 *  o.transport : transportReseau() ou transportFichiers(dossier)
 *  o.rss, o.sonde : lire le flux RSS, chercher une norme plus récente (par défaut oui)
 * Dès que net-entreprises est injoignable, les appels réseau suivants sont abandonnés.
 */
async function mettreAJour(o) {
  o = Object.assign({ rss: true, sonde: true }, o || {});
  const transport = o.transport || transportReseau();
  const maintenant = o.maintenant || new Date();
  const sortie = o.sortie || dossierCache(o.dossier);
  const etat = lireEtat(o.dossier);
  const rapport = { statut: 'a_jour', verifieLe: maintenant.toISOString(), transport: transport.nom, normes: [], nouvellesNormes: [], actualites: [], avertissements: [] };
  const connues = new Set(normesDisponibles(o.dossier, o.dossierSkill).concat((o.normes || []).map(function (n) { return n.toUpperCase(); })));
  if (!connues.size) connues.add('P26V01');
  let coupe = null; // message de la première erreur « hors ligne »
  const pages = {};
  const vues = {};

  if (o.sonde) {
    for (const n of Array.from(connues)) {
      for (const s of suivantes(n)) {
        if (connues.has(s) || coupe) continue;
        try { const p = await pageDistante(s, transport); if (p) { connues.add(s); pages[s] = p; rapport.nouvellesNormes.push({ norme: s, version: p.version, date: p.datePublication, page: p.page }); } }
        catch (e) { if (e.horsLigne) coupe = e.message; else rapport.avertissements.push('sonde ' + s + ' : ' + e.message); }
      }
    }
  }

  for (const n of Array.from(connues).sort()) {
    const local = charger({ dossier: o.dossier, norme: n, dossierSkill: o.dossierSkill });
    const entree = { norme: n, local: resume(local) };
    rapport.normes.push(entree);
    if (coupe) { entree.erreur = 'non vérifiée : ' + coupe; entree.horsLigne = true; continue; }
    let page = pages[n];
    if (!page) {
      try { page = await pageDistante(n, transport); }
      catch (e) { if (e.horsLigne) { coupe = e.message; entree.erreur = e.message; entree.horsLigne = true; continue; } entree.action = 'echec'; entree.erreur = e.message; continue; }
    }
    if (!page) { entree.action = 'echec'; entree.erreur = 'page de la norme introuvable ou illisible sur net-entreprises (' + urlPage(n) + ')'; continue; }
    const diff = comparer(local, page);
    entree.distant = { version: page.version, date: page.datePublication };
    vues[n] = entree.distant;
    entree.tablesModifiees = diff.modifiees; entree.tablesAjoutees = diff.ajoutees; entree.tablesRetirees = diff.retirees;
    if (diff.aJour && !o.forcer) { entree.action = 'aucune'; continue; }
    if (o.verifier) { entree.action = 'mise_a_jour_disponible'; continue; }
    try {
      const res = await telechargerEtConstruire(page, local, diff, transport, { forcer: o.forcer, maintenant: maintenant });
      if (!sortie) throw new Error('aucun dossier où enregistrer les tables (option --dossier ou --sortie)');
      ecrireJeu(res.ds, path.join(sortie, n + '.json.gz'));
      entree.action = 'mis_a_jour'; entree.mode = res.mode;
      entree.nouveautes = res.ds.nouveautes ? res.ds.nouveautes.resume : null;
      entree.codesRetiresConserves = Object.keys(res.ds.supprimes).reduce(function (s, t) { return s + Object.keys(res.ds.supprimes[t]).length; }, 0);
      if (res.avertissements.length) entree.avertissements = res.avertissements;
    } catch (e) {
      if (e.horsLigne) { coupe = e.message; entree.erreur = e.message; entree.horsLigne = true; }
      else { entree.action = 'echec'; entree.erreur = e.message; }
    }
  }

  if (o.rss && !coupe) {
    try {
      const b = await transport.get(FLUX_RSS, { delai: DELAI_PAGE });
      if (b) {
        const depuis = etat.derniereVerification ? etat.derniereVerification : new Date(maintenant - 45 * 86400000).toISOString();
        rapport.actualites = filtrerActualites(lireRss(b), depuis);
      }
    } catch (e) { rapport.avertissements.push('flux RSS : ' + e.message); }
  }

  const actions = rapport.normes.map(function (x) { return x.action; });
  if (actions.indexOf('echec') >= 0) rapport.statut = 'echec';
  else if (rapport.normes.some(function (x) { return x.horsLigne; })) rapport.statut = 'hors_ligne';
  else if (actions.indexOf('mis_a_jour') >= 0) rapport.statut = 'mis_a_jour';
  else if (actions.indexOf('mise_a_jour_disponible') >= 0) rapport.statut = 'mise_a_jour_disponible';

  if (o.dossier && transport.nom === 'réseau') {
    // les versions vues sur le site sont toujours notées (le contrôle signale une version publiée non appliquée) ;
    // la date de vérification n'avance que si les tables locales sont effectivement à jour
    etat.normes = Object.assign({}, etat.normes || {}, vues);
    if (rapport.statut === 'a_jour' || rapport.statut === 'mis_a_jour') { etat.derniereVerification = rapport.verifieLe; etat.resultat = rapport.statut; }
    else etat.dernierEchec = { le: rapport.verifieLe, statut: rapport.statut };
    if (Object.keys(vues).length || rapport.statut === 'a_jour' || rapport.statut === 'mis_a_jour') ecrireEtat(o.dossier, etat);
  }
  return rapport;
}

/**
 * Hors ligne : reconstruit la page d'une norme à partir de fichiers téléchargés à la main (cumul, et si possible
 * release note et page HTML). Sans la page, les noms et rubriques des tables viennent de la version précédente.
 */
function pageDepuisFichiers(norme, transport, precedent) {
  return (async function () {
    const html = await transport.get(urlPage(norme));
    if (html) { const p = lirePage(html, norme); if (p) return p; }
    if (!precedent) throw new Error('page ' + norme + ' absente : déposez aussi la page enregistrée depuis le navigateur, ou partez d\'une version déjà installée');
    const court = 'NEODESP' + norme.slice(1, 3);
    const p = {
      norme: norme, page: urlPage(norme), version: '', historique: [], tables: {}, retraits: [],
      fichiers: {
        cumul: { url: 'https://portail.net-entreprises.fr/nmcl/telechargeFichierGenere/' + court + '_' + norme + '_' + court + '_CUMUL_' + norme + '.csv', date: '' },
        rln: { url: 'https://portail.net-entreprises.fr/nmcl/telechargeFichierGenere/' + court + '_' + norme + '_' + court + '_RLN_' + norme + '.csv', date: '' }
      }
    };
    Object.keys(precedent.tables).forEach(function (a) { const t = precedent.tables[a]; p.tables[a] = { nom: t.nom, rubriques: t.rubriques, fournisseur: t.fournisseur, maj: '', csv: t.csv }; });
    const cb = await transport.get(p.fichiers.cumul.url);
    if (!cb) throw new Error('fichier ' + court + '_CUMUL_' + norme + '.csv absent du dossier');
    const cumul = lireCumul(cb);
    p.datePublication = cumul.date; p.fichiers.cumul.date = cumul.date;
    Object.keys(p.tables).forEach(function (a) { p.tables[a].maj = cumul.date; });
    Object.keys(cumul.tables).forEach(function (a) { if (!p.tables[a]) p.tables[a] = { nom: a, rubriques: [], fournisseur: '', maj: cumul.date, csv: '' }; });
    return p;
  })();
}

module.exports = {
  FORMAT, DOSSIER_SKILL, SOUS_DOSSIER, FLUX_RSS, urlPage, suivantes,
  decoder, dateISO, dateFR, texte, entites,
  lirePage, lireRetraits, lireCsvTable, lireCumul, lireRln, resumerRln, lireRss, filtrerActualites,
  construire, verifierJeu, ecrireJeu, lireJeu, charger, normesDisponibles, plusRecent, lireEtat, ecrireEtat, dossierCache,
  controleur, comparer, telechargerEtConstruire, mettreAJour, pageDepuisFichiers,
  transportReseau, transportFichiers
};
