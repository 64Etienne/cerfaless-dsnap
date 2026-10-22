'use strict';
/*
 * Non-régression des défauts relevés en relecture indépendante :
 * réponse perdue pendant un dépôt réel, NIR mal formé dans une sortie, refus d'identifiants entre deux lancements,
 * démonstration détournée, réponse de licence non signée.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('./aide.js');

async function societe(env, ne) {
  const s = A.lancer(env);
  await s.rpc('initialize', {});
  const url = (await s.appeler('configurer_dsnap')).donnees.url;
  await A.page(url, 'api/dossier', { chemin: env.DOSSIER_TEST });
  await A.page(url, 'api/identifiants', { siret: '99999999800001', nom: 'TEST', prenom: 'JEAN', motdepasse: (ne && ne.etat.motdepasse) || 'secret' });
  const r = await A.page(url, 'api/config', A.formulaireTest());
  assert.equal(r.status, 200, r.texte);
  return s;
}

test('réponse perdue pendant un dépôt réel : jamais de second envoi, puis rapprochement par rechercher_depots', async function () {
  const ne = await A.fauxNetEntreprises();
  const lic = await A.fauxLicences();
  const env = Object.assign({ DSNAP_DONNEES: A.tmp('perte'), DOSSIER_TEST: A.tmp('perte-paie'), DSNAP_TABLES_AUTO: '0' }, ne.env, lic.env);
  const s = await societe(env, ne);
  try {
    const p = await s.appeler('preparer_dsn', { mois: '2026-09', brut: 1500, date_versement: '2026-09-30' });
    assert.equal(p.erreur, false, p.texte);
    let d = await s.appeler('deposer_dsn', { fichier: p.donnees.fichiers.dsnTest, mode: 'test' });
    assert.equal(d.erreur, false, d.texte);
    ne.etat.coupure = 'apres';
    d = await s.appeler('deposer_dsn', { fichier: p.donnees.fichiers.dsnReel, mode: 'reel', confirmation_utilisateur: true });
    // le dépôt a été reçu, la réponse s'est perdue : DSNap le retrouve dans la liste
    assert.equal(ne.etat.depots.filter(function (x) { return x.reel; }).length, 1);
    assert.match(d.texte, /bien été reçu|NE REDÉPOSEZ PAS/);
    const d2 = await s.appeler('deposer_dsn', { fichier: p.donnees.fichiers.dsnReel, mode: 'reel', confirmation_utilisateur: true });
    assert.equal(d2.erreur, true);
    assert.equal(ne.etat.depots.filter(function (x) { return x.reel; }).length, 1, 'aucun second envoi');
    // coupure sans que la liste puisse aider (erreur 502 après réception) : mois bloqué jusqu'à rechercher_depots
    const p2 = await s.appeler('preparer_dsn', { mois: '2026-10', brut: 0 });
    await s.appeler('deposer_dsn', { fichier: p2.donnees.fichiers.dsnTest, mode: 'test' });
    ne.etat.coupure = '502';
    const d3 = await s.appeler('deposer_dsn', { fichier: p2.donnees.fichiers.dsnReel, mode: 'reel', confirmation_utilisateur: true });
    const envoyes = ne.etat.depots.filter(function (x) { return x.reel; }).length;
    assert.equal(envoyes, 2);
    if (d3.erreur) {
      const d4 = await s.appeler('deposer_dsn', { fichier: p2.donnees.fichiers.dsnReel, mode: 'reel', confirmation_utilisateur: true });
      assert.equal(d4.erreur, true); assert.match(d4.texte, /rechercher_depots|déjà été déposée/);
      const auj = new Date(); const j = auj.getFullYear() + '-' + String(auj.getMonth() + 1).padStart(2, '0') + '-' + String(auj.getDate()).padStart(2, '0');
      const r = await s.appeler('rechercher_depots', { du: j });
      assert.match(r.texte, /flux F/);
    }
    assert.equal(ne.etat.depots.filter(function (x) { return x.reel; }).length, 2, 'toujours aucun doublon');
    const jl = JSON.parse(fs.readFileSync(path.join(env.DOSSIER_TEST, 'retours', 'journal-depots.json'), 'utf8'));
    assert.ok(jl.every(function (e) { return e.id && e.etat; }));
  } finally { s.fermer(); ne.fermer(); lic.fermer(); }
});

test('NIR avec espaces ou de Corse dans un fichier contrôlé : jamais renvoyé', async function () {
  const donnees = A.tmp('nir'), paie = A.tmp('nir-paie');
  const s = A.lancer({ DSNAP_DONNEES: donnees, DSNAP_DOSSIER: paie, DSNAP_TABLES_AUTO: '0', DSNAP_API: 'http://127.0.0.1:9/api' });
  try {
    await s.rpc('initialize', {});
    const cas = [["S21.G00.30.001,'1 85 05 78 006 084' ", '850578006'], ["S21.G00.30.001,'185052A006084'", '52A006'], ["S21.G00.30.001,'1850578006084", '850578006']];
    for (const [ligne, morceau] of cas) {
      fs.writeFileSync(path.join(paie, 'f.txt'), ["S10.G00.00.001,'X'", "S10.G00.00.005,'01'", "S10.G00.00.006,'P26V01'", "S20.G00.05.001,'01'", "S20.G00.05.002,'01'", "S20.G00.05.005,'01092026'", ligne, "S90.G00.90.001,'7'", "S90.G00.90.002,'1'"].join('\r\n'), 'latin1');
      const v = await s.appeler('verifier_fichier_dsn', { fichier: 'f.txt' });
      const tout = v.texte + JSON.stringify(v.donnees);
      assert.ok(tout.replace(/\s/g, '').indexOf(morceau) < 0, 'NIR visible : ' + morceau);
    }
    assert.ok(s.sorties.every(function (l) { return l.indexOf('850578006') < 0 && l.indexOf('52A006') < 0; }));
  } finally { s.fermer(); }
});

test('identifiants refusés : pas de nouvelle tentative au lancement suivant', async function () {
  const ne = await A.fauxNetEntreprises({ motdepasse: 'bon' });
  const donnees = A.tmp('refus');
  const env = Object.assign({ DSNAP_DONNEES: donnees, DSNAP_TABLES_AUTO: '0', DSNAP_API: 'http://127.0.0.1:9/api' }, ne.env);
  let s = A.lancer(env);
  await s.rpc('initialize', {});
  const url = (await s.appeler('configurer_dsnap')).donnees.url;
  await A.page(url, 'api/identifiants', { siret: '99999999800001', nom: 'T', prenom: 'J', motdepasse: 'mauvais' });
  // appels parallèles : une seule tentative
  const t = await Promise.all([s.appeler('tester_connexion'), s.appeler('tester_connexion'), s.appeler('tester_connexion')]);
  assert.ok(t.every(function (x) { return x.erreur; }));
  assert.equal(ne.etat.refus, 1);
  s.fermer();
  s = A.lancer(env);
  try {
    await s.rpc('initialize', {});
    const r = await s.appeler('tester_connexion');
    assert.equal(r.erreur, true); assert.match(r.texte, /ne réessaie pas|déjà refusé/);
    assert.equal(ne.etat.refus, 1, 'aucune nouvelle tentative avec les mêmes identifiants');
  } finally { s.fermer(); ne.fermer(); }
});

test('démonstration : une configuration réelle copiée dans le dossier de démonstration est refusée', async function () {
  const donnees = A.tmp('demo-det');
  const s = A.lancer({ DSNAP_DONNEES: donnees, DSNAP_TABLES_AUTO: '0', DSNAP_DOSSIER: A.tmp('autre'), DSNAP_API: 'http://127.0.0.1:9/api' });
  try {
    await s.rpc('initialize', {});
    const url = (await s.appeler('configurer_dsnap')).donnees.url;
    await A.page(url, 'api/demo', { actif: true });
    const dir = path.join(donnees, 'demo', 'dossier');
    const cfg = require('../server/lib/configuration.js').construireConfig(Object.assign(A.formulaireTest(), { siret: '12345678200002' }), null, null);
    fs.writeFileSync(path.join(dir, 'dsnap.json'), JSON.stringify(cfg));
    const p = await s.appeler('preparer_dsn', { mois: '2026-09', brut: 1500 });
    assert.equal(p.erreur, true); assert.match(p.texte, /démonstration/);
    const e = await s.appeler('etat_dsnap');
    assert.ok(e.donnees.dossier.indexOf(path.join('demo', 'dossier')) >= 0, 'la démonstration ignore le dossier imposé');
  } finally { s.fermer(); }
});

test('licence : une réponse non signée n\'autorise rien', async function () {
  const http = require('http');
  const srv = http.createServer(function (req, res) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ statut: 'actif' })); });
  await new Promise(function (r) { srv.listen(0, '127.0.0.1', r); });
  process.env.DSNAP_DONNEES = A.tmp('nonsigne'); process.env.DSNAP_API = 'http://127.0.0.1:' + srv.address().port + '/api';
  delete require.cache[require.resolve('../server/lib/licence.js')];
  const L = require('../server/lib/licence.js');
  const r = await L.autoriser('999999998', { version: 't' });
  assert.equal(r.autorise, false);
  srv.close();
});
