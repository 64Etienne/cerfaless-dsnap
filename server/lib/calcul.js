// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Calcul d'une paie avec salaire, sur le serveur de Cerfaless. Aucune règle de paie n'est livrée avec DSNap.
 *  - paie : POST /v1/paie. Abonné : le résultat, le bulletin et les contrôles de paie ; le fichier DSN se fabrique sur
 *    l'ordinateur. Essai : un aperçu seulement (brut, net avant impôt, coût total).
 *  - demo : POST /v1/demo. Société fictive, règles de 2026 figées, jamais les taux des années suivantes.
 *  - simulation : POST /v1/simulation. Gratuite, aperçu seulement.
 * Envoyés : l'empreinte du SIREN, l'identifiant d'installation, le mois, le brut et les options de calcul
 * (noyau.js, entreesCalcul). Jamais le nom, le numéro de sécurité sociale, l'adresse, l'IBAN ni les identifiants.
 */
const licence = require('./licence.js');
const chemins = require('./chemins.js');
const DELAI = 15000;
const INJOIGNABLE = 'Le calcul d\'une paie avec salaire se fait sur le serveur de Cerfaless, injoignable pour le moment. Réessayez dans quelques minutes. Les DSN néant, les contrôles et les dépôts de test restent disponibles.';

function echec(message, code) { const e = new Error(message); e.utilisateur = true; e.code = code; return e; }
async function appel(chemin, corps) {
  let derniere = null;
  for (const base of licence.APIS) {
    try {
      const r = await fetch(base + chemin, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'DSNap' }, body: JSON.stringify(corps), signal: AbortSignal.timeout(DELAI) });
      const j = await r.json().catch(function () { return null; });
      if (r.status >= 500 && r.status !== 503) { derniere = null; continue; }
      if (r.ok && j) return j;
      throw echec((j && j.erreur) || INJOIGNABLE, r.status);
    } catch (e) { if (e.utilisateur) throw e; derniere = e; }
  }
  void derniere;
  throw echec(INJOIGNABLE, 0);
}
/** Paie du mois pour la société (jeton : dernière réponse signée du service de licences, si Stripe est en panne). */
function paie(siren, entrees, o) {
  o = o || {};
  if (o.demo) return appel('/v1/demo', { entrees: entrees });
  return appel('/v1/paie', { s: licence.empreinteSiren(siren), installation: chemins.lireReglages().installation, version: o.version || '', jeton: licence.jetonEnCache(siren), entrees: entrees });
}
function simulation(entrees, cible) { return appel('/v1/simulation', cible ? { entrees: entrees, budget: cible } : { entrees: entrees }); }
module.exports = { paie, simulation };
