/**
 * Extrait le CSS et le JS inline de index.html vers styles.css et app.js.
 * Conserve la position du <script src="app.js"> (le DOM partiel existe déjà au chargement).
 *
 *   node scripts/split-index-html.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const INDEX = resolve(ROOT, 'index.html');
const STYLES = resolve(ROOT, 'styles.css');
const APP_JS = resolve(ROOT, 'app.js');

const raw = readFileSync(INDEX, 'utf8');

const styleOpen = raw.indexOf('<style>');
const styleClose = raw.indexOf('</style>');
if (styleOpen < 0 || styleClose < 0) {
  throw new Error('<style> introuvable dans index.html');
}

const scriptOpen = raw.indexOf('<script>', styleClose);
const scriptClose = raw.indexOf('</script>', scriptOpen);
if (scriptOpen < 0 || scriptClose < 0) {
  throw new Error('<script> inline introuvable dans index.html');
}

let css = raw.slice(styleOpen + '<style>'.length, styleClose);
css = css.replace(
  /@import\s+url\('https:\/\/fonts\.googleapis\.com\/css2\?[^']+'\);\s*/i,
  ''
);

const js = raw.slice(scriptOpen + '<script>'.length, scriptClose).trimStart();

const fontLinks = `    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Rajdhani:wght@400;500;600;700&family=Share+Tech+Mono&family=Exo+2:wght@300;400;600;800;900&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="./styles.css">
`;

const headEnd = raw.slice(0, styleOpen);
const mid = raw.slice(styleClose + '</style>'.length, scriptOpen);
const tail = raw.slice(scriptClose + '</script>'.length);

const newIndex =
  headEnd +
  fontLinks +
  mid +
  '<script src="./app.js"></script>\n' +
  tail;

writeFileSync(STYLES, css.trimStart() + '\n', 'utf8');
writeFileSync(APP_JS, js + '\n', 'utf8');
writeFileSync(INDEX, newIndex, 'utf8');

const countLines = (s) => s.split('\n').length;
console.log('Extraction terminée:');
console.log('  index.html :', countLines(newIndex), 'lignes');
console.log('  styles.css :', countLines(css), 'lignes');
console.log('  app.js     :', countLines(js), 'lignes');
