// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
/* =====================================================================
   DSNap — noyau public : format de la DSN, fichier, contrôles de forme.
   Aucun taux, plafond ni barème ici : le calcul d'une paie avec salaire se fait
   sur le serveur de Cerfaless, qui rend le résultat r (montants et taux utiles).
   buildDSN fabrique le fichier sur l'ordinateur à partir de r : l'identité ne part pas.
   La DSN néant ne demande aucun calcul : resultatNeant la prépare ici, sans réseau.
   Toutes les sommes sont en CENTIMES (entiers). Les taux sont en
   millièmes de pourcent (1 = 0,001 %).
   ===================================================================== */
var Noyau = (function () {
  'use strict';

  /* ---------- 1. Arithmétique entière ---------- */
  // Arrondi commercial (demi vers le haut, symétrique) de n / d.
  function rhu(n, d) {
    if (d < 0) { n = -n; d = -d; }
    var neg = n < 0; if (neg) n = -n;
    var q = Math.floor(n / d), r = n - q * d;
    if (2 * r >= d) q += 1;
    return neg ? -q : q;
  }
  function pm(base, milli) { return rhu(base * milli, 100000); }   // base × taux
  function toEuro(c) { return rhu(c, 100) * 100; }                 // arrondi à l'euro (en centimes)

  /* ---------- 2. Formats ---------- */
  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function grp(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' '); }
  function eur(c, noUnit) {
    if (c === null || c === undefined || isNaN(c)) return '—';
    var neg = c < 0, a = Math.abs(c);
    return (neg ? '−' : '') + grp(Math.floor(a / 100)) + ',' + pad2(a % 100) + (noUnit ? '' : ' €');
  }
  function pct(milli) {
    var s = (milli / 1000).toFixed(3);
    if (s.slice(-1) === '0') s = s.slice(0, -1);
    return s.replace('.', ',') + ' %';
  }
  function bpPct(bp) { return (bp / 100).toFixed(2).replace('.', ',') + ' %'; }
  // Montant au format DSN : 2 décimales, partie entière sur 2 chiffres minimum (05.10)
  function dsnAmt(c) {
    var neg = c < 0, a = Math.abs(c), e = String(Math.floor(a / 100));
    if (e.length < 2) e = '0' + e;
    return (neg ? '-' : '') + e + '.' + pad2(a % 100);
  }
  // Taux au format DSN (2 décimales, ou 3 si nécessaire et autorisé)
  function dsnRate(milli, maxDec) {
    if (maxDec === 3 && milli % 10 !== 0) {
      var t = String(milli % 1000); while (t.length < 3) t = '0' + t;
      return pad2(Math.floor(milli / 1000)) + '.' + t;
    }
    var bp = rhu(milli, 10);
    return pad2(Math.floor(bp / 100)) + '.' + pad2(bp % 100);
  }
  function dsnBp(bp) { return pad2(Math.floor(bp / 100)) + '.' + pad2(bp % 100); }
  // Texte DSN : ASCII strict (le fichier est alors valide en ISO-8859-1 comme en UTF-8)
  function clean(s) {
    return String(s).replace(/œ/g, 'oe').replace(/Œ/g, 'OE').replace(/æ/g, 'ae').replace(/Æ/g, 'AE').replace(/ß/g, 'ss')
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/[‘’ʼ]/g, "'").replace(/[«»“”]/g, '"').replace(/[–—]/g, '-')
      .replace(/[  \t]/g, ' ').replace(/[^\x20-\x7e]/g, '').replace(/ {2,}/g, ' ').trim();
  }

  /* ---------- 3. Dates ---------- */
  var MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  function dim(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function valid(o) { return o && o.m >= 1 && o.m <= 12 && o.d >= 1 && o.d <= dim(o.y, o.m) && o.y > 1900 && o.y < 2200; }
  function parseISO(s) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || ''); if (!m) return null; var o = { y: +m[1], m: +m[2], d: +m[3] }; return valid(o) ? o : null; }
  function parseDMY(s) { var m = /^(\d{2})(\d{2})(\d{4})$/.exec(s || ''); if (!m) return null; var o = { y: +m[3], m: +m[2], d: +m[1] }; return valid(o) ? o : null; }
  function dmy(o) { return pad2(o.d) + pad2(o.m) + o.y; }
  function iso(o) { return o.y + '-' + pad2(o.m) + '-' + pad2(o.d); }
  function fr(o) { return o ? pad2(o.d) + '/' + pad2(o.m) + '/' + o.y : '—'; }
  function dnum(o) { return Math.round(Date.UTC(o.y, o.m - 1, o.d) / 86400000); }
  function moisLabel(y, m) { return MOIS[m - 1] + ' ' + y; }
  function paques(y) {
    var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
      g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
      l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
      mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
    return dnum({ y: y, m: mo, d: da });
  }
  function feries(y) {
    var p = paques(y), s = {};
    [[1, 1, "Jour de l'an"], [5, 1, 'Fête du travail'], [5, 8, 'Victoire 1945'], [7, 14, 'Fête nationale'], [8, 15, 'Assomption'],
      [11, 1, 'Toussaint'], [11, 11, 'Armistice'], [12, 25, 'Noël']].forEach(function (f) { s[dnum({ y: y, m: f[0], d: f[1] })] = f[2]; });
    s[p + 1] = 'Lundi de Pâques'; s[p + 39] = 'Ascension'; s[p + 50] = 'Lundi de Pentecôte';
    return s;
  }
  function joursOuvres(y, m) {
    var F = feries(y), n = 0, liste = [];
    for (var d = 1; d <= dim(y, m); d++) {
      var t = dnum({ y: y, m: m, d: d }), wd = new Date(t * 86400000).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      if (F[t]) { liste.push(pad2(d) + '/' + pad2(m) + ' ' + F[t]); continue; }
      n++;
    }
    return { n: n, feries: liste };
  }

  /* ---------- 4. Paramètres 2026 ---------- */
  /* ---------- 5. Dictionnaires (valeurs codées) ---------- */
  var CODE81 = {
    '011': "Exonération créateur/repreneur d'entreprise (ACRE)", '045': 'Cotisation accident du travail', '049': 'Allocation de logement (FNAL)',
    '068': 'Contribution solidarité autonomie (CSA)', '072': 'CSG (part déductible + non déductible)', '074': 'Allocations familiales — taux normal',
    '075': 'Assurance maladie', '076': 'Assurance vieillesse', '079': 'CRDS (remboursement de la dette sociale)', '100': 'Contribution au dialogue social',
    '102': 'Complément allocations familiales', '128': 'Formation professionnelle (CFP)', '130': "Taxe d'apprentissage (part principale)",
    '131': 'Agirc-Arrco — cotisation totale (salarié + employeur)', '132': 'Apec', '142': 'Agirc-Arrco — part patronale tranche 1',
    '907': 'Complément assurance maladie'
  };
  var CTP = {
    '027': 'Contribution au dialogue social', '260': 'CSG/CRDS sur revenus d\'activité', '332': 'FNAL plafonné (moins de 50 salariés)',
    '401': 'ACRE — exonération (déduction)', '863': 'Régime général — mandataires sociaux', '959': 'Formation professionnelle (< 11 salariés)',
    '992': "Taxe d'apprentissage principale (hors Alsace-Moselle)"
  };
  var VAL = {
    'S10.G00.00.005': { '01': 'fichier de TEST (contrôlé, non transmis)', '02': 'fichier réel' },
    'S10.G00.00.007': { '01': 'net-entreprises', '02': 'MSA' },
    'S10.G00.00.008': { '01': 'envoi normal', '02': 'envoi néant' },
    'S10.G00.02.001': { '01': 'Monsieur', '02': 'Madame' },
    'S20.G00.05.001': { '01': 'DSN mensuelle', '04': 'signalement arrêt de travail', '05': 'signalement reprise', '07': 'signalement fin de contrat', '08': 'amorçage', '09': 'DSN de substitution', '10': 'signalement DPAE' },
    'S20.G00.05.002': { '01': 'déclaration normale', '02': 'normale sans individu (néant)', '03': 'annule et remplace', '04': 'annule', '05': 'annule et remplace sans individu' },
    'S20.G00.05.003': { '11': 'fraction unique' },
    'S20.G00.05.008': { '01': 'déclaration totale', '02': 'partielle régime agricole', '03': 'partielle régime général' },
    'S20.G00.05.010': { '01': 'euro', '02': 'franc Pacifique' },
    'S20.G00.07.004': { '01': 'contact pour les IJ', '02': 'fins de contrat', '03': 'statistiques', '04': 'cotisations Sécurité sociale', '05': 'retraite complémentaire et autres', '06': 'identification des salariés', '07': 'identification de l\'établissement', '08': 'tous organismes', '16': 'formation professionnelle' },
    'S21.G00.06.015': { '9999': 'sans convention collective' },
    'S21.G00.11.017': { '01': 'privée', '02': 'publique', '03': 'privé à capitaux publics' },
    'S21.G00.11.022': { '9999': 'sans convention collective' },
    'S21.G00.20.010': { '05': 'prélèvement SEPA', '06': 'versé par un autre établissement' },
    'S21.G00.23.001': CTP,
    'S21.G00.23.002': { '920': 'autre assiette (déplafonnée)', '921': 'assiette plafonnée' },
    'S21.G00.30.005': { '01': 'masculin', '02': 'féminin' },
    'S21.G00.30.013': { '01': 'France', '02': 'Union européenne', '03': 'Espace économique européen', '04': 'reste du monde' },
    'S21.G00.40.002': { '03': 'cadre dirigeant', '04': 'autre cadre', '05': 'profession intermédiaire', '06': 'employé', '07': 'ouvrier' },
    'S21.G00.40.003': { '01': 'cadre (art. 4 et 4 bis)', '02': 'extension cadre', '04': 'non cadre', '98': 'ni cadre ni non-cadre', '99': 'pas de retraite complémentaire' },
    'S21.G00.40.004': { '388a': 'ingénieurs et cadres d\'étude, R&D en informatique' },
    'S21.G00.40.007': { '01': 'CDI', '02': 'CDD', '80': 'mandat social', '90': 'autre contrat ou mandat' },
    'S21.G00.40.008': { '99': 'non concerné' },
    'S21.G00.40.011': { '10': 'heure', '12': 'journée', '20': 'forfait jour', '21': 'forfait heure', '99': 'non concerné' },
    'S21.G00.40.014': { '10': 'temps plein', '20': 'temps partiel', '99': 'non concerné' },
    'S21.G00.40.016': { '01': 'régime local Alsace-Moselle', '99': 'non applicable' },
    'S21.G00.40.017': { '9999': 'sans convention collective' },
    'S21.G00.40.018': { '200': 'régime général (CNAM)' },
    'S21.G00.40.020': { '200': 'régime général (CNAV)' },
    'S21.G00.40.024': { '99': 'non concerné' },
    'S21.G00.40.026': { '99': 'non concerné' },
    'S21.G00.40.036': { '01': 'emploi unique', '02': 'emplois multiples', '03': 'inconnu' },
    'S21.G00.40.037': { '01': 'employeur unique', '02': 'employeurs multiples', '03': 'inconnu' },
    'S21.G00.40.039': { '200': 'régime général' },
    'S21.G00.40.040': { '999ZZ': 'pas encore de code risque notifié par la CARSAT' },
    'S21.G00.50.007': { '01': 'taux transmis par la DGFiP', '13': 'barème mensuel métropole (taux neutre)', '17': 'barème mathématique', '99': 'indu exercice antérieur' },
    'S21.G00.51.011': { '001': 'rémunération brute non plafonnée', '002': 'salaire brut chômage', '003': 'salaire rétabli – reconstitué', '010': 'salaire de base' },
    'S21.G00.53.001': { '01': 'travail rémunéré', '02': 'absence' },
    'S21.G00.53.003': { '10': 'heures', '12': 'journées', '40': 'jours calendaires (calcul du plafond)' },
    'S21.G00.58.003': { '03': 'montant net social' },
    'S21.G00.71.002': { 'RUAA': 'régime unifié Agirc-Arrco', '90000': 'pas de régime complémentaire' },
    'S21.G00.78.001': { '02': 'assiette brute plafonnée', '03': 'assiette brute déplafonnée', '04': 'assiette CSG/CRDS' },
    'S21.G00.81.001': CODE81,
    'S21.G00.86.001': { '07': "ancienneté dans l'entreprise" },
    'S21.G00.86.002': { '01': 'jours', '02': 'mois', '03': 'années' }
  };
  var BLOCS = {
    'S10.G00.00': 'Envoi', 'S10.G00.01': 'Émetteur', 'S10.G00.02': 'Contact émetteur', 'S20.G00.05': 'Déclaration',
    'S20.G00.07': 'Contact chez le déclaré', 'S21.G00.06': 'Entreprise', 'S21.G00.11': 'Établissement',
    'S21.G00.20': 'Versement à un organisme', 'S21.G00.22': 'Bordereau Urssaf (cotisations dues)', 'S21.G00.23': 'Cotisation agrégée Urssaf (par CTP)',
    'S21.G00.30': 'Individu', 'S21.G00.40': 'Contrat (mandat social)', 'S21.G00.50': 'Versement individu (paie du mois)',
    'S21.G00.51': 'Rémunération', 'S21.G00.53': 'Activité', 'S21.G00.58': 'Élément de revenu en net',
    'S21.G00.71': 'Retraite complémentaire', 'S21.G00.78': 'Base assujettie', 'S21.G00.81': 'Cotisation individuelle',
    'S21.G00.86': 'Ancienneté', 'S90.G00.90': "Total de l'envoi"
  };
  var RUB = (typeof RUB_LABELS !== 'undefined') ? RUB_LABELS : {};
  var LOGICIEL_VERSION = '1.0.0';
  function label(code) { return RUB[code] || ''; }
  function meaning(code, v) { var t = VAL[code]; return t && t[v] ? t[v] : ''; }

  /* ---------- 6. Valeurs par défaut (neutres : tout le reste vient de la configuration du client) ---------- */
  var HDR_DEFAULT = { 'S10.G00.02.001': '01', 'S20.G00.07.004': '01', 'S21.G00.11.022': '9999' };
  // Mandat social de président assimilé salarié : valeurs usuelles, chacune remplaçable par la configuration.
  var CONTRAT_DEFAULT = {
    'S21.G00.40.002': '03', 'S21.G00.40.003': '01', 'S21.G00.40.006': 'President', 'S21.G00.40.007': '80', 'S21.G00.40.008': '99',
    'S21.G00.40.011': '10', 'S21.G00.40.012': '151.67', 'S21.G00.40.013': '151.67', 'S21.G00.40.014': '10',
    'S21.G00.40.016': '99', 'S21.G00.40.017': '9999', 'S21.G00.40.018': '200', 'S21.G00.40.020': '200', 'S21.G00.40.024': '99',
    'S21.G00.40.026': '99', 'S21.G00.40.036': '01', 'S21.G00.40.037': '01', 'S21.G00.40.039': '200', 'S21.G00.40.040': '999ZZ',
    'S21.G00.71.002': 'RUAA'
  };
  // Données personnelles : saisies par l'utilisateur sur son ordinateur, jamais transmises à Claude.
  var INDIV_DEFAULT = { 'S21.G00.30.013': '01', 'S21.G00.30.015': 'FR' };
  var INP_DEFAULT = {
    mois: '', brut: 0, dateVersement: '', dateConstitution: '', numeroOrdre: '1', typeEnvoi: '01',
    acreMode: 'aucune', acreFin: '', pasMode: 'bareme', pasTaux: 0, pasId: '',
    atTaux: 0, urssafSiret: '',
    trNb: 0, trAuto: false, trFaciale: 0, trPartPat: 0,
    loyer: 0, elec: 0, box: 0, mobile: 0, assurance: 0,
    surfTotale: 0, surfBureau: 0, usagePro: 0, usageBox: 0, usageMobile: 0,
    budgetCible: 0
  };
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function defaultState() {
    return { inp: clone(INP_DEFAULT), hdr: clone(HDR_DEFAULT), contrat: clone(CONTRAT_DEFAULT), indiv: clone(INDIV_DEFAULT), contact: { nom: '', mel: '', tel: '' }, bank: { bic: '', iban: '' } };
  }

  /* ---------- 7. Frais professionnels (remboursement au réel) ---------- */
  function computeFrais(inp) {
    var sB = Math.round((+inp.surfBureau || 0) * 100), sT = Math.round((+inp.surfTotale || 0) * 100);
    var u = Math.round((+inp.usagePro || 0) * 10), uB = Math.round((+inp.usageBox || 0) * 10), uM = Math.round((+inp.usageMobile || 0) * 10);
    var lines = [], tot = 0;
    var logOk = sT > 0;
    var prorataTxt = (inp.surfBureau + ' m² ÷ ' + inp.surfTotale + ' m² × ' + String(inp.usagePro).replace('.', ',') + ' %');
    var prorataMilli = logOk ? rhu(sB * u * 100000, sT * 1000) : 0; // en milli-%
    function lg(id, lab, montant, expl, isLog, uu) {
      montant = Math.round(+montant || 0);
      if (!montant) return;
      var v = isLog ? (logOk ? rhu(montant * sB * u, sT * 1000) : 0) : rhu(montant * uu, 1000);
      lines.push({ id: id, label: lab, montant: montant, v: v, calc: eur(montant) + ' × ' + (isLog ? '(' + prorataTxt + ')' : String(uu / 10).replace('.', ',') + ' %') + ' = ' + eur(v), expl: expl });
      tot += v;
    }
    lg('loyer', 'Loyer (charges comprises)', inp.loyer, 'Quote-part du logement utilisée pour le travail', true);
    lg('elec', 'Électricité', inp.elec, 'Même quote-part que le loyer', true);
    lg('assur', 'Assurance habitation', inp.assurance, 'Même quote-part que le loyer', true);
    lg('box', 'Box internet', inp.box, 'Part professionnelle de l\'abonnement', false, uB);
    lg('mobile', 'Forfait mobile', inp.mobile, 'Part professionnelle du forfait', false, uM);
    return { lines: lines, total: tot, prorataMilli: prorataMilli, prorataTxt: prorataTxt };
  }

  /* ---------- 8. DSN néant : le résultat, sans calcul ---------- */
  var ANNEE_NORME = 2026, NORME = 'P26V01';
  // Période du mois déclaré, commune au noyau et au calcul du serveur
  function periode(st, r) {
    var mo = /^(\d{4})-(\d{2})$/.exec(st.inp.mois || '');
    if (!mo || +mo[2] < 1 || +mo[2] > 12) { r.err.push('Mois déclaré invalide.'); mo = [null, '2026', '08']; }
    var y = +mo[1], m = +mo[2];
    r.y = y; r.m = m; r.dim = dim(y, m); r.debut = { y: y, m: m, d: 1 }; r.fin = { y: y, m: m, d: r.dim };
    r.label = moisLabel(y, m);
    return r;
  }
  function resultatNeant(st) {
    var inp = st.inp, C = st.contrat || {}, r = periode(st, { err: [], warn: [], info: [], c: {} }), y = r.y;
    r.B = 0; r.neant = true; r.Bp = 0; r.csgBase = 0;
    if (y < ANNEE_NORME) r.err.push('DSN de ' + y + ' : seule la norme ' + ANNEE_NORME + ' (' + NORME + ') est prise en charge.');
    if (y > ANNEE_NORME) r.err.push('DSN de ' + y + ' : la norme ' + (y === 2027 ? 'P27V01' : 'de cette année') + ' n\'est pas encore prise en charge par DSNap (mise à jour prévue avant la première échéance de ' + y + ').');
    r.atMilli = Math.round((+inp.atTaux || 0) / 10) * 10;
    r.acre = { mode: 'aucune', zone: 'aucune', jours: r.dim, fin: null, exoPlein: 0, regime: 'ancien' };
    r.totSal = 0; r.totPatBrut = 0; r.totPat = 0; r.net = 0; r.rnf = 0; r.pasBp = 0; r.pasType = '13'; r.pasTranche = 0; r.pas = 0; r.pasVersement = 0;
    r.netVerse = 0; r.netApresImpot = 0; r.mns = 0; r.trPatU = 0; r.trSalU = 0; r.trNb = 0; r.trTotal = 0; r.trPat = 0; r.trSal = 0; r.netPaye = 0;
    r.jo = joursOuvres(r.y, r.m); r.frais = computeFrais(inp); r.coutSalaire = 0; r.budget = r.frais.total; r.urssafNominatif = 0;
    r.ctp = []; r.bordereau = 0; r.aa = 0; r.aaPat = 0; r.apec = 0; r.aaTotal = 0;
    r.dv = parseISO(inp.dateVersement); r.dc = parseISO(inp.dateConstitution) || r.dv;
    if (!r.dv) r.err.push('Date de versement invalide.');
    var dDeb = parseDMY(C['S21.G00.40.001']);
    r.anciennete = dDeb ? dnum(r.fin) - dnum(dDeb) : null;
    if (r.anciennete !== null && r.anciennete < 1) r.anciennete = null;
    r.virements = [];
    r.echeance = { y: r.m === 12 ? r.y + 1 : r.y, m: r.m === 12 ? 1 : r.m + 1, d: 15 };
    r.sorties = 0;
    return r;
  }
  /* Ce qui part au serveur pour une paie avec salaire : le calcul, jamais l'identité. Liste fermée, testée. */
  var CHAMPS_CALCUL = ['mois', 'brut', 'dateVersement', 'dateConstitution', 'acreMode', 'acreFin', 'acreRegime', 'pasMode', 'pasTaux', 'atTaux',
    'trNb', 'trFaciale', 'trPartPat', 'loyer', 'elec', 'box', 'mobile', 'assurance', 'surfTotale', 'surfBureau', 'usagePro', 'usageBox', 'usageMobile', 'budgetCible'];
  var RUBRIQUES_CALCUL = ['S21.G00.40.001', 'S21.G00.40.007', 'S21.G00.40.016'];
  function entreesCalcul(st) {
    var inp = {}, contrat = {}, H = st.hdr || {}, cp = String(H['S21.G00.11.004'] || H['S21.G00.06.005'] || '');
    CHAMPS_CALCUL.forEach(function (k) { if (st.inp[k] !== undefined) inp[k] = st.inp[k]; });
    RUBRIQUES_CALCUL.forEach(function (k) { if (st.contrat && st.contrat[k] !== undefined) contrat[k] = st.contrat[k]; });
    return { inp: inp, contrat: contrat, departement: cp.slice(0, 2) };
  }

  /* ---------- 10. Génération de la DSN ---------- */
  function buildDSN(st, r) {
    var inp = st.inp, H = st.hdr || {}, Cm = st.contrat || {}, I = st.indiv || {}, Ct = st.contact || {}, Bk = st.bank || {}, c = r.c, AR = 'A RENSEIGNER', T = r.taux || {};
    var out = [];
    function add(code, v, k, o) {
      if (v === undefined || v === null) return;
      v = normField(code, clean(v));
      if (v === '') return;
      out.push({ c: code, v: v, k: k, o: o || '' });
    }
    function addMap(prefix, map, k, o) {
      Object.keys(map).filter(function (x) { return x.indexOf(prefix) === 0; }).sort().forEach(function (x) { add(x, map[x], k, o); });
    }
    var neant = r.B === 0, M = pad2(r.m) + r.y;
    var siren = H['S21.G00.06.001'] || H['S10.G00.01.001'] || '', nic = H['S21.G00.11.001'] || H['S10.G00.01.002'] || '';
    add('S10.G00.00.001', H['S10.G00.00.001'] || 'DSNAP', 'fixe', 'Nom du logiciel qui fabrique le fichier');
    add('S10.G00.00.002', H['S10.G00.00.002'] || 'SASU EBO', 'fixe', 'Éditeur du logiciel');
    add('S10.G00.00.003', H['S10.G00.00.003'] || LOGICIEL_VERSION, 'fixe', 'Version du logiciel');
    add('S10.G00.00.005', inp.typeEnvoi === '01' ? '01' : '02', 'saisie', inp.typeEnvoi === '01' ? 'TEST : net-entreprises contrôle le fichier, rien n\'est transmis aux organismes' : 'RÉEL : transmis aux organismes après dépôt');
    add('S10.G00.00.006', 'P26V01', 'norme', 'Norme DSN 2026 (cahier technique 2026.1)');
    add('S10.G00.00.007', '01', 'norme', 'Dépôt sur net-entreprises');
    add('S10.G00.00.008', neant ? '02' : '01', 'calcul', neant ? 'Brut = 0 : envoi néant' : 'Brut > 0 : envoi normal');
    addMap('S10.G00.01.', H, 'fixe', 'Émetteur = votre société');
    add('S10.G00.02.001', H['S10.G00.02.001'], 'fixe', 'Civilité du contact : ' + meaning('S10.G00.02.001', H['S10.G00.02.001']));
    add('S10.G00.02.002', Ct.nom || AR, 'perso', 'Personne à contacter pour cet envoi');
    add('S10.G00.02.004', Ct.mel || AR, 'perso', 'Mél du contact');
    add('S10.G00.02.005', Ct.tel || AR, 'perso', 'Téléphone du contact (10 à 20 caractères)');
    add('S20.G00.05.001', '01', 'norme', 'DSN mensuelle');
    add('S20.G00.05.002', neant ? '02' : '01', 'calcul', neant ? 'Déclaration sans individu (néant)' : 'Déclaration normale');
    add('S20.G00.05.003', '11', 'norme', 'Fraction unique');
    add('S20.G00.05.004', String(inp.numeroOrdre || '1'), 'saisie', 'Rang du fichier parmi les DSN fabriquées ce mois civil (remis à zéro chaque mois)');
    add('S20.G00.05.005', '01' + M, 'saisie', 'Mois déclaré (' + r.label + '), toujours au 1er du mois');
    if (r.dc) add('S20.G00.05.007', dmy(r.dc), 'saisie', 'Date de fabrication du fichier');
    add('S20.G00.05.008', '01', 'norme', 'Déclaration totale');
    add('S20.G00.05.010', '01', 'norme', 'Montants en euros');
    add('S20.G00.07.001', Ct.nom || AR, 'perso', 'Contact de la société pour les organismes');
    add('S20.G00.07.002', Ct.tel || AR, 'perso', 'Téléphone du contact');
    add('S20.G00.07.003', Ct.mel || AR, 'perso', 'Mél du contact');
    add('S20.G00.07.004', H['S20.G00.07.004'], 'fixe', 'Type de contact : ' + meaning('S20.G00.07.004', H['S20.G00.07.004']));
    addMap('S21.G00.06.', H, 'fixe', 'Entreprise');
    addMap('S21.G00.11.', H, 'fixe', 'Établissement');
    if (!neant && r.pas > 0) {
      add('S21.G00.20.001', 'DGFIP', 'norme', 'Versement à la DGFiP : prélèvement à la source du mois');
      add('S21.G00.20.002', 'DGFIP_PAS', 'norme', 'Entité d\'affectation imposée pour le PAS (CCH-11)');
      add('S21.G00.20.003', Bk.bic || AR, 'perso', 'BIC du compte de la société (prélèvement SEPA)');
      add('S21.G00.20.004', Bk.iban || AR, 'perso', 'IBAN du compte de la société (obligatoire en prélèvement SEPA)');
      add('S21.G00.20.005', dsnAmt(r.pasVersement), 'calcul', 'PAS ' + eur(r.pas) + ' arrondi à l\'euro (modalité DGFiP)');
      add('S21.G00.20.006', dmy(r.debut), 'calcul', 'Premier jour du mois déclaré');
      add('S21.G00.20.007', dmy(r.fin), 'calcul', 'Dernier jour du mois déclaré');
      add('S21.G00.20.010', '05', 'norme', 'Prélèvement SEPA par la DGFiP');
    }
    add('S21.G00.22.001', inp.urssafSiret, 'fixe', 'SIRET de votre Urssaf (destinataire du bordereau)');
    add('S21.G00.22.003', dmy(r.debut), 'calcul', 'Début du mois déclaré');
    add('S21.G00.22.004', dmy(r.fin), 'calcul', 'Fin du mois déclaré');
    if (neant) {
      add('S21.G00.22.005', '0.00', 'norme', 'Aucune cotisation (guide Urssaf, DSN sans individu)');
    } else {
      add('S21.G00.22.005', dsnAmt(r.bordereau), 'calcul', 'Total des CTP ci-dessous, chacun arrondi à l\'euro : ' + r.ctp.map(function (t) { return (t.du < 0 ? '− ' : '') + eur(Math.abs(t.du)).replace(',00', ''); }).join(' + ').replace(/\+ −/g, '−'));
      r.ctp.forEach(function (t) {
        add('S21.G00.23.001', t.code, 'calcul', 'CTP ' + t.code + ' : ' + (CTP[t.code] || ''));
        add('S21.G00.23.002', t.q, 'calcul', t.q === '921' ? 'Assiette plafonnée' : 'Assiette déplafonnée (« autre »)');
        if (t.tauxAT !== undefined) add('S21.G00.23.003', dsnRate(t.tauxAT, 2), 'saisie', 'Taux AT porté par la ligne 920 du CTP 863');
        if (t.deduction) add('S21.G00.23.005', dsnAmt(t.montant), 'calcul', 'Exonération ' + eur(c.exo) + ' arrondie à l\'euro, montant sans signe (le CTP porte le signe −)');
        else add('S21.G00.23.004', dsnAmt(t.assiette), 'calcul', 'Assiette arrondie à l\'euro (guide Urssaf §1.6) — Urssaf recalcule : ' + t.calc);
      });
      // Individu
      var nir = String(I['S21.G00.30.001'] || '').replace(/\s/g, '').toUpperCase();
      var Iv = clone(I); Iv['S21.G00.30.001'] = nir;
      if (!Iv['S21.G00.30.005'] && /^[12]/.test(nir)) Iv['S21.G00.30.005'] = nir[0] === '1' ? '01' : '02';
      ['001', '002', '004', '006', '013', '014', '015'].forEach(function (f) { if (!Iv['S21.G00.30.' + f]) Iv['S21.G00.30.' + f] = AR; });
      addMap('S21.G00.30.', Iv, 'perso', 'Identité (saisie par vous, conservée sur votre ordinateur)');
      // Contrat
      var Cv = clone(Cm);
      if (Cv['S21.G00.40.040'] === '999ZZ') delete Cv['S21.G00.40.043'];
      else if (r.atMilli >= 0) Cv['S21.G00.40.043'] = dsnRate(r.atMilli, 2);
      addMap('S21.G00.40.', Cv, 'fixe', 'Contrat : mandat social de président');
      add('S21.G00.71.002', Cv['S21.G00.71.002'] || 'RUAA', 'fixe', 'Affiliation au régime unifié Agirc-Arrco');
      var contrat = Cv['S21.G00.40.009'] || '';
      // Versement individu
      if (r.dv) add('S21.G00.50.001', dmy(r.dv), 'saisie', 'Date du virement du salaire');
      add('S21.G00.50.002', dsnAmt(r.rnf), 'calcul', 'Net imposable = net ' + eur(r.net) + ' + CSG non déductible ' + eur(c.csgNd) + ' + CRDS ' + eur(c.crds));
      add('S21.G00.50.004', dsnAmt(r.net), 'calcul', 'Net versé = brut ' + eur(r.B) + ' − cotisations salariales ' + eur(r.totSal) + ' (ni le PAS ni la part salariale des titres-restaurant ne sont déduits)');
      add('S21.G00.50.006', dsnBp(r.pasBp), r.pasType === '01' ? 'saisie' : 'calcul', r.pasType === '01' ? 'Taux personnalisé transmis par la DGFiP' : 'Taux neutre : net imposable ' + eur(r.rnf) + ' → ' + bpPct(r.pasBp) + ' (grille ' + (r.pasGrille || '2026') + ')');
      add('S21.G00.50.007', r.pasType, 'calcul', meaning('S21.G00.50.007', r.pasType));
      if (r.pasType === '01' && inp.pasId) add('S21.G00.50.008', inp.pasId, 'saisie', 'Identifiant du taux (compte rendu PAS de la DGFiP)');
      add('S21.G00.50.009', dsnAmt(r.pas), 'calcul', eur(r.rnf) + ' × ' + bpPct(r.pasBp) + ' = ' + eur(r.pas));
      add('S21.G00.50.013', dsnAmt(r.rnf), 'calcul', 'Montant soumis au PAS = net imposable');
      // Rémunérations
      [['001', 'Rémunération brute non plafonnée'], ['002', 'Salaire brut « chômage » (même montant)'], ['003', 'Salaire rétabli (pas d\'absence)'], ['010', 'Salaire de base']].forEach(function (t, i) {
        add('S21.G00.51.001', dmy(r.debut), 'calcul', 'Début de la période de paie');
        add('S21.G00.51.002', dmy(r.fin), 'calcul', 'Fin de la période de paie');
        add('S21.G00.51.010', contrat, 'fixe', 'Numéro du contrat (bloc 40)');
        add('S21.G00.51.011', t[0], 'norme', t[1]);
        add('S21.G00.51.013', dsnAmt(r.B), 'saisie', 'Brut du mois');
        if (i === 0) {
          add('S21.G00.53.001', '01', 'norme', 'Travail rémunéré');
          add('S21.G00.53.002', r.dim + '.00', 'calcul', r.dim + ' jours calendaires dans le mois');
          add('S21.G00.53.003', '40', 'norme', 'Unité : jours calendaires (calcul du plafond)');
        }
      });
      add('S21.G00.58.003', '03', 'norme', 'Montant net social');
      add('S21.G00.58.004', dsnAmt(r.mns), 'calcul', 'Net social = net avant impôt (aucune mutuelle, prévoyance ni avantage)');
      // Bases et cotisations individuelles
      function base(code, montant, o) {
        add('S21.G00.78.001', code, 'calcul', meaning('S21.G00.78.001', code));
        add('S21.G00.78.002', dmy(r.debut), 'calcul', 'Début de période');
        add('S21.G00.78.003', dmy(r.fin), 'calcul', 'Fin de période');
        add('S21.G00.78.004', dsnAmt(montant), 'calcul', o);
      }
      function cot(code, assiette, montant, taux, o) {
        add('S21.G00.81.001', code, 'calcul', CODE81[code]);
        if (assiette !== null) add('S21.G00.81.003', dsnAmt(assiette), 'calcul', 'Assiette');
        add('S21.G00.81.004', dsnAmt(montant), 'calcul', o);
        if (taux !== null) add('S21.G00.81.007', dsnRate(taux, 3), 'calcul', 'Taux ' + pct(taux));
      }
      base('02', r.Bp, 'Brut plafonné au PMSS (' + eur(T.pmss) + ')');
      cot('049', r.Bp, c.fnal, T.fnal, 'FNAL ' + eur(r.Bp) + ' × ' + pct(T.fnal));
      cot('076', r.Bp, c.vpS + c.vpP, T.vpS + T.vpP, 'Vieillesse plafonnée : salarié ' + eur(c.vpS) + ' + employeur ' + eur(c.vpP));
      cot('131', null, r.aa, null, 'Agirc-Arrco + CEG, salarié ' + eur(c.aaS + c.cegS) + ' + employeur ' + eur(r.aaPat));
      cot('142', null, r.aaPat, null, 'Part patronale Agirc-Arrco T1 + CEG : ' + eur(c.aaP) + ' + ' + eur(c.cegP));
      base('03', r.B, 'Brut total');
      if (c.exo > 0) cot('011', r.B, -c.exo, null, 'Exonération ACRE, montant négatif (niveau individuel)');
      cot('045', r.B, c.at, r.atMilli, 'Accident du travail : ' + eur(r.B) + ' × ' + pct(r.atMilli));
      cot('068', r.B, c.csa, T.csa, 'CSA ' + eur(r.B) + ' × ' + pct(T.csa));
      cot('074', r.B, c.af, T.af, 'AF ' + eur(r.B) + ' × ' + pct(T.af));
      cot('075', r.B, c.mal, T.mal, 'Maladie ' + eur(r.B) + ' × ' + pct(T.mal));
      cot('076', r.B, c.vdS + c.vdP, T.vdS + T.vdP, 'Vieillesse déplafonnée : salarié ' + eur(c.vdS) + ' + employeur ' + eur(c.vdP));
      cot('100', r.B, c.dial, T.dial, 'Dialogue social ' + eur(r.B) + ' × ' + pct(T.dial));
      cot('102', r.B, c.afC, T.afC, 'Complément AF ' + eur(r.B) + ' × ' + pct(T.afC));
      cot('128', r.B, c.cfp, T.cfp, 'CFP ' + eur(r.B) + ' × ' + pct(T.cfp));
      cot('130', r.B, c.ta, T.ta, 'Taxe d\'apprentissage ' + eur(r.B) + ' × ' + pct(T.ta));
      cot('132', null, r.apec, null, 'Apec salarié ' + eur(c.apecS) + ' + employeur ' + eur(c.apecP));
      cot('907', r.B, c.malC, T.malC, 'Complément maladie ' + eur(r.B) + ' × ' + pct(T.malC));
      base('04', r.csgBase, 'Assiette CSG/CRDS = ' + eur(r.B) + ' × ' + pct(T.csgAssiette));
      cot('072', r.csgBase, c.csgDed + c.csgNd, T.csgDed + T.csgNd, 'CSG déductible ' + eur(c.csgDed) + ' + non déductible ' + eur(c.csgNd));
      cot('079', r.csgBase, c.crds, T.crds, 'CRDS ' + eur(r.csgBase) + ' × ' + pct(T.crds));
      if (r.anciennete !== null) {
        add('S21.G00.86.001', '07', 'norme', "Ancienneté dans l'entreprise");
        add('S21.G00.86.002', '01', 'norme', 'En jours');
        add('S21.G00.86.003', String(r.anciennete), 'calcul', 'Du ' + fr(parseDMY(Cm['S21.G00.40.001'])) + ' au ' + fr(r.fin));
        add('S21.G00.86.005', contrat, 'fixe', 'Numéro du contrat');
      }
    }
    var n = out.length + 2;
    add('S90.G00.90.001', String(n), 'calcul', 'Nombre total de lignes du fichier, y compris ces 2 lignes');
    add('S90.G00.90.002', '1', 'norme', 'Une seule déclaration dans l\'envoi');
    void siren; void nic;
    return out;
  }
  var LOCALITES = ['S10.G00.01.006', 'S21.G00.06.006', 'S21.G00.11.005', 'S21.G00.30.010'];
  function normField(code, v) {
    if (v === 'A RENSEIGNER') return v;
    if (LOCALITES.indexOf(code) >= 0) return v.replace(/[^A-Za-z0-9\s]/g, ' ').replace(/ {2,}/g, ' ').trim(); // CSL [A-Za-z0-9\s]+
    if (code === 'S20.G00.05.004' && /^\d+$/.test(v)) return String(parseInt(v, 10));
    if (code === 'S21.G00.50.008' && v !== '-1') return v.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
    if (code === 'S21.G00.20.004' || code === 'S21.G00.20.003') return v.replace(/\s/g, '').toUpperCase();
    return v;
  }
  function toText(lines) { return lines.map(function (l) { return l.c + ",'" + l.v + "'"; }).join('\r\n'); }
  function toLatin1(text) {
    var u = new Uint8Array(text.length);
    for (var i = 0; i < text.length; i++) { var ch = text.charCodeAt(i); u[i] = ch < 256 ? ch : 63; }
    return u;
  }

  /* ---------- 11. Lecture d'un fichier DSN ---------- */
  // enc : 'ascii' | 'iso-8859-1' | 'utf-8' (détecté sur les octets) | 'colle' (texte collé)
  function parseDSN(text, enc) {
    var res = { lines: [], errors: [], encoding: enc || 'colle', crlf: /\r\n/.test(text), lf: /[^\r]\n/.test(text), trailing: /\n$/.test(text), suspectUtf8: /Ã[\u0080-¿]|Â[\u0080-¿]|�/.test(text), nonLatin: /[^\x00-\xff]/.test(text.replace(/�/g, '')) };
    var rows = text.replace(/\r\n?/g, '\n').split('\n');
    rows.forEach(function (l, i) {
      if (l === '') { if (i < rows.length - 1) res.errors.push({ n: i + 1, msg: 'ligne vide' }); return; }
      var m = /^(S\d{2}\.G\d{2}\.\d{2}\.\d{3}),'(.*)'\s*$/.exec(l);
      if (!m) { res.errors.push({ n: i + 1, msg: 'format non reconnu', raw: l.slice(0, 80) }); return; }
      res.lines.push({ c: m[1], v: m[2], n: i + 1 });
    });
    return res;
  }
  function blocsOf(lines) {
    var res = [], cur = null;
    lines.forEach(function (L) {
      var id = L.c.slice(0, 10), f = +L.c.slice(11);
      if (!cur || cur.id !== id || f <= cur.last) { cur = { id: id, items: [], last: -1 }; res.push(cur); }
      cur.items.push(L); cur.last = f;
    });
    return res;
  }
  function get(b, f) { for (var i = 0; i < b.items.length; i++) if (b.items[i].c.slice(11) === f) return b.items[i].v; return ''; }
  function keyed(lines) {
    var map = {}, order = [], occ = {}, ctx78 = '', ctx51 = '';
    blocsOf(lines).forEach(function (b) {
      var disc = '';
      switch (b.id) {
        case 'S20.G00.07': disc = get(b, '004'); break;
        case 'S21.G00.20': disc = get(b, '001'); break;
        case 'S21.G00.22': disc = get(b, '001'); break;
        case 'S21.G00.23': disc = get(b, '001') + '/' + get(b, '002'); break;
        case 'S21.G00.51': disc = get(b, '011'); ctx51 = disc; break;
        case 'S21.G00.53': disc = ctx51 + '/' + get(b, '003'); break;
        case 'S21.G00.58': disc = get(b, '003'); break;
        case 'S21.G00.78': disc = get(b, '001'); ctx78 = disc; break;
        case 'S21.G00.81': disc = ctx78 + '/' + get(b, '001'); break;
        case 'S21.G00.86': disc = get(b, '001'); break;
      }
      var k = b.id + (disc ? '[' + disc + ']' : '');
      occ[k] = (occ[k] || 0) + 1; if (occ[k] > 1) k += '#' + occ[k];
      b.items.forEach(function (it) {
        var key = k + '.' + it.c.slice(11);
        map[key] = { c: it.c, v: it.v, n: it.n, bk: k, bloc: b.id, disc: disc };
        order.push(key);
      });
    });
    return { map: map, order: order };
  }
  function isNum(s) { return /^-?\d+(\.\d+)?$/.test(s); }
  function sameVal(a, b) {
    if (a === b) return 'eq';
    if (isNum(a) && isNum(b) && Math.abs(parseFloat(a) - parseFloat(b)) < 1e-9) return 'fmt';
    if (String(a).trim().toUpperCase() === String(b).trim().toUpperCase()) return 'fmt';
    return 'diff';
  }
  // A = fichier de référence (importé), B = fichier calculé
  function diff(A, B) {
    var ka = keyed(A), kb = keyed(B), rows = [];
    kb.order.forEach(function (k) {
      var a = ka.map[k], b = kb.map[k];
      rows.push({ k: k, a: a || null, b: b, st: a ? sameVal(a.v, b.v) : 'onlyB' });
    });
    ka.order.forEach(function (k) {
      if (kb.map[k]) return;
      var a = ka.map[k], pos = -1;
      for (var i = rows.length - 1; i >= 0; i--) if ((rows[i].b && rows[i].b.bk === a.bk) || (rows[i].a && rows[i].a.bk === a.bk)) { pos = i; break; }
      if (pos < 0) for (var j = rows.length - 1; j >= 0; j--) { var rb = rows[j].b || rows[j].a; if (rb && rb.bloc <= a.bloc) { pos = j; break; } }
      rows.splice(pos + 1, 0, { k: k, a: a, b: null, st: 'onlyA' });
    });
    var s = { eq: 0, fmt: 0, diff: 0, onlyA: 0, onlyB: 0 };
    rows.forEach(function (r) { s[r.st]++; });
    return { rows: rows, stats: s };
  }

  /* ---------- 12. Extraction des paramètres d'un fichier ---------- */
  function extract(lines) {
    var bl = blocsOf(lines), x = { hdr: {}, contrat: {}, indiv: {}, inp: {}, contact: { nom: '', mel: '', tel: '' }, bank: {} }, ctx78 = '';
    function first(code) { for (var i = 0; i < lines.length; i++) if (lines[i].c === code) return lines[i].v; return null; }
    var d5 = parseDMY(first('S20.G00.05.005'));
    if (d5) x.inp.mois = d5.y + '-' + pad2(d5.m);
    var d7 = parseDMY(first('S20.G00.05.007')); if (d7) x.inp.dateConstitution = iso(d7);
    if (first('S20.G00.05.004')) x.inp.numeroOrdre = first('S20.G00.05.004');
    if (first('S10.G00.00.005')) x.inp.typeEnvoi = first('S10.G00.00.005');
    if (first('S21.G00.22.001')) x.inp.urssafSiret = first('S21.G00.22.001');
    var brut = null, exo = false, at = null;
    bl.forEach(function (b) {
      if (/^S10\.G00\.0[12]$|^S20\.G00\.07$|^S21\.G00\.06$|^S21\.G00\.11$/.test(b.id)) b.items.forEach(function (it) {
        var f = it.c;
        if (f === 'S10.G00.02.002' || f === 'S20.G00.07.001') { if (!x.contact.nom) x.contact.nom = it.v; return; }
        if (f === 'S10.G00.02.004' || f === 'S20.G00.07.003') { if (!x.contact.mel) x.contact.mel = it.v; return; }
        if (f === 'S10.G00.02.005' || f === 'S20.G00.07.002') { if (!x.contact.tel) x.contact.tel = it.v; return; }
        if (!(f in x.hdr)) x.hdr[f] = it.v;
      });
      if (b.id === 'S21.G00.30') b.items.forEach(function (it) { x.indiv[it.c] = it.v; });
      if (b.id === 'S21.G00.20' && get(b, '001') === 'DGFIP') { x.bank.bic = get(b, '003'); x.bank.iban = get(b, '004'); }
      if (b.id === 'S21.G00.40' || b.id === 'S21.G00.71') b.items.forEach(function (it) { x.contrat[it.c] = it.v; });
      if (b.id === 'S21.G00.50') {
        var dv = parseDMY(get(b, '001')); if (dv) x.inp.dateVersement = iso(dv);
        var t = get(b, '007'), tx = get(b, '006');
        if (t === '01') { x.inp.pasMode = 'dgfip'; x.inp.pasTaux = Math.round(parseFloat(tx || '0') * 100); x.inp.pasId = get(b, '008'); }
        else x.inp.pasMode = 'bareme';
      }
      if (b.id === 'S21.G00.51' && get(b, '011') === '001' && brut === null) brut = Math.round(parseFloat(get(b, '013')) * 100);
      if (b.id === 'S21.G00.78') ctx78 = get(b, '001');
      if (b.id === 'S21.G00.81') {
        if (get(b, '001') === '011') exo = true;
        if (get(b, '001') === '045' && get(b, '007')) at = Math.round(parseFloat(get(b, '007')) * 1000);
      }
      if (b.id === 'S21.G00.23' && get(b, '001') === '863' && get(b, '002') === '920' && get(b, '003') && at === null) at = Math.round(parseFloat(get(b, '003')) * 1000);
    });
    void ctx78;
    x.inp.brut = brut === null ? 0 : brut;
    x.inp.atTaux = at || 0;
    x.acre = exo;
    if (first('S10.G00.00.001')) x.logiciel = first('S10.G00.00.001') + (first('S10.G00.00.003') ? ' ' + first('S10.G00.00.003') : '');
    x.neant = first('S20.G00.05.002') === '02';
    return x;
  }

  /* ---------- 13. Contrôles ---------- */
  var DATES = ['S20.G00.05.005', 'S20.G00.05.007', 'S21.G00.20.006', 'S21.G00.20.007', 'S21.G00.22.003', 'S21.G00.22.004', 'S21.G00.30.006', 'S21.G00.40.001', 'S21.G00.50.001', 'S21.G00.51.001', 'S21.G00.51.002', 'S21.G00.78.002', 'S21.G00.78.003'];
  var AMOUNTS = ['S21.G00.20.005', 'S21.G00.22.005', 'S21.G00.23.004', 'S21.G00.23.005', 'S21.G00.50.002', 'S21.G00.50.004', 'S21.G00.50.009', 'S21.G00.50.013', 'S21.G00.51.013', 'S21.G00.58.004', 'S21.G00.78.004', 'S21.G00.81.003', 'S21.G00.81.004'];
  var RE_AMT = /^-?0*(0|[1-9][0-9]*)\.[0-9]{2}$/;
  function luhn(s) { var t = 0; for (var i = 0; i < s.length; i++) { var d = +s[s.length - 1 - i]; if (i % 2) { d *= 2; if (d > 9) d -= 9; } t += d; } return t % 10 === 0; }
  function nirKey(nir) {
    var s = nir.replace(/2A/i, '19').replace(/2B/i, '18');
    if (!/^\d{13}$/.test(s)) return null;
    var k = 97 - (Number(s) % 97); return pad2(k);
  }
  function amt(v) { return Math.round(parseFloat(v) * 100); }

  function controls(lines, opt) {
    opt = opt || {};
    var out = [], bl = blocsOf(lines);
    function C(cat, lvl, title, detail, ref) { out.push({ cat: cat, lvl: lvl, title: title, detail: detail || '', ref: ref || '' }); }
    function all(code) { return lines.filter(function (l) { return l.c === code; }); }
    function one(code) { var a = all(code); return a.length ? a[0].v : null; }
    var S = 'Structure du fichier', F = 'Format des rubriques', K = 'Cohérence (cahier technique)', M = 'Recalcul des montants', V = 'Points de vigilance', Pp = 'Paie (hors DSN)';

    // --- Structure
    if (opt.parse) {
      if (opt.parse.errors.length) C(S, 'err', opt.parse.errors.length + ' ligne(s) illisible(s)', opt.parse.errors.slice(0, 5).map(function (e) { return 'ligne ' + e.n + ' : ' + e.msg + (e.raw ? ' — ' + e.raw : ''); }).join(' · '));
      else C(S, 'ok', 'Toutes les lignes ont la forme RUBRIQUE,\'valeur\'', lines.length + ' lignes lues');
      if (opt.parse.encoding === 'utf-8' || opt.parse.suspectUtf8) C(S, 'err', 'Encodage : le fichier est enregistré en UTF-8 avec des caractères accentués', 'net-entreprises attend de l\'ISO-8859-1 : le fichier serait rejeté. Réenregistrez le fichier en ISO-8859-1 / « ANSI » ou retirez les accents.', 'CT 2026.1');
      else if (opt.parse.encoding === 'colle') C(S, opt.parse.nonLatin ? 'warn' : 'info', 'Texte collé : encodage du fichier d\'origine non vérifiable', opt.parse.nonLatin ? 'Le texte contient des caractères hors ISO-8859-1.' : 'Pour vérifier l\'encodage, ouvrez le fichier avec « Choisir un fichier ».');
      else C(S, 'ok', 'Encodage compatible ISO-8859-1 (' + (opt.parse.encoding === 'ascii' ? 'caractères ASCII uniquement' : 'ISO-8859-1') + ')', '');
      if (opt.parse.lf && !opt.parse.crlf) C(S, 'info', 'Fins de ligne de type Unix (LF)', 'Les fichiers produits par DSNap utilisent CR+LF.');
    } else {
      C(S, 'ok', 'Lignes au format RUBRIQUE,\'valeur\', caractères ASCII, fins de ligne CR+LF', lines.length + ' lignes générées');
    }
    var aRens = lines.filter(function (l) { return l.v === 'A RENSEIGNER'; });
    if (aRens.length) C(S, 'err', aRens.length + ' rubrique(s) à renseigner (identité ou contact)', aRens.map(function (l) { return l.c + ' ' + label(l.c); }).slice(0, 8).join(' · ') + ' — complétez la configuration de DSNap (outil configurer_dsnap) ou importez votre dernière DSN.', '');
    var vides = lines.filter(function (l) { return l.v === ''; });
    C(S, vides.length ? 'err' : 'ok', vides.length ? vides.length + ' rubrique(s) vide(s)' : 'Aucune rubrique vide', vides.map(function (l) { return l.c; }).slice(0, 6).join(', '), 'CT : les rubriques à blanc sont interdites');
    var n90 = one('S90.G00.90.001');
    if (n90 === null) C(S, 'err', 'Rubrique S90.G00.90.001 absente', '');
    else C(S, +n90 === lines.length ? 'ok' : 'err', 'Nombre total de lignes (S90.G00.90.001) : ' + n90 + (+n90 === lines.length ? ' = ' : ' ≠ ') + lines.length + ' lignes', +n90 === lines.length ? '' : 'Le total doit compter toutes les lignes, y compris les deux lignes S90.', 'CST-11');
    var nS20 = bl.filter(function (b) { return b.id === 'S20.G00.05'; }).length, n902 = one('S90.G00.90.002');
    C(S, +n902 === nS20 ? 'ok' : 'err', 'Nombre de déclarations (S90.G00.90.002) : ' + n902 + ' pour ' + nS20 + ' bloc(s) S20', '');
    var desordre = [];
    bl.forEach(function (b, i) { var p = bl[i - 1]; if (p && p.id === b.id && b.items[0].c > p.items[0].c) desordre.push(b.items[0].c + ' (ligne ' + b.items[0].n + ')'); });
    C(S, desordre.length ? 'err' : 'ok', desordre.length ? 'Rubriques hors ordre : un bloc est coupé en deux' : 'Rubriques dans l\'ordre croissant à l\'intérieur de chaque bloc', desordre.slice(0, 5).join(', '));

    // --- Formats
    var badD = [], badA = [], badR = [], badT = [];
    lines.forEach(function (l) {
      if (l.v === 'A RENSEIGNER') return;
      if (DATES.indexOf(l.c) >= 0 && !parseDMY(l.v)) badD.push(l.c + ' = ' + l.v);
      if (AMOUNTS.indexOf(l.c) >= 0 && !RE_AMT.test(l.v)) badA.push(l.c + ' = ' + l.v);
      if (l.c === 'S21.G00.81.007' && !/^0?([0-9]{1,2}\.[0-9]{2,3}|100\.000|100\.00)$/.test(l.v)) badR.push(l.c + ' = ' + l.v);
      if (l.c === 'S21.G00.23.003' && !/^0?([0-9]{1,2}\.[0-9]{2}|100\.00)$/.test(l.v)) badR.push(l.c + ' = ' + l.v);
      if (l.c === 'S21.G00.50.006' && !/^[0-9]{1,2}\.[0-9]{2}$/.test(l.v)) badR.push(l.c + ' = ' + l.v);
      if (LOCALITES.indexOf(l.c) >= 0 && !/^[A-Za-z0-9\s]+$/.test(l.v)) badT.push(l.c + ' = ' + l.v + ' (lettres, chiffres et espaces seulement)');
      if (l.c === 'S20.G00.05.004' && !/^(0|[1-9][0-9]*)$/.test(l.v)) badT.push(l.c + ' = ' + l.v + ' (nombre sans zéro devant)');
      if (l.c === 'S21.G00.50.008' && !/^(-1|0|[1-9][0-9]{0,17})$/.test(l.v)) badT.push(l.c + ' = ' + l.v + ' (chiffres seulement)');
    });
    C(F, badT.length ? 'err' : 'ok', badT.length ? 'Valeur(s) hors du format autorisé' : 'Localités, numéro d\'ordre et identifiants au format autorisé', badT.slice(0, 4).join(' · '));
    C(F, badD.length ? 'err' : 'ok', badD.length ? 'Date(s) invalide(s)' : 'Dates au format JJMMAAAA et existantes', badD.slice(0, 4).join(' · '));
    C(F, badA.length ? 'err' : 'ok', badA.length ? 'Montant(s) mal formé(s)' : 'Montants avec 2 décimales et un point', badA.slice(0, 4).join(' · '));
    C(F, badR.length ? 'err' : 'ok', badR.length ? 'Taux mal formé(s)' : 'Taux au format attendu', badR.slice(0, 4).join(' · '));
    var siren = one('S21.G00.06.001'), nic = one('S21.G00.11.001');
    if (siren) C(F, /^\d{9}$/.test(siren) && luhn(siren) ? 'ok' : 'warn', 'SIREN ' + siren + (luhn(siren) ? ' : clé de contrôle correcte' : ' : clé de contrôle incorrecte'), '');
    if (siren && nic) C(F, luhn(siren + nic) ? 'ok' : 'warn', 'SIRET ' + siren + nic + (luhn(siren + nic) ? ' : clé de contrôle correcte' : ' : clé de contrôle incorrecte'), '');
    var neant = one('S20.G00.05.002') === '02';
    var nir = one('S21.G00.30.001');
    if (!neant) {
      if (!nir) C(F, 'err', 'NIR (numéro de sécurité sociale) absent', 'Saisissez-le dans la configuration de DSNap (outil configurer_dsnap) : il reste sur votre ordinateur.');
      else if (nir === 'A RENSEIGNER') { /* déjà signalé dans « rubriques à renseigner » */ }
      else {
        var okNir = /^[12]\d{2}(0[1-9]|1[0-2]|[2-9]\d)(\d{2}|2A|2B)\d{6}$/i.test(nir);
        var dep = one('S21.G00.30.014'), sexe = one('S21.G00.30.005');
        var det = [];
        if (dep && dep !== '99' && nir.slice(5, 7).toUpperCase() !== dep.toUpperCase()) det.push('département du NIR (' + nir.slice(5, 7) + ') ≠ département de naissance (' + dep + ')');
        if (sexe && ((nir[0] === '1') !== (sexe === '01'))) det.push('1er chiffre du NIR incohérent avec le sexe');
        var k = nirKey(nir);
        C(F, okNir && !det.length ? 'ok' : 'err', 'NIR ' + nir.slice(0, 1) + ' ' + nir.slice(1, 3) + ' ' + nir.slice(3, 5) + ' ' + nir.slice(5, 7) + ' ' + nir.slice(7, 10) + ' ' + nir.slice(10, 13) + (okNir ? ' : format valide' : ' : format invalide (13 caractères attendus, sans la clé)'),
          (det.length ? det.join(' · ') + ' · ' : '') + (k ? 'Clé calculée : ' + k + ' — elle doit correspondre aux 2 derniers chiffres de votre carte Vitale.' : ''), 'CCH-11 de S21.G00.30.001');
      }
    }

    // --- Adresse de l'entreprise : code postal, ou bien code pays + code de distribution à l'étranger (rejet bloquant sinon)
    if (one('S21.G00.06.001') !== null) {
      var cp06 = one('S21.G00.06.005'), py06 = one('S21.G00.06.010'), dt06 = one('S21.G00.06.011');
      var adrOk = cp06 !== null ? (py06 === null && dt06 === null) : (py06 !== null && dt06 !== null);
      C(K, adrOk ? 'ok' : 'err',
        'Adresse de l\'entreprise (S21.G00.06) : ' + (adrOk ? (cp06 !== null ? 'code postal ' + cp06 : 'adresse à l\'étranger (code pays et code de distribution)') : (cp06 === null ? 'code postal absent' : 'code postal et code pays renseignés ensemble')),
        adrOk ? '' : (cp06 === null
          ? 'Renseignez S21.G00.06.004 (voie), S21.G00.06.005 (code postal) et S21.G00.06.006 (localité) : pour une entreprise à un seul établissement, ce sont ceux de l\'établissement (S21.G00.11.003 à 005). Corrigez la DSN de référence ou le bloc « entete » de la configuration. Sans cela, net-entreprises rejette la DSN (anomalie bloquante).'
          : 'Avec un code postal, ni le code pays (S21.G00.06.010) ni le code de distribution à l\'étranger (S21.G00.06.011) ne doivent figurer.'),
        'CCH-11 de S21.G00.06.005');
    }

    // --- Cohérence (CT)
    if (!neant) {
      var b51 = bl.filter(function (b) { return b.id === 'S21.G00.51'; });
      var bad51 = b51.filter(function (b) { var a = parseDMY(get(b, '001')), z = parseDMY(get(b, '002')); return !(a && z && dnum(z) >= dnum(a)); });
      C(K, bad51.length ? 'err' : 'ok', 'Période de paie : fin ≥ début (' + b51.length + ' bloc(s) Rémunération)', '', 'CCH-11 de S21.G00.51.002');
      var rc = one('S21.G00.71.002'), cat = one('S21.G00.40.003'), rv = one('S21.G00.40.020'), sc = one('S21.G00.40.002');
      if ((cat === '01' || cat === '02') && rv !== '134') C(K, ['RETC', 'RUAA', 'CNBF', 'CAVEC'].indexOf(rc) >= 0 ? 'ok' : 'err', 'Statut cadre (' + cat + ') : régime de retraite complémentaire ' + (rc || 'absent'), 'Un statut 01 ou 02 exige un bloc Retraite complémentaire RETC, RUAA, CNBF ou CAVEC.', 'CCH-16 de S21.G00.40.003');
      if (cat === '04' && sc !== '04' && rv !== '134') C(K, ['RETA', 'RUAA', 'CAVEC'].indexOf(rc) >= 0 ? 'ok' : 'err', 'Statut non cadre : régime de retraite complémentaire ' + (rc || 'absent'), 'Un statut 04 exige un bloc Retraite complémentaire RETA, RUAA ou CAVEC.', 'CCH-17 de S21.G00.40.003');
      var oblig = ['002', '004', '006', '013', '014', '015'].filter(function (f) { return one('S21.G00.30.' + f) === null; });
      C(K, oblig.length ? 'err' : 'ok', oblig.length ? 'Rubrique(s) obligatoire(s) absente(s) du bloc Individu' : 'Rubriques obligatoires du bloc Individu présentes', oblig.map(function (f) { return 'S21.G00.30.' + f + ' ' + label('S21.G00.30.' + f); }).join(' · '), 'Tableau des usages, DSN mensuelle');
      var risque = one('S21.G00.40.040');
      if (risque === '999ZZ') C(K, one('S21.G00.40.043') === null ? 'ok' : 'err', 'Code risque 999ZZ : pas de taux AT dans le bloc contrat', 'La rubrique S21.G00.40.043 est interdite avec 999ZZ.', 'SIG-11 de S21.G00.40.043');
      var b50 = bl.filter(function (b) { return b.id === 'S21.G00.50'; })[0];
      if (b50) {
        var base = amt(get(b50, '013')), tx = parseFloat(get(b50, '006') || '0'), mt = amt(get(b50, '009') || '0');
        var att = Math.round(base * tx / 100);
        C(K, Math.abs(att - mt) <= 100 ? 'ok' : 'err', 'Prélèvement à la source : ' + eur(base) + ' × ' + String(tx).replace('.', ',') + ' % = ' + eur(att) + ' (déclaré ' + eur(mt) + ')', 'Tolérance ± 1 €', 'CCH-11 de S21.G00.50.009');
        if (get(b50, '007') === '01') C(K, get(b50, '008') ? 'ok' : 'err', 'Taux transmis par la DGFiP : identifiant du taux ' + (get(b50, '008') ? 'renseigné' : 'manquant'), 'Reportez l\'identifiant figurant dans le compte rendu PAS de la DGFiP.', 'CCH-11 de S21.G00.50.008');
        var dv = parseDMY(get(b50, '001')), d5 = parseDMY(one('S20.G00.05.005'));
        if (dv && d5) {
          var finM = { y: d5.y, m: d5.m, d: dim(d5.y, d5.m) }, mS = d5.m === 12 ? { y: d5.y + 1, m: 1 } : { y: d5.y, m: d5.m + 1 }, finS = { y: mS.y, m: mS.m, d: dim(mS.y, mS.m) };
          if (dnum(dv) > dnum(finS)) C(K, 'err', 'Date de versement ' + fr(dv) + ' postérieure au mois suivant le mois déclaré', '', 'CCH-13 de S21.G00.50.001');
          else if (dnum(dv) > dnum(finM)) C(K, 'warn', 'Date de versement ' + fr(dv) + ' dans le mois suivant (décalage de paie)', 'Admis par la norme, mais vérifiez que c\'est voulu : le salaire est rattaché au mois déclaré.', 'CCH-13 de S21.G00.50.001');
          else if (dnum(dv) < dnum({ y: d5.y, m: d5.m, d: 1 })) C(K, 'warn', 'Date de versement ' + fr(dv) + ' antérieure au mois déclaré', 'Le versement serait alors à déclarer dans la DSN du mois où il a eu lieu.', '');
          else C(K, 'ok', 'Date de versement ' + fr(dv) + ' dans le mois déclaré', '', 'CCH-13 de S21.G00.50.001');
        }
        var totPas = 0; bl.forEach(function (b) { if (b.id === 'S21.G00.50') totPas += amt(get(b, '009') || '0'); });
        var b20 = bl.filter(function (b) { return b.id === 'S21.G00.20' && get(b, '001') === 'DGFIP'; })[0];
        if (totPas > 0 && !b20) C(K, 'err', 'Impôt prélevé (' + eur(totPas) + ') sans bloc Versement DGFiP', 'Ajoutez l\'IBAN et le BIC de la société dans la configuration : DSNap génère alors le bloc S21.G00.20 (DGFIP, DGFIP_PAS, prélèvement SEPA).', 'CT S21.G00.20');
        if (b20) {
          var pb = [];
          if (get(b20, '002') !== 'DGFIP_PAS' && get(b20, '002') !== 'DGFIP_SATD') pb.push('20.002 doit valoir DGFIP_PAS (CCH-11)');
          if (['05', '06'].indexOf(get(b20, '010')) < 0) pb.push('20.010 doit valoir 05 ou 06 (CCH-14)');
          if (get(b20, '010') === '05' && (!get(b20, '004') || get(b20, '004') === 'A RENSEIGNER')) pb.push('IBAN obligatoire en prélèvement (CCH-12)');
          if (get(b20, '010') === '05' && (!get(b20, '003') || get(b20, '003') === 'A RENSEIGNER')) pb.push('BIC attendu en prélèvement (SIG-13)');
          if (get(b20, '010') === '05' && amt(get(b20, '005')) !== toEuro(totPas)) pb.push('montant ' + get(b20, '005') + ' au lieu de ' + dsnAmt(toEuro(totPas)) + ' (PAS arrondi à l\'euro)');
          C(K, pb.length ? 'err' : 'ok', 'Bloc Versement DGFiP ' + (pb.length ? 'incomplet' : 'conforme') + ' : ' + get(b20, '005'), pb.join(' · '), 'CT S21.G00.20');
        }
        var has58 = bl.some(function (b) { return b.id === 'S21.G00.58' && get(b, '003') === '03'; });
        C(K, has58 ? 'ok' : 'err', 'Montant net social (bloc 58, type 03) ' + (has58 ? 'présent' : 'absent'), '', 'CCH-14 de S21.G00.50.001');
      }
      var unit = one('S21.G00.40.011'), b53 = bl.filter(function (b) { return b.id === 'S21.G00.53'; });
      if (unit === '10' || unit === '12') C(K, b53.length ? 'ok' : 'err', 'Quotité en ' + (unit === '10' ? 'heures' : 'jours') + ' : au moins un bloc Activité (53) ' + (b53.length ? 'présent' : 'absent'), '', 'CCH-15 de S21.G00.40.011');
      var ctx = null, bad53 = [];
      bl.forEach(function (b) { if (b.id === 'S21.G00.51') ctx = get(b, '011'); if (b.id === 'S21.G00.53' && get(b, '003') === '40' && (ctx !== '001' || get(b, '001') !== '01')) bad53.push(b); });
      if (b53.length) C(K, bad53.length ? 'err' : 'ok', 'Activité en jours calendaires (unité 40) rattachée à la rémunération 001, type 01', '', 'CCH-12 de S21.G00.53.001, CCH-15 de S21.G00.53.003');
      var ctr = one('S21.G00.40.009');
      if (ctr) C(K, all('S21.G00.51.010').some(function (l) { return l.v === ctr; }) ? 'ok' : 'err', 'Numéro de contrat ' + ctr + ' repris dans les rémunérations', '', 'CCH-13 de S21.G00.40.009');
      var dep2 = one('S21.G00.30.014');
      if (dep2 && dep2 !== '99') C(K, one('S21.G00.30.007') ? 'ok' : 'err', 'Lieu de naissance ' + (one('S21.G00.30.007') ? 'renseigné' : 'manquant') + ' (né en France)', '', 'CCH-11 de S21.G00.30.007');
    }
    var b22 = bl.filter(function (b) { return b.id === 'S21.G00.22'; });
    b22.forEach(function (b) {
      var v = get(b, '005');
      C(K, /\.00$/.test(v) ? 'ok' : 'err', 'Bordereau Urssaf ' + v + (/\.00$/.test(v) ? ' : arrondi à l\'euro' : ' : doit être arrondi à l\'euro (.00)'), '', 'S21.G00.22.005 (modalités Urssaf)');
    });
    var b23 = bl.filter(function (b) { return b.id === 'S21.G00.23'; });
    if (b23.length) {
      var nonArr = b23.filter(function (b) { return ['004', '005'].some(function (f) { var v = get(b, f); return v && !/\.00$/.test(v); }); });
      C(K, nonArr.length ? 'warn' : 'ok', nonArr.length ? nonArr.length + ' montant(s) de cotisation agrégée non arrondi(s) à l\'euro' : 'Montants des cotisations agrégées arrondis à l\'euro',
        nonArr.map(function (b) { return 'CTP ' + get(b, '001') + '/' + get(b, '002') + ' : ' + (get(b, '004') || get(b, '005')); }).join(' · ') + (nonArr.length ? ' — le guide Urssaf demande des montants arrondis à l\'euro (assiettes et cotisations).' : ''), 'Guide Urssaf DSN §1.6');
    }

    // --- Recalcul des montants
    if (!neant && b23.length && b22.length) {
      // Assiettes 23 vs bases 78
      var b78 = {}; bl.forEach(function (b) { if (b.id === 'S21.G00.78') b78[get(b, '001')] = (b78[get(b, '001')] || 0) + amt(get(b, '004')); });
      var chk = [];
      b23.forEach(function (b) {
        var code = get(b, '001'), q = get(b, '002'); if (!get(b, '004')) return;
        var a = amt(get(b, '004')), ref = code === '260' ? b78['04'] : (q === '921' ? b78['02'] : b78['03']);
        if (ref === undefined) return;
        chk.push({ k: code + '/' + q, ok: Math.abs(a - ref) <= 100, a: a, ref: ref });
      });
      var badA = chk.filter(function (x) { return !x.ok; });
      C(M, badA.length ? 'warn' : 'ok', 'Assiettes des CTP cohérentes avec les bases individuelles (bloc 78)', badA.map(function (x) { return x.k + ' : ' + eur(x.a) + ' vs base ' + eur(x.ref); }).join(' · ') || chk.map(function (x) { return x.k + ' ≈ ' + eur(x.ref); }).join(' · '), 'Guide Urssaf §1.1');
    }
    if (!neant) {
      var base78 = {}; (function () { var x = ''; bl.forEach(function (b) { if (b.id === 'S21.G00.78') { x = get(b, '001'); base78[x] = amt(get(b, '004')); } }); })();
      var b50b = bl.filter(function (b) { return b.id === 'S21.G00.50'; })[0];
      if (b50b && base78['04'] !== undefined) {
        var net = amt(get(b50b, '004'));
        var mns = bl.filter(function (b) { return b.id === 'S21.G00.58' && get(b, '003') === '03'; })[0];
        if (mns) { var vm = amt(get(mns, '004')); C(M, vm === net ? 'ok' : 'warn', 'Montant net social ' + eur(vm) + (vm === net ? ' = ' : ' ≠ ') + 'net versé ' + eur(net), vm === net ? 'Aucune mutuelle, prévoyance ni avantage : les deux montants coïncident.' : '', ''); }
        var b001 = bl.filter(function (b) { return b.id === 'S21.G00.51' && get(b, '011') === '001'; })[0];
        if (b001 && base78['03'] !== undefined) C(M, amt(get(b001, '013')) === base78['03'] ? 'ok' : 'warn', 'Brut déclaré ' + eur(amt(get(b001, '013'))) + ' = base déplafonnée ' + eur(base78['03']), '', '');
        var exo81 = 0, ctx4 = ''; bl.forEach(function (b) { if (b.id === 'S21.G00.78') ctx4 = get(b, '001'); if (b.id === 'S21.G00.81' && get(b, '001') === '011') exo81 = -amt(get(b, '004')); });
        var exo23 = 0; b23.forEach(function (b) { if (get(b, '001') === '401') exo23 = amt(get(b, '005')); });
        if (exo81 || exo23) C(M, Math.abs(toEuro(exo81) - exo23) <= 100 ? 'ok' : 'warn', 'Exonération ACRE : individuelle ' + eur(exo81) + ' / agrégée ' + eur(exo23), 'Au niveau individuel le montant est négatif ; au niveau agrégé il est sans signe (le CTP 401 porte le signe).', 'Guide Urssaf, réductions');
      }
    }

    // --- Vigilance
    if (!neant) {
      var cue = one('S21.G00.30.013'), pays = one('S21.G00.30.015');
      if (cue === '04' && (pays === 'FR' || (one('S21.G00.30.014') && one('S21.G00.30.014') !== '99'))) C(V, 'warn', 'Codification UE = 04 (reste du monde) pour une personne née en France', 'Cette rubrique classe l\'origine du salarié. Pour une personne de nationalité française, la valeur attendue est 01 (France). Sans effet sur les montants, mais à corriger dans la prochaine DSN.', 'S21.G00.30.013');
      else if (cue) C(V, 'ok', 'Codification UE : ' + cue + ' (' + meaning('S21.G00.30.013', cue) + ')', '');
      var risque2 = one('S21.G00.40.040'), tauxAT = null;
      b23.forEach(function (b) { if (get(b, '001') === '863' && get(b, '002') === '920') tauxAT = get(b, '003'); });
      if (risque2 === '999ZZ') C(V, 'warn', 'Code risque AT « 999ZZ » et taux AT ' + (tauxAT || '—') + ' %', '999ZZ est prévu tant que la CARSAT ne vous a pas notifié de code risque. Vérifiez le « compte AT/MP » sur net-entreprises : un taux est normalement notifié après la première embauche ; dès qu\'il l\'est, déclarez ce code et ce taux (la cotisation AT n\'est pas couverte par l\'ACRE, et une cotisation déclarée à 0 % pourra être régularisée).', 'CT S21.G00.40.040');
      var has20 = bl.some(function (b) { return b.id === 'S21.G00.20'; });
      var aa = 0; bl.forEach(function (b) { if (b.id === 'S21.G00.81' && (get(b, '001') === '131' || get(b, '001') === '132')) aa += amt(get(b, '004')); });
      var has20U = bl.some(function (b) { return b.id === 'S21.G00.20' && get(b, '001') !== 'DGFIP'; });
      void has20;
      if (!has20U) C(V, 'info', 'Urssaf et Agirc-Arrco : pas de bloc Versement, paiements hors DSN', 'Urssaf : normal si vous payez par télépaiement ou virement (guide Urssaf §6.2). Agirc-Arrco : ' + eur(aa) + ' déclarés ce mois-ci ; vérifiez auprès de votre caisse comment ils sont réglés (adhésion, prélèvement ou paiement direct).', 'Guide Urssaf §6.2');
      var d5b = parseDMY(one('S20.G00.05.005'));
      var exoPresent = all('S21.G00.81.001').some(function (l) { return l.v === '011'; });
      var finA = opt.inp && parseISO(opt.inp.acreFin);
      if (d5b && exoPresent && finA && dnum({ y: d5b.y, m: d5b.m, d: 1 }) > dnum(finA)) C(V, 'err', 'Exonération ACRE déclarée après sa date de fin (' + fr(finA) + ')', '', '');
      var norme = one('S10.G00.00.006');
      if (d5b && d5b.y >= 2027 && norme === 'P26V01') C(V, 'warn', 'Norme P26V01 pour un mois de ' + d5b.y, 'La norme 2027 (P27V01) s\'appliquera aux DSN de 2027 : à mettre à jour avant dépôt.', '');
      var logi = one('S10.G00.00.001');
      if (logi && opt.parse) C(V, 'info', 'Logiciel qui a produit le fichier : ' + logi + ' ' + (one('S10.G00.00.003') || ''), '', '');
      if (one('S10.G00.00.005') === '01') C(V, 'info', 'Fichier de TEST (S10.G00.00.005 = 01)', 'Déposé sur net-entreprises, il est contrôlé (bilan + comptes rendus Urssaf sous 4 h) mais n\'est pas transmis aux organismes. Repassez en 02 pour le dépôt réel.', 'Guide Urssaf §8.1');
    }

    // --- Tables de référence officielles (nomenclatures publiées par net-entreprises), si elles sont fournies
    if (opt.nomenclatures) {
      var T = 'Tables de référence (nomenclatures)';
      try { opt.nomenclatures.controler(lines).forEach(function (x) { C(T, x.lvl, x.title, x.detail, x.ref); }); }
      catch (e) { C(T, 'warn', 'Contrôle des tables de référence impossible', String(e && e.message || e), ''); }
    }

    // --- Paie (hors DSN), uniquement pour le calcul
    if (opt.r) {
      var r = opt.r, inp = opt.inp;
      if (r.trNb > 0) {
        C(Pp, 'warn', 'Titres-restaurant attribués au président', 'Pour un président sans contrat de travail et sans salarié, l\'exonération de la part patronale est contestée (la Commission nationale des titres-restaurant considère qu\'il n\'y a pas droit ; la tolérance de l\'Urssaf suppose que les salariés en bénéficient aussi). À valider avec votre expert-comptable.', '');
        var pctPat = +inp.trPartPat;
        C(Pp, pctPat >= 50 && pctPat <= 60 && r.trPatU <= (r.taux || {}).trPatMax ? 'ok' : 'err', 'Titres-restaurant : part patronale ' + String(pctPat).replace('.', ',') + ' % = ' + eur(r.trPatU) + ' par titre', 'Exonération si la société paie entre 50 % et 60 % du titre, dans la limite de ' + eur((r.taux || {}).trPatMax) + ' (2026).', '');
        C(Pp, r.trNb <= r.jo.n ? 'ok' : 'warn', r.trNb + ' titre(s) pour ' + r.jo.n + ' jour(s) ouvré(s) en ' + r.label, 'Un titre par jour travaillé ; les jours de congé ou d\'absence n\'en donnent pas.', '');
      }
      if (r.frais.total > 0) {
        var pr = r.frais.prorataMilli;
        C(Pp, pr <= 20000 ? 'ok' : (pr <= 34000 ? 'warn' : 'err'), 'Quote-part du logement remboursée : ' + bpPct(rhu(pr, 10)), pr <= 20000 ? 'Prorata surface × temps d\'usage : prudent et justifiable.' : 'Au-delà d\'environ 1/6, il faut pouvoir prouver un usage professionnel exclusif de la pièce.', '');
      }
      if (inp.budgetCible) C(Pp, r.budget <= inp.budgetCible ? 'ok' : 'warn', 'Coût total du mois ' + eur(r.budget) + (r.budget <= inp.budgetCible ? ' ≤ ' : ' > ') + 'budget cible ' + eur(inp.budgetCible), 'Salaire chargé ' + eur(r.coutSalaire) + ' + frais ' + eur(r.frais.total) + ' + titres (part société) ' + eur(r.trPat), '');
      r.err.forEach(function (e) { C(Pp, 'err', e, ''); });
      r.warn.forEach(function (e) { C(Pp, 'warn', e, ''); });
      r.info.forEach(function (e) { C(Pp, 'info', e, ''); });
    }
    return out;
  }

  /* ---------- 14. Valeurs d'un résultat, par clé (tests et récapitulatifs) ---------- */
  function refValue(r, k) {
    var c = r.c;
    switch (k) {
      case 'csg': return c.csgDed + c.csgNd; case 'crds': return c.crds; case 'exo': return c.exo; case 'vp': return c.vpS + c.vpP; case 'vd': return c.vdS + c.vdP;
      case 'mal': return c.mal; case 'malC': return c.malC; case 'af': return c.af; case 'afC': return c.afC; case 'csa': return c.csa; case 'fnal': return c.fnal; case 'dial': return c.dial; case 'cfp': return c.cfp; case 'ta': return c.ta;
      case 'frais': return r.frais.total;
      default: return r[k];
    }
  }
  function setVersion(v) { LOGICIEL_VERSION = String(v); }

  return {
    VAL: VAL, BLOCS: BLOCS, CODE81: CODE81, CTP: CTP, refValue: refValue, setVersion: setVersion,
    rhu: rhu, pm: pm, toEuro: toEuro, amt: amt, get: get, eur: eur, pct: pct, bpPct: bpPct, dsnAmt: dsnAmt, dnum: dnum, dim: dim, fr: fr, iso: iso, parseISO: parseISO, parseDMY: parseDMY, moisLabel: moisLabel,
    joursOuvres: joursOuvres, label: label, meaning: meaning, clean: clean, clone: clone, periode: periode, computeFrais: computeFrais,
    defaultState: defaultState, resultatNeant: resultatNeant, entreesCalcul: entreesCalcul, buildDSN: buildDSN, toText: toText, toLatin1: toLatin1,
    parseDSN: parseDSN, blocsOf: blocsOf, keyed: keyed, diff: diff, extract: extract, controls: controls, nirKey: nirKey, luhn: luhn, joursOuvresListe: joursOuvres
  };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Noyau;
