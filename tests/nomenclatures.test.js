'use strict';
/*
 * Tests des tables de référence DSN, de leur mise à jour et du contrôle des codes.
 *   node --test tests/*.test.js
 * Hors ligne : la page, les CSV et le flux RSS sont des extraits réels enregistrés dans fixtures/.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const NM = require('../server/lib/nomenclatures.js');
global.RUB_LABELS = require('../server/lib/rub.json');
const E = require('../server/lib/engine.js');

const FX = path.join(__dirname, 'fixtures');
const lire = function (f) { return fs.readFileSync(path.join(FX, f)); };
const PAGE = lire('page-P26V01.html');
const URL_CUMUL = 'https://portail.net-entreprises.fr/nmcl/telechargeFichierGenere/NEODESP26_P26V01_NEODESP26_CUMUL_P26V01.csv';
const URL_RLN = 'https://portail.net-entreprises.fr/nmcl/telechargeFichierGenere/NEODESP26_P26V01_NEODESP26_RLN_P26V01.csv';
const csvUrl = function (t) { return 'https://portail.net-entreprises.fr/nmcl/telechargeFichierCsv/NEODESP26-' + t + '-P26V01.csv'; };

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nmcl-')); }

/** Transport simulé : sert des contenus par URL et note les URL demandées. */
function transportSimule(contenus, o) {
  o = o || {};
  const demandes = [];
  return {
    nom: o.nom || 'réseau', demandes: demandes,
    get: async function (url) {
      demandes.push(url);
      if (o.horsLigne) { const e = new Error('net-entreprises injoignable (simulation)'); e.horsLigne = true; throw e; }
      const c = contenus[url];
      return c === undefined ? null : Buffer.isBuffer(c) ? c : Buffer.from(c, 'latin1');
    }
  };
}
function contenusDeBase(page) {
  const c = {};
  c[NM.urlPage('P26V01')] = page || PAGE;
  c[URL_CUMUL] = lire('NEODESP26_CUMUL_P26V01.csv');
  c[URL_RLN] = lire('NEODESP26_RLN_P26V01.csv');
  ['RAT', 'MUT', 'IVO', 'NNE', 'HEX'].forEach(function (t) { c[csvUrl(t)] = lire('NEODESP26-' + t + '-P26V01.csv'); });
  c[NM.FLUX_RSS] = lire('feed.xml');
  return c;
}
/** Page « plus récente » : la table RAT republiée le 22/10/2026 et une version v14. */
function pagePlusRecente() {
  return Buffer.from(PAGE.toString('utf8')
    .replace(/(NEODESP26-RAT-P26V01\.csv[\s\S]*?<td[^>]*class="back">)24\/02\/2026/, '$122/10/2026')
    .replace(/\(24\/09\/2026\)/g, '(22/10/2026)')
    .replace('Version P26V01 v13 du 24/09/2026', 'Version P26V01 v14 du 22/10/2026 :</div><div class="release_note_version_nom">Version P26V01 v13 du 24/09/2026'), 'utf8');
}
const RAT_V14 = Buffer.from('code;libellé;date de début de validité;date de fin de validité;22/10/2026\r\n011AA;Cultures et élevage dans les départements d\'outre-mer.;01/01/2014;\r\n999ZZ;Valeur d\'échappement;01/01/2014;\r\n726ZA;Activités informatiques (nouveau libellé);01/01/2014;\r\n852AB;Code ajouté en octobre;01/11/2026;\r\n', 'latin1');
const CUMUL_V14 = Buffer.from(lire('NEODESP26_CUMUL_P26V01.csv').toString('latin1').replace(/^24\/09\/2026/, '22/10/2026'), 'latin1');

/* ------------------------------------------------------------------ lecture de la page */

test('page : tables, rubriques, dates, liens et historique', function () {
  const p = NM.lirePage(PAGE, 'P26V01');
  assert.equal(p.norme, 'P26V01');
  assert.equal(p.version, 'v13');
  assert.equal(p.datePublication, '2026-09-24');
  assert.deepEqual(Object.keys(p.tables).sort(), ['BAR', 'EFE', 'HEX', 'IDCC', 'IVO', 'MUT', 'NAF', 'NNE', 'PCSESE', 'RAT']);
  assert.deepEqual(p.tables.RAT.rubriques, ['S21.G00.40.040', 'S21.G00.41.024']);
  assert.equal(p.tables.RAT.nom, 'Codes risque ATMP');
  assert.equal(p.tables.RAT.maj, '2026-02-24');
  assert.equal(p.tables.RAT.fournisseur, 'GIP-MDS');
  assert.equal(p.tables.RAT.csv, csvUrl('RAT'));
  assert.ok(p.tables.HEX.rubriques.indexOf('S21.G00.06.005') >= 0, 'le code postal de l\'entreprise est contrôlé par HEX');
  assert.equal(p.fichiers.cumul.url, URL_CUMUL);
  assert.equal(p.fichiers.cumul.date, '2026-09-24');
  assert.equal(p.fichiers.rln.url, URL_RLN);
  assert.ok(p.fichiers.index && p.fichiers.zip && p.fichiers.trigrammes);
  assert.equal(p.historique[0].version, 'v13');
  assert.ok(p.historique.length >= 2 && p.historique[1].version === 'v12');
});

test('page : une autre norme ou une page sans tables est refusée', function () {
  assert.equal(NM.lirePage(PAGE, 'P27V01'), null);
  assert.equal(NM.lirePage('<html><title>Tables de référence de la norme DSN – P24V01</title><body>404</body></html>', 'P99V99'), null);
});

test('normes suivantes à sonder', function () {
  assert.deepEqual(NM.suivantes('P26V01'), ['P27V01', 'P26V02']);
  assert.deepEqual(NM.suivantes('P09V09'), ['P10V01', 'P09V10']);
});

/* ------------------------------------------------------------------ fichiers CSV */

test('table seule : en-tête daté, accents ISO-8859-1, dates de validité', function () {
  const t = NM.lireCsvTable(lire('NEODESP26-RAT-P26V01.csv'));
  assert.equal(t.date, '2026-02-24');
  assert.deepEqual(t.codes['011AA'], ['Cultures et élevage dans les départements d\'outre-mer.', '2014-01-01', '', '']);
  assert.equal(t.codes['999ZZ'][0], 'Valeur d\'échappement');
});

test('table seule : trigramme, table sans dates, table sans libellé', function () {
  const ivo = NM.lireCsvTable(lire('NEODESP26-IVO-P26V01.csv'));
  assert.deepEqual(ivo.codes['53514650000017'], ['Urssaf Midi-Pyrénées', '1900-01-01', '', 'URS']);
  const nne = NM.lireCsvTable(lire('NEODESP26-NNE-P26V01.csv'));
  assert.equal(nne.codes['1886040000'][0], 'AVIATEUR');
  const hex = NM.lireCsvTable(lire('NEODESP26-HEX-P26V01.csv'));
  assert.ok(hex.codes['31400']);
  assert.equal(hex.date, '2025-09-25');
});

test('table seule : libellé contenant un point-virgule', function () {
  const t = NM.lireCsvTable(Buffer.from('code;libellé;date de début de validité;date de fin de validité;01/01/2026\r\nX1;Un libellé; avec point-virgule;01/01/2020;31/12/2025\r\n', 'latin1'));
  assert.deepEqual(t.codes.X1, ['Un libellé; avec point-virgule', '2020-01-01', '2025-12-31', '']);
});

test('fichier cumul : toutes les tables, date dans la première cellule', function () {
  const c = NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv'));
  assert.equal(c.date, '2026-09-24');
  assert.ok(c.tables.RAT.codes['999ZZ']);
  assert.ok(c.tables.HEX.codes['31400']);
  assert.equal(Object.keys(c.tables.BAR.codes).length, 20);
  assert.equal(c.tables.IVO.codes['53514650000017'][3], 'URS');
  assert.throws(function () { NM.lireCumul('pas un cumul\r\n'); });
});

test('release note : lecture (UTF-8) et résumé', function () {
  const r = NM.lireRln(lire('NEODESP26_RLN_P26V01.csv'));
  const sup = r.filter(function (l) { return l.typeCode === 'Suppression de code'; });
  assert.equal(sup.length, 2);
  assert.deepEqual([sup[0].table, sup[0].code, sup[0].fin], ['MUT', '432674281', '2026-07-31']);
  const res = NM.resumerRln(r);
  assert.equal(res.MUT['Suppression de code'], 2);
  assert.equal(res.EFE.Ajout, 1);
});

/* ------------------------------------------------------------------ construction */

test('flux RSS : seules les actualités sur les nomenclatures et les normes sont retenues', function () {
  const items = NM.lireRss(lire('feed.xml')).concat([
    { titre: 'e-Salon de la protection sociale', lien: '', date: '2026-10-06', categories: ['Actualités', 'DSN', 'e-Salon'] },
    { titre: 'Publication du cahier technique P27V01', lien: '', date: '2026-10-10', categories: ['Actualités'] }
  ]);
  const r = NM.filtrerActualites(items, '2026-09-01');
  assert.deepEqual(r.map(function (x) { return x.titre; }), ['Nouvelle nomenclature NAF à compter de janvier 2027 !', 'Publication du cahier technique P27V01']);
  assert.deepEqual(NM.filtrerActualites(items, '2026-10-09').map(function (x) { return x.date; }), ['2026-10-10']);
});

test('construction : codes retirés conservés avec leur date de fin, libellés EFE omis', function () {
  const page = NM.lirePage(PAGE, 'P26V01');
  const cumul = NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv'));
  const ds = NM.construire({ page: page, donnees: cumul.tables, rln: NM.lireRln(lire('NEODESP26_RLN_P26V01.csv')) });
  assert.equal(ds.version, 'v13');
  assert.equal(ds.tables.RAT.maj, '2026-02-24');
  assert.deepEqual(ds.supprimes.MUT['432674281'].slice(0, 3), ['MUTUELLE AIDE ET SOLIDARITE', '2000-01-01', '2026-07-31']);
  assert.equal(ds.tables.EFE.codes['010000024'][0], '');
  assert.equal(ds.tables.EFE.libellesOmis, true);
  assert.deepEqual(NM.verifierJeu(ds, page).erreurs, []);
  // un code réintroduit n'est plus « retiré »
  const cumul2 = NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv'));
  cumul2.tables.MUT.codes['432674281'] = ['MUTUELLE AIDE ET SOLIDARITE', '2000-01-01', '', ''];
  const ds2 = NM.construire({ page: page, donnees: cumul2.tables, precedent: ds, rln: [] });
  assert.equal(ds2.supprimes.MUT['432674281'], undefined);
  assert.ok(ds2.supprimes.MUT['776011330'], 'l\'autre code retiré reste connu');
});

test('construction : une table sans données est refusée', function () {
  const page = NM.lirePage(PAGE, 'P26V01');
  const cumul = NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv'));
  delete cumul.tables.NAF;
  assert.throws(function () { NM.construire({ page: page, donnees: cumul.tables }); }, /NAF/);
});

test('écriture et lecture du jeu (gzip, écriture atomique)', function () {
  const d = tmp();
  const page = NM.lirePage(PAGE, 'P26V01');
  const ds = NM.construire({ page: page, donnees: NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv')).tables });
  NM.ecrireJeu(ds, path.join(d, 'P26V01.json.gz'));
  assert.deepEqual(fs.readdirSync(d), ['P26V01.json.gz']);
  const relu = NM.lireJeu(path.join(d, 'P26V01.json.gz'));
  assert.equal(relu.tables.RAT.n, ds.tables.RAT.n);
});

/* ------------------------------------------------------------------ comparaison et mise à jour */

test('comparaison : même version → à jour ; table republiée → modifiée', function () {
  const page = NM.lirePage(PAGE, 'P26V01');
  const ds = NM.construire({ page: page, donnees: NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv')).tables });
  assert.equal(NM.comparer(ds, page).aJour, true);
  const p2 = NM.lirePage(pagePlusRecente(), 'P26V01');
  const d = NM.comparer(ds, p2);
  assert.equal(d.aJour, false);
  assert.deepEqual(d.modifiees, ['RAT']);
  assert.equal(p2.version, 'v14');
  assert.equal(NM.comparer(null, p2).ajoutees.length, 10);
});

test('mise à jour complète : premier passage, cache dans le dossier client, état enregistré', async function () {
  const client = tmp(), skill = tmp();
  const tr = transportSimule(contenusDeBase());
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: tr, sonde: false, normes: ['P26V01'], maintenant: new Date('2026-10-20T10:00:00Z') });
  assert.equal(r.statut, 'mis_a_jour');
  assert.equal(r.normes[0].mode, 'fichier complet');
  assert.ok(tr.demandes.indexOf(URL_CUMUL) >= 0 && tr.demandes.indexOf(URL_RLN) >= 0);
  assert.ok(fs.existsSync(path.join(client, 'nomenclatures', 'P26V01.json.gz')));
  const etat = NM.lireEtat(client);
  assert.equal(etat.derniereVerification, '2026-10-20T10:00:00.000Z');
  assert.equal(etat.normes.P26V01.version, 'v13');
  // actualités du flux RSS filtrées (catégorie DSN / Nomenclatures)
  assert.ok(r.actualites.some(function (x) { return /NAF/.test(x.titre); }));
  assert.ok(!r.actualites.some(function (x) { return /SOLTéA/.test(x.titre); }));
});

test('mise à jour : deuxième passage sans changement → rien n\'est téléchargé', async function () {
  const client = tmp(), skill = tmp();
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase()), sonde: false, rss: false, normes: ['P26V01'] });
  const tr = transportSimule(contenusDeBase());
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: tr, sonde: false, rss: false });
  assert.equal(r.statut, 'a_jour');
  assert.equal(r.normes[0].action, 'aucune');
  assert.deepEqual(tr.demandes, [NM.urlPage('P26V01')]);
});

test('mise à jour incrémentale : seule la table republiée est téléchargée', async function () {
  const client = tmp(), skill = tmp();
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase()), sonde: false, rss: false, normes: ['P26V01'] });
  const c = contenusDeBase(pagePlusRecente());
  c[csvUrl('RAT')] = RAT_V14;
  const tr = transportSimule(c);
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: tr, sonde: false, rss: false });
  assert.equal(r.statut, 'mis_a_jour');
  assert.deepEqual(r.normes[0].tablesModifiees, ['RAT']);
  assert.match(r.normes[0].mode, /tables modifiées \(RAT\)/);
  assert.ok(tr.demandes.indexOf(URL_CUMUL) < 0, 'le fichier complet n\'est pas retéléchargé');
  assert.ok(tr.demandes.indexOf(csvUrl('RAT')) >= 0);
  const ds = NM.charger({ dossier: client, norme: 'P26V01', dossierSkill: skill });
  assert.equal(ds.version, 'v14');
  assert.equal(ds.datePublication, '2026-10-22');
  assert.equal(ds.tables.RAT.maj, '2026-10-22');
  assert.equal(ds.tables.RAT.codes['852AB'][1], '2026-11-01');
  assert.ok(ds.tables.MUT.codes['301862769'], 'les tables non modifiées sont reprises');
  assert.ok(ds.supprimes.MUT['432674281'], 'les codes retirés restent connus');
});

test('vérification seule : signale la mise à jour sans rien écrire', async function () {
  const client = tmp(), skill = tmp();
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase()), sonde: false, rss: false, normes: ['P26V01'] });
  const avant = fs.statSync(path.join(client, 'nomenclatures', 'P26V01.json.gz')).mtimeMs;
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase(pagePlusRecente())), sonde: false, rss: false, verifier: true });
  assert.equal(r.statut, 'mise_a_jour_disponible');
  assert.equal(fs.statSync(path.join(client, 'nomenclatures', 'P26V01.json.gz')).mtimeMs, avant);
});

test('hors ligne : statut hors_ligne, tables locales gardées, état inchangé', async function () {
  const client = tmp(), skill = tmp();
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase()), sonde: false, rss: false, normes: ['P26V01'], maintenant: new Date('2026-10-01T00:00:00Z') });
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule({}, { horsLigne: true }), normes: ['P26V01'] });
  assert.equal(r.statut, 'hors_ligne');
  assert.equal(NM.lireEtat(client).derniereVerification, '2026-10-01T00:00:00.000Z');
  assert.ok(NM.charger({ dossier: client, norme: 'P26V01', dossierSkill: skill }));
});

test('fichier téléchargé incohérent avec la page : la mise à jour échoue sans rien écrire', async function () {
  const client = tmp(), skill = tmp();
  const c = contenusDeBase(pagePlusRecente()); // la page annonce le 22/10, le fichier complet est daté du 24/09
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(c), sonde: false, rss: false, normes: ['P26V01'] });
  assert.equal(r.statut, 'echec');
  assert.match(r.normes[0].erreur, /daté du 24\/09\/2026/);
  assert.ok(!fs.existsSync(path.join(client, 'nomenclatures', 'P26V01.json.gz')));
});

test('sonde : une norme plus récente publiée est détectée et récupérée', async function () {
  const client = tmp(), skill = tmp();
  const c = contenusDeBase();
  const p27 = PAGE.toString('utf8').replace(/P26V01/g, 'P27V01').replace(/NEODESP26/g, 'NEODESP27').replace(/v13 du/g, 'v1 du');
  c[NM.urlPage('P27V01')] = Buffer.from(p27, 'utf8');
  c[URL_CUMUL.replace(/P26V01/g, 'P27V01').replace(/NEODESP26/g, 'NEODESP27')] = lire('NEODESP26_CUMUL_P26V01.csv');
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(c), rss: false, normes: ['P26V01'] });
  assert.deepEqual(r.nouvellesNormes.map(function (n) { return n.norme; }), ['P27V01']);
  assert.ok(NM.charger({ dossier: client, norme: 'P27V01', dossierSkill: skill }));
});

test('choix du jeu : le cache du client l\'emporte s\'il est plus récent que celui du skill', function () {
  const client = tmp(), skill = tmp();
  const page = NM.lirePage(PAGE, 'P26V01');
  const ancien = NM.construire({ page: page, donnees: NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv')).tables });
  NM.ecrireJeu(ancien, path.join(skill, 'P26V01.json.gz'));
  assert.equal(NM.charger({ dossier: client, norme: 'P26V01', dossierSkill: skill }).origine, 'version embarquée');
  const recent = Object.assign({}, ancien, { datePublication: '2026-10-22', version: 'v14' });
  NM.ecrireJeu(recent, path.join(client, 'nomenclatures', 'P26V01.json.gz'));
  assert.equal(NM.charger({ dossier: client, norme: 'P26V01', dossierSkill: skill }).origine, 'cache local');
  // un cache plus ancien que le skill (skill mis à jour entre-temps) est ignoré
  NM.ecrireJeu(Object.assign({}, ancien, { datePublication: '2026-01-01' }), path.join(client, 'nomenclatures', 'P26V01.json.gz'));
  assert.equal(NM.charger({ dossier: client, norme: 'P26V01', dossierSkill: skill }).origine, 'version embarquée');
});

test('fichiers déposés à la main : reconnus par la fin de leur nom', async function () {
  const d = tmp();
  fs.copyFileSync(path.join(FX, 'NEODESP26_CUMUL_P26V01.csv'), path.join(d, 'f9a68b45-NEODESP26_CUMUL_P26V01.csv'));
  fs.copyFileSync(path.join(FX, 'page-P26V01.html'), path.join(d, 'page-P26V01.html'));
  const t = NM.transportFichiers(d);
  assert.ok(await t.get(URL_CUMUL));
  assert.ok(await t.get(NM.urlPage('P26V01')));
  assert.equal(await t.get(URL_RLN), null);
  const page = await NM.pageDepuisFichiers('P26V01', t, null);
  assert.equal(page.version, 'v13');
});

/* ------------------------------------------------------------------ contrôle des codes */

function jeuTest() {
  const page = NM.lirePage(PAGE, 'P26V01');
  const ds = NM.construire({ page: page, donnees: NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv')).tables, rln: NM.lireRln(lire('NEODESP26_RLN_P26V01.csv')) });
  // codes fictifs pour couvrir les cas de validité
  ds.tables.NAF.codes['9999X'] = ['Code ouvert en septembre', '2026-09-01', '', ''];
  ds.tables.PCSESE.codes['999e'] = ['Code avec échappement', '', '', ''];
  ds.tables.PCSESE.codes['999e'][0] = 'Valeur d\'échappement';
  ds.tables.MUT.rubriques = ['S21.G00.15.002'];
  return ds;
}
function dsn(mois, extra, sans) {
  const l = [
    ['S10.G00.00.006', 'P26V01'], ['S10.G00.01.005', '31400'], ['S20.G00.05.005', '01' + mois.slice(5) + mois.slice(0, 4)],
    ['S21.G00.06.001', '999999998'], ['S21.G00.06.003', '6312Z'], ['S21.G00.06.005', '31400'],
    ['S21.G00.11.002', '6312Z'], ['S21.G00.11.004', '31400'], ['S21.G00.11.022', '9999'], ['S21.G00.22.001', '53514650000017']
  ].concat(extra || []).filter(function (x) { return !(sans || []).includes(x[0]); });
  return l.map(function (x, i) { return { c: x[0], v: x[1], n: i + 1 }; });
}
function ctl(lignes, o) { return NM.controleur(Object.assign({ jeux: { P26V01: jeuTest() }, etat: { derniereVerification: '2026-10-20T00:00:00Z' }, maintenant: new Date('2026-10-20T12:00:00Z') }, o || {})).controler(lignes); }
const niveaux = function (r) { return r.map(function (x) { return x.lvl; }); };

test('contrôle : DSN conforme', function () {
  const r = ctl(dsn('2026-09'));
  assert.deepEqual(niveaux(r), ['ok']);
  // 3 codes postaux (HEX), 2 codes APE (NAF), 1 convention collective (IDCC) ; l'organisme du bordereau (IBC) n'est pas dans l'extrait
  assert.match(r[0].title, /^6 rubrique\(s\) codée\(s\) vérifiée\(s\) dans les tables officielles P26V01 v13 du 24\/09\/2026/);
});

test('contrôle : code inconnu → erreur bloquante', function () {
  const r = ctl(dsn('2026-09', [['S21.G00.40.004', '123z']]));
  const e = r.filter(function (x) { return x.lvl === 'err'; });
  assert.equal(e.length, 1);
  assert.match(e[0].title, /S21\.G00\.40\.004.* = 123z : code inconnu des tables officielles/);
});

test('contrôle : période de validité du code', function () {
  assert.equal(ctl(dsn('2026-09', [], ['S21.G00.06.003']).concat([{ c: 'S21.G00.06.003', v: '9999X' }])).filter(function (x) { return x.lvl === 'err'; }).length, 0);
  const avant = ctl(dsn('2026-08', [], ['S21.G00.06.003']).concat([{ c: 'S21.G00.06.003', v: '9999X' }])).filter(function (x) { return x.lvl === 'err'; });
  assert.equal(avant.length, 1);
  assert.match(avant[0].title, /hors de sa période de validité pour 08\/2026/);
  assert.match(avant[0].detail, /valide du 01\/09\/2026/);
});

test('contrôle : code retiré de la table, accepté avant sa date de fin seulement', function () {
  const ok = ctl(dsn('2026-07', [['S21.G00.15.002', '432674281']]));
  assert.equal(ok.filter(function (x) { return x.lvl === 'err'; }).length, 0);
  const ko = ctl(dsn('2026-08', [['S21.G00.15.002', '432674281']])).filter(function (x) { return x.lvl === 'err'; });
  assert.equal(ko.length, 1);
  assert.match(ko[0].detail, /retiré de la table en v13/);
});

test('contrôle : valeur d\'échappement signalée (sauf 999ZZ, déjà expliqué par le moteur)', function () {
  const r = ctl(dsn('2026-09', [['S21.G00.40.004', '999e'], ['S21.G00.40.040', '999ZZ']]));
  const w = r.filter(function (x) { return x.lvl === 'warn'; });
  assert.equal(w.length, 1);
  assert.match(w[0].title, /999e : valeur d'échappement de la table PCSESE/);
});

test('contrôle : majuscules et minuscules', function () {
  const w = ctl(dsn('2026-09', [['S21.G00.40.004', '388A']])).filter(function (x) { return x.lvl === 'warn'; });
  assert.equal(w.length, 1);
  assert.match(w[0].title, /la table connaît « 388a »/);
});

test('contrôle : barème du prélèvement à la source (table BAR)', function () {
  const bloc = function (taux, type, base) { return [['S21.G00.50.001', '30092026'], ['S21.G00.50.002', base], ['S21.G00.50.006', taux], ['S21.G00.50.007', type], ['S21.G00.50.013', base]]; };
  const bar = function (r) { return r.filter(function (x) { return x.ref === 'Table BAR'; }); };
  let r = bar(ctl(dsn('2026-09', bloc('0.00', '13', '1517.84'))));
  assert.deepEqual(niveaux(r), ['ok']);
  r = bar(ctl(dsn('2026-09', bloc('0.50', '13', '1517.84'))));
  assert.deepEqual(niveaux(r), ['warn']);
  assert.match(r[0].title, /donne 0 % pour une base de 1517\.84/);
  r = bar(ctl(dsn('2026-09', bloc('0.70', '13', '1517.84'))));
  assert.deepEqual(niveaux(r), ['err']);
  r = bar(ctl(dsn('2026-09', bloc('7.20', '01', '1517.84'))));
  assert.deepEqual(r, [], 'taux personnalisé DGFiP : pas de contrôle par le barème');
});

test('contrôle : tables trop anciennes et norme sans tables', function () {
  const vieux = ctl(dsn('2026-09'), { etat: { derniereVerification: '2026-08-01T00:00:00Z' } });
  assert.ok(vieux.some(function (x) { return x.lvl === 'warn' && /il y a 80 jours/.test(x.title); }));
  const p99 = NM.controleur({ jeux: {}, dossierSkill: tmp() }).controler([{ c: 'S10.G00.00.006', v: 'P99V01' }]);
  assert.deepEqual(niveaux(p99), ['warn']);
  assert.match(p99[0].title, /P99V01 indisponibles/);
});

/* ------------------------------------------------------------------ tables embarquées dans le skill */

test('tables embarquées (extension) : P26V01 et P27V01 complètes', { skip: !fs.existsSync(NM.DOSSIER_SKILL) && 'tables non embarquées dans ce dépôt' }, function () {
  const a = NM.charger({ norme: 'P26V01' }), b = NM.charger({ norme: 'P27V01' });
  assert.ok(a && b, 'les deux normes sont livrées avec l\'extension');
  assert.ok(Object.keys(a.tables).length >= 37);
  assert.ok(Object.keys(b.tables).length >= 37);
  assert.equal(a.tables.RAT.codes['999ZZ'][0], 'Valeur d\'échappement');
  assert.equal(a.tables.IDCC.codes['9999'][0], '___Sans convention collective___');
  assert.equal(a.tables.NAF.codes['6312Z'][0], 'Portails Internet');
  assert.ok(a.tables.HEX.codes['31400']);
  assert.equal(a.tables.IBC.codes['53514650000017'][3], 'URS');
  assert.ok(a.tables.EFE.n > 100000);
  assert.ok(Object.keys(a.tables).every(function (t) { return a.tables[t].n > 0 && a.tables[t].rubriques.length > 0; }));
});

/* ------------------------------------------------------------------ moteur */

test('moteur : adresse de l\'entreprise sans code postal → erreur bloquante (CCH-11)', function () {
  const base = dsn('2026-09');
  const sans = base.filter(function (l) { return l.c !== 'S21.G00.06.005'; });
  const ko = E.controls(sans, {}).filter(function (x) { return x.ref === 'CCH-11 de S21.G00.06.005'; });
  assert.deepEqual(niveaux(ko), ['err']);
  const ok = E.controls(base, {}).filter(function (x) { return x.ref === 'CCH-11 de S21.G00.06.005'; });
  assert.deepEqual(niveaux(ok), ['ok']);
  const etranger = sans.concat([{ c: 'S21.G00.06.010', v: 'BE' }, { c: 'S21.G00.06.011', v: '1000' }]);
  assert.deepEqual(niveaux(E.controls(etranger, {}).filter(function (x) { return x.ref === 'CCH-11 de S21.G00.06.005'; })), ['ok']);
});

test('moteur : contrôle des tables branché dans les contrôles', function () {
  const nm = NM.controleur({ jeux: { P26V01: jeuTest() }, etat: { derniereVerification: new Date().toISOString() } });
  const r = E.controls(dsn('2026-09', [['S21.G00.40.004', '123z']]), { nomenclatures: nm });
  const t = r.filter(function (x) { return x.cat === 'Tables de référence (nomenclatures)'; });
  assert.ok(t.some(function (x) { return x.lvl === 'err' && /123z/.test(x.title); }));
  // sans tables fournies, le moteur reste utilisable seul
  assert.equal(E.controls(dsn('2026-09'), {}).filter(function (x) { return x.cat === 'Tables de référence (nomenclatures)'; }).length, 0);
});

/* ------------------------------------------------------------------ défauts relevés en relecture (non-régression) */

const { masqueur, nirsDuTexte } = require('../server/lib/confidentialite.js');
const http = require('http');

function jeuEtendu() {
  const ds = jeuTest();
  ds.tables.AAETH = { nom: 'Accords agréés OETH', rubriques: ['S21.G00.13.001'], fournisseur: '', maj: '2026-05-27', csv: '', n: 1, codes: { B2023R002001: ['Accord agréé', '2023-01-01', '2025-12-31', ''] } };
  ds.tables.IDCC.rubriques = ['S21.G00.40.017', 'S21.G00.41.011', 'S21.G00.06.015', 'S21.G00.11.022'];
  ds.tables.IDCC.codes['1000'] = ['Convention fermée', '1950-01-01', '2025-09-30', ''];
  ds.tables.PREV = { nom: 'Institutions de prévoyance', rubriques: ['S21.G00.15.002'], fournisseur: '', maj: '2025-12-19', csv: '', n: 1, codes: { P0001: ['Prévoyance', '', '', ''] } };
  return ds;
}
function ctlE(lignes, o) { return ctl(lignes, Object.assign({ jeux: { P26V01: jeuEtendu() } }, o || {})); }
const erreurs = function (r) { return r.filter(function (x) { return x.lvl === 'err'; }); };

test('historique de la page : codes retirés de chaque version, avec leurs dates', function () {
  const p = NM.lirePage(PAGE, 'P26V01');
  const jaji = p.retraits.filter(function (r) { return r.code === '431875210'; });
  assert.deepEqual(jaji.map(function (r) { return [r.version, r.table, r.debut, r.fin]; }), [['v12', 'MUT', '2025-01-01', '2026-06-30'], ['v12', 'IVO', '2025-01-01', '2026-06-30']]);
  assert.ok(p.retraits.some(function (r) { return r.version === 'v13' && r.code === '776011330'; }));
  const ds = NM.construire({ page: p, donnees: NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv')).tables });
  assert.equal(ds.supprimes.MUT['431875210'][4], 'v12');
});

test('contrôle : un code retiré en v12 reste accepté pour un mois où il était valide', function () {
  const p = NM.lirePage(PAGE, 'P26V01');
  const ds = NM.construire({ page: p, donnees: NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv')).tables });
  ds.tables.MUT.rubriques = ['S21.G00.15.002'];
  const r = NM.controleur({ jeux: { P26V01: ds }, etat: { derniereVerification: new Date().toISOString() } }).controler(dsn('2026-05', [['S21.G00.15.002', '431875210']]));
  assert.deepEqual(erreurs(r), []);
});

test('contrôle : déclaration OETH (S21.G00.13) contrôlée sur l\'année précédente', function () {
  assert.deepEqual(erreurs(ctlE(dsn('2026-04', [['S21.G00.13.001', 'B2023R002001']]))), []);
  assert.equal(erreurs(ctlE(dsn('2027-04', [['S21.G00.13.001', 'B2023R002001']]))).length, 1);
});

test('contrôle : anciennes valeurs d\'un contrat modifié (S21.G00.41) : existence seulement', function () {
  assert.deepEqual(erreurs(ctlE(dsn('2026-10', [['S21.G00.41.011', '1000']]))), []);
  assert.equal(erreurs(ctlE(dsn('2026-10', [['S21.G00.40.017', '1000']]))).length, 1, 'la valeur actuelle doit être valide');
});

test('contrôle : code absent d\'une rubrique à plusieurs tables, mois passé → vigilance (date la plus récente)', function () {
  const r = ctlE(dsn('2026-05', [['S21.G00.15.002', '999999999']]));
  assert.deepEqual(erreurs(r), []);
  assert.ok(r.some(function (x) { return x.lvl === 'warn' && /absent des tables actuelles/.test(x.title); }));
});

test('contrôle : version plus récente vue sur le site mais pas appliquée → vigilance', function () {
  const r = ctl(dsn('2026-09'), { etat: { derniereVerification: '2026-10-20T00:00:00Z', normes: { P26V01: { version: 'v14', date: '2026-10-22' } } } });
  assert.ok(r.some(function (x) { return x.lvl === 'warn' && /plus récentes publiées \(v14 du 22\/10\/2026\)/.test(x.title); }));
});

test('contrôle : barème de l\'année du versement (paie de décembre versée en janvier)', function () {
  const lignes = dsn('2027-01', [['S21.G00.50.001', '31122026'], ['S21.G00.50.006', '0.00'], ['S21.G00.50.007', '13'], ['S21.G00.50.013', '1517.84']]);
  const bar = ctl(lignes).filter(function (x) { return x.ref === 'Table BAR'; });
  assert.deepEqual(niveaux(bar), ['ok']);
  assert.match(bar[0].title, /barème 2026/);
});

test('mise à jour : page reçue mais illisible → échec, date de vérification inchangée', async function () {
  const client = tmp(), skill = tmp();
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase()), sonde: false, rss: false, normes: ['P26V01'], maintenant: new Date('2026-10-01T00:00:00Z') });
  const c = contenusDeBase(Buffer.from('<html><body>Site en maintenance</body></html>'));
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(c), sonde: false, rss: false, maintenant: new Date('2026-10-20T00:00:00Z') });
  assert.equal(r.statut, 'echec');
  assert.match(r.normes[0].erreur, /introuvable ou illisible/);
  assert.equal(NM.lireEtat(client).derniereVerification, '2026-10-01T00:00:00.000Z');
});

test('mise à jour : --verifier note la version publiée sans faire avancer la date de vérification', async function () {
  const client = tmp(), skill = tmp();
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase()), sonde: false, rss: false, normes: ['P26V01'], maintenant: new Date('2026-10-01T00:00:00Z') });
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase(pagePlusRecente())), sonde: false, rss: false, verifier: true, maintenant: new Date('2026-10-20T00:00:00Z') });
  const etat = NM.lireEtat(client);
  assert.equal(etat.derniereVerification, '2026-10-01T00:00:00.000Z');
  assert.equal(etat.normes.P26V01.version, 'v14');
});

test('mise à jour : coupure pendant le téléchargement → hors_ligne (code 3), rien d\'écrit', async function () {
  const client = tmp(), skill = tmp();
  const c = contenusDeBase();
  const tr = transportSimule(c);
  const get = tr.get;
  tr.get = async function (url) { if (/\.csv$/.test(url)) { const e = new Error('coupure'); e.horsLigne = true; throw e; } return get(url); };
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: tr, sonde: false, rss: false, normes: ['P26V01'] });
  assert.equal(r.statut, 'hors_ligne');
  assert.ok(!fs.existsSync(path.join(client, 'nomenclatures', 'P26V01.json.gz')));
  assert.equal(NM.lireEtat(client).derniereVerification, undefined);
});

test('mise à jour : nouvelle version sans table modifiée → fichier complet retéléchargé (pas de simple réétiquetage)', async function () {
  const client = tmp(), skill = tmp();
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase()), sonde: false, rss: false, normes: ['P26V01'] });
  const page = Buffer.from(PAGE.toString('utf8').replace(/\(24\/09\/2026\)/g, '(22/10/2026)').replace('Version P26V01 v13 du 24/09/2026', 'Version P26V01 v14 du 22/10/2026 :</div><div class="release_note_version_nom">Version P26V01 v13 du 24/09/2026'), 'utf8');
  const c = contenusDeBase(page); c[URL_CUMUL] = CUMUL_V14;
  const tr = transportSimule(c);
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: tr, sonde: false, rss: false });
  assert.equal(r.statut, 'mis_a_jour');
  assert.equal(r.normes[0].mode, 'fichier complet');
  assert.ok(tr.demandes.indexOf(URL_CUMUL) >= 0);
});

test('page : dates au format AAAA-MM-JJ et rubriques séparées par des virgules', function () {
  const p = NM.lirePage(Buffer.from(PAGE.toString('utf8').replace('<td class="back">S21.G00.40.040<br />S21.G00.41.024</td>', '<td class="back">S21.G00.40.040, S21.G00.41.024</td>').replace(/(NEODESP26-RAT-P26V01\.csv[\s\S]*?<td[^>]*class="back">)24\/02\/2026/, '$12026-02-24'), 'utf8'), 'P26V01');
  assert.deepEqual(p.tables.RAT.rubriques, ['S21.G00.40.040', 'S21.G00.41.024']);
  assert.equal(p.tables.RAT.maj, '2026-02-24');
});

test('mise à jour : page dont les rubriques ne se lisent plus → échec, pas de tables sans rubrique', async function () {
  const client = tmp(), skill = tmp();
  const page = Buffer.from(PAGE.toString('utf8').replace(/<td class="back">(S21\.G00\.[^<]*(?:<br \/>[^<]*)*)<\/td>/g, '<td class="back">voir l\'index</td>'), 'utf8');
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase(page)), sonde: false, rss: false, normes: ['P26V01'] });
  assert.equal(r.statut, 'echec');
  assert.match(r.normes[0].erreur, /rattachée à aucune rubrique/);
});

test('mise à jour : table absente du fichier complet → échec (pas d\'ancien contenu réétiqueté)', async function () {
  const client = tmp(), skill = tmp();
  const c = contenusDeBase();
  c[URL_CUMUL] = Buffer.from(lire('NEODESP26_CUMUL_P26V01.csv').toString('latin1').split('\r\n').filter(function (l) { return l.indexOf('RAT;') !== 0; }).join('\r\n'), 'latin1');
  const r = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(c), sonde: false, rss: false, normes: ['P26V01'] });
  assert.equal(r.statut, 'echec');
  assert.match(r.normes[0].erreur, /RAT absente du fichier/);
});

test('mise à jour : fichier d\'une table plus ancien que la page → date du fichier gardée, retéléchargé ensuite', async function () {
  const client = tmp(), skill = tmp();
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(contenusDeBase()), sonde: false, rss: false, normes: ['P26V01'] });
  const c = contenusDeBase(pagePlusRecente()); // la page annonce RAT au 22/10 ; le CSV de RAT est encore daté du 24/02
  const r1 = await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: transportSimule(c), sonde: false, rss: false });
  assert.ok((r1.normes[0].avertissements || []).some(function (a) { return /retéléchargée au prochain passage/.test(a); }));
  assert.equal(NM.charger({ dossier: client, norme: 'P26V01', dossierSkill: skill }).tables.RAT.maj, '2026-02-24');
  const tr = transportSimule(c);
  await NM.mettreAJour({ dossier: client, dossierSkill: skill, transport: tr, sonde: false, rss: false });
  assert.ok(tr.demandes.indexOf(csvUrl('RAT')) >= 0, 'RAT est redemandée tant que le site n\'est pas cohérent');
});

test('choix du jeu : à date de publication égale, le jeu construit le plus récemment l\'emporte', function () {
  const client = tmp(), skill = tmp();
  const page = NM.lirePage(PAGE, 'P26V01');
  const ds = NM.construire({ page: page, donnees: NM.lireCumul(lire('NEODESP26_CUMUL_P26V01.csv')).tables });
  NM.ecrireJeu(Object.assign({}, ds, { construitLe: '2026-09-25T00:00:00Z' }), path.join(client, 'nomenclatures', 'P26V01.json.gz'));
  NM.ecrireJeu(Object.assign({}, ds, { construitLe: '2026-10-20T00:00:00Z' }), path.join(skill, 'P26V01.json.gz'));
  assert.equal(NM.charger({ dossier: client, norme: 'P26V01', dossierSkill: skill }).origine, 'version embarquée');
});

test('transport réseau : 503 et 429 = hors ligne, 404 = absent', async function () {
  const srv = http.createServer(function (req, res) { const c = +req.url.slice(1); res.writeHead(c || 200); res.end('ok'); });
  await new Promise(function (r) { srv.listen(0, '127.0.0.1', r); });
  const base = 'http://127.0.0.1:' + srv.address().port + '/';
  const t = NM.transportReseau();
  try {
    assert.equal((await t.get(base + '200')).toString(), 'ok');
    assert.equal(await t.get(base + '404'), null);
    await assert.rejects(t.get(base + '503'), function (e) { return e.horsLigne === true; });
    await assert.rejects(t.get(base + '429'), function (e) { return e.horsLigne === true; });
  } finally { srv.close(); }
});

test('fichiers déposés : page enregistrée sous le nom donné par le navigateur', async function () {
  const d = tmp();
  fs.copyFileSync(path.join(FX, 'page-P26V01.html'), path.join(d, 'Tables de référence de la norme DSN – P26V01 - net-entreprises.fr.html'));
  const t = NM.transportFichiers(d);
  assert.ok(await t.get(NM.urlPage('P26V01')));
});

test('confidentialité : NIR masqué, même mal formé ou cité dans une ligne illisible', function () {
  const nir = '2991299999999';
  const m = masqueur(nirsDuTexte("S10.G00.00.006,'P26V01'\r\nS21.G00.30.001,'" + nir + "\r\n"));
  assert.equal(m('ligne 39 : format non reconnu — S21.G00.30.001,\'' + nir), 'ligne 39 : format non reconnu — S21.G00.30.001,\'[NIR masqué]\'');
  assert.equal(m('NIR 2  9 9  12  99  99 : format invalide (13 caractères attendus, sans la clé)'), 'NIR (masqué) : format invalide (13 caractères attendus, sans la clé)');
  assert.equal(m('NIR 2 99 12 99 999 999 : format valide — Clé calculée : 42 — elle doit…'), 'NIR (masqué) : format valide — Clé calculée : •• — elle doit…');
  assert.equal(m('NIR (numéro de sécurité sociale) absent'), 'NIR (numéro de sécurité sociale) absent');
  const m2 = masqueur(['2 99 12-99 999 999']);
  assert.ok(m2('valeur 2991299999999 copiée').indexOf('299129') < 0);
});

test('contrôle d\'un fichier : aucune trace du NIR, même sur une ligne mal formée', function () {
  const P = require('../server/lib/paie.js');
  const nir = '2991299999999';
  const buf = Buffer.from(["S10.G00.00.001,'X'", "S10.G00.00.005,'01'", "S10.G00.00.006,'P26V01'", "S20.G00.05.002,'01'", "S20.G00.05.005,'01092026'", "S21.G00.06.001,'999999998'", "S21.G00.06.005,'31400'", "S21.G00.30.001,'" + nir, "S21.G00.30.005,'02'", "S90.G00.90.001,'9'"].join('\r\n'), 'latin1');
  const j = P.controlerFichier(buf, {});
  const out = JSON.stringify(j);
  assert.ok(out.indexOf('29912') < 0, 'le NIR ne doit pas apparaître');
  assert.equal(j.pret, false);
});
