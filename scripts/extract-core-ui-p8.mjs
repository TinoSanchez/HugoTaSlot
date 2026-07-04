/**
 * Passe 8 — core UI (SFX, toasts, modales, maintenance, a11y, recherche globale)
 * Usage: node scripts/extract-core-ui-p8.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_JS = path.join(ROOT, 'app.js');
const INDEX_HTML = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'scripts', 'pages', 'core-ui.js');
mkdirSync(path.dirname(OUT), { recursive: true });

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
  SFX_START: findLine('let uiAudioCtx = null'),
  CONFIRM_END: findLine('// [catalog-slots]') - 1,
  MAINT_START: findLine('const MAINTENANCE_DEFAULT'),
  RUNTIME_END: findLine('async function runSupabaseHealthCheck'),
  MOBILE_START: findLine('function isMobileNavMode()'),
  MODAL_END: findLine('// [catalog-slots] filterAndRender') - 1,
  SEARCH_START: findLine('let globalSearchDebounce = null'),
  SEARCH_END: findLine('// [updates]') - 1,
  LAST_OPS: findLine('let lastOpsAlertAt = 0'),
};

console.log('Repères core-ui P8:', L);

const globals = [
  'getUiPrefs', 'fmt', 'escapeHtml', 'state', 'activeHunt', 'getAuthClient', 'cloudCall',
  'bhWarn', 'isCurrentUserAdmin', 'currentUser', 'getUsers', 'adminFetchCloudUsers',
  'selectHunt', 'switchPage', 'openOpener', 'copyPublicHuntLiveLink', 'renderUpdatesPage',
  'OPS_ALERTS_KEY', 'RUNTIME_LOG_KEY', 'onlineChannel', 'supaHealth',
].join(', ');

// lastOpsAlertAt doit vivre avec sendOpsAlert
const lastOpsLine = lines[L.LAST_OPS - 1];

const body = [
  sliceRange(L.SFX_START, L.CONFIRM_END),
  lastOpsLine,
  sliceRange(L.MAINT_START, L.RUNTIME_END - 1),
  sliceRange(L.MOBILE_START, L.MODAL_END),
  sliceRange(L.SEARCH_START, L.SEARCH_END),
].join('\n\n');

const outJs = `'use strict';
/* globals ${globals} */
/* UI transverse — SFX, toasts, maintenance, a11y, recherche (boot après cloud-hunts) */

${body}
`;

writeFileSync(OUT, outJs, 'utf8');
console.log('Écrit', OUT, `(${outJs.split('\n').length} lignes)`);

let app = readFileSync(APP_JS, 'utf8');

app = app.replace(lines.slice(L.SFX_START - 1, L.CONFIRM_END).join('\n'), '// [core-ui] SFX / toasts / confirm\n');
app = app.replace(lines.slice(L.MAINT_START - 1, L.RUNTIME_END - 1).join('\n'), '// [core-ui] maintenance / requireWriteAccess / runtime logs\n');
app = app.replace(lines.slice(L.MOBILE_START - 1, L.MODAL_END).join('\n'), '// [core-ui] mobile nav + modal a11y\n');
app = app.replace(lines.slice(L.SEARCH_START - 1, L.SEARCH_END).join('\n'), '// [core-ui] runGlobalSearch\n');

// Retirer lastOpsAlertAt du bloc app (déplacé dans core-ui)
app = app.replace(lastOpsLine + '\n', '// lastOpsAlertAt → core-ui.js\n');

writeFileSync(APP_JS, app, 'utf8');

let html = readFileSync(INDEX_HTML, 'utf8');
const bootTag = '<script src="./scripts/pages/core-ui.js"></script>';
if (!html.includes(bootTag)) {
  html = html.replace(
    '<script src="./app.js"></script>',
    `${bootTag}\n<script src="./app.js"></script>`
  );
  writeFileSync(INDEX_HTML, html, 'utf8');
  console.log('index.html: core-ui.js ajouté avant app.js');
}

execSync(`node --check "${OUT}"`, { stdio: 'inherit' });
execSync(`node --check "${APP_JS}"`, { stdio: 'inherit' });
console.log('P8 extract OK — npm test');
