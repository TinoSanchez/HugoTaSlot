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
  if (BH_DEBUG) bhWarn(...args);
}

const DEFAULT_SLOT_DEVISE = { active: 'USD', symbole: '$' };

function isCatalogPlaceholderImage(url) {
  const u = String(url || '').toLowerCase();
  return !u || u.includes('placehold.co') || u.includes('via.placeholder');
}

function normalizeCatalogEntry(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  if (!entry.devise) entry.devise = DEFAULT_SLOT_DEVISE;
  if (isCatalogPlaceholderImage(entry.image)) entry.image = '';
  return entry;
}

// ═══════════════════════════════════════════════
//  STATE
// ═══════════════════════════════════════════════
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

const CASINO_CONFIG = {
  gamdom: { label: 'Gamdom', searchUrl: (q) => `https://gamdom.com/casino?tab=slots&search=${encodeURIComponent(q || '')}` },
  stake: { label: 'Stake', searchUrl: (q) => `https://stake.com/casino/group/slots?search=${encodeURIComponent(q || '')}` },
  roobet: { label: 'Roobet', searchUrl: (q) => `https://roobet.com/casino?search=${encodeURIComponent(q || '')}` },
  bitstarz: { label: 'BitStarz', searchUrl: (q) => `https://www.bitstarz.com/slots/all?search=${encodeURIComponent(q || '')}` },
  rollbit: { label: 'Rollbit', searchUrl: (q) => `https://rollbit.com/casino?search=${encodeURIComponent(q || '')}` },
  vibet: { label: 'Vibet', searchUrl: (q) => `https://vibet.com/casino?search=${encodeURIComponent(q || '')}` },
  celcius: { label: 'Celcius', searchUrl: (q) => `https://celcius.com/casino?search=${encodeURIComponent(q || '')}` },
  shuffle: { label: 'Shuffle', searchUrl: (q) => `https://shuffle.com/casino?search=${encodeURIComponent(q || '')}` },
  bcgame: { label: 'BC.Game', searchUrl: (q) => `https://bc.game/casino/slots?search=${encodeURIComponent(q || '')}` },
  duelbits: { label: 'Duelbits', searchUrl: (q) => `https://duelbits.com/casino/slots?search=${encodeURIComponent(q || '')}` },
  betfury: { label: 'Betfury', searchUrl: (q) => `https://betfury.io/casino/slots?search=${encodeURIComponent(q || '')}` },
  sportsbetio: { label: 'Sportsbet.io', searchUrl: (q) => `https://sportsbet.io/casino/games/slots?search=${encodeURIComponent(q || '')}` }
};
function getCasinoKey(raw) {
  const key = String(raw || '').toLowerCase();
  return CASINO_CONFIG[key] ? key : 'gamdom';
}
function getCasinoLabel(raw) {
  return CASINO_CONFIG[getCasinoKey(raw)].label;
}
function buildCasinoSlotUrl(casinoKey, slotName) {
  return CASINO_CONFIG[getCasinoKey(casinoKey)].searchUrl(String(slotName || ''));
}
/** Nom de slot comparable (casse, espaces, accents légers). */
function normalizeBonusCompareName(s) {
  try {
    return String(s || '')
      .replace(/[\u2018\u2019\u02BC\uFF07]/g, "'")
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim();
  } catch {
    return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
}
function normalizeThumbForMatch(u) {
  try {
    const s = String(u || '').trim().toLowerCase();
    if (!s) return '';
    const noQ = s.split('?')[0].split('#')[0];
    return noQ.replace(/\/$/, '');
  } catch {
    return '';
  }
}
/** Ancien format API : /casino/games/{code} */
function isGamdomLegacyGamesUrl(u) {
  return /^https?:\/\/(?:[\w-]+\.)?gamdom\.com\/casino\/games\/.+/i.test(String(u || '').trim());
}
/** Format actuel : https://gamdom.com/fr-fr/casino/dropem-hacksaw-gaming */
function isGamdomSeoCasinoUrl(u) {
  return /^https?:\/\/(?:[\w-]+\.)?gamdom\.com\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?casino\/(?!games\/)[\w-]+\/?(?:[?#]|$)/i.test(String(u || '').trim());
}
/** URL qui ouvre une page jeu (legacy ou SEO). */
function isGamdomDirectGameUrl(u) {
  return isGamdomLegacyGamesUrl(u) || isGamdomSeoCasinoUrl(u);
}
/** Lien direct vers une fiche jeu Stake. */
function isStakeDirectGameUrl(u) {
  return /^https?:\/\/(?:[\w-]+\.)?stake\.com\/casino\/games\/.+/i.test(String(u || '').trim());
}
/** Gamdom SEO/legacy ou Stake /casino/games/… */
function isDirectGamePlayUrl(u) {
  return isGamdomDirectGameUrl(u) || isStakeDirectGameUrl(u);
}
function gamdomSlugifyPart(s) {
  try {
    return String(s || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[''′`´]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .replace(/-+/g, '-');
  } catch {
    return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }
}
/** Préfixe locale (ex. fr-fr) pour les URLs /locale/casino/slug-fournisseur */
function gamdomLocalePathPrefix() {
  try {
    const lang = (navigator.language || 'fr-FR').toLowerCase();
    if (lang.startsWith('fr')) return 'fr-fr';
    if (lang.startsWith('en')) return 'en';
    if (lang.startsWith('de')) return 'de';
    if (lang.startsWith('es')) return 'es';
    return 'fr-fr';
  } catch {
    return 'fr-fr';
  }
}
/** Construit l’URL SEO Gamdom : /{locale}/casino/{nom-fournisseur} (ex. Drop'em + Hacksaw Gaming → dropem-hacksaw-gaming). */
function gamdomSeoCasinoUrlFromNameProvider(nom, provider) {
  const a = gamdomSlugifyPart(nom);
  const b = gamdomSlugifyPart(provider);
  if (!a || !b) return '';
  const loc = gamdomLocalePathPrefix();
  return `https://gamdom.com/${loc}/casino/${a}-${b}`;
}
/** Lien à remplacer par une URL SEO quand possible (vieux /casino/games/, recherche, etc.). */
function isGamdomNonDirectStoredUrl(u) {
  const s = String(u || '').trim().toLowerCase();
  if (!s || !s.includes('gamdom.com')) return false;
  if (isGamdomSeoCasinoUrl(u)) return false;
  if (isGamdomLegacyGamesUrl(u)) return true;
  if (s.includes('tab=slots') || s.includes('/slots/search')) return true;
  return false;
}
function pickBestCatalogMatch(candidates) {
  if (!candidates || !candidates.length) return null;
  const withDirect = candidates.filter((s) => isDirectGamePlayUrl(s?.gamdomUrl || s?.gamdom_url));
  const pool = withDirect.length ? withDirect : candidates;
  let best = pool[0];
  let bestSc = -1;
  for (const s of pool) {
    const idStr = String(s.id || s.Id || '');
    const i = state.slots.findIndex((x) => String(x.id || x.Id || '') === idStr);
    const elig = i >= 0 && state.slotMeta[i]?.gamdomEligible ? 1 : 0;
    const hasUrl = isDirectGamePlayUrl(s?.gamdomUrl || s?.gamdom_url) ? 2 : 0;
    const sc = elig + hasUrl;
    if (sc > bestSc) {
      bestSc = sc;
      best = s;
    }
  }
  return best;
}
/** Retrouve l’entrée catalogue (jeux.json) correspondant au bonus pour lien Gamdom direct. */
function findCatalogSlotForBonus(bonus) {
  if (!bonus || !Array.isArray(state.slots) || !state.slots.length) return null;
  const sid = String(bonus.slotId || bonus.slot_id || '').trim();
  if (sid) {
    const byId = state.slots.find((s) => String(s.id || s.Id || '') === sid);
    if (byId) return byId;
    if (!sid.startsWith('gd_')) {
      const prefixed = state.slots.find((s) => String(s.id || s.Id || '') === `gd_${sid}`);
      if (prefixed) return prefixed;
    }
  }
  const nameNorm = normalizeBonusCompareName(bonus.slotName || bonus.slot_name || '');
  const provNorm = normalizeBonusCompareName(bonus.slotProvider || bonus.provider || '');
  const thumbNorm = normalizeThumbForMatch(bonus.slotImage || bonus.slot_image || '');
  if (nameNorm) {
    const nameHits = state.slots.filter((s) => normalizeBonusCompareName(s.nom || s.name || s.title || s.Name || '') === nameNorm);
    if (nameHits.length) {
      const provHits = provNorm
        ? nameHits.filter((s) => {
            const p = normalizeBonusCompareName(s.provider || s.Provider || '');
            return !p || p === provNorm;
          })
        : nameHits;
      const pool = provHits.length ? provHits : nameHits;
      const picked = pickBestCatalogMatch(pool);
      if (picked) return picked;
    }
  }
  if (thumbNorm) {
    for (let i = 0; i < state.slots.length; i++) {
      const s = state.slots[i];
      const sim = normalizeThumbForMatch(s.image || s.img || s.thumbnail || '');
      if (sim && sim === thumbNorm) return s;
    }
  }
  return null;
}
/** Lien jeu Gamdom : priorité URL SEO /fr-fr/casino/slug (format actuel), puis entrée catalogue déjà à jour. */
function gamdomPlayUrlFromCatalogSlot(s) {
  if (!s) return '';
  const u = String(s.gamdomUrl || s.gamdom_url || '').trim();
  const nom = s.nom || s.name || s.title || s.Name || '';
  const prov = s.provider || s.Provider || '';
  const seo = gamdomSeoCasinoUrlFromNameProvider(nom, prov);
  if (isGamdomSeoCasinoUrl(u)) return u;
  if (seo) return seo;
  if (isGamdomLegacyGamesUrl(u)) return u;
  return gamdomDirectGameUrlFromCatalogId(s.id || s.Id);
}
/** Lien /casino/games/{code} à partir d’un id catalogue gd_… (secours si pas de gamdomUrl). */
function gamdomDirectGameUrlFromCatalogId(catalogId) {
  const id = String(catalogId || '').trim();
  if (!id.startsWith('gd_')) return '';
  const raw = id.slice(3);
  if (!raw) return '';
  return `https://gamdom.com/casino/games/${encodeURIComponent(raw)}`;
}
function inferCasinoFromUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u) return null;
  if (u.includes('stake.com')) return 'stake';
  if (u.includes('roobet.com')) return 'roobet';
  if (u.includes('bitstarz.com')) return 'bitstarz';
  if (u.includes('rollbit.com')) return 'rollbit';
  if (u.includes('vibet.com')) return 'vibet';
  if (u.includes('celcius.com') || u.includes('celsius')) return 'celcius';
  if (u.includes('shuffle.com')) return 'shuffle';
  if (u.includes('bc.game')) return 'bcgame';
  if (u.includes('duelbits.com')) return 'duelbits';
  if (u.includes('betfury.io')) return 'betfury';
  if (u.includes('sportsbet.io')) return 'sportsbetio';
  if (u.includes('gamdom.com')) return 'gamdom';
  return null;
}
function inferCasinoFromBonuses(bonuses) {
  const arr = Array.isArray(bonuses) ? bonuses : [];
  for (const b of arr) {
    const found = inferCasinoFromUrl(b?.gamdomUrl || b?.gamdom_url || '');
    if (found) return found;
  }
  return 'gamdom';
}
function getBonusGoToUrl(hunt, bonus) {
  const casino = getCasinoKey(hunt?.casino);
  const customRaw = String(bonus?.gamdomUrl || bonus?.gamdom_url || '').trim();
  if (/^https?:\/\//i.test(customRaw)) {
    if (casino !== 'gamdom' || !isGamdomNonDirectStoredUrl(customRaw)) return customRaw;
  }
  if (casino === 'gamdom') {
    const cat = findCatalogSlotForBonus(bonus);
    const play = gamdomPlayUrlFromCatalogSlot(cat);
    if (play) return play;
    const seoOnly = gamdomSeoCasinoUrlFromNameProvider(bonus?.slotName || bonus?.slot_name, bonus?.slotProvider || bonus?.provider);
    if (seoOnly) return seoOnly;
    const direct = gamdomDirectGameUrlFromCatalogId(bonus?.slotId || bonus?.slot_id);
    if (direct) return direct;
  }
  if (casino === 'stake') {
    const cat = findCatalogSlotForBonus(bonus);
    const u = String(cat?.gamdomUrl || cat?.gamdom_url || '').trim();
    if (isStakeDirectGameUrl(u)) return u;
  }
  return buildCasinoSlotUrl(hunt?.casino, bonus?.slotName || '');
}

function populateCurrencySelect(selectEl, selected) {
  if (!selectEl) return;
  const sel = String(selected || 'EUR').toUpperCase();
  const opts = CURRENCY_LIST.map(code => {
    const sym = CURRENCY_SYMBOLS[code] || '';
    const label = sym && sym !== code ? `${code} (${sym})` : code;
    return `<option value="${code}"${code === sel ? ' selected' : ''}>${label}</option>`;
  }).join('');
  selectEl.innerHTML = opts;
}
function populateCasinoSelect(selectEl, selected) {
  if (!selectEl) return;
  const sel = getCasinoKey(selected || 'gamdom');
  const opts = Object.entries(CASINO_CONFIG)
    .map(([key, cfg]) => `<option value="${key}"${key === sel ? ' selected' : ''}>${cfg.label}</option>`)
    .join('');
  selectEl.innerHTML = opts;
}

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
const ADMIN_AUDIT_LOCAL_KEY = 'hm_admin_audit_local_v1';
const AUTO_SNAPSHOT_KEY = 'hm_auto_snapshots_v1';
const OPS_ALERTS_KEY = 'hm_ops_alerts_v1';
const HUNT_TEMPLATES_KEY = 'hm_hunt_templates_v1';
const BONUS_FILTER_PRESETS_KEY = 'hm_bonus_filter_presets_v1';
const GAME_HISTORY_KEY = 'hm_game_history_v1';
const PLAYER_STATS_KEY = 'hm_player_stats_v1';
const HUNT_META_KEY = 'hm_hunt_meta_v1';
let supaHealth = {
  checkedAt: 0,
  client: 'unknown',
  auth: 'unknown',
  db: 'unknown',
  realtime: 'unknown',
  latencyMs: null,
  note: ''
};
// lastOpsAlertAt → core-ui.js
// [cloud-hunts] undo stacks

function getHuntTemplates() {
  try {
    const raw = JSON.parse(localStorage.getItem(HUNT_TEMPLATES_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (_) { return []; }
}
function saveHuntTemplates(arr) {
  try { localStorage.setItem(HUNT_TEMPLATES_KEY, JSON.stringify((arr || []).slice(0, 25))); } catch (_) {}
}
function getBonusFilterPresets() {
  try {
    const raw = JSON.parse(localStorage.getItem(BONUS_FILTER_PRESETS_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch (_) { return []; }
}
function saveBonusFilterPresets(arr) {
  try { localStorage.setItem(BONUS_FILTER_PRESETS_KEY, JSON.stringify((arr || []).slice(0, 25))); } catch (_) {}
}
function makeTemplateBonusRows(count, stake) {
  return Array.from({ length: count }, (_, i) => ({
    slotId: uid(),
    slotName: `Slot ${i + 1}`,
    slotProvider: '',
    slotImage: '',
    stake: Number(stake || 0),
    bonusType: 'normal',
    gamdomUrl: ''
  }));
}
function buildDefaultHuntTemplates() {
  return [
    {
      id: 'builtin-quick5',
      name: 'Quick start · 5 bonus',
      desc: 'Premier live — 500 €, mises à 2 €',
      casino: 'gamdom',
      currency: 'EUR',
      startBalance: 500,
      bonusCount: 5,
      bonuses: makeTemplateBonusRows(5, 2)
    },
    {
      id: 'builtin-classic10',
      name: 'Classique · 10 bonus',
      desc: 'Format stream standard — 1 000 €',
      casino: 'gamdom',
      currency: 'EUR',
      startBalance: 1000,
      bonusCount: 10,
      bonuses: makeTemplateBonusRows(10, 1)
    },
    {
      id: 'builtin-marathon15',
      name: 'Marathon · 15 bonus',
      desc: 'Long format — 1 500 €, mises serrées',
      casino: 'gamdom',
      currency: 'EUR',
      startBalance: 1500,
      bonusCount: 15,
      bonuses: makeTemplateBonusRows(15, 0.8)
    }
  ];
}
function getHuntTemplatePickList() {
  return buildDefaultHuntTemplates().concat(getHuntTemplates());
}
function getSelectedNewHuntTemplate() {
  const pickIdx = Number(document.getElementById('new-hunt-template-pick')?.value ?? -1);
  if (!Number.isFinite(pickIdx) || pickIdx < 0) return null;
  return getHuntTemplatePickList()[pickIdx] || null;
}
function applyNewHuntTemplatePrefill(tpl) {
  if (!tpl) return;
  const balEl = document.getElementById('new-hunt-bal-input');
  if (balEl) balEl.value = String(Number(tpl.startBalance || 100));
  populateCurrencySelect(document.getElementById('new-hunt-currency'), tpl.currency || 'EUR');
  populateCasinoSelect(document.getElementById('new-hunt-casino'), tpl.casino || 'gamdom');
  updateNewHuntCurrencyHint();
}
function selectNewHuntTemplate(pickIdx) {
  const idx = Number(pickIdx);
  const pickEl = document.getElementById('new-hunt-template-pick');
  if (pickEl) pickEl.value = String(Number.isFinite(idx) ? idx : -1);
  document.querySelectorAll('.hunt-template-card').forEach((el) => {
    el.classList.toggle('selected', Number(el.dataset.pick) === idx);
  });
  if (!Number.isFinite(idx) || idx < 0) return;
  const tpl = getHuntTemplatePickList()[idx];
  if (tpl) applyNewHuntTemplatePrefill(tpl);
}
function renderHuntTemplateGrid() {
  const grid = document.getElementById('new-hunt-template-grid');
  if (!grid) return;
  const templates = getHuntTemplatePickList();
  const cards = [
    `<button type="button" class="hunt-template-card selected" data-pick="-1" onclick="selectNewHuntTemplate(-1)">
      <span class="hunt-template-card-badge">Vide</span>
      <span class="hunt-template-card-title">Sans template</span>
      <span class="hunt-template-card-meta">Balance et bonus à saisir</span>
    </button>`
  ].concat(templates.map((t, i) => {
    const isUser = String(t.id || '').startsWith('builtin-') === false && !!t.id;
    const badgeCls = isUser ? 'hunt-template-card-badge user' : 'hunt-template-card-badge';
    const badge = isUser ? 'Perso' : 'Starter';
    const casino = getCasinoLabel(getCasinoKey(t.casino || 'gamdom'));
    const count = Number(t.bonusCount || (t.bonuses || []).length || 0);
    const bal = fmt(Number(t.startBalance || 0), t.currency || 'EUR');
    const meta = t.desc || `${count} bonus · ${bal} · ${casino}`;
    return `<button type="button" class="hunt-template-card" data-pick="${i}" onclick="selectNewHuntTemplate(${i})">
      <span class="${badgeCls}">${escapeHtml(badge)}</span>
      <span class="hunt-template-card-title">${escapeHtml(t.name || `Template ${i + 1}`)}</span>
      <span class="hunt-template-card-meta">${escapeHtml(meta)}</span>
    </button>`;
  }));
  grid.innerHTML = cards.join('');
  const pickEl = document.getElementById('new-hunt-template-pick');
  if (pickEl) pickEl.value = '-1';
}
function getHuntMetaMap() {
  try {
    const raw = JSON.parse(localStorage.getItem(HUNT_META_KEY) || '{}');
    return (raw && typeof raw === 'object') ? raw : {};
  } catch (_) { return {}; }
}
function saveHuntMetaMap(v) {
  try { localStorage.setItem(HUNT_META_KEY, JSON.stringify(v || {})); } catch (_) {}
}
function getHuntMeta(huntId) {
  const m = getHuntMetaMap();
  const row = m[String(huntId)] || {};
  return {
    folder: String(row.folder || '').trim(),
    tags: Array.isArray(row.tags) ? row.tags.map((t) => String(t || '').trim()).filter(Boolean).slice(0, 8) : []
  };
}
function setHuntMeta(huntId, meta) {
  const m = getHuntMetaMap();
  m[String(huntId)] = {
    folder: String(meta?.folder || '').trim().slice(0, 32),
    tags: Array.isArray(meta?.tags) ? meta.tags.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean).slice(0, 8) : []
  };
  saveHuntMetaMap(m);
}
function removeHuntMeta(huntId) {
  const m = getHuntMetaMap();
  delete m[String(huntId)];
  saveHuntMetaMap(m);
}
function populateBonusFilterPresetsSelect() {
  const el = document.getElementById('bonus-filter-presets');
  if (!el) return;
  const presets = getBonusFilterPresets();
  el.innerHTML = ['<option value="">Preset filtre...</option>']
    .concat(presets.map((p, i) => `<option value="${i}">${escapeHtml(p.name || `Preset ${i + 1}`)}</option>`))
    .join('');
}
function saveActiveHuntAsTemplate() {
  if (!requireWriteAccess('Création template bloquée')) return;
  const hunt = activeHunt();
  if (!hunt) { showToast('Sélectionne un hunt', 'error'); return; }
  const name = prompt('Nom du template', `${hunt.name} template`);
  if (!name) return;
  const templates = getHuntTemplates();
  templates.unshift({
    id: uid(),
    name: String(name).slice(0, 60),
    casino: hunt.casino || 'gamdom',
    currency: hunt.currency || 'EUR',
    startBalance: Number(hunt.startBalance || 100),
    bonusCount: (hunt.bonuses || []).length,
    bonuses: (hunt.bonuses || []).map((b) => ({
      slotId: b.slotId || uid(),
      slotName: b.slotName || 'Slot',
      slotProvider: b.slotProvider || '',
      slotImage: b.slotImage || '',
      stake: Number(b.stake || 0),
      bonusType: normalizeBonusType(b.bonusType),
      gamdomUrl: b.gamdomUrl || ''
    }))
  });
  saveHuntTemplates(templates);
  showToast('Template sauvegardé', 'success');
}
// [core-ui] maintenance / requireWriteAccess / runtime logs

async function runSupabaseHealthCheck(forceToast = false) {
  const started = Date.now();
  supaHealth = {
    checkedAt: Date.now(),
    client: 'down',
    auth: 'unknown',
    db: 'unknown',
    realtime: onlineChannel ? 'up' : 'down',
    latencyMs: null,
    note: ''
  };
  try {
    const c = getAuthClient();
    if (!c) {
      supaHealth.note = 'Client Supabase indisponible';
      renderUpdatesPage();
      if (forceToast) showToast('Health check: client Supabase indisponible', 'error');
      return;
    }
    supaHealth.client = 'up';
    const { data, error } = await withTimeout(() => c.auth.getSession(), 8000);
    if (error) throw error;
    supaHealth.auth = data?.session ? 'up' : 'no-session';
    if (currentUser?.cloud && currentUser?.id) {
      const { error: dbErr } = await withTimeout(
        () => c.from('profiles').select('id').eq('id', currentUser.id).single(),
        8000
      );
      supaHealth.db = dbErr ? 'degraded' : 'up';
      if (dbErr) supaHealth.note = String(dbErr.message || 'db error').slice(0, 120);
    } else {
      supaHealth.db = 'auth-required';
    }
    supaHealth.latencyMs = Date.now() - started;
  } catch (e) {
    supaHealth.auth = 'down';
    supaHealth.db = 'unknown';
    supaHealth.note = String(e?.message || e || 'health check error').slice(0, 120);
    pushRuntimeLog('error', `health_check: ${supaHealth.note}`);
  }
  supaHealth.realtime = onlineChannel ? 'up' : 'down';
  renderUpdatesPage();
  if (forceToast) showToast('Health check mis à jour', 'info', 1400);
}
function getLocalAdminAuditLogs() {
  try {
    const raw = localStorage.getItem(ADMIN_AUDIT_LOCAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
function pushLocalAdminAudit(action, details = '') {
  try {
    const logs = getLocalAdminAuditLogs();
    logs.unshift({
      ts: Date.now(),
      admin: currentUser?.username || 'admin',
      action: String(action || 'action').slice(0, 80),
      details: String(details || '').slice(0, 240)
    });
    localStorage.setItem(ADMIN_AUDIT_LOCAL_KEY, JSON.stringify(logs.slice(0, 120)));
  } catch (_) {}
}

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
function syncBonusFilterUiFromState() {
  const bv = state.bonusView || {};
  const pairs = [
    ['bonus-status-filter', bv.status || 'all'],
    ['bonus-type-filter', bv.type || 'all'],
    ['bonus-win-filter', bv.winFilter || 'all'],
    ['bonus-sort', bv.sort || 'order'],
    ['bonus-search-filter', bv.q || ''],
    ['bonus-provider-filter', bv.provider || ''],
    ['bonus-min-stake', bv.minStake || ''],
    ['bonus-max-stake', bv.maxStake || ''],
  ];
  pairs.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && String(el.value) !== String(val)) el.value = val;
  });
}

function initHuntWorkspaceUiSimplify() {
  const moreToggle = document.getElementById('btn-hunt-more-toggle');
  const moreMenu = document.getElementById('hunt-toolbar-menu');
  const filtersToggle = document.getElementById('btn-hunt-filters-toggle');
  const filtersAdv = document.getElementById('hunt-filters-advanced');

  if (moreToggle && moreMenu && !moreToggle.dataset.bound) {
    moreToggle.dataset.bound = '1';
    moreToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = moreMenu.classList.contains('hidden');
      moreMenu.classList.toggle('hidden');
      moreToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (moreMenu.classList.contains('hidden')) return;
      if (e.target.closest('.hunt-more-wrap')) return;
      moreMenu.classList.add('hidden');
      moreToggle.setAttribute('aria-expanded', 'false');
    });
  }

  if (filtersToggle && filtersAdv && !filtersToggle.dataset.bound) {
    filtersToggle.dataset.bound = '1';
    filtersToggle.addEventListener('click', () => {
      const willOpen = filtersAdv.classList.contains('hidden');
      filtersAdv.classList.toggle('hidden');
      filtersToggle.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
      filtersToggle.textContent = willOpen ? '− Filtres' : '+ Filtres';
    });
  }

  syncBonusFilterUiFromState();
  initHuntMobileWorkspace();
}

function setHuntMobileView(view) {
  const ws = document.getElementById('hunt-workspace');
  const nav = document.getElementById('hunt-mobile-view');
  if (!ws) return;
  const v = view === 'slots' ? 'slots' : 'bonus';
  ws.dataset.mobileView = v;
  if (nav) {
    nav.querySelectorAll('[data-hunt-view]').forEach((btn) => {
      const on = btn.dataset.huntView === v;
      btn.classList.toggle('active', on);
      btn.setAttribute('aria-current', on ? 'true' : 'false');
    });
  }
  try { localStorage.setItem('hm_hunt_mobile_view_v1', v); } catch (_) {}
}

function initHuntMobileWorkspace() {
  const nav = document.getElementById('hunt-mobile-view');
  const ws = document.getElementById('hunt-workspace');
  if (nav && !nav.dataset.bound) {
    nav.dataset.bound = '1';
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-hunt-view]');
      if (!btn) return;
      setHuntMobileView(btn.dataset.huntView);
    });
  }
  if (ws) {
    let saved = 'bonus';
    try { saved = localStorage.getItem('hm_hunt_mobile_view_v1') || 'bonus'; } catch (_) {}
    setHuntMobileView(saved === 'slots' ? 'slots' : 'bonus');
  }

  const sessionsBtn = document.getElementById('btn-hunt-sessions-toggle');
  const sessionsPanel = document.getElementById('hunt-hub-sessions');
  if (sessionsBtn && sessionsPanel && !sessionsBtn.dataset.bound) {
    sessionsBtn.dataset.bound = '1';
    sessionsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const open = document.body.classList.toggle('hunt-sessions-open');
      sessionsBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    document.addEventListener('click', (e) => {
      if (!document.body.classList.contains('hunt-sessions-open')) return;
      if (e.target.closest('#hunt-hub-sessions') || e.target.closest('#btn-hunt-sessions-toggle')) return;
      document.body.classList.remove('hunt-sessions-open');
      sessionsBtn.setAttribute('aria-expanded', 'false');
    });
  }
}

function initHuntHubTabs() {
  initHuntWorkspaceUiSimplify();
  const nav = document.getElementById('hunt-hub-tabs');
  if (!nav || nav.dataset.bound) return;
  nav.dataset.bound = '1';
  nav.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-hunt-tab]');
    if (!btn) return;
    const tab = normalizeHuntTab(btn.dataset.huntTab);
    switchHuntTab(tab);
    try {
      const path = huntTabToPath(tab);
      if (location.pathname !== path) {
        history.pushState({ page: 'hunt', huntTab: tab }, '', path);
      }
      setDocumentTitleForHuntTab(tab);
    } catch (_) {}
  });
}

// [page-router] switchPage
// [page-router] __PAGE_HTML / LAZY_PAGE_SCRIPTS / loadLazyPageScript
// [catalog-slots] ensureSlotsLoaded — scripts/pages/catalog-slots.js

// [news] — extrait dans scripts/pages/news.js (LAZY_PAGE_SCRIPTS)
const INAPP_NOTIFS_KEY = 'hm_inapp_notifs_v1';
const INAPP_NOTIFS_SEEN_KEY = 'hm_inapp_notifs_seen_v1';
const TOURNOI_ENTRY_STATES_KEY = 'hm_tournoi_entry_states_v1';

function getInAppNotifs() {
  try {
    const list = JSON.parse(localStorage.getItem(INAPP_NOTIFS_KEY) || '[]');
    return Array.isArray(list) ? list : [];
  } catch { return []; }
}
function saveInAppNotifs(list) {
  try { localStorage.setItem(INAPP_NOTIFS_KEY, JSON.stringify((list || []).slice(0, 40))); } catch (_) {}
}
function pushInAppNotif({ type, title, body, actionPage, actionLabel }) {
  const list = getInAppNotifs();
  list.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    type: type || 'info',
    title: String(title || ''),
    body: String(body || ''),
    actionPage: actionPage || '',
    actionLabel: actionLabel || '',
    ts: Date.now(),
    read: false,
  });
  saveInAppNotifs(list);
  renderNotifBell();
}
function getUnreadNotifCount() {
  return getInAppNotifs().filter((n) => !n.read).length;
}
function markAllNotifsRead() {
  const list = getInAppNotifs().map((n) => ({ ...n, read: true }));
  saveInAppNotifs(list);
  renderNotifBell();
}
function markNotifRead(id) {
  const list = getInAppNotifs().map((n) => (n.id === id ? { ...n, read: true } : n));
  saveInAppNotifs(list);
  renderNotifBell();
}
function getNotifSeenState() {
  try { return JSON.parse(localStorage.getItem(INAPP_NOTIFS_SEEN_KEY) || '{}'); } catch { return {}; }
}
function saveNotifSeenState(st) {
  try { localStorage.setItem(INAPP_NOTIFS_SEEN_KEY, JSON.stringify(st || {})); } catch (_) {}
}
function cacheTournoiEntryState(entryId, verified) {
  const st = getNotifSeenState();
  st.tournoi = st.tournoi || {};
  st.tournoi[String(entryId)] = !!verified;
  saveNotifSeenState(st);
}
function renderNotifBell() {
  const wrap = document.getElementById('header-notif-wrap');
  if (!wrap) return;
  const count = getUnreadNotifCount();
  wrap.innerHTML = `
    <button type="button" class="notif-bell-btn" id="notif-bell-btn" aria-expanded="false" aria-label="Notifications${count ? ` (${count})` : ''}">
      🔔${count ? `<span class="notif-bell-badge">${count > 9 ? '9+' : count}</span>` : ''}
    </button>
    <div class="notif-panel hidden" id="notif-panel" role="dialog" aria-label="Notifications">
      <div class="notif-panel-head">
        <span>Notifications</span>
        <button type="button" class="notif-panel-mark" id="notif-mark-read">Tout lu</button>
      </div>
      <div class="notif-panel-list" id="notif-panel-list"></div>
    </div>`;
  const btn = document.getElementById('notif-bell-btn');
  const panel = document.getElementById('notif-panel');
  const listEl = document.getElementById('notif-panel-list');
  const notifs = getInAppNotifs();
  if (listEl) {
    listEl.innerHTML = notifs.length
      ? notifs.slice(0, 12).map((n) => `
        <div class="notif-item${n.read ? '' : ' unread'}" data-notif-id="${escapeHtml(n.id)}">
          <div class="notif-item-title">${escapeHtml(n.title)}</div>
          <div class="notif-item-body">${escapeHtml(n.body)}</div>
          ${n.actionPage ? `<button type="button" class="notif-item-action" data-notif-action="${escapeHtml(n.actionPage)}">${escapeHtml(n.actionLabel || 'Voir')}</button>` : ''}
        </div>`).join('')
      : '<div class="notif-empty">Aucune notification pour l’instant.</div>';
  }
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = '1';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!panel) return;
      const open = panel.classList.toggle('hidden');
      btn.setAttribute('aria-expanded', open ? 'false' : 'true');
      if (!open) markAllNotifsRead();
    });
  }
  document.getElementById('notif-mark-read')?.addEventListener('click', (e) => {
    e.stopPropagation();
    markAllNotifsRead();
  });
  listEl?.querySelectorAll('[data-notif-action]').forEach((el) => {
    el.addEventListener('click', () => {
      const page = el.getAttribute('data-notif-action');
      if (page === 'news') switchPage('news');
      else if (page === 'hunt') switchPage('hunt');
      else if (page === 'jeux') switchPage('jeux');
      panel?.classList.add('hidden');
    });
  });
}
function ensureNotifBellInHeader() {
  const header = document.getElementById('header');
  if (!header || document.getElementById('header-notif-wrap')) return;
  const wrap = document.createElement('div');
  wrap.id = 'header-notif-wrap';
  wrap.className = 'header-notif-wrap';
  const badge = document.getElementById('profile-badge');
  if (badge) header.insertBefore(wrap, badge);
  else header.appendChild(wrap);
  renderNotifBell();
}
async function checkInAppNotifications() {
  const seen = getNotifSeenState();
  let changed = false;
  const c = getAuthClient();
  if (c) {
    try {
      const { data: vids } = await cloudCall('news', () => c.from('youtube_videos').select('video_id,title').order('published_at', { ascending: false }).limit(1), { retries: 0, timeoutMs: 8000, quiet: true });
      const vid = vids?.[0];
      if (vid?.video_id && vid.video_id !== seen.lastVideoId) {
        if (seen.lastVideoId) {
          pushInAppNotif({ type: 'video', title: 'Nouvelle vidéo', body: String(vid.title || 'HugoTaSlot'), actionPage: 'news', actionLabel: 'Voir actualités' });
        }
        seen.lastVideoId = vid.video_id;
        changed = true;
      }
    } catch (_) {}
    try {
      const { data: slots } = await cloudCall('news', () => c.from('slot_releases').select('id,title,provider').order('published_at', { ascending: false }).limit(1), { retries: 0, timeoutMs: 8000, quiet: true });
      const slot = slots?.[0];
      if (slot?.id && String(slot.id) !== String(seen.lastSlotId)) {
        if (seen.lastSlotId) {
          pushInAppNotif({ type: 'slot', title: 'Nouvelle slot', body: `${slot.title || 'Slot'}${slot.provider ? ` · ${slot.provider}` : ''}`, actionPage: 'news', actionLabel: 'Voir actualités' });
        }
        seen.lastSlotId = slot.id;
        changed = true;
      }
    } catch (_) {}
  }
  if (isCloudUser() && typeof getDailyState === 'function') {
    const daily = getDailyState();
    const dayKey = String(typeof getDayIndex === 'function' ? getDayIndex() : '');
    if (daily?.canClaim && seen.lastDropReminderDay !== dayKey) {
      pushInAppNotif({ type: 'drop', title: 'Drop quotidien disponible', body: 'Récupère tes points dans le menu profil.', actionPage: 'jeux', actionLabel: 'Mini-jeux' });
      seen.lastDropReminderDay = dayKey;
      changed = true;
    }
  }
  if (isCloudUser() && currentUser?.id && c) {
    try {
      const { data: entries } = await cloudCall('profile', () => c.from('tournament_entries')
        .select('id,hunt_name,verified')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(10), { retries: 0, timeoutMs: 9000, quiet: true });
      seen.tournoi = seen.tournoi || {};
      (entries || []).forEach((e) => {
        const id = String(e.id);
        const prev = seen.tournoi[id];
        if (prev === false && e.verified) {
          pushInAppNotif({ type: 'tournoi', title: 'Tournoi validé', body: `${e.hunt_name || 'Ton hunt'} a été vérifié par l’admin.`, actionPage: 'hunt', actionLabel: 'Voir tournoi' });
        }
        seen.tournoi[id] = !!e.verified;
        changed = true;
      });
    } catch (_) {}
  }
  if (changed) saveNotifSeenState(seen);
  renderNotifBell();
}

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
function renderHomeHubMetrics() {
  const hunts = state.hunts || [];
  const huntCount = hunts.length;
  const bonusCount = hunts.reduce((a, h) => a + ((h.bonuses || []).length), 0);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const profitForWindow = (days) => hunts.reduce((acc, h) => {
    const created = Number(h.createdAt || 0);
    if (!created || (now - created) > (days * dayMs)) return acc;
    const startEur = Number(h.startBalanceEUR || toEUR(Number(h.startBalance || 0), h.currency || 'EUR'));
    const totalWin = (h.bonuses || []).reduce((w, b) => w + Number(b.win || 0), 0);
    const totalWinEur = toEUR(totalWin, h.currency || 'EUR');
    return acc + (totalWinEur - startEur);
  }, 0);
  const totalProfitEur = hunts.reduce((acc, h) => {
    const startEur = Number(h.startBalanceEUR || toEUR(Number(h.startBalance || 0), h.currency || 'EUR'));
    const totalWin = (h.bonuses || []).reduce((w, b) => w + Number(b.win || 0), 0);
    const totalWinEur = toEUR(totalWin, h.currency || 'EUR');
    return acc + (totalWinEur - startEur);
  }, 0);
  const p7 = profitForWindow(7);
  const p30 = profitForWindow(30);
  const eH = document.getElementById('home-kpi-hunts');
  const eB = document.getElementById('home-kpi-bonus');
  const eP = document.getElementById('home-kpi-profit');
  const eO = document.getElementById('home-kpi-online');
  const e7 = document.getElementById('home-kpi-profit-7d');
  const e30 = document.getElementById('home-kpi-profit-30d');
  if (eH) eH.textContent = String(huntCount);
  if (eB) eB.textContent = String(bonusCount);
  if (eP) {
    eP.textContent = fmt(totalProfitEur, 'EUR');
    eP.style.color = totalProfitEur >= 0 ? 'var(--green)' : 'var(--red)';
  }
  if (eO) eO.textContent = String(Math.max(1, onlineCount || 1));
  if (e7) { e7.textContent = fmt(p7, 'EUR'); e7.style.color = p7 >= 0 ? 'var(--green)' : 'var(--red)'; }
  if (e30) { e30.textContent = fmt(p30, 'EUR'); e30.style.color = p30 >= 0 ? 'var(--green)' : 'var(--red)'; }
}
// [core-ui] runGlobalSearch

// [updates] — extrait dans scripts/pages/updates.js (LAZY_PAGE_SCRIPTS)
// [review] — extrait dans scripts/pages/review.js (LAZY_PAGE_SCRIPTS)
function getOpenerKeybinds() {
  const p = getUiPrefs();
  return {
    confirm: p.openerConfirmKey || 'enter',
    prev: p.openerPrevKey || 'arrowleft',
    next: p.openerNextKey || 'arrowright'
  };
}
function openerKeyMatch(eventKey, expected) {
  return String(eventKey || '').toLowerCase() === String(expected || '').toLowerCase();
}
function triggerCinematicWin() {
  const gw = document.getElementById('game-window');
  if (!gw) return;
  gw.classList.remove('cinematic-win');
  gw.classList.remove('cinematic-shake');
  void gw.offsetWidth;
  gw.classList.add('cinematic-win');
  gw.classList.add('cinematic-shake');
  playJackpotBoost();
  setTimeout(() => {
    gw.classList.remove('cinematic-win');
    void gw.offsetWidth;
    gw.classList.add('cinematic-win');
    playJackpotBoost(0.72);
  }, 260);
  setTimeout(() => gw.classList.remove('cinematic-win'), 980);
  setTimeout(() => gw.classList.remove('cinematic-shake'), 430);
  triggerJackpotConfetti();
}
function triggerJackpotConfetti() {
  const layer = document.createElement('div');
  layer.className = 'jackpot-confetti';
  const colors = ['#00DC6E', '#00e676', '#ff4d6d', '#4db6ff', '#ffffff'];
  for (let i = 0; i < 72; i++) {
    const p = document.createElement('span');
    p.className = 'jackpot-piece';
    const w = 5 + Math.random() * 7;
    const h = 8 + Math.random() * 13;
    p.style.left = `${Math.random() * 100}%`;
    p.style.top = `${-8 - Math.random() * 22}px`;
    p.style.background = colors[Math.floor(Math.random() * colors.length)];
    p.style.animationDelay = `${Math.random() * 0.35}s`;
    p.style.setProperty('--w', `${w.toFixed(2)}px`);
    p.style.setProperty('--h', `${h.toFixed(2)}px`);
    p.style.setProperty('--dur', `${(0.95 + Math.random() * 0.95).toFixed(2)}s`);
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(p);
  }
  for (let i = 0; i < 28; i++) {
    const s = document.createElement('span');
    s.className = 'jackpot-spark';
    s.style.left = `${Math.random() * 100}%`;
    s.style.top = `${-6 - Math.random() * 18}px`;
    s.style.animationDelay = `${Math.random() * 0.2}s`;
    s.style.setProperty('--sdur', `${(0.85 + Math.random() * 0.9).toFixed(2)}s`);
    s.style.setProperty('--dx', `${(-16 + Math.random() * 32).toFixed(1)}px`);
    layer.appendChild(s);
  }
  document.body.appendChild(layer);
  setTimeout(() => layer.remove(), 2200);
}

// [admin] — extrait dans scripts/pages/admin.js (LAZY_PAGE_SCRIPTS)
// ─── BOUTON ENVOYER SUR SLOT (Opener) ───
document.getElementById('opener-send-slot').addEventListener('click', () => {
  const hunt = activeHunt();
  if (!hunt) return;
  const bonus = hunt.bonuses[state.openerIndex];
  if (!bonus) return;
  const slotName = bonus.slotName || '';
  const url = getBonusGoToUrl(hunt, bonus);
  window.open(url, '_blank');
  showToast(`Go to Slot: ${slotName} (${getCasinoLabel(hunt.casino)})`, 'info', 2500);
});

// Update send-slot button text in renderOpener (hook — après chargement lazy hunt-opener)
function applyHuntAppHooks() {
  if (applyHuntAppHooks._done) return;
  if (typeof renderOpener !== 'function') return;
  applyHuntAppHooks._done = true;
  const _origRenderOpener = renderOpener;
  renderOpener = function() {
    _origRenderOpener();
    const hunt = activeHunt();
    if (!hunt || !hunt.bonuses.length) return;
    const txt = document.getElementById('opener-send-slot-txt');
    if (txt) {
      txt.textContent = `GO TO SLOT · ${getCasinoLabel(hunt.casino).toUpperCase()}`;
    }
  };
}

// ─── GAMDOM FAB & POPUP ───
function toggleGamdomPopup() {
  const popup = document.getElementById('gamdom-popup');
  popup.classList.toggle('hidden');
  if (!popup.classList.contains('hidden')) {
    setTimeout(() => document.getElementById('gamdom-gain-input').focus(), 100);
  }
}

function confirmGamdomGain() {
  const val = parseFloat(document.getElementById('gamdom-gain-input').value);
  if (isNaN(val) || val < 0) { showToast('Entre un gain valide', 'error'); return; }
  const hunt = activeHunt();
  if (!hunt) { showToast('Sélectionne un hunt d\'abord', 'error'); return; }
  // Trouve le prochain bonus sans gain
  const next = hunt.bonuses.find(b => b.win === null);
  if (!next) { showToast('Tous les bonus ont déjà un gain', 'error'); return; }
  next.win = val;
  save();
  renderHuntWorkspace();
  document.getElementById('gamdom-gain-input').value = '';
  document.getElementById('gamdom-popup').classList.add('hidden');
  showToast(`Gain ${fmt(val)} enregistré pour ${next.slotName}`, 'success');
}

// [auth-cloud] — scripts/pages/auth-cloud.js (boot)

const PWA_INSTALL_DISMISS_KEY = 'hm_pwa_install_dismissed_v1';
let deferredPwaInstallPrompt = null;
function isPwaStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch (_) { return false; }
}
function initPwaInstallPrompt() {
  if (window.__hmPwaInitBound) return;
  window.__hmPwaInitBound = true;
  const banner = document.getElementById('pwa-install-banner');
  const btn = document.getElementById('pwa-install-btn');
  const dismiss = document.getElementById('pwa-install-dismiss');
  const showBanner = () => {
    if (!banner || isPwaStandalone()) return;
    if (localStorage.getItem(PWA_INSTALL_DISMISS_KEY) === '1') return;
    if (!deferredPwaInstallPrompt) return;
    banner.classList.remove('hidden');
  };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaInstallPrompt = e;
    showBanner();
  });
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPwaInstallPrompt) {
        showToast('Installation disponible depuis le menu du navigateur (Ajouter à l’écran d’accueil)', 'info', 3200);
        return;
      }
      deferredPwaInstallPrompt.prompt();
      try { await deferredPwaInstallPrompt.userChoice; } catch (_) {}
      deferredPwaInstallPrompt = null;
      if (banner) banner.classList.add('hidden');
    });
  }
  if (dismiss) {
    dismiss.addEventListener('click', () => {
      try { localStorage.setItem(PWA_INSTALL_DISMISS_KEY, '1'); } catch (_) {}
      if (banner) banner.classList.add('hidden');
    });
  }
  window.addEventListener('appinstalled', () => {
    deferredPwaInstallPrompt = null;
    if (banner) banner.classList.add('hidden');
    showToast('Application installée', 'success', 2200);
  });
  setTimeout(showBanner, 1200);
}
function trackPlayerGameStats(game, stake, payout) {
  const stats = ensurePlayerStatsReady();
  if (!stats) return;
  const gKey = STATS_GAMES.includes(game) ? game : 'blackjack';
  const st = stats.games[gKey] || { played: 0, wagered: 0, payout: 0, net: 0 };
  const stakeN = Math.max(0, Number(stake || 0));
  const payoutN = Math.max(0, Number(payout || 0));
  const netN = payoutN - stakeN;
  stats.rounds += 1;
  stats.wagered += stakeN;
  stats.payout += payoutN;
  stats.net += netN;
  st.played += 1;
  st.wagered += stakeN;
  st.payout += payoutN;
  st.net += netN;
  stats.games[gKey] = st;
  const d = new Date();
  const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = stats.daily[dayKey] || { wagered: 0, payout: 0, net: 0, rounds: 0, sessionsByHour: Array(24).fill(0) };
  day.wagered += stakeN;
  day.payout += payoutN;
  day.net += netN;
  day.rounds += 1;
  day.sessionsByHour[d.getHours()] = Math.max(0, Number(day.sessionsByHour[d.getHours()] || 0) + 1);
  stats.daily[dayKey] = day;
  stats.sessionsByHour[d.getHours()] = Math.max(0, Number(stats.sessionsByHour[d.getHours()] || 0) + 1);
  savePlayerStatsForScope(playerStatsScope, stats);
  bumpWeeklyObjectiveProgress(gKey);
  if (__activePage === 'stats' && typeof renderStatsPage === 'function') renderStatsPage();
}
// [stats] — extrait dans scripts/pages/stats.js (LAZY_PAGE_SCRIPTS)

// [jeux] — extrait dans scripts/pages/mini-jeux.js (LAZY_PAGE_SCRIPTS)

// ─── INIT v1.01 ───
// [page-router] initV101 — scripts/pages/page-router.js
function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

/**
 * Rafraîchissement silencieux du catalogue.
 * - Cache HTTP de jeux.json = 5 min (vercel.json) → re-fetch en arrière-plan utilise If-Modified-Since.
 * - Au focus de la page après > 5 min d'inactivité, on revérifie.
 * - Polling toutes les 30 min pour les onglets laissés ouverts.
 * - Si le catalogue a changé, on remplace state.slots et on re-rend la grille SANS interrompre l'UX.
 */
// [catalog-slots] refreshCatalogSilently / startCatalogAutoRefresh

window.addEventListener('DOMContentLoaded', () => {
  registerAppServiceWorker();
  startCatalogAutoRefresh();
  initSidebarNavA11y();
  initHuntHubTabs();
  initModalA11yObserver();
  updateCatalogModeHint();
  window.addEventListener('message', (ev) => {
    if (!ev?.data || ev.data.type !== 'hm-streamer-hud-close') return;
    setStreamerOverlayEnabled(false);
    const t = document.getElementById('opener-streamer-toggle');
    if (t) t.checked = false;
    closeStreamerHudWin();
  });
  if (!window.__hmPersistBalanceBound) {
    window.__hmPersistBalanceBound = true;
    const flushBalanceToDisk = () => {
      if (currentUser) saveSession(currentUser);
    };
    window.addEventListener('pagehide', flushBalanceToDisk);
    window.addEventListener('beforeunload', flushBalanceToDisk);
  }
  initV101()
    .then(() => {
      if (pendingAuthOpen) showAuth();
    })
    .catch((e) => {
      bhWarn('initV101 failed', e);
      pushRuntimeLog('error', `initV101: ${String(e?.message || e || 'unknown')}`);
    });
  renderMaintenanceBanner();
  if (!navigator.onLine) showNetBanner('Mode hors ligne: certaines fonctions cloud indisponibles.', true);
  window.addEventListener('offline', () => {
    pushRuntimeLog('warn', 'offline: connexion perdue');
    showNetBanner('Connexion perdue: mode hors ligne.', true);
  });
  window.addEventListener('online', () => {
    pushRuntimeLog('info', 'online: connexion rétablie');
    showNetBanner('Connexion rétablie.', false);
    setTimeout(hideNetBanner, 2000);
    handleConnectionRestored().catch((e) => {
      pushRuntimeLog('warn', `online_recovery_failed: ${String(e?.message || e || 'unknown')}`);
    });
  });
  window.addEventListener('error', (e) => {
    pushRuntimeLog('error', `js: ${String(e?.message || 'inconnue')}`);
    showNetBanner(`Erreur JS: ${String(e?.message || 'inconnue')}`, true);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e?.reason?.message || e?.reason || 'rejet non géré');
    pushRuntimeLog('error', `promise: ${msg}`);
    const low = msg.toLowerCase();
    const looksNetwork = /network|fetch|offline|timeout|cloud|supabase|failed to fetch|aborterror|circuit|http\s*\d{3}/i.test(low);
    if (looksNetwork) {
      showNetBanner('Erreur réseau/cloud détectée. Réessaie dans quelques secondes.', true);
    } else if (BH_DEBUG) {
      showNetBanner(`Erreur interne: ${msg.slice(0, 120)}`, true);
    }
    if (typeof e.preventDefault === 'function') e.preventDefault();
  });
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('button, .sidebar-tab, .game-card, .hunt-item, .row-action-btn, .open-btn, .modal-btn, .sidebar-btn') : null;
    if (el) playUiTone('click');
  });
  document.addEventListener('click', (e) => {
    if (Date.now() - Number(profileMenuJustOpenedAt || 0) < 260) return;
    const menu = document.getElementById('profile-menu');
    const wrap = document.getElementById('profile-wrap');
    const badge = e.target && e.target.closest ? e.target.closest('#profile-wrap .profile-badge') : null;
    if (badge) return;
    if (menu && !menu.classList.contains('hidden') && menu.contains(e.target)) return;
    if (profileMenuIsOpen) closeProfileMenu();
    else if (wrap && !wrap.contains(e.target) && menu && !menu.classList.contains('hidden')) closeProfileMenu();
  });
  window.addEventListener('resize', () => {
    const menu = document.getElementById('profile-menu');
    if (menu && !menu.classList.contains('hidden')) positionProfileMenu();
  });
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-panel');
    const wrap = document.getElementById('header-notif-wrap');
    if (!panel || panel.classList.contains('hidden')) return;
    if (wrap && wrap.contains(e.target)) return;
    panel.classList.add('hidden');
    const btn = document.getElementById('notif-bell-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('error', (e) => {
    const el = e?.target;
    if (!el || el.tagName !== 'IMG') return;
    const src = String(el.getAttribute('src') || '');
    if (src.includes('./assets/virtual-token.svg')) return;
    if (el.dataset && el.dataset.fallbackDone === '1') return;
    if (el.dataset) el.dataset.fallbackDone = '1';
    el.setAttribute('src', './assets/virtual-token.svg');
  }, true);
});


