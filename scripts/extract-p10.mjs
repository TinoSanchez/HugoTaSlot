/**
 * Passe 10 — satellites app.js (catalog URL, templates hunt, notifs, hooks, boot DOM)
 * Usage: node scripts/extract-p10.mjs
 */
import { readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_JS = path.join(ROOT, 'app.js');
const INDEX_HTML = path.join(ROOT, 'index.html');
const PAGES = path.join(ROOT, 'scripts', 'pages');
mkdirSync(PAGES, { recursive: true });

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

function writeModule(filename, globals, body, header) {
  const out = path.join(PAGES, filename);
  const js = `'use strict';
/* globals ${globals} */
${header}

${body}
`;
  writeFileSync(out, js, 'utf8');
  console.log('Écrit', out, `(${js.split('\n').length} lignes)`);
  return out;
}

const L = {
  CAT_A_START: findLine('const DEFAULT_SLOT_DEVISE'),
  CAT_A_END: findLine('const state = {') - 1,
  CAT_B_START: findLine('const CASINO_CONFIG = {'),
  CAT_B_END: findLine('const STORAGE_KEY =') - 1,
  TMPL_KEY1: findLine("const HUNT_TEMPLATES_KEY ="),
  TMPL_KEY2: findLine("const BONUS_FILTER_PRESETS_KEY ="),
  TMPL_KEY3: findLine("const HUNT_META_KEY ="),
  TMPL_FN_START: findLine('function getHuntTemplates()'),
  TMPL_FN_END: findLine('// [core-ui] maintenance / requireWriteAccess') - 1,
  HUB_UI_START: findLine('function syncBonusFilterUiFromState()'),
  HUB_UI_END: findLine('// [page-router] switchPage') - 1,
  INAPP_START: findLine('const INAPP_NOTIFS_KEY ='),
  INAPP_END: findLine('// [news] — extrait dans scripts/pages/news.js', findLine('const INAPP_NOTIFS_KEY =')) - 1,
  HOME_METRICS_START: findLine('function renderHomeHubMetrics()'),
  HOME_METRICS_END: findLine('// [core-ui] runGlobalSearch') - 1,
  HOOKS_START: findLine('function getOpenerKeybinds()'),
  HOOKS_END: findLine('// [auth-cloud] — scripts/pages/auth-cloud.js') - 1,
  BOOT_PWA_START: findLine('const PWA_INSTALL_DISMISS_KEY ='),
  BOOT_STATS_END: findLine('// [jeux] — extrait dans scripts/pages/mini-jeux.js') - 1,
  BOOT_DOM_START: findLine('function registerAppServiceWorker()'),
  BOOT_DOM_END: lines.length,
};

console.log('Repères P10:', L);

// ─── catalog-url.js ───
writeModule(
  'catalog-url.js',
  'state, normalizeCatalogEntry, isCatalogPlaceholderImage',
  [sliceRange(L.CAT_A_START, L.CAT_A_END), sliceRange(L.CAT_B_START, L.CAT_B_END)].join('\n\n'),
  '/* Helpers catalogue / URLs casino (boot avant page-router) */'
);

// ─── hunt-templates.js ───
writeModule(
  'hunt-templates.js',
  'state, activeHunt, showToast, uid, save, renderHuntTemplateGrid, fmt',
  [
    lines[L.TMPL_KEY1 - 1],
    lines[L.TMPL_KEY2 - 1],
    lines[L.TMPL_KEY3 - 1],
    sliceRange(L.TMPL_FN_START, L.TMPL_FN_END),
  ].join('\n\n'),
  '/* Templates hunt + meta + presets filtres bonus (boot) */'
);

// ─── inapp-notifs.js ───
writeModule(
  'inapp-notifs.js',
  'escapeHtml, switchPage, getAuthClient, cloudCall, isCloudUser, currentUser, getDailyState, getDayIndex',
  sliceRange(L.INAPP_START, L.INAPP_END),
  '/* Notifications in-app header (boot) */'
);

// ─── hunt-hooks.js ───
writeModule(
  'hunt-hooks.js',
  [
    'state', 'activeHunt', 'save', 'showToast', 'fmt', 'getUiPrefs', 'getCasinoLabel',
    'getBonusGoToUrl', 'renderHuntWorkspace', 'renderOpener', 'playJackpotBoost',
    'normalizeHuntTab', 'switchHuntTab', 'huntTabToPath', 'setDocumentTitleForHuntTab',
  ].join(', '),
  [sliceRange(L.HUB_UI_START, L.HUB_UI_END), sliceRange(L.HOOKS_START, L.HOOKS_END)].join('\n\n'),
  '/* Hub hunt UI tabs + hooks opener / Gamdom FAB (boot) */'
);

// ─── renderHomeHubMetrics → hub-features.js ───
const hubPath = path.join(PAGES, 'hub-features.js');
const hubMetrics = sliceRange(L.HOME_METRICS_START, L.HOME_METRICS_END);
appendFileSync(
  hubPath,
  `\n\n/* renderHomeHubMetrics — extrait app.js P10 */\n${hubMetrics}\n`,
  'utf8'
);
console.log('Append hub-features.js (renderHomeHubMetrics)');

// ─── app-boot.js (après app.js) ───
writeModule(
  'app-boot.js',
  [
    'startCatalogAutoRefresh', 'initSidebarNavA11y', 'initHuntHubTabs', 'initModalA11yObserver',
    'updateCatalogModeHint', 'setStreamerOverlayEnabled', 'closeStreamerHudWin', 'initV101',
    'pendingAuthOpen', 'showAuth', 'bhWarn', 'pushRuntimeLog', 'renderMaintenanceBanner',
    'showNetBanner', 'hideNetBanner', 'handleConnectionRestored', 'BH_DEBUG', 'currentUser',
    'saveSession', 'playUiTone', 'profileMenuJustOpenedAt', 'profileMenuIsOpen', 'closeProfileMenu',
    'positionProfileMenu', 'showToast', 'ensurePlayerStatsReady', 'savePlayerStatsForScope',
    'playerStatsScope', 'STATS_GAMES', 'bumpWeeklyObjectiveProgress', '__activePage', 'renderStatsPage',
  ].join(', '),
  [sliceRange(L.BOOT_PWA_START, L.BOOT_STATS_END), sliceRange(L.BOOT_DOM_START, L.BOOT_DOM_END)].join('\n\n'),
  '/* PWA, stats mini-jeux, service worker, listeners DOMContentLoaded (boot après app.js) */'
);

// ─── Retirer blocs de app.js ───
const appNew = removeLineRanges(lines, [
  [L.CAT_A_START, L.CAT_A_END, '// [catalog-url] DEFAULT_SLOT_DEVISE / normalizeCatalogEntry'],
  [L.CAT_B_START, L.CAT_B_END, '// [catalog-url] CASINO_CONFIG / getBonusGoToUrl → catalog-url.js'],
  [L.TMPL_KEY1, L.TMPL_KEY1, '// [hunt-templates] HUNT_TEMPLATES_KEY → hunt-templates.js'],
  [L.TMPL_KEY2, L.TMPL_KEY2, ''],
  [L.TMPL_KEY3, L.TMPL_KEY3, ''],
  [L.TMPL_FN_START, L.TMPL_FN_END, '// [hunt-templates] getHuntTemplates / meta / presets'],
  [L.HUB_UI_START, L.HUB_UI_END, '// [hunt-hooks] hub hunt tabs UI → hunt-hooks.js'],
  [L.INAPP_START, L.INAPP_END, '// [inapp-notifs] — scripts/pages/inapp-notifs.js'],
  [L.HOME_METRICS_START, L.HOME_METRICS_END, '// [hub-features] renderHomeHubMetrics'],
  [L.HOOKS_START, L.HOOKS_END, '// [hunt-hooks] opener / Gamdom / applyHuntAppHooks'],
  [L.BOOT_PWA_START, L.BOOT_STATS_END, '// [app-boot] PWA + trackPlayerGameStats'],
  [L.BOOT_DOM_START, L.BOOT_DOM_END, '// [app-boot] DOMContentLoaded → app-boot.js'],
]);

// Nettoyer lignes vides de commentaires-only pour TMPL keys
const cleaned = appNew.replace(/\n\/\/ \[hunt-templates\] HUNT_TEMPLATES_KEY → hunt-templates\.js\n\n\n/g, '\n// [hunt-templates] keys → hunt-templates.js\n');

writeFileSync(APP_JS, cleaned, 'utf8');
console.log('app.js réduit à', cleaned.split('\n').length, 'lignes');

// ─── index.html boot chain ───
let html = readFileSync(INDEX_HTML, 'utf8');
const beforeApp = [
  '<script src="./scripts/pages/catalog-url.js"></script>',
  '<script src="./scripts/pages/hunt-templates.js"></script>',
  '<script src="./scripts/pages/inapp-notifs.js"></script>',
  '<script src="./scripts/pages/hunt-hooks.js"></script>',
];
for (const tag of beforeApp) {
  if (!html.includes(tag)) {
    html = html.replace('<script src="./scripts/pages/page-router.js"></script>', `${tag}\n<script src="./scripts/pages/page-router.js"></script>`);
  }
}
const bootAfter = '<script src="./scripts/pages/app-boot.js"></script>';
if (!html.includes(bootAfter)) {
  html = html.replace('<script src="./app.js"></script>', '<script src="./app.js"></script>\n' + bootAfter);
}
writeFileSync(INDEX_HTML, html, 'utf8');
console.log('index.html mis à jour');

// hub-features globals — ajouter onlineCount, toEUR si absent
let hub = readFileSync(hubPath, 'utf8');
if (!hub.includes('onlineCount')) {
  hub = hub.replace(
    '/* globals showToast',
    '/* globals onlineCount, toEUR, showToast'
  );
  writeFileSync(hubPath, hub, 'utf8');
}

for (const f of ['catalog-url.js', 'hunt-templates.js', 'inapp-notifs.js', 'hunt-hooks.js', 'app-boot.js']) {
  execSync(`node --check "${path.join(PAGES, f)}"`, { stdio: 'inherit' });
}
execSync(`node --check "${APP_JS}"`, { stdio: 'inherit' });
execSync(`node --check "${hubPath}"`, { stdio: 'inherit' });
console.log('P10 extract OK — npm test');
