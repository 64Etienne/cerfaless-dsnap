// DSNap © 2026 SASU EBO (Cerfaless). Code source consultable sous la licence DSNap : voir LICENSE.
'use strict';
/*
 * Écriture de PDF minimale, sans dépendance : pages A4, polices standard Helvetica et Helvetica-Bold
 * (encodage WinAnsi), texte aligné, traits, rectangles. Suffit pour un bulletin de paie et une note de frais.
 * Coordonnées en points depuis le coin haut gauche.
 */
const zlib = require('zlib');

const L = 595.28, H = 841.89;

/* Largeurs AFM (1/1000 em) des caractères 32 à 126. */
const W_REG = [278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584];
const W_BOLD = [278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611, 975,
  722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556, 333,
  556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611, 611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584];
const SPECIAUX = { '€': [0x80, 556, 556], '…': [0x85, 1000, 1000], '‘': [0x91, 222, 278], '’': [0x92, 222, 278], '“': [0x93, 333, 500], '”': [0x94, 333, 500], '•': [0x95, 350, 350],
  '–': [0x96, 556, 556], '—': [0x97, 1000, 1000], 'œ': [0x9C, 944, 944], 'Œ': [0x8C, 1000, 1000], '«': [0xAB, 556, 556], '»': [0xBB, 556, 556], '°': [0xB0, 400, 400],
  ' ': [0xA0, 278, 278], ' ': [0xA0, 278, 278], '×': [0xD7, 584, 584], '·': [0xB7, 278, 278], '²': [0xB2, 333, 333], '−': [0x2D, 333, 333], '≤': [0x3C, 584, 584], '≥': [0x3E, 584, 584] };

function code(ch) {
  const s = SPECIAUX[ch];
  if (s) return s[0];
  const c = ch.charCodeAt(0);
  if (c >= 32 && c <= 126) return c;
  if (c >= 0xA0 && c <= 0xFF) return c;
  return 0x3F; // ?
}
function largeurCar(ch, gras) {
  const s = SPECIAUX[ch];
  if (s) return gras ? s[2] : s[1];
  const c = ch.charCodeAt(0), t = gras ? W_BOLD : W_REG;
  if (c >= 32 && c <= 126) return t[c - 32];
  const base = ch.normalize('NFD')[0];
  if (base && base !== ch && base.charCodeAt(0) >= 32 && base.charCodeAt(0) <= 126) return t[base.charCodeAt(0) - 32];
  return 556;
}
function largeur(txt, taille, gras) { let w = 0; for (const ch of String(txt)) w += largeurCar(ch, gras); return w * taille / 1000; }
function chaine(txt) {
  let out = '(';
  for (const ch of String(txt)) {
    const b = code(ch);
    if (b === 0x28 || b === 0x29 || b === 0x5C) out += '\\' + String.fromCharCode(b);
    else if (b < 32 || b > 126) out += '\\' + b.toString(8).padStart(3, '0');
    else out += String.fromCharCode(b);
  }
  return out + ')';
}
function n(x) { return (Math.round(x * 100) / 100).toString(); }
function rgb(c) { c = c || [0, 0, 0]; return c.map(function (v) { return n(v); }).join(' '); }

/** Coupe un texte en lignes de largeur maximale donnée. */
function couper(txt, max, taille, gras) {
  const mots = String(txt).split(/\s+/), lignes = [];
  let cur = '';
  mots.forEach(function (m) {
    const essai = cur ? cur + ' ' + m : m;
    if (largeur(essai, taille, gras) <= max || !cur) cur = essai; else { lignes.push(cur); cur = m; }
  });
  if (cur) lignes.push(cur);
  return lignes;
}

function document(meta) {
  const pages = [];
  function page() {
    const ops = [];
    const p = {
      texte: function (x, y, txt, o) {
        o = o || {};
        const t = o.taille || 9, g = !!o.gras;
        let xx = x;
        if (o.align === 'right') xx = x - largeur(txt, t, g);
        else if (o.align === 'center') xx = x - largeur(txt, t, g) / 2;
        ops.push('BT ' + rgb(o.couleur) + ' rg /' + (g ? 'F2' : 'F1') + ' ' + n(t) + ' Tf ' + n(xx) + ' ' + n(H - y) + ' Td ' + chaine(txt) + ' Tj ET');
        return p;
      },
      paragraphe: function (x, y, txt, max, o) {
        o = o || {};
        const t = o.taille || 9, lh = o.interligne || t * 1.35;
        const lignes = couper(txt, max, t, o.gras);
        lignes.forEach(function (l, i) { p.texte(x, y + i * lh, l, o); });
        return y + lignes.length * lh;
      },
      ligne: function (x1, y1, x2, y2, o) { o = o || {}; ops.push(n(o.epaisseur || 0.5) + ' w ' + rgb(o.couleur || [0.7, 0.7, 0.7]) + ' RG ' + n(x1) + ' ' + n(H - y1) + ' m ' + n(x2) + ' ' + n(H - y2) + ' l S'); return p; },
      rect: function (x, y, w, h, o) {
        o = o || {};
        if (o.fond) ops.push(rgb(o.fond) + ' rg ' + n(x) + ' ' + n(H - y - h) + ' ' + n(w) + ' ' + n(h) + ' re f');
        if (o.bord) ops.push(n(o.epaisseur || 0.5) + ' w ' + rgb(o.bord) + ' RG ' + n(x) + ' ' + n(H - y - h) + ' ' + n(w) + ' ' + n(h) + ' re S');
        return p;
      },
      ops: ops
    };
    pages.push(p);
    return p;
  }
  function fin() {
    const objets = [];
    const ajouter = function (s) { objets.push(s); return objets.length; };
    const catalogue = ajouter(null), arbre = ajouter(null);
    const f1 = ajouter('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = ajouter('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const kids = [];
    pages.forEach(function (p) {
      const contenu = zlib.deflateSync(Buffer.from(p.ops.join('\n'), 'latin1'));
      const c = ajouter({ dict: '<< /Length ' + contenu.length + ' /Filter /FlateDecode >>', flux: contenu });
      kids.push(ajouter('<< /Type /Page /Parent ' + arbre + ' 0 R /MediaBox [0 0 ' + n(L) + ' ' + n(H) + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + c + ' 0 R >>'));
    });
    objets[catalogue - 1] = '<< /Type /Catalog /Pages ' + arbre + ' 0 R >>';
    objets[arbre - 1] = '<< /Type /Pages /Kids [' + kids.map(function (k) { return k + ' 0 R'; }).join(' ') + '] /Count ' + kids.length + ' >>';
    const d = new Date(), p2 = function (x) { return String(x).padStart(2, '0'); };
    const info = ajouter('<< /Title ' + chaine((meta && meta.titre) || 'Document') + ' /Producer (DSNap) /Creator (DSNap) /CreationDate (D:' + d.getUTCFullYear() + p2(d.getUTCMonth() + 1) + p2(d.getUTCDate()) + p2(d.getUTCHours()) + p2(d.getUTCMinutes()) + p2(d.getUTCSeconds()) + 'Z) >>');
    const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets = [];
    let pos = parts[0].length;
    objets.forEach(function (o, i) {
      offsets.push(pos);
      let b;
      if (o && o.flux) b = Buffer.concat([Buffer.from((i + 1) + ' 0 obj\n' + o.dict + '\nstream\n', 'latin1'), o.flux, Buffer.from('\nendstream\nendobj\n', 'latin1')]);
      else b = Buffer.from((i + 1) + ' 0 obj\n' + o + '\nendobj\n', 'latin1');
      parts.push(b); pos += b.length;
    });
    let xref = 'xref\n0 ' + (objets.length + 1) + '\n0000000000 65535 f \n';
    offsets.forEach(function (o) { xref += String(o).padStart(10, '0') + ' 00000 n \n'; });
    xref += 'trailer\n<< /Size ' + (objets.length + 1) + ' /Root ' + catalogue + ' 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + pos + '\n%%EOF\n';
    parts.push(Buffer.from(xref, 'latin1'));
    return Buffer.concat(parts);
  }
  return { page: page, fin: fin, largeur: largeur, L: L, H: H };
}

module.exports = { document, largeur, couper, L, H };
