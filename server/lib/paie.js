// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Paie d'un mois pour une société du dossier : calcul, DSN (fichiers TEST et RÉEL, ne différant que par
 * S10.G00.00.005), bulletin de paie et note de frais en PDF, récapitulatif JSON, contrôles.
 *
 * L'identité, l'en-tête et le contrat viennent de la configuration (dsnap.json) et, si elle est indiquée, de la
 * dernière DSN acceptée (dsnReference). Le NIR n'apparaît dans aucune sortie : il est masqué partout.
 */
const fs = require('fs');
const path = require('path');
global.RUB_LABELS = global.RUB_LABELS || require('./rub.json');
const E = require('./engine.js');
const { masqueur, nirsDuTexte } = require('./confidentialite.js');
const pdf = require('./pdf.js');

const MOIS = ['Janvier', 'Fevrier', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Aout', 'Septembre', 'Octobre', 'Novembre', 'Decembre'];
const MOIS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function fail(msg) { const e = new Error(msg); e.utilisateur = true; return e; }
function euros(v, def) { if (v === undefined || v === null || v === '') return def; const n = Number(String(v).replace(/\s/g, '').replace(',', '.')); if (!isFinite(n) || n < 0) throw fail('Montant invalide : ' + v); return Math.round(n * 100); }
function nombre(v, def) { if (v === undefined || v === null || v === '') return def; const n = Number(String(v).replace(',', '.')); if (!isFinite(n)) throw fail('Nombre invalide : ' + v); return n; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function isoJour(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }

/* ------------------------------------------------------------------ échéance de dépôt */
function feriesFr(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3),
    h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  const p = Date.UTC(y, mo - 1, da), j = 86400000, s = new Set();
  [[1, 1], [5, 1], [5, 8], [7, 14], [8, 15], [11, 1], [11, 11], [12, 25]].forEach(function (x) { s.add(Date.UTC(y, x[0] - 1, x[1])); });
  [p + j, p + 39 * j, p + 50 * j].forEach(function (x) { s.add(x); });
  return s;
}
/** Date limite de la DSN d'un mois (entreprise de moins de 50 salariés) : le 15 du mois suivant, reportée au jour ouvré suivant. */
function echeance(mois) {
  const m = /^(\d{4})-(\d{2})$/.exec(mois);
  let y = +m[1], mm = +m[2] + 1; if (mm > 12) { mm = 1; y++; }
  let t = Date.UTC(y, mm - 1, 15);
  const F = feriesFr(y);
  while ([0, 6].indexOf(new Date(t).getUTCDay()) >= 0 || F.has(t)) t += 86400000;
  const d = new Date(t);
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate());
}

/* ------------------------------------------------------------------ état de départ : référence + configuration */
function etatDepuisConfig(dossier, cfg, version) {
  const st = E.defaultState();
  let ref = { inp: {} }, texteRef = '';
  if (cfg.dsnReference) {
    const refPath = dossier.dans(cfg.dsnReference);
    if (!fs.existsSync(refPath)) throw fail('DSN de référence introuvable dans le dossier : ' + cfg.dsnReference);
    texteRef = fs.readFileSync(refPath).toString('latin1');
    const p = E.parseDSN(texteRef, 'iso-8859-1');
    ref = E.extract(p.lines);
    Object.assign(st.hdr, ref.hdr); Object.assign(st.contrat, ref.contrat); Object.assign(st.indiv, ref.indiv);
    Object.assign(st.contact, ref.contact); if (ref.bank && ref.bank.iban) Object.assign(st.bank, ref.bank);
  }
  Object.assign(st.hdr, cfg.entete || {}); Object.assign(st.contrat, cfg.contrat || {}); Object.assign(st.indiv, cfg.individu || {});
  Object.assign(st.contact, cfg.contact || {}); Object.assign(st.bank, cfg.banque || {});
  // rubriques déduites les unes des autres (société à un seul établissement)
  const h = st.hdr;
  const sub = function (a, b) { if (!h[a] && h[b]) h[a] = h[b]; };
  sub('S21.G00.06.001', 'S10.G00.01.001'); sub('S10.G00.01.001', 'S21.G00.06.001');
  sub('S21.G00.11.001', 'S10.G00.01.002'); sub('S10.G00.01.002', 'S21.G00.11.001'); sub('S21.G00.06.002', 'S21.G00.11.001');
  sub('S21.G00.11.002', 'S21.G00.06.003'); sub('S21.G00.06.003', 'S21.G00.11.002');
  sub('S21.G00.11.003', 'S21.G00.06.004'); sub('S21.G00.11.004', 'S21.G00.06.005'); sub('S21.G00.11.005', 'S21.G00.06.006');
  sub('S21.G00.06.004', 'S21.G00.11.003'); sub('S21.G00.06.005', 'S21.G00.11.004'); sub('S21.G00.06.006', 'S21.G00.11.005');
  sub('S10.G00.01.004', 'S21.G00.06.004'); sub('S10.G00.01.005', 'S21.G00.06.005'); sub('S10.G00.01.006', 'S21.G00.06.006');
  if (!st.contrat['S21.G00.40.019'] && h['S21.G00.06.001'] && h['S21.G00.11.001']) st.contrat['S21.G00.40.019'] = h['S21.G00.06.001'] + h['S21.G00.11.001'];
  h['S10.G00.00.001'] = 'DSNAP'; h['S10.G00.00.002'] = 'SASU EBO'; h['S10.G00.00.003'] = version || '1.0.0';
  return { st: st, ref: ref, texteRef: texteRef };
}

/* ------------------------------------------------------------------ documents PDF */
const GRIS = [0.42, 0.45, 0.5], ENCRE = [0.07, 0.09, 0.13], FOND = [0.95, 0.96, 0.97], ACCENT = [0.05, 0.42, 0.36], ACCENT_FOND = [0.9, 0.96, 0.94];
function blocEntete(p, st, recap, inp, nomComplet, y) {
  const h = st.hdr;
  p.rect(40, y, 250, 88, { bord: [0.8, 0.8, 0.8] }).rect(305, y, 250, 88, { bord: [0.8, 0.8, 0.8] });
  p.texte(50, y + 16, h['S10.G00.01.003'] || recap.client || '', { gras: true, taille: 10 });
  p.texte(50, y + 30, [h['S21.G00.11.003'] || h['S10.G00.01.004'] || '', ((h['S21.G00.11.004'] || h['S10.G00.01.005'] || '') + ' ' + (h['S21.G00.11.005'] || h['S10.G00.01.006'] || '')).trim()].filter(Boolean).join(', '), { taille: 8.5 });
  p.texte(50, y + 43, 'SIRET ' + (h['S21.G00.06.001'] || '') + (h['S21.G00.11.001'] || '') + ' · APE ' + (h['S21.G00.11.002'] || h['S21.G00.06.003'] || ''), { taille: 8.5 });
  p.texte(50, y + 56, 'Convention collective : ' + (h['S21.G00.11.022'] === '9999' || !h['S21.G00.11.022'] ? 'aucune' : 'IDCC ' + h['S21.G00.11.022']), { taille: 8.5 });
  p.texte(50, y + 69, 'Urssaf (SIRET) : ' + (inp.urssafSiret || ''), { taille: 8.5 });
  p.texte(315, y + 16, nomComplet, { gras: true, taille: 10 });
  p.texte(315, y + 30, 'Emploi : ' + (st.contrat['S21.G00.40.006'] || 'Président'), { taille: 8.5 });
  p.texte(315, y + 43, 'Mandat social, assimilé salarié (cadre)', { taille: 8.5 });
  const d = E.parseDMY(st.contrat['S21.G00.40.001']);
  p.texte(315, y + 56, 'Début du mandat : ' + (d ? E.fr(d) : '—'), { taille: 8.5 });
  p.texte(315, y + 69, 'N° de sécurité sociale : figure dans la DSN (non reproduit)', { taille: 8.5, couleur: GRIS });
  return y + 100;
}
function eurTxt(c) { return c === null || c === undefined ? '' : E.eur(c, true); }
function bulletinPdf(r, st, recap, inp, nomComplet, libMois) {
  const doc = pdf.document({ titre: 'Bulletin de paie ' + libMois });
  const p = doc.page();
  p.texte(40, 52, 'Bulletin de paie', { gras: true, taille: 18 });
  p.texte(40, 68, 'Période du ' + E.fr(r.debut) + ' au ' + E.fr(r.fin) + ' · paiement le ' + E.fr(r.dv) + ' par virement', { taille: 9, couleur: GRIS });
  p.texte(555, 52, libMois.charAt(0).toUpperCase() + libMois.slice(1), { taille: 11, gras: true, align: 'right', couleur: ACCENT });
  let y = blocEntete(p, st, recap, inp, nomComplet, 82);
  const cols = [40, 226, 298, 360, 424, 486, 555];
  p.rect(40, y, 515, 18, { fond: FOND });
  ['Rubrique', 'Base', 'Taux sal.', 'Part salarié', 'Taux empl.', 'Part employeur'].forEach(function (t, i) {
    if (i === 0) p.texte(46, y + 12, t, { gras: true, taille: 8 }); else p.texte(cols[i + 1] - 4, y + 12, t, { gras: true, taille: 8, align: 'right' });
  });
  y += 18;
  E.bulletin(r).forEach(function (x) {
    const h = 15;
    if (x.g === 'brut') {
      p.texte(46, y + 11, x.lab, { gras: true, taille: 8.5 }); p.texte(cols[2] - 4, y + 11, eurTxt(x.brut), { gras: true, taille: 8.5, align: 'right' });
    } else {
      p.texte(46, y + 11, x.lab, { taille: 8.5 });
      p.texte(cols[2] - 4, y + 11, String(x.base || ''), { taille: 8.5, align: 'right' });
      if (x.ts !== undefined) p.texte(cols[3] - 4, y + 11, E.pct(x.ts), { taille: 8.5, align: 'right' });
      if (x.ms !== undefined && x.ms !== null) p.texte(cols[4] - 4, y + 11, eurTxt(x.ms), { taille: 8.5, align: 'right' });
      if (x.tp !== undefined) p.texte(cols[5] - 4, y + 11, E.pct(x.tp), { taille: 8.5, align: 'right' });
      if (x.mp !== undefined && x.mp !== null) p.texte(cols[6] - 4, y + 11, eurTxt(x.mp), { taille: 8.5, align: 'right' });
    }
    p.ligne(40, y + h, 555, y + h, { couleur: [0.88, 0.88, 0.88] });
    y += h;
  });
  p.ligne(40, y + 1, 555, y + 1, { couleur: ENCRE, epaisseur: 1 });
  p.texte(46, y + 14, 'Total des cotisations et contributions', { gras: true, taille: 8.5 });
  p.texte(cols[4] - 4, y + 14, eurTxt(r.totSal), { gras: true, taille: 8.5, align: 'right' });
  p.texte(cols[6] - 4, y + 14, eurTxt(r.totPat), { gras: true, taille: 8.5, align: 'right' });
  y += 30;
  const lignes = [
    ['Net à payer avant impôt sur le revenu', r.net],
    ['Net imposable', r.rnf],
    ['Impôt sur le revenu prélevé à la source (taux ' + E.bpPct(r.pasBp) + (r.pasType === '13' ? ', taux non personnalisé' : '') + ')', -r.pas],
    ['Net payé avant retenue des titres-restaurant', r.netApresImpot]
  ];
  if (r.trSal) lignes.push(['Titres-restaurant, part salariale (' + r.trNb + ' × ' + E.eur(r.trSalU) + ')', -r.trSal]);
  lignes.forEach(function (l) { p.texte(46, y + 11, l[0], { taille: 9 }); p.texte(549, y + 11, E.eur(l[1]), { taille: 9, align: 'right' }); p.ligne(40, y + 15, 555, y + 15, { couleur: [0.9, 0.9, 0.9] }); y += 16; });
  p.rect(40, y + 2, 515, 22, { fond: ACCENT_FOND });
  p.texte(46, y + 17, 'Net payé (virement)', { gras: true, taille: 11 }); p.texte(549, y + 17, E.eur(r.netPaye), { gras: true, taille: 11, align: 'right' });
  y += 34;
  [['Montant net social', r.mns], ['Total des allègements et exonérations de cotisations (ACRE)', r.c.exo], ['Coût total pour l\'employeur', r.coutSalaire]].forEach(function (l) {
    p.texte(46, y + 11, l[0], { taille: 9 }); p.texte(549, y + 11, E.eur(l[1]), { taille: 9, align: 'right' }); y += 16;
  });
  y += 14;
  y = p.paragraphe(40, y, 'Dans votre intérêt et pour vous aider à faire valoir vos droits, conservez ce bulletin de paie sans limitation de durée. Rubrique dédiée au bulletin de paie sur le portail www.service-public.fr.', 515, { taille: 7.5, couleur: GRIS });
  p.texte(40, 815, 'Établi avec DSNap — calcul conforme aux règles ' + E.P.annee + ' pour un président de SASU assimilé salarié.', { taille: 7, couleur: GRIS });
  return doc.fin();
}
function noteFraisPdf(r, st, recap, inp, nomComplet, libMois) {
  const doc = pdf.document({ titre: 'Note de frais ' + libMois });
  const p = doc.page();
  p.texte(40, 52, 'Note de frais — ' + libMois, { gras: true, taille: 18 });
  let y = blocEntete(p, st, recap, inp, nomComplet, 70);
  y = p.paragraphe(40, y + 4, 'Frais professionnels remboursés au réel. Quote-part du logement : ' + r.frais.prorataTxt + ' = ' + E.bpPct(E.rhu(r.frais.prorataMilli, 10)) + ' du loyer, de l\'électricité et de l\'assurance ; part professionnelle de la box ' + inp.usageBox + ' %, du mobile ' + inp.usageMobile + ' %.', 515, { taille: 9 });
  y += 8;
  p.rect(40, y, 515, 18, { fond: FOND });
  p.texte(46, y + 12, 'Dépense', { gras: true, taille: 8.5 }); p.texte(470, y + 12, 'Facture', { gras: true, taille: 8.5, align: 'right' }); p.texte(549, y + 12, 'Remboursé', { gras: true, taille: 8.5, align: 'right' });
  y += 18;
  r.frais.lines.forEach(function (l) {
    p.texte(46, y + 12, l.label, { taille: 9 }); p.texte(470, y + 12, E.eur(l.montant), { taille: 9, align: 'right' }); p.texte(549, y + 12, E.eur(l.v), { taille: 9, gras: true, align: 'right' });
    p.texte(46, y + 24, l.calc, { taille: 7.5, couleur: GRIS });
    p.ligne(40, y + 30, 555, y + 30, { couleur: [0.88, 0.88, 0.88] });
    y += 30;
  });
  p.rect(40, y + 4, 515, 22, { fond: ACCENT_FOND });
  p.texte(46, y + 19, 'Total à rembourser', { gras: true, taille: 11 }); p.texte(549, y + 19, E.eur(r.frais.total), { gras: true, taille: 11, align: 'right' });
  y += 44;
  p.texte(40, y, 'Remboursement par virement le ' + E.fr(r.dv) + '. Justificatifs joints : quittance de loyer et factures du mois.', { taille: 9 });
  y += 60;
  p.ligne(40, y, 270, y, { couleur: ENCRE }); p.ligne(325, y, 555, y, { couleur: ENCRE });
  p.texte(40, y + 14, 'Le bénéficiaire : ' + nomComplet, { taille: 9 }); p.texte(325, y + 14, 'Pour la société : ' + (st.hdr['S10.G00.01.003'] || ''), { taille: 9 });
  p.texte(40, 815, 'Établi avec DSNap.', { taille: 7, couleur: GRIS });
  return doc.fin();
}

/* ------------------------------------------------------------------ préparation d'un mois */
/**
 * o : { dossier (objet de dossier.js), cfg, mois 'AAAA-MM', brut (euros, 0 = néant), dateVersement, dateConstitution,
 *       numero, tr, loyer, elec, box, mobile, assurance, pasTaux, pasId, acre, simuler, budgetMax,
 *       controleurTables (nomenclatures.controleur), version, maintenant }
 */
function preparer(o) {
  const cfg = o.cfg || {};
  const ch = cfg.choix || {}, fdef = cfg.facturesParDefaut || {}, auto = cfg.automatisation || {};
  const m = /^(\d{4})-(\d{2})$/.exec(String(o.mois || ''));
  if (!m || +m[2] < 1 || +m[2] > 12) throw fail('Mois invalide (format AAAA-MM) : ' + o.mois);
  const Y = +m[1], M = +m[2];
  const base = etatDepuisConfig(o.dossier, cfg, o.version);
  const st = base.st, ref = base.ref;
  if (!st.contrat['S21.G00.40.001'] && !base.texteRef) { /* contrat incomplet : signalé par les contrôles */ }

  let brut = euros(o.brut, auto.brut && auto.brut.mode === 'fixe' ? euros(auto.brut.valeur, null) : null);
  if (brut === null && !o.budgetMax) throw fail('Brut du mois manquant (0 pour une DSN néant).');
  const auj = o.maintenant || new Date(), dim = new Date(Date.UTC(Y, M, 0)).getUTCDate();
  const dansMois = auj.getFullYear() === Y && auj.getMonth() + 1 === M;
  const dv = o.dateVersement || (dansMois ? isoJour(auj) : Y + '-' + pad2(M) + '-' + pad2(dim));
  const dc = o.dateConstitution || isoJour(auj);
  if (!E.parseISO(dv) || !E.parseISO(dc)) throw fail('Date invalide (format AAAA-MM-JJ).');
  const avecSalaire = (brut || 0) > 0;
  const jo = E.joursOuvres(Y, M).n;
  const pas = cfg.pas || {};
  Object.assign(st.inp, {
    mois: o.mois, brut: brut || 0, dateVersement: dv, dateConstitution: dc, typeEnvoi: '01',
    acreMode: o.acre || ch.acreMode || 'aucune', acreFin: ch.acreFin || '', acreRegime: ch.acreRegime || '',
    pasMode: o.pasTaux !== undefined && o.pasTaux !== null && o.pasTaux !== '' ? 'dgfip' : (pas.mode || 'bareme'),
    pasTaux: Math.round(nombre(o.pasTaux !== undefined && o.pasTaux !== null && o.pasTaux !== '' ? o.pasTaux : pas.taux, 0) * 100),
    pasId: String(o.pasId || pas.id || ''),
    atTaux: Math.round(nombre(ch.tauxAT, 0) * 1000), urssafSiret: cfg.urssafSiret || ref.inp.urssafSiret || '',
    trNb: o.tr !== undefined && o.tr !== null && o.tr !== '' ? Math.round(nombre(o.tr, 0)) : (avecSalaire && ch.trJoursOuvres !== false && ch.trFaciale ? jo : 0), trAuto: false,
    trFaciale: euros(ch.trFaciale, 0), trPartPat: nombre(ch.trPartPat, 0),
    loyer: euros(o.loyer, avecSalaire ? euros(fdef.loyer, 0) : 0), elec: euros(o.elec, avecSalaire ? euros(fdef.elec, 0) : 0),
    box: euros(o.box, avecSalaire ? euros(fdef.box, 0) : 0), mobile: euros(o.mobile, avecSalaire ? euros(fdef.mobile, 0) : 0),
    assurance: euros(o.assurance, avecSalaire ? euros(fdef.assurance, 0) : 0),
    surfTotale: nombre(ch.surfTotale, 0), surfBureau: nombre(ch.surfBureau, 0), usagePro: nombre(ch.usagePro, 0),
    usageBox: nombre(ch.usageBox, 0), usageMobile: nombre(ch.usageMobile, 0), budgetCible: euros(ch.budgetMensuel, 0)
  });
  const inp = st.inp;

  /* brut maximal pour le budget */
  if (o.budgetMax) {
    const cible = o.budget !== undefined && o.budget !== null ? euros(o.budget, 0) : inp.budgetCible;
    if (!cible) throw fail('Aucun budget mensuel : indiquez « budget » ou renseignez-le dans la configuration.');
    const s = E.clone(st);
    if (o.tr === undefined || o.tr === null || o.tr === '') s.inp.trNb = ch.trJoursOuvres !== false && ch.trFaciale ? jo : 0;
    ['loyer', 'elec', 'box', 'mobile', 'assurance'].forEach(function (k) { if (o[k] === undefined || o[k] === null) s.inp[k] = euros(fdef[k], 0); });
    const cout = function (b) { s.inp.brut = b; return E.compute(s).budget; };
    let lo = 0, hi = E.P.pmss;
    if (cout(0) > cible) return { mois: o.mois, budget: cible / 100, brutMax: null, message: 'Les frais et les titres-restaurant dépassent déjà le budget.' };
    if (cout(hi) <= cible) lo = hi; else while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (cout(mid) <= cible) lo = mid; else hi = mid; }
    const best = Math.floor(lo / 100) * 100;
    s.inp.brut = best; const rb = E.compute(s);
    return { mois: o.mois, budget: cible / 100, brutMax: best / 100, coutTotal: rb.budget / 100, salaireVire: rb.netPaye / 100, fraisRembourses: rb.frais.total / 100, acre: rb.acre.mode, plafond: best >= E.P.pmss ? 'brut limité au plafond mensuel de la Sécurité sociale (' + E.eur(E.P.pmss) + '), maximum géré par DSNap' : null };
  }

  /* numéro d'ordre : rang parmi les DSN fabriquées ce mois civil */
  const etat = o.dossier.lireEtat();
  const cleMois = dc.slice(0, 7);
  const numero = o.numero !== undefined && o.numero !== null && o.numero !== '' ? parseInt(o.numero, 10) : (etat.ordre[cleMois] || 0) + 1;
  if (!(numero >= 1)) throw fail('Numéro d\'ordre invalide : ' + o.numero);
  inp.numeroOrdre = String(numero);

  const r = E.compute(st);
  const dsnTest = E.buildDSN(st, r);
  st.inp.typeEnvoi = '02';
  const dsnReel = E.buildDSN(st, r);
  st.inp.typeEnvoi = '01';
  const ctl = E.controls(dsnTest, { r: r, inp: st.inp, nomenclatures: o.controleurTables || null });
  const masquerNir = masqueur(nirsDuTexte(E.toText(dsnTest)).concat([st.indiv['S21.G00.30.001'] || '']).concat(base.texteRef ? nirsDuTexte(base.texteRef) : []));
  const normeDsn = String((dsnTest.find(function (l) { return l.c === 'S10.G00.00.006'; }) || {}).v || '');
  const jeuNm = normeDsn && o.controleurTables ? o.controleurTables.jeu(normeDsn) : null;
  const fmt = function (x) { return masquerNir(x.title + (x.detail ? ' — ' + x.detail : '')); };
  const erreurs = ctl.filter(function (c) { return c.lvl === 'err'; });
  const vigilance = ctl.filter(function (c) { return c.lvl === 'warn' || c.lvl === 'info'; });
  const libMois = MOIS_FR[M - 1] + ' ' + Y;
  const nomBase = o.mois + ' ' + MOIS[M - 1];
  const dirMois = o.dossier.dossierMois(o.mois);
  const noms = {
    dsnTest: 'DSN ' + nomBase + ' - TEST.txt', dsnReel: 'DSN ' + nomBase + ' - REEL.txt', recap: 'Paie ' + nomBase + ' - recapitulatif.json',
    bulletin: r.B > 0 ? 'Bulletin de paie ' + MOIS[M - 1] + ' ' + Y + '.pdf' : null,
    noteFrais: r.frais.total > 0 ? 'Note de frais ' + MOIS[M - 1] + ' ' + Y + '.pdf' : null
  };
  const rel = function (n) { return n ? o.dossier.relatif(path.join(dirMois, n)) : null; };
  const fichiers = { dsnTest: rel(noms.dsnTest), dsnReel: rel(noms.dsnReel), recap: rel(noms.recap), bulletin: rel(noms.bulletin), noteFrais: rel(noms.noteFrais) };
  const c = r.c;
  const nomComplet = ((st.indiv['S21.G00.30.004'] || '') + ' ' + (st.indiv['S21.G00.30.002'] || '')).trim();
  const nir = String(st.indiv['S21.G00.30.001'] || '');
  const ech = echeance(o.mois);
  const recap = {
    client: cfg.client || st.hdr['S10.G00.01.003'] || '', mois: o.mois, libelle: libMois, type: r.neant ? 'DSN néant (sans individu)' : 'DSN mensuelle normale',
    numeroOrdre: numero, dateConstitution: dc, dateVersement: r.B > 0 ? dv : null, echeanceDepot: ech,
    salarie: { nom: nomComplet, nir: nir ? 'présent (masqué)' : 'absent' },
    entrees: { brut: r.B / 100, titresRestaurant: r.trNb, joursOuvres: jo, factures: { loyer: inp.loyer / 100, elec: inp.elec / 100, box: inp.box / 100, mobile: inp.mobile / 100, assurance: inp.assurance / 100 }, pas: { mode: inp.pasMode, tauxPourcent: r.pasBp / 100 }, acre: r.acre.mode + '/' + r.acre.zone },
    resultats: {
      cotisationsSalariales: r.totSal / 100, chargesPatronalesAvantExo: r.totPatBrut / 100, exonerationAcre: c.exo / 100, chargesPatronales: r.totPat / 100,
      netAvantImpot: r.net / 100, netImposable: r.rnf / 100, pas: r.pas / 100, netApresImpot: r.netApresImpot / 100, partSalarieeTitres: r.trSal / 100,
      virementSalaire: r.netPaye / 100, fraisRembourses: r.frais.total / 100, partSocieteTitres: r.trPat / 100, coutSalaire: r.coutSalaire / 100,
      coutTotalMois: r.budget / 100, budgetMensuel: inp.budgetCible / 100, bordereauUrssaf: r.bordereau / 100, agircArrcoApec: r.aaTotal / 100, montantNetSocial: r.mns / 100
    },
    virements: r.virements.map(function (v) { return { qui: v.qui, quoi: v.quoi, montant: v.montant / 100, quand: v.quand, detail: v.detail }; }),
    frais: r.frais.lines.map(function (l) { return { depense: l.label, facture: l.montant / 100, rembourse: l.v / 100, calcul: l.calc }; }),
    cotisationsUrssafParCTP: r.ctp.map(function (t) { return { ctp: t.code, qualifiant: t.q, calcul: t.calc, du: t.du / 100 }; }),
    controles: { erreurs: erreurs.map(fmt), vigilance: vigilance.map(fmt), reussis: ctl.filter(function (x) { return x.lvl === 'ok'; }).length },
    nomenclatures: jeuNm ? { norme: jeuNm.norme, version: jeuNm.version, date: jeuNm.datePublication, origine: jeuNm.origine } : null,
    fichiers: fichiers, lignesDSN: dsnTest.length
  };
  if (!o.simuler) {
    fs.mkdirSync(dirMois, { recursive: true });
    fs.writeFileSync(path.join(dirMois, noms.dsnTest), Buffer.from(E.toLatin1(E.toText(dsnTest))));
    fs.writeFileSync(path.join(dirMois, noms.dsnReel), Buffer.from(E.toLatin1(E.toText(dsnReel))));
    fs.writeFileSync(path.join(dirMois, noms.recap), JSON.stringify(recap, null, 2));
    if (noms.bulletin) fs.writeFileSync(path.join(dirMois, noms.bulletin), bulletinPdf(r, st, recap, inp, nomComplet, libMois));
    if (noms.noteFrais) fs.writeFileSync(path.join(dirMois, noms.noteFrais), noteFraisPdf(r, st, recap, inp, nomComplet, libMois));
    etat.ordre[cleMois] = Math.max(etat.ordre[cleMois] || 0, numero);
    o.dossier.ecrireEtat(etat);
  }
  return {
    pret: erreurs.length === 0, mois: o.mois, libelle: libMois, type: recap.type, neant: r.neant, numeroOrdre: numero, lignesDSN: dsnTest.length,
    echeanceDepot: ech, simulation: !!o.simuler, fichiers: o.simuler ? null : fichiers,
    resultats: recap.resultats, virements: recap.virements, frais: recap.frais, erreurs: recap.controles.erreurs, vigilance: recap.controles.vigilance,
    controlesReussis: recap.controles.reussis, nomenclatures: recap.nomenclatures
  };
}

function encodage(buf) {
  let haut = false;
  for (let i = 0; i < buf.length; i++) {
    const x = buf[i];
    if (x < 0x80) continue;
    haut = true;
    const n = (x & 0xE0) === 0xC0 ? 1 : (x & 0xF0) === 0xE0 ? 2 : 0;
    if (n && i + n < buf.length && (buf[i + 1] & 0xC0) === 0x80 && (n === 1 || (buf[i + 2] & 0xC0) === 0x80)) return 'utf-8';
  }
  return haut ? 'iso-8859-1' : 'ascii';
}
/** Contrôle complet d'un fichier DSN (produit par DSNap ou par un autre logiciel). */
function controlerFichier(buf, o) {
  o = o || {};
  const texte = buf.toString('latin1');
  const masquerNir = masqueur(nirsDuTexte(texte));
  let parse;
  try { parse = E.parseDSN(texte, encodage(buf)); }
  catch (e) { throw fail(masquerNir('Fichier DSN illisible : ' + e.message)); }
  const lignes = parse.lines;
  const one = function (cd) { const l = lignes.find(function (x) { return x.c === cd; }); return l ? l.v : null; };
  const ctl = E.controls(lignes, { parse: parse, nomenclatures: o.controleurTables || null });
  const norme = one('S10.G00.00.006');
  const jeu = norme && o.controleurTables ? o.controleurTables.jeu(norme) : null;
  const fmt = function (x) { return masquerNir(x.title + (x.detail ? ' — ' + x.detail : '')); };
  const erreurs = ctl.filter(function (x) { return x.lvl === 'err'; });
  const mois = (one('S20.G00.05.005') || '').replace(/^\d{2}(\d{2})(\d{4})$/, '$2-$1');
  return {
    pret: erreurs.length === 0, type: one('S10.G00.00.005') === '01' ? 'test' : one('S10.G00.00.005') === '02' ? 'réel' : '?',
    declaration: one('S20.G00.05.002') === '02' ? 'néant' : 'normale', mois: mois, echeanceDepot: /^\d{4}-\d{2}$/.test(mois) ? echeance(mois) : null, norme: norme, lignes: lignes.length,
    erreurs: erreurs.map(fmt), vigilance: ctl.filter(function (x) { return x.lvl === 'warn'; }).map(fmt), informations: ctl.filter(function (x) { return x.lvl === 'info'; }).map(fmt),
    reussis: ctl.filter(function (x) { return x.lvl === 'ok'; }).length,
    nomenclatures: jeu ? { norme: jeu.norme, version: jeu.version, date: jeu.datePublication, origine: jeu.origine } : null
  };
}

/** Extrait d'une DSN importée ce qui sert à la configuration (rien n'est renvoyé au modèle : page locale seulement). */
function extraireReference(buf) {
  const texte = buf.toString('latin1');
  const p = E.parseDSN(texte, 'iso-8859-1');
  if (!p.lines.length || p.lines[0].c !== 'S10.G00.00.001') throw fail('Ce fichier n\'est pas une DSN (il doit commencer par S10.G00.00.001).');
  const x = E.extract(p.lines);
  delete x.hdr['S10.G00.00.001']; delete x.hdr['S10.G00.00.002']; delete x.hdr['S10.G00.00.003'];
  ['S10.G00.00.005', 'S10.G00.00.006', 'S10.G00.00.007', 'S10.G00.00.008'].forEach(function (k) { delete x.hdr[k]; });
  return x;
}

module.exports = { preparer, controlerFichier, extraireReference, etatDepuisConfig, echeance, MOIS, MOIS_FR };
