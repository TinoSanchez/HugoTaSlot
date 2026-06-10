/**
 * Remplace les URLs placehold.co / via.placeholder par image vide.
 * Les cartes utilisent alors le fallback local (virtual-token) au lieu de 248 requêtes externes.
 *
 *   node scripts/strip-catalog-placeholders.mjs
 *   node scripts/strip-catalog-placeholders.mjs --dry-run
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JEUX_PATH = resolve(ROOT, 'jeux.json');
const dryRun = process.argv.includes('--dry-run');

function isPlaceholderUrl(url) {
  const u = String(url || '').toLowerCase();
  return u.includes('placehold.co') || u.includes('via.placeholder');
}

const raw = readFileSync(JEUX_PATH, 'utf8');
const entries = JSON.parse(raw);
let stripped = 0;

for (const e of entries) {
  if (!e || typeof e !== 'object') continue;
  if (isPlaceholderUrl(e.image)) {
    e.image = '';
    stripped++;
  }
}

console.log(`strip-catalog-placeholders: ${stripped} vignette(s) vidée(s) sur ${entries.length} entrées`);

if (!dryRun && stripped > 0) {
  writeFileSync(JEUX_PATH, `${JSON.stringify(entries)}\n`, 'utf8');
  console.log('jeux.json mis à jour (JSON compact).');
} else if (dryRun) {
  console.log('(dry-run — aucun fichier modifié)');
}
