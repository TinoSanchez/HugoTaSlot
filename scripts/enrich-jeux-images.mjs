/**
 * Met à jour les vignettes placeholder (sr_*, placehold.co) dans jeux.json :
 * reprise depuis doublons nom « loose », puis CDN Hub88 quand le fichier existe.
 *
 *   node scripts/enrich-jeux-images.mjs
 *   HUB88_PROBE_MAX=600 node scripts/enrich-jeux-images.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { enrichCatalogImages } from './lib/enrich-slot-images.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JEUX_PATH = resolve(ROOT, 'jeux.json');

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const hubMax = Math.min(
    2000,
    Math.max(0, parseInt(process.env.HUB88_PROBE_MAX || '600', 10) || 600)
  );
  const skipHub = process.env.SKIP_HUB88 === '1' || process.env.SKIP_HUB88 === 'true';

  console.log(`Lecture ${JEUX_PATH}…`);
  const raw = readFileSync(JEUX_PATH, 'utf8');
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries)) throw new Error('jeux.json doit être un tableau.');

  const r = await enrichCatalogImages(entries, { hubMax, skipHub });
  console.log('Enrichissement :', r);

  if (dryRun) {
    console.log('--dry-run : fichier non écrit.');
    return;
  }

  writeFileSync(JEUX_PATH, JSON.stringify(entries), 'utf8');
  console.log(`OK : ${entries.length} entrées écrites.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
