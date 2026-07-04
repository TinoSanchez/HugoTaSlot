/**
 * Concatène les scripts boot en un seul fichier (perf first paint).
 * Usage: node scripts/build-boot-bundle.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGES = path.join(ROOT, 'scripts', 'pages');
const OUT = path.join(PAGES, 'boot-bundle.js');

/** Ordre = index.html avant bundle (sans app.js / app-boot.js) */
const BOOT_PARTS = [
  'auth-cloud.js',
  'cloud-hunts.js',
  'core-ui.js',
  'ops-health.js',
  'catalog-url.js',
  'hunt-templates.js',
  'inapp-notifs.js',
  'hunt-hooks.js',
  'page-router.js',
];

const chunks = BOOT_PARTS.map((name) => {
  const p = path.join(PAGES, name);
  const src = readFileSync(p, 'utf8');
  return `/* ── ${name} ── */\n${src.trim()}\n`;
});

const bundle = `/* HugoTaSlot boot bundle — généré par scripts/build-boot-bundle.mjs — NE PAS ÉDITER */
${chunks.join('\n')}
`;

mkdirSync(PAGES, { recursive: true });
writeFileSync(OUT, bundle, 'utf8');
console.log('boot-bundle.js:', BOOT_PARTS.length, 'modules →', bundle.split('\n').length, 'lignes');
