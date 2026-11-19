// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Mode démonstration : une société fictive et un simulateur de net-entreprises, sur l'ordinateur.
 * Rien ne part vers net-entreprises ; aucun identifiant réel n'est utilisé. Sert à découvrir DSNap et à l'évaluer
 * (relecteurs du répertoire de Claude) sans compte net-entreprises.
 *
 * Le simulateur répond comme l'API : authentification, dépôt (accusé avec identifiant de flux), retours du flux
 * (bilan de conformité nature 11, OK ou KO selon le contrôle de forme du fichier ; KO si le mois est déjà déclaré
 * en réel), liste des dépôts, téléchargement du bilan.
 */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const chemins = require('./chemins.js');

const SIREN = '999999998'; // fictif, clé de Luhn correcte
const NIC = '00001';
const IDENTIFIANTS = { siret: SIREN + NIC, nom: 'DEMO', prenom: 'DSNAP', motdepasse: 'demonstration' };

/** Configuration de la société fictive (dsnap.json du dossier de démonstration). */
function configuration() {
  return {
    version: 1,
    client: 'DEMO DSNAP SASU',
    profil: 'president-sasu-assimile-salarie',
    automatisation: { brut: { mode: 'demande' }, depotReel: 'feu_vert', declenchement: 'demande' },
    choix: { surfTotale: 40, surfBureau: 8, usagePro: 50, usageBox: 50, usageMobile: 50, trFaciale: 0, trPartPat: 0, trJoursOuvres: true, budgetMensuel: 2500, acreMode: 'auto', acreFin: '2026-12-31', tauxAT: 0 },
    facturesParDefaut: { loyer: 800, elec: 60, box: 30, mobile: 15, assurance: 12 },
    urssafSiret: '78861779300013',
    pas: { mode: 'bareme' },
    banque: { bic: 'BNPAFRPPXXX', iban: 'FR7630004000031234567890143' },
    entete: {
      'S10.G00.01.001': SIREN, 'S10.G00.01.002': NIC, 'S10.G00.01.003': 'DEMO DSNAP SASU', 'S10.G00.01.004': '1 RUE DE LA DEMONSTRATION', 'S10.G00.01.005': '75001', 'S10.G00.01.006': 'PARIS',
      'S10.G00.02.001': '02', 'S20.G00.07.004': '01',
      'S21.G00.06.001': SIREN, 'S21.G00.06.002': NIC, 'S21.G00.06.003': '6201Z', 'S21.G00.06.004': '1 RUE DE LA DEMONSTRATION', 'S21.G00.06.005': '75001', 'S21.G00.06.006': 'PARIS',
      'S21.G00.11.001': NIC, 'S21.G00.11.002': '6201Z', 'S21.G00.11.003': '1 RUE DE LA DEMONSTRATION', 'S21.G00.11.004': '75001', 'S21.G00.11.005': 'PARIS', 'S21.G00.11.022': '9999'
    },
    contrat: {
      'S21.G00.40.001': '01012026', 'S21.G00.40.004': '388a', 'S21.G00.40.009': 'DEMO2026', 'S21.G00.40.019': SIREN + NIC
    },
    individu: {
      'S21.G00.30.001': '2900175999999', 'S21.G00.30.002': 'MARTIN', 'S21.G00.30.004': 'CAMILLE', 'S21.G00.30.005': '02', 'S21.G00.30.006': '01011990',
      'S21.G00.30.007': 'PARIS', 'S21.G00.30.008': '1 RUE DE LA DEMONSTRATION', 'S21.G00.30.009': '75001', 'S21.G00.30.010': 'PARIS',
      'S21.G00.30.013': '01', 'S21.G00.30.014': '75', 'S21.G00.30.015': 'FR'
    },
    contact: { nom: 'CAMILLE MARTIN', mel: 'demo@example.com', tel: '0102030405' },
    demo: true
  };
}

function cheminStock() { return path.join(chemins.dossierDonnees(), 'demo', 'depots.json'); }
function lireStock() { try { return JSON.parse(fs.readFileSync(cheminStock(), 'utf8')); } catch (e) { return []; } }
function ecrireStock(s) { fs.mkdirSync(path.dirname(cheminStock()), { recursive: true }); fs.writeFileSync(cheminStock(), JSON.stringify(s, null, 2)); }
function pad2(n) { return (n < 10 ? '0' : '') + n; }
function horo(d) { return d.getFullYear() + pad2(d.getMonth() + 1) + pad2(d.getDate()) + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds()); }
function rep(status, corps, type) { return { status: status, headers: { 'content-type': type || 'application/json' }, body: Buffer.from(typeof corps === 'string' ? corps : JSON.stringify(corps), 'utf8') }; }

/** Simulateur : même interface que la requête réseau du client net-entreprises. */
function simulateur(verifierFlux) {
  const jetons = new Set();
  async function requete(methode, url, entetes, corps) {
    const u = new URL(url), p = u.pathname;
    if (p.indexOf('/authentifier/') === 0) {
      const x = corps ? corps.toString('utf8') : '';
      const v = function (t) { const m = new RegExp('<' + t + '>([^<]*)</' + t + '>').exec(x); return m ? m[1] : ''; };
      if (v('siret') !== IDENTIFIANTS.siret || v('motdepasse') !== IDENTIFIANTS.motdepasse) return rep(401, 'identifiants invalides', 'text/plain');
      const j = 'DEMO-' + crypto.randomBytes(12).toString('hex');
      jetons.add(j);
      return { status: 200, headers: { 'content-type': 'text/plain', expires: new Date(Date.now() + 30 * 60000).toUTCString() }, body: Buffer.from(j) };
    }
    const auth = /jeton=(\S+)/.exec((entetes && entetes.Authorization) || '');
    if (!auth || !jetons.has(auth[1])) return rep(401, 'jeton invalide', 'text/plain');
    const stock = lireStock();
    if (p.indexOf('/deposer-dsn/') === 0 && methode === 'POST') {
      let buf; try { buf = zlib.gunzipSync(corps); } catch (e) { return rep(422, { erreur: 'corps non gzip' }); }
      const v = verifierFlux(buf);
      const idflux = 'DEMO' + Date.now().toString().slice(-9) + crypto.randomBytes(2).toString('hex').toUpperCase();
      let statut = v.ok ? 'OK' : 'KO', anomalies = v.erreurs.slice();
      if (v.ok && v.essaiReel === '02' && stock.some(function (d) { return d.reel && d.mois === v.mois && d.siret === v.siret && d.statut === 'OK'; })) {
        statut = 'KO'; anomalies = ['B1-208-09 (simulé) : une déclaration de ce mois a déjà été déposée pour cet établissement.'];
      }
      stock.push({ idflux: idflux, date: horo(new Date()), mois: v.mois, siret: v.siret, reel: v.essaiReel === '02', statut: statut, anomalies: anomalies, type: v.type });
      ecrireStock(stock);
      return rep(200, { envoi_etat: 'Accepté', idflux: idflux, demonstration: true });
    }
    if (p.indexOf('/lister-retours-flux/') === 0) {
      const id = decodeURIComponent(p.split('/').filter(Boolean).pop());
      const d = stock.find(function (x) { return x.idflux === id; });
      if (!d) return rep(200, { retours: { flux: [] } });
      const retours = [{ nature: '10', statut: 'OK', publication: d.date, production: d.date },
        { nature: '11', statut: d.statut, publication: d.date, production: d.date, url: 'https://demo.dsnap.invalid/telechargement/' + id + '/bilan' }];
      if (d.statut === 'OK' && d.reel && d.type !== 'néant') retours.push({ nature: '60', statut: 'OK', publication: d.date, production: d.date });
      return rep(200, { retours: { flux: [{ id: id, retour: retours }] } });
    }
    if (p.indexOf('/lister-depots/') === 0) {
      const parts = p.split('/').filter(Boolean), deb = parts[parts.length - 2], fin = parts[parts.length - 1];
      const liste = stock.filter(function (d) { return d.date >= deb && d.date <= fin; }).map(function (d) { return { idflux: d.idflux, date: d.date, statut: d.statut === 'OK' ? 'Traité' : 'Rejeté' }; });
      return rep(200, { depots: { declarant: [{ siret: IDENTIFIANTS.siret, depot: liste }] } });
    }
    if (p.indexOf('/telechargement/') === 0) {
      const id = p.split('/').filter(Boolean)[1];
      const d = stock.find(function (x) { return x.idflux === id; });
      if (!d) return rep(404, 'inconnu', 'text/plain');
      const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<bilan demonstration="oui"><idflux>' + id + '</idflux><mois>' + d.mois + '</mois><statut>' + d.statut + '</statut>' +
        (d.anomalies.length ? '<anomalies>' + d.anomalies.map(function (a) { return '<anomalie>' + a.replace(/[<&]/g, ' ') + '</anomalie>'; }).join('') + '</anomalies>' : '<message>Déclaration conforme (simulation DSNap : aucun envoi réel).</message>') + '</bilan>';
      return rep(200, xml, 'application/xml');
    }
    return rep(404, 'service inconnu', 'text/plain');
  }
  return { requete: requete };
}

function reinitialiser() { try { fs.unlinkSync(cheminStock()); } catch (e) { /* rien */ } }

module.exports = { SIREN, NIC, IDENTIFIANTS, configuration, simulateur, reinitialiser };
