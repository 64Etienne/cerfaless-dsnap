// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Masquage du NIR (numéro de sécurité sociale) dans tout texte qui sort des scripts.
 * On masque la valeur réellement présente dans les fichiers (et ses variantes sans espaces ni tirets),
 * le titre du contrôle NIR du moteur (qui découpe le numéro), toute ligne S21.G00.30.001 recopiée
 * (ex. ligne illisible citée telle quelle) et la clé calculée.
 */

/** Valeurs de la rubrique S21.G00.30.001 trouvées dans un texte DSN, même mal formé. */
function nirsDuTexte(texte) {
  const out = [];
  const re = /S21\.G00\.30\.001\s*,\s*'?([^'\r\n]*)/g;
  let m;
  while ((m = re.exec(String(texte || '')))) out.push(m[1]);
  return out;
}

function masqueur(valeurs) {
  const variantes = new Set();
  (valeurs || []).forEach(function (x) {
    const v = String(x || '').trim();
    if (v.length >= 5) variantes.add(v);
    const c = v.replace(/[\s.\-]/g, '');
    if (c.length >= 5) variantes.add(c);
  });
  const liste = Array.from(variantes).sort(function (a, b) { return b.length - a.length; });
  return function (s) {
    let t = String(s === undefined || s === null ? '' : s);
    liste.forEach(function (x) { t = t.split(x).join('[NIR masqué]'); });
    t = t.replace(/S21\.G00\.30\.001\s*,\s*'?[^'·—\r\n]*'?/g, 'S21.G00.30.001,\'[NIR masqué]\'');
    t = t.replace(/\bNIR\b(?! \(numéro)[^:—·]*?(?= : (format|clé))/g, 'NIR (masqué)');
    t = t.replace(/Clé calculée : [0-9]{2}/g, 'Clé calculée : ••');
    return t;
  };
}

module.exports = { nirsDuTexte: nirsDuTexte, masqueur: masqueur };

/**
 * Masquage « à l'aveugle » des numéros de sécurité sociale dans un document reçu (bilan, compte rendu) :
 * tout nombre isolé de 13 ou 15 caractères qui a la forme d'un NIR. Les SIRET (14 chiffres) ne sont pas touchés.
 */
function masquerNirGenerique(texte) {
  return String(texte === undefined || texte === null ? '' : texte)
    .replace(/(^|[^0-9A-Za-z])([12]\d{2}(?:0[1-9]|1[0-2]|[2-9]\d)(?:\d{2}|2A|2B)\d{6}(?:\d{2})?)(?![0-9A-Za-z])/gi, function (all, avant, nir) {
      return nir.length === 13 || nir.length === 15 ? avant + '[NIR masqué]' : all;
    })
    .replace(/(^|[^0-9])([12] \d{2} \d{2} (?:\d{2}|2A|2B) \d{3} \d{3}(?: \d{2})?)(?![0-9])/gi, '$1[NIR masqué]');
}
module.exports.masquerNirGenerique = masquerNirGenerique;
