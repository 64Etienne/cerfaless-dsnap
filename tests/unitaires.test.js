'use strict';
/* Tests unitaires : moteur (recalcul indépendant), échéances, PDF, identifiants chiffrés, licences, configuration. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const A = require('./aide.js');

process.env.DSNAP_DONNEES = A.tmp('unit');
process.env.DSNAP_TROUSSEAU = 'fichier';
global.RUB_LABELS = require('../server/lib/rub.json');
const E = require('../server/lib/engine.js');
const P = require('../server/lib/paie.js');
const pdf = require('../server/lib/pdf.js');
const secrets = require('../server/lib/secrets.js');
const L = require('../server/lib/licence.js');
const C = require('../server/lib/configuration.js');
const demo = require('../server/lib/demo.js');
const dossierMod = require('../server/lib/dossier.js');

function etat(brut, o) {
  const st = E.defaultState();
  Object.assign(st.inp, { mois: '2026-06', brut: brut, dateVersement: '2026-06-30', dateConstitution: '2026-07-01', urssafSiret: '53514650000017' }, o || {});
  st.hdr = Object.assign(st.hdr, demo.configuration().entete);
  st.contrat = Object.assign(st.contrat, demo.configuration().contrat);
  st.indiv = Object.assign(st.indiv, demo.configuration().individu);
  st.contact = demo.configuration().contact; st.bank = demo.configuration().banque;
  return st;
}
const pc = function (base, tauxPct) { return Math.round(base * tauxPct); }; // centimes × % → centimes×100

test('moteur : chaque cotisation recalculée indépendamment (brut 2 000 €, sans ACRE)', function () {
  const r = E.compute(etat(200000));
  const B = 200000, csg = Math.round(B * 0.9825);
  const arr = function (base, pct) { return Math.round(base * pct / 100); };
  assert.equal(r.c.csgDed, arr(csg, 6.8)); assert.equal(r.c.csgNd, arr(csg, 2.4)); assert.equal(r.c.crds, arr(csg, 0.5));
  assert.equal(r.c.vpS, arr(B, 6.9)); assert.equal(r.c.vdS, arr(B, 0.4)); assert.equal(r.c.aaS, arr(B, 3.15)); assert.equal(r.c.cegS, arr(B, 0.86)); assert.equal(r.c.apecS, arr(B, 0.024));
  assert.equal(r.c.mal, arr(B, 7)); assert.equal(r.c.malC, arr(B, 6)); assert.equal(r.c.af, arr(B, 3.45)); assert.equal(r.c.afC, arr(B, 1.8));
  assert.equal(r.c.vpP, arr(B, 8.55)); assert.equal(r.c.vdP, arr(B, 2.11)); assert.equal(r.c.csa, arr(B, 0.3)); assert.equal(r.c.fnal, arr(B, 0.1));
  assert.equal(r.c.cfp, arr(B, 0.55)); assert.equal(r.c.ta, arr(B, 0.59)); assert.equal(r.c.aaP, arr(B, 4.72)); assert.equal(r.c.cegP, arr(B, 1.29)); assert.equal(r.c.apecP, arr(B, 0.036));
  assert.equal(r.c.exo, 0, 'pas d\'ACRE par défaut');
  const totSal = r.c.csgDed + r.c.csgNd + r.c.crds + r.c.vpS + r.c.vdS + r.c.aaS + r.c.cegS + r.c.apecS;
  assert.equal(r.totSal, totSal); assert.equal(r.net, B - totSal); assert.equal(r.rnf, r.net + r.c.csgNd + r.c.crds);
  // taux neutre 2026 : net imposable ~1 655 € → tranche 0,50 %
  assert.equal(r.pasBp, E.pasBareme(r.rnf).bp);
  void pc;
});

test('moteur : ACRE, ancien régime (création avant 2026) : totale sous 75 % du plafond, dégressive, nulle au plafond', function () {
  const o = { acreMode: 'auto', acreFin: '2026-10-31', acreRegime: 'ancien' };
  const t = E.compute(etat(150000, o));
  assert.equal(t.acre.zone, 'totale'); assert.equal(t.c.exo, Math.round(150000 * 0.3621));
  assert.equal(t.c.exoS, t.c.vpS + t.c.vdS, 'part salariale exonérée = vieillesse salariale');
  const d = E.compute(etat(350000, o));
  assert.equal(d.acre.zone, 'degressive'); assert.equal(d.c.exo, Math.round((400500 - 350000) * 0.3621 * 3));
  assert.equal(E.compute(etat(400500, o)).c.exo, 0);
  assert.equal(E.compute(etat(150000, { acreMode: 'auto', acreFin: '2026-05-31' })).acre.mode, 'aucune');
  assert.ok(E.compute(etat(150000, { acreMode: 'auto', acreFin: '' })).err.some(function (e) { return /ACRE/.test(e); }));
  // régime déduit de la date de fin : ACRE commencée le 13/11/2025 → ancien régime
  assert.equal(E.compute(etat(150000, { acreMode: 'auto', acreFin: '2026-11-12' })).acre.regime, 'ancien');
});

test('moteur : ACRE, créations depuis le 1er janvier 2026 : exonération ramenée à 25 %', function () {
  const r = E.compute(etat(150000, { acreMode: 'auto', acreFin: '2026-12-31' }));
  assert.equal(r.acre.regime, '2026');
  assert.equal(r.c.exo, Math.round(Math.round(150000 * 0.3621) * 0.25));
  const sal = r.c.vpS + r.c.vdS, pat = r.c.mal + r.c.malC + r.c.af + r.c.afC + r.c.vpP + r.c.vdP;
  assert.equal(r.c.exoS, Math.round(r.c.exo * sal / (sal + pat)));
  const d = E.compute(etat(350000, { acreMode: 'auto', acreFin: '2027-01-31' }));
  assert.equal(d.c.exo, Math.round(Math.round((400500 - 350000) * 0.3621 * 3) * 0.25));
  assert.ok(r.info.some(function (x) { return /25 %/.test(x); }));
});

test('moteur : cas non couverts refusés (plafond, Alsace-Moselle, autre contrat, autre année)', function () {
  assert.ok(E.compute(etat(500000)).err.some(function (e) { return /plafond/.test(e); }));
  const am = etat(200000); am.hdr['S21.G00.11.004'] = '67000';
  assert.ok(E.compute(am).err.some(function (e) { return /Alsace-Moselle/.test(e); }));
  const cdi = etat(200000); cdi.contrat['S21.G00.40.007'] = '01';
  assert.ok(E.compute(cdi).err.some(function (e) { return /mandat social/.test(e); }));
  assert.ok(E.compute(etat(200000, { mois: '2027-01' })).err.some(function (e) { return /2027/.test(e); }));
  assert.ok(E.compute(etat(0, { mois: '2027-01' })).err.some(function (e) { return /P27V01/.test(e); }));
  assert.equal(E.compute(etat(0)).err.length, 0, 'néant 2026 accepté');
});

test('moteur : DSN produite cohérente (S90, test/réel jumeaux, contrôles sans erreur)', function () {
  const st = etat(180000, { acreMode: 'auto', acreFin: '2026-12-31' });
  const r = E.compute(st);
  const t = E.buildDSN(st, r); st.inp.typeEnvoi = '02'; const re = E.buildDSN(st, r);
  assert.equal(t.length, re.length);
  assert.equal(t.find(function (l) { return l.c === 'S90.G00.90.001'; }).v, String(t.length));
  assert.deepEqual(t.filter(function (l) { return l.c !== 'S10.G00.00.005'; }), re.filter(function (l) { return l.c !== 'S10.G00.00.005'; }));
  const err = E.controls(t, { r: r, inp: st.inp }).filter(function (c) { return c.lvl === 'err'; });
  assert.deepEqual(err.map(function (e) { return e.title; }), []);
  assert.ok(E.toText(t).split('\r\n').every(function (l) { return /^S\d{2}\.G\d{2}\.\d{2}\.\d{3},'[\x20-\x7e]*'$/.test(l); }), 'ASCII strict');
  assert.equal(t[0].v, 'DSNAP');
});

test('échéances : le 15 du mois suivant, reporté au jour ouvré', function () {
  assert.equal(P.echeance('2026-09'), '2026-10-15');
  assert.equal(P.echeance('2026-10'), '2026-11-16'); // 15/11/2026 : dimanche
  assert.equal(P.echeance('2026-07'), '2026-08-17'); // 15/08/2026 : samedi (et Assomption)
  assert.equal(P.echeance('2026-12'), '2027-01-15');
  assert.equal(P.echeance('2026-02'), '2026-03-16'); // 15/03/2026 : dimanche
});

test('PDF : document valide, accents et euro encodés en WinAnsi', function () {
  const d = pdf.document({ titre: 'Essai é €' });
  const p = d.page();
  p.texte(40, 40, 'Rémunération brute : 1 234,56 € — Écart (test) \\ fin', { gras: true });
  p.paragraphe(40, 60, 'Un texte assez long pour être coupé en plusieurs lignes, avec des accents éèàçù et des symboles × ² ≤.', 200);
  p.ligne(40, 100, 200, 100); p.rect(40, 110, 100, 20, { fond: [0.9, 0.9, 0.9], bord: [0, 0, 0] });
  const buf = d.fin();
  const t = buf.toString('latin1');
  assert.ok(t.startsWith('%PDF-1.4')); assert.ok(t.trim().endsWith('%%EOF'));
  const xref = +/startxref\n(\d+)/.exec(t)[1];
  assert.equal(t.slice(xref, xref + 4), 'xref');
  assert.ok(pdf.largeur('W', 10, false) > pdf.largeur('i', 10, false));
});

test('identifiants : chiffrés sur le disque, relus, effacés', async function () {
  const nom = await secrets.ecrire({ siret: '99999999800001', nom: 'Test', prenom: 'Élodie', motdepasse: 'P@ss€ word' });
  assert.match(nom, /fichier chiffré/);
  const brut = fs.readdirSync(process.env.DSNAP_DONNEES).map(function (f) { try { return fs.readFileSync(path.join(process.env.DSNAP_DONNEES, f), 'utf8'); } catch (e) { return ''; } }).join('');
  assert.ok(brut.indexOf('P@ss') < 0);
  secrets.oublierCache();
  const lu = await secrets.lire();
  assert.equal(lu.motdepasse, 'P@ss€ word'); assert.equal(lu.prenom, 'Élodie');
  await secrets.effacer();
  assert.equal(await secrets.lire(), null);
});

test('licence : jeton signé vérifié, jeton modifié ou d\'un autre SIREN refusé', function () {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  process.env.DSNAP_CLE_LICENCE = publicKey.export({ type: 'spki', format: 'pem' });
  delete require.cache[require.resolve('../server/lib/licence.js')];
  const L2 = require('../server/lib/licence.js');
  const h = L2.empreinteSiren('999999998');
  const signer = function (o) { const p = Buffer.from(JSON.stringify(o)).toString('base64url'); return p + '.' + crypto.sign(null, Buffer.from(p), privateKey).toString('base64url'); };
  const j = signer({ v: 1, s: h, st: 'actif', fin: '2030-01-01T00:00:00Z' });
  assert.equal(L2.verifierJeton(j, h).st, 'actif');
  assert.equal(L2.verifierJeton(j, L2.empreinteSiren('123456789')), null);
  const [p, s] = j.split('.');
  const faux = Buffer.from(JSON.stringify({ v: 1, s: h, st: 'actif', fin: '2099-01-01T00:00:00Z' })).toString('base64url') + '.' + s;
  assert.equal(L2.verifierJeton(faux, h), null);
  void p; void L;
});

test('configuration : formulaire → dsnap.json → formulaire (aller-retour, NIR jamais relu)', function () {
  const f = A.formulaireTest();
  const cfg = C.construireConfig(f, null, null);
  assert.equal(cfg.individu['S21.G00.30.001'], '1850731005001');
  assert.equal(cfg.individu['S21.G00.30.014'], '31');
  assert.equal(cfg.individu['S21.G00.30.005'], '01');
  assert.equal(cfg.entete['S21.G00.06.001'], '999999998');
  assert.equal(cfg.contrat['S21.G00.40.019'], '99999999800001');
  assert.equal(cfg.contrat['S21.G00.40.009'], 'PRES20251001');
  assert.throws(function () { C.construireConfig(Object.assign({}, f, { siret: '123' }), null); }, /SIRET/);
  assert.throws(function () { C.construireConfig(Object.assign({}, f, { nir: '' }), null); }, /sécurité sociale/);
  const d = dossierMod.ouvrir(A.tmp('cfg'));
  d.ecrireConfig(cfg);
  const st = P.etatDepuisConfig(d, cfg, '1.0.0').st;
  const retour = C.versFormulaire(st, cfg);
  assert.equal(retour.nir, ''); assert.equal(retour.nirEnregistre, true);
  ['raisonSociale', 'siret', 'ape', 'codePostal', 'nomNaissance', 'dateNaissance', 'debutMandat', 'pcs', 'urssafSiret'].forEach(function (k) { assert.equal(String(retour[k]).toUpperCase(), String(f[k]).toUpperCase(), k); });
  const r = P.preparer({ dossier: d, cfg: cfg, mois: '2026-09', brut: 1500, simuler: true });
  assert.equal(r.pret, true, r.erreurs.join(' | '));
});

test('démonstration : société fictive valide (SIREN, SIRET et NIR à clé correcte)', function () {
  assert.ok(E.luhn(demo.SIREN)); assert.ok(E.luhn(demo.SIREN + demo.NIC));
  const d = dossierMod.ouvrir(A.tmp('demo-u'));
  d.ecrireConfig(demo.configuration());
  const r = P.preparer({ dossier: d, cfg: d.lireConfig(), mois: '2026-09', brut: 2000, simuler: true });
  assert.equal(r.pret, true, r.erreurs.join(' | '));
});

test('dossier : chemins hors du dossier refusés, anciens fichiers paie-dsn lus', function () {
  const racine = A.tmp('dos');
  const d = dossierMod.ouvrir(racine);
  assert.throws(function () { d.dans('../x'); }, /hors du dossier/);
  assert.throws(function () { d.dans('/etc/passwd'); }, /hors du dossier/);
  fs.writeFileSync(path.join(racine, 'paie-dsn.json'), JSON.stringify({ client: 'ANCIEN' }));
  fs.writeFileSync(path.join(racine, 'paie-dsn-etat.json'), JSON.stringify({ ordre: { '2026-10': 3 } }));
  assert.equal(d.lireConfig().client, 'ANCIEN');
  assert.equal(d.lireEtat().ordre['2026-10'], 3);
  void os;
});
