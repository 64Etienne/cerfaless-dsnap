'use strict';
/*
 * Tests de bout en bout du serveur MCP : démonstration complète, société réelle contre un faux net-entreprises,
 * abonnement (essai, expiré, coupure), confidentialité du NIR, sécurité de la page de configuration.
 *   node --test tests/*.test.js
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const A = require('./aide.js');

const NIR_TEST = '1850731005001';

test('démonstration : configuration, paie, dépôts test et réel, doublon refusé', async function () {
  const donnees = A.tmp('demo');
  const s = A.lancer({ DSNAP_DONNEES: donnees, DSNAP_TABLES_AUTO: '0', DSNAP_API: 'http://127.0.0.1:9/api' });
  try {
    const init = await s.rpc('initialize', { protocolVersion: '2025-06-18' });
    assert.equal(init.result.serverInfo.name, 'dsnap');
    const liste = await s.rpc('tools/list');
    const noms = liste.result.tools.map(function (t) { return t.name; });
    assert.deepEqual(noms.slice().sort(), ['abonnement_dsnap', 'bilan_du_depot', 'configurer_dsnap', 'deposer_dsn', 'etat_dsnap', 'journal_depots', 'lister_depots', 'lister_retours', 'mettre_a_jour_tables', 'preparer_dsn', 'rechercher_depots', 'simuler_budget', 'telecharger_retour', 'tester_connexion', 'verifier_fichier_dsn']);
    liste.result.tools.forEach(function (t) { assert.ok(t.annotations && t.title && t.description.length > 30, t.name); });

    let e = await s.appeler('etat_dsnap');
    assert.match(e.texte, /non configuré/);
    const c = await s.appeler('configurer_dsnap');
    const url = c.donnees.url;
    assert.match(url, /^http:\/\/127\.0\.0\.1:\d+\/c\/[\w-]+\/$/);
    const r = await A.page(url, 'api/demo', { actif: true });
    assert.equal(r.status, 200); assert.equal(r.json.demo, true);
    e = await s.appeler('etat_dsnap');
    assert.match(e.texte, /DÉMONSTRATION/); assert.match(e.texte, /DEMO DSNAP SASU/);

    const p = await s.appeler('preparer_dsn', { mois: '2026-09', brut: 1800, date_versement: '2026-09-28' });
    assert.equal(p.erreur, false, p.texte);
    assert.match(p.texte, /Paie prête/);
    const f = p.donnees.fichiers;
    for (const k of ['dsnTest', 'dsnReel', 'bulletin', 'noteFrais', 'recap']) assert.ok(fs.existsSync(path.join(e.donnees.dossier, f[k])), k);
    assert.equal(fs.readFileSync(path.join(e.donnees.dossier, f.bulletin)).slice(0, 5).toString(), '%PDF-');

    const v = await s.appeler('verifier_fichier_dsn', { fichier: f.dsnTest });
    assert.equal(v.erreur, false, v.texte);

    let d = await s.appeler('deposer_dsn', { fichier: f.dsnReel, mode: 'reel', confirmation_utilisateur: true });
    assert.equal(d.erreur, true); assert.match(d.texte, /mode test/);
    d = await s.appeler('deposer_dsn', { fichier: f.dsnTest, mode: 'reel', confirmation_utilisateur: true });
    assert.match(d.texte, /fichier de TEST/);
    d = await s.appeler('deposer_dsn', { fichier: f.dsnTest, mode: 'test' });
    assert.equal(d.erreur, false, d.texte); assert.match(d.texte, /DÉMONSTRATION/); assert.equal(d.donnees.bilan.statut, 'OK');
    d = await s.appeler('deposer_dsn', { fichier: f.dsnReel, mode: 'reel' });
    assert.equal(d.erreur, true); assert.match(d.texte, /confirmation explicite/);
    d = await s.appeler('deposer_dsn', { fichier: f.dsnReel, mode: 'reel', confirmation_utilisateur: true });
    assert.equal(d.erreur, false, d.texte); assert.equal(d.donnees.bilan.statut, 'OK');
    d = await s.appeler('deposer_dsn', { fichier: f.dsnReel, mode: 'reel', confirmation_utilisateur: true });
    assert.equal(d.erreur, true); assert.match(d.texte, /déjà été déposée/);

    const n = await s.appeler('preparer_dsn', { mois: '2026-10', brut: 0 });
    assert.equal(n.erreur, false, n.texte); assert.match(n.texte, /néant/i);
    assert.equal(n.donnees.numeroOrdre >= 1, true);

    const j = await s.appeler('journal_depots');
    assert.match(j.texte, /REEL \(démo\)/);
    e = await s.appeler('etat_dsnap');
    assert.match(e.texte, /Dépôts réels enregistrés par DSNap : 2026-09/);

    const b = await s.appeler('simuler_budget', { mois: '2026-11', budget: 2500 });
    assert.match(b.texte, /brut maximal/);

    const t = await s.appeler('verifier_fichier_dsn', { fichier: '../../etc/passwd' });
    assert.equal(t.erreur, true); assert.match(t.texte, /hors du dossier|introuvable/);
  } finally { s.fermer(); }
});

test('société réelle : configuration par la page, faux net-entreprises, essai, abonnement expiré, NIR jamais montré', async function () {
  const donnees = A.tmp('reel'), dossierPaie = A.tmp('paie');
  const ne = await A.fauxNetEntreprises({ motdepasse: 'Mot2Passe!' });
  const lic = await A.fauxLicences();
  const s = A.lancer(Object.assign({ DSNAP_DONNEES: donnees, DSNAP_TABLES_AUTO: '0' }, ne.env, lic.env));
  try {
    await s.rpc('initialize', {});
    const url = (await s.appeler('configurer_dsnap')).donnees.url;
    // sécurité de la page : lien à usage unique, cookie de session, Host contrôlé, en-tête X-DSNap
    assert.equal((await A.page(url, 'api/etat', undefined, { Host: 'evil.example:80' })).status, 403);
    assert.equal((await A.ouvrirSession(url)).status, 410, 'le lien ne sert qu\'une fois');
    const base = url.replace(/\/c\/[^/]+\/$/, '/app/');
    assert.equal((await A.requetePage(base, 'api/etat', undefined, {})).status, 401, 'sans cookie');
    const sansEntete = await A.page(url, 'api/dossier', { chemin: dossierPaie }, { 'X-DSNap': '0' });
    assert.equal(sansEntete.status, 403);
    // configuration
    let r = await A.page(url, 'api/dossier', { chemin: dossierPaie });
    assert.equal(r.status, 200, r.texte);
    r = await A.page(url, 'api/identifiants', { siret: '99999999800001', nom: 'TEST', prenom: 'JEAN', motdepasse: 'mauvais' });
    assert.equal(r.status, 200, r.texte);
    r = await A.page(url, 'api/tester', {});
    assert.equal(r.json.ok, false); assert.match(r.json.message, /refusé/);
    r = await A.page(url, 'api/tester', {});
    assert.match(r.json.message, /je ne réessaie pas|déjà refusé/i);
    assert.equal(ne.etat.refus, 1, 'un identifiant refusé ne doit pas être réessayé');
    r = await A.page(url, 'api/identifiants', { siret: '99999999800001', nom: 'TEST', prenom: 'JEAN', motdepasse: 'Mot2Passe!' });
    r = await A.page(url, 'api/tester', {});
    assert.equal(r.json.ok, true, r.json.message);
    const formulaire = A.formulaireTest();
    r = await A.page(url, 'api/config', Object.assign({}, formulaire, { nir: '185073100500151' }));
    assert.equal(r.status, 400); assert.match(r.json.erreur, /clé/);
    r = await A.page(url, 'api/config', formulaire);
    assert.equal(r.status, 200, r.texte);
    const cfg = JSON.parse(fs.readFileSync(path.join(dossierPaie, 'dsnap.json'), 'utf8'));
    assert.equal(cfg.individu['S21.G00.30.001'], NIR_TEST);
    // le formulaire relu ne contient pas le NIR
    r = await A.page(url, 'api/etat');
    assert.equal(r.json.formulaire.nir, ''); assert.equal(r.json.formulaire.nirEnregistre, true);
    assert.ok(r.texte.indexOf(NIR_TEST) < 0);
    // ressaisie sans NIR : il est gardé
    r = await A.page(url, 'api/config', Object.assign({}, formulaire, { nir: '' }));
    assert.equal(r.status, 200, r.texte);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dossierPaie, 'dsnap.json'), 'utf8')).individu['S21.G00.30.001'], NIR_TEST);
    // aucun mot de passe en clair sur le disque
    const tout = [];
    (function lire(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(function (x) { const p = path.join(d, x.name); if (x.isDirectory()) lire(p); else tout.push(fs.readFileSync(p).toString('latin1')); }); })(donnees);
    assert.ok(tout.every(function (t) { return t.indexOf('Mot2Passe!') < 0; }), 'mot de passe en clair');

    // état : abonnement « nouveau » ne démarre pas l'essai
    lic.etat.statut = 'nouveau';
    let e = await s.appeler('etat_dsnap');
    assert.match(e.texte, /TEST SASU/);
    assert.equal(lic.etat.appels.every(function (x) { return !x.demarrer; }), true);
    assert.ok(lic.etat.appels.every(function (x) { return /^[0-9a-f]{64}$/.test(x.s) && JSON.stringify(x).indexOf('999999998') < 0; }), 'le SIREN ne part pas en clair');

    // essai
    lic.etat.statut = 'essai';
    const p = await s.appeler('preparer_dsn', { mois: '2026-09', brut: 1700, date_versement: '2026-09-30' });
    assert.equal(p.erreur, false, p.texte);
    assert.match(p.texte, /Essai gratuit/);
    assert.equal(lic.etat.appels[lic.etat.appels.length - 1].demarrer, true);
    const f = p.donnees.fichiers;
    let d = await s.appeler('deposer_dsn', { fichier: f.dsnTest, mode: 'test' });
    assert.equal(d.erreur, false, d.texte);
    assert.equal(d.donnees.bilan.statut, 'OK');
    assert.ok(d.texte.indexOf(NIR_TEST) < 0, 'NIR visible dans le bilan');
    assert.match(d.texte, /NIR masqué/);

    // essai terminé : paie et dépôt réel avec salaire refusés, néant toujours possible
    lic.etat.statut = 'expire';
    d = await s.appeler('deposer_dsn', { fichier: f.dsnReel, mode: 'reel', confirmation_utilisateur: true });
    assert.equal(d.erreur, true); assert.match(d.texte, /abonnement/); assert.match(d.texte, /abonnement\?s=/);
    assert.equal(ne.etat.depots.filter(function (x) { return x.reel; }).length, 0);
    const p2 = await s.appeler('preparer_dsn', { mois: '2026-10', brut: 1700 });
    assert.equal(p2.erreur, true); assert.match(p2.texte, /non préparée/);
    const sim = await s.appeler('preparer_dsn', { mois: '2026-10', brut: 1700, simuler: true });
    assert.equal(sim.erreur, false, sim.texte);
    const n = await s.appeler('preparer_dsn', { mois: '2026-10', brut: 0 });
    assert.equal(n.erreur, false, n.texte);
    d = await s.appeler('deposer_dsn', { fichier: n.donnees.fichiers.dsnTest, mode: 'test' });
    assert.equal(d.erreur, false, d.texte);
    d = await s.appeler('deposer_dsn', { fichier: n.donnees.fichiers.dsnReel, mode: 'reel', confirmation_utilisateur: true });
    assert.equal(d.erreur, false, 'néant gratuit : ' + d.texte);

    // abonnement actif, puis coupure du service : le cache signé suffit
    lic.etat.statut = 'actif';
    d = await s.appeler('deposer_dsn', { fichier: f.dsnReel, mode: 'reel', confirmation_utilisateur: true });
    assert.equal(d.erreur, false, d.texte);
    lic.etat.panne = true;
    const p3 = await s.appeler('preparer_dsn', { mois: '2026-11', brut: 1700, date_versement: '2026-11-30' });
    assert.equal(p3.erreur, false, p3.texte);

    // rechercher_depots voit les dépôts et le journal
    const rd = await s.appeler('rechercher_depots', { du: '2026-10-20' });
    assert.match(rd.texte, /flux F100000/);

    // aucune sortie du serveur ne contient le NIR
    assert.ok(s.sorties.every(function (l) { return l.indexOf(NIR_TEST) < 0; }), 'NIR dans une sortie du serveur');
  } finally { s.fermer(); ne.fermer(); lic.fermer(); }
});

test('cache de licence falsifié : refusé', async function () {
  const donnees = A.tmp('falsif');
  const lic = await A.fauxLicences();
  lic.etat.panne = true;
  fs.writeFileSync(path.join(donnees, 'licence.json'), JSON.stringify({ x: { jeton: 'abc.def', verifieLe: new Date().toISOString() } }));
  process.env.DSNAP_DONNEES = donnees; process.env.DSNAP_API = lic.env.DSNAP_API; process.env.DSNAP_CLE_LICENCE = lic.env.DSNAP_CLE_LICENCE;
  delete require.cache[require.resolve('../server/lib/licence.js')];
  const L = require('../server/lib/licence.js');
  const r = await L.autoriser('999999998', { version: 't' });
  assert.equal(r.autorise, false);
  assert.equal(r.statut, 'injoignable');
  lic.fermer();
});
