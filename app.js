'use strict';

/** Logs console : activer avec ?debug=1, localStorage bh_debug=1 ou window.__BH_DEBUG__ = true */
const BH_DEBUG = (() => {
  try {
    if (typeof window !== 'undefined' && window.__BH_DEBUG__ === true) return true;
    if (typeof localStorage !== 'undefined' && localStorage.getItem('bh_debug') === '1') return true;
  } catch (_) {}
  try {
    return typeof location !== 'undefined' && /(?:^|[?&])debug=1(?:&|$)/.test(location.search || '');
  } catch (_) { return false; }
})();
function bhWarn(...args) {
  if (BH_DEBUG) console.warn('[BH]', ...args);
}

// [catalog-url] DEFAULT_SLOT_DEVISE / normalizeCatalogEntry
const state = {
  hunts: [],
  activeHuntId: null,
  slots: [],
  searchIndex: [],
  slotRefIndex: new Map(),
  slotMeta: [],
  filteredSlots: [],
  openerIndex: 0,
  pendingSlot: null,
  bonusView: { status: 'all', type: 'all', winFilter: 'all', sort: 'order', q: '', provider: '', minStake: '', maxStake: '' },
  huntListView: { q: '' },
  huntTab: 'workspace',
  catalogMode: 'gamdom',
};

// Taux de change indicatifs vers EUR (à raffraîchir périodiquement).
// Source : moyennes constatées en avr. 2026 — pour l'affichage, pas du trading.
const FX_RATES_TO_EUR = {
  EUR: 1,
  USD: 0.92,
  GBP: 1.17,
  CAD: 0.68,
  CHF: 1.04,
  JPY: 0.0061,
  INR: 0.011,
  CNY: 0.13,
  IDR: 0.000058,
  KRW: 0.00067,
  PHP: 0.016,
  RUB: 0.0098,
  MXN: 0.054,
  PLN: 0.23,
  TRY: 0.028,
  VND: 0.000037,
  ARS: 0.00091,
  PEN: 0.25,
  CLP: 0.00098,
  NGN: 0.00058,
  AED: 0.25,
  BHD: 2.44,
  CRC: 0.0017,
  KWD: 3.00,
  MAD: 0.092,
  MYR: 0.20,
  QAR: 0.25,
  SAR: 0.25,
  SGD: 0.69,
  TND: 0.30,
  TWD: 0.029,
  GHS: 0.063,
  KES: 0.0066,
  BOB: 0.13,
  XOF: 0.0015,
  PKR: 0.0033,
  NZD: 0.55,
  ISK: 0.0066,
  BAM: 0.51,
  TZS: 0.00037,
  EGP: 0.019
};

const CURRENCY_SYMBOLS = {
  EUR: '€',
  USD: '$',
  GBP: '£',
  CAD: 'C$',
  CHF: 'CHF',
  JPY: '¥',
  INR: '₹',
  CNY: '¥',
  IDR: 'Rp',
  KRW: '₩',
  PHP: '₱',
  RUB: '₽',
  MXN: 'MX$',
  PLN: 'zł',
  TRY: '₺',
  VND: '₫',
  ARS: 'AR$',
  PEN: 'S/',
  CLP: 'CL$',
  NGN: '₦',
  AED: 'د.إ',
  BHD: '.د.ب',
  CRC: '₡',
  KWD: 'د.ك',
  MAD: 'د.م.',
  MYR: 'RM',
  QAR: 'ر.ق',
  SAR: 'ر.س',
  SGD: 'S$',
  TND: 'د.ت',
  TWD: 'NT$',
  GHS: '₵',
  KES: 'KSh',
  BOB: 'Bs',
  XOF: 'CFA',
  PKR: '₨',
  NZD: 'NZ$',
  ISK: 'kr',
  BAM: 'KM',
  TZS: 'TSh',
  EGP: 'E£'
};

// Liste ordonnée affichée dans les <select> de devise (ordre = capture utilisateur).
const CURRENCY_LIST = [
  'USD', 'EUR', 'JPY', 'INR',
  'CAD', 'CNY', 'IDR', 'KRW',
  'PHP', 'RUB', 'MXN', 'PLN',
  'TRY', 'VND', 'ARS', 'PEN',
  'CLP', 'NGN', 'AED', 'BHD',
  'CRC', 'KWD', 'MAD', 'MYR',
  'QAR', 'SAR', 'SGD', 'TND',
  'TWD', 'GHS', 'KES', 'BOB',
  'XOF', 'PKR', 'NZD', 'ISK',
  'BAM', 'TZS', 'EGP',
  'GBP', 'CHF'
];

// [catalog-url] CASINO_CONFIG / getBonusGoToUrl → catalog-url.js
const STORAGE_KEY = 'huntmaster_v2';
const LOCAL_SYNCED_KEY = 'huntmaster_v2_synced';
const STREAMER_OVERLAY_KEY = 'hm_opener_streamer_overlay_v1';
const CLOUD_STRICT_POINTS = true;

// ═══════════════════════════════════════════════
//  PERSIST  (Cloud-first, local cache fallback)
// ═══════════════════════════════════════════════
// isCloudUser → scripts/pages/auth-cloud.js (boot)

function uuidLike() {
  if (window.crypto && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function isUuidString(s) {
  return typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

// [cloud-hunts] hunt sync / load / save — scripts/pages/cloud-hunts.js (boot)

//  HELPERS
// ═══════════════════════════════════════════════
const uid = () => Math.random().toString(36).slice(2, 10);
function getDisplayCurrency() {
  const h = state.hunts.find(x => x.id === state.activeHuntId);
  return h?.currency || 'EUR';
}
function toEUR(amount, currency) {
  const rate = FX_RATES_TO_EUR[currency] || 1;
  return amount * rate;
}
function fromEUR(amountEUR, currency) {
  const rate = FX_RATES_TO_EUR[currency] || 1;
  return amountEUR / rate;
}
const toCents = (v) => Math.round(Number(v || 0) * 100);
function fmt(n, currency = null) {
  const cur = currency || getDisplayCurrency();
  const symbol = CURRENCY_SYMBOLS[cur] || '€';
  return `${Number(n || 0).toFixed(2).replace('.', ',')}${symbol}`;
}
function fmtVirtual(n) {
  return Number(n || 0).toFixed(2).replace('.', ',');
}
function beRequiredMultiplier(hunt, stake) {
  if (!hunt) return 0;
  const totalBalanceCents = toCents(hunt.startBalance || 0);
  const bonusStakeCents = toCents(stake || 0);
  if (totalBalanceCents <= 0 || bonusStakeCents <= 0) return 0;
  // Calcul BE au centime près.
  return totalBalanceCents / bonusStakeCents;
}
/** BE moyen hunt : solde départ ÷ somme des mises de tous les bonus (référence break-even global, pas par ligne). */
function beAverageMultiplierForHunt(hunt) {
  if (!hunt || !Array.isArray(hunt.bonuses) || !hunt.bonuses.length) return 0;
  const sb = Number(hunt.startBalance || 0);
  const totalStake = hunt.bonuses.reduce((s, b) => s + Number(b.stake || 0), 0);
  if (sb <= 0 || totalStake <= 0) return 0;
  return sb / totalStake;
}
function refreshCurrencyInline() {
  const symbol = CURRENCY_SYMBOLS[getDisplayCurrency()] || '€';
  document.querySelectorAll('.currency-symbol-inline').forEach(el => { el.textContent = symbol; });
}
const activeHunt = () => state.hunts.find(h => h.id === state.activeHuntId) || null;

/** Normalisation pour dédoublonnage « une machine = un bonus ». */
function normalizeMachineName(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}
function normalizeMachineProvider(s) {
  return String(s || '').trim().toLowerCase();
}
/** Clés qui identifient la même machine (id catalogue ou paire nom+provider). */
function bonusMachineKeySet(b) {
  const keys = new Set();
  const sid = String(b.slotId || '').trim().toLowerCase();
  if (sid && !sid.startsWith('custom_')) keys.add(`id:${sid}`);
  const n = normalizeMachineName(b.slotName);
  const p = normalizeMachineProvider(b.slotProvider);
  if (n) keys.add(`np:${n}|${p}`);
  return keys;
}
function huntBonusMachineConflict(hunt, cand) {
  const cs = bonusMachineKeySet(cand);
  if (!cs.size) return false;
  for (const b of hunt.bonuses || []) {
    const bs = bonusMachineKeySet(b);
    for (const k of cs) {
      if (bs.has(k)) return true;
    }
  }
  return false;
}
/** Retire les doublons (même machine) en gardant la première occurrence. Retourne le nombre retiré. */
function dedupeHuntBonusesByMachine(hunt) {
  const list = hunt.bonuses || [];
  const consumed = new Set();
  const out = [];
  for (const b of list) {
    const ks = bonusMachineKeySet(b);
    let skip = false;
    for (const k of ks) {
      if (consumed.has(k)) { skip = true; break; }
    }
    if (skip) continue;
    for (const k of ks) consumed.add(k);
    out.push(b);
  }
  const removed = list.length - out.length;
  hunt.bonuses = out;
  return removed;
}
function dedupeAllHuntsBonuses() {
  let n = 0;
  for (const h of state.hunts || []) n += dedupeHuntBonusesByMachine(h);
  return n;
}

// [core-ui] SFX / toasts / confirm

// [catalog-slots] — scripts/pages/catalog-slots.js (lazy hunt)

// [page-router] __detachedPanels → page-router.js

function huntWorkspaceFingerprint() {
  const h = activeHunt();
  if (!h) return '';
  const opened = (h.bonuses || []).filter((b) => b.win !== null).length;
  return `${h.id}:${(h.bonuses || []).length}:${opened}:${state.bonusView.q}:${state.bonusView.status}`;
}

function scheduleHuntUI(opts = {}) {
  __huntUiPending = { ...(__huntUiPending || {}), ...opts };
  clearTimeout(__huntUiTimer);
  __huntUiTimer = setTimeout(() => {
    const pending = __huntUiPending || {};
    __huntUiPending = null;
    flushHuntUI(pending);
  }, 40);
}

async function flushHuntUI(opts = {}) {
  renderHuntList();
  if (!state.activeHuntId) return;
  if (__activePage !== 'hunt' || state.huntTab !== 'workspace') return;
  if (opts.loadCatalog) {
    try { await ensureSlotsLoaded(); } catch (_) {}
  }
  const fp = huntWorkspaceFingerprint();
  if (!opts.force && fp === state._huntWsFp) return;
  state._huntWsFp = fp;
  renderHuntWorkspace(true);
}

// [page-router] mountCachedPage / stashPageMount
// [cloud-hunts] cloudCall / circuit breaker / net banner

async function fetchJSONWithRetry(url, { retries = 2, timeoutMs = 9000 } = {}) {
  return retryAsync(async () => {
    const r = await withTimeout(() => fetch(url), timeoutMs);
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  }, { retries, delayMs: 300 });
}

const RUNTIME_LOG_KEY = 'hm_runtime_logs_v1';
const AUTO_SNAPSHOT_KEY = 'hm_auto_snapshots_v1';
const OPS_ALERTS_KEY = 'hm_ops_alerts_v1';
// [hunt-templates] HUNT_TEMPLATES_KEY → hunt-templates.js
const GAME_HISTORY_KEY = 'hm_game_history_v1';
const PLAYER_STATS_KEY = 'hm_player_stats_v1';
// [ops-health] supaHealth / runSupabaseHealthCheck → ops-health.js
// lastOpsAlertAt → core-ui.js
// [cloud-hunts] undo stacks

// [hunt-templates] getHuntTemplates / meta / presets
// [core-ui] maintenance / requireWriteAccess / runtime logs
// [ops-health] runSupabaseHealthCheck → ops-health.js
// [admin] getLocalAdminAuditLogs / pushLocalAdminAudit → admin.js

/** Charge jeux-embed.js une seule fois (secours file:// ou si jeux.json absent). */
// [catalog-slots] loadSlots / updateCatalogModeHint

// [core-ui] mobile nav + modal a11y

// [catalog-slots] filterAndRender / renderPage / listeners → initCatalogSlotsUi()

// slot-create listeners → initHuntWorkspaceUi() dans hunt-workspace.js
// ═══════════════════════════════════════════════
// [hunt-workspace] — scripts/pages/hunt-workspace.js (lazy hunt)
// ═══════════════════════════════════════════════
//  OPENER
// ═══════════════════════════════════════════════
// [hunt-opener] — scripts/pages/hunt-opener.js (lazy hunt)
// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
async function init() {
  // jeux.json n'est plus chargé au boot : il l'est à la demande
  // (ensureSlotsLoaded() depuis switchPage('hunt') ou lors d'un init Hunt actif).
  await load();
  await loadLazyPageScript('hunt').catch(() => {});
  applyHuntAppHooks();
  const catalogSelect = document.getElementById('catalog-mode-filter');
  if (catalogSelect) catalogSelect.value = state.catalogMode === 'extended' ? 'extended' : 'gamdom';
  renderHuntList();

  const initialPageGuess = typeof pathToPage === 'function' ? pathToPage(location.pathname) : 'home';
  const hasActiveHunt = state.activeHuntId && state.hunts.find(h => h.id === state.activeHuntId);

  if (hasActiveHunt) {
    document.getElementById('no-hunt-selected').style.display = 'none';
    document.getElementById('hunt-workspace').classList.remove('hidden');
    document.getElementById('hunt-workspace').style.display = 'flex';
    const openBtn = document.getElementById('btn-open-hunt');
    if (openBtn) openBtn.disabled = false;
  }
  flushFeedbackQueue().catch(() => {});
}

// Purge des clés legacy (tout passe en Supabase maintenant)
try { localStorage.removeItem('hm_users_v1'); } catch (_) {}
try { localStorage.removeItem('hm_admin_bootstrap_v1'); } catch (_) {}

init().catch((e) => {
  bhWarn('init failed', e);
  pushRuntimeLog('error', `init: ${String(e?.message || e || 'unknown')}`);
});

// ═══════════════════════════════════════════════════════════
//  HUNT MASTER v1.01 — NOUVELLES FONCTIONNALITÉS
// ═══════════════════════════════════════════════════════════

// [page-router] PAGE_TO_SLUG / switchHuntTab / hunt tabs URL
// [hunt-hooks] hub hunt tabs UI → hunt-hooks.js
// [page-router] switchPage
// [page-router] __PAGE_HTML / LAZY_PAGE_SCRIPTS / loadLazyPageScript
// [catalog-slots] ensureSlotsLoaded — scripts/pages/catalog-slots.js

// [news] — extrait dans scripts/pages/news.js (LAZY_PAGE_SCRIPTS)
// [inapp-notifs] — scripts/pages/inapp-notifs.js
// [news] — extrait dans scripts/pages/news.js (LAZY_PAGE_SCRIPTS)
// [admin] — extrait dans scripts/pages/admin.js (LAZY_PAGE_SCRIPTS)
// [news] — extrait dans scripts/pages/news.js (LAZY_PAGE_SCRIPTS)
// ────────────────────────────────────────────────────────────
// LIAISON DISCORD (modal profil + bandeau accueil)
// ────────────────────────────────────────────────────────────
// [auth-cloud] Discord link — scripts/pages/auth-cloud.js

// ADMIN — annoncer une slot manuellement
// ────────────────────────────────────────────────────────────
// [admin] — extrait dans scripts/pages/admin.js (LAZY_PAGE_SCRIPTS)
// [hub-features] renderHomeHubMetrics
// [core-ui] runGlobalSearch

// [updates] — extrait dans scripts/pages/updates.js (LAZY_PAGE_SCRIPTS)
// [review] — extrait dans scripts/pages/review.js (LAZY_PAGE_SCRIPTS)
// [hunt-hooks] opener / Gamdom / applyHuntAppHooks
// [auth-cloud] — scripts/pages/auth-cloud.js (boot)

// [app-boot] PWA + trackPlayerGameStats
// [jeux] — extrait dans scripts/pages/mini-jeux.js (LAZY_PAGE_SCRIPTS)

// ─── INIT v1.01 ───
// [page-router] initV101 — scripts/pages/page-router.js
// [app-boot] DOMContentLoaded → app-boot.js