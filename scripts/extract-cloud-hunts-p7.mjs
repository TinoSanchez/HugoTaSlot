/**
 * Passe 7 — cloud sync hunts + circuit breaker + persist local
 * Usage: node scripts/extract-cloud-hunts-p7.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_JS = path.join(ROOT, 'app.js');
const INDEX_HTML = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'scripts', 'pages', 'cloud-hunts.js');
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
  HUNT_START: findLine('function huntFromCloudRow(h)'),
  HUNT_END: findLine('//  HELPERS') - 1,
  NET_START: findLine('let netBannerEl = null'),
  RETRY_END: findLine('async function retryAsync'),
  RETRY_FN_END: findLine('async function fetchJSONWithRetry') - 1,
  UNDO_VARS: findLine('let lastSnapshotAt = 0'),
  UNDO_VARS_END: findLine('const HISTORY_STACK_LIMIT = 40'),
  SNAP_START: findLine('function createAutoSnapshot'),
  SNAP_END: findLine('async function sendOpsAlert'),
};

console.log('Repères cloud-hunts P7:', L);

const globals = [
  'state', 'getAuthClient', 'currentUser', 'isCloudUser', 'isUuidString', 'uuidLike',
  'getCasinoKey', 'inferCasinoFromBonuses', 'dedupeAllHuntsBonuses', 'showToast', 'bhWarn',
  'pushRuntimeLog', 'confirm', 'requireWriteAccess', 'renderHuntList', 'selectHunt',
  'renderHuntWorkspace', 'updateHeaderStats', 'schedulePublicHuntLivePublish',
  'LOCAL_SYNCED_KEY', 'STORAGE_KEY', 'invalidateCache', 'loadCloudProfile',
  'runSupabaseHealthCheck', 'renderAdminPanel', 'flushFeedbackQueue', '__activePage',
  'supaHealth',
].join(', ');

const body = [
  sliceRange(L.HUNT_START, L.HUNT_END),
  sliceRange(L.NET_START, L.RETRY_FN_END),
  sliceRange(L.UNDO_VARS, L.UNDO_VARS_END),
  sliceRange(L.SNAP_START, L.SNAP_END - 1),
].join('\n\n');

const outJs = `'use strict';
/* globals ${globals} */
/* Sync hunts Supabase, cache local, circuit breaker — boot (index.html, après auth-cloud) */

${body}
`;

writeFileSync(OUT, outJs, 'utf8');
console.log('Écrit', OUT, `(${outJs.split('\n').length} lignes)`);

let app = readFileSync(APP_JS, 'utf8');

app = app.replace(
  lines.slice(L.HUNT_START - 1, L.HUNT_END).join('\n'),
  '// [cloud-hunts] hunt sync / load / save — scripts/pages/cloud-hunts.js (boot)\n'
);

app = app.replace(
  lines.slice(L.NET_START - 1, L.RETRY_FN_END).join('\n'),
  '// [cloud-hunts] cloudCall / circuit breaker / net banner\n'
);

app = app.replace(
  lines.slice(L.UNDO_VARS - 1, L.UNDO_VARS_END).join('\n'),
  '// [cloud-hunts] undo stacks\n'
);

app = app.replace(
  lines.slice(L.SNAP_START - 1, L.SNAP_END - 1).join('\n'),
  '// [cloud-hunts] auto snapshots hunts\n'
);

writeFileSync(APP_JS, app, 'utf8');

let html = readFileSync(INDEX_HTML, 'utf8');
const bootTag = '<script src="./scripts/pages/cloud-hunts.js"></script>';
if (!html.includes(bootTag)) {
  html = html.replace(
    '<script src="./app.js"></script>',
    `${bootTag}\n<script src="./app.js"></script>`
  );
  writeFileSync(INDEX_HTML, html, 'utf8');
  console.log('index.html: cloud-hunts.js ajouté avant app.js');
}

execSync(`node --check "${OUT}"`, { stdio: 'inherit' });
execSync(`node --check "${APP_JS}"`, { stdio: 'inherit' });
console.log('P7 extract OK — npm test');
