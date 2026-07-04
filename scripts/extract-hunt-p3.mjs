/**
 * Passe 3 — extraction hunt export / live / share depuis app.js
 * Usage: node scripts/extract-hunt-p3.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_JS = path.join(ROOT, 'app.js');
const PAGES_DIR = path.join(ROOT, 'scripts', 'pages');
mkdirSync(PAGES_DIR, { recursive: true });

const lines = readFileSync(APP_JS, 'utf8').split('\n');

function findLine(pattern, after = 0) {
  for (let i = after; i < lines.length; i++) {
    const ok = typeof pattern === 'string' ? lines[i].includes(pattern) : pattern.test(lines[i]);
    if (ok) return i + 1;
  }
  throw new Error(`Pattern introuvable: ${pattern}`);
}

function sliceRange(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

const L = {
  EXPORT: findLine('function exportActiveHunt()'),
  PUBLIC_VARS: findLine('let publicHuntPublishTimer = null'),
  SHARE_ENCODE: findLine('function encodeSharePayload(payload)'),
  IMPORT_FILE: findLine('function importHuntFile(file)'),
  EXPORT_BTN: findLine("document.getElementById('btn-export-hunt').addEventListener"),
  HUNT_LIST: findLine('function renderHuntList()'),
};

console.log('Repères hunt P3:', L);

const INIT_EXPORT = `
function initHuntExportToolbar() {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el && !el.dataset.huntBound) { el.dataset.huntBound = '1'; el.addEventListener('click', fn); } };
  bind('btn-export-hunt', exportActiveHunt);
  bind('btn-export-hunt-image', () => { exportActiveHuntImage().catch(() => {}); });
  bind('btn-export-hunt-pdf', () => { exportActiveHuntPdf(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuntExportToolbar);
else initHuntExportToolbar();
`;

const INIT_LIVE = `
function initHuntPublicLiveToolbar() {
  const live = document.getElementById('btn-live-hunt');
  if (live && !live.dataset.huntBound) {
    live.dataset.huntBound = '1';
    live.addEventListener('click', () => { copyPublicHuntLiveLink().catch(() => {}); });
  }
  const stop = document.getElementById('btn-stop-live-hunt');
  if (stop && !stop.dataset.huntBound) {
    stop.dataset.huntBound = '1';
    stop.addEventListener('click', () => { disablePublicHuntLiveLink().catch(() => {}); });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuntPublicLiveToolbar);
else initHuntPublicLiveToolbar();
`;

const INIT_SHARE = `
function initHuntShareToolbar() {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el && !el.dataset.huntBound) { el.dataset.huntBound = '1'; el.addEventListener('click', fn); } };
  bind('btn-import-hunt', () => document.getElementById('hunt-import-input')?.click());
  bind('btn-share-hunt', exportShareCode);
  bind('btn-import-share', importShareCode);
  const input = document.getElementById('hunt-import-input');
  if (input && !input.dataset.huntBound) {
    input.dataset.huntBound = '1';
    input.addEventListener('change', (e) => {
      importHuntFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuntShareToolbar);
else initHuntShareToolbar();
`;

const extractions = [
  {
    file: 'hunt-export.js',
    label: 'Export hunt JSON / PNG / PDF',
    globals: 'activeHunt, showToast, escapeHtml, confirmRich, currentUser, fmt, getDisplayCurrency, getCasinoLabel, getCasinoKey, toEUR, bhWarn, document',
    ranges: [[L.EXPORT, L.PUBLIC_VARS - 1]],
    placeholder: '// [hunt-export] — scripts/pages/hunt-export.js (lazy hunt)',
    extras: INIT_EXPORT,
  },
  {
    file: 'hunt-public-live.js',
    label: 'Lien public live /h/slug',
    globals: 'activeHunt, isCloudUser, showToast, showAuth, getAuthClient, cloudCall, writeLocalCache, pushRuntimeLog, requireWriteAccess, bhWarn, getHuntExportSummary, getCasinoLabel, getCasinoKey, schedulePublicHuntLivePublish',
    ranges: [[L.PUBLIC_VARS, L.SHARE_ENCODE - 1]],
    placeholder: '// [hunt-public-live] — scripts/pages/hunt-public-live.js (lazy hunt)',
    extras: INIT_LIVE,
  },
  {
    file: 'hunt-share.js',
    label: 'Share code + import fichier hunt',
    globals: 'activeHunt, showToast, escapeHtml, confirmRich, requireWriteAccess, getCasinoLabel, getCasinoKey, toEUR, uuidLike, uid, normalizeBonusType, huntBonusMachineConflict, setUndoSnapshot, state, save, renderHuntList, selectHunt, inferCasinoFromBonuses',
    ranges: [[L.SHARE_ENCODE, L.IMPORT_FILE + 213]], // importHuntFile ends ~3322
    placeholder: '// [hunt-share] — scripts/pages/hunt-share.js (lazy hunt)',
    extras: INIT_SHARE,
  },
];

// Fix importHuntFile end - find end of importHuntFile function
const importEnd = findLine('document.getElementById(\'btn-export-hunt\').addEventListener');
extractions[2].ranges = [[L.SHARE_ENCODE, importEnd - 1]];

const removedLines = new Set();
const placeholderAt = new Map();

for (const ex of extractions) {
  const body = ex.ranges.map(([s, e]) => sliceRange(s, e)).join('\n\n') + (ex.extras || '');
  const header = `'use strict';\n/* globals ${ex.globals} */\n/* ${ex.label} — lazy bundle hunt */\n\n`;
  const dest = path.join(PAGES_DIR, ex.file);
  writeFileSync(dest, header + body + '\n', 'utf8');
  execSync(`node --check "${dest}"`, { stdio: 'pipe' });
  console.log(`✓ ${ex.file}`);
  for (const [s, e] of ex.ranges) {
    for (let i = s; i <= e; i++) removedLines.add(i);
    if (!placeholderAt.has(s)) placeholderAt.set(s, ex.placeholder);
  }
}

// Retirer les listeners du toolbar (déplacés dans les inits)
for (let i = importEnd; i < L.HUNT_LIST - 1; i++) removedLines.add(i);

const newLines = [];
for (let i = 1; i <= lines.length; i++) {
  if (removedLines.has(i)) {
    if (placeholderAt.has(i)) newLines.push(placeholderAt.get(i));
  } else {
    newLines.push(lines[i - 1]);
  }
}

let appContent = newLines.join('\n');

if (!appContent.includes("hunt:       './scripts/pages/hunt-share.js'")) {
  appContent = appContent.replace(
    /(\s+review:\s+'\.\/scripts\/pages\/review\.js',)\n(\s+\/\/ hunt → app\.js)/,
    `$1
  hunt:        './scripts/pages/hunt-share.js',
$2`
  );
}

if (!appContent.includes('hunt-public-live.js')) {
  appContent = appContent.replace(
    /(const LAZY_PAGE_DEPS = Object\.freeze\(\{[\s\S]*?updates: \['\.\/scripts\/pages\/hub-features\.js'\],\n)/,
    `$1  hunt:    ['./scripts/pages/hunt-export.js', './scripts/pages/hunt-public-live.js'],\n`
  );
}

if (!appContent.includes("loadLazyPageScript('hunt')")) {
  appContent = appContent.replace(
    "await loadLazyPageScript('home').catch(() => {});",
    "await loadLazyPageScript('home').catch(() => {});\n  await loadLazyPageScript('hunt').catch(() => {});"
  );
}

writeFileSync(APP_JS, appContent, 'utf8');
execSync(`node --check "${APP_JS}"`, { stdio: 'pipe' });
console.log(`✓ app.js (${newLines.length} lignes, était ${lines.length})`);
console.log('✅ Extraction hunt P3 terminée.');
