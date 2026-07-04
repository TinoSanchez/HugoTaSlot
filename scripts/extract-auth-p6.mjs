/**
 * Passe 6 — auth / session / profil / drop / Discord
 * Usage: node scripts/extract-auth-p6.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_JS = path.join(ROOT, 'app.js');
const INDEX_HTML = path.join(ROOT, 'index.html');
const OUT = path.join(ROOT, 'scripts', 'pages', 'auth-cloud.js');
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
  IS_CLOUD: findLine('function isCloudUser()'),
  IS_CLOUD_END: findLine('function uuidLike()') - 1,
  DISCORD_VARS: findLine('let discordLinkCache ='),
  DISCORD_END: findLine('// ADMIN — annoncer une slot manuellement') - 1,
  AUTH_START: findLine('// ─── SYSTÈME DE COMPTES ───'),
  AUTH_END: findLine('const PWA_INSTALL_DISMISS_KEY') - 1,
};

console.log('Repères auth P6:', L);

const globals = [
  'state', 'save', 'load', 'loadLocal', 'writeLocalCache', 'escapeHtml', 'fmt', 'fmtVirtual',
  'showToast', 'confirm', 'bhWarn', 'pushRuntimeLog', 'cloudCall', 'retryAsync', 'withTimeout',
  'renderHuntList', 'selectHunt', 'scheduleHuntUI', 'switchPage', 'activeHunt', 'renderHuntWorkspace',
  'updateHeaderStats', 'requireWriteAccess', 'isCurrentUserAdmin', 'adminFetchCloudUsers',
  'getUsers', 'ensureAdminBootstrap', 'updateAdminTabVisibility', 'getRankBadgeHtml',
  'getDisplayName', 'getAvatarUrl', 'buildAvatarMarkup', 'toEUR', 'FX_RATES_TO_EUR',
  'flushFeedbackQueue', 'LOCAL_SYNCED_KEY', 'STORAGE_KEY', 'CLOUD_STRICT_POINTS',
  '__activePage', 'pathToPage', 'renderHomeHubMetrics', 'invalidateCache', 'handleConnectionRestored',
  'runSupabaseHealthCheck', 'markCircuitSuccess', 'getCircuitState', 'hideNetBanner', 'showNetBanner',
  'dedupeAllHuntsBonuses', 'playerStatsScope', 'ensurePlayerStatsReady', 'savePlayerStatsForScope',
  'STATS_GAMES', 'renderStatsPage', 'renderHomeDiscordBanner', 'maybeOpenPendingSlotPrefill',
  'consumeSlotPrefillFromUrl', 'openDiscordLinkModal', 'loadDiscordLinkStatus',
].join(', ');

const isCloudBlock = sliceRange(L.IS_CLOUD, L.IS_CLOUD_END);
const discordBlock = sliceRange(L.DISCORD_VARS, L.DISCORD_END);
const authBlock = sliceRange(L.AUTH_START, L.AUTH_END);

const authJs = `'use strict';
/* globals ${globals} */
/* Auth cloud Supabase, session, profil, drop quotidien, liaison Discord — chargé au boot (index.html) */

${isCloudBlock}

${discordBlock}

${authBlock}
`;

writeFileSync(OUT, authJs, 'utf8');
console.log('Écrit', OUT, `(${authJs.split('\n').length} lignes)`);

let app = readFileSync(APP_JS, 'utf8');

app = app.replace(
  lines.slice(L.IS_CLOUD - 1, L.IS_CLOUD_END).join('\n'),
  '// isCloudUser → scripts/pages/auth-cloud.js (boot)\n'
);

app = app.replace(
  lines.slice(L.DISCORD_VARS - 1, L.DISCORD_END).join('\n'),
  '// [auth-cloud] Discord link — scripts/pages/auth-cloud.js\n'
);

app = app.replace(
  lines.slice(L.AUTH_START - 1, L.AUTH_END).join('\n'),
  '// [auth-cloud] — scripts/pages/auth-cloud.js (boot)\n'
);

writeFileSync(APP_JS, app, 'utf8');

let html = readFileSync(INDEX_HTML, 'utf8');
const bootTag = '<script src="./scripts/pages/auth-cloud.js"></script>';
if (!html.includes(bootTag)) {
  html = html.replace(
    '<script src="./app.js"></script>',
    `${bootTag}\n<script src="./app.js"></script>`
  );
  writeFileSync(INDEX_HTML, html, 'utf8');
  console.log('index.html: auth-cloud.js ajouté avant app.js');
}

execSync(`node --check "${OUT}"`, { stdio: 'inherit' });
execSync(`node --check "${APP_JS}"`, { stdio: 'inherit' });
console.log('P6 extract OK — npm test');
