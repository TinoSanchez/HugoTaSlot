/**
 * Compteurs catalogue pour CI / logs (placeholders sr_*).
 * Usage: node scripts/ci-catalog-stats.mjs [--markdown]
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const JEUX_PATH = resolve(__dirname, '..', 'jeux.json');

function isPlaceholder(url) {
  const u = String(url || '').toLowerCase();
  return !u || u.includes('placehold.co') || u.includes('via.placeholder');
}

const entries = JSON.parse(readFileSync(JEUX_PATH, 'utf8'));
if (!Array.isArray(entries)) throw new Error('jeux.json invalide');

let placeholders = 0;
let srPlaceholders = 0;
for (const e of entries) {
  if (!isPlaceholder(e.image)) continue;
  placeholders++;
  if (String(e.id || '').startsWith('sr_')) srPlaceholders++;
}

const stats = {
  total: entries.length,
  placeholders,
  sr_placeholders: srPlaceholders,
  with_image: entries.length - placeholders,
};

const md = process.argv.includes('--markdown');
if (md) {
  console.log('### Catalogue `jeux.json`');
  console.log('');
  console.log(`| Métrique | Valeur |`);
  console.log(`|----------|--------|`);
  console.log(`| Entrées totales | ${stats.total} |`);
  console.log(`| Avec vignette réelle | ${stats.with_image} |`);
  console.log(`| Placeholders (tous) | ${stats.placeholders} |`);
  console.log(`| Placeholders \`sr_*\` | ${stats.sr_placeholders} |`);
} else {
  console.log(JSON.stringify(stats));
}
