/**
 * Passe 9 — routing multi-pages (switchPage, templates HTML, lazy loader, initV101)
 * Usage: node scripts/extract-page-router-p9.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_JS = path.join(ROOT, 'app.js');
const INDEX_HTML = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'scripts', 'pages', 'page-router.js');
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

/** @param {Array<[number, number, string?]>} ranges 1-based inclusive, optional comment at start */
function removeLineRanges(allLines, ranges) {
  const drop = new Set();
  const commentAt = new Map();
  for (const [start, end, comment] of ranges) {
    if (comment) commentAt.set(start, comment);
    for (let n = start; n <= end; n++) drop.add(n);
  }
  const out = [];
  for (let i = 0; i < allLines.length; i++) {
    const n = i + 1;
    if (drop.has(n)) {
      if (commentAt.has(n)) out.push(commentAt.get(n));
      continue;
    }
    out.push(allLines[i]);
  }
  return out.join('\n');
}

const L = {
  DETACHED_LINE: findLine('const __detachedPanels = Object.create(null)'),
  MOUNT_START: findLine('function stashPageMount()'),
  MOUNT_END: findLine('// [cloud-hunts] cloudCall / circuit breaker / net banner') - 1,
  ROUTE_START: findLine('// ─── PAGE NAVIGATION (URL routing) ───'),
  HUNT_TAB_END: findLine('function syncBonusFilterUiFromState()') - 1,
  SWITCH_PAGE_START: findLine('function switchPage(page, opts)'),
  SWITCH_PAGE_END: findLine('// ─── LAZY CHARGEMENT DE MODULES PAR PAGE ───') - 1,
  LAZY_BLOCK_START: findLine('// ─── LAZY CHARGEMENT DE MODULES PAR PAGE ───'),
  LAZY_END: findLine('// [catalog-slots] ensureSlotsLoaded') - 1,
  V101_FLAG: findLine('let v101Initialized = false'),
  INIT_V101_END: findLine('function registerAppServiceWorker()') - 1,
};

console.log('Repères page-router P9:', L);

const globals = [
  'state', 'activeHunt', 'fmt', 'toEUR', 'getUserBalance', 'showToast', 'closeMobileSidebar',
  'isCurrentUserAdmin', 'initAuth', 'renderProfileBadge', 'populateBonusFilterPresetsSelect',
  'refreshMaintenanceConfig', 'startMaintenancePolling', 'applyHuntAppHooks', 'ensureSlotsLoaded',
  'scheduleHuntUI', 'calcMise', 'initDepositWheel', 'initChoixSlot', 'renderTournoiLeaderboard',
  'updateLobbyBalance', 'flushFeedbackQueue', 'runSupabaseHealthCheck', 'closeGame', 'bhWarn',
  'consumeSlotPrefillFromUrl', 'applyUiPrefs', 'runGlobalSearch', 'globalSearchDebounce',
  'ensureNotifBellInHeader', 'checkInAppNotifications', 'renderHomeHubMetrics', 'renderHomeLeaderboard',
  'renderHomeDiscordBanner', 'renderStudioPage', 'renderUpdatesPage', 'renderReviewPage',
  'renderNewsPage', 'renderStatsPage', 'renderAdminPanel', 'renderBJTable', 'renderGamesModeBanner',
  'renderWeeklyObjectivesPanel', 'renderGamesLobby',
].join(', ');

const body = [
  lines[L.DETACHED_LINE - 1],
  sliceRange(L.MOUNT_START, L.MOUNT_END),
  sliceRange(L.ROUTE_START, L.HUNT_TAB_END),
  sliceRange(L.SWITCH_PAGE_START, L.SWITCH_PAGE_END),
  sliceRange(L.LAZY_BLOCK_START, L.LAZY_END),
  sliceRange(L.V101_FLAG, L.INIT_V101_END),
].join('\n\n');

const outJs = `'use strict';
/* globals ${globals} */
/* Routing multi-pages — URLs, templates HTML, lazy loader, initV101 (boot après core-ui) */

${body}
`;

writeFileSync(OUT, outJs, 'utf8');
console.log('Écrit', OUT, `(${outJs.split('\n').length} lignes)`);

const appNew = removeLineRanges(lines, [
  [L.DETACHED_LINE, L.DETACHED_LINE, '// [page-router] __detachedPanels → page-router.js'],
  [L.MOUNT_START, L.MOUNT_END, '// [page-router] mountCachedPage / stashPageMount'],
  [L.ROUTE_START, L.HUNT_TAB_END, '// [page-router] PAGE_TO_SLUG / switchHuntTab / hunt tabs URL'],
  [L.SWITCH_PAGE_START, L.SWITCH_PAGE_END, '// [page-router] switchPage'],
  [L.LAZY_BLOCK_START, L.LAZY_END, '// [page-router] __PAGE_HTML / LAZY_PAGE_SCRIPTS / loadLazyPageScript'],
  [L.V101_FLAG, L.INIT_V101_END, '// [page-router] initV101 — scripts/pages/page-router.js'],
]);

writeFileSync(APP_JS, appNew, 'utf8');
console.log('app.js réduit à', appNew.split('\n').length, 'lignes');

let html = readFileSync(INDEX_HTML, 'utf8');
const bootTag = '<script src="./scripts/pages/page-router.js"></script>';
if (!html.includes(bootTag)) {
  html = html.replace(
    '<script src="./app.js"></script>',
    `${bootTag}\n<script src="./app.js"></script>`
  );
  writeFileSync(INDEX_HTML, html, 'utf8');
  console.log('index.html: page-router.js ajouté avant app.js');
}

execSync(`node --check "${OUT}"`, { stdio: 'inherit' });
execSync(`node --check "${APP_JS}"`, { stdio: 'inherit' });
console.log('P9 extract OK — npm test');
