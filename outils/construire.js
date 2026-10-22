#!/usr/bin/env node
'use strict';
/*
 * Fabrique les paquets de DSNap dans dist/ :
 *   dsnap-<version>.plugin   plugin (skill + serveur), sans tables : à importer dans Claude ou pour le répertoire
 *   dsnap-<version>.mcpb     extension de bureau, avec les tables de référence embarquées
 *   tables/                  copie de secours des tables pour le site (manifest.json + <norme>.json.gz)
 *
 *   node outils/construire.js --tables <dossier contenant P26V01.json.gz, P27V01.json.gz>
 * Vérifie avant tout que les versions concordent et que les tests passent.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const RACINE = path.join(__dirname, '..');
const DIST = path.join(RACINE, 'dist');
const arg = function (k) { const i = process.argv.indexOf(k); return i >= 0 ? process.argv[i + 1] : null; };
const tablesSrc = arg('--tables');

const plugin = JSON.parse(fs.readFileSync(path.join(RACINE, '.claude-plugin', 'plugin.json'), 'utf8'));
const { VERSION } = require(path.join(RACINE, 'server', 'lib', 'version.js'));
const mcpb = JSON.parse(fs.readFileSync(path.join(RACINE, 'mcpb', 'manifest.json'), 'utf8'));
if (plugin.version !== VERSION || mcpb.version !== VERSION) { console.error('Versions différentes : plugin ' + plugin.version + ', serveur ' + VERSION + ', mcpb ' + mcpb.version); process.exit(1); }
const { OUTILS } = require(path.join(RACINE, 'server', 'lib', 'outils.js'));
const noms = OUTILS.map(function (o) { return o.name; }).sort().join(',');
if (noms !== mcpb.tools.map(function (t) { return t.name; }).sort().join(',')) { console.error('La liste des outils du manifeste .mcpb ne correspond pas au serveur.'); process.exit(1); }

if (!process.argv.includes('--sans-tests')) execFileSync(process.execPath, ['--test', ...fs.readdirSync(path.join(RACINE, 'tests')).filter(function (f) { return f.endsWith('.test.js'); }).map(function (f) { return path.join(RACINE, 'tests', f); })], { stdio: 'inherit' });

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
function copier(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) { fs.mkdirSync(dst, { recursive: true }); fs.readdirSync(src).forEach(function (f) { copier(path.join(src, f), path.join(dst, f)); }); }
  else { fs.mkdirSync(path.dirname(dst), { recursive: true }); fs.copyFileSync(src, dst); }
}
function zipper(dossier, fichier) { execFileSync('zip', ['-q', '-r', '-X', fichier, '.'], { cwd: dossier }); }

// plugin
const P = path.join(DIST, 'plugin');
['.claude-plugin', '.mcp.json', 'skills', 'server', 'assets', 'README.md', 'LICENSE', 'PRIVACY.md', 'CHANGELOG.md'].forEach(function (x) { copier(path.join(RACINE, x), path.join(P, x)); });
fs.rmSync(path.join(P, 'server', 'nomenclatures'), { recursive: true, force: true });
zipper(P, path.join(DIST, 'dsnap-' + VERSION + '.plugin'));

// extension de bureau
const M = path.join(DIST, 'mcpb');
['server', 'README.md', 'LICENSE', 'PRIVACY.md'].forEach(function (x) { copier(path.join(RACINE, x), path.join(M, x)); });
fs.copyFileSync(path.join(RACINE, 'assets', 'icon.png'), path.join(M, 'icon.png'));
fs.writeFileSync(path.join(M, 'manifest.json'), JSON.stringify(mcpb, null, 2));
const manifesteTables = { genereLe: new Date().toISOString(), normes: {} };
if (tablesSrc) {
  fs.mkdirSync(path.join(M, 'server', 'nomenclatures'), { recursive: true });
  fs.mkdirSync(path.join(DIST, 'tables'), { recursive: true });
  fs.readdirSync(tablesSrc).filter(function (f) { return /^P\d{2}V\d{2}\.json\.gz$/.test(f); }).forEach(function (f) {
    const buf = fs.readFileSync(path.join(tablesSrc, f));
    const ds = JSON.parse(require('zlib').gunzipSync(buf).toString('utf8'));
    fs.writeFileSync(path.join(M, 'server', 'nomenclatures', f), buf);
    fs.writeFileSync(path.join(DIST, 'tables', f), buf);
    manifesteTables.normes[ds.norme] = { fichier: f, version: ds.version, date: ds.datePublication, sha256: crypto.createHash('sha256').update(buf).digest('hex'), octets: buf.length };
  });
  fs.writeFileSync(path.join(DIST, 'tables', 'manifest.json'), JSON.stringify(manifesteTables, null, 2));
} else console.warn('Attention : extension sans tables embarquées (option --tables).');
zipper(M, path.join(DIST, 'dsnap-' + VERSION + '.mcpb'));
fs.copyFileSync(path.join(DIST, 'dsnap-' + VERSION + '.mcpb'), path.join(DIST, 'dsnap.mcpb'));
fs.copyFileSync(path.join(DIST, 'dsnap-' + VERSION + '.plugin'), path.join(DIST, 'dsnap.plugin'));

// contrôles du répertoire de plugins : fichiers < 256 Kio (hors images), moins de 512 fichiers, pas de binaire
const fichiers = [];
(function lister(d) { fs.readdirSync(d, { withFileTypes: true }).forEach(function (x) { const p = path.join(d, x.name); if (x.isDirectory()) lister(p); else fichiers.push(p); }); })(P);
const gros = fichiers.filter(function (f) { return !/\.(png|svg|jpe?g|gif|webp|woff2?|ttf|otf)$/i.test(f) && fs.statSync(f).size > 256 * 1024; });
const binaires = fichiers.filter(function (f) { return /\.(gz|zip|pdf|ico|exe|mcpb|plugin)$/i.test(f); });
console.log('Plugin : ' + fichiers.length + ' fichiers' + (gros.length ? ', TROP GROS : ' + gros.join(', ') : '') + (binaires.length ? ', BINAIRES : ' + binaires.join(', ') : ''));
['dsnap-' + VERSION + '.plugin', 'dsnap-' + VERSION + '.mcpb'].forEach(function (f) { console.log(f + ' : ' + Math.round(fs.statSync(path.join(DIST, f)).size / 1024) + ' Kio'); });
if (gros.length || binaires.length || fichiers.length >= 512) process.exit(1);
