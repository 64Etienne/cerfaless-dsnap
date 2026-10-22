// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Outils MCP de DSNap. Chaque outil renvoie { texte, donnees, erreur } ; le texte est ce que lit le modèle.
 * Aucun outil ne renvoie le NIR, ni les identifiants net-entreprises.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { VERSION } = require('./version.js');
const chemins = require('./chemins.js');
const secrets = require('./secrets.js');
const dossierMod = require('./dossier.js');
const NE = require('./netentreprises.js');
const demo = require('./demo.js');
const paie = require('./paie.js');
const tables = require('./tables.js');
const licence = require('./licence.js');
const configuration = require('./configuration.js');
const { masqueur, nirsDuTexte, masquerNirGenerique } = require('./confidentialite.js');
const E = require('./engine.js');

E.setVersion(VERSION);
const ENV = process.env;
const fail = NE.fail;
const UA = 'Client-DSN (DSNap/' + VERSION + '; SASU EBO)';

/* ------------------------------------------------------------------ contexte */
// « de juin 2026 », « d'octobre 2026 »
function dePrepMois(m) { const l = libMois(m); return /^[aeiouyéè]/i.test(l) ? 'd\'' + l : 'de ' + l; }
function modeDemo() { return ENV.DSNAP_DEMO === '1' || !!chemins.lireReglages().demo; }
function vrai(s) { return /^(1|true|oui)$/i.test(String(s || '')); }
function valeurEnv(k) { const v = ENV[k]; return v && !/^\$\{/.test(v) ? v : ''; }
function identifiantsExtension() {
  const o = { siret: valeurEnv('NE_SIRET'), nom: valeurEnv('NE_NOM'), prenom: valeurEnv('NE_PRENOM'), motdepasse: valeurEnv('NE_MOTDEPASSE') };
  return o.siret && o.nom && o.prenom && o.motdepasse ? o : null;
}
async function identifiants() {
  if (modeDemo()) return demo.IDENTIFIANTS;
  // les identifiants saisis sur la page de configuration priment sur ceux des réglages de l'extension
  const s = await secrets.lire().catch(function () { return null; });
  return s || identifiantsExtension();
}
let clientCache = null, clientDemo = null;
// identifiants refusés : empreintes gardées dans les réglages, partagées entre processus, effacées quand on en saisit d'autres
const REFUS = {
  contient: function (e) { const r = chemins.lireReglages().identifiantsRefuses; return Array.isArray(r) && r.indexOf(e) >= 0; },
  ajouter: function (e) { const r = chemins.lireReglages().identifiantsRefuses; chemins.modifierReglages({ identifiantsRefuses: (Array.isArray(r) ? r : []).concat([e]).slice(-10) }); }
};
function client() {
  const d = modeDemo();
  if (!clientCache || clientDemo !== d) {
    clientCache = NE.client({ identifiants: identifiants, demo: d ? demo.simulateur(NE.verifierFlux) : null, ua: UA, refus: d ? null : REFUS });
    clientDemo = d;
  }
  return clientCache;
}
function reinitialiserClient() { clientCache = null; secrets.oublierCache(); }
/** Dépôt réel sans confirmation : réglage de l'extension, ou choix fait sur la page de configuration pour CE dossier. */
function reelSansConfirmation(d) {
  if (vrai(ENV.NE_REEL_SANS_CONFIRMATION)) return true;
  const r = chemins.lireReglages().reelSansConfirmation;
  return !!(d && r && typeof r === 'object' && r[d.racine] === true);
}
function dossierDemo() {
  const dir = path.join(chemins.dossierDonnees(), 'demo', 'dossier');
  if (!fs.existsSync(path.join(dir, 'dsnap.json'))) { fs.mkdirSync(dir, { recursive: true }); dossierMod.ouvrir(dir).ecrireConfig(demo.configuration()); }
  return dir;
}
/** En démonstration, toujours le dossier de la société fictive (jamais un dossier réel). */
function dossier() { return dossierMod.ouvrir(modeDemo() ? dossierDemo() : chemins.dossierPaie()); }
function cheminDossierCourant() { return modeDemo() ? dossierDemo() : chemins.dossierPaie(); }

/* Numéros de sécurité sociale vus dans les fichiers lus : masqués dans toute sortie (voir serveur.js). */
const NIRS_VUS = new Set();
function voirNirs(texte) { nirsDuTexte(texte).forEach(function (n) { if (String(n).trim().length >= 5) NIRS_VUS.add(n); }); }
function masquerSortie(texte) {
  const v = Array.from(NIRS_VUS);
  try {
    const dp = cheminDossierCourant();
    if (dp && fs.existsSync(dp)) {
      const d = dossierMod.ouvrir(dp), cfg = d.lireConfig();
      if (cfg) { const st = paie.etatDepuisConfig(d, cfg, VERSION).st; if (st.indiv['S21.G00.30.001']) v.push(st.indiv['S21.G00.30.001']); }
    }
  } catch (e) { /* configuration illisible : masque des seuls numéros vus */ }
  return masqueur(v)(texte);
}
function config(d) {
  const cfg = d.lireConfig();
  if (!cfg) throw fail('La société n\'est pas encore configurée dans ce dossier de paie : ouvrez la configuration de DSNap (outil configurer_dsnap) pour la renseigner ou importer votre dernière DSN.', { configuration: true });
  return cfg;
}
function sirenDe(d, cfg) {
  try { return paie.etatDepuisConfig(d, cfg, VERSION).st.hdr['S21.G00.06.001'] || ''; } catch (e) { return (cfg.entete && cfg.entete['S21.G00.06.001']) || ''; }
}
function masqueDossier(d, cfg) {
  const v = [];
  try { const st = paie.etatDepuisConfig(d, cfg, VERSION).st; if (st.indiv['S21.G00.30.001']) v.push(st.indiv['S21.G00.30.001']); } catch (e) { /* rien */ }
  return masqueur(v);
}
function eur(n) { return E.eur(Math.round(n * 100)); }
function plusRecente(a, b) { const x = a.split('.').map(Number), y = b.split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; }
function dateFr(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || ''); return m ? m[3] + '/' + m[2] + '/' + m[1] : iso || ''; }
function libMois(mois) { const m = /^(\d{4})-(\d{2})$/.exec(mois || ''); return m ? paie.MOIS_FR[+m[2] - 1] + ' ' + m[1] : mois; }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function horodatage(d) { d = d || new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) + ' ' + pad2(d.getHours()) + 'h' + pad2(d.getMinutes()) + 'm' + pad2(d.getSeconds()); }
function attendre(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function moisPrecedent(d) { d = d || new Date(); const y = d.getMonth() === 0 ? d.getFullYear() - 1 : d.getFullYear(), m = d.getMonth() === 0 ? 12 : d.getMonth(); return y + '-' + pad2(m); }
function texteLicence(l) {
  let t = l.message || '';
  if (!l.autorise && l.liens) t += '\nS\'abonner : mensuel ' + l.liens.mensuel + ' · annuel ' + l.liens.annuel + ' (tarifs : ' + l.liens.tarifs + ').';
  return t;
}

/* ------------------------------------------------------------------ journal : mois déjà déclarés */
function declaresEnReel(d) {
  return d.lireJournal().filter(function (e) { return e.mode === 'reel' && ((e.http === 200 && !/KO/i.test(e.bilan || '')) || e.etat === 'incertain' || e.etat === 'envoi'); });
}

/* ------------------------------------------------------------------ outils */
async function outilEtat() {
  const reg = chemins.lireReglages();
  const lignes = ['DSNap ' + VERSION + (modeDemo() ? ' — MODE DÉMONSTRATION (société fictive, dépôts simulés, rien n\'est envoyé à net-entreprises)' : '')];
  const donnees = { version: VERSION, demo: modeDemo() };
  const dp = cheminDossierCourant();
  donnees.dossier = dp;
  if (!dp || !fs.existsSync(dp)) {
    lignes.push('Dossier de paie : non configuré. → Lancez configurer_dsnap : la page de configuration s\'ouvre dans le navigateur de l\'utilisateur.');
    donnees.pret = false;
    return { texte: lignes.join('\n'), donnees: donnees };
  }
  const d = dossierMod.ouvrir(dp);
  lignes.push('Dossier de paie : ' + d.racine);
  const cfg = d.lireConfig();
  const ident = await identifiants().catch(function () { return null; });
  donnees.identifiants = ident ? (modeDemo() ? 'démonstration' : (identifiantsExtension() && !(await secrets.lire().catch(function () { return null; })) ? 'réglages de l\'extension' : (reg.identifiants && reg.identifiants.stockage) || 'enregistrés')) : 'absents';
  lignes.push('Identifiants net-entreprises : ' + donnees.identifiants + (ident ? ' (SIRET du compte ' + ident.siret + ')' : ' → configurer_dsnap'));
  if (!cfg) {
    lignes.push('Société : pas encore configurée → configurer_dsnap (saisie ou import de la dernière DSN acceptée).');
    donnees.pret = false;
  } else {
    const st = paie.etatDepuisConfig(d, cfg, VERSION).st;
    const siret = (st.hdr['S21.G00.06.001'] || '') + (st.hdr['S21.G00.11.001'] || '');
    donnees.societe = { nom: cfg.client || st.hdr['S10.G00.01.003'] || '', siret: siret };
    donnees.automatisation = cfg.automatisation || {};
    lignes.push('Société : ' + donnees.societe.nom + ' — SIRET ' + siret + ' — président : ' + ((st.indiv['S21.G00.30.004'] || '') + ' ' + (st.indiv['S21.G00.30.002'] || '')).trim());
    lignes.push('Réglages : brut ' + ((cfg.automatisation && cfg.automatisation.brut && cfg.automatisation.brut.mode) || 'demande') + (cfg.automatisation && cfg.automatisation.brut && cfg.automatisation.brut.mode === 'fixe' ? ' (' + cfg.automatisation.brut.valeur + ' €)' : '') + ', dépôt réel ' + (reelSansConfirmation(d) ? 'automatique si le test est conforme (choisi par l\'utilisateur)' : 'après feu vert de l\'utilisateur') + '.');
    try {
      const l = await licence.statut(sirenDe(d, cfg), { demo: modeDemo(), version: VERSION, demarrer: false });
      donnees.abonnement = { statut: l.statut, fin: l.fin || null, liens: l.liens || null };
      lignes.push('Abonnement : ' + (l.message || l.statut));
      if (l.derniereVersion && plusRecente(l.derniereVersion, VERSION)) { donnees.miseAJour = l.derniereVersion; lignes.push('Mise à jour disponible : DSNap ' + l.derniereVersion + ' (vous avez ' + VERSION + '). Proposez à l\'utilisateur de mettre à jour l\'extension ou le plugin (https://cerfaless.fr/dsnap/installation).'); }
    } catch (e) { lignes.push('Abonnement : non vérifié (' + e.message + ').'); }
    donnees.pret = !!ident;
  }
  const t = tables.resume();
  donnees.tables = t;
  lignes.push('Tables de référence : ' + (t.length ? t.map(function (x) { return x.norme + ' ' + (x.version || '?') + ' du ' + dateFr(x.date) + ' (' + (x.origine || '') + ')'; }).join(', ') : 'aucune installée (mettre_a_jour_tables)'));
  // échéances, d'après le journal
  let declares = [];
  try { declares = declaresEnReel(d); } catch (e) { lignes.push('Journal des dépôts : ' + e.message); }
  const enSuspens = declares.filter(function (e) { return e.etat === 'incertain' || e.etat === 'envoi'; });
  if (enSuspens.length) lignes.push('À vérifier : ' + enSuspens.map(function (e) { return 'dépôt réel de ' + libMois(e.mois) + ' envoyé le ' + dateFr(e.horodatage) + ' sans réponse claire'; }).join(' ; ') + ' → rechercher_depots sur ces dates avant tout nouveau dépôt.');
  const parMois = {};
  declares.forEach(function (e) { parMois[e.mois] = e; });
  const mp = moisPrecedent();
  const ech = paie.echeance(mp);
  const fait = parMois[mp];
  donnees.echeance = { mois: mp, avant: ech, deposee: !!fait };
  lignes.push('Échéance : DSN de ' + libMois(mp) + ' à déposer au plus tard le ' + dateFr(ech) + (fait ? ' — déjà déposée en réel le ' + dateFr(fait.horodatage) + ' (flux ' + fait.idflux + ').' : ' — pas de dépôt réel dans le journal de DSNap (vérifiez avec rechercher_depots si elle a pu être faite ailleurs).'));
  const recents = Object.keys(parMois).sort().slice(-6);
  if (recents.length) lignes.push('Dépôts réels enregistrés par DSNap : ' + recents.map(function (m) { return m + ' (' + (parMois[m].type || '') + ', ' + (parMois[m].bilan || 'bilan ?') + ')'; }).join(', ') + '.');
  return { texte: lignes.join('\n'), donnees: donnees };
}

let contexteConfiguration = null;
function contexteConfig() {
  if (!contexteConfiguration) contexteConfiguration = {
    version: VERSION,
    testerConnexion: async function () { const c = client(); await c.authentifier(true); return 'Connexion réussie au service DSN de net-entreprises' + (modeDemo() ? ' (simulateur de démonstration)' : '') + '.'; },
    identifiantsChanges: reinitialiserClient,
    identifiantsExtension: function () { return !!identifiantsExtension(); },
    apresConfiguration: function () { /* rien */ }
  };
  return contexteConfiguration;
}
async function outilConfigurer() {
  const p = await configuration.demarrer(contexteConfig());
  const ouvert = configuration.ouvrirNavigateur(p.url);
  return {
    texte: (ouvert ? 'La page de configuration de DSNap s\'ouvre dans le navigateur de l\'utilisateur' : 'Page de configuration prête') + ' : ' + p.url + '\n' +
      'Dites à l\'utilisateur de la remplir dans l\'ordre (dossier de paie, identifiants net-entreprises, société, président, choix de paie), ou d\'essayer la démonstration. ' +
      'Il y saisit ses identifiants et son numéro de sécurité sociale lui-même : ne les lui demandez jamais dans la conversation. Ensuite, appelez etat_dsnap pour vérifier.',
    donnees: { url: p.url, ouvert: ouvert }
  };
}

function verifierDemo(d, cfg) {
  if (modeDemo() && sirenDe(d, cfg) !== demo.SIREN) throw fail('Mode démonstration : seule la société fictive peut être utilisée. Quittez la démonstration dans configurer_dsnap pour travailler sur votre société.');
}
async function outilPreparer(a) {
  const d = dossier(), cfg = config(d);
  verifierDemo(d, cfg);
  const brut = a.brut === undefined || a.brut === null ? null : Number(a.brut);
  if (brut !== null && (!isFinite(brut) || brut < 0)) throw fail('Brut invalide : ' + a.brut);
  const simuler = a.simuler === true;
  const avecSalaire = brut === null ? !!(cfg.automatisation && cfg.automatisation.brut && cfg.automatisation.brut.mode === 'fixe' && Number(cfg.automatisation.brut.valeur) > 0) : brut > 0;
  let lic = null;
  if (avecSalaire && !simuler) {
    lic = await licence.autoriser(sirenDe(d, cfg), { demo: modeDemo(), version: VERSION });
    if (!lic.autorise) return { texte: 'Paie avec salaire non préparée : ' + texteLicence(lic) + '\nGratuit : simuler cette paie (simuler = true), préparer et déposer une DSN néant, contrôler un fichier.', donnees: { licence: lic }, erreur: true };
  }
  let majTables = null;
  try { majTables = await tables.siNecessaire(); } catch (e) { majTables = { message: 'Mise à jour des tables impossible : ' + e.message }; }
  const r = paie.preparer({
    dossier: d, cfg: cfg, mois: a.mois, brut: brut === null ? undefined : brut, dateVersement: a.date_versement, numero: a.numero_ordre,
    tr: a.titres_restaurant, loyer: a.loyer, elec: a.electricite, box: a.box, mobile: a.mobile, assurance: a.assurance,
    pasTaux: a.taux_pas, pasId: a.id_taux_pas, simuler: simuler, controleurTables: tables.controleur(), version: VERSION
  });
  const R = r.resultats;
  const l = [];
  l.push((simuler ? 'Simulation (aucun fichier écrit)' : (r.pret ? 'Paie prête' : 'Paie préparée AVEC ERREURS BLOQUANTES')) + ' — ' + r.libelle + ' : ' + r.type + ', numéro d\'ordre ' + r.numeroOrdre + ', à déposer au plus tard le ' + dateFr(r.echeanceDepot) + '.');
  if (!r.neant) {
    l.push('Brut ' + eur(R.netAvantImpot + R.cotisationsSalariales) + ' → net avant impôt ' + eur(R.netAvantImpot) + ' → impôt à la source ' + eur(R.pas) + ' → virement du salaire ' + eur(R.virementSalaire) + '.');
    l.push('Charges patronales ' + eur(R.chargesPatronales) + (R.exonerationAcre ? ' (après ACRE ' + eur(R.exonerationAcre) + ')' : '') + ' ; coût du salaire ' + eur(R.coutSalaire) + ' ; coût total du mois avec frais et titres ' + eur(R.coutTotalMois) + (R.budgetMensuel ? ' (budget ' + eur(R.budgetMensuel) + ')' : '') + '.');
    l.push('À payer : Urssaf ' + eur(R.bordereauUrssaf) + ' (télépaiement, échéance du ' + dateFr(r.echeanceDepot) + '), Agirc-Arrco et Apec ' + eur(R.agircArrcoApec) + ' (selon votre caisse).');
    if (r.virements.length) l.push('Virements : ' + r.virements.map(function (v) { return v.quoi + ' ' + eur(v.montant) + ' → ' + v.qui + ' (' + v.quand + ')'; }).join(' ; ') + '.');
  } else l.push('Aucune rémunération versée ce mois-ci : DSN néant, sans bulletin ni cotisation.');
  if (r.fichiers) l.push('Fichiers (dossier de paie) : DSN de test « ' + r.fichiers.dsnTest + ' », DSN réelle « ' + r.fichiers.dsnReel + ' »' + (r.fichiers.bulletin ? ', bulletin « ' + r.fichiers.bulletin + ' »' : '') + (r.fichiers.noteFrais ? ', note de frais « ' + r.fichiers.noteFrais + ' »' : '') + '.');
  if (r.erreurs.length) l.push('ERREURS BLOQUANTES (ne pas déposer) :\n- ' + r.erreurs.join('\n- '));
  if (r.vigilance.length) l.push('Points de vigilance :\n- ' + r.vigilance.join('\n- '));
  if (r.nomenclatures) l.push('Codes vérifiés avec les tables officielles ' + r.nomenclatures.norme + ' ' + r.nomenclatures.version + ' du ' + dateFr(r.nomenclatures.date) + '.');
  if (majTables && majTables.message) l.push('Tables de référence : ' + majTables.message);
  if (lic && (lic.statut === 'essai' || lic.statut === 'lancement')) l.push('Abonnement : ' + lic.message);
  if (!simuler && r.pret) l.push('Étape suivante : deposer_dsn en mode test sur le fichier de test, puis, avec l\'accord explicite de l\'utilisateur, en mode reel sur le fichier réel.');
  return { texte: l.join('\n'), donnees: r, erreur: !r.pret };
}

async function outilBudget(a) {
  const d = dossier(), cfg = config(d);
  const r = paie.preparer({ dossier: d, cfg: cfg, mois: a.mois, budgetMax: true, budget: a.budget, tr: a.titres_restaurant, version: VERSION });
  if (r.brutMax === null) return { texte: r.message, donnees: r };
  return { texte: 'Pour un budget de ' + eur(r.budget) + ' en ' + libMois(a.mois) + ' : brut maximal ' + eur(r.brutMax) + ' → virement du salaire ' + eur(r.salaireVire) + ', frais remboursés ' + eur(r.fraisRembourses) + ', coût total ' + eur(r.coutTotal) + ' (ACRE : ' + r.acre + ').' + (r.plafond ? ' ' + r.plafond + '.' : '') + ' Simulation gratuite : rien n\'est écrit.', donnees: r };
}

async function outilVerifier(a) {
  const d = dossier();
  const chemin = d.dans(a.fichier);
  if (!fs.existsSync(chemin)) throw fail('Fichier introuvable dans le dossier de paie : ' + a.fichier);
  const buf = fs.readFileSync(chemin);
  voirNirs(buf.toString('latin1'));
  const v = NE.verifierFlux(buf, await client().siretCompte());
  try { await tables.siNecessaire(); } catch (e) { /* tables locales */ }
  const c = paie.controlerFichier(buf, { controleurTables: tables.controleur() });
  const pret = v.ok && c.pret;
  const l = [(pret ? 'Fichier prêt à déposer' : 'Fichier NON conforme') + ' : DSN ' + c.declaration + ' ' + dePrepMois(c.mois) + ', fichier ' + (c.type === 'test' ? 'de TEST' : c.type === 'réel' ? 'RÉEL' : 'de type inconnu') + ', norme ' + c.norme + ', ' + c.lignes + ' lignes, ' + c.reussis + ' contrôles réussis.'];
  const err = v.erreurs.concat(c.erreurs);
  if (err.length) l.push('Erreurs bloquantes :\n- ' + err.join('\n- '));
  const vig = v.avertissements.concat(c.vigilance);
  if (vig.length) l.push('Vigilance :\n- ' + vig.join('\n- '));
  if (c.nomenclatures) l.push('Tables officielles utilisées : ' + c.nomenclatures.norme + ' ' + c.nomenclatures.version + ' du ' + dateFr(c.nomenclatures.date) + '.');
  if (c.echeanceDepot) l.push('Échéance de ce mois : ' + dateFr(c.echeanceDepot) + '.');
  return { texte: l.join('\n'), donnees: { pret: pret, forme: v, contenu: c }, erreur: !pret };
}

async function bilanComplet(c, d, idflux, secondes, masque) {
  const fin = Date.now() + Math.max(0, Math.min(40, secondes || 0)) * 1000;
  let b = await c.retoursFlux(idflux);
  while ((!b.bilan || /COURS/i.test(b.bilan.statut || '')) && Date.now() < fin) { await attendre(c.demo ? 300 : 5000); b = await c.retoursFlux(idflux); }
  if (!b.bilan) return { statut: 'pas encore publié', retours: b.tous };
  const out = { statut: b.bilan.statut, retours: b.tous, url: b.bilan.url || null, contenu: null, fichier: null };
  if (b.bilan.url && !/COURS/i.test(b.bilan.statut || '')) {
    try {
      const res = await c.telecharger(String(b.bilan.url).replace(/&amp;/g, '&'));
      const nom = dossierMod.nomSur(horodatage() + ' bilan flux ' + idflux + '.xml');
      fs.writeFileSync(path.join(d.retours(), nom), res.body);
      out.fichier = 'retours/' + nom; out.contenu = masque(masquerNirGenerique(NE.extrait(res.body, 6000)));
    } catch (e) { out.contenu = null; }
  }
  d.majJournal(idflux, { bilan: out.statut });
  return out;
}

/* Heure d'un dépôt de la liste net-entreprises (yyyyMMddHHmmss, heure de Paris ou UTC) : écart en ms avec un instant. */
function ecartDepot(x, instant) {
  const enUTC = function (y) { const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(String(y)); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : NaN; };
  const u = enUTC(x.date), decalageParis = enUTC(NE.dateNE(new Date(instant))) - instant;
  return Math.min(Math.abs(u - instant), Math.abs(u - decalageParis - instant));
}
/** Retrouve dans la liste net-entreprises le flux d'un envoi : un seul dépôt inconnu du journal, à 5 minutes près. */
function fluxUnique(depots, journal, instant) {
  const connus = new Set(journal.map(function (e) { return e.idflux; }).filter(Boolean));
  const c = depots.filter(function (x) { return x.idflux && !connus.has(x.idflux) && ecartDepot(x, instant) < 300000; });
  return c.length === 1 ? c[0] : null;
}
async function retrouverFlux(c, d, entree, instant) {
  try {
    const x = fluxUnique(await c.depotsEntre(new Date(instant - 15 * 60000), new Date(instant + 15 * 60000)), d.lireJournal(), instant);
    if (!x) return null;
    d.majEntree(entree.id, { idflux: x.idflux, sourceFlux: 'liste des dépôts', etat: 'envoye', http: 200, statutListe: x.statut });
    return x;
  } catch (e) { return null; }
}

async function outilDeposer(a) {
  const mode = a.mode === 'reel' ? 'reel' : (a.mode === 'test' ? 'test' : null);
  if (!mode) throw fail('Paramètre mode : « test » ou « reel ».');
  const d = dossier();
  const liberer = d.verrouiller();
  try { return await deposer(d, a, mode); } finally { liberer(); }
}
async function deposer(d, a, mode) {
  const cfg = d.lireConfig() || {};
  const masque = masqueDossier(d, cfg);
  const chemin = d.dans(a.fichier);
  if (!fs.existsSync(chemin)) throw fail('Fichier introuvable dans le dossier de paie : ' + a.fichier);
  const buf = fs.readFileSync(chemin);
  voirNirs(buf.toString('latin1'));
  const c = client();
  const v = NE.verifierFlux(buf, await c.siretCompte());
  if (!v.ok) return { texte: 'Dépôt refusé avant envoi, le fichier n\'est pas conforme : ' + v.erreurs.join(' | '), donnees: v, erreur: true };
  if (mode === 'test' && v.essaiReel !== '01') throw fail('Ce fichier est un fichier RÉEL (S10.G00.00.005 = 02) : pour un dépôt de test, utilisez le fichier de test (01).');
  if (mode === 'reel' && v.essaiReel !== '02') throw fail('Ce fichier est un fichier de TEST (S10.G00.00.005 = 01) : pour le dépôt réel, utilisez le fichier réel (02).');
  if (modeDemo() && v.siren !== demo.SIREN) throw fail('Mode démonstration : seuls les fichiers de la société fictive peuvent être déposés (au simulateur). Quittez la démonstration dans configurer_dsnap pour déposer vos vraies DSN.');
  const contenu = paie.controlerFichier(buf, { controleurTables: tables.controleur() });
  if (!contenu.pret && mode === 'reel') return { texte: 'Dépôt réel refusé avant envoi : le contrôle du contenu signale des erreurs bloquantes :\n- ' + contenu.erreurs.join('\n- '), donnees: { contenu: contenu }, erreur: true };
  const journal = d.lireJournal();
  let lic = null;
  if (mode === 'reel') {
    const incertains = journal.filter(function (e) { return e.mode === 'reel' && e.mois === v.mois && e.siret === v.siret && (e.etat === 'incertain' || e.etat === 'envoi'); });
    if (incertains.length) throw fail('Un dépôt réel de ' + libMois(v.mois) + ' a été envoyé le ' + dateFr(incertains[0].horodatage) + ' sans réponse claire de net-entreprises : il a peut-être été reçu. Ne redéposez pas. Lancez rechercher_depots sur le ' + dateFr(incertains[0].horodatage) + ' : DSNap y retrouvera ce dépôt (ou constatera qu\'il n\'a pas été reçu) et mettra son journal à jour.');
    const meme = journal.filter(function (e) { return e.mode === 'reel' && e.hash === v.hash && e.http === 200 && !/KO/i.test(e.bilan || ''); });
    if (meme.length) throw fail('Cette déclaration a déjà été déposée en réel le ' + dateFr(meme[0].horodatage) + ' (flux ' + meme[0].idflux + ') : un second dépôt créerait un doublon.');
    const moisDeclare = journal.filter(function (e) { return e.mode === 'reel' && e.mois === v.mois && e.siret === v.siret && e.http === 200 && !/KO/i.test(e.bilan || ''); });
    if (moisDeclare.length) throw fail('Une DSN réelle de ' + libMois(v.mois) + ' a déjà été déposée pour ce SIRET le ' + dateFr(moisDeclare[0].horodatage) + ' (flux ' + moisDeclare[0].idflux + ', bilan ' + (moisDeclare[0].bilan || '?') + '). Une seconde DSN normale du même mois est un doublon (anomalie B1-208-09) ; corriger une déclaration acceptée passe par une DSN « annule et remplace », que DSNap ne produit pas encore : déposez-la sur net-entreprises.fr ou voyez votre expert-comptable.');
    if (!reelSansConfirmation(d) && a.confirmation_utilisateur !== true) throw fail('Dépôt réel refusé : il faut la confirmation explicite de l\'utilisateur dans la conversation (confirmation_utilisateur = true), donnée juste avant ce dépôt.');
    const tests = journal.filter(function (e) { return e.mode === 'test' && e.hash === v.hash && e.idflux && e.http === 200 && (e.sourceFlux === 'accusé' || e.sourceFlux === 'liste des dépôts'); });
    if (!tests.length) throw fail('Dépôt réel refusé : déposez d\'abord la même déclaration en mode test (le fichier de test ne diffère que par S10.G00.00.005), puis attendez son bilan.');
    const dernier = tests[tests.length - 1];
    const b = await c.retoursFlux(dernier.idflux);
    if (!b.bilan) throw fail('Le bilan du dépôt test (flux ' + dernier.idflux + ') n\'est pas encore disponible : réessayez dans quelques minutes.');
    if (/KO/i.test(b.bilan.statut)) throw fail('Le dépôt test (flux ' + dernier.idflux + ') a un bilan KO : corrigez la déclaration avant le dépôt réel.');
    if (/COURS/i.test(b.bilan.statut)) throw fail('Le bilan du dépôt test est encore en cours : réessayez dans quelques minutes.');
    if (v.type !== 'néant') {
      lic = await licence.autoriser(v.siren, { demo: modeDemo(), version: VERSION });
      if (!lic.autorise) return { texte: 'Dépôt réel non effectué : ' + texteLicence(lic) + '\nLe fichier « ' + a.fichier + ' » reste utilisable pour un dépôt manuel sur net-entreprises.fr.', donnees: { licence: lic }, erreur: true };
    }
  }
  // l'envoi est noté AVANT de partir : si la réponse se perd, le mois reste bloqué jusqu'à vérification
  const entree = d.ajouterJournal({ id: crypto.randomUUID(), horodatage: new Date().toISOString(), fichier: d.relatif(chemin), mode: mode, mois: v.mois, type: v.type, siret: v.siret, hash: v.hash, etat: 'envoi', demo: modeDemo() || undefined, version: VERSION });
  const instant = Date.now();
  let res;
  try { res = await c.deposer(buf); }
  catch (e) {
    if (!e.pendantEnvoi) { d.majEntree(entree.id, { etat: 'non_envoye', erreur: e.message }); throw e; }
    d.majEntree(entree.id, { etat: 'incertain', erreur: e.message });
    const x = await retrouverFlux(c, d, entree, instant);
    if (x) return { texte: 'La réponse de net-entreprises s\'est perdue, mais le dépôt ' + (mode === 'test' ? 'TEST' : 'RÉEL') + ' ' + dePrepMois(v.mois) + ' a bien été reçu : flux ' + x.idflux + ' (' + x.statut + '). Lisez son bilan avec bilan_du_depot ; ne redéposez pas.', donnees: { accepte: true, idflux: x.idflux, sourceFlux: 'liste des dépôts', mois: v.mois, mode: mode } };
    throw fail('La connexion avec net-entreprises a été coupée pendant l\'envoi (' + e.message + ') : le dépôt a peut-être été reçu. NE REDÉPOSEZ PAS. ' + (mode === 'reel' ? 'DSNap bloque tout nouveau dépôt réel de ce mois tant que ce n\'est pas éclairci. ' : '') + 'Dans quelques minutes, lancez rechercher_depots pour aujourd\'hui : DSNap retrouvera le dépôt s\'il a été reçu.', { incertain: true });
  }
  const ct = String(res.headers['content-type'] || '');
  const texte = NE.decode(res.body);
  const ext = /json/i.test(ct) ? 'json' : (/xml/i.test(ct) ? 'xml' : 'txt');
  const nomAee = dossierMod.nomSur(horodatage() + ' DSN ' + v.mois + ' ' + mode + ' - ' + (res.status === 200 ? 'AEE' : 'reponse ' + res.status) + '.' + ext);
  fs.writeFileSync(path.join(d.retours(), nomAee), res.body);
  let j = null; try { j = JSON.parse(texte); } catch (e) { j = null; }
  let idflux = (j && (NE.chercher(j, 'idflux') || NE.chercher(j, 'id_flux') || NE.chercher(j, 'identifiantflux'))) || ((/<(?:\w+:)?idflux>([^<]+)<\//i.exec(texte) || [])[1]) || null;
  let sourceFlux = idflux ? 'accusé' : null;
  const etatEnvoi = (j && (NE.chercher(j, 'envoi_etat') || NE.chercher(j, 'etat'))) || ((/<envoi_etat>([^<]+)<\/envoi_etat>/i.exec(texte) || [])[1]) || null;
  const accepte = res.status === 200;
  const incertain = res.status >= 500;
  d.majEntree(entree.id, { idflux: idflux, sourceFlux: sourceFlux, etatEnvoi: etatEnvoi, http: res.status, reponse: 'retours/' + nomAee, etat: accepte ? 'envoye' : (incertain ? 'incertain' : 'refuse') });
  if (!idflux && (accepte || incertain)) {
    // l'accusé ne donne pas l'identifiant sous une forme connue, ou le serveur a répondu par une erreur : on cherche le
    // dépôt dans la liste du déclarant (un seul dépôt inconnu à 5 minutes près)
    const x = await retrouverFlux(c, d, entree, instant);
    if (x) { idflux = x.idflux; sourceFlux = 'liste des dépôts'; }
  }
  if (incertain && !idflux) throw fail('net-entreprises a répondu par une erreur (HTTP ' + res.status + ') pendant le dépôt : il a peut-être été reçu. NE REDÉPOSEZ PAS. Dans quelques minutes, lancez rechercher_depots pour aujourd\'hui : DSNap retrouvera le dépôt s\'il a été reçu.', { incertain: true });
  const recu = accepte || !!idflux;
  let bilan = null;
  if (recu && idflux && a.attendre_bilan !== false) {
    try { bilan = await bilanComplet(c, d, idflux, 30, masque); } catch (e) { bilan = { statut: 'non consultable pour l\'instant (' + e.message + ')' }; }
  }
  const t = (modeDemo() ? '[DÉMONSTRATION — dépôt simulé, rien n\'est envoyé] ' : '') + (recu ? 'Dépôt ' + (mode === 'test' ? 'TEST' : 'RÉEL') + ' enregistré par net-entreprises' : 'Dépôt refusé par net-entreprises (HTTP ' + res.status + ')') +
    ' : DSN ' + v.type + ' ' + dePrepMois(v.mois) + (idflux ? ', flux ' + idflux : '') + (etatEnvoi ? ', état de l\'envoi ' + etatEnvoi : '') + '. Réponse enregistrée dans retours/' + nomAee + '.' +
    (recu ? (bilan ? '\nBilan de conformité : ' + bilan.statut + (bilan.fichier ? ' (enregistré dans ' + bilan.fichier + ')' : '') + (bilan.contenu ? '\n' + bilan.contenu : '') : ' Le bilan de conformité arrive en général en quelques minutes : consultez-le avec bilan_du_depot.') : '\nExtrait : ' + masque(masquerNirGenerique(NE.extrait(texte, 600)))) +
    (recu && mode === 'test' && bilan && !/KO/i.test(bilan.statut || '') && !/COURS|pas encore/i.test(bilan.statut || '') ? '\nÉtape suivante : demandez à l\'utilisateur son feu vert pour le dépôt réel du fichier réel correspondant.' : '') +
    (mode === 'test' && !contenu.pret ? '\nContrôle de DSNap avant envoi (non bloquant en test) :\n- ' + contenu.erreurs.join('\n- ') : '') +
    (recu && mode === 'reel' ? '\nLes comptes rendus de l\'Urssaf arrivent dans les heures qui suivent (lister_retours). Pensez au paiement de l\'Urssaf avant l\'échéance.' : '');
  return { texte: t, donnees: { accepte: recu, http: res.status, idflux: idflux, sourceFlux: sourceFlux, etat: etatEnvoi, mois: v.mois, mode: mode, type: v.type, reponse: 'retours/' + nomAee, bilan: bilan ? { statut: bilan.statut, fichier: bilan.fichier || null } : null, demo: modeDemo() }, erreur: !recu || !!(bilan && /KO/i.test(bilan.statut || '')) };
}

async function outilTester() {
  const c = client();
  await c.authentifier(true);
  const e = c.etatJeton();
  return { texte: 'Connexion réussie au service DSN de net-entreprises' + (modeDemo() ? ' (simulateur de démonstration)' : '') + ' pour le SIRET ' + (await c.siretCompte()) + '. Jeton valable jusqu\'au ' + new Date(e.expiration).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) + '.', donnees: e };
}
async function outilListerRetours(a) {
  if (!a.id_flux) throw fail('Paramètre id_flux manquant.');
  const b = await client().retoursFlux(String(a.id_flux));
  if (!b.tous.length) return { texte: 'Aucun retour disponible pour le flux ' + a.id_flux + ' pour l\'instant.', donnees: { flux: b.flux } };
  return { texte: 'Retours du flux ' + a.id_flux + ' :\n' + b.tous.map(function (r) { return '- [' + r.nature + '] ' + r.libelle + ' : ' + r.statut + (r.url ? ' (téléchargeable : ' + r.url + ')' : ''); }).join('\n'), donnees: { flux: b.flux } };
}
async function outilTelecharger(a) {
  const d = dossier();
  const masque = masqueDossier(d, d.lireConfig() || {});
  const url = String(a.url || '');
  const res = await client().telecharger(url);
  const ct = String(res.headers['content-type'] || '');
  const ext = /pdf/i.test(ct) ? 'pdf' : (/xml/i.test(ct) ? 'xml' : (/json/i.test(ct) ? 'json' : 'txt'));
  const nom = dossierMod.nomSur(horodatage() + ' retour ' + (a.nom || url.split('/').slice(-2).join('-')) + '.' + ext);
  fs.writeFileSync(path.join(d.retours(), nom), res.body);
  const lisible = ext !== 'pdf';
  return { texte: 'Retour enregistré dans retours/' + nom + '.' + (lisible ? '\nContenu :\n' + masque(masquerNirGenerique(NE.extrait(res.body, 20000))) : ' (document PDF)'), donnees: { fichier: 'retours/' + nom, type: ct } };
}
async function outilBilan(a) {
  if (!a.id_flux) throw fail('Paramètre id_flux manquant.');
  const d = dossier();
  const b = await bilanComplet(client(), d, String(a.id_flux), a.attendre_secondes === undefined ? 20 : Number(a.attendre_secondes), masqueDossier(d, d.lireConfig() || {}));
  const t = 'Bilan du flux ' + a.id_flux + ' : ' + b.statut + (b.fichier ? ' (enregistré dans ' + b.fichier + ')' : '') + '.' +
    (b.retours && b.retours.length ? '\nRetours : ' + b.retours.map(function (r) { return '[' + r.nature + '] ' + r.libelle + ' ' + r.statut; }).join(' ; ') : '') +
    (b.contenu ? '\nContenu du bilan :\n' + b.contenu : '');
  return { texte: t, donnees: { statut: b.statut, fichier: b.fichier, retours: b.retours }, erreur: /KO/i.test(b.statut || '') };
}
async function outilRechercher(a) {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/;
  const x = re.exec(String(a.du || '')), z = re.exec(String(a.au || a.du || ''));
  if (!x || !z) throw fail('Paramètres du et au au format AAAA-MM-JJ.');
  const debut = new Date(+x[1], +x[2] - 1, +x[3]), fin = new Date(+z[1], +z[2] - 1, +z[3]);
  const jours = Math.round((fin - debut) / 86400000) + 1;
  if (jours < 1 || jours > 31) throw fail('Plage de 1 à 31 jours.');
  const c = client();
  let tous = [];
  for (let i = 0; i < jours; i++) {
    const j = new Date(debut.getFullYear(), debut.getMonth(), debut.getDate() + i);
    tous = tous.concat(await c.depotsJour(j.getFullYear() + pad2(j.getMonth() + 1) + pad2(j.getDate())));
  }
  let journal = [], d = null, rapproches = [];
  try { d = dossier(); journal = d.lireJournal(); } catch (e) { journal = []; }
  // dépôts envoyés sans réponse claire, dans la période cherchée : retrouvés dans la liste, ou constatés non reçus
  if (d) {
    const finRecherche = new Date(fin.getFullYear(), fin.getMonth(), fin.getDate(), 23, 59, 59).getTime();
    journal.filter(function (e) { return e.etat === 'incertain' || e.etat === 'envoi'; }).forEach(function (e) {
      const t = Date.parse(e.horodatage);
      if (!(t >= debut.getTime() && t <= finRecherche)) return;
      const x = fluxUnique(tous, journal, t);
      if (x) { d.majEntree(e.id, { idflux: x.idflux, sourceFlux: 'liste des dépôts', etat: 'envoye', http: 200, statutListe: x.statut }); rapproches.push('dépôt ' + e.mode + ' ' + dePrepMois(e.mois) + ' du ' + dateFr(e.horodatage) + ' retrouvé : flux ' + x.idflux + ' (lisez son bilan)'); }
      else if (Date.now() - t > 30 * 60000 && t + 15 * 60000 <= finRecherche) { d.majEntree(e.id, { etat: 'non_recu' }); rapproches.push('dépôt ' + e.mode + ' ' + dePrepMois(e.mois) + ' du ' + dateFr(e.horodatage) + ' absent de net-entreprises : non reçu, il peut être refait'); }
    });
    if (rapproches.length) journal = d.lireJournal();
  }
  const lignes = tous.map(function (y) {
    const connu = journal.filter(function (e) { return e.idflux === y.idflux; })[0];
    return Object.assign({}, y, connu ? { mois: connu.mois, mode: connu.mode, type: connu.type } : {});
  });
  const note = rapproches.length ? '\nJournal de DSNap mis à jour : ' + rapproches.join(' ; ') + '.' : '';
  if (!lignes.length) return { texte: 'Aucun dépôt sur net-entreprises du ' + dateFr(a.du) + ' au ' + dateFr(a.au || a.du) + '.' + note, donnees: { depots: [], rapproches: rapproches } };
  return { texte: note.trim() + (note ? '\n' : '') + 'Dépôts du ' + dateFr(a.du) + ' au ' + dateFr(a.au || a.du) + ' :\n' + lignes.map(function (y) { const s = String(y.date); return '- ' + s.slice(6, 8) + '/' + s.slice(4, 6) + ' ' + s.slice(8, 10) + 'h' + s.slice(10, 12) + ' flux ' + y.idflux + ' : ' + y.statut + (y.mois ? ' (DSN ' + y.mois + ', ' + y.mode + ', ' + y.type + ')' : ' (déposé hors de DSNap : ouvrez ses retours pour savoir quel mois il déclare)'); }).join('\n'), donnees: { depots: lignes } };
}
async function outilListerDepots(a) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(a.date || ''));
  if (!m) throw fail('Paramètre date au format AAAA-MM-JJ (la recherche net-entreprises est limitée à 24 heures).');
  const depots = await client().depotsJour(m[1] + m[2] + m[3]);
  if (!depots.length) return { texte: 'Aucun dépôt le ' + dateFr(a.date) + '.', donnees: { depots: [] } };
  return { texte: 'Dépôts du ' + dateFr(a.date) + ' :\n' + depots.map(function (x) { return '- flux ' + x.idflux + ' à ' + String(x.date).slice(8, 10) + 'h' + String(x.date).slice(10, 12) + ' : ' + x.statut; }).join('\n'), donnees: { depots: depots } };
}
async function outilJournal() {
  const j = dossier().lireJournal();
  if (!j.length) return { texte: 'Aucun dépôt enregistré par DSNap dans ce dossier.', donnees: { journal: [] } };
  return { texte: j.map(function (e) { return e.horodatage.slice(0, 16).replace('T', ' ') + ' — ' + e.mode.toUpperCase() + (e.demo ? ' (démo)' : '') + ' — DSN ' + e.type + ' ' + e.mois + ' — ' + (e.idflux ? 'flux ' + e.idflux : 'sans flux') + ' — HTTP ' + e.http + (e.bilan ? ' — bilan ' + e.bilan : ''); }).join('\n'), donnees: { journal: j } };
}
async function outilTables(a) {
  const r = await tables.mettreAJour({ forcer: a.forcer === true, verifier: a.verifier_seulement === true });
  const t = tables.resume();
  return { texte: 'Tables de référence : ' + (r.statut === 'a_jour' ? 'à jour' : r.statut) + '. ' + (r.message || '') + '\nInstallées : ' + (t.length ? t.map(function (x) { return x.norme + ' ' + x.version + ' du ' + dateFr(x.date); }).join(', ') : 'aucune'), donnees: { statut: r.statut, message: r.message, normes: r.normes, installees: t }, erreur: r.statut === 'echec' && !t.length };
}
async function outilAbonnement() {
  const d = dossier(), cfg = config(d);
  const l = await licence.statut(sirenDe(d, cfg), { demo: modeDemo(), version: VERSION, demarrer: false });
  const t = (l.message || l.statut) + (l.liens ? '\nS\'abonner : mensuel 6,90 € ' + l.liens.mensuel + ' · annuel 70 € ' + l.liens.annuel + '\nGérer l\'abonnement ou les factures : ' + l.liens.compte : '') + '\nToujours gratuit : DSN néant, contrôle de fichiers, dépôts de test, suivi des retours, simulation.';
  return { texte: t, donnees: l };
}

/* ------------------------------------------------------------------ définitions */
const S = function (props, req) { return { type: 'object', properties: props || {}, required: req || [], additionalProperties: false }; };
const FICHIER = { type: 'string', description: 'Chemin du fichier, relatif au dossier de paie (tel que renvoyé par preparer_dsn).' };
const OUTILS = [
  { name: 'etat_dsnap', title: 'État de DSNap', description: 'À appeler en premier : dossier de paie, société configurée, identifiants net-entreprises présents ou non, abonnement, tables de référence, prochaine échéance de DSN et derniers dépôts réels. Ne contacte pas net-entreprises (seulement le service d\'abonnement de DSNap, sans démarrer l\'essai).', inputSchema: S(), annotations: { readOnlyHint: true, openWorldHint: true }, run: outilEtat },
  { name: 'configurer_dsnap', title: 'Configurer DSNap', description: 'Ouvre dans le navigateur de l\'utilisateur la page de configuration locale de DSNap (dossier de paie, identifiants net-entreprises, société, président, choix de paie, ou mode démonstration). L\'utilisateur y saisit lui-même ses identifiants et son numéro de sécurité sociale : ils ne passent jamais par la conversation.', inputSchema: S(), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }, run: outilConfigurer },
  { name: 'preparer_dsn', title: 'Préparer la paie et la DSN d\'un mois', description: 'Calcule la paie du mois du président et écrit dans le dossier de paie la DSN de test, la DSN réelle, le bulletin et la note de frais (PDF), puis contrôle le fichier (format, cohérences, codes des tables officielles). brut = 0 : DSN néant (gratuite). Avec un salaire : essai de 7 jours puis abonnement, sauf simuler = true (gratuit, n\'écrit rien). Ne recalculez jamais les montants vous-même.', inputSchema: S({
    mois: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'Mois déclaré, AAAA-MM.' },
    brut: { type: 'number', description: 'Rémunération brute du mois en euros (0 = aucune rémunération : DSN néant). Facultatif si la configuration prévoit un brut fixe.' },
    date_versement: { type: 'string', description: 'Date du virement du salaire, AAAA-MM-JJ (par défaut aujourd\'hui dans le mois, sinon le dernier jour du mois).' },
    titres_restaurant: { type: 'integer', description: 'Nombre de titres-restaurant du mois (par défaut les jours ouvrés si la configuration en prévoit).' },
    loyer: { type: 'number', description: 'Loyer du mois en euros si différent du montant habituel.' },
    electricite: { type: 'number', description: 'Facture d\'électricité du mois en euros, si différente du montant habituel.' },
    assurance: { type: 'number', description: 'Assurance habitation du mois en euros, si différente.' },
    box: { type: 'number', description: 'Facture de box internet du mois en euros, si différente.' },
    mobile: { type: 'number', description: 'Forfait mobile du mois en euros, si différent.' },
    taux_pas: { type: 'number', description: 'Taux d\'impôt à la source transmis par la DGFiP, en % (sinon taux neutre).' },
    id_taux_pas: { type: 'string', description: 'Identifiant du taux DGFiP.' },
    numero_ordre: { type: 'integer', description: 'Numéro d\'ordre à imposer (rare : par défaut DSNap le tient à jour).' },
    simuler: { type: 'boolean', description: 'true : calcule et contrôle sans écrire de fichier (gratuit).' }
  }, ['mois']), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false }, run: outilPreparer },
  { name: 'simuler_budget', title: 'Brut maximal pour un budget', description: 'Calcule le brut le plus élevé dont le coût total (salaire chargé, frais remboursés, titres-restaurant) tient dans un budget mensuel. Gratuit, n\'écrit rien.', inputSchema: S({ mois: { type: 'string', pattern: '^\\d{4}-(0[1-9]|1[0-2])$', description: 'AAAA-MM' }, budget: { type: 'number', description: 'Budget mensuel total en euros (sinon celui de la configuration).' }, titres_restaurant: { type: 'integer' } }, ['mois']), annotations: { readOnlyHint: true, openWorldHint: false }, run: outilBudget },
  { name: 'verifier_fichier_dsn', title: 'Contrôler un fichier DSN', description: 'Contrôle un fichier DSN du dossier de paie (produit par DSNap ou un autre logiciel) : forme du flux, encodage, cohérences du cahier technique, recalcul des montants, codes face aux tables officielles de net-entreprises. Aucun envoi. Gratuit.', inputSchema: S({ fichier: FICHIER }, ['fichier']), annotations: { readOnlyHint: true, openWorldHint: false }, run: outilVerifier },
  { name: 'deposer_dsn', title: 'Déposer une DSN sur net-entreprises', description: 'Dépose un fichier DSN sur net-entreprises et renvoie le bilan. mode « test » : fichier de test (S10.G00.00.005 = 01), contrôlé par net-entreprises sans transmission aux organismes. mode « reel » : fichier réel (02) ; exige un dépôt test du même contenu au bilan non KO, et confirmation_utilisateur = true après l\'accord explicite de l\'utilisateur dans la conversation (sauf réglage contraire choisi par l\'utilisateur sur sa page de configuration). Refuse un doublon d\'un mois déjà déclaré et bloque le mois si un envoi précédent est resté sans réponse. Ne relancez jamais un dépôt après une coupure : utilisez rechercher_depots. Dépôt réel d\'une DSN avec salaire : essai ou abonnement ; DSN néant : gratuit.', inputSchema: S({
    fichier: FICHIER, mode: { type: 'string', enum: ['test', 'reel'] },
    confirmation_utilisateur: { type: 'boolean', description: 'true uniquement si l\'utilisateur vient de valider explicitement CE dépôt réel.' },
    attendre_bilan: { type: 'boolean', description: 'Par défaut, attend jusqu\'à 30 secondes le bilan de conformité. false pour rendre la main tout de suite.' }
  }, ['fichier', 'mode']), annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true }, run: outilDeposer },
  { name: 'bilan_du_depot', title: 'Lire le bilan d\'un dépôt', description: 'Attend (20 secondes par défaut, 40 au plus) puis télécharge et renvoie le bilan de conformité ou d\'anomalies d\'un flux, avec la liste de ses retours.', inputSchema: S({ id_flux: { type: 'string' }, attendre_secondes: { type: 'number', description: '0 à 40.' } }, ['id_flux']), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, run: outilBilan },
  { name: 'lister_retours', title: 'Lister les retours d\'un dépôt', description: 'Liste les retours net-entreprises d\'un dépôt (accusé, bilan, comptes rendus Urssaf, Agirc-Arrco, DGFiP…) avec leur statut OK, ANO, KO ou EN COURS.', inputSchema: S({ id_flux: { type: 'string', description: 'Identifiant du flux renvoyé par deposer_dsn.' } }, ['id_flux']), annotations: { readOnlyHint: true, openWorldHint: true }, run: outilListerRetours },
  { name: 'telecharger_retour', title: 'Télécharger un retour', description: 'Télécharge un retour (URL fournie par lister_retours), l\'enregistre dans le sous-dossier « retours » et renvoie son contenu lisible (XML ou texte), numéros de sécurité sociale masqués.', inputSchema: S({ url: { type: 'string' }, nom: { type: 'string', description: 'Facultatif : nom court pour le fichier enregistré.' } }, ['url']), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, run: outilTelecharger },
  { name: 'rechercher_depots', title: 'Rechercher les dépôts d\'une période', description: 'Liste tous les dépôts DSN du déclarant sur net-entreprises entre deux dates (31 jours au plus), y compris ceux faits hors de DSNap : à faire avant un rattrapage pour ne rien déposer deux fois, et après un envoi resté sans réponse (DSNap met alors son journal à jour).', inputSchema: S({ du: { type: 'string', description: 'AAAA-MM-JJ' }, au: { type: 'string', description: 'AAAA-MM-JJ (facultatif)' } }, ['du']), annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true }, run: outilRechercher },
  { name: 'lister_depots', title: 'Lister les dépôts d\'une journée', description: 'Liste les dépôts DSN faits sur net-entreprises un jour donné.', inputSchema: S({ date: { type: 'string', description: 'AAAA-MM-JJ' } }, ['date']), annotations: { readOnlyHint: true, openWorldHint: true }, run: outilListerDepots },
  { name: 'journal_depots', title: 'Journal des dépôts', description: 'Journal local des dépôts faits par DSNap dans ce dossier de paie (date, mois, test ou réel, flux, bilan).', inputSchema: S(), annotations: { readOnlyHint: true, openWorldHint: false }, run: outilJournal },
  { name: 'tester_connexion', title: 'Tester la connexion net-entreprises', description: 'Vérifie les identifiants net-entreprises enregistrés (authentification au service DSN, sans dépôt). Un refus n\'est jamais retenté automatiquement, pour ne pas bloquer le compte.', inputSchema: S(), annotations: { readOnlyHint: true, openWorldHint: true }, run: outilTester },
  { name: 'mettre_a_jour_tables', title: 'Mettre à jour les tables de référence', description: 'Vérifie et télécharge sur net-entreprises.fr les tables officielles de la norme DSN (codes NAF, PCS-ESE, risques AT, organismes, barème du prélèvement à la source…). DSNap le fait déjà automatiquement toutes les 12 heures au plus ; utile après une annonce de nouvelle version.', inputSchema: S({ forcer: { type: 'boolean', description: 'Tout retélécharger.' }, verifier_seulement: { type: 'boolean', description: 'Comparer sans télécharger.' } }), annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true }, run: outilTables },
  { name: 'abonnement_dsnap', title: 'Abonnement DSNap', description: 'Statut de l\'abonnement de la société (essai, actif, terminé) et liens pour s\'abonner (6,90 €/mois ou 70 €/an) ou gérer l\'abonnement. Ne démarre pas l\'essai.', inputSchema: S(), annotations: { readOnlyHint: true, openWorldHint: true }, run: outilAbonnement }
];

const INSTRUCTIONS = 'DSNap fait la paie et la DSN mensuelle d\'un président de SASU assimilé salarié et la dépose sur net-entreprises. ' +
  'Commencez par etat_dsnap. Si le dossier, la société ou les identifiants manquent : configurer_dsnap (page locale ; ne demandez jamais identifiants ni numéro de sécurité sociale dans la conversation). ' +
  'Paie d\'un mois : preparer_dsn (brut 0 = DSN néant), présentez le résultat, deposer_dsn en mode test sur le fichier « - TEST.txt », lisez le bilan, puis, après l\'accord explicite de l\'utilisateur, deposer_dsn en mode reel sur le fichier « - REEL.txt » avec confirmation_utilisateur = true. ' +
  'Avant un rattrapage : rechercher_depots sur la période, pour ne rien déposer deux fois. Ne recalculez jamais les montants vous-même, et ne montrez jamais un numéro de sécurité sociale.';

module.exports = { OUTILS, INSTRUCTIONS, reinitialiserClient, masquerSortie, voirNirs, _interne: { identifiants, modeDemo, client, declaresEnReel, fluxUnique } };
