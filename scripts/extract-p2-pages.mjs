/**
 * Passe 2 — extraction admin, news, updates, review depuis app.js
 * Usage: node scripts/extract-p2-pages.mjs
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
  NEWS_CACHE: findLine('const NEWS_CACHE = { videos: null'),
  NEWS_TTL: findLine('const NEWS_TTL_MS ='),
  INAPP: findLine('const INAPP_NOTIFS_KEY ='),
  NEWS_BANNER: findLine('function renderNewsSlotWeekBanner'),
  ADMIN_TOURNOI: findLine('let adminTournoiSelection = new Set();'),
  FETCH_NEWS: findLine('async function fetchNewsVideos()'),
  DISCORD: findLine('// LIAISON DISCORD (modal profil + bandeau accueil)'),
  ADMIN_SLOT_DRAFT: findLine('function getAdminSlotDraft()'),
  ADMIN_PREVIEW_HUNT: findLine('function adminPreviewSlotToHunt()'),
  PREFILL: findLine('function maybeOpenPendingSlotPrefill()'),
  RESET_SLOT: findLine('function resetAdminSlotForm()'),
  HOME_HUB: findLine('function renderHomeHubMetrics()'),
  UPDATES: findLine('function renderUpdatesPage()'),
  FEEDBACK: findLine('function getFeedbackQueue()'),
  OPENER_KEY: findLine('function getOpenerKeybinds()'),
  ADMIN_BALANCE: findLine('function adminSetBalancePrompt(username)'),
  OPENER_SEND: findLine('// ─── BOUTON ENVOYER SUR SLOT (Opener) ───'),
  ADMIN_VIEW: findLine('const adminViewState = {'),
  FEEDBACK_KEY: findLine("const FEEDBACK_QUEUE_KEY = 'hm_feedback_queue_v1'"),
};

console.log('Repères P2:', L);

const extractions = [
  {
    file: 'admin.js',
    label: 'Panel admin + modération tournoi + slots manuelles',
    globals: 'showToast, showAuth, escapeHtml, fmt, fmtVirtual, isSafeUrl, isCurrentUserAdmin, isCloudUser, currentUser, state, getAuthClient, cloudCall, invalidateCache, bhWarn, mapAuthError, actionGuardAcquire, getUsers, saveUsers, saveSession, updateLobbyBalance, renderProfileBadge, getMaintenanceConfig, refreshMaintenanceConfig, MAINTENANCE_DEFAULT, getOpsAlertsConfig, saveOpsAlertsConfig, sendOpsAlert, pushLocalAdminAudit, pushRuntimeLog, buildSlotHuntPrefillUrl, confirm, fetchTournoi, renderTournoiLeaderboard, adminVerifyTournoiEntry, adminRejectTournoiEntry, addNewsSlotToHunt, setSlotOfTheWeek, invalidateNewsCache, renderMaintenanceBanner, getCloudUiStatus',
    ranges: [
      [L.ADMIN_VIEW, L.ADMIN_VIEW + 6],
      [L.ADMIN_TOURNOI, L.FETCH_NEWS - 1],
      [L.ADMIN_SLOT_DRAFT, L.PREFILL - 1],
      [L.RESET_SLOT, L.HOME_HUB - 1],
      [L.ADMIN_BALANCE, L.OPENER_SEND - 1],
    ],
    bodyReplace: [[/NEWS_CACHE\.ts = 0/g, 'invalidateNewsCache()']],
    placeholder: '// [admin] — extrait dans scripts/pages/admin.js (LAZY_PAGE_SCRIPTS)',
  },
  {
    file: 'news.js',
    label: 'Page Actualités (YouTube + slots)',
    globals: 'escapeHtml, bhWarn, mapAuthError, getAuthClient, cloudCall, pickSlotOfTheWeek, addNewsSlotWeekToHunt, isSafeUrl',
    ranges: [
      [L.NEWS_CACHE, L.INAPP - 1],
      [L.NEWS_BANNER, L.ADMIN_TOURNOI - 1],
      [L.FETCH_NEWS, L.DISCORD - 2],
    ],
    placeholder: '// [news] — extrait dans scripts/pages/news.js (LAZY_PAGE_SCRIPTS)',
    extras: `\nfunction invalidateNewsCache() { NEWS_CACHE.ts = 0; }\n`,
  },
  {
    file: 'updates.js',
    label: 'Page Updates / ops',
    globals: 'escapeHtml, getRuntimeLogs, getActionGuardStatus, getMaintenanceConfig, getAutoSnapshots, getOpsAlertsConfig, cloudSyncDisabled, cloudSyncInFlight, cloudSyncFailureCount, onlineCount, supaHealth, renderProductChangelogSection, renderProductChangelogHtml',
    ranges: [[L.UPDATES, L.FEEDBACK - 1]],
    placeholder: '// [updates] — extrait dans scripts/pages/updates.js (LAZY_PAGE_SCRIPTS)',
  },
  {
    file: 'review.js',
    label: 'Page Review / feedback site',
    globals: 'showToast, escapeHtml, mapAuthError, getAuthClient, cloudCall, cloudCall, actionGuardAcquire, currentUser, pushRuntimeLog, invalidateCache, FEEDBACK_QUEUE_KEY',
    ranges: [[L.FEEDBACK, L.OPENER_KEY - 1]],
    placeholder: '// [review] — extrait dans scripts/pages/review.js (LAZY_PAGE_SCRIPTS)',
    headerExtra: "const FEEDBACK_QUEUE_KEY = 'hm_feedback_queue_v1';\n",
  },
];

const removedLines = new Set();
const placeholderAt = new Map();

for (const ex of extractions) {
  const chunks = ex.ranges.map(([s, e]) => sliceRange(s, e));
  let body = chunks.join('\n\n');
  if (ex.bodyReplace) {
    for (const [re, rep] of ex.bodyReplace) body = body.replace(re, rep);
  }
  if (ex.extras) body += ex.extras;
  const header = `'use strict';\n/* globals ${ex.globals} */\n/* ${ex.label} — lazy via LAZY_PAGE_SCRIPTS */\n\n${ex.headerExtra || ''}`;
  const dest = path.join(PAGES_DIR, ex.file);
  writeFileSync(dest, header + body + '\n', 'utf8');
  execSync(`node --check "${dest}"`, { stdio: 'pipe' });
  console.log(`✓ ${ex.file} (${(header + body).split('\n').length} lignes)`);
  for (const [s, e] of ex.ranges) {
    for (let i = s; i <= e; i++) removedLines.add(i);
    if (!placeholderAt.has(s)) placeholderAt.set(s, ex.placeholder);
  }
}

// Retirer FEEDBACK_QUEUE_KEY de app.js (déplacé dans review.js)
for (let i = L.FEEDBACK_KEY; i <= L.FEEDBACK_KEY; i++) removedLines.add(i);

const newLines = [];
for (let i = 1; i <= lines.length; i++) {
  if (removedLines.has(i)) {
    if (placeholderAt.has(i)) newLines.push(placeholderAt.get(i));
  } else {
    newLines.push(lines[i - 1]);
  }
}

let appContent = newLines.join('\n');

// LAZY_PAGE_SCRIPTS — activer admin, news, updates, review
appContent = appContent.replace(
  /(\s+stats:\s+'\.\/scripts\/pages\/stats\.js',)\n(\s+\/\/ updates, review, news, admin, hunt → app\.js \(extraction progressive\))/,
  `$1
  admin:       './scripts/pages/admin.js',
  news:        './scripts/pages/news.js',
  updates:     './scripts/pages/updates.js',
  review:      './scripts/pages/review.js',
$2`
);

writeFileSync(APP_JS, appContent, 'utf8');
execSync(`node --check "${APP_JS}"`, { stdio: 'pipe' });
console.log(`✓ app.js reconstruit (${newLines.length} lignes, était ${lines.length})`);
console.log('\n✅ Extraction P2 terminée.');
