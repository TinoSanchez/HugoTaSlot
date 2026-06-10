/**
 * Supprime de jeux.json les entrées sr_* (slot.report) qui n'ont pas de vignette
 * réelle — c'est-à-dire les jeux ni sur Gamdom ni sur Stake, donc invisibles
 * pour l'utilisateur quoi qu'il fasse.
 *
 *   node scripts/prune-orphan-placeholders.mjs            # supprime et sauvegarde
 *   node scripts/prune-orphan-placeholders.mjs --dry-run  # simulation
 *   node scripts/prune-orphan-placeholders.mjs --all      # purge aussi les non-sr_*
 *
 * Sécurité : seules les entrées dont `image` est vide / placehold.co sont visées.
 * Une entrée `sr_*` avec une vraie URL CDN n'est PAS touchée.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JEUX_PATH = resolve(ROOT, 'jeux.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = { dryRun: false, all: false };
  for (const a of args) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--all') opts.all = true;
    else if (a === '--help' || a === '-h') {
      console.log(`prune-orphan-placeholders.mjs
  --dry-run   ne modifie pas jeux.json
  --all       supprime tous les placeholders (par défaut: uniquement sr_*)
`);
      process.exit(0);
    }
  }
  return opts;
}

function isPlaceholder(entry) {
  const img = String(entry?.image || '').trim().toLowerCase();
  return !img || img.includes('placehold.co') || img.includes('via.placeholder');
}

const opts = parseArgs();
const entries = JSON.parse(readFileSync(JEUX_PATH, 'utf8'));
const before = entries.length;

const removed = [];
const kept = entries.filter((e) => {
  if (!isPlaceholder(e)) return true;
  const isSr = String(e?.id || '').toLowerCase().startsWith('sr_');
  if (!opts.all && !isSr) return true;
  removed.push(e);
  return false;
});

const after = kept.length;
const providerCounts = new Map();
for (const e of removed) {
  const p = e.provider || '(none)';
  providerCounts.set(p, (providerCounts.get(p) || 0) + 1);
}
const topProviders = [...providerCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);

console.log(`Avant : ${before} entrées`);
console.log(`Après : ${after} entrées`);
console.log(`Supprimées : ${removed.length}`);
if (topProviders.length) {
  console.log('Top providers supprimés :');
  for (const [p, c] of topProviders) {
    console.log(`  ${String(c).padStart(3)}  ${p}`);
  }
}
if (removed.length) {
  console.log('\nÉchantillon (5 premiers) :');
  for (const e of removed.slice(0, 5)) {
    console.log(`  - ${e.nom || e.name} (${e.provider || '—'}) [${e.id}]`);
  }
}

if (!removed.length) {
  console.log('Rien à supprimer.');
  process.exit(0);
}

if (opts.dryRun) {
  console.log('\n--dry-run : jeux.json non modifié.');
  process.exit(0);
}

writeFileSync(JEUX_PATH, `${JSON.stringify(kept)}\n`, 'utf8');
console.log(`\njeux.json mis à jour : ${removed.length} entrée(s) orpheline(s) retirée(s).`);
