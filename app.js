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
function isCloudUser() {
  return !!(currentUser && !currentUser.isGuest && currentUser.cloud && currentUser.id);
}

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

function huntFromCloudRow(h) {
  const bonuses = (h.hunt_bonuses || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(b => ({
    id: String(b.id),
    slotId: b.slot_id || '',
    slotName: b.slot_name || 'Slot',
    slotProvider: b.provider || '',
    slotImage: b.slot_image || '',
    stake: Number(b.bet || 0),
    bonusType: b.bonus_type || 'normal',
    gamdomUrl: b.gamdom_url || '',
    win: b.win_value === null || typeof b.win_value === 'undefined' ? null : Number(b.win_value)
  }));
  return {
    id: h.id,
    name: h.name,
    casino: getCasinoKey(h.casino || inferCasinoFromBonuses(h.hunt_bonuses)),
    currency: h.currency || 'EUR',
    startBalance: Number(h.starting_balance || 0),
    startBalanceEUR: Number(h.start_balance_eur ?? h.starting_balance ?? 0),
    createdAt: h.created_at ? Date.parse(h.created_at) : Date.now(),
    bonuses
  };
}

async function cloudLoadHunts() {
  const c = getAuthClient();
  if (!c || !currentUser?.id) throw new Error('cloud client not ready');
  const { data, error } = await cloudCall('sync', () => c
    .from('hunts')
    .select('id,name,currency,starting_balance,start_balance_eur,created_at,archived,hunt_bonuses(id,slot_id,slot_name,provider,slot_image,bet,win,win_value,bonus_type,sort_order,gamdom_url)')
    .eq('user_id', currentUser.id)
    .eq('archived', false)
    .order('created_at', { ascending: false }), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  return (data || []).map(huntFromCloudRow);
}

/**
 * Fusionne les hunts cloud et locaux pour ne JAMAIS écraser un gain saisi
 * localement (ex. ouverture en cours) si le serveur n'a pas encore ce gain.
 * Stratégie : on garde la structure cloud (ids/bonus ids officiels) mais on
 * ré-applique les `win` locaux quand ils sont plus complets.
 * Stratégie indices : on essaie d'apparier les bonus par (slotId, sort_order),
 * puis (slotName, position), puis position seule.
 */
/**
 * @param {Record<string,string>} [localIdRemap] — après sync, ancien id local → id cloud (évite les doublons si l’id local n’était pas un UUID)
 */
function mergeCloudHuntsPreservingLocalWins(cloudHunts, localHunts, localIdRemap) {
  const safeCloud = Array.isArray(cloudHunts) ? cloudHunts : [];
  const safeLocal = Array.isArray(localHunts) ? localHunts : [];
  if (!safeCloud.length) return safeLocal.slice();
  const localById = new Map(safeLocal.map((h) => [String(h.id || ''), h]));
  const merged = safeCloud.map((ch) => {
    const lh = localById.get(String(ch.id || ''));
    if (!lh || !Array.isArray(lh.bonuses) || !lh.bonuses.length) return ch;
    const localBonuses = lh.bonuses;
    const usedLocalIdx = new Set();
    const matchLocalForCloud = (cb, posIdx) => {
      const cId = String(cb.slotId || '').toLowerCase();
      const cName = String(cb.slotName || '').toLowerCase().trim();
      let candidate = -1;
      if (cId) {
        candidate = localBonuses.findIndex((lb, i) => !usedLocalIdx.has(i) && String(lb.slotId || '').toLowerCase() === cId);
      }
      if (candidate < 0 && cName) {
        candidate = localBonuses.findIndex((lb, i) => !usedLocalIdx.has(i) && String(lb.slotName || '').toLowerCase().trim() === cName);
      }
      if (candidate < 0 && posIdx < localBonuses.length && !usedLocalIdx.has(posIdx)) {
        candidate = posIdx;
      }
      if (candidate >= 0) usedLocalIdx.add(candidate);
      return candidate >= 0 ? localBonuses[candidate] : null;
    };
    const bonuses = (ch.bonuses || []).map((cb, idx) => {
      const lb = matchLocalForCloud(cb, idx);
      if (!lb) return cb;
      const cWin = cb.win;
      const lWin = lb.win;
      const cloudHasWin = cWin !== null && typeof cWin !== 'undefined' && !isNaN(Number(cWin));
      const localHasWin = lWin !== null && typeof lWin !== 'undefined' && !isNaN(Number(lWin));
      // Priorité : si le local a un gain et pas le cloud, on garde le local.
      // Si les deux ont un gain et qu'ils diffèrent, on garde le local (saisie utilisateur la plus récente).
      let resolvedWin = cWin;
      if (localHasWin && (!cloudHasWin || Number(lWin) !== Number(cWin))) {
        resolvedWin = Number(lWin);
      }
      return { ...cb, win: resolvedWin };
    });
    return { ...ch, bonuses };
  });
  // Garder les hunts locaux qui ne sont pas (encore) côté cloud.
  const cloudIds = new Set(safeCloud.map((h) => String(h.id || '')));
  const remappedLocalIds = new Set();
  if (localIdRemap && typeof localIdRemap === 'object') {
    for (const k of Object.keys(localIdRemap)) {
      const oldId = String(k);
      const newId = String(localIdRemap[k] || '');
      if (newId && newId !== oldId && cloudIds.has(newId)) remappedLocalIds.add(oldId);
    }
  }
  safeLocal.forEach((lh) => {
    const lid = String(lh.id || '');
    if (cloudIds.has(lid)) return;
    if (remappedLocalIds.has(lid)) return;
    merged.push(lh);
  });
  return merged;
}

let cloudSyncTimer = null;
let cloudSyncInFlight = false;
let cloudSyncRequested = false;
let cloudSyncFailureCount = 0;
let cloudSyncDisabled = false;
let cloudSyncLastErrSig = '';

function isMissingReplaceHuntsRpc(err) {
  const msg = String(err?.message || err?.details || err?.hint || err || '').toLowerCase();
  return msg.includes('replace_user_hunts') && (msg.includes('not find') || msg.includes('does not exist') || msg.includes('could not find'));
}

function scheduleCloudSync(immediate = false) {
  if (!isCloudUser() || cloudSyncDisabled) return;
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  const retryDelay = Math.min(12000, 900 * Math.max(1, cloudSyncFailureCount + 1));
  cloudSyncTimer = setTimeout(runCloudSync, immediate ? 0 : retryDelay);
}

async function runCloudSync() {
  if (!isCloudUser() || cloudSyncDisabled) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    scheduleCloudSync();
    return;
  }
  if (cloudSyncInFlight) { cloudSyncRequested = true; return; }
  cloudSyncInFlight = true;
  cloudSyncRequested = false;
  try {
    await cloudReplaceAllHunts(state.hunts);
    cloudSyncFailureCount = 0;
    cloudSyncLastErrSig = '';
    try { localStorage.setItem(LOCAL_SYNCED_KEY, '1'); } catch (_) {}
  } catch (e) {
    bhWarn('Cloud sync failed', e);
    pushRuntimeLog('error', `cloud sync: ${String(e?.message || e || 'unknown')}`);
    cloudSyncFailureCount++;
    const errSig = String(e?.message || e?.details || e?.hint || e || '').slice(0, 180);
    const shouldToast = cloudSyncFailureCount <= 2 || errSig !== cloudSyncLastErrSig;
    cloudSyncLastErrSig = errSig;
    if (isMissingReplaceHuntsRpc(e)) {
      cloudSyncDisabled = true;
      if (shouldToast) showToast('Sync cloud désactivée: RPC Supabase manquante (replace_user_hunts)', 'error', 5000);
    } else if (shouldToast) {
      showToast('Synchronisation cloud temporairement indisponible — données gardées en local', 'error', 3200);
    }
  } finally {
    cloudSyncInFlight = false;
    if (cloudSyncRequested && !cloudSyncDisabled) scheduleCloudSync(true);
  }
}

// Persistance transactionnelle des hunts via le RPC `replace_user_hunts`.
// L'opération est atomique côté serveur (un seul appel SQL) puis on recharge
// les hunts officielles pour récupérer les bonus IDs générés.
async function cloudReplaceAllHunts(localHunts) {
  const c = getAuthClient();
  if (!c || !currentUser?.id) throw new Error('cloud client not ready');

  const snapshot = JSON.parse(JSON.stringify(localHunts || []));
  const idMap = {};

  const huntsPayload = snapshot.map(hunt => {
    let cloudId = isUuidString(hunt.id) ? hunt.id : uuidLike();
    idMap[String(hunt.id)] = cloudId;
    const bonuses = (hunt.bonuses || []).map((b, i) => ({
      slot_id: b.slotId ? String(b.slotId) : '',
      slot_name: b.slotName || 'Slot',
      provider: b.slotProvider || '',
      slot_image: b.slotImage || '',
      bet: Number(b.stake || 0),
      win: b.win === null || typeof b.win === 'undefined' ? 0 : Number(b.win),
      win_value: b.win === null || typeof b.win === 'undefined' ? null : Number(b.win),
      bonus_type: b.bonusType || 'normal',
      gamdom_url: b.gamdomUrl || '',
      sort_order: i + 1
    }));
    return {
      id: cloudId,
      name: hunt.name || 'Hunt',
      currency: hunt.currency || 'EUR',
      starting_balance: Number(hunt.startBalance || 0) || 0.01,
      start_balance_eur: Number(hunt.startBalanceEUR || hunt.startBalance || 0),
      archived: false,
      created_at: hunt.createdAt ? new Date(hunt.createdAt).toISOString() : null,
      bonuses
    };
  });

  const { error: rpcErr } = await withTimeout(
    () => c.rpc('replace_user_hunts', { p_hunts: huntsPayload }),
    20000
  );
  if (rpcErr) {
    // Fallback robuste: certains environnements n'ont pas encore la RPC.
    if (isMissingReplaceHuntsRpc(rpcErr)) {
      await cloudReplaceAllHuntsFallback(c, huntsPayload);
    } else {
      throw rpcErr;
    }
  }

  // Recharge la source de vérité (avec les IDs bigint des bonuses).
  const fresh = await cloudLoadHunts();
  // Fusion défensive : si le serveur a perdu un win (latence/RPC), on garde la version locale.
  state.hunts = mergeCloudHuntsPreservingLocalWins(fresh, snapshot, idMap);

  if (state.activeHuntId && idMap[String(state.activeHuntId)]) {
    state.activeHuntId = idMap[String(state.activeHuntId)];
  }
  if (state.activeHuntId && !state.hunts.find(h => h.id === state.activeHuntId)) {
    state.activeHuntId = null;
  }

  writeLocalCache();
  return idMap;
}

async function cloudReplaceAllHuntsFallback(c, huntsPayload) {
  const payload = Array.isArray(huntsPayload) ? huntsPayload : [];
  const keepIds = payload.map((h) => String(h.id));

  // 1) Upsert des hunts (payload minimal compatible anciens schémas)
  const huntRows = payload.map((h) => ({
    id: h.id,
    user_id: currentUser.id,
    name: h.name || 'Hunt',
    currency: h.currency || 'EUR',
    starting_balance: Number(h.starting_balance || 0) || 0.01
  }));
  if (huntRows.length) {
    const { error } = await withTimeout(
      () => c.from('hunts').upsert(huntRows, { onConflict: 'id' }),
      20000
    );
    if (error) throw error;
  }

  // 2) Supprime les hunts retirés côté local
  const { data: existing, error: existingErr } = await withTimeout(
    () => c.from('hunts').select('id').eq('user_id', currentUser.id).eq('archived', false),
    12000
  );
  if (existingErr) throw existingErr;
  const toDelete = (existing || []).map((r) => String(r.id)).filter((id) => !keepIds.includes(id));
  for (const huntId of toDelete) {
    const { error } = await withTimeout(() => c.from('hunts').delete().eq('id', huntId), 12000);
    if (error) throw error;
  }

  // 3) Remplace les bonus pour chaque hunt (delete + insert ordonné, minimal)
  for (const h of payload) {
    const huntId = String(h.id);
    const { error: delErr } = await withTimeout(() => c.from('hunt_bonuses').delete().eq('hunt_id', huntId), 15000);
    if (delErr) throw delErr;
    const rows = (h.bonuses || []).map((b, i) => ({
      hunt_id: huntId,
      slot_name: b.slot_name || 'Slot',
      provider: b.provider || '',
      bet: Number(b.bet || 0) || 0.01,
      win: b.win === null || typeof b.win === 'undefined' ? 0 : Number(b.win),
      bonus_type: b.bonus_type || 'normal',
      sort_order: Number(b.sort_order || (i + 1))
    }));
    if (rows.length) {
      const { error: insErr } = await withTimeout(() => c.from('hunt_bonuses').insert(rows), 20000);
      if (insErr) throw insErr;
    }
  }
}

function writeLocalCache() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      hunts: state.hunts,
      activeHuntId: state.activeHuntId,
      catalogMode: state.catalogMode,
      bonusView: state.bonusView
    }));
  } catch (e) { bhWarn('LocalStorage save failed', e); }
}

function save() {
  writeLocalCache();
  createAutoSnapshot('save');
  if (isCloudUser()) {
    try { localStorage.setItem(LOCAL_SYNCED_KEY, '0'); } catch (_) {}
    scheduleCloudSync();
    schedulePublicHuntLivePublish();
  }
}

function applyHistorySnapshot(snapshot) {
  state.hunts = JSON.parse(JSON.stringify(snapshot?.hunts || []));
  state.activeHuntId = snapshot?.activeHuntId || null;
  save();
  renderHuntList();
  if (state.activeHuntId) {
    const exists = state.hunts.find((h) => h.id === state.activeHuntId);
    if (exists) {
      document.getElementById('no-hunt-selected').style.display = 'none';
      document.getElementById('hunt-workspace').classList.remove('hidden');
      renderHuntWorkspace();
      return;
    }
  }
  document.getElementById('hunt-workspace').classList.add('hidden');
  document.getElementById('no-hunt-selected').style.display = 'flex';
  updateHeaderStats(null);
}

function setUndoSnapshot(reason = '') {
  undoStack.push({
    reason,
    hunts: JSON.parse(JSON.stringify(state.hunts)),
    activeHuntId: state.activeHuntId
  });
  if (undoStack.length > HISTORY_STACK_LIMIT) undoStack = undoStack.slice(-HISTORY_STACK_LIMIT);
  redoStack = [];
}

function runUndo() {
  if (!requireWriteAccess('Undo bloqué')) return;
  if (!undoStack.length) { showToast('Aucune action à annuler', 'info'); return; }
  const prev = undoStack.pop();
  redoStack.push({
    reason: 'redo',
    hunts: JSON.parse(JSON.stringify(state.hunts)),
    activeHuntId: state.activeHuntId
  });
  if (redoStack.length > HISTORY_STACK_LIMIT) redoStack = redoStack.slice(-HISTORY_STACK_LIMIT);
  applyHistorySnapshot(prev);
  showToast(`Action annulée${prev.reason ? ` (${prev.reason})` : ''}`, 'success');
}
function runRedo() {
  if (!requireWriteAccess('Redo bloqué')) return;
  if (!redoStack.length) { showToast('Aucune action à rétablir', 'info'); return; }
  const next = redoStack.pop();
  undoStack.push({
    reason: 'undo',
    hunts: JSON.parse(JSON.stringify(state.hunts)),
    activeHuntId: state.activeHuntId
  });
  if (undoStack.length > HISTORY_STACK_LIMIT) undoStack = undoStack.slice(-HISTORY_STACK_LIMIT);
  applyHistorySnapshot(next);
  showToast('Action rétablie', 'success');
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    state.hunts = d.hunts || [];
    state.activeHuntId = d.activeHuntId || null;
    state.catalogMode = d.catalogMode === 'extended' ? 'extended' : 'gamdom';
    state.bonusView = {
      status: 'all',
      type: 'all',
      winFilter: 'all',
      sort: 'order',
      q: '',
      provider: '',
      minStake: '',
      maxStake: '',
      ...(d.bonusView || {})
    };
  } catch(e) { state.hunts = []; state.activeHuntId = null; }
}

let __loadInFlight = null;
async function load() {
  if (__loadInFlight) return __loadInFlight;
  __loadInFlight = (async () => {
  loadLocal();

  const applyBonusDedupeAfterLoad = () => {
    const r = dedupeAllHuntsBonuses();
    if (r > 0) {
      save();
      showToast(`${r} bonus en double retirés (même machine)`, 'info', 4500);
    }
  };

  if (!isCloudUser()) {
    applyBonusDedupeAfterLoad();
    return;
  }

  let isSynced = false;
  try { isSynced = localStorage.getItem(LOCAL_SYNCED_KEY) === '1'; } catch (_) {}

  if (!isSynced && Array.isArray(state.hunts) && state.hunts.length > 0) {
    try {
      await cloudReplaceAllHunts(state.hunts);
      try { localStorage.setItem(LOCAL_SYNCED_KEY, '1'); } catch (_) {}
      showToast(`${state.hunts.length} hunt(s) local(aux) migré(s) vers ton compte cloud`, 'success', 3500);
    } catch (e) {
      bhWarn('Initial cloud migration failed', e);
      if (isMissingReplaceHuntsRpc(e)) {
        cloudSyncDisabled = true;
        showToast('Sync cloud inactive: RPC replace_user_hunts absente dans Supabase', 'error', 5000);
      } else {
        showToast('Migration cloud échouée — les hunts restent en local', 'error', 4000);
      }
      applyBonusDedupeAfterLoad();
      return;
    }
  }

  try {
    const localSnapshot = JSON.parse(JSON.stringify(state.hunts || []));
    const cloudHunts = await cloudLoadHunts();
    state.hunts = mergeCloudHuntsPreservingLocalWins(cloudHunts, localSnapshot);
    if (state.activeHuntId && !state.hunts.find(h => h.id === state.activeHuntId)) {
      state.activeHuntId = state.hunts[0]?.id || null;
    } else if (!state.activeHuntId && state.hunts.length) {
      state.activeHuntId = state.hunts[0].id;
    }
    writeLocalCache();
    try { localStorage.setItem(LOCAL_SYNCED_KEY, '1'); } catch (_) {}
  } catch (e) {
    bhWarn('Cloud load failed, using local cache', e);
  }
  applyBonusDedupeAfterLoad();
  })();
  try {
    return await __loadInFlight;
  } finally {
    __loadInFlight = null;
  }
}

// ═══════════════════════════════════════════════
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

let uiAudioCtx = null;
let __sfxNoiseBuf = null;

// ─── MOTEUR AUDIO CASINO ───
// Sons synthétisés en WebAudio (aucun fichier externe) : jetons, cartes,
// roulette, pièces, explosions, fanfares de gain. Volume contrôlé par les
// préférences utilisateur (uiVolume × uiGameVolume, mute respecté).
function __sfxCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!uiAudioCtx) uiAudioCtx = new AC();
  if (uiAudioCtx.state === 'suspended') uiAudioCtx.resume();
  const prefs = getUiPrefs();
  if (prefs.uiMuted) return null;
  const vol = Math.max(0, Math.min(1, (Number(prefs.uiVolume ?? 70) / 100)))
    * Math.max(0, Math.min(1, (Number(prefs.uiGameVolume ?? 85) / 100)));
  if (vol <= 0) return null;
  if (!__sfxNoiseBuf) {
    const len = uiAudioCtx.sampleRate * 1.2;
    __sfxNoiseBuf = uiAudioCtx.createBuffer(1, len, uiAudioCtx.sampleRate);
    const d = __sfxNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return { ctx: uiAudioCtx, vol, now: uiAudioCtx.currentTime };
}
function __sfxNoise(env, { at = 0, dur = 0.1, hp = 0, lp = 20000, peak = 0.05, attack = 0.005 } = {}) {
  const { ctx, vol, now } = env;
  const src = ctx.createBufferSource();
  src.buffer = __sfxNoiseBuf;
  src.loop = true;
  let node = src;
  if (hp > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
  if (lp < 20000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now + at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vol), now + at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
  node.connect(g); g.connect(ctx.destination);
  src.start(now + at, Math.random() * 0.5); src.stop(now + at + dur + 0.03);
  return node;
}
function __sfxTone(env, { at = 0, f0 = 440, f1 = 0, dur = 0.12, type = 'sine', peak = 0.05, attack = 0.008 } = {}) {
  const { ctx, vol, now } = env;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f0), now + at);
  if (f1 > 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + at + dur);
  g.gain.setValueAtTime(0.0001, now + at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vol), now + at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(now + at); o.stop(now + at + dur + 0.03);
}
function __sfxBell(env, { at = 0, freq = 880, dur = 0.5, peak = 0.05 } = {}) {
  // Cloche : fondamentale + partiel inharmonique ×2.76 (timbre métallique)
  __sfxTone(env, { at, f0: freq, dur, type: 'sine', peak, attack: 0.004 });
  __sfxTone(env, { at, f0: freq * 2.76, dur: dur * 0.55, type: 'sine', peak: peak * 0.32, attack: 0.004 });
}
function casinoSfx(type, opt = {}) {
  try {
    const env = __sfxCtx();
    if (!env) return;
    const p = Math.max(0.4, Math.min(2.4, Number(opt.pitch || 1)));
    switch (type) {
      case 'chip': {
        // Clac céramique : double claquement bref filtré
        __sfxNoise(env, { dur: 0.028, hp: 2200, lp: 9000, peak: 0.075, attack: 0.002 });
        __sfxTone(env, { f0: 2300 * p, f1: 1700 * p, dur: 0.03, type: 'square', peak: 0.022, attack: 0.002 });
        __sfxNoise(env, { at: 0.035, dur: 0.022, hp: 2600, lp: 9500, peak: 0.05, attack: 0.002 });
        break;
      }
      case 'chips': {
        for (let i = 0; i < 4; i++) {
          __sfxNoise(env, { at: i * 0.038, dur: 0.026, hp: 2100 + i * 220, lp: 9200, peak: 0.06, attack: 0.002 });
        }
        break;
      }
      case 'card': {
        // Glissé de carte + snap final
        __sfxNoise(env, { dur: 0.1, hp: 700, lp: 4200, peak: 0.045, attack: 0.03 });
        __sfxNoise(env, { at: 0.085, dur: 0.018, hp: 1400, lp: 7000, peak: 0.065, attack: 0.002 });
        break;
      }
      case 'flip': {
        __sfxNoise(env, { dur: 0.07, hp: 900, lp: 5200, peak: 0.045, attack: 0.015 });
        __sfxTone(env, { at: 0.06, f0: 480 * p, f1: 300 * p, dur: 0.05, type: 'triangle', peak: 0.03 });
        break;
      }
      case 'spin': {
        // Lancer de roue : souffle qui monte puis retombe
        __sfxNoise(env, { dur: 0.55, hp: 380, lp: 2600, peak: 0.05, attack: 0.16 });
        __sfxTone(env, { f0: 160, f1: 90, dur: 0.5, type: 'sine', peak: 0.02, attack: 0.1 });
        break;
      }
      case 'tick': {
        __sfxTone(env, { f0: 1900 * p, dur: 0.014, type: 'square', peak: 0.018, attack: 0.001 });
        break;
      }
      case 'ball': {
        // Bille qui retombe : tic-tic-toc amorti
        __sfxTone(env, { f0: 2300, dur: 0.018, type: 'square', peak: 0.03, attack: 0.001 });
        __sfxTone(env, { at: 0.09, f0: 2100, dur: 0.016, type: 'square', peak: 0.024, attack: 0.001 });
        __sfxTone(env, { at: 0.165, f0: 1900, dur: 0.015, type: 'square', peak: 0.018, attack: 0.001 });
        __sfxNoise(env, { at: 0.22, dur: 0.05, hp: 1200, lp: 6000, peak: 0.035, attack: 0.004 });
        break;
      }
      case 'pop': {
        __sfxTone(env, { f0: (560 + Math.random() * 240) * p, f1: 320 * p, dur: 0.045, type: 'sine', peak: 0.045, attack: 0.002 });
        break;
      }
      case 'coin': {
        const f = (1700 + Math.random() * 900) * p;
        __sfxBell(env, { freq: f, dur: 0.22, peak: 0.035 });
        break;
      }
      case 'cashout': {
        // Cha-ching : double cloche + pluie de pièces
        __sfxBell(env, { freq: 1567, dur: 0.4, peak: 0.05 });
        __sfxBell(env, { at: 0.07, freq: 1975, dur: 0.45, peak: 0.045 });
        for (let i = 0; i < 4; i++) {
          __sfxBell(env, { at: 0.12 + i * 0.06, freq: 1900 + Math.random() * 1300, dur: 0.16, peak: 0.02 });
        }
        break;
      }
      case 'win': {
        // Arpège majeur ascendant + shimmer
        const notes = [880, 1108.7, 1318.5, 1760];
        notes.forEach((f, i) => __sfxBell(env, { at: i * 0.075, freq: f, dur: 0.42, peak: 0.045 }));
        __sfxNoise(env, { at: 0.05, dur: 0.45, hp: 6500, lp: 12000, peak: 0.018, attack: 0.1 });
        for (let i = 0; i < 5; i++) {
          __sfxBell(env, { at: 0.18 + i * 0.07, freq: 1800 + Math.random() * 1500, dur: 0.15, peak: 0.016 });
        }
        break;
      }
      case 'bigwin': {
        // Fanfare : double arpège + sub + averse de pièces
        __sfxTone(env, { f0: 80, f1: 50, dur: 0.4, type: 'sine', peak: 0.07, attack: 0.01 });
        const arp1 = [659.3, 830.6, 987.8, 1318.5];
        const arp2 = [880, 1108.7, 1318.5, 1760];
        arp1.forEach((f, i) => __sfxBell(env, { at: i * 0.085, freq: f, dur: 0.5, peak: 0.05 }));
        arp2.forEach((f, i) => __sfxBell(env, { at: 0.34 + i * 0.085, freq: f, dur: 0.6, peak: 0.05 }));
        for (let i = 0; i < 12; i++) {
          __sfxBell(env, { at: 0.3 + i * 0.075, freq: 1600 + Math.random() * 2200, dur: 0.18, peak: 0.018 });
        }
        __sfxNoise(env, { at: 0.25, dur: 0.9, hp: 7000, lp: 13000, peak: 0.02, attack: 0.2 });
        break;
      }
      case 'lose': {
        // Descente molle + thud sourd
        __sfxTone(env, { f0: 220, f1: 116, dur: 0.32, type: 'triangle', peak: 0.035, attack: 0.01 });
        __sfxNoise(env, { dur: 0.12, lp: 320, peak: 0.05, attack: 0.004 });
        break;
      }
      case 'boom': {
        // Explosion : burst grave + sub qui plonge
        __sfxNoise(env, { dur: 0.42, lp: 900, peak: 0.12, attack: 0.003 });
        __sfxNoise(env, { dur: 0.14, hp: 800, lp: 4500, peak: 0.06, attack: 0.002 });
        __sfxTone(env, { f0: 95, f1: 32, dur: 0.45, type: 'sine', peak: 0.09, attack: 0.004 });
        break;
      }
      case 'rocket': {
        __sfxTone(env, { f0: 130 * p, f1: 520 * p, dur: 0.5, type: 'sawtooth', peak: 0.018, attack: 0.06 });
        __sfxNoise(env, { dur: 0.5, hp: 300, lp: 1800, peak: 0.025, attack: 0.1 });
        break;
      }
      default: {
        __sfxTone(env, { f0: 600, dur: 0.05, type: 'sine', peak: 0.03 });
      }
    }
  } catch (_) {}
}
// Compat : ancien point d'entrée conservé, mappé sur le moteur casino
function playGameSfx(gameId, phase = 'start') {
  if (phase === 'win') casinoSfx('win');
  else if (phase === 'lose') casinoSfx('lose');
  else casinoSfx(gameId === 'roulette' ? 'spin' : 'card');
}

// ─── CÉLÉBRATION DE GAIN (overlay animé dans la fenêtre de jeu) ───
function gameWinFx(prize, mult) {
  try {
    const amount = Number(prize || 0);
    if (amount <= 0) return;
    const m = Number(mult || 0);
    const big = m >= 10 || amount >= 100;
    const host = document.getElementById('game-window');
    if (!host || host.classList.contains('hidden')) return;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fx = document.createElement('div');
    fx.className = 'game-win-fx' + (big ? ' big' : '');
    let coins = '';
    if (!reduced) {
      const n = big ? 26 : 14;
      for (let i = 0; i < n; i++) {
        const x = (Math.random() * 320 - 160).toFixed(0);
        const y = (-(120 + Math.random() * 220)).toFixed(0);
        const d = (Math.random() * 0.25).toFixed(2);
        const s = (0.6 + Math.random() * 0.9).toFixed(2);
        coins += `<span class="game-win-coin" style="--cx:${x}px;--cy:${y}px;--cd:${d}s;--cs:${s}"></span>`;
      }
    }
    fx.innerHTML = `
      ${big ? '<div class="game-win-banner">BIG WIN</div>' : ''}
      <div class="game-win-amount">+${fmt(amount)}</div>
      ${m > 1 ? `<div class="game-win-mult">×${m.toFixed(2)}</div>` : ''}
      <div class="game-win-coins">${coins}</div>`;
    host.appendChild(fx);
    const bal = document.getElementById('game-window-balance');
    if (bal) { bal.classList.remove('balance-pulse'); void bal.offsetWidth; bal.classList.add('balance-pulse'); }
    setTimeout(() => { try { fx.remove(); } catch (_) {} }, big ? 2300 : 1700);
  } catch (_) {}
}
function playUiTone(kind = 'click') {
  try {
    const prefs = getUiPrefs();
    if (prefs.uiSound === false) return;
    if (prefs.uiMuted) return;
    const volume = Math.max(0, Math.min(1, (Number(prefs.uiVolume ?? 70) / 100)));
    const gameVolume = Math.max(0, Math.min(1, (Number(prefs.uiGameVolume ?? 85) / 100)));
    const finalVolume = volume * gameVolume;
    if (finalVolume <= 0) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!uiAudioCtx) uiAudioCtx = new AC();
    if (uiAudioCtx.state === 'suspended') uiAudioCtx.resume();

    const now = uiAudioCtx.currentTime;
    const osc = uiAudioCtx.createOscillator();
    const gain = uiAudioCtx.createGain();
    osc.type = kind === 'success' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(kind === 'success' ? 620 : 420, now);
    if (kind === 'success') osc.frequency.exponentialRampToValueAtTime(780, now + 0.07);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.028 * finalVolume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'success' ? 0.13 : 0.07));
    osc.connect(gain);
    gain.connect(uiAudioCtx.destination);
    osc.start(now);
    osc.stop(now + (kind === 'success' ? 0.14 : 0.08));
  } catch {}
}

function showToast(msg, type = 'info', ms = 2600) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  if (type === 'success') playUiTone('success');
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, ms);
}

function confirm(title, msg) {
  return new Promise(resolve => {
    const o = document.getElementById('confirm-overlay');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    o.classList.remove('hidden');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    const done = (v) => { o.classList.add('hidden'); ok.onclick = null; cancel.onclick = null; resolve(v); };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
  });
}
function confirmRich(title, html, okText = 'CONFIRMER', cancelText = 'ANNULER') {
  return new Promise(resolve => {
    const o = document.getElementById('confirm-overlay');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-msg');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.innerHTML = html;
    if (ok) ok.textContent = okText;
    if (cancel) cancel.textContent = cancelText;
    o.classList.remove('hidden');
    const done = (v) => {
      o.classList.add('hidden');
      if (ok) { ok.onclick = null; ok.textContent = 'SUPPRIMER'; }
      if (cancel) { cancel.onclick = null; cancel.textContent = 'ANNULER'; }
      if (msgEl) msgEl.innerHTML = '';
      resolve(v);
    };
    if (ok) ok.onclick = () => done(true);
    if (cancel) cancel.onclick = () => done(false);
  });
}

// ═══════════════════════════════════════════════
//  LOAD SLOTS (with fallback & lazy render)
// ═══════════════════════════════════════════════
let currentPage = 0;
const PAGE_SIZE = 64;
let catalogScrollDebounce = null;
let bonusFilterDebounce = null;
let huntListFilterDebounce = null;
let __huntUiTimer = null;
let __huntUiPending = null;
let __bonusProviderHash = '';
const __detachedPanels = Object.create(null);

function slotGamdomEligible(s) {
  const id = String(s.id || s.Id || '').toLowerCase();
  const url = String(s.gamdomUrl || s.gamdom_url || '').toLowerCase();
  const img = String(s.image || s.img || s.thumbnail || '').toLowerCase();
  return id.startsWith('gd_')
    || id.startsWith('stake_')
    || url.includes('gamdom.com')
    || url.includes('stake.com/casino/games/')
    || img.includes('cdn.hub88.io')
    || img.includes('ppgames.net')
    || img.includes('thumbs.alea.com')
    || img.includes('gamdom.com/static/dyn/');
}

function buildSlotCatalogIndexes(slots) {
  state.searchIndex = [];
  state.slotMeta = [];
  state.slotRefIndex = new Map();
  state.gamdomSlotIndices = [];
  const providerCounts = new Map();
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i] || {};
    const nom = (s.nom || s.name || s.title || s.Name || '').toLowerCase();
    const provRaw = (s.provider || s.Provider || '');
    const prov = String(provRaw).toLowerCase();
    const gamdomEligible = slotGamdomEligible(s);
    state.searchIndex.push({ nom, prov });
    state.slotMeta.push({ gamdomEligible });
    state.slotRefIndex.set(slots[i], i);
    if (gamdomEligible) state.gamdomSlotIndices.push(i);
    if (provRaw) providerCounts.set(provRaw, (providerCounts.get(provRaw) || 0) + 1);
  }
  return providerCounts;
}

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

function stashPageMount() {
  const mount = document.getElementById('page-mount');
  if (!mount || !mount.firstElementChild) return;
  const panel = mount.firstElementChild;
  const cacheKey = panel.id === 'page-jeux' ? 'jeux' : null;
  if (cacheKey) {
    __detachedPanels[cacheKey] = panel;
    mount.removeChild(panel);
  } else {
    mount.innerHTML = '';
  }
}

function mountCachedPage(page) {
  const mount = document.getElementById('page-mount');
  if (!mount || !__PAGE_HTML[page]) return null;
  if (__detachedPanels[page]) {
    mount.innerHTML = '';
    mount.appendChild(__detachedPanels[page]);
    delete __detachedPanels[page];
    const panel = mount.firstElementChild;
    if (panel) panel.classList.add('active');
    return panel;
  }
  mount.innerHTML = __PAGE_HTML[page];
  const panel = mount.firstElementChild;
  if (panel) panel.classList.add('active', 'anim-in');
  setTimeout(() => panel?.classList.remove('anim-in'), 320);
  return panel;
}
let netBannerEl = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function withTimeout(promiseFactory, timeoutMs = 9000) {
  let to = null;
  const timeout = new Promise((_, reject) => {
    to = setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promiseFactory(), timeout]);
  } finally {
    clearTimeout(to);
  }
}
const cloudCircuit = {
  auth: { failures: 0, openUntil: 0, lastSig: '' },
  profile: { failures: 0, openUntil: 0, lastSig: '' },
  admin: { failures: 0, openUntil: 0, lastSig: '' },
  sync: { failures: 0, openUntil: 0, lastSig: '' }
};
function getCircuitState(bucket = 'sync') {
  if (!cloudCircuit[bucket]) cloudCircuit[bucket] = { failures: 0, openUntil: 0, lastSig: '' };
  return cloudCircuit[bucket];
}
function markCircuitFailure(bucket = 'sync', err) {
  const c = getCircuitState(bucket);
  c.failures += 1;
  const ms = Math.min(30000, 1200 * Math.max(1, c.failures));
  c.openUntil = Date.now() + ms;
  c.lastSig = String(err?.message || err?.details || err?.hint || err || '').slice(0, 180);
  return c;
}
function markCircuitSuccess(bucket = 'sync') {
  const c = getCircuitState(bucket);
  c.failures = 0;
  c.openUntil = 0;
  c.lastSig = '';
}
async function cloudCall(bucket, fn, {
  retries = 1,
  timeoutMs = 12000,
  delayMs = 400,
  quiet = false,
  fallback = null
} = {}) {
  const c = getCircuitState(bucket);
  const now = Date.now();
  if (c.openUntil > now) {
    if (typeof fallback === 'function') return await fallback();
    throw new Error(`Circuit ${bucket} ouvert (${Math.ceil((c.openUntil - now) / 1000)}s)`);
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!quiet) showNetBanner('Mode hors ligne: appels cloud en attente', true);
    if (typeof fallback === 'function') return await fallback();
    throw new Error('Offline');
  }
  try {
    const out = await retryAsync(() => withTimeout(fn, timeoutMs), { retries, delayMs });
    markCircuitSuccess(bucket);
    if (!quiet) hideNetBanner();
    return out;
  } catch (err) {
    const prevSig = c.lastSig;
    const next = markCircuitFailure(bucket, err);
    if (!quiet && (next.failures <= 2 || next.lastSig !== prevSig)) {
      showNetBanner(`Réseau cloud instable (${bucket})`, true);
    }
    if (typeof fallback === 'function') return await fallback();
    throw err;
  }
}
function getCloudUiStatus() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { key: 'offline', label: 'OFFLINE', color: '#ff9fb1', detail: 'Connexion perdue' };
  }
  if (cloudSyncDisabled) {
    return { key: 'degraded', label: 'DEGRADE', color: '#ffd38a', detail: 'Sync cloud partielle (fallback local)' };
  }
  const buckets = ['auth', 'profile', 'admin', 'sync'];
  const opened = buckets.some((b) => getCircuitState(b).openUntil > Date.now());
  if (opened || supaHealth.db === 'degraded' || supaHealth.auth === 'down' || supaHealth.client === 'down') {
    return { key: 'degraded', label: 'DEGRADE', color: '#ffd38a', detail: 'Cloud instable, retries actifs' };
  }
  return { key: 'online', label: 'ONLINE', color: '#8fffc3', detail: 'Cloud stable' };
}
async function handleConnectionRestored() {
  if (!isCloudUser()) return;
  markCircuitSuccess('auth');
  markCircuitSuccess('profile');
  markCircuitSuccess('admin');
  markCircuitSuccess('sync');
  invalidateCache('admin');
  if (currentUser?.id) invalidateCache('profile', String(currentUser.id));
  try {
    await runSupabaseHealthCheck(true);
  } catch (_) {}
  try {
    await loadCloudProfile(currentUser.id, { force: true });
  } catch (_) {}
  try {
    if (!cloudSyncDisabled) scheduleCloudSync(true);
  } catch (_) {}
  if (__activePage === 'admin') {
    renderAdminPanel().catch(() => {});
  }
  flushFeedbackQueue().catch(() => {});
}
async function retryAsync(fn, { retries = 2, delayMs = 380 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}
async function fetchJSONWithRetry(url, { retries = 2, timeoutMs = 9000 } = {}) {
  return retryAsync(async () => {
    const r = await withTimeout(() => fetch(url), timeoutMs);
    if (!r.ok) throw new Error(`HTTP ${r.status} ${url}`);
    return r.json();
  }, { retries, delayMs: 300 });
}
function showNetBanner(text, bad = false) {
  if (!netBannerEl) {
    netBannerEl = document.createElement('div');
    netBannerEl.id = 'net-banner';
    netBannerEl.style.cssText = 'position:fixed;left:14px;bottom:14px;z-index:3000;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);font-family:"Share Tech Mono",monospace;font-size:11px;background:#0A0A0C;color:#EDEEF2;box-shadow:0 10px 24px rgba(0,0,0,0.35)';
    document.body.appendChild(netBannerEl);
  }
  netBannerEl.textContent = text;
  netBannerEl.style.borderColor = bad ? 'rgba(255,61,90,0.45)' : 'rgba(0,230,118,0.42)';
  netBannerEl.style.color = bad ? '#ff9fb1' : '#91ffd0';
  netBannerEl.style.display = 'block';
}
function hideNetBanner() {
  if (netBannerEl) netBannerEl.style.display = 'none';
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
let lastOpsAlertAt = 0;
let lastSnapshotAt = 0;
let undoStack = [];
let redoStack = [];
const HISTORY_STACK_LIMIT = 40;
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
const MAINTENANCE_DEFAULT = { enabled: false, message: 'Maintenance en cours. Mode lecture seule temporaire.' };
let maintenanceCache = { ...MAINTENANCE_DEFAULT, fetchedAt: 0, source: 'default' };
const MAINTENANCE_POLL_MS = 60000;
let maintenancePollTimer = null;

function normalizeMaintenanceConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: !!(src.enabled ?? src.active),
    message: String(src.message || MAINTENANCE_DEFAULT.message).slice(0, 220)
  };
}
function getMaintenanceConfig() {
  return normalizeMaintenanceConfig(maintenanceCache);
}
async function refreshMaintenanceConfig(force = false) {
  const now = Date.now();
  if (!force && maintenanceCache.fetchedAt && (now - maintenanceCache.fetchedAt) < MAINTENANCE_POLL_MS) {
    return getMaintenanceConfig();
  }
  const c = getAuthClient();
  if (!c) {
    if (!maintenanceCache.fetchedAt) {
      maintenanceCache = { ...MAINTENANCE_DEFAULT, fetchedAt: now, source: 'offline' };
    }
    return getMaintenanceConfig();
  }
  try {
    const { data, error } = await cloudCall('sync', () => c.rpc('get_site_maintenance'), {
      retries: 1,
      timeoutMs: 8000,
      delayMs: 300,
      quiet: true
    });
    if (error) throw error;
    const cfg = normalizeMaintenanceConfig(data);
    maintenanceCache = { ...cfg, fetchedAt: now, source: 'cloud' };
    renderMaintenanceBanner();
    return cfg;
  } catch (e) {
    bhWarn('refreshMaintenanceConfig', e);
    if (!maintenanceCache.fetchedAt) {
      maintenanceCache = { ...MAINTENANCE_DEFAULT, fetchedAt: now, source: 'fallback' };
    }
    return getMaintenanceConfig();
  }
}
function startMaintenancePolling() {
  if (maintenancePollTimer) return;
  maintenancePollTimer = setInterval(() => {
    refreshMaintenanceConfig(false).catch(() => {});
  }, MAINTENANCE_POLL_MS);
}
function getOpsAlertsConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(OPS_ALERTS_KEY) || '{}');
    return {
      enabled: !!raw.enabled,
      webhookUrl: String(raw.webhookUrl || '')
    };
  } catch (_) { return { enabled: false, webhookUrl: '' }; }
}
function saveOpsAlertsConfig(cfg) {
  const next = {
    enabled: !!cfg?.enabled,
    webhookUrl: String(cfg?.webhookUrl || '').slice(0, 360)
  };
  try { localStorage.setItem(OPS_ALERTS_KEY, JSON.stringify(next)); } catch (_) {}
}
function getAutoSnapshots() {
  try {
    const raw = localStorage.getItem(AUTO_SNAPSHOT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
function createAutoSnapshot(reason = 'save') {
  try {
    const now = Date.now();
    if (now - lastSnapshotAt < 60000) return;
    lastSnapshotAt = now;
    const snaps = getAutoSnapshots();
    snaps.unshift({
      ts: now,
      reason: String(reason || 'save').slice(0, 40),
      activeHuntId: state.activeHuntId,
      hunts: JSON.parse(JSON.stringify(state.hunts || []))
    });
    localStorage.setItem(AUTO_SNAPSHOT_KEY, JSON.stringify(snaps.slice(0, 25)));
  } catch (_) {}
}
function restoreLatestSnapshot() {
  const snaps = getAutoSnapshots();
  if (!snaps.length) { showToast('Aucun snapshot disponible', 'error'); return; }
  const s = snaps[0];
  const ok = confirm('Restaurer le dernier snapshot ?', `Snapshot ${new Date(s.ts).toLocaleString('fr-FR')} (${s.reason})`);
  if (!ok) return;
  state.hunts = Array.isArray(s.hunts) ? s.hunts : [];
  state.activeHuntId = s.activeHuntId || (state.hunts[0]?.id || null);
  save();
  renderHuntList();
  if (state.activeHuntId) selectHunt(state.activeHuntId);
  else {
    const nh = document.getElementById('no-hunt-selected');
    const ws = document.getElementById('hunt-workspace');
    if (nh) nh.style.display = 'flex';
    if (ws) ws.classList.add('hidden');
  }
  showToast('Snapshot restauré', 'success');
}
async function sendOpsAlert(level, message, opts = {}) {
  try {
    const cfg = getOpsAlertsConfig();
    if (!cfg.enabled || !/^https?:\/\//i.test(cfg.webhookUrl || '')) {
      return { ok: false, reason: 'disabled_or_no_url' };
    }
    const now = Date.now();
    if (!opts.force && now - lastOpsAlertAt < 45000) {
      return { ok: false, reason: 'cooldown' };
    }
    if (!opts.force) lastOpsAlertAt = now;
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'HugoTaSlot',
        level: String(level || 'error'),
        message: String(message || '').slice(0, 300),
        ts: new Date().toISOString(),
        url: String(location?.href || ''),
        source: String(opts.source || 'runtime'),
        test: !!opts.test
      })
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}
function isMaintenanceReadOnly() {
  const m = getMaintenanceConfig();
  return m.enabled && !isCurrentUserAdmin();
}
function requireWriteAccess(label = 'Action indisponible', opts = {}) {
  if (!opts.ignoreReadOnlyHunt) {
    const hunt = activeHunt();
    if (hunt && hunt.readOnlyShared) {
      showToast(`${label} — Hunt partagé en lecture seule`, 'error', 2400);
      return false;
    }
  }
  if (!isMaintenanceReadOnly()) return true;
  const m = getMaintenanceConfig();
  showToast(`${label} — ${m.message}`, 'error', 2600);
  return false;
}
function renderMaintenanceBanner() {
  const m = getMaintenanceConfig();
  let el = document.getElementById('maintenance-banner');
  if (!m.enabled) {
    if (el) el.style.display = 'none';
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'maintenance-banner';
    el.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:3200;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,196,0,0.45);background:rgba(38,28,8,0.95);color:#ffe3a3;font-family:"Share Tech Mono",monospace;font-size:11px;box-shadow:0 8px 24px rgba(0,0,0,0.35)';
    document.body.appendChild(el);
  }
  const modeTxt = isCurrentUserAdmin() ? 'ADMIN (écriture autorisée)' : 'JOUEUR (lecture seule)';
  el.textContent = `MAINTENANCE ACTIVE · ${modeTxt} · ${m.message}`;
  el.style.display = 'block';
}
function getRuntimeLogs() {
  try {
    const raw = localStorage.getItem(RUNTIME_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
function pushRuntimeLog(level, message) {
  try {
    const logs = getRuntimeLogs();
    logs.unshift({
      ts: Date.now(),
      level: String(level || 'info').toLowerCase(),
      msg: String(message || '').slice(0, 240)
    });
    localStorage.setItem(RUNTIME_LOG_KEY, JSON.stringify(logs.slice(0, 40)));
  } catch (_) {}
  const lvl = String(level || 'info').toLowerCase();
  if (lvl === 'error') sendOpsAlert(lvl, message).catch(() => {});
}
function clearRuntimeLogs() {
  try { localStorage.removeItem(RUNTIME_LOG_KEY); } catch (_) {}
  renderUpdatesPage();
}
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
let jeuxEmbedLoadPromise = null;
function loadJeuxEmbedScript() {
  if (Array.isArray(window.__JEUX__) && window.__JEUX__.length) {
    return Promise.resolve();
  }
  if (jeuxEmbedLoadPromise) return jeuxEmbedLoadPromise;
  const paths = ['./jeux-embed.js', '/jeux-embed.js', 'jeux-embed.js'];
  jeuxEmbedLoadPromise = (async () => {
    for (const src of paths) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('embed load failed'));
          document.head.appendChild(s);
        });
        if (Array.isArray(window.__JEUX__) && window.__JEUX__.length) return;
      } catch (_) { /* essai chemin suivant */ }
    }
    throw new Error('jeux-embed.js introuvable');
  })();
  return jeuxEmbedLoadPromise;
}

async function loadSlots() {
  const loader = document.getElementById('grid-loader');
  const loaderText = document.getElementById('loader-text');
  const errState = document.getElementById('error-state');
  const grid = document.getElementById('slots-grid');
  if (loader) loader.classList.remove('hidden');
  if (errState) errState.classList.add('hidden');
  if (grid) grid.innerHTML = '';

  // Animated loading messages
  const loadMsgs = ['CHARGEMENT DES SLOTS...', 'PARSING 7000+ ENTRÉES...', 'INDEXATION DES PROVIDERS...', 'OPTIMISATION DE LA GRILLE...'];
  let msgIdx = 0;
  const msgTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % loadMsgs.length;
    if (loaderText) loaderText.textContent = loadMsgs[msgIdx];
  }, 600);

  try {
    let data = null;

    // 1) Un seul fetch à la fois (évite 3× le même JSON en parallèle).
    const paths = ['jeux.json', './jeux.json', '/jeux.json'];
    for (const p of paths) {
      try {
        data = await fetchJSONWithRetry(p, { retries: 0, timeoutMs: 3500 });
        if (data) break;
      } catch (_) { /* chemin suivant */ }
    }

    // 2) Secours : jeux-embed.js (~2 Mo), chargé uniquement si jeux.json indisponible
    if (!data) {
      try {
        await loadJeuxEmbedScript();
      } catch (_) { /* pas d’embed : fallback synthétique ci-dessous */ }
      if (Array.isArray(window.__JEUX__) && window.__JEUX__.length) {
        data = window.__JEUX__;
      }
    }

    if (!data) {
      // Fallback local: garde le site utilisable même sans jeux.json.
      const providers = ['Pragmatic Play', 'Hacksaw', 'NoLimit City', 'NetEnt', 'Playn GO', 'Relax Gaming'];
      data = Array.from({ length: 7000 }, (_, i) => ({
        id: `fallback-${i + 1}`,
        name: `Slot ${i + 1}`,
        provider: providers[i % providers.length],
        image: ''
      }));
      if (errState) {
        errState.classList.remove('hidden');
        errState.innerHTML = `
        <div class="error-banner">
          ℹ Base de données introuvable : fallback 7000 slots chargée.
        </div>`;
      }
    } else if (errState) {
      errState.classList.add('hidden');
    }

    const rawSlots = Array.isArray(data) ? data : (data.slots || data.games || []);
    state.slots = rawSlots.map((s) => normalizeCatalogEntry(s));
    const providerCounts = buildSlotCatalogIndexes(state.slots);

    // Build provider list (single pass counts, much faster).
    const providers = Array.from(providerCounts.keys()).sort();
    const pf = document.getElementById('provider-filter');
    if (pf) {
      pf.innerHTML = '<option value="">Tous les providers</option>';
      providers.forEach((p) => {
        const o = document.createElement('option');
        o.value = p;
        o.textContent = `${p} (${providerCounts.get(p) || 0})`;
        pf.appendChild(o);
      });
    }

    filterAndRender();
    state._huntWsFp = '';
    try {
      if (state.activeHuntId && activeHunt()) scheduleHuntUI({ force: true });
    } catch (_) {}
  } catch (e) {
    console.error('loadSlots fatal', e);
    if (errState) {
      errState.classList.remove('hidden');
      errState.innerHTML = `<div class="error-banner">Erreur de chargement des slots. Recharge la page.</div>`;
    }
    state.slots = [];
    state.filteredSlots = [];
  } finally {
    clearInterval(msgTimer);
    if (loader) loader.classList.add('hidden');
  }
}

function updateCatalogModeHint() {
  const el = document.getElementById('catalog-mode-hint');
  if (!el) return;
  const ext = state.catalogMode === 'extended';
  el.classList.remove('hidden', 'catalog-mode-hint--warn');
  if (ext) {
    el.textContent =
      'Mode étendu : inclut les slots slot.report. Pastille « Hors Gamdom » = pas encore sur le casino ou vignette manquante.';
    el.classList.add('catalog-mode-hint--warn');
  } else {
    el.textContent =
      'Mode Gamdom pur : jeux avec lien Gamdom, Stake ou vignette catalogue reconnue (Hub88, Pragmatic, etc.).';
  }
}

function isMobileNavMode() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function setMobileSidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', !!open);
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggle = document.getElementById('mobile-nav-toggle');
  if (backdrop) {
    backdrop.hidden = !open;
    backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (toggle) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute(
      'aria-label',
      open ? 'Fermer le menu de navigation' : 'Ouvrir le menu de navigation'
    );
  }
  if (open) {
    const first = document.querySelector(
      '#sidebar .sidebar-btn, #sidebar .sidebar-tab'
    );
    if (first && typeof first.focus === 'function') {
      setTimeout(() => first.focus(), 40);
    }
  }
}

function closeMobileSidebar() {
  if (isMobileNavMode()) setMobileSidebarOpen(false);
}

function initSidebarNavA11y() {
  const nav = document.querySelector('.sidebar-tabs');
  if (nav && !nav.dataset.bound) {
    nav.dataset.bound = '1';
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.sidebar-tab[data-page]');
      if (!btn) return;
      switchPage(btn.dataset.page);
    });
  }
  const toggle = document.getElementById('mobile-nav-toggle');
  if (toggle && !toggle.dataset.bound) {
    toggle.dataset.bound = '1';
    toggle.addEventListener('click', () => {
      setMobileSidebarOpen(!document.body.classList.contains('sidebar-open'));
    });
  }
  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', () => setMobileSidebarOpen(false));
  }
}

function getFocusableIn(container) {
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => el.offsetParent !== null);
}

const modalFocusTraps = new WeakMap();

function bindModalFocusTrap(overlay) {
  if (!overlay || modalFocusTraps.has(overlay)) return;
  const onKeyDown = (e) => {
    if (overlay.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      overlay.classList.add('hidden');
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusableIn(overlay);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  overlay.addEventListener('keydown', onKeyDown);
  modalFocusTraps.set(overlay, { onKeyDown, previousFocus: null });
}

function focusModalWhenOpened(overlay) {
  bindModalFocusTrap(overlay);
  const trap = modalFocusTraps.get(overlay);
  if (trap) trap.previousFocus = document.activeElement;
  requestAnimationFrame(() => {
    const focusable = getFocusableIn(overlay);
    const target =
      focusable.find((el) => !el.classList.contains('modal-close')) ||
      focusable[0];
    if (target) target.focus();
  });
}

function initModalA11yObserver() {
  document.querySelectorAll('.modal-overlay').forEach(bindModalFocusTrap);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const el = m.target;
      if (!el.classList?.contains('modal-overlay')) continue;
      if (!el.classList.contains('hidden')) focusModalWhenOpened(el);
      else {
        const trap = modalFocusTraps.get(el);
        if (trap?.previousFocus?.focus) trap.previousFocus.focus();
      }
    }
  });
  document.querySelectorAll('.modal-overlay').forEach((el) => {
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}

function filterAndRender() {
  const qRaw = document.getElementById('search-input').value.trim();
  const q = qRaw.toLowerCase();
  const prov = document.getElementById('provider-filter').value.toLowerCase();
  const sourceFiltered = state.catalogMode === 'extended'
    ? state.slots
    : (state.gamdomSlotIndices || []).map((i) => state.slots[i]).filter(Boolean);

  if (!q && !prov) {
    state.filteredSlots = sourceFiltered;
  } else {
    state.filteredSlots = sourceFiltered.filter((s) => {
      const idxPos = state.slotRefIndex.get(s);
      const idx = idxPos >= 0 ? state.searchIndex[idxPos] : { nom: '', prov: '' };
      const matchQ = !q || idx.nom.includes(q) || idx.prov.includes(q);
      const matchP = !prov || idx.prov === prov;
      return matchQ && matchP;
    });
  }

  document.getElementById('results-count').textContent = state.filteredSlots.length.toLocaleString('fr') + ' slots';
  toggleCreateSlotBox(qRaw);
  updateCatalogModeHint();
  currentPage = 0;
  renderPage(true);
}

function toggleCreateSlotBox(queryText = '') {
  const box = document.getElementById('slot-create-empty');
  if (!box) return;
  const trimmed = String(queryText || '').trim();
  const hasQuery = trimmed.length > 0;
  const noResult = state.filteredSlots.length === 0;
  box.style.display = hasQuery ? 'block' : 'none';
  const titleEl = document.getElementById('slot-create-title');
  if (titleEl) {
    titleEl.textContent = noResult
      ? `Aucune slot trouvée — créer "${trimmed}" en custom`
      : `Pas la bonne slot ? Crée-la avec le nom exact (${state.filteredSlots.length.toLocaleString('fr')} résultat(s))`;
  }
  if (hasQuery) {
    const nameEl = document.getElementById('slot-create-name');
    if (nameEl && !String(nameEl.value || '').trim()) nameEl.value = trimmed;
  }
}

function renderPage(reset = false) {
  const grid = document.getElementById('slots-grid');
  if (!grid) return;
  if (reset) {
    grid.innerHTML = '';
    currentPage = 0;
  }

  const start = currentPage * PAGE_SIZE;
  if (start >= state.filteredSlots.length) return;

  const hunt = activeHunt();
  const addedIds = new Set(hunt ? hunt.bonuses.map(b => b.slotId) : []);

  // Réserve l’index tout de suite : évite les doublons si le scroll déclenche 2× avant append (ex. fermeture opener / reflow).
  currentPage++;
  const slice = state.filteredSlots.slice(start, start + PAGE_SIZE);

  const frag = document.createDocumentFragment();
  slice.forEach(slot => {
    const id = slot.id || slot.Id;
    const name = slot.nom || slot.name || slot.title || slot.Name || 'Slot';
    const provider = slot.provider || slot.Provider || '';
    const img = slot.image || slot.img || slot.thumbnail || '';
    const already = addedIds.has(id);

    const nameSafe = escapeHtml(name);
    const nameSlice = name.length > 22 ? name.slice(0, 22) + '…' : name;
    const nameSliceSafe = escapeHtml(nameSlice);
    const provSlice = provider.slice(0, 14);
    const provSliceSafe = escapeHtml(provSlice);
    const imgSafe = isSafeUrl(img) ? escapeHtml(img) : '';

    const card = document.createElement('div');
    card.className = 'slot-card';
    card.title = `${name}\n${provider}`;
    card.dataset.id = id;

    const alreadyDot = already ? `<div class="green-dot" style="position:absolute;top:6px;left:6px;width:10px;height:10px;background:var(--green);border-radius:50%;box-shadow:0 0 6px var(--green);z-index:3;"></div>` : '';
    const provBadge = provider ? `<div class="slot-provider-badge">${provSliceSafe}</div>` : '';
    const offCatalog =
      state.catalogMode === 'extended' &&
      (String(id).startsWith('sr_') || isCatalogPlaceholderImage(img));
    if (offCatalog) card.classList.add('slot-card--off-catalog');
    const offBadge = offCatalog
      ? '<div class="slot-off-badge" title="Référence slot.report — pas sur Gamdom ou sans vignette">Hors Gamdom</div>'
      : '';

    if (imgSafe) {
      card.innerHTML = `
        <img src="${imgSafe}" alt="${nameSafe}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="slot-no-img" style="display:none"><div class="icon"><img src="./assets/virtual-token.svg" class="ui-logo-icon" alt="slot"></div><div class="label">${nameSliceSafe}</div></div>
        <div class="slot-overlay"><div class="slot-name">${nameSafe}</div></div>
        ${provBadge}${offBadge}${alreadyDot}
      `;
    } else {
      card.innerHTML = `
        <div class="slot-no-img"><div class="icon"><img src="./assets/virtual-token.svg" class="ui-logo-icon" alt="slot"></div><div class="label">${nameSliceSafe}</div></div>
        ${provBadge}${offBadge}${alreadyDot}
      `;
    }

    card.addEventListener('click', () => openAddModal(slot));
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}

// Infinite scroll (debounce léger : fermeture popup / resize évite rafales qui dupliquaient une page)
document.getElementById('grid-container').addEventListener('scroll', function() {
  const el = this;
  clearTimeout(catalogScrollDebounce);
  catalogScrollDebounce = setTimeout(() => {
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
      if (currentPage * PAGE_SIZE < state.filteredSlots.length) renderPage();
    }
  }, 60);
});

// ═══════════════════════════════════════════════
//  SEARCH
// ═══════════════════════════════════════════════
let searchDebounce = null;
document.getElementById('search-input').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(filterAndRender, 120);
});
document.getElementById('catalog-mode-filter').addEventListener('change', (e) => {
  state.catalogMode = e.target.value === 'extended' ? 'extended' : 'gamdom';
  save();
  updateCatalogModeHint();
  filterAndRender();
  showToast(
    state.catalogMode === 'extended'
      ? 'Mode catalogue étendu activé'
      : 'Mode Gamdom pur activé',
    'info',
    1800
  );
});
document.getElementById('provider-filter').addEventListener('change', filterAndRender);
document.getElementById('slot-create-btn').addEventListener('click', createCustomSlotBonus);
document.getElementById('slot-create-stake').addEventListener('keydown', (e) => { if (e.key === 'Enter') createCustomSlotBonus(); });
document.getElementById('slot-create-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') createCustomSlotBonus(); });
const _slotCreateProv = document.getElementById('slot-create-provider');
if (_slotCreateProv) _slotCreateProv.addEventListener('keydown', (e) => { if (e.key === 'Enter') createCustomSlotBonus(); });
document.getElementById('bonus-status-filter').addEventListener('change', (e) => {
  state.bonusView.status = e.target.value || 'all';
  save();
  const h = activeHunt();
  if (h) renderBonusList(h);
});
document.getElementById('bonus-type-filter').addEventListener('change', (e) => {
  state.bonusView.type = e.target.value || 'all';
  save();
  const h = activeHunt();
  if (h) renderBonusList(h);
});
const _bonusWinFilter = document.getElementById('bonus-win-filter');
if (_bonusWinFilter) _bonusWinFilter.addEventListener('change', (e) => {
  state.bonusView.winFilter = e.target.value || 'all';
  save();
  const h = activeHunt();
  if (h) renderBonusList(h);
});
document.getElementById('bonus-sort').addEventListener('change', (e) => {
  state.bonusView.sort = e.target.value || 'order';
  save();
  const h = activeHunt();
  if (h) renderBonusList(h);
});
function scheduleBonusFilterRender() {
  clearTimeout(bonusFilterDebounce);
  bonusFilterDebounce = setTimeout(() => {
    save();
    state._huntWsFp = '';
    const h = activeHunt();
    if (h) renderBonusList(h);
  }, 150);
}
document.getElementById('bonus-search-filter').addEventListener('input', (e) => {
  state.bonusView.q = String(e.target.value || '').trim().toLowerCase();
  scheduleBonusFilterRender();
});
document.getElementById('bonus-provider-filter').addEventListener('change', (e) => {
  state.bonusView.provider = String(e.target.value || '').toLowerCase();
  save();
  state._huntWsFp = '';
  const h = activeHunt();
  if (h) renderBonusList(h);
});
document.getElementById('bonus-min-stake').addEventListener('input', (e) => {
  state.bonusView.minStake = String(e.target.value || '').trim();
  scheduleBonusFilterRender();
});
document.getElementById('bonus-max-stake').addEventListener('input', (e) => {
  state.bonusView.maxStake = String(e.target.value || '').trim();
  scheduleBonusFilterRender();
});
document.getElementById('bonus-filter-presets').addEventListener('change', (e) => {
  const idx = Number(e.target.value);
  const presets = getBonusFilterPresets();
  const p = Number.isFinite(idx) && idx >= 0 ? presets[idx] : null;
  if (!p) return;
  state.bonusView.status = p.status || 'all';
  state.bonusView.type = p.type || 'all';
  state.bonusView.sort = p.sort || 'order';
  state.bonusView.q = String(p.q || '').toLowerCase();
  state.bonusView.provider = String(p.provider || '').toLowerCase();
  state.bonusView.minStake = String(p.minStake || '');
  state.bonusView.maxStake = String(p.maxStake || '');
  const statusEl = document.getElementById('bonus-status-filter');
  const typeEl = document.getElementById('bonus-type-filter');
  const sortEl = document.getElementById('bonus-sort');
  const qEl = document.getElementById('bonus-search-filter');
  const providerEl = document.getElementById('bonus-provider-filter');
  const minStakeEl = document.getElementById('bonus-min-stake');
  const maxStakeEl = document.getElementById('bonus-max-stake');
  if (statusEl) statusEl.value = state.bonusView.status;
  if (typeEl) typeEl.value = state.bonusView.type;
  if (sortEl) sortEl.value = state.bonusView.sort;
  if (qEl) qEl.value = state.bonusView.q;
  if (providerEl) providerEl.value = state.bonusView.provider;
  if (minStakeEl) minStakeEl.value = state.bonusView.minStake;
  if (maxStakeEl) maxStakeEl.value = state.bonusView.maxStake;
  const h = activeHunt();
  if (h) renderBonusList(h);
  showToast(`Preset "${p.name}" appliqué`, 'success', 1500);
});
document.getElementById('btn-save-filter-preset').addEventListener('click', () => {
  const name = prompt('Nom du preset filtre', `Filtre ${new Date().toLocaleTimeString('fr-FR')}`);
  if (!name) return;
  const presets = getBonusFilterPresets();
  presets.unshift({
    name: String(name).slice(0, 50),
    status: state.bonusView.status || 'all',
    type: state.bonusView.type || 'all',
    sort: state.bonusView.sort || 'order',
    q: state.bonusView.q || '',
    provider: state.bonusView.provider || '',
    minStake: state.bonusView.minStake || '',
    maxStake: state.bonusView.maxStake || ''
  });
  saveBonusFilterPresets(presets);
  populateBonusFilterPresetsSelect();
  showToast('Preset filtre sauvegardé', 'success', 1500);
});
document.getElementById('btn-del-filter-preset').addEventListener('click', () => {
  const sel = document.getElementById('bonus-filter-presets');
  const idx = Number(sel?.value);
  if (!Number.isFinite(idx) || idx < 0) { showToast('Choisis un preset', 'info'); return; }
  const presets = getBonusFilterPresets();
  const removed = presets.splice(idx, 1)[0];
  saveBonusFilterPresets(presets);
  populateBonusFilterPresetsSelect();
  showToast(`Preset "${removed?.name || ''}" supprimé`, 'info', 1500);
});
document.getElementById('btn-reset-filters').addEventListener('click', () => {
  state.bonusView = { status: 'all', type: 'all', winFilter: 'all', sort: 'order', q: '', provider: '', minStake: '', maxStake: '' };
  const statusEl = document.getElementById('bonus-status-filter');
  const typeEl = document.getElementById('bonus-type-filter');
  const winEl = document.getElementById('bonus-win-filter');
  const sortEl = document.getElementById('bonus-sort');
  const qEl = document.getElementById('bonus-search-filter');
  const providerEl = document.getElementById('bonus-provider-filter');
  const minStakeEl = document.getElementById('bonus-min-stake');
  const maxStakeEl = document.getElementById('bonus-max-stake');
  const presetsEl = document.getElementById('bonus-filter-presets');
  if (statusEl) statusEl.value = 'all';
  if (typeEl) typeEl.value = 'all';
  if (winEl) winEl.value = 'all';
  if (sortEl) sortEl.value = 'order';
  if (qEl) qEl.value = '';
  if (providerEl) providerEl.value = '';
  if (minStakeEl) minStakeEl.value = '';
  if (maxStakeEl) maxStakeEl.value = '';
  if (presetsEl) presetsEl.value = '';
  save();
  const h = activeHunt();
  if (h) renderBonusList(h);
  showToast('Filtres réinitialisés', 'success', 1200);
});

function exportActiveHunt() {
  const hunt = activeHunt();
  if (!hunt) { showToast('Sélectionne un hunt à exporter', 'error'); return; }
  const bonuses = Array.isArray(hunt.bonuses) ? hunt.bonuses : [];
  const seen = new Map();
  let duplicateCount = 0;
  let missingProvider = 0;
  let tinyStake = 0;
  let hugeStake = 0;
  bonuses.forEach((b) => {
    const key = String((b.slotName || '').trim().toLowerCase());
    seen.set(key, (seen.get(key) || 0) + 1);
    const stake = Number(b.stake || 0);
    if (!String(b.slotProvider || '').trim()) missingProvider++;
    if (Number.isFinite(stake) && stake > 0 && stake < 0.1) tinyStake++;
    if (Number.isFinite(stake) && stake > 1000) hugeStake++;
  });
  duplicateCount = [...seen.values()].filter((v) => v > 1).reduce((a, v) => a + (v - 1), 0);
  const bonusCount = (hunt.bonuses || []).length;
  const openedCount = (hunt.bonuses || []).filter((b) => b.win !== null).length;
  const qualityHtml = `
    <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);line-height:1.5;">
      Hunt: ${escapeHtml(hunt.name || 'Hunt')}<br>
      Bonus: ${bonusCount} · Ouverts: ${openedCount} · Casino: ${escapeHtml(hunt.casino || 'gamdom')}<br>
      Doublons slot: ${duplicateCount} · Providers manquants: ${missingProvider}<br>
      Mises très faibles (&lt;0.10): ${tinyStake} · Mises très élevées (&gt;1000): ${hugeStake}
    </div>
  `;
  confirmRich('Qualité des données avant export', qualityHtml, 'EXPORTER', 'ANNULER').then((ok) => {
    if (!ok) return;
    const payload = {
      format: 'hugotaslot-hunt-v3',
      schemaVersion: 3,
      exportedAt: Date.now(),
      exportedBy: currentUser?.username || 'local',
      metadata: {
        appVersion: '2.0',
        bonusCount,
        openedCount,
        casino: hunt.casino || 'gamdom',
        quality: { duplicateCount, missingProvider, tinyStake, hugeStake }
      },
      hunt
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safe = String(hunt.name || 'hunt').replace(/[^a-z0-9_-]+/gi, '_');
    a.download = `${safe}_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Hunt exporté', 'success');
  });
}

function getHuntExportSummary(hunt) {
  const bonuses = Array.isArray(hunt?.bonuses) ? hunt.bonuses : [];
  const currency = hunt?.currency || getDisplayCurrency();
  const startBalance = Number(hunt?.startBalance || 0);
  const totalStake = bonuses.reduce((s, b) => s + Number(b.stake || 0), 0);
  const openedBonuses = bonuses.filter((b) => b && b.win !== null && !Number.isNaN(Number(b.win)));
  const totalWin = openedBonuses.reduce((s, b) => s + Number(b.win || 0), 0);
  const profit = totalWin - startBalance;
  const beAvg = totalStake > 0 ? startBalance / totalStake : 0;
  const topBonuses = openedBonuses
    .map((b) => {
      const stake = Number(b.stake || 0);
      const win = Number(b.win || 0);
      return {
        name: String(b.slotName || 'Slot').trim() || 'Slot',
        provider: String(b.slotProvider || '').trim(),
        win,
        stake,
        mult: stake > 0 ? win / stake : 0,
      };
    })
    .sort((a, b) => b.win - a.win)
    .slice(0, 5);
  return {
    currency,
    startBalance,
    totalWin,
    profit,
    beAvg,
    bonusCount: bonuses.length,
    openedCount: openedBonuses.length,
    casinoLabel: getCasinoLabel(getCasinoKey(hunt?.casino || 'gamdom')),
    topBonuses,
  };
}

function loadExportImageAsset(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`asset_load_failed:${url}`));
    img.src = url;
  });
}

function canvasRoundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function truncateCanvasText(ctx, text, maxWidth) {
  const raw = String(text || '');
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let out = raw;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

async function renderHuntExportCanvas(hunt, summary) {
  await document.fonts.ready;
  const W = 1200;
  const H = 675;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0B1210');
  bg.addColorStop(0.55, '#050806');
  bg.addColorStop(1, '#020403');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(0, 220, 110, 0.22)';
  ctx.lineWidth = 2;
  canvasRoundRect(ctx, 18, 18, W - 36, H - 36, 22);
  ctx.stroke();

  const glow = ctx.createRadialGradient(W * 0.82, H * 0.12, 10, W * 0.82, H * 0.12, 320);
  glow.addColorStop(0, 'rgba(0, 220, 110, 0.14)');
  glow.addColorStop(1, 'rgba(0, 220, 110, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  let logoHugo = null;
  let logo19 = null;
  try {
    [logoHugo, logo19] = await Promise.all([
      loadExportImageAsset('./assets/logo-hugotaslot.jpg'),
      loadExportImageAsset('./assets/19enplein-logo.png'),
    ]);
  } catch (_) {}

  const pad = 52;
  let y = 54;
  if (logoHugo && logo19) {
    const ls = 42;
    ctx.drawImage(logoHugo, pad, y - 8, ls, ls);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '600 22px Rajdhani, sans-serif';
    ctx.fillText('×', pad + ls + 10, y + 24);
    ctx.drawImage(logo19, pad + ls + 34, y - 4, ls + 8, ls);
    y += 52;
  }

  ctx.fillStyle = '#00DC6E';
  ctx.font = '700 13px "Share Tech Mono", monospace';
  ctx.fillText('HUGOTASLOT × 19ENPLEIN · BONUS HUNT RECAP', pad, y);
  y += 34;

  ctx.fillStyle = '#FFC93C';
  ctx.font = '800 46px Rajdhani, sans-serif';
  const huntTitle = truncateCanvasText(ctx, hunt.name || 'Mon Hunt', W - pad * 2);
  ctx.fillText(huntTitle, pad, y);
  y += 24;

  ctx.fillStyle = 'rgba(237,238,242,0.55)';
  ctx.font = '500 16px Rajdhani, sans-serif';
  ctx.fillText(`${summary.bonusCount} bonus · ${summary.openedCount} ouverts · ${summary.casinoLabel}`, pad, y + 18);
  y += 52;

  const cur = summary.currency;
  const kpis = [
    { label: 'PROFIT', value: `${summary.profit >= 0 ? '+' : ''}${fmt(summary.profit, cur)}`, color: summary.profit >= 0 ? '#00DC6E' : '#E07A8C' },
    { label: 'SOLDE DÉPART', value: fmt(summary.startBalance, cur), color: '#FFC93C' },
    { label: 'GAINS TOTAUX', value: fmt(summary.totalWin, cur), color: '#EDEEF2' },
    { label: 'BE MOYEN', value: summary.beAvg > 0 ? `${summary.beAvg.toFixed(4).replace('.', ',')}×` : '—', color: '#FFC93C' },
  ];
  const gap = 14;
  const boxW = (W - pad * 2 - gap * 3) / 4;
  const boxH = 92;
  kpis.forEach((k, i) => {
    const x = pad + i * (boxW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    canvasRoundRect(ctx, x, y, boxW, boxH, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    canvasRoundRect(ctx, x, y, boxW, boxH, 12);
    ctx.stroke();
    ctx.fillStyle = 'rgba(237,238,242,0.45)';
    ctx.font = '600 11px "Share Tech Mono", monospace';
    ctx.fillText(k.label, x + 14, y + 24);
    ctx.fillStyle = k.color;
    ctx.font = '800 28px Rajdhani, sans-serif';
    ctx.fillText(truncateCanvasText(ctx, k.value, boxW - 28), x + 14, y + 58);
  });
  y += boxH + 28;

  ctx.fillStyle = '#00DC6E';
  ctx.font = '700 13px "Share Tech Mono", monospace';
  ctx.fillText('TOP BONUS', pad, y);
  y += 22;

  const rowH = 46;
  const rows = summary.topBonuses.length ? summary.topBonuses : [{ name: 'Aucun bonus ouvert pour l’instant', provider: '', win: 0, mult: 0 }];
  rows.forEach((b, i) => {
    const ry = y + i * (rowH + 8);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)';
    canvasRoundRect(ctx, pad, ry, W - pad * 2, rowH, 10);
    ctx.fill();
    ctx.fillStyle = '#EDEEF2';
    ctx.font = '700 20px Rajdhani, sans-serif';
    const slotLine = b.provider ? `${b.name} · ${b.provider}` : b.name;
    ctx.fillText(truncateCanvasText(ctx, slotLine, W - pad * 2 - 260), pad + 14, ry + 29);
    if (b.win > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#00DC6E';
      ctx.font = '700 18px "Share Tech Mono", monospace';
      ctx.fillText(fmt(b.win, cur), W - pad - 14, ry + 22);
      ctx.fillStyle = 'rgba(237,238,242,0.45)';
      ctx.font = '500 12px "Share Tech Mono", monospace';
      ctx.fillText(`×${Number(b.mult || 0).toFixed(2)}`, W - pad - 14, ry + 38);
      ctx.textAlign = 'left';
    }
  });

  ctx.fillStyle = 'rgba(237,238,242,0.35)';
  ctx.font = '500 12px "Share Tech Mono", monospace';
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  ctx.fillText(`hugotaslot.fr · ${dateStr}`, pad, H - 42);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('png_export_failed'));
      else resolve(blob);
    }, 'image/png');
  });
}

async function exportActiveHuntImage(opts = {}) {
  const hunt = activeHunt();
  if (!hunt) {
    showToast('Sélectionne un hunt à exporter', 'error');
    return;
  }
  const summary = getHuntExportSummary(hunt);
  if (!summary.bonusCount) {
    showToast('Ajoute au moins un bonus avant l’export image', 'error');
    return;
  }
  try {
    showToast('Génération de l’image…', 'info', 1200);
    const blob = await renderHuntExportCanvas(hunt, summary);
    const safe = String(hunt.name || 'hunt').replace(/[^a-z0-9_-]+/gi, '_');
    const filename = `${safe}_recap_${new Date().toISOString().slice(0, 10)}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (opts.copyClipboard !== false && navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Image téléchargée et copiée (presse-papiers)', 'success', 2800);
        return;
      } catch (_) {}
    }
    showToast('Image récap exportée', 'success', 2200);
  } catch (e) {
    bhWarn('exportActiveHuntImage', e);
    showToast('Export image impossible', 'error', 2600);
  }
}

function buildHuntExportPrintHtml(hunt, summary) {
  const cur = summary.currency;
  const bonuses = Array.isArray(hunt?.bonuses) ? hunt.bonuses : [];
  const dateStr = new Date(hunt?.createdAt || Date.now()).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const printDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const profitColor = summary.profit >= 0 ? '#0a7a42' : '#b33a52';
  const rows = bonuses.map((b, i) => {
    const stake = Number(b.stake || 0);
    const winRaw = b?.win;
    const opened = winRaw !== null && winRaw !== undefined && !Number.isNaN(Number(winRaw));
    const win = opened ? Number(winRaw || 0) : null;
    const mult = opened && stake > 0 ? win / stake : null;
    const status = opened ? 'Ouvert' : 'À ouvrir';
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(String(b.slotName || 'Slot').trim() || 'Slot')}</td>
      <td>${escapeHtml(String(b.slotProvider || '').trim() || '—')}</td>
      <td class="num">${fmt(stake, cur)}</td>
      <td class="num">${opened ? fmt(win, cur) : '—'}</td>
      <td class="num">${mult !== null ? `×${mult.toFixed(2)}` : '—'}</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
  const topRows = (summary.topBonuses || []).map((b) => {
    const slotLine = b.provider ? `${b.name} · ${b.provider}` : b.name;
    return `<li><strong>${escapeHtml(slotLine)}</strong> — ${fmt(b.win, cur)}${b.mult > 0 ? ` (×${Number(b.mult).toFixed(2)})` : ''}</li>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(hunt.name || 'Hunt')} — récap</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #111; margin: 0; padding: 0; font-size: 12px; }
    .wrap { max-width: 780px; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: 26px; color: #0a7a42; }
    .sub { color: #555; margin-bottom: 18px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
    .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; background: #fafafa; }
    .kpi label { display: block; font-size: 10px; letter-spacing: 0.4px; text-transform: uppercase; color: #666; margin-bottom: 4px; }
    .kpi strong { font-size: 18px; }
    .section { margin-top: 18px; }
    .section h2 { font-size: 14px; margin: 0 0 8px; color: #0a7a42; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    ul { margin: 0; padding-left: 18px; }
    .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 10px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(hunt.name || 'Mon Hunt')}</h1>
    <div class="sub">HugoTaSlot × 19EnPlein · Bonus Hunt · créé le ${escapeHtml(dateStr)} · ${escapeHtml(summary.casinoLabel)} · ${summary.bonusCount} bonus (${summary.openedCount} ouverts)</div>
    <div class="kpis">
      <div class="kpi"><label>Profit</label><strong style="color:${profitColor}">${summary.profit >= 0 ? '+' : ''}${escapeHtml(fmt(summary.profit, cur))}</strong></div>
      <div class="kpi"><label>Solde départ</label><strong>${escapeHtml(fmt(summary.startBalance, cur))}</strong></div>
      <div class="kpi"><label>Gains totaux</label><strong>${escapeHtml(fmt(summary.totalWin, cur))}</strong></div>
      <div class="kpi"><label>BE moyen</label><strong>${summary.beAvg > 0 ? `${summary.beAvg.toFixed(4).replace('.', ',')}×` : '—'}</strong></div>
    </div>
    ${topRows ? `<div class="section"><h2>Top bonus</h2><ul>${topRows}</ul></div>` : ''}
    <div class="section">
      <h2>Détail des bonus</h2>
      <table>
        <thead><tr><th>#</th><th>Slot</th><th>Provider</th><th>Mise</th><th>Gain</th><th>Multi</th><th>Statut</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">Aucun bonus</td></tr>'}</tbody>
      </table>
    </div>
    <div class="foot">hugotaslot.fr · exporté le ${escapeHtml(printDate)} · document d’archivage / impression</div>
  </div>
</body>
</html>`;
}

function exportActiveHuntPdf() {
  const hunt = activeHunt();
  if (!hunt) {
    showToast('Sélectionne un hunt à exporter', 'error');
    return;
  }
  const summary = getHuntExportSummary(hunt);
  if (!summary.bonusCount) {
    showToast('Ajoute au moins un bonus avant l’export PDF', 'error');
    return;
  }
  const html = buildHuntExportPrintHtml(hunt, summary);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    showToast('Export PDF impossible', 'error');
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const runPrint = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      showToast('Dialogue d’impression ouvert — choisis « Enregistrer en PDF »', 'success', 3200);
    } catch (e) {
      bhWarn('exportActiveHuntPdf', e);
      showToast('Export PDF impossible', 'error');
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  };
  if (iframe.contentDocument?.readyState === 'complete') runPrint();
  else iframe.onload = runPrint;
}

let publicHuntPublishTimer = null;
let publicHuntPublishInFlight = false;
let publicHuntPublishQueued = false;

function buildPublicHuntLivePayload(hunt) {
  const summary = getHuntExportSummary(hunt);
  return {
    format: 'hugotaslot-live-v1',
    updatedAt: Date.now(),
    hunt: {
      name: hunt.name,
      currency: hunt.currency,
      startBalance: hunt.startBalance,
      startBalanceEUR: hunt.startBalanceEUR,
      casino: hunt.casino,
      bonuses: (hunt.bonuses || []).map((b) => ({
        slotName: b.slotName,
        slotProvider: b.slotProvider,
        slotImage: b.slotImage,
        stake: b.stake,
        win: b.win,
        bonusType: b.bonusType,
      })),
    },
    stats: {
      currency: summary.currency,
      startBalance: summary.startBalance,
      totalWin: summary.totalWin,
      profit: summary.profit,
      beAvg: summary.beAvg,
      bonusCount: summary.bonusCount,
      openedCount: summary.openedCount,
      casinoLabel: summary.casinoLabel,
    },
  };
}

function getPublicHuntLiveUrl(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return '';
  try { return `${location.origin}/h/${s}`; } catch (_) { return `https://hugotaslot.fr/h/${s}`; }
}

function updatePublicLiveButtons(hunt) {
  const stopBtn = document.getElementById('btn-stop-live-hunt');
  const liveBtn = document.getElementById('btn-live-hunt');
  const on = !!(hunt && hunt.publicShareEnabled && hunt.publicShareSlug);
  if (stopBtn) stopBtn.style.display = on ? '' : 'none';
  if (liveBtn) liveBtn.classList.toggle('live-active', on);
}

async function publishActiveHuntLiveShareNow() {
  const hunt = activeHunt();
  if (!hunt || !isCloudUser()) return null;
  if (!hunt.publicShareEnabled && !hunt.publicShareSlug) return null;
  const c = getAuthClient();
  if (!c) return null;
  const payload = buildPublicHuntLivePayload(hunt);
  const { data, error } = await cloudCall('sync', () => c.rpc('publish_public_hunt_share', {
    p_hunt_id: String(hunt.id),
    p_payload: payload,
  }), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
  if (error) throw error;
  const slug = String(data || hunt.publicShareSlug || '').trim().toLowerCase();
  if (slug) {
    hunt.publicShareSlug = slug;
    hunt.publicShareEnabled = true;
    writeLocalCache();
    updatePublicLiveButtons(hunt);
  }
  return slug;
}

function schedulePublicHuntLivePublish() {
  if (!isCloudUser()) return;
  const hunt = activeHunt();
  if (!hunt || !hunt.publicShareEnabled) return;
  if (publicHuntPublishTimer) clearTimeout(publicHuntPublishTimer);
  publicHuntPublishTimer = setTimeout(async () => {
    publicHuntPublishTimer = null;
    if (publicHuntPublishInFlight) {
      publicHuntPublishQueued = true;
      return;
    }
    publicHuntPublishInFlight = true;
    try {
      await publishActiveHuntLiveShareNow();
    } catch (e) {
      pushRuntimeLog('warn', `public_hunt_publish: ${String(e?.message || e)}`);
    } finally {
      publicHuntPublishInFlight = false;
      if (publicHuntPublishQueued) {
        publicHuntPublishQueued = false;
        schedulePublicHuntLivePublish();
      }
    }
  }, 900);
}

async function enablePublicHuntLiveLink() {
  if (!requireWriteAccess('Lien live bloqué')) return;
  if (!isCloudUser()) {
    showToast('Connecte-toi pour un lien public live', 'error', 3000);
    showAuth();
    return;
  }
  const hunt = activeHunt();
  if (!hunt) {
    showToast('Sélectionne un hunt', 'error');
    return;
  }
  if (!(hunt.bonuses || []).length) {
    showToast('Ajoute au moins un bonus avant le lien live', 'error', 2600);
    return;
  }
  hunt.publicShareEnabled = true;
  try {
    const slug = await publishActiveHuntLiveShareNow();
    if (!slug) throw new Error('publish_failed');
    const url = getPublicHuntLiveUrl(slug);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
    } catch (_) {}
    showToast(`Lien live actif (maj auto pendant le farm)`, 'success', 3200);
    updatePublicLiveButtons(hunt);
  } catch (e) {
    hunt.publicShareEnabled = false;
    bhWarn('enablePublicHuntLiveLink', e);
    const msg = String(e?.message || e || '').toLowerCase();
    if (msg.includes('publish_public_hunt_share') || msg.includes('public_hunt_shares') || msg.includes('does not exist')) {
      showToast('Applique la migration Supabase public_hunt_shares', 'error', 4500);
    } else {
      showToast('Impossible d’activer le lien live', 'error', 2800);
    }
  }
}

async function disablePublicHuntLiveLink() {
  const hunt = activeHunt();
  if (!hunt || !isCloudUser()) return;
  const c = getAuthClient();
  if (c) {
    try {
      await cloudCall('sync', () => c.rpc('disable_public_hunt_share', { p_hunt_id: String(hunt.id) }), { retries: 1, timeoutMs: 10000, quiet: true });
    } catch (_) {}
  }
  hunt.publicShareEnabled = false;
  hunt.publicShareSlug = '';
  writeLocalCache();
  updatePublicLiveButtons(hunt);
  showToast('Lien live désactivé', 'info', 2200);
}

async function copyPublicHuntLiveLink() {
  const hunt = activeHunt();
  if (hunt?.publicShareEnabled && hunt?.publicShareSlug) {
    const url = getPublicHuntLiveUrl(hunt.publicShareSlug);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      showToast('Lien live copié', 'success', 1800);
    } catch (_) {
      showToast(url, 'info', 5000);
    }
    return;
  }
  await enablePublicHuntLiveLink();
}

function encodeSharePayload(payload) {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); } catch (_) { return ''; }
}
function decodeSharePayload(code) {
  const text = decodeURIComponent(escape(atob(String(code || '').trim())));
  return JSON.parse(text);
}
async function exportShareCode() {
  const hunt = activeHunt();
  if (!hunt) { showToast('Sélectionne un hunt à partager', 'error'); return; }
  const payload = {
    format: 'hugotaslot-share-v1',
    sharedAt: Date.now(),
    hunt: {
      ...hunt,
      readOnlyShared: true
    }
  };
  const code = encodeSharePayload(payload);
  if (!code) { showToast('Impossible de générer le code de partage', 'error'); return; }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
      showToast('Code de partage copié', 'success', 1700);
      return;
    }
  } catch (_) {}
  prompt('Code de partage (copie-le)', code);
}
async function importShareCode() {
  if (!requireWriteAccess('Import share bloqué', { ignoreReadOnlyHunt: true })) return;
  const raw = prompt('Colle le code de partage');
  if (!raw) return;
  try {
    const parsed = decodeSharePayload(raw);
    if (!parsed || parsed.format !== 'hugotaslot-share-v1' || !parsed.hunt || !Array.isArray(parsed.hunt.bonuses)) {
      showToast('Code de partage invalide', 'error');
      return;
    }
    const shared = parsed.hunt;
    const ok = await confirmRich(
      'Importer hunt partagé (lecture seule)',
      `<div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);line-height:1.5;">
        Hunt: ${escapeHtml(shared.name || 'Hunt partagé')}<br>
        Bonus: ${Array.isArray(shared.bonuses) ? shared.bonuses.length : 0}<br>
        Casino: ${escapeHtml(getCasinoLabel(getCasinoKey(shared.casino || 'gamdom')))}<br>
        Mode: lecture seule
      </div>`,
      'IMPORTER',
      'ANNULER'
    );
    if (!ok) return;
    const hunt = {
      id: uuidLike(),
      name: `${String(shared.name || 'Hunt partagé').slice(0, 64)} (shared)`,
      casino: getCasinoKey(shared.casino || 'gamdom'),
      currency: shared.currency || 'EUR',
      startBalance: Number(shared.startBalance || 0),
      startBalanceEUR: Number(shared.startBalanceEUR || toEUR(Number(shared.startBalance || 0), shared.currency || 'EUR')),
      createdAt: Date.now(),
      readOnlyShared: true,
      bonuses: []
    };
    for (const b of shared.bonuses || []) {
      const stakeN = Number(b.stake || 0);
      if (!Number.isFinite(stakeN) || stakeN <= 0) continue;
      const row = {
        id: uid(),
        slotId: b.slotId || uid(),
        slotName: b.slotName || b.nom || 'Slot',
        slotProvider: b.slotProvider || b.provider || '',
        slotImage: b.slotImage || b.image || '',
        stake: stakeN,
        win: (b.win === null || b.win === undefined || !Number.isFinite(Number(b.win)) || Number(b.win) < 0) ? null : Number(b.win),
        bonusType: normalizeBonusType(b.bonusType),
        gamdomUrl: b.gamdomUrl || ''
      };
      if (!huntBonusMachineConflict(hunt, row)) hunt.bonuses.push(row);
    }
    setUndoSnapshot('import share');
    state.hunts.push(hunt);
    state.activeHuntId = hunt.id;
    save();
    renderHuntList();
    selectHunt(hunt.id);
    showToast('Hunt partagé importé (lecture seule)', 'success', 2200);
  } catch (_) {
    showToast('Code de partage invalide ou corrompu', 'error');
  }
}

function importHuntFile(file) {
  if (!requireWriteAccess('Import hunt bloqué', { ignoreReadOnlyHunt: true })) return;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'));
      const imported = parsed?.hunt || parsed;
      const format = String(parsed?.format || '');
      const schemaVersion = Number(parsed?.schemaVersion || 1);
      if (format && !['hugotaslot-hunt-v2', 'hugotaslot-hunt-v3'].includes(format)) {
        showToast('Format de fichier non supporté', 'error');
        return;
      }
      if (!imported || typeof imported !== 'object' || !Array.isArray(imported.bonuses)) {
        showToast('Fichier hunt invalide', 'error');
        return;
      }
      const bonusRows = imported.bonuses || [];
      const invalidRows = bonusRows.filter((b) => !Number.isFinite(Number(b.stake || 0)) || Number(b.stake || 0) <= 0).length;
      const invalidWins = bonusRows.filter((b) => b.win !== null && b.win !== undefined && (!Number.isFinite(Number(b.win)) || Number(b.win) < 0)).length;
      const previewName = imported.name || `Hunt importé #${state.hunts.length + 1}`;
      const previewCurrency = imported.currency || 'EUR';
      const previewCasino = getCasinoKey(imported.casino || inferCasinoFromBonuses(imported.bonuses));
      const previewSchema = schemaVersion || 1;
      const previewRows = bonusRows.slice(0, 20).map((b, i) => ({
        i: i + 1,
        slot: String(b.slotName || b.nom || 'Slot'),
        provider: String(b.slotProvider || b.provider || ''),
        stake: Number(b.stake || 0),
        win: (b.win === null || b.win === undefined) ? null : Number(b.win),
        type: normalizeBonusType(b.bonusType)
      }));
      const rowsHtml = previewRows.length
        ? previewRows.map((r) => `
            <tr>
              <td style="padding:6px;border-top:1px solid var(--border);">${r.i}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${escapeHtml(r.slot.slice(0, 28))}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${escapeHtml((r.provider || '—').slice(0, 18))}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${Number(r.stake || 0).toFixed(2)}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${r.win === null || !Number.isFinite(r.win) ? '—' : Number(r.win).toFixed(2)}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${escapeHtml(r.type)}</td>
            </tr>
          `).join('')
        : `<tr><td colspan="6" style="padding:8px;border-top:1px solid var(--border);">Aucune ligne</td></tr>`;
      const ok = await confirmRich(
        'Prévisualisation import hunt',
        `
          <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);line-height:1.5;margin-bottom:8px;">
            Nom: ${escapeHtml(previewName)}<br>
            Devise: ${escapeHtml(previewCurrency)} · Casino: ${escapeHtml(previewCasino)} · Schema: v${previewSchema}<br>
            Bonus: ${bonusRows.length} · Mises invalides: ${invalidRows} · Gains invalides: ${invalidWins}
          </div>
          <div style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px;">
            <table style="width:100%;border-collapse:collapse;font-family:'Share Tech Mono',monospace;font-size:10px;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:6px;">#</th>
                  <th style="text-align:left;padding:6px;">Slot</th>
                  <th style="text-align:left;padding:6px;">Provider</th>
                  <th style="text-align:left;padding:6px;">Mise</th>
                  <th style="text-align:left;padding:6px;">Gain</th>
                  <th style="text-align:left;padding:6px;">Type</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          <div style="margin-top:8px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);">
            Aperçu limité aux 20 premières lignes.
          </div>
        `,
        'IMPORTER',
        'ANNULER'
      );
      if (!ok) return;
      setUndoSnapshot('import');
      const hunt = {
        id: uuidLike(),
        name: imported.name ? `${imported.name} (import)` : `Hunt importé #${state.hunts.length + 1}`,
        casino: getCasinoKey(imported.casino || inferCasinoFromBonuses(imported.bonuses)),
        currency: imported.currency || 'EUR',
        startBalance: Number(imported.startBalance || 0),
        startBalanceEUR: Number(imported.startBalanceEUR || toEUR(Number(imported.startBalance || 0), imported.currency || 'EUR')),
        createdAt: Date.now(),
        bonuses: []
      };
      for (const b of imported.bonuses || []) {
        if (Number(b.stake || 0) <= 0) continue;
        const row = {
          id: uid(),
          slotId: b.slotId || b.id || uid(),
          slotName: b.slotName || b.nom || 'Slot',
          slotProvider: b.slotProvider || b.provider || '',
          slotImage: b.slotImage || b.image || '',
          stake: Number(b.stake || 0),
          win: (b.win === null || b.win === undefined || !Number.isFinite(Number(b.win)) || Number(b.win) < 0) ? null : Number(b.win || 0),
          bonusType: normalizeBonusType(b.bonusType),
          gamdomUrl: b.gamdomUrl || ''
        };
        if (!huntBonusMachineConflict(hunt, row)) hunt.bonuses.push(row);
      }
      state.hunts.push(hunt);
      state.activeHuntId = hunt.id;
      save();
      renderHuntList();
      selectHunt(hunt.id);
      showToast('Hunt importé avec succès', 'success');
    } catch {
      showToast('Erreur de lecture du fichier', 'error');
    }
  };
  reader.readAsText(file);
}

document.getElementById('btn-export-hunt').addEventListener('click', exportActiveHunt);
const btnExportHuntImage = document.getElementById('btn-export-hunt-image');
if (btnExportHuntImage) btnExportHuntImage.addEventListener('click', () => { exportActiveHuntImage().catch(() => {}); });
const btnExportHuntPdf = document.getElementById('btn-export-hunt-pdf');
if (btnExportHuntPdf) btnExportHuntPdf.addEventListener('click', () => { exportActiveHuntPdf(); });
const btnLiveHunt = document.getElementById('btn-live-hunt');
if (btnLiveHunt) btnLiveHunt.addEventListener('click', () => { copyPublicHuntLiveLink().catch(() => {}); });
const btnStopLiveHunt = document.getElementById('btn-stop-live-hunt');
if (btnStopLiveHunt) btnStopLiveHunt.addEventListener('click', () => { disablePublicHuntLiveLink().catch(() => {}); });
document.getElementById('btn-import-hunt').addEventListener('click', () => document.getElementById('hunt-import-input').click());
document.getElementById('btn-share-hunt').addEventListener('click', exportShareCode);
document.getElementById('btn-import-share').addEventListener('click', importShareCode);
document.getElementById('btn-save-template').addEventListener('click', saveActiveHuntAsTemplate);
document.getElementById('btn-bulk-clear-opened').addEventListener('click', bulkClearOpenedBonuses);
document.getElementById('btn-bulk-reset-wins').addEventListener('click', bulkResetBonusWins);
document.getElementById('hunt-import-input').addEventListener('change', (e) => {
  importHuntFile(e.target.files && e.target.files[0]);
  e.target.value = '';
});
document.getElementById('btn-undo-action').addEventListener('click', runUndo);
document.getElementById('btn-redo-action').addEventListener('click', runRedo);
document.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key !== 'z' && key !== 'y') return;
  const tag = (e.target && e.target.tagName) ? e.target.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea') return;
  if (key === 'y' || (key === 'z' && e.shiftKey)) {
    e.preventDefault();
    runRedo();
  } else {
    e.preventDefault();
    runUndo();
  }
});

// ═══════════════════════════════════════════════
//  HUNTS SIDEBAR
// ═══════════════════════════════════════════════
function renderHuntList() {
  const list = document.getElementById('hunt-list');
  const empty = document.getElementById('hunts-empty');
  const qEl = document.getElementById('hunt-filter-q');
  if (qEl && document.activeElement !== qEl) qEl.value = state.huntListView?.q || '';
  list.querySelectorAll('.hunt-item').forEach(e => e.remove());
  if (state.hunts.length === 0) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  const q = String(state.huntListView?.q || '').trim().toLowerCase();

  const shown = state.hunts.slice().reverse().filter((hunt) => {
    const base = String(hunt.name || '').toLowerCase();
    const qOk = !q || base.includes(q);
    return qOk;
  });
  shown.forEach(hunt => {
    const completed = hunt.bonuses.filter(b => b.win !== null).length;
    const ro = !!hunt.readOnlyShared;
    const metaLabel = ro ? 'RO' : '';
    const div = document.createElement('div');
    div.className = 'hunt-item' + (hunt.id === state.activeHuntId ? ' active' : '');
    div.dataset.id = hunt.id;
    const date = new Date(hunt.createdAt).toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit',year:'2-digit'});
    div.innerHTML = `
      <div class="hunt-item-name">${escapeHtml(hunt.name)}</div>
      <div class="hunt-item-meta">${date} · ${hunt.bonuses.length} bonus · ${completed} ouverts${metaLabel ? ` · ${escapeHtml(metaLabel)}` : ''}</div>
      <div class="hunt-item-actions">
        <button class="hunt-action-btn danger" title="Supprimer" data-del="${escapeHtml(hunt.id)}">🗑</button>
                    </div>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      selectHunt(hunt.id);
    });
    div.querySelector('[data-del]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirm('Supprimer le hunt ?', `"${hunt.name}" sera définitivement supprimé.`);
      if (ok) deleteHunt(hunt.id);
    });
    list.appendChild(div);
  });
  if (!shown.length) empty.style.display = 'flex';
}

function selectHunt(id, opts = {}) {
  state.activeHuntId = id;
  save();
  state._huntWsFp = '';
  if (!opts.skipList) renderHuntList();
  refreshCurrencyInline();
  if (!opts.skipWorkspace) scheduleHuntUI({ loadCatalog: !state.slots?.length, force: true });
  if (typeof maybeOpenPendingSlotPrefill === 'function') maybeOpenPendingSlotPrefill();
  document.getElementById('no-hunt-selected').style.display = 'none';
  document.getElementById('hunt-workspace').classList.remove('hidden');
  document.getElementById('hunt-workspace').style.display = 'flex';
  document.body.classList.remove('hunt-sessions-open');
  const sessionsBtn = document.getElementById('btn-hunt-sessions-toggle');
  if (sessionsBtn) sessionsBtn.setAttribute('aria-expanded', 'false');
  const openBtn = document.getElementById('btn-open-hunt');
  if (openBtn) openBtn.disabled = false;
}
function editHuntMeta(huntId) {
  const hunt = state.hunts.find((h) => h.id === huntId);
  if (!hunt) return;
  const cur = getHuntMeta(huntId);
  const folder = prompt(`Dossier pour "${hunt.name}" (vide = aucun)`, cur.folder || '');
  if (folder === null) return;
  const tagsRaw = prompt('Tags séparés par des virgules (ex: highvol, weekend)', (cur.tags || []).join(', '));
  if (tagsRaw === null) return;
  const tags = String(tagsRaw || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
  setHuntMeta(huntId, { folder, tags });
  renderHuntList();
  showToast('Dossier / tags sauvegardés', 'success', 1300);
}

function deleteHunt(id) {
  // ignoreReadOnlyHunt : supprimer un hunt partagé (lecture seule) doit rester
  // possible — on ne retire que la copie locale, et le check portait de toute
  // façon sur le hunt ACTIF, pas sur celui qu'on supprime.
  if (!requireWriteAccess('Suppression hunt bloquée', { ignoreReadOnlyHunt: true })) return;
  setUndoSnapshot('suppression hunt');
  state.hunts = state.hunts.filter(h => h.id !== id);
  removeHuntMeta(id);
  if (state.activeHuntId === id) {
    state.activeHuntId = state.hunts.length ? state.hunts[state.hunts.length - 1].id : null;
  }
  save();
  renderHuntList();
  if (state.activeHuntId) selectHunt(state.activeHuntId);
  else {
    document.getElementById('no-hunt-selected').style.display = 'flex';
    document.getElementById('hunt-workspace').classList.add('hidden');
    const openBtn = document.getElementById('btn-open-hunt');
    if (openBtn) openBtn.disabled = true;
    updateHeaderStats(null);
  }
  showToast('Hunt supprimé', 'error');
}

// ═══════════════════════════════════════════════
//  NEW HUNT MODAL
// ═══════════════════════════════════════════════
function showNewHuntModal() {
  const modal = document.getElementById('new-hunt-modal');
  modal.classList.remove('hidden');
  document.getElementById('new-hunt-name-input').value = `Hunt #${state.hunts.length + 1}`;
  document.getElementById('new-hunt-bal-input').value = '';
  populateCurrencySelect(document.getElementById('new-hunt-currency'), 'EUR');
  const prefs = getUiPrefs();
  populateCasinoSelect(document.getElementById('new-hunt-casino'), getCasinoKey(prefs.defaultCasino || 'gamdom'));
  renderHuntTemplateGrid();
  updateNewHuntCurrencyHint();
  setTimeout(() => document.getElementById('new-hunt-name-input').focus(), 50);
}
document.getElementById('btn-new-hunt').addEventListener('click', showNewHuntModal);
document.getElementById('new-hunt-cancel').addEventListener('click', () => document.getElementById('new-hunt-modal').classList.add('hidden'));
document.getElementById('new-hunt-confirm').addEventListener('click', createNewHunt);
document.getElementById('new-hunt-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') createNewHunt(); });
document.getElementById('new-hunt-bal-input').addEventListener('input', updateNewHuntCurrencyHint);
document.getElementById('new-hunt-currency').addEventListener('change', updateNewHuntCurrencyHint);
document.getElementById('hunt-filter-q').addEventListener('input', (e) => {
  state.huntListView.q = String(e.target.value || '');
  clearTimeout(huntListFilterDebounce);
  huntListFilterDebounce = setTimeout(() => renderHuntList(), 120);
});

function updateNewHuntCurrencyHint() {
  const currency = document.getElementById('new-hunt-currency').value || 'EUR';
  const bal = parseFloat(document.getElementById('new-hunt-bal-input').value) || 0;
  const eur = toEUR(bal, currency);
  const hint = document.getElementById('new-hunt-eur-hint');
  const sym = document.getElementById('new-hunt-currency-symbol');
  if (sym) sym.textContent = CURRENCY_SYMBOLS[currency] || '€';
  if (hint) hint.textContent = `≈ ${Number(eur).toFixed(2).replace('.', ',')}€`;
}

function createNewHunt() {
  if (!requireWriteAccess('Création hunt bloquée', { ignoreReadOnlyHunt: true })) return;
  const name = document.getElementById('new-hunt-name-input').value.trim() || `Hunt #${state.hunts.length + 1}`;
  const bal = parseFloat(document.getElementById('new-hunt-bal-input').value) || 0;
  const currency = document.getElementById('new-hunt-currency').value || 'EUR';
  const casino = getCasinoKey(document.getElementById('new-hunt-casino')?.value || 'gamdom');
  const tpl = getSelectedNewHuntTemplate();
  const finalBal = tpl ? Number(tpl.startBalance || bal || 100) : bal;
  if (!Number.isFinite(finalBal) || finalBal <= 0) { showToast('Balance de départ invalide', 'error'); return; }
  const hunt = {
    id: uuidLike(),
    name,
    casino: tpl ? getCasinoKey(tpl.casino) : casino,
    currency: tpl ? (tpl.currency || currency) : currency,
    startBalance: finalBal,
    startBalanceEUR: toEUR(finalBal, tpl ? (tpl.currency || currency) : currency),
    createdAt: Date.now(),
    bonuses: []
  };
  if (tpl) {
    for (const b of tpl.bonuses || []) {
      const stakeN = Number(b.stake || 0);
      if (!Number.isFinite(stakeN) || stakeN <= 0) continue;
      const row = {
        id: uid(),
        slotId: b.slotId || uid(),
        slotName: b.slotName || 'Slot',
        slotProvider: b.slotProvider || '',
        slotImage: b.slotImage || '',
        stake: stakeN,
        bonusType: normalizeBonusType(b.bonusType),
        gamdomUrl: b.gamdomUrl || '',
        win: null
      };
      if (!huntBonusMachineConflict(hunt, row)) hunt.bonuses.push(row);
    }
  }
  setUndoSnapshot('création hunt');
  state.hunts.push(hunt);
  document.getElementById('new-hunt-modal').classList.add('hidden');
  save();
  state.activeHuntId = hunt.id;
  renderHuntList();
  refreshCurrencyInline();
  switchPage('hunt');
  document.getElementById('no-hunt-selected').style.display = 'none';
  document.getElementById('hunt-workspace').classList.remove('hidden');
  document.getElementById('hunt-workspace').style.display = 'flex';
  const openBtn = document.getElementById('btn-open-hunt');
  if (openBtn) openBtn.disabled = false;
  scheduleHuntUI({ loadCatalog: true, force: true });
  showToast(`Hunt "${name}" créé !`, 'success');
}

async function bulkClearOpenedBonuses() {
  if (!requireWriteAccess('Suppression bonus bloquée')) return;
  const hunt = activeHunt();
  if (!hunt) return;
  const count = (hunt.bonuses || []).filter((b) => b.win !== null).length;
  if (!count) { showToast('Aucun bonus ouvert à supprimer', 'info'); return; }
  const ok = await confirm('Supprimer les bonus ouverts ?', `${count} bonus seront retirés du hunt.`);
  if (!ok) return;
  setUndoSnapshot('bulk clear opened');
  hunt.bonuses = (hunt.bonuses || []).filter((b) => b.win === null);
  save();
  renderHuntWorkspace();
  showToast(`${count} bonus ouverts supprimés`, 'success');
}
async function bulkResetBonusWins() {
  if (!requireWriteAccess('Reset gains bloqué')) return;
  const hunt = activeHunt();
  if (!hunt) return;
  const count = (hunt.bonuses || []).filter((b) => b.win !== null).length;
  if (!count) { showToast('Aucun gain à reset', 'info'); return; }
  const ok = await confirm('Reset des gains ?', `${count} bonus repassent en "à ouvrir".`);
  if (!ok) return;
  setUndoSnapshot('bulk reset wins');
  (hunt.bonuses || []).forEach((b) => { b.win = null; });
  save();
  renderHuntWorkspace();
  showToast(`${count} gains réinitialisés`, 'success');
}

// ═══════════════════════════════════════════════
//  ADD BONUS MODAL
// ═══════════════════════════════════════════════
function openAddModal(slot) {
  if (!state.activeHuntId) { showToast('Sélectionne ou crée un hunt d\'abord', 'error'); return; }
  state.pendingSlot = slot;
  const name = slot.nom || slot.name || slot.title || slot.Name || 'Slot';
  const prov = slot.provider || slot.Provider || '';
  const img = normalizeSlotImageUrl(slot.image || slot.img || slot.thumbnail || '');

  document.getElementById('modal-name').textContent = name;
  document.getElementById('modal-prov').textContent = prov.toUpperCase();
  const imgEl = document.getElementById('modal-img');
  if (img && isSafeUrl(img)) {
    imgEl.referrerPolicy = 'no-referrer';
    imgEl.src = img;
    imgEl.style.display = 'block';
  } else { imgEl.style.display = 'none'; }

  document.getElementById('modal-stake-input').value = '';
  document.getElementById('modal-bonus-type').value = 'normal';
  document.getElementById('modal-gamdom-url').value = '';
  document.getElementById('add-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-stake-input').focus(), 80);
}

document.getElementById('modal-close').addEventListener('click', closeAddModal);
document.getElementById('modal-cancel').addEventListener('click', closeAddModal);
document.getElementById('add-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeAddModal(); });
document.getElementById('modal-confirm').addEventListener('click', confirmAddBonus);
document.getElementById('modal-stake-input').addEventListener('keydown', e => { if (e.key === 'Enter') confirmAddBonus(); });

function closeAddModal() { document.getElementById('add-modal').classList.add('hidden'); state.pendingSlot = null; }

function confirmAddBonus() {
  if (!requireWriteAccess('Ajout bonus bloqué')) return;
  if (!state.pendingSlot) return;
  const stake = parseFloat(document.getElementById('modal-stake-input').value);
  if (isNaN(stake) || stake <= 0) { showToast('Entre une mise valide !', 'error'); return; }
  const bonusType = String(document.getElementById('modal-bonus-type')?.value || 'normal').toLowerCase();
  const gamdomUrl = String(document.getElementById('modal-gamdom-url')?.value || '').trim();
  const hunt = activeHunt();
  const slot = state.pendingSlot;
  const slotNameResolved = slot.nom || slot.name || slot.title || slot.Name || 'Slot';
  let resolvedGo = gamdomUrl;
  if (!resolvedGo) {
    const fromSlot = String(slot.gamdomUrl || slot.gamdom_url || '').trim();
    if (getCasinoKey(hunt?.casino) === 'gamdom') {
      if (isDirectGamePlayUrl(fromSlot)) resolvedGo = fromSlot;
      else resolvedGo = gamdomPlayUrlFromCatalogSlot(slot) || '';
      if (!resolvedGo && fromSlot && !isGamdomNonDirectStoredUrl(fromSlot)) resolvedGo = fromSlot;
      if (!resolvedGo) resolvedGo = buildCasinoSlotUrl(hunt?.casino, slotNameResolved);
    } else {
      resolvedGo = fromSlot || buildCasinoSlotUrl(hunt?.casino, slotNameResolved);
    }
  }
  const bonus = {
    id: uid(),
    slotId: slot.id || slot.Id,
    slotName: slotNameResolved,
    slotProvider: slot.provider || slot.Provider || '',
    slotImage: normalizeSlotImageUrl(slot.image || slot.img || slot.thumbnail || ''),
    stake,
    bonusType: ['normal', 'bounty', 'epic'].includes(bonusType) ? bonusType : 'normal',
    gamdomUrl: resolvedGo,
    win: null
  };
  if (huntBonusMachineConflict(hunt, bonus)) {
    showToast('Cette machine est déjà dans le hunt', 'error');
    return;
  }
  setUndoSnapshot('ajout bonus');
  hunt.bonuses.push(bonus);
  save();
  closeAddModal();
  renderHuntWorkspace();
  showToast(`${bonus.slotName} ajouté (${formatBonusTypeLabel(bonus.bonusType)}) !`, 'success');
}

function createCustomSlotBonus() {
  if (!requireWriteAccess('Ajout slot custom bloqué')) return;
  const hunt = activeHunt();
  if (!hunt) { showToast('Sélectionne ou crée un hunt d\'abord', 'error'); return; }
  const name = String(document.getElementById('slot-create-name')?.value || '').trim();
  const providerRaw = String(document.getElementById('slot-create-provider')?.value || '').trim();
  const stakeRaw = String(document.getElementById('slot-create-stake')?.value || '').trim();
  const typeRaw = String(document.getElementById('slot-create-type')?.value || 'normal').toLowerCase();
  const stake = Number(stakeRaw.replace(',', '.'));
  if (!name) { showToast('Entre un nom de slot', 'error'); return; }
  if (!Number.isFinite(stake) || stake <= 0) { showToast('Entre une mise valide', 'error'); return; }
  const bonusType = ['normal', 'bounty', 'epic'].includes(typeRaw) ? typeRaw : 'normal';

  // Si le nom + provider correspond à une entrée catalogue, on récupère l’id, l’image et le lien direct.
  const catHit = findCatalogSlotForBonus({ slotName: name, slotProvider: providerRaw, slotId: '' });
  const slotId = catHit ? String(catHit.id || catHit.Id || `custom_${uid()}`) : `custom_${uid()}`;
  const slotImg = catHit ? normalizeSlotImageUrl(catHit.image || catHit.img || catHit.thumbnail || '') : '';
  const providerResolved = providerRaw || (catHit ? String(catHit.provider || catHit.Provider || '') : '') || 'CUSTOM';

  let customGo = '';
  if (catHit) customGo = gamdomPlayUrlFromCatalogSlot(catHit);
  if (!customGo && getCasinoKey(hunt?.casino) === 'gamdom' && providerRaw) {
    customGo = gamdomSeoCasinoUrlFromNameProvider(name, providerRaw);
  }
  if (!customGo) customGo = buildCasinoSlotUrl(hunt?.casino, name);

  const customRow = {
    id: uid(),
    slotId,
    slotName: name,
    slotProvider: providerResolved,
    slotImage: slotImg,
    stake,
    bonusType,
    gamdomUrl: customGo,
    win: null
  };
  if (huntBonusMachineConflict(hunt, customRow)) {
    showToast('Cette machine est déjà dans le hunt', 'error');
    return;
  }
  setUndoSnapshot('ajout slot custom');
  hunt.bonuses.push(customRow);
  save();
  renderHuntWorkspace();
  const box = document.getElementById('slot-create-empty');
  if (box) box.style.display = 'none';
  const stakeInput = document.getElementById('slot-create-stake');
  if (stakeInput) stakeInput.value = '';
  const provInput = document.getElementById('slot-create-provider');
  if (provInput) provInput.value = '';
  const labelHint = catHit ? ' (lien Gamdom direct)' : (providerRaw ? ' (lien Gamdom estimé)' : '');
  showToast(`Slot "${name}" ajoutée au hunt${labelHint}`, 'success');
}

// ═══════════════════════════════════════════════
//  HUNT WORKSPACE RENDER
// ═══════════════════════════════════════════════
function renderHuntWorkspace(force = false) {
  if (!force && (__activePage !== 'hunt' || state.huntTab !== 'workspace')) return;
  const hunt = activeHunt();
  if (!hunt) return;
  refreshCurrencyInline();

  const _openBtn = document.getElementById('btn-open-hunt');
  if (_openBtn) {
    _openBtn.disabled = false;
    _openBtn.title = (hunt.bonuses && hunt.bonuses.length)
      ? 'Ouvrir le rouleau de bonus'
      : 'Ajoute des bonus avant d’ouvrir le hunt';
  }
  const _openBtnHeader = document.getElementById('btn-open-hunt-header');
  if (_openBtnHeader) _openBtnHeader.disabled = false;

  document.getElementById('current-hunt-name').textContent = hunt.name;
  const created = new Date(hunt.createdAt);
  const dateStr = created.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = created.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const eurHint = Number(hunt.startBalanceEUR || toEUR(hunt.startBalance || 0, hunt.currency || 'EUR')).toFixed(0);
  document.getElementById('current-hunt-date').textContent =
    `${dateStr} ${timeStr} · ${fmt(hunt.startBalance, hunt.currency)} (≈${eurHint}€)`;

  updateHeaderStats(hunt);
  renderBonusList(hunt);
  document.getElementById('tab-bonus-count').textContent = hunt.bonuses.length;
  updatePublicLiveButtons(hunt);

  // refresh grid indicators
  if (document.getElementById('slots-grid').children.length > 0) {
    const addedIds = new Set(hunt.bonuses.map(b => b.slotId));
    document.querySelectorAll('.slot-card').forEach(card => {
      const dot = card.querySelector('.green-dot');
      const id = card.dataset.id;
      if (addedIds.has(id) && !dot) {
        const d = document.createElement('div');
        d.className = 'green-dot';
        d.style.cssText = 'position:absolute;top:6px;left:6px;width:10px;height:10px;background:var(--green);border-radius:50%;box-shadow:0 0 6px var(--green);';
        card.appendChild(d);
      } else if (!addedIds.has(id) && dot) dot.remove();
    });
  }
  state._huntWsFp = huntWorkspaceFingerprint();
}

function updateHeaderStats(hunt) {
  if (!hunt) {
    ['stat-count','stat-total-win','stat-total-money','stat-profit','stat-be-avg'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = '—';
      if (el.classList.contains('stat-value')) el.className = 'stat-value';
    });
    const hintEl = document.getElementById('stat-profit-hint');
    if (hintEl) hintEl.textContent = 'Ajoute des bonus pour lancer le hunt.';
    const subEl = document.getElementById('stat-bonus-sub');
    if (subEl) subEl.textContent = '0 ouverts';
    return;
  }
  const { bonuses } = hunt;
  const startBalance = Number(hunt.startBalance || 0);
  const totalStake = bonuses.reduce((s, b) => s + Number(b.stake || 0), 0);
  const won = bonuses.filter(b => b.win !== null && !isNaN(Number(b.win)));
  const totalWin = won.reduce((s, b) => s + Number(b.win || 0), 0);
  const profit = totalWin - startBalance;
  const openedCount = bonuses.filter(b => b.win !== null).length;

  const countEl = document.getElementById('stat-count');
  if (countEl) countEl.textContent = bonuses.length;
  const subEl = document.getElementById('stat-bonus-sub');
  if (subEl) subEl.textContent = `${openedCount}/${bonuses.length} ouverts`;
  const winEl = document.getElementById('stat-total-win');
  if (winEl) winEl.textContent = fmt(totalWin);
  const totalMoneyEl = document.getElementById('stat-total-money');
  if (totalMoneyEl) totalMoneyEl.textContent = fmt(startBalance);

  const profEl = document.getElementById('stat-profit');
  if (profEl) {
    if (profit >= 0) { profEl.textContent = '+' + fmt(profit); profEl.className = 'stat-value green'; }
    else { profEl.textContent = fmt(profit); profEl.className = 'stat-value red'; }
  }
  const hintEl = document.getElementById('stat-profit-hint');
  if (hintEl) {
    hintEl.textContent = bonuses.length
      ? `${fmt(startBalance)} départ · ${fmt(totalWin)} gains`
      : 'Ajoute des bonus pour lancer le hunt.';
  }

  const beEl = document.getElementById('stat-be-avg');
  if (!beEl) return;
  if (bonuses.length === 0 || totalStake <= 0) { beEl.textContent = '—'; beEl.className = 'stat-value'; }
  else {
    const avgBe = Number(hunt.startBalance || 0) / totalStake;
    beEl.textContent = `${avgBe.toFixed(4).replace('.', ',')}×`;
    beEl.className = 'stat-value gold';
  }
}

function getProfitMotivation(profit, totalStake, totalWin) {
  if (totalStake <= 0) return 'Charge le hunt, on va allumer la session.';
  if (profit >= 0) {
    if (profit === 0) return 'Break-even atteint, maintenant on push le vert.';
    if (profit < totalStake * 0.1) return 'Tu es dans le vert, clean et efficace.';
    if (profit < totalStake * 0.3) return 'Gros momentum, continue comme un boss.';
    return 'Run monstrueux, machine de guerre activée !';
  }
  const missingPct = ((totalStake - totalWin) / Math.max(totalStake, 0.01)) * 100;
  if (missingPct <= 1) return 'Allez encore un peu champion, le vert est juste là !';
  if (missingPct <= 5) return 'Presque break-even, encore 1 hit et ça bascule.';
  if (missingPct <= 15) return 'Belle remontée, le comeback est lancé.';
  if (missingPct <= 35) return 'Session standard, on prépare le gros multiplicateur.';
  return 'Début de run compliqué, mais un max win peut tout retourner.';
}

function normalizeBonusType(type) {
  const t = String(type || 'normal').toLowerCase();
  return ['normal', 'bounty', 'epic'].includes(t) ? t : 'normal';
}

function formatBonusTypeLabel(type) {
  const t = normalizeBonusType(type);
  if (t === 'bounty') return 'BOUNTY';
  if (t === 'epic') return 'EPIC BONUS';
  return 'NORMAL';
}

function renderBonusList(hunt) {
  const list = document.getElementById('bonus-list');
  const empty = document.getElementById('bonus-list-empty');
  list.innerHTML = '';

  if (hunt.bonuses.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  let shown = hunt.bonuses.map((bonus, i) => ({ bonus, i }));
  const { status, type, sort, q, provider, minStake, maxStake, winFilter } = state.bonusView;
  const providerFilterEl = document.getElementById('bonus-provider-filter');
  if (providerFilterEl) {
    const providers = [...new Set((hunt.bonuses || []).map((b) => String(b.slotProvider || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const hash = providers.join('|');
    if (hash !== __bonusProviderHash) {
      __bonusProviderHash = hash;
      providerFilterEl.innerHTML = ['<option value="">Provider: tous</option>']
        .concat(providers.map((p) => `<option value="${escapeHtml(p.toLowerCase())}">${escapeHtml(p)}</option>`))
        .join('');
    }
    const want = String(provider || '').toLowerCase();
    if (providerFilterEl.value !== want) providerFilterEl.value = want;
  }
  if (status === 'pending') shown = shown.filter(x => x.bonus.win === null);
  if (status === 'opened') shown = shown.filter(x => x.bonus.win !== null);
  const wf = winFilter || (status === 'positive' || status === 'negative' ? status : 'all');
  if (wf === 'positive') shown = shown.filter(x => Number(x.bonus.win || 0) > 0);
  if (wf === 'negative') shown = shown.filter(x => x.bonus.win !== null && Number(x.bonus.win || 0) <= 0);
  if (type !== 'all') shown = shown.filter(x => normalizeBonusType(x.bonus.bonusType) === type);
  if (provider) shown = shown.filter(({ bonus }) => String(bonus.slotProvider || '').toLowerCase() === provider);
  const minStakeNum = Number(String(minStake || '').replace(',', '.'));
  const maxStakeNum = Number(String(maxStake || '').replace(',', '.'));
  if (Number.isFinite(minStakeNum) && minStake !== '') shown = shown.filter(({ bonus }) => Number(bonus.stake || 0) >= minStakeNum);
  if (Number.isFinite(maxStakeNum) && maxStake !== '') shown = shown.filter(({ bonus }) => Number(bonus.stake || 0) <= maxStakeNum);
  if (q) {
    shown = shown.filter(({ bonus }) => {
      const n = String(bonus.slotName || '').toLowerCase();
      const p = String(bonus.slotProvider || '').toLowerCase();
      return n.includes(q) || p.includes(q);
    });
  }
  if (sort === 'stake_desc') shown.sort((a, b) => Number(b.bonus.stake || 0) - Number(a.bonus.stake || 0));
  if (sort === 'stake_asc') shown.sort((a, b) => Number(a.bonus.stake || 0) - Number(b.bonus.stake || 0));
  if (sort === 'win_desc') shown.sort((a, b) => Number(b.bonus.win ?? -Infinity) - Number(a.bonus.win ?? -Infinity));
  if (sort === 'win_asc') shown.sort((a, b) => Number(a.bonus.win ?? Infinity) - Number(b.bonus.win ?? Infinity));
  if (sort === 'multi_desc') shown.sort((a, b) => (Number(b.bonus.win || 0) / Math.max(0.01, Number(b.bonus.stake || 0))) - (Number(a.bonus.win || 0) / Math.max(0.01, Number(a.bonus.stake || 0))));
  if (sort === 'multi_asc') shown.sort((a, b) => (Number(a.bonus.win || 0) / Math.max(0.01, Number(a.bonus.stake || 0))) - (Number(b.bonus.win || 0) / Math.max(0.01, Number(b.bonus.stake || 0))));
  if (sort === 'name_asc') shown.sort((a, b) => String(a.bonus.slotName || '').localeCompare(String(b.bonus.slotName || ''), 'fr'));

  if (shown.length === 0) {
    empty.style.display = 'flex';
    empty.querySelector('.empty-text').textContent = 'AUCUN BONUS DANS CE FILTRE';
    return;
  }
  empty.style.display = 'none';
  empty.querySelector('.empty-text').textContent = 'AUCUN BONUS AJOUTÉ';

  shown.forEach(({ bonus, i }) => {
    const bonusType = normalizeBonusType(bonus.bonusType);
    const beMultiplier = beRequiredMultiplier(hunt, Number(bonus.stake || 0));
    const multi = bonus.win !== null ? (bonus.win / bonus.stake).toFixed(1) : null;
    const beRequiredAmount = Number(hunt.startBalance || 0);
    const isGood = bonus.win !== null && bonus.win >= beRequiredAmount;
    const row = document.createElement('div');
    row.className = 'bonus-row' + (bonus.win !== null ? ' completed' : '');

    const safeSlotName = escapeHtml(bonus.slotName || '');
    const normalizedSlotImg = resolveBonusImageUrl(bonus);
    const safeSlotImg = isSafeUrl(normalizedSlotImg) ? escapeHtml(normalizedSlotImg) : '';
    const safeProv = escapeHtml(String(bonus.slotProvider || '').toUpperCase());
    row.innerHTML = `
      <div class="bonus-pos-bar"></div>
      <div class="bonus-thumb">
        ${safeSlotImg
          ? `<img src="${safeSlotImg}" alt="${safeSlotName}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="bonus-thumb-placeholder" style="display:none"><img src="./assets/virtual-token.svg" class="ui-logo-icon" alt="slot"></div>`
          : `<div class="bonus-thumb-placeholder"><img src="./assets/virtual-token.svg" class="ui-logo-icon" alt="slot"></div>`}
        <div class="bonus-thumb-pos">#${i+1}</div>
        </div>
      <div class="bonus-info">
        <div class="bonus-slot-name">${safeSlotName}</div>
        <div class="bonus-slot-prov">${safeProv}</div>
        <span class="bonus-stake-badge">MISE: ${fmt(bonus.stake)}</span>
        <span class="bonus-type-badge ${escapeHtml(bonusType)}">${escapeHtml(formatBonusTypeLabel(bonusType))}</span>
      </div>
      <div class="bonus-be-block">
        <div class="bonus-be-label">BE REQUIS</div>
        <div class="bonus-be-val">${beMultiplier.toFixed(4).replace('.', ',')}×</div>
      </div>
      <div class="bonus-gain-block">
        <div class="bonus-gain-label">GAIN</div>
        <div class="bonus-win ${bonus.win === null ? 'none' : ('set' + (isGood ? ' good' : ''))}">${bonus.win === null ? '0.00€' : fmt(bonus.win)}</div>
        ${multi !== null ? `<div class="bonus-multi ${isGood ? 'hot' : ''}">${multi}×</div>` : ''}
      </div>
      <div class="bonus-row-actions">
        <button class="row-action-btn" title="Go to Slot (${escapeHtml(getCasinoLabel(hunt?.casino))})" data-gamdom="${i}"><img src="./assets/virtual-token.svg" class="sidebar-tab-icon-logo" alt="slot"></button>
        <button class="row-action-btn" title="Ouvrir dans le rouleau" data-edit="${i}">✎</button>
        <button class="row-action-btn danger" title="Supprimer" data-remove="${i}">✕</button>
      </div>
    `;
    row.querySelector('[data-gamdom]').addEventListener('click', (e) => {
      e.stopPropagation();
      const url = getBonusGoToUrl(hunt, bonus);
      window.open(url, '_blank');
    });
    row.querySelector('[data-edit]').addEventListener('click', () => openOpener(i));
    row.querySelector('[data-remove]').addEventListener('click', async () => {
      const ok = await confirm('Supprimer ce bonus ?', `"${bonus.slotName}" sera retiré du hunt.`);
      if (ok) { setUndoSnapshot('suppression bonus'); hunt.bonuses.splice(i, 1); save(); renderHuntWorkspace(); showToast('Bonus supprimé', 'error'); }
    });
    list.appendChild(row);
  });
}

// ═══════════════════════════════════════════════
//  OPENER
// ═══════════════════════════════════════════════
function openHuntFromButton() {
  const hunt = activeHunt();
  if (!hunt) {
    showToast('Sélectionne ou crée un hunt d’abord', 'error');
    return;
  }
  if (!hunt.bonuses || hunt.bonuses.length === 0) {
    showToast('Ajoute au moins un bonus avant d’ouvrir le hunt', 'error', 3200);
    try {
      const grid = document.getElementById('grid-container') || document.getElementById('slots-grid');
      if (grid && typeof grid.scrollIntoView === 'function') {
        grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const search = document.getElementById('search-input');
      if (search && typeof search.focus === 'function') setTimeout(() => search.focus(), 250);
    } catch (_) {}
    return;
  }
  const firstPending = hunt.bonuses.findIndex(b => b.win === null);
  openOpener(firstPending >= 0 ? firstPending : 0);
}
document.getElementById('btn-open-hunt').addEventListener('click', openHuntFromButton);
const _btnOpenHeader = document.getElementById('btn-open-hunt-header');
if (_btnOpenHeader) _btnOpenHeader.addEventListener('click', openHuntFromButton);
document.getElementById('opener-close').addEventListener('click', closeOpener);
document.getElementById('opener-confirm').addEventListener('click', openerConfirm);
document.getElementById('opener-prev').addEventListener('click', () => openerNav(-1));
document.getElementById('opener-next').addEventListener('click', () => openerNav(1));

// ─── Mini-opener détaché (popup flottant à garder par-dessus le casino) ──
let _miniOpenerWin = null;
let _miniOpenerPipWin = null;
let _miniOpenerWatch = null;
let _miniOpenerBC = null;
let _miniSyncSuppressStorage = false;
let _miniLastInbound = 0;

function isMiniOpenerOpen() {
  try {
    if (_miniOpenerPipWin && !_miniOpenerPipWin.closed) return true;
    if (_miniOpenerWin && !_miniOpenerWin.closed) return true;
  } catch (_) {}
  return false;
}

function supportsDocPip() {
  try { return !!(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function'); } catch (_) { return false; }
}

function broadcastMainMutation(reason) {
  try {
    if (!_miniOpenerBC) return;
    _miniOpenerBC.postMessage({ type: 'hunt-mutation', source: 'main', reason: reason || 'edit', at: Date.now() });
  } catch (_) {}
}

function syncMiniBtnState() {
  const btn = document.getElementById('opener-detach');
  if (!btn) return;
  if (isMiniOpenerOpen()) btn.classList.add('active');
  else btn.classList.remove('active');
}

function reloadHuntsFromLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.hunts)) return false;
    state.hunts = parsed.hunts;
    if (parsed.activeHuntId) state.activeHuntId = parsed.activeHuntId;
    return true;
  } catch (e) { bhWarn('reloadHuntsFromLocalCache fail', e); return false; }
}

function handleExternalHuntMutation(reason) {
  // Évite une boucle si on vient juste d'écrire localement
  const now = Date.now();
  if (now - _miniLastInbound < 80) return;
  _miniLastInbound = now;
  if (!reloadHuntsFromLocalCache()) return;
  try { renderHuntList(); } catch (_) {}
  try { renderHuntWorkspace(); } catch (_) {}
  try {
    const opEl = document.getElementById('opener');
    if (opEl && !opEl.classList.contains('hidden')) renderOpener();
  } catch (_) {}
  // Pousse vers le cloud (si user cloud)
  try {
    if (typeof isCloudUser === 'function' && isCloudUser()) {
      try { localStorage.setItem(LOCAL_SYNCED_KEY, '0'); } catch (_) {}
      if (typeof scheduleCloudSync === 'function') scheduleCloudSync();
    }
  } catch (_) {}
}

function ensureMiniSyncBus() {
  if (_miniOpenerBC) return;
  try {
    _miniOpenerBC = new BroadcastChannel('hm-bh-sync');
    _miniOpenerBC.onmessage = (ev) => {
      const data = ev && ev.data;
      if (!data) return;
      if (data.source !== 'mini') return;
      handleExternalHuntMutation(data.reason);
    };
  } catch (_) { /* pas de BroadcastChannel : on reste sur storage event */ }
  // Storage event (cross-window même origine, fallback compatible)
  window.addEventListener('storage', (ev) => {
    if (ev.key !== STORAGE_KEY) return;
    if (_miniSyncSuppressStorage) { _miniSyncSuppressStorage = false; return; }
    handleExternalHuntMutation('storage');
  });
}

async function openMiniOpenerPip() {
  if (!supportsDocPip()) return false;
  let pip = null;
  try {
    // Pré-fetch du HTML AVANT requestWindow pour réduire le délai de paint dans la PiP.
    // (Note : on n'utilise plus d'iframe pour éviter tout blocage X-Frame-Options/CSP.)
    const htmlPromise = fetch('./mini-opener.html', { credentials: 'same-origin', cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('fetch ' + r.status); return r.text(); });

    pip = await window.documentPictureInPicture.requestWindow({
      width: 440,
      height: 720,
      disallowReturnToOpener: true,
      preferInitialWindowPlacement: true
    });
    _miniOpenerPipWin = pip;

    // Squelette de chargement instantané
    pip.document.open();
    pip.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>BH · Mini Opener</title>
      <style>html,body{margin:0;padding:0;height:100%;background:#020202;color:#9DA2AB;font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:1px;}.l{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}</style>
      </head><body><div class="l">CHARGEMENT…</div></body></html>`);
    pip.document.close();

    let html = '';
    try { html = await htmlPromise; } catch (fe) {
      bhWarn('mini-opener fetch failed', fe);
      pip.document.body.innerHTML = '<div style="padding:24px;color:#ff3d5a;font-family:sans-serif">Impossible de charger le mini-opener. Réessaie ou recharge le site.</div>';
      return true;
    }

    // Réécriture complète du document PiP avec le HTML autonome
    pip.document.open();
    pip.document.write(html);
    pip.document.close();

    pip.addEventListener('pagehide', () => {
      _miniOpenerPipWin = null;
      syncMiniBtnState();
    });
    if (_miniOpenerWatch) clearInterval(_miniOpenerWatch);
    _miniOpenerWatch = setInterval(syncMiniBtnState, 1500);
    showToast('Mini-popup épinglé au-dessus de tout. Garde-le visible pendant que tu joues.', 'success', 3800);
    return true;
  } catch (e) {
    bhWarn('Document PiP refusé', e);
    try { if (pip) pip.close(); } catch (_) {}
    return false;
  }
}

async function openMiniOpener() {
  if (isMiniOpenerOpen()) {
    try { (_miniOpenerPipWin || _miniOpenerWin).focus(); } catch (_) {}
    ensureMiniSyncBus();
    syncMiniBtnState();
    return;
  }

  // 1. Essai prioritaire : Document Picture-in-Picture
  //    -> reste TOUJOURS au premier plan, même quand on clique sur le casino.
  if (supportsDocPip()) {
    const ok = await openMiniOpenerPip();
    if (ok) {
      ensureMiniSyncBus();
      syncMiniBtnState();
      return;
    }
  }

  // 2. Fallback : window.open() (passe derrière quand on focus le casino).
  try {
    const w = window.open('./mini-opener.html', 'hm-mini-opener', 'popup=yes,resizable=yes,width=440,height=720,toolbar=no,menubar=no,location=no,status=no');
    if (!w) {
      showToast('Le navigateur bloque la popup. Autorise les fenêtres pop-up pour ce site.', 'error', 4500);
      return;
    }
    _miniOpenerWin = w;
    try { w.focus(); } catch (_) {}
    if (_miniOpenerWatch) clearInterval(_miniOpenerWatch);
    _miniOpenerWatch = setInterval(syncMiniBtnState, 1500);
    if (supportsDocPip()) {
      showToast('Mini-popup ouvert (mode standard). Active "épingler la fenêtre" via Chrome 120+ pour la garder au-dessus.', 'success', 4500);
    } else {
      showToast('Mini-popup ouvert. Pour le garder au-dessus du casino, utilise Chrome/Edge à jour (mode épinglé auto).', 'success', 4500);
    }
  } catch (e) { showToast('Impossible d’ouvrir la popup', 'error'); bhWarn(e); return; }

  ensureMiniSyncBus();
  syncMiniBtnState();
}

const _btnOpenerDetach = document.getElementById('opener-detach');
if (_btnOpenerDetach) _btnOpenerDetach.addEventListener('click', openMiniOpener);

const _streamerToggle = document.getElementById('opener-streamer-toggle');
if (_streamerToggle) {
  _streamerToggle.checked = isStreamerOverlayEnabled();
  _streamerToggle.addEventListener('change', () => {
    setStreamerOverlayEnabled(_streamerToggle.checked);
    if (_streamerToggle.checked) void openOrFocusStreamerHud();
    else updateOpenerStreamerHud();
  });
}

window.addEventListener('storage', (ev) => {
  if (ev.key !== STREAMER_OVERLAY_KEY) return;
  const t = document.getElementById('opener-streamer-toggle');
  if (!t) return;
  const on = ev.newValue === '1';
  t.checked = on;
  if (!on) closeStreamerHudWin();
});

// On démarre le bus sync dès le chargement pour absorber un mini-popup
// éventuellement ré-ouvert depuis un onglet précédent.
try { ensureMiniSyncBus(); } catch (_) {}

// Quand on sauvegarde localement, on prévient les autres fenêtres ouvertes
// (mini-popup notamment) — ne pas en faire trop : juste un postMessage léger.
const _origSave_forMini = (typeof save === 'function') ? save : null;
if (_origSave_forMini && !window.__saveWrappedForMini) {
  window.__saveWrappedForMini = true;
  // eslint-disable-next-line no-func-assign
  save = function () {
    const r = _origSave_forMini.apply(this, arguments);
    try { _miniSyncSuppressStorage = true; broadcastMainMutation('save'); } catch (_) {}
    return r;
  };
}

document.getElementById('opener-win-input').addEventListener('keydown', e => {
  const kb = getOpenerKeybinds();
  const k = String(e.key || '').toLowerCase();
  if (openerKeyMatch(k, kb.confirm) || k === 'arrowdown') { e.preventDefault(); openerConfirm(); }
  if (openerKeyMatch(k, kb.prev)) { e.preventDefault(); openerNav(-1); }
  if (openerKeyMatch(k, kb.next)) { e.preventDefault(); openerNav(1); }
});

// Auto-sauvegarde du gain dès qu'on tape (anti-perte si une re-render
// arrive depuis la sync cloud pendant la saisie).
let _openerSaveTimer = null;
function persistOpenerInputValue() {
  const hunt = activeHunt();
  if (!hunt || !Array.isArray(hunt.bonuses) || !hunt.bonuses[state.openerIndex]) return;
  const inp = document.getElementById('opener-win-input');
  if (!inp) return;
  const raw = String(inp.value || '').trim().replace(',', '.');
  if (raw === '') return;
  const v = parseFloat(raw);
  if (isNaN(v) || v < 0) return;
  const cur = hunt.bonuses[state.openerIndex].win;
  if (cur === v) return;
  hunt.bonuses[state.openerIndex].win = v;
  if (_openerSaveTimer) clearTimeout(_openerSaveTimer);
  _openerSaveTimer = setTimeout(() => save(), 350);
  try { updateOpenerStreamerHud(); } catch (_) {}
}
document.getElementById('opener-win-input').addEventListener('input', persistOpenerInputValue);
document.getElementById('opener-win-input').addEventListener('blur', () => {
  if (_openerSaveTimer) { clearTimeout(_openerSaveTimer); _openerSaveTimer = null; }
  persistOpenerInputValue();
  save();
});

function openOpener(index) {
  const hunt = activeHunt();
  if (!hunt) return;
  state.openerIndex = Math.max(0, Math.min(index, hunt.bonuses.length - 1));
  document.getElementById('opener').classList.remove('hidden');
  document.getElementById('opener-hunt-label').textContent = hunt.name;
  renderOpener();
}

function closeOpener() {
  // Persiste toute saisie en cours avant de fermer (sécurité anti-perte).
  try {
    if (typeof _openerSaveTimer !== 'undefined' && _openerSaveTimer) {
      clearTimeout(_openerSaveTimer);
      _openerSaveTimer = null;
    }
    if (typeof persistOpenerInputValue === 'function') persistOpenerInputValue();
    save();
  } catch (_) {}
  document.getElementById('opener').classList.add('hidden');
  renderHuntWorkspace();
}

function ensureStreamerHudPipLeaveListener() {
  if (window.__streamerHudPipLeaveBound) return;
  window.__streamerHudPipLeaveBound = true;
  try {
    if (!window.documentPictureInPicture) return;
    documentPictureInPicture.addEventListener('leave', () => {
      try {
        setStreamerOverlayEnabled(false);
        const t = document.getElementById('opener-streamer-toggle');
        if (t) t.checked = false;
      } catch (_) {}
    });
  } catch (_) {}
}

function closeStreamerHudWin() {
  hideInlineStreamerHud();
  try {
    const pipApi = window.documentPictureInPicture;
    if (pipApi?.window && !pipApi.window.closed) {
      try { pipApi.window.close(); } catch (_) {}
    }
  } catch (_) {}
  try {
    if (window.__streamerHudWin && !window.__streamerHudWin.closed) {
      window.__streamerHudWin.close();
    }
    window.__streamerHudWin = null;
  } catch (_) {}
  window.__streamerHudMode = null;
}

function isStreamerHudVisible() {
  try {
    const pip = window.documentPictureInPicture?.window;
    if (pip && !pip.closed) return true;
  } catch (_) {}
  if (window.__streamerHudWin && !window.__streamerHudWin.closed) return true;
  const inline = document.getElementById('streamer-hud-inline');
  return !!(inline && !inline.classList.contains('hidden'));
}

function ensureInlineStreamerHudShell() {
  let el = document.getElementById('streamer-hud-inline');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'streamer-hud-inline';
  el.className = 'streamer-hud-inline hidden';
  el.innerHTML = `
    <div class="streamer-hud-inline-head">
      <span>HUD Stream</span>
      <div class="streamer-hud-inline-actions">
        <button type="button" class="streamer-hud-inline-btn" id="streamer-hud-inline-popout" title="Ouvrir dans une fenêtre">Pop-out</button>
        <button type="button" class="streamer-hud-inline-btn" id="streamer-hud-inline-close" title="Fermer">✕</button>
      </div>
    </div>
    <iframe src="./streamer-hud.html?embed=1" title="HUD Stream HugoTaSlot"></iframe>
  `;
  document.body.appendChild(el);
  el.querySelector('#streamer-hud-inline-close')?.addEventListener('click', () => {
    setStreamerOverlayEnabled(false);
    const t = document.getElementById('opener-streamer-toggle');
    if (t) t.checked = false;
    closeStreamerHudWin();
  });
  el.querySelector('#streamer-hud-inline-popout')?.addEventListener('click', () => {
    hideInlineStreamerHud();
    void openOrFocusStreamerHud({ forcePopup: true });
  });
  return el;
}

function showInlineStreamerHud() {
  const el = ensureInlineStreamerHudShell();
  el.classList.remove('hidden');
  window.__streamerHudMode = 'inline';
}

function hideInlineStreamerHud() {
  const el = document.getElementById('streamer-hud-inline');
  if (el) el.classList.add('hidden');
  if (window.__streamerHudMode === 'inline') window.__streamerHudMode = null;
}

async function openOrFocusStreamerHud(opts) {
  opts = opts || {};
  const toggle = document.getElementById('opener-streamer-toggle');
  const enabled = opts.force || toggle?.checked || isStreamerOverlayEnabled();
  if (!enabled) return;

  if (!opts.forcePopup && isStreamerHudVisible()) {
    if (window.__streamerHudMode === 'inline') showInlineStreamerHud();
    else if (window.__streamerHudWin && !window.__streamerHudWin.closed) {
      try { window.__streamerHudWin.focus(); } catch (_) {}
    }
    return;
  }

  if (opts.forcePopup) hideInlineStreamerHud();

  const pipApi = window.documentPictureInPicture;
  if (!opts.forcePopup && pipApi?.requestWindow) {
    try {
      const existing = pipApi.window;
      if (existing && !existing.closed) {
        try { existing.focus(); } catch (_) {}
        window.__streamerHudMode = 'pip';
        return;
      }
      ensureStreamerHudPipLeaveListener();
      const pipWin = await pipApi.requestWindow({
        width: 440,
        height: 640,
      });
      const pipDoc = pipWin.document;
      const st = pipDoc.createElement('style');
      st.textContent = 'html,body{margin:0;height:100%;background:#020202;}iframe{border:0;width:100%;height:100%;vertical-align:top;}';
      pipDoc.head.appendChild(st);
      pipDoc.body.style.margin = '0';
      pipDoc.body.style.minHeight = '100%';
      const iframe = pipDoc.createElement('iframe');
      iframe.src = new URL('streamer-hud.html', window.location.href).href;
      iframe.title = 'HUD Stream HugoTaSlot';
      iframe.style.cssText = 'border:0;width:100%;height:100%;min-height:400px;display:block;';
      pipDoc.body.appendChild(iframe);
      pipWin.addEventListener('pagehide', () => {
        try {
          setStreamerOverlayEnabled(false);
          const t = document.getElementById('opener-streamer-toggle');
          if (t) t.checked = false;
          try { localStorage.setItem(STREAMER_OVERLAY_KEY, '0'); } catch (_) {}
        } catch (_) {}
        window.__streamerHudMode = null;
      });
      window.__streamerHudMode = 'pip';
      showToast('HUD épinglé (Picture-in-Picture)', 'success', 2400);
      return;
    } catch (e) {
      bhWarn('Document PiP HUD', e);
    }
  }

  try {
    if (window.__streamerHudWin && !window.__streamerHudWin.closed) {
      try { window.__streamerHudWin.focus(); } catch (_) {}
      window.__streamerHudMode = 'popup';
      return;
    }
    const w = window.open(
      './streamer-hud.html',
      'hmStreamerHud',
      'popup=yes,width=440,height=600,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no'
    );
    if (w) {
      window.__streamerHudWin = w;
      window.__streamerHudMode = 'popup';
      return;
    }
  } catch (e) {
    bhWarn('openOrFocusStreamerHud popup', e);
  }

  showInlineStreamerHud();
  if (!window.__hudInlineToastShown) {
    window.__hudInlineToastShown = true;
    showToast(
      'HUD affiché en panneau intégré (popups bloquées). Utilise Pop-out ou l’URL OBS dans Studio si besoin.',
      'info',
      5200
    );
  }
}

function isStreamerOverlayEnabled() {
  try { return localStorage.getItem(STREAMER_OVERLAY_KEY) === '1'; } catch { return false; }
}
function setStreamerOverlayEnabled(on) {
  try { localStorage.setItem(STREAMER_OVERLAY_KEY, on ? '1' : '0'); } catch (_) {}
}

function updateOpenerStreamerHud() {
  const toggle = document.getElementById('opener-streamer-toggle');
  if (!toggle?.checked) {
    closeStreamerHudWin();
    return;
  }
  if (isStreamerHudVisible()) return;
  void openOrFocusStreamerHud();
}

function renderOpener() {
  const hunt = activeHunt();
  if (!hunt || hunt.bonuses.length === 0) return;
  const i = state.openerIndex;
  const bonus = hunt.bonuses[i];
  const total = hunt.bonuses.length;

  document.getElementById('opener-badge').textContent = `BONUS ${i+1} / ${total}`;
  document.getElementById('opener-slot-name').textContent = bonus.slotName || 'Slot';
  document.getElementById('opener-slot-prov').textContent = String(bonus.slotProvider || '').toUpperCase();
  document.getElementById('opener-stake').textContent = `MISE : ${fmt(bonus.stake)}`;
  const openerKind = document.getElementById('opener-bonus-kind');
  if (openerKind) {
    const kind = normalizeBonusType(bonus.bonusType);
    openerKind.textContent = formatBonusTypeLabel(kind);
    openerKind.className = `opener-bonus-kind ${kind}`;
  }

  // progress bar
  const completed = hunt.bonuses.filter(b => b.win !== null).length;
  document.getElementById('opener-progress').style.width = (completed / total * 100) + '%';

  const frame = document.getElementById('opener-img-frame');
  const _normImg = resolveBonusImageUrl(bonus);
  const _safeImg = isSafeUrl(_normImg) ? escapeHtml(_normImg) : '';
  const _safeAlt = escapeHtml(bonus.slotName || '');
  frame.innerHTML = _safeImg
    ? `<img src="${_safeImg}" alt="${_safeAlt}" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<div class=\\'opener-img-placeholder\\'><img src=\\'./assets/virtual-token.svg\\' class=\\'ui-logo-icon big\\' alt=\\'slot\\'></div>'">`
    : `<div class="opener-img-placeholder"><img src="./assets/virtual-token.svg" class="ui-logo-icon big" alt="slot"></div>`;

  // stats
  const totalStake = hunt.bonuses.reduce((s,b) => s + b.stake, 0);
  const startBalance = Number(hunt.startBalance || 0);
  const currentWin = hunt.bonuses.filter(b => b.win !== null).reduce((s,b) => s + b.win, 0);
  const profit = currentWin - startBalance;
  const beMoyen = beAverageMultiplierForHunt(hunt);

  const openerBeVal = document.getElementById('opener-be-val');
  if (openerBeVal) {
    openerBeVal.textContent = beMoyen > 0 ? `${beMoyen.toFixed(4).replace('.', ',')}×` : '—';
    openerBeVal.title = beMoyen > 0
      ? `Solde départ (${fmt(startBalance)}) ÷ mise totale du hunt (${fmt(totalStake)} sur tous les bonus) = multiplicateur moyen pour le break-even.`
      : '';
  }
  document.getElementById('opener-current-win').textContent = fmt(currentWin);
  const beRemainEl = document.getElementById('opener-be-remaining');
  const beProgEl = document.getElementById('opener-be-progress');
  const remain = Math.max(0, startBalance - currentWin);
  const progressPct = startBalance > 0 ? Math.min(100, (currentWin / startBalance) * 100) : 0;
  if (beRemainEl) {
    // Style Anthosaure : BE restant = multiplicateur moyen requis sur les bonus
    // ENCORE à ouvrir pour atteindre le break-even.
    // Formule : (startBalance - currentWin) / (totalStake - stake des bonus déjà ouverts)
    const openedStake = hunt.bonuses
      .filter((b) => b.win !== null && !isNaN(Number(b.win)))
      .reduce((s, b) => s + Number(b.stake || 0), 0);
    const remainStake = Math.max(0, totalStake - openedStake);
    if (remain <= 0.0001) {
      beRemainEl.textContent = 'ATTEINT';
      beRemainEl.title = `Break-even atteint (gains ${fmt(currentWin)} ≥ départ ${fmt(startBalance)})`;
      beRemainEl.className = 'opener-be-val green';
    } else if (remainStake > 0) {
      const remainMult = remain / remainStake;
      beRemainEl.textContent = `${remainMult.toFixed(4).replace('.', ',')}×`;
      beRemainEl.title = `Multiplicateur moyen requis sur les bonus restants (reste ${fmt(remain)} à gagner sur ${fmt(remainStake)} de mise restante).\nBE moyen initial : ${(totalStake > 0 ? (startBalance / totalStake).toFixed(4).replace('.', ',') : '—')}×`;
      const baseAvg = totalStake > 0 ? (startBalance / totalStake) : Infinity;
      beRemainEl.className = `opener-be-val ${remainMult <= baseAvg ? 'gold' : 'red'}`;
    } else {
      beRemainEl.textContent = '∞×';
      beRemainEl.title = 'Plus aucun bonus à ouvrir et break-even non atteint';
      beRemainEl.className = 'opener-be-val red';
    }
  }
  if (beProgEl) {
    beProgEl.textContent = `${progressPct.toFixed(1).replace('.', ',')}%`;
    beProgEl.className = `opener-be-val ${progressPct >= 100 ? 'green' : 'cyan'}`;
  }
  const profEl = document.getElementById('opener-profit');
  if (profit >= 0) { profEl.textContent = '+' + fmt(profit); profEl.className = 'opener-be-val green'; }
  else { profEl.textContent = fmt(profit); profEl.className = 'opener-be-val red'; }
  const openerHint = document.getElementById('opener-profit-hint');
  if (openerHint) openerHint.textContent = getProfitMotivation(profit, startBalance, currentWin);

  // input
  const inp = document.getElementById('opener-win-input');
  // Ne pas écraser une saisie en cours si on est focus sur ce champ pour ce même bonus.
  const isUserTyping = document.activeElement === inp && inp.value !== '' && inp.dataset.bonusIdx === String(state.openerIndex);
  if (!isUserTyping) {
    inp.value = bonus.win !== null && typeof bonus.win !== 'undefined' ? bonus.win : '';
    inp.dataset.bonusIdx = String(state.openerIndex);
    setTimeout(() => { try { inp.focus(); inp.select(); } catch (_) {} }, 60);
  }
  updateOpenerStreamerHud();
}

function openerConfirm() {
  if (!requireWriteAccess('Saisie gain bloquée')) return;
  const hunt = activeHunt();
  if (!hunt) return;
  const val = parseFloat(document.getElementById('opener-win-input').value);
  if (isNaN(val) || val < 0) { showToast('Entre un gain valide (0 ou plus)', 'error'); return; }
  setUndoSnapshot('saisie gain');
  hunt.bonuses[state.openerIndex].win = val;
  save();

  // Move to next pending
  const next = hunt.bonuses.findIndex((b, i) => i > state.openerIndex && b.win === null);
  if (next >= 0) { state.openerIndex = next; renderOpener(); }
  else {
    // All done?
    const anyPending = hunt.bonuses.some(b => b.win === null);
    if (!anyPending) { showToast('Hunt terminé ! Tous les bonus sont ouverts.', 'success', 4000); closeOpener(); }
    else { state.openerIndex = Math.min(state.openerIndex + 1, hunt.bonuses.length - 1); renderOpener(); }
  }
}

function openerNav(dir) {
  const hunt = activeHunt();
  if (!hunt) return;
  // Save current value silently if valid
  const val = parseFloat(document.getElementById('opener-win-input').value);
  if (!isNaN(val) && val >= 0) { hunt.bonuses[state.openerIndex].win = val; save(); }
  state.openerIndex = Math.max(0, Math.min(state.openerIndex + dir, hunt.bonuses.length - 1));
  renderOpener();
}

// ═══════════════════════════════════════════════
//  INIT
// ═══════════════════════════════════════════════
async function init() {
  // jeux.json n'est plus chargé au boot : il l'est à la demande
  // (ensureSlotsLoaded() depuis switchPage('hunt') ou lors d'un init Hunt actif).
  await load();
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

// ─── PAGE NAVIGATION (URL routing) ───
// Chaque onglet sidebar = une URL propre, gérée via History API.
// Le serveur (Vercel) rewrite déjà toutes les routes vers index.html, donc
// un refresh ou un partage de lien direct (/blackjack, /hunt...) marche.
const PAGE_TO_SLUG = Object.freeze({
  home: '',
  hunt: 'hunt',
  studio: 'studio',
  blackjack: 'blackjack',
  mise: 'mise-optimale',
  roue_depot: 'roue-depot',
  slot_choix: 'slot-choix',
  tournoi: 'tournoi',
  stats: 'stats',
  jeux: 'mini-jeux',
  updates: 'updates',
  news: 'actualites',
  review: 'review',
  admin: 'admin',
  roue_multi: 'roue-multi-tirages',
  roue_tournoi_equipes: 'roue-tournoi-equipes',
});
const SLUG_TO_PAGE = (() => {
  const m = Object.create(null);
  for (const [page, slug] of Object.entries(PAGE_TO_SLUG)) m[slug] = page;
  return m;
})();
const PAGE_TITLES = Object.freeze({
  home: 'Accueil',
  hunt: 'Bonus Hunt',
  studio: 'Studio Stream',
  blackjack: 'Tableau Blackjack',
  mise: 'Mise Optimale',
  roue_depot: 'Roue du Dépôt',
  slot_choix: 'Slot des Choix',
  tournoi: 'Tournoi',
  stats: 'Statistiques',
  jeux: 'Mini Jeux',
  updates: 'Nouveautés',
  news: 'Actualités',
  review: 'Review',
  admin: 'Admin',
  roue_multi: 'Roue Multi-Tirages',
  roue_tournoi_equipes: 'Roue Tournoi Équipes',
});
const SITE_NAME = 'HugoTaSlot X 19EnPlein';
function pageToPath(page) {
  const slug = PAGE_TO_SLUG[page] ?? '';
  return slug ? `/${slug}` : '/';
}
function pathToPage(path) {
  const seg = String(path || '/').replace(/^\/+|\/+$/g, '').split('/')[0] || '';
  return SLUG_TO_PAGE[seg] || 'home';
}
function setDocumentTitleForPage(page) {
  const sub = PAGE_TITLES[page];
  try { document.title = sub ? `${sub} — ${SITE_NAME}` : SITE_NAME; } catch (_) {}
}

const HUNT_TAB_FROM_PAGE = Object.freeze({
  mise: 'mise',
  roue_depot: 'depot',
  slot_choix: 'choix',
  tournoi: 'tournoi',
});
const HUNT_TAB_TO_SLUG = Object.freeze({
  workspace: 'hunt',
  mise: 'mise-optimale',
  depot: 'roue-depot',
  choix: 'slot-choix',
  tournoi: 'tournoi',
});
const HUNT_TAB_TITLES = Object.freeze({
  workspace: 'Bonus Hunt',
  mise: 'Mise Optimale',
  depot: 'Slot du Dépôt',
  choix: 'Slot des Choix',
  tournoi: 'Tournoi',
});

function normalizeHuntTab(tab) {
  const t = String(tab || 'workspace').toLowerCase();
  return ['workspace', 'mise', 'depot', 'choix', 'tournoi'].includes(t) ? t : 'workspace';
}
function huntTabToPath(tab) {
  const slug = HUNT_TAB_TO_SLUG[normalizeHuntTab(tab)] || 'hunt';
  return slug === 'hunt' ? '/hunt' : `/${slug}`;
}
function pathToHuntTab(path) {
  const page = pathToPage(path);
  if (page === 'hunt') return 'workspace';
  return HUNT_TAB_FROM_PAGE[page] || null;
}
/** Onglet hunt à ouvrir selon le lien cliqué (pas le dernier onglet mémorisé). */
function resolveHuntTabForNavigation(requestedPage, opts) {
  opts = opts || {};
  if (opts.huntTab != null) return normalizeHuntTab(opts.huntTab);
  if (HUNT_TAB_FROM_PAGE[requestedPage]) return HUNT_TAB_FROM_PAGE[requestedPage];
  if (requestedPage === 'hunt') return 'workspace';
  const fromPath = pathToHuntTab(location.pathname);
  if (fromPath) return fromPath;
  return 'workspace';
}
function sidebarPageKey(page) {
  if (page !== 'hunt') return page;
  return state.huntTab === 'depot' ? 'roue_depot' : 'hunt';
}
function syncSidebarActivePage(page) {
  const key = sidebarPageKey(page);
  document.querySelectorAll('.sidebar-tab').forEach((t) => {
    t.classList.remove('active');
    t.removeAttribute('aria-current');
  });
  document.querySelectorAll(`[data-page="${key}"]`).forEach((t) => {
    t.classList.add('active');
    if (t.classList.contains('sidebar-tab')) t.setAttribute('aria-current', 'page');
  });
}
function setDocumentTitleForHuntTab(tab) {
  const sub = HUNT_TAB_TITLES[normalizeHuntTab(tab)] || PAGE_TITLES.hunt;
  try { document.title = sub ? `${sub} — ${SITE_NAME}` : SITE_NAME; } catch (_) {}
}
function showHuntHub() {
  const hub = document.getElementById('hunt-hub');
  if (hub) { hub.classList.add('active'); hub.style.display = 'flex'; }
  stashPageMount();
}
function hideHuntHub() {
  const hub = document.getElementById('hunt-hub');
  if (hub) { hub.classList.remove('active'); hub.style.display = 'none'; }
}
function runHuntTabInit(tab) {
  const t = normalizeHuntTab(tab);
  if (t === 'mise') {
    return loadLazyPageScript('mise').then(() => {
      const balInput = document.getElementById('m-balance');
      if (balInput && (!balInput.value || Number(balInput.value) <= 0)) {
        balInput.value = Math.max(1, Number(getUserBalance() || 100)).toFixed(2);
      }
      if (typeof calcMise === 'function') calcMise();
    }).catch(() => {});
  }
  if (t === 'depot') {
    return loadLazyPageScript('roue_depot').then(() => {
      if (typeof initDepositWheel === 'function') initDepositWheel();
    }).catch(() => {});
  }
  if (t === 'choix') {
    return loadLazyPageScript('slot_choix').then(() => {
      const p = typeof ensureSlotsLoaded === 'function'
        ? ensureSlotsLoaded().catch(() => {})
        : Promise.resolve();
      return p.then(() => {
        if (typeof initChoixSlot === 'function') initChoixSlot();
      });
    }).catch(() => {});
  }
  if (t === 'tournoi') {
    return loadLazyPageScript('tournoi').then(() => {
      if (typeof renderTournoiLeaderboard === 'function') renderTournoiLeaderboard();
    }).catch(() => {});
  }
  if (t === 'workspace') {
    return ensureSlotsLoaded().then(() => {
      scheduleHuntUI({ force: false });
    }).catch(() => {});
  }
  return Promise.resolve();
}
function switchHuntTab(tab, opts) {
  opts = opts || {};
  tab = normalizeHuntTab(tab);
  state.huntTab = tab;
  document.querySelectorAll('.hunt-hub-tab').forEach((btn) => {
    const on = normalizeHuntTab(btn.dataset.huntTab) === tab;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  });
  document.querySelectorAll('.hunt-tab-panel').forEach((panel) => {
    const panelTab = String(panel.id || '').replace('hunt-tab-', '');
    const on = panelTab === tab;
    panel.classList.toggle('active', on);
    panel.hidden = !on;
    panel.style.display = on ? '' : 'none';
  });
  const content = document.getElementById('content');
  const noHunt = document.getElementById('no-hunt-selected');
  if (tab === 'workspace') {
    if (content) content.style.display = 'flex';
    if (noHunt) noHunt.style.display = state.activeHuntId ? 'none' : 'flex';
  } else {
    if (content) content.style.display = 'none';
    if (noHunt) noHunt.style.display = 'none';
  }
  const statsBar = document.getElementById('stats-bar');
  const openHdr = document.getElementById('btn-open-hunt-header');
  const titleMain = document.getElementById('current-hunt-name');
  const titleSub = document.getElementById('current-hunt-date');
  if (statsBar) statsBar.style.display = tab === 'workspace' ? '' : 'none';
  if (openHdr) openHdr.style.display = tab === 'workspace' ? '' : 'none';
  if (tab !== 'workspace' && titleMain && titleSub) {
    const tabTitles = { mise: 'MISE OPTIMALE', depot: 'SLOT DU DÉPÔT', choix: 'SLOT DES CHOIX', tournoi: 'TOURNOI BONUS HUNT' };
    titleMain.textContent = tabTitles[tab] || 'BONUS HUNT';
    const h = activeHunt();
    titleSub.textContent = h ? h.name : 'Outil intégré au hub Bonus Hunt';
  } else if (tab === 'workspace' && titleMain && titleSub) {
    const h = activeHunt();
    if (h) {
      titleMain.textContent = h.name;
      const created = new Date(h.createdAt);
      const dateStr = created.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = created.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const eurHint = Number(h.startBalanceEUR || toEUR(h.startBalance || 0, h.currency || 'EUR')).toFixed(0);
      titleSub.textContent = `${dateStr} ${timeStr} · ${fmt(h.startBalance, h.currency)} (≈${eurHint}€)`;
    } else {
      titleMain.textContent = '— SÉLECTIONNER UN HUNT —';
      titleSub.textContent = '';
    }
  }
  if (!opts.skipInit) runHuntTabInit(tab);
  if (!opts.skipTitle) setDocumentTitleForHuntTab(tab);
  if (!opts.skipSidebar && __activePage === 'hunt') syncSidebarActivePage('hunt');
}
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

function switchPage(page, opts) {
  opts = opts || {};
  const requestedPage = page;
  let huntTab = resolveHuntTabForNavigation(requestedPage, opts);
  if (HUNT_TAB_FROM_PAGE[requestedPage]) {
    page = 'hunt';
  }
  if (page === 'admin' && !isCurrentUserAdmin()) {
    page = 'home';
    showToast('Accès admin requis', 'error');
  }
  try {
    const gw = document.getElementById('game-window');
    if (gw && !gw.classList.contains('hidden') && typeof closeGame === 'function') {
      closeGame();
    }
  } catch (e) { /* noop */ }
  document.querySelectorAll('.page-panel').forEach(p => p.classList.remove('active', 'anim-in'));

  if (page === 'hunt') {
    showHuntHub();
    const mainIds = ['no-hunt-selected', 'hunt-workspace'];
    mainIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === 'no-hunt-selected') el.style.display = state.activeHuntId ? 'none' : 'flex';
      else if (id === 'hunt-workspace') {
        if (state.activeHuntId) {
          el.classList.remove('hidden');
          el.style.display = 'flex';
        } else {
          el.classList.add('hidden');
          el.style.display = 'none';
        }
      }
    });
    const content = document.getElementById('content');
    if (content) content.style.display = 'flex';
    switchHuntTab(huntTab, { skipTitle: true, skipInit: opts.skipHuntTabInit, skipSidebar: true });
    setDocumentTitleForHuntTab(state.huntTab);
  } else {
    hideHuntHub();
    stashPageMount();
    mountCachedPage(page);

    // Lazy load + rendu : le script de la page est chargé (si dans LAZY_PAGE_SCRIPTS),
    // PUIS la fonction de rendu est appelée. Pour les pages sans lazy script, la promesse
    // est déjà résolue et le rendu se fait dès la prochaine microtask.
    const __renderFn = (function buildPageRender(p) {
      switch (p) {
        case 'blackjack': return () => { if (typeof renderBJTable === 'function') renderBJTable(); };
        case 'jeux': return () => {
          if (typeof renderGamesModeBanner === 'function') renderGamesModeBanner();
          if (typeof renderWeeklyObjectivesPanel === 'function') renderWeeklyObjectivesPanel();
          if (typeof renderGamesLobby === 'function') renderGamesLobby();
        };
        case 'stats': return () => { if (typeof renderStatsPage === 'function') renderStatsPage(); };
        case 'admin': return () => { if (typeof renderAdminPanel === 'function') renderAdminPanel(); };
        case 'home': return () => {
          if (typeof renderHomeHubMetrics === 'function') renderHomeHubMetrics();
          if (typeof renderHomeLeaderboard === 'function') renderHomeLeaderboard();
          if (typeof renderHomeDiscordBanner === 'function') renderHomeDiscordBanner();
        };
        case 'studio': return () => { if (typeof renderStudioPage === 'function') renderStudioPage(); };
        case 'updates': return () => {
          if (typeof renderUpdatesPage === 'function') renderUpdatesPage();
          if (typeof runSupabaseHealthCheck === 'function') runSupabaseHealthCheck(false).catch(() => {});
        };
        case 'review': return () => {
          if (typeof renderReviewPage === 'function') renderReviewPage();
          flushFeedbackQueue().catch(() => {});
        };
        case 'news': return () => { if (typeof renderNewsPage === 'function') renderNewsPage(); };
        default: return null;
      }
    })(page);

    loadLazyPageScript(page)
      .then(() => { if (__renderFn) __renderFn(); })
      .catch((e) => {
        bhWarn(`[lazy] ${page}`, e?.message || e);
        // Fallback si le script échoue mais que la fonction est déjà globale
        try { if (__renderFn) __renderFn(); } catch (_) {}
      });

    updateLobbyBalance();
  }
  syncSidebarActivePage(page);
  closeMobileSidebar();

  if (page === 'hunt') setDocumentTitleForHuntTab(state.huntTab);
  else setDocumentTitleForPage(page);
  if (!opts.skipHistory) {
    const path = page === 'hunt' ? huntTabToPath(state.huntTab) : pageToPath(page);
    const histState = page === 'hunt' ? { page: 'hunt', huntTab: state.huntTab } : { page };
    try {
      if (location.pathname !== path) {
        if (opts.replace) history.replaceState(histState, '', path);
        else history.pushState(histState, '', path);
      } else if (!history.state || history.state.page !== page || (page === 'hunt' && history.state.huntTab !== state.huntTab)) {
        history.replaceState(histState, '', path);
      }
    } catch (_) { /* history API indisponible : ignore */ }
  }
  __activePage = page;
}

// ─── LAZY CHARGEMENT DE MODULES PAR PAGE ───
// Infrastructure prête pour la Passe 2 du refactoring multi-pages :
// chaque entrée du registre = un script externe chargé au 1er accès à la page.
// Tant qu'une page n'a pas son script ici, elle reste dans app.js (rétrocompat).
//
// Pour activer une page lazy :
//   1. Extraire ses fonctions de app.js dans /scripts/pages/<slug>.js
//      (les fonctions restent globales, pas de module ES — migration progressive)
//   2. Supprimer ces fonctions d'app.js
//   3. Ajouter une entrée : <page>: './scripts/pages/<slug>.js'
//
// Le loader est idempotent et ne re-télécharge jamais un script déjà chargé.
// Page actuellement affichée (utilisé pour remplacer les checks getElementById('page-x').active)
let __activePage = 'home';

// ─── TEMPLATES HTML DES PAGES (injectés dynamiquement par switchPage) ───────
// Chaque page n'est dans le DOM que quand l'utilisateur la visite.
// Le HTML est injecté dans <div id="page-mount"> puis retiré lors de la navigation.
const __PAGE_HTML = {
  home: `
<div class="page-panel" id="page-home">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ACCUEIL</div>
      <div class="hunt-title-sub">Bienvenue sur HugoTaSlot X 19EnPlein</div>
    </div>
  </header>
  <div class="page-content">
    <div class="home-hero">
      <div class="home-hero-brand">
        <img src="./assets/logo-hugotaslot.jpg" class="home-hero-logo" alt="HugoTaSlot">
        <span class="home-hero-x" aria-hidden="true">×</span>
        <img src="./assets/19enplein-logo.png" class="home-hero-logo" alt="19EnPlein">
        <div>
          <div class="home-hero-title">HUGOTASLOT <span class="home-hero-title-x">×</span> 19ENPLEIN</div>
          <div class="home-hero-sub">BONUS HUNT MANAGER — TEAM STREAMERS CASINO</div>
        </div>
      </div>
      <a class="home-partner-banner" href="https://gamdom.com" target="_blank" rel="noopener noreferrer" aria-label="Partenaire officiel : Gamdom">
        <img src="./assets/gamdom-tower.png" class="home-partner-tower" alt="">
        <div class="home-partner-text">
          <div class="home-partner-label">PARTENAIRE OFFICIEL</div>
          <img src="./assets/gamdom-logo-white-transparent.png" class="home-partner-logo" alt="Gamdom">
        </div>
        <span class="home-partner-cta">JOUER SUR GAMDOM →</span>
      </a>
      <div id="home-discord-banner" class="home-discord-banner" aria-live="polite"></div>
      <div class="home-grid">
        <div class="home-card">
          <div class="home-card-head"><img src="./assets/icon-hunt.svg" class="ui-logo-icon" alt=""><div class="home-card-title">DÉMARRAGE RAPIDE</div></div>
          <div class="home-card-text">Crée un hunt, ajoute tes slots puis ouvre les bonus avec saisie instantanée des gains.</div>
        </div>
        <div class="home-card">
          <div class="home-card-head"><img src="./assets/icon-cards.svg" class="ui-logo-icon" alt=""><div class="home-card-title">ANALYSE EN DIRECT</div></div>
          <div class="home-card-text">Suivi du profit, BE moyen, progression et validation rapide au clavier dans l’opener.</div>
        </div>
        <div class="home-card">
          <div class="home-card-head"><img src="./assets/icon-games.svg" class="ui-logo-icon" alt=""><div class="home-card-title">OUTILS INTÉGRÉS</div></div>
          <div class="home-card-text">Sessions, mise optimale, slot dépôt, tournoi et mini-jeux — tout regroupé dans le hub Bonus Hunt.</div>
        </div>
      </div>
      <div class="hub-kpi-grid" id="home-kpi-grid">
        <div class="hub-kpi"><div class="hub-kpi-l">HUNTS</div><div class="hub-kpi-v" id="home-kpi-hunts">0</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">BONUS TOTAL</div><div class="hub-kpi-v" id="home-kpi-bonus">0</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">PROFIT GLOBAL</div><div class="hub-kpi-v" id="home-kpi-profit">0,00€</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">EN LIGNE</div><div class="hub-kpi-v" id="home-kpi-online">1</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">PROFIT 7J</div><div class="hub-kpi-v" id="home-kpi-profit-7d">0,00€</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">PROFIT 30J</div><div class="hub-kpi-v" id="home-kpi-profit-30d">0,00€</div></div>
      </div>
    </div>
    <div class="mise-section">
      <div class="mise-section-title">CLASSEMENTS COMMUNAUTÉ</div>
      <div class="bj-rec" style="margin-bottom:10px;">Tournoi mensuel, points misés aux mini-jeux et streak de drops quotidiens.</div>
      <div class="home-lb-tabs" id="home-lb-tabs" role="tablist">
        <button type="button" class="home-lb-tab active" data-lb-tab="tournoi" aria-selected="true">Tournoi</button>
        <button type="button" class="home-lb-tab" data-lb-tab="wager">Mini-jeux</button>
        <button type="button" class="home-lb-tab" data-lb-tab="streak">Streak drop</button>
      </div>
      <div id="home-leaderboard"><div class="bj-rec">Chargement…</div></div>
    </div>
    <div class="home-landing-showcase">
      <div class="home-showcase-item"><img src="./assets/icon-hunt.svg" alt=""><span>Bonus Hunt live</span></div>
      <div class="home-showcase-item"><img src="./assets/icon-cards.svg" alt=""><span>Opener + HUD stream</span></div>
      <div class="home-showcase-item"><img src="./assets/icon-games.svg" alt=""><span>12 mini-jeux</span></div>
      <div class="home-showcase-item"><img src="./assets/virtual-token.svg" alt=""><span>Drops & streak</span></div>
    </div>
    <div class="home-hero-cta-row">
      <button type="button" class="play-btn home-hero-cta" onclick="showNewHuntModal();switchPage('hunt');">CRÉER MON PREMIER HUNT</button>
      <button type="button" class="home-cmd-btn" onclick="startOnboarding(true)">GUIDE DÉMARRAGE</button>
    </div>
    <div class="mise-section home-quick-panel">
      <div class="mise-section-title">COMMANDES RAPIDES</div>
      <div class="home-quick-cmds">
        <button class="play-btn" onclick="showNewHuntModal()">+ NOUVEAU HUNT</button>
        <button class="home-cmd-btn" onclick="switchPage('hunt')">ALLER AU BONUS HUNT</button>
        <button class="home-cmd-btn" onclick="switchPage('studio')">STUDIO STREAM</button>
        <button class="home-cmd-btn" onclick="startOnboarding(true)">GUIDE DÉMARRAGE</button>
        <button class="home-cmd-btn" onclick="switchPage('blackjack')">TABLEAU BJ</button>
        <button class="home-cmd-btn" onclick="switchPage('hunt',{huntTab:'mise'})">MISE OPTIMALE</button>
        <button class="home-cmd-btn" onclick="switchPage('hunt',{huntTab:'tournoi'})">TOURNOI</button>
        <button class="home-cmd-btn" onclick="switchPage('jeux')">MINI JEUX</button>
        <button class="home-cmd-btn" onclick="switchPage('updates')">NOUVEAUTÉS</button>
        <button class="home-cmd-btn" onclick="switchPage('review')">REVIEW / AVIS</button>
        <button class="home-cmd-btn" id="home-admin-btn" onclick="switchPage('admin')" style="display:none;">ADMIN</button>
      </div>
    </div>
    <div class="mise-section">
      <div class="mise-section-title">RECHERCHE GLOBALE</div>
      <input class="profile-menu-input" id="global-search-input" placeholder="Rechercher hunt, bonus, provider, joueur..." style="max-width:560px;">
      <div id="global-search-results" style="margin-top:10px;"></div>
    </div>
  </div>
</div>
  `,
  admin: `
<div class="page-panel" id="page-admin">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ADMIN</div>
      <div class="hunt-title-sub">Gestion globale des comptes, soldes et sessions</div>
    </div>
  </header>
  <div class="page-content">
    <div class="mise-section" id="admin-access-denied" style="display:none;">
      <div class="mise-section-title">ACCÈS REFUSÉ</div>
      <div class="bj-rec">Tu dois être admin pour accéder à ce panneau.</div>
    </div>
    <div id="admin-panel">
      <div class="mise-section" style="margin-bottom:14px;">
        <div class="mise-section-title">MAINTENANCE (serveur Supabase)</div>
        <div class="bj-rec" style="margin-bottom:8px;">État global pour tous les joueurs — plus de flag localStorage navigateur. Migration : <code>20260704_site_maintenance.sql</code></div>
        <div class="bj-input-row">
          <label class="bj-label" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="admin-maint-enabled"> Activer maintenance (joueurs en lecture seule)
          </label>
        </div>
        <div class="profile-menu-row" style="margin-top:8px;">
          <label class="profile-menu-label">Message bannière</label>
          <input class="profile-menu-input" id="admin-maint-msg" maxlength="220" placeholder="Maintenance en cours...">
        </div>
        <button class="profile-mini-btn primary" onclick="adminSetMaintenanceMode()">Appliquer mode maintenance</button>
      </div>
      <div class="mise-section" style="margin-bottom:14px;">
        <div class="mise-section-title">ALERTING OPS</div>
        <div class="bj-input-row">
          <label class="bj-label" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="admin-ops-enabled"> Activer alertes erreurs critiques (webhook)
          </label>
        </div>
        <div class="profile-menu-row" style="margin-top:8px;">
          <label class="profile-menu-label">Webhook URL</label>
          <input class="profile-menu-input" id="admin-ops-webhook" maxlength="360" placeholder="https://...">
        </div>
        <button class="profile-mini-btn primary" onclick="adminSaveOpsAlerts()">Sauvegarder alerting ops</button>
        <div class="admin-toolbar" style="margin-top:10px;">
          <button type="button" class="profile-mini-btn" onclick="adminTestOpsWebhook()">Tester le webhook</button>
          <button type="button" class="profile-mini-btn" onclick="adminFireTestProdError()">Simuler erreur prod</button>
        </div>
        <div class="bj-rec" style="margin-top:8px;">Le webhook reçoit les erreurs <code>pushRuntimeLog('error', …)</code> en prod (cooldown 45 s). « Simuler erreur prod » déclenche ce chemin réel.</div>
      </div>
      <div class="mise-section-title" style="margin-bottom:8px;">DASHBOARD COMMUNAUTÉ</div>
      <div class="stats-grid" id="admin-dashboard-grid" style="margin-bottom:14px;"></div>
      <div class="stats-grid" id="admin-stats-grid" style="margin-bottom:14px;"></div>
      <div class="mise-section" style="margin-bottom:14px;">
        <div class="mise-section-title">UTILISATEURS</div>
        <div id="admin-users-table"></div>
      </div>
      <div class="mise-section">
        <div class="mise-section-title">HUNTS</div>
        <div id="admin-hunts-table"></div>
      </div>
      <div class="mise-section" style="margin-top:14px;">
        <div class="mise-section-title">ANNONCER UNE SLOT (DISCORD + ACTUALITÉS)</div>
        <div class="drop-meta" style="margin-bottom:10px;">Le bot poste l'annonce sur Discord dans les 60 secondes et la slot apparaît immédiatement dans la page Actualités.</div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Nom de la slot (obligatoire)</label>
          <input type="text" class="profile-menu-input" id="admin-slot-title" maxlength="160" placeholder="Ex. : Sweet Bonanza Super Scatter" oninput="syncAdminSlotPreview()">
        </div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Provider</label>
          <input type="text" class="profile-menu-input" id="admin-slot-provider" maxlength="80" placeholder="Ex. : Pragmatic Play" oninput="syncAdminSlotPreview()">
        </div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Image (URL)</label>
          <input type="url" class="profile-menu-input" id="admin-slot-image" maxlength="500" placeholder="https://..." oninput="syncAdminSlotPreview()">
        </div>
        <div id="admin-slot-preview-wrap" class="admin-slot-preview-wrap hidden">
          <img id="admin-slot-preview-img" class="admin-slot-preview-img" alt="Aperçu slot" loading="lazy" referrerpolicy="no-referrer">
        </div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Lien (review, vidéo, page provider…)</label>
          <input type="url" class="profile-menu-input" id="admin-slot-url" maxlength="500" placeholder="https://...">
        </div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Résumé (optionnel)</label>
          <textarea class="profile-menu-input" id="admin-slot-summary" rows="3" maxlength="600" placeholder="Mécanique, RTP, gros multis, premières impressions…" style="min-height:84px;resize:vertical;font-family:inherit;"></textarea>
        </div>
        <div class="bj-rec" id="admin-slot-status" style="margin:6px 0 10px;"></div>
        <div class="bj-rec" id="admin-slot-prefill-link" style="margin-bottom:8px;display:none;"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="profile-mini-btn primary" type="button" onclick="adminPostManualSlot()">Publier la slot</button>
          <button class="profile-mini-btn" type="button" onclick="adminPreviewSlotToHunt()">Tester dans mon hunt</button>
          <button class="profile-mini-btn" type="button" onclick="resetAdminSlotForm()">Vider le formulaire</button>
        </div>
        <div id="admin-recent-slots" style="margin-top:14px;"></div>
      </div>
      <div class="mise-section" style="margin-top:14px;">
        <div class="mise-section-title">VALIDATION TOURNOI</div>
        <div class="drop-meta" style="margin-bottom:10px;">Entrées en attente de vérification. Valide ou refuse après contrôle du replay / des chiffres.</div>
        <div id="admin-tournoi-table"></div>
      </div>
      <div class="mise-section" style="margin-top:14px;">
        <div class="mise-section-title">RETOURS BETA (REVIEW)</div>
        <div id="admin-feedback-table"></div>
      </div>
      <div class="mise-section" style="margin-top:14px;">
        <div class="mise-section-title">AUDIT ADMIN</div>
        <div id="admin-logs-table"></div>
      </div>
    </div>
  </div>
</div>
  `,
  blackjack: `
<div class="page-panel" id="page-blackjack">
  <header class="page-header">
    <div class="hunt-title-area">
      <div class="hunt-title-main">TABLE DE BLACKJACK</div>
      <div class="hunt-title-sub">Stratégie de base — Optimise tes chances au maximum</div>
    </div>
  </header>
  <div class="page-content">
    <div class="mise-section">
      <div class="mise-section-title">STRATÉGIE DE BASE</div>
      <div class="bj-input-row">
        <div class="bj-input-group">
          <label class="bj-label">MA MAIN (total)</label>
          <input type="number" class="bj-input" id="bj-player" value="16" min="4" max="21">
        </div>
        <div class="bj-input-group">
          <label class="bj-label">CARTE DEALER</label>
          <input type="number" class="bj-input" id="bj-dealer" value="10" min="2" max="11">
        </div>
        <div class="bj-input-group">
          <label class="bj-label">J'AI UN AS ?</label>
          <select class="bj-input" id="bj-soft" style="width:100px">
            <option value="0">Non</option>
            <option value="1">Oui (soft)</option>
          </select>
        </div>
        <div class="bj-input-group">
          <label class="bj-label">PAIRE ?</label>
          <select class="bj-input" id="bj-pair" style="width:100px">
            <option value="0">Non</option>
            <option value="1">Oui (split?)</option>
          </select>
        </div>
        <button class="play-btn" onclick="bjGetAdvice()" style="height:44px;margin-left:0;">CONSEIL</button>
      </div>
      <div class="bj-rec" id="bj-rec">
        <strong>CONSEIL STRATÉGIQUE</strong>
        Renseigne ta main et la carte visible du dealer, puis clique CONSEIL.
      </div>
    </div>
    <div class="mise-section">
      <div class="mise-section-title">TABLE STRATÉGIE COMPLÈTE</div>
      <p style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);margin-bottom:12px;letter-spacing:1px;">
        DEALER → / MA MAIN ↓ &nbsp;|&nbsp;
        <span style="color:var(--green)">H=Tirer</span> &nbsp;
        <span style="color:var(--red)">S=Rester</span> &nbsp;
        <span style="color:var(--blue)">D=Doubler</span> &nbsp;
        <span style="color:var(--gold-true)">P=Séparer</span>
      </p>
      <div class="bj-table-wrap">
        <table class="bj-table" id="bj-strategy-table"></table>
      </div>
    </div>
            </div>
        </div>
  `,
  stats: `
<div class="page-panel" id="page-stats">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">STATISTIQUES & RANGS</div>
      <div class="hunt-title-sub">Progression de rank, jeux joués et perf gains/pertes</div>
    </div>
  </header>
  <div class="page-content">
    <div id="stats-root"></div>
  </div>
</div>
  `,
  jeux: `
<div class="page-panel" id="page-jeux">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">MINI JEUX</div>
      <div class="hunt-title-sub">Joue avec ton solde virtuel</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;">
      <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);letter-spacing:2px;">SOLDE</div>
      <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:20px;color:var(--gold-true)" id="lobby-balance">0,00€</div>
    </div>
  </header>
  <div class="page-content">
    <div id="games-mode-banner" class="games-mode-banner" aria-live="polite"></div>
    <div id="games-weekly-objectives" class="games-weekly-objectives" aria-live="polite"></div>
    <div class="games-grid" id="games-lobby"></div>
  </div>
</div>
  `,
  updates: `
<div class="page-panel" id="page-updates">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">NOUVEAUTÉS & UPDATES</div>
      <div class="hunt-title-sub">Changelog produit + suivi technique production</div>
    </div>
  </header>
  <div class="page-content" style="padding:14px;">
    <div id="updates-changelog"></div>
    <div id="updates-content"></div>
  </div>
</div>
  `,
  studio: `
<div class="page-panel" id="page-studio">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">STUDIO STREAM</div>
      <div class="hunt-title-sub">Opener, mini-opener, HUD OBS et options d’affichage live</div>
    </div>
  </header>
  <div class="page-content" style="padding:14px;">
    <div id="studio-content"><div class="bj-rec">Chargement…</div></div>
  </div>
</div>
  `,
  review: `
<div class="page-panel" id="page-review">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">REVIEW</div>
      <div class="hunt-title-sub">Bugs, idées et retours pour améliorer le site (bêta ouverte)</div>
    </div>
  </header>
  <div class="page-content" style="padding:14px;">
    <div class="drop-box" style="margin-bottom:14px;">
      <div class="drop-title">Envoyer un retour</div>
      <div class="drop-meta" style="margin-bottom:12px;">Décris ce qui coince, ce qu’il manque ou ce que tu aimerais voir. Les admins lisent tout dans le panneau Admin.</div>
      <div class="profile-menu-row" style="margin-bottom:10px;">
        <label class="profile-menu-label">Type</label>
        <select class="profile-menu-input" id="review-category" style="max-width:280px;">
          <option value="bug">Bug / problème</option>
          <option value="idee">Idée / suggestion</option>
          <option value="autre">Autre</option>
        </select>
      </div>
      <div class="profile-menu-row" style="margin-bottom:10px;">
        <label class="profile-menu-label">Message (obligatoire)</label>
        <textarea class="profile-menu-input" id="review-message" rows="6" maxlength="4000" placeholder="Ex. : Le bouton X ne répond pas sur mobile…" style="min-height:120px;resize:vertical;font-family:inherit;"></textarea>
      </div>
      <div class="profile-menu-row" style="margin-bottom:10px;">
        <label class="profile-menu-label">Contact ou pseudo (optionnel)</label>
        <input type="text" class="profile-menu-input" id="review-contact" maxlength="240" placeholder="Discord, email, pseudo…">
      </div>
      <div class="bj-rec" id="review-status" style="margin-bottom:10px;"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="profile-mini-btn primary" type="button" onclick="submitSiteFeedback()">Envoyer le retour</button>
      </div>
    </div>
  </div>
</div>
  `,
  news: `
<div class="page-panel" id="page-news">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ACTUALITÉS</div>
      <div class="hunt-title-sub">Vidéos & news de la team — nouvelles sorties slots (mêmes titres sur Gamdom, Stake, Shuffle, Celsius)</div>
    </div>
    <span class="news-team-badge"><img src="./assets/19enplein-logo.png" alt="" aria-hidden="true">TEAM 19ENPLEIN</span>
    <div style="margin-left:auto;display:flex;gap:8px;">
      <button class="profile-mini-btn" type="button" onclick="renderNewsPage(true)">↻ Rafraîchir</button>
    </div>
  </header>
  <div class="page-content" style="padding:14px;display:flex;flex-direction:column;gap:14px;">
    <div id="news-slot-week" class="news-slot-week hidden"></div>
    <div class="drop-box news-box-team">
      <div class="drop-title">Dernières vidéos de la team</div>
      <div class="drop-meta" style="margin-bottom:10px;">Postées automatiquement par le bot Discord depuis la chaîne HugoTaSlot — la team 19EnPlein en action.</div>
      <div id="news-videos-grid" class="news-grid"><div class="bj-rec">Chargement…</div></div>
    </div>
    <div class="drop-box">
      <div class="drop-title">Nouvelles sorties slots</div>
      <div class="drop-meta" style="margin-bottom:10px;">Le bot suit SlotCatalog (nouveautés mondiales — tu retrouves les mêmes titres sur Stake, Gamdom, Shuffle, Celsius quand ils sortent). Complété par BigWinBoard si dispo + ajouts admin.</div>
      <div id="news-slots-grid" class="news-grid"><div class="bj-rec">Chargement…</div></div>
    </div>
  </div>
</div>
  `,
  roue_multi: `
<div class="page-panel" id="page-roue_multi">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ROUE MULTI-TIRAGES</div>
      <div class="hunt-title-sub">La Roue de 19EnPlein — tirages classiques et multi-vainqueurs</div>
    </div>
    <div class="roue-script-credit" title="Script par !Bloodz">
      <span class="roue-script-credit__avatar" aria-hidden="true"></span>
      <span class="roue-script-credit__name">!Bloodz</span>
    </div>
  </header>
  <div class="page-content page-content--embed">
    <iframe class="roue-embed-frame" src="./roue-multi-tirages.html" title="La Roue de 19enplein - Multi-Tirages"></iframe>
  </div>
</div>
  `,
  roue_tournoi_equipes: `
<div class="page-panel" id="page-roue_tournoi_equipes">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ROUE TOURNOI ÉQUIPES</div>
      <div class="hunt-title-sub">19EnPlein — tirage des équipes et suivi des gains</div>
    </div>
    <div class="roue-script-credit" title="Script par !Bloodz">
      <span class="roue-script-credit__avatar" aria-hidden="true"></span>
      <span class="roue-script-credit__name">!Bloodz</span>
    </div>
  </header>
  <div class="page-content page-content--embed">
    <iframe class="roue-embed-frame" src="./roue-tournoi-equipes.html" title="19enplein - Roue Tournoi Casino"></iframe>
  </div>
</div>
  `
};

const LAZY_PAGE_SCRIPTS = Object.freeze({
  // Passe 2 — scripts chargés uniquement quand l'utilisateur visite la page.
  blackjack:   './scripts/pages/blackjack.js',
  mise:        './scripts/pages/mise.js',
  tournoi:     './scripts/pages/tournoi.js',
  roue_depot:  './scripts/pages/roue-depot.js',
  slot_choix:  './scripts/pages/slot-choix.js',
  jeux:        './scripts/pages/mini-jeux.js',
  home:        './scripts/pages/hub-features.js',
  studio:      './scripts/pages/hub-features.js',
  stats:       './scripts/pages/stats.js',
  // updates, review, news, admin, hunt → app.js (extraction progressive)
});
const __lazyScriptLoaded = new Map(); // absUrl -> Promise<void>
function resolveLazyScriptUrl(rel) {
  try { return new URL(rel, document.baseURI || location.href).href; }
  catch (_) { return String(rel || ''); }
}
function loadLazyPageScript(page) {
  const rel = LAZY_PAGE_SCRIPTS[page];
  if (!rel) return Promise.resolve();
  const abs = resolveLazyScriptUrl(rel);
  if (__lazyScriptLoaded.has(abs)) return __lazyScriptLoaded.get(abs);
  const existing = [...document.scripts].find((el) => {
    if (!el.src) return false;
    try { return resolveLazyScriptUrl(el.getAttribute('src') || el.src) === abs; }
    catch (_) { return false; }
  });
  if (existing) {
    if (!__lazyScriptLoaded.has(abs)) {
      const p = new Promise((resolve, reject) => {
        if (existing.dataset.lazyLoaded === '1') { resolve(); return; }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`lazy page script failed: ${rel}`)), { once: true });
      });
      __lazyScriptLoaded.set(abs, p);
    }
    return __lazyScriptLoaded.get(abs);
  }
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = rel;
    s.async = true;
    s.dataset.lazyPage = page;
    s.dataset.lazySrc = abs;
    s.addEventListener('load', () => {
      s.dataset.lazyLoaded = '1';
      resolve();
    });
    s.addEventListener('error', () => {
      __lazyScriptLoaded.delete(abs);
      reject(new Error(`lazy page script failed: ${rel}`));
    });
    document.head.appendChild(s);
  });
  __lazyScriptLoaded.set(abs, p);
  return p;
}

// ─── LAZY CHARGEMENT DU CATALOGUE jeux.json ───
// jeux.json (~1-2 Mo) n'est plus chargé au boot mais uniquement quand
// l'utilisateur entre sur la page Hunt (où la grille est affichée).
let __slotsLoadPromise = null;
function ensureSlotsLoaded() {
  if (Array.isArray(state.slots) && state.slots.length > 0) {
    return Promise.resolve(state.slots);
  }
  if (__slotsLoadPromise) return __slotsLoadPromise;
  if (typeof loadSlots !== 'function') return Promise.resolve([]);
  __slotsLoadPromise = loadSlots().catch((e) => {
    console.error('loadSlots failed', e);
    __slotsLoadPromise = null; // permet le retry si l'utilisateur revient
    state.slots = state.slots || [];
    return state.slots;
  });
  return __slotsLoadPromise;
}

// ────────────────────────────────────────────────────────────
// PAGE ACTUALITÉS (vidéos YouTube + sorties slots)
// ────────────────────────────────────────────────────────────
const NEWS_CACHE = { videos: null, slots: null, ts: 0 };
const NEWS_TTL_MS = 60_000;

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

function renderNewsSlotWeekBanner(slots) {
  const wrap = document.getElementById('news-slot-week');
  if (!wrap) return;
  const pick = typeof pickSlotOfTheWeek === 'function' ? pickSlotOfTheWeek(slots) : (slots?.[0] || null);
  if (!pick) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
  window.__newsSlotWeekPick = pick;
  wrap.classList.remove('hidden');
  const title = escapeHtml(pick.title || 'Slot');
  const provider = escapeHtml(pick.provider || '');
  const img = pick.image && isSafeUrl(pick.image) ? escapeHtml(pick.image) : '';
  wrap.innerHTML = `
    <div class="news-slot-week-inner">
      ${img ? `<img class="news-slot-week-img" src="${img}" alt="${title}" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <div class="news-slot-week-body">
        <div class="news-slot-week-kicker">SLOT DE LA SEMAINE</div>
        <div class="news-slot-week-title">${title}</div>
        <div class="news-slot-week-meta">${provider || 'Nouveauté communautaire'}</div>
        <div class="news-slot-week-actions">
          <button type="button" class="profile-mini-btn primary" onclick="addNewsSlotWeekToHunt()">Ajouter au hunt</button>
          ${pick.url ? `<a class="profile-mini-btn" href="${escapeHtml(pick.url)}" target="_blank" rel="noopener noreferrer">En savoir plus</a>` : ''}
        </div>
      </div>
    </div>`;
}

let adminTournoiSelection = new Set();

function adminTournoiToggle(id, checked) {
  const sid = String(id || '');
  if (!sid) return;
  if (checked) adminTournoiSelection.add(sid);
  else adminTournoiSelection.delete(sid);
}

function adminTournoiToggleAll(checked) {
  document.querySelectorAll('.admin-tournoi-cb').forEach((el) => {
    el.checked = !!checked;
    adminTournoiToggle(el.value, checked);
  });
}

function getAdminTournoiSelectedIds() {
  return Array.from(adminTournoiSelection);
}

async function adminBatchModerateTournoi(action) {
  if (!isCurrentUserAdmin()) return;
  const ids = getAdminTournoiSelectedIds();
  if (!ids.length) {
    showToast('Sélectionne au moins une entrée', 'info', 2200);
    return;
  }
  if (action === 'reject') {
    const ok = typeof confirm === 'function'
      ? await confirm(`Refuser ${ids.length} entrée(s) ?`, 'Elles seront retirées du classement en attente.')
      : true;
    if (!ok) return;
  }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  try {
    const { data, error } = await cloudCall('admin', () => c.rpc('admin_moderate_tournament_entries', {
      p_entry_ids: ids,
      p_action: action
    }), { retries: 1, timeoutMs: 15000, delayMs: 400 });
    if (error) throw error;
    const n = Number(data?.count || 0);
    adminTournoiSelection.clear();
    showToast(
      action === 'verify' ? `${n} entrée(s) validée(s)` : `${n} entrée(s) refusée(s)`,
      action === 'verify' ? 'success' : 'info',
      2800
    );
    if (typeof renderAdminPanel === 'function') await renderAdminPanel();
    if (typeof fetchTournoi === 'function') await fetchTournoi();
    if (typeof renderTournoiLeaderboard === 'function') renderTournoiLeaderboard();
  } catch (e) {
    bhWarn('adminBatchModerateTournoi', e);
    let done = 0;
    for (const id of ids) {
      try {
        if (action === 'verify' && typeof adminVerifyTournoiEntry === 'function') {
          await adminVerifyTournoiEntry(id, true);
          done += 1;
        } else if (action === 'reject' && typeof adminRejectTournoiEntry === 'function') {
          await adminRejectTournoiEntry(id);
          done += 1;
        }
      } catch (_) {}
    }
    adminTournoiSelection.clear();
    if (done > 0) {
      showToast(`${done} entrée(s) traitée(s) (mode secours)`, done === ids.length ? 'success' : 'info', 2800);
      if (typeof renderAdminPanel === 'function') await renderAdminPanel();
    } else {
      showToast(mapAuthError(e) || 'Modération en lot impossible — migration admin_dashboard ?', 'error', 4000);
    }
  }
}

async function adminFetchPendingTournoiEntries() {
  const c = getAuthClient();
  if (!c || !isCurrentUserAdmin()) return [];
  try {
    const { data, error } = await cloudCall('admin', () => c.from('tournament_entries')
      .select('id,hunt_name,player_name,gain,mise,multiplier,replay_url,verified,created_at,user_id')
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(40), { retries: 1, timeoutMs: 12000, quiet: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    bhWarn('adminFetchPendingTournoiEntries', e);
    return [];
  }
}

async function renderAdminTournoiTable() {
  const wrap = document.getElementById('admin-tournoi-table');
  if (!wrap) return;
  if (!isCurrentUserAdmin() || !currentUser?.cloud) {
    wrap.innerHTML = '<div class="bj-rec">Réservé aux admins cloud.</div>';
    return;
  }
  wrap.innerHTML = '<div class="bj-rec">Chargement des soumissions…</div>';
  const rows = await adminFetchPendingTournoiEntries();
  if (!rows.length) {
    wrap.innerHTML = '<div class="bj-rec">Aucune entrée en attente de validation.</div>';
    return;
  }
  wrap.innerHTML = `
    <div class="admin-tournoi-batch">
      <label class="admin-tournoi-select-all"><input type="checkbox" onchange="adminTournoiToggleAll(this.checked)"> Tout</label>
      <button type="button" class="profile-mini-btn primary" onclick="adminBatchModerateTournoi('verify')">Valider la sélection</button>
      <button type="button" class="profile-mini-btn danger" onclick="adminBatchModerateTournoi('reject')">Refuser la sélection</button>
      <span class="bj-rec">${rows.length} en attente</span>
    </div>
    <div class="table-wrap">
      <table class="admin-tournoi-table">
        <thead><tr>
          <th></th><th>Date</th><th>Joueur</th><th>Hunt</th><th>Gain</th><th>Multi</th><th>Replay</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows.map((r) => {
          const rid = String(r.id);
          const checked = adminTournoiSelection.has(rid) ? 'checked' : '';
          const replay = r.replay_url && isSafeUrl(r.replay_url)
            ? `<a href="${escapeHtml(r.replay_url)}" target="_blank" rel="noopener noreferrer">Voir</a>`
            : '<span class="tournoi-replay-missing">Manquant</span>';
          return `<tr>
            <td><input type="checkbox" class="admin-tournoi-cb" value="${escapeHtml(rid)}" ${checked} onchange="adminTournoiToggle('${escapeHtml(rid)}', this.checked)"></td>
            <td>${escapeHtml(new Date(r.created_at).toLocaleDateString('fr-FR'))}</td>
            <td>${escapeHtml(r.player_name || '—')}</td>
            <td>${escapeHtml(r.hunt_name || '—')}</td>
            <td>${fmt(r.gain)} / ${fmt(r.mise)}</td>
            <td>×${Number(r.multiplier || 0).toFixed(2)}</td>
            <td>${replay}</td>
            <td class="admin-tournoi-actions">
              <button type="button" class="profile-mini-btn primary" onclick="adminVerifyTournoiEntry('${escapeHtml(rid)}', true)">Valider</button>
              <button type="button" class="profile-mini-btn danger" onclick="adminRejectTournoiEntry('${escapeHtml(rid)}')">Refuser</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

async function fetchNewsVideos() {
  const c = getAuthClient();
  if (!c) throw new Error('Supabase indisponible');
  const { data, error } = await cloudCall('news', () => c
    .from('youtube_videos')
    .select('id,video_id,title,url,thumbnail,description,published_at,channel_label')
    .order('published_at', { ascending: false })
    .limit(12), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchNewsSlots() {
  const c = getAuthClient();
  if (!c) throw new Error('Supabase indisponible');
  const { data, error } = await cloudCall('news', () => c
    .from('slot_releases')
    .select('id,source,title,provider,image,summary,url,published_at')
    .order('published_at', { ascending: false })
    .limit(18), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function formatNewsDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'à l’instant';
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const days = Math.floor(h / 24);
    if (days < 7) return `il y a ${days} j`;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (_) { return '—'; }
}

function renderNewsVideoCard(v) {
  const url = v.url || (v.video_id ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.video_id)}` : '#');
  const thumb = v.thumbnail || (v.video_id ? `https://i.ytimg.com/vi/${encodeURIComponent(v.video_id)}/hqdefault.jpg` : '');
  const title = escapeHtml(String(v.title || 'Vidéo HugoTaSlot'));
  const channel = escapeHtml(String(v.channel_label || 'HugoTaSlot'));
  const when = escapeHtml(formatNewsDate(v.published_at));
  return `
    <article class="news-card">
      <a class="news-card-thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        ${thumb ? `<img src="${escapeHtml(thumb)}" alt="${title}" referrerpolicy="no-referrer" loading="lazy">` : ''}
        <span class="news-badge video">YouTube</span>
      </a>
      <div class="news-card-body">
        <div class="news-card-title">${title}</div>
        <div class="news-card-meta"><span>${channel}</span><span>${when}</span></div>
        <div class="news-card-actions">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Regarder</a>
        </div>
      </div>
    </article>
  `;
}

function renderNewsSlotCard(s) {
  const src = String(s.source || 'manual').toLowerCase();
  const badgeMap = {
    bigwinboard: { cls: 'bigwinboard', lbl: 'BigWinBoard' },
    slotcatalog: { cls: 'bigwinboard', lbl: 'SlotCatalog' },
    stake: { cls: 'manual', lbl: 'Stake' },
    gamdom: { cls: 'manual', lbl: 'Gamdom' },
    shuffle: { cls: 'manual', lbl: 'Shuffle' },
    celsius: { cls: 'manual', lbl: 'Celsius' },
    manual: { cls: 'manual', lbl: 'Maison' },
  };
  const badge = badgeMap[src] || badgeMap.manual;
  const badgeCls = badge.cls;
  const badgeLbl = badge.lbl;
  const title = escapeHtml(String(s.title || 'Nouvelle slot'));
  const provider = escapeHtml(String(s.provider || ''));
  const summary = String(s.summary || '').replace(/\s+/g, ' ').trim();
  const summaryShort = summary.length > 180 ? `${escapeHtml(summary.slice(0, 180))}…` : escapeHtml(summary);
  const url = s.url || '';
  const img = s.image || '';
  const when = escapeHtml(formatNewsDate(s.published_at));
  return `
    <article class="news-card">
      <div class="news-card-thumb">
        ${img ? `<img src="${escapeHtml(img)}" alt="${title}" referrerpolicy="no-referrer" loading="lazy">` : ''}
        <span class="news-badge ${badgeCls}">${badgeLbl}</span>
      </div>
      <div class="news-card-body">
        <div class="news-card-title">${title}</div>
        <div class="news-card-meta"><span>${provider || '—'}</span><span>${when}</span></div>
        ${summaryShort ? `<div class="news-card-summary">${summaryShort}</div>` : ''}
        ${url ? `<div class="news-card-actions"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">En savoir plus</a></div>` : ''}
      </div>
    </article>
  `;
}

async function renderNewsPage(force = false) {
  const vGrid = document.getElementById('news-videos-grid');
  const sGrid = document.getElementById('news-slots-grid');
  if (!vGrid || !sGrid) return;
  const fresh = !force && NEWS_CACHE.videos && NEWS_CACHE.slots && (Date.now() - NEWS_CACHE.ts) < NEWS_TTL_MS;
  if (fresh) {
    vGrid.innerHTML = NEWS_CACHE.videos.length ? NEWS_CACHE.videos.map(renderNewsVideoCard).join('') : `<div class="bj-rec">Aucune vidéo pour l’instant.</div>`;
    sGrid.innerHTML = NEWS_CACHE.slots.length ? NEWS_CACHE.slots.map(renderNewsSlotCard).join('') : `<div class="bj-rec">Aucune sortie publiée pour l’instant.</div>`;
    renderNewsSlotWeekBanner(NEWS_CACHE.slots);
    return;
  }
  vGrid.innerHTML = `<div class="bj-rec">Chargement…</div>`;
  sGrid.innerHTML = `<div class="bj-rec">Chargement…</div>`;
  try {
    const [videos, slots] = await Promise.all([
      fetchNewsVideos().catch((e) => { bhWarn('[news] videos', e); return []; }),
      fetchNewsSlots().catch((e) => { bhWarn('[news] slots', e); return []; })
    ]);
    NEWS_CACHE.videos = videos;
    NEWS_CACHE.slots = slots;
    NEWS_CACHE.ts = Date.now();
    vGrid.innerHTML = videos.length ? videos.map(renderNewsVideoCard).join('') : `<div class="bj-rec">Aucune vidéo pour l’instant. Le bot Discord les publiera dès qu’une nouvelle vidéo HugoTaSlot sortira.</div>`;
    sGrid.innerHTML = slots.length ? slots.map(renderNewsSlotCard).join('') : `<div class="bj-rec">Aucune sortie publiée. Les admins peuvent en ajouter manuellement depuis le panel admin.</div>`;
    renderNewsSlotWeekBanner(slots);
  } catch (e) {
    vGrid.innerHTML = `<div class="bj-rec" style="color:#ff9fb1;">Impossible de charger les vidéos. ${escapeHtml(mapAuthError(e))}</div>`;
    sGrid.innerHTML = `<div class="bj-rec" style="color:#ff9fb1;">Impossible de charger les sorties. ${escapeHtml(mapAuthError(e))}</div>`;
  }
}

// ────────────────────────────────────────────────────────────
// LIAISON DISCORD (modal profil + bandeau accueil)
// ────────────────────────────────────────────────────────────
let discordLinkCache = { linked: false, username: '', pendingCode: '', checked: false };

function buildSlotHuntPrefillUrl(slot) {
  const title = String(slot?.title || slot?.nom || slot?.name || '').trim();
  if (!title) return '';
  const params = new URLSearchParams();
  params.set('slotTitle', title);
  const provider = String(slot?.provider || '').trim();
  const image = String(slot?.image || '').trim();
  const url = String(slot?.url || slot?.gamdomUrl || '').trim();
  if (provider) params.set('slotProvider', provider);
  if (image) params.set('slotImage', image);
  if (url) params.set('slotUrl', url);
  let origin = 'https://hugotaslot.fr';
  try { origin = location.origin || origin; } catch (_) {}
  return `${origin}/hunt?${params.toString()}`;
}

function getAdminSlotDraft() {
  return {
    title: String(document.getElementById('admin-slot-title')?.value || '').trim(),
    provider: String(document.getElementById('admin-slot-provider')?.value || '').trim(),
    image: String(document.getElementById('admin-slot-image')?.value || '').trim(),
    url: String(document.getElementById('admin-slot-url')?.value || '').trim(),
    summary: String(document.getElementById('admin-slot-summary')?.value || '').trim(),
  };
}

function syncAdminSlotPreview() {
  const wrap = document.getElementById('admin-slot-preview-wrap');
  const img = document.getElementById('admin-slot-preview-img');
  const linkEl = document.getElementById('admin-slot-prefill-link');
  const draft = getAdminSlotDraft();
  const src = draft.image && typeof isSafeUrl === 'function' && isSafeUrl(draft.image) ? draft.image : '';
  if (wrap && img) {
    if (src) {
      wrap.classList.remove('hidden');
      img.src = src;
    } else {
      wrap.classList.add('hidden');
      img.removeAttribute('src');
    }
  }
  if (linkEl) {
    const huntUrl = buildSlotHuntPrefillUrl(draft);
    if (huntUrl && draft.title) {
      linkEl.style.display = '';
      linkEl.innerHTML = `Lien hunt pré-rempli (Discord) : <a href="${escapeHtml(huntUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(huntUrl)}</a>`;
    } else {
      linkEl.style.display = 'none';
      linkEl.innerHTML = '';
    }
  }
}

function adminPreviewSlotToHunt() {
  const draft = getAdminSlotDraft();
  if (!draft.title) {
    showToast('Renseigne le nom de la slot', 'error');
    return;
  }
  if (typeof addNewsSlotToHunt === 'function') {
    addNewsSlotToHunt({
      title: draft.title,
      provider: draft.provider,
      image: draft.image,
      url: draft.url,
    });
  }
}

function maybeOpenPendingSlotPrefill() {
  const slot = window.__pendingSlotPrefill;
  if (!slot || !state.activeHuntId) return;
  window.__pendingSlotPrefill = null;
  if (typeof openAddModal === 'function') {
    setTimeout(() => openAddModal(slot), 120);
  }
}

function consumeSlotPrefillFromUrl() {
  try {
    const params = new URLSearchParams(location.search || '');
    const title = String(params.get('slotTitle') || '').trim();
    if (!title) return;
    window.__pendingSlotPrefill = {
      nom: title,
      name: title,
      title,
      provider: String(params.get('slotProvider') || '').trim(),
      image: String(params.get('slotImage') || '').trim(),
      gamdomUrl: String(params.get('slotUrl') || '').trim(),
      url: String(params.get('slotUrl') || '').trim(),
    };
    history.replaceState(history.state || { page: 'hunt' }, '', location.pathname || '/hunt');
    switchPage('hunt');
    if (state.activeHuntId) {
      maybeOpenPendingSlotPrefill();
    } else {
      showToast('Choisis ou crée un hunt pour ajouter la slot annoncée', 'info', 3600);
    }
  } catch (_) {}
}

async function renderHomeDiscordBanner() {
  const wrap = document.getElementById('home-discord-banner');
  if (!wrap) return;
  const cmds = [
    { code: '/hunts', desc: 'Tes hunts liés' },
    { code: '/leaderboard', desc: 'Top profits communauté' },
    { code: '/live slug', desc: 'Lien hunt public partagé' },
    { code: '/slot · /call', desc: 'Catalogue (tous)' },
  ];
  const cmdHtml = cmds.map((c) => `<span class="home-discord-cmd"><code>${escapeHtml(c.code)}</code> ${escapeHtml(c.desc)}</span>`).join('');
  if (!currentUser?.cloud || currentUser?.isGuest) {
    wrap.innerHTML = `
      <div class="home-discord-inner">
        <div class="home-discord-icon" aria-hidden="true">💬</div>
        <div class="home-discord-body">
          <div class="home-discord-kicker">BOT DISCORD HUGOTASLOT</div>
          <div class="home-discord-title">Lie ton compte pour débloquer les commandes hunt</div>
          <div class="home-discord-cmds">${cmdHtml}</div>
        </div>
        <button type="button" class="home-discord-cta" onclick="showAuth()">CONNEXION CLOUD</button>
      </div>`;
    return;
  }
  wrap.innerHTML = `<div class="home-discord-inner home-discord-loading"><div class="bj-rec">Chargement liaison Discord…</div></div>`;
  await refreshDiscordLinkCache().catch(() => {});
  const linked = discordLinkCache.linked;
  const who = discordLinkCache.username ? ` (${discordLinkCache.username})` : '';
  wrap.innerHTML = `
    <div class="home-discord-inner${linked ? ' is-linked' : ''}">
      <div class="home-discord-icon" aria-hidden="true">${linked ? '✔' : '💬'}</div>
      <div class="home-discord-body">
        <div class="home-discord-kicker">BOT DISCORD HUGOTASLOT</div>
        <div class="home-discord-title">${linked ? `Compte lié${escapeHtml(who)} — commandes actives` : 'Lie ton Discord en 2 minutes'}</div>
        <div class="home-discord-cmds">${cmdHtml}</div>
        ${discordLinkCache.pendingCode ? `<div class="home-discord-pending">Code en attente : <strong>${escapeHtml(discordLinkCache.pendingCode)}</strong> → <code>/link ${escapeHtml(discordLinkCache.pendingCode)}</code></div>` : ''}
      </div>
      <button type="button" class="home-discord-cta" onclick="openDiscordLinkModal()">${linked ? 'GÉRER LA LIAISON' : 'LIER MON DISCORD'}</button>
    </div>`;
}

async function refreshDiscordLinkCache() {
  discordLinkCache = { linked: false, username: '', pendingCode: '', checked: true };
  if (!currentUser?.cloud || currentUser?.isGuest) return discordLinkCache;
  const c = getAuthClient();
  if (!c) return discordLinkCache;
  try {
    const { data, error } = await cloudCall('discord-link', () => c
      .from('discord_links')
      .select('discord_id,discord_username,code,expires_at')
      .eq('user_id', currentUser.id)
      .maybeSingle(), { retries: 1, timeoutMs: 8000, delayMs: 300, quiet: true });
    if (error && error.code !== 'PGRST116') throw error;
    if (data?.discord_id) {
      discordLinkCache.linked = true;
      discordLinkCache.username = data.discord_username || '';
    } else if (data?.code && data?.expires_at && new Date(data.expires_at).getTime() > Date.now()) {
      discordLinkCache.pendingCode = data.code;
    }
  } catch (_) {}
  return discordLinkCache;
}

function generateDiscordLinkRandomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint8Array(6);
  (window.crypto || window.msCrypto).getRandomValues(buf);
  for (let i = 0; i < 6; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

function openDiscordLinkModal() {
  const modal = document.getElementById('discord-link-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  loadDiscordLinkStatus().catch(() => {});
}

function closeDiscordLinkModal() {
  const modal = document.getElementById('discord-link-modal');
  if (modal) modal.classList.add('hidden');
}

async function loadDiscordLinkStatus() {
  const status = document.getElementById('discord-link-status');
  const body = document.getElementById('discord-link-body');
  const unlinkBtn = document.getElementById('discord-link-unlink');
  if (!status || !body) return;
  if (!currentUser?.cloud || currentUser?.isGuest) {
    status.innerHTML = `<span style="color:#ff9fb1;">Connecte-toi avec un compte cloud pour lier ton Discord.</span>`;
    body.innerHTML = '';
    if (unlinkBtn) unlinkBtn.style.display = 'none';
    return;
  }
  status.textContent = 'Chargement…';
  body.innerHTML = '';
  if (unlinkBtn) unlinkBtn.style.display = 'none';
  const c = getAuthClient();
  if (!c) { status.innerHTML = `<span style="color:#ff9fb1;">Supabase indisponible.</span>`; return; }
  try {
    const { data, error } = await cloudCall('discord-link', () => c
      .from('discord_links')
      .select('id,discord_id,discord_username,code,expires_at,linked_at')
      .eq('user_id', currentUser.id)
      .maybeSingle(), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true });
    if (error && error.code !== 'PGRST116') throw error;
    if (data?.discord_id) {
      status.innerHTML = `<span style="color:var(--green);">✔ Compte lié à <strong>${escapeHtml(data.discord_username || data.discord_id)}</strong>.</span>`;
      body.innerHTML = `<div class="bj-rec">Commandes liées : <code>/hunts</code>, <code>/leaderboard</code>, <code>/live slug</code> (hunt public). Pour tous : <code>/slot</code>, <code>/call</code>, <code>/lastvideo</code>, <code>/lastslot</code>.</div>`;
      discordLinkCache = { linked: true, username: data.discord_username || '', pendingCode: '', checked: true };
      if (unlinkBtn) unlinkBtn.style.display = 'inline-flex';
      if (typeof renderHomeDiscordBanner === 'function') renderHomeDiscordBanner();
      return;
    }
    if (data?.code && data?.expires_at && new Date(data.expires_at).getTime() > Date.now()) {
      const remainMin = Math.max(1, Math.round((new Date(data.expires_at).getTime() - Date.now()) / 60000));
      status.innerHTML = `<span style="color:var(--gold-dim);">Code en attente (${remainMin} min). Tape <code>/link CODE</code> sur Discord.</span>`;
      body.innerHTML = `
        <div class="discord-code-box">
          <span class="discord-code-value">${escapeHtml(data.code)}</span>
          <button class="profile-mini-btn" type="button" onclick="navigator.clipboard?.writeText('${escapeHtml(data.code)}').then(()=>showToast('Code copié','success'))">Copier</button>
        </div>
        <div class="bj-rec">Sur Discord : <code>/link code:${escapeHtml(data.code)}</code> — puis <code>/hunts</code>, <code>/leaderboard</code>, <code>/live slug</code>.</div>`;
      discordLinkCache = { linked: false, username: '', pendingCode: data.code, checked: true };
      if (typeof renderHomeDiscordBanner === 'function') renderHomeDiscordBanner();
      return;
    }
    status.innerHTML = `Aucune liaison active. Génère un code à utiliser sur Discord.`;
    body.innerHTML = `<div class="bj-rec">Après liaison : <code>/hunts</code>, <code>/leaderboard</code>, <code>/live slug</code> pour les hunts publics partagés.</div>`;
    discordLinkCache = { linked: false, username: '', pendingCode: '', checked: true };
    if (typeof renderHomeDiscordBanner === 'function') renderHomeDiscordBanner();
  } catch (e) {
    status.innerHTML = `<span style="color:#ff9fb1;">${escapeHtml(mapAuthError(e))}</span>`;
  }
}

async function generateDiscordLinkCode() {
  if (!currentUser?.cloud || currentUser?.isGuest) {
    showToast('Compte cloud requis', 'error');
    return;
  }
  const g = actionGuardAcquire('discord:link', { limit: 6, windowMs: 60_000, blockMs: 30_000 });
  if (g.blocked) { showToast(`Trop d’essais. Réessaie dans ${g.waitSec}s.`, 'error'); return; }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  const status = document.getElementById('discord-link-status');
  if (status) status.textContent = 'Génération…';
  const code = generateDiscordLinkRandomCode();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  try {
    const existingRes = await cloudCall('discord-link', () => c
      .from('discord_links')
      .select('id,discord_id')
      .eq('user_id', currentUser.id)
      .maybeSingle(), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true });
    if (existingRes.error && existingRes.error.code !== 'PGRST116') throw existingRes.error;
    const row = existingRes.data;
    if (row?.discord_id) {
      if (status) status.innerHTML = `<span style="color:#ff9fb1;">Compte déjà lié. Délie-le avant de générer un nouveau code.</span>`;
      return;
    }
    if (row?.id) {
      const { error } = await cloudCall('discord-link', () => c
        .from('discord_links')
        .update({ code, expires_at: expires, linked_at: null, discord_username: null })
        .eq('id', row.id), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
      if (error) throw error;
    } else {
      const { error } = await cloudCall('discord-link', () => c
        .from('discord_links')
        .insert({
          user_id: currentUser.id,
          code,
          expires_at: expires,
          discord_id: null,
          discord_username: null,
          linked_at: null
        }), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
      if (error) throw error;
    }
    showToast('Code généré', 'success');
    await loadDiscordLinkStatus();
  } catch (e) {
    if (status) status.innerHTML = `<span style="color:#ff9fb1;">${escapeHtml(mapAuthError(e))}</span>`;
    showToast(mapAuthError(e), 'error');
  }
}

async function unlinkDiscordAccount() {
  if (!currentUser?.cloud || currentUser?.isGuest) return;
  if (!confirm('Délier ton compte Discord ? Tu pourras toujours en relier un autre ensuite.')) return;
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  try {
    const { error } = await cloudCall('discord-link', () => c
      .from('discord_links')
      .delete()
      .eq('user_id', currentUser.id), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true });
    if (error) throw error;
    showToast('Compte Discord délié', 'success');
    await loadDiscordLinkStatus();
  } catch (e) {
    showToast(mapAuthError(e), 'error');
  }
}

// ────────────────────────────────────────────────────────────
// ADMIN — annoncer une slot manuellement
// ────────────────────────────────────────────────────────────
function resetAdminSlotForm() {
  ['admin-slot-title', 'admin-slot-provider', 'admin-slot-image', 'admin-slot-url', 'admin-slot-summary'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const st = document.getElementById('admin-slot-status');
  if (st) st.textContent = '';
  syncAdminSlotPreview();
}

function slugifyForSlotRelease(title, provider) {
  const raw = `${provider || ''} ${title || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `manual-${slug || Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

async function adminPostManualSlot() {
  if (!isCurrentUserAdmin() || !currentUser?.cloud) { showToast('Réservé aux admins cloud', 'error'); return; }
  const title = String(document.getElementById('admin-slot-title')?.value || '').trim();
  const provider = String(document.getElementById('admin-slot-provider')?.value || '').trim();
  const image = String(document.getElementById('admin-slot-image')?.value || '').trim();
  const url = String(document.getElementById('admin-slot-url')?.value || '').trim();
  const summary = String(document.getElementById('admin-slot-summary')?.value || '').trim();
  const statusEl = document.getElementById('admin-slot-status');
  if (!title) { if (statusEl) statusEl.innerHTML = `<span style="color:#ff9fb1;">Le nom de la slot est obligatoire.</span>`; return; }
  const g = actionGuardAcquire('admin:slot_release', { limit: 20, windowMs: 60_000, blockMs: 30_000 });
  if (g.blocked) { showToast(`Trop d’actions. Réessaie dans ${g.waitSec}s.`, 'error'); return; }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  if (statusEl) statusEl.textContent = 'Publication…';
  try {
    const payload = {
      source: 'manual',
      slug: slugifyForSlotRelease(title, provider),
      title,
      provider: provider || null,
      image: image || null,
      summary: summary || null,
      url: url || null,
      created_by: currentUser.id || null,
      published_at: new Date().toISOString()
    };
    const { data, error } = await cloudCall('admin', () => c.from('slot_releases').insert(payload).select('id').single(), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
    if (error) throw error;
    if (data?.id && typeof setSlotOfTheWeek === 'function') setSlotOfTheWeek(data.id);
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--green);">✔ Publiée. Le bot Discord la postera dans les 60 secondes.</span>`;
    showToast('Slot publiée', 'success');
    resetAdminSlotForm();
    NEWS_CACHE.ts = 0;
    await loadAdminRecentSlots();
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:#ff9fb1;">${escapeHtml(mapAuthError(e))}</span>`;
    showToast(mapAuthError(e), 'error');
  }
}

async function loadAdminRecentSlots() {
  const wrap = document.getElementById('admin-recent-slots');
  if (!wrap) return;
  if (!isCurrentUserAdmin() || !currentUser?.cloud) { wrap.innerHTML = ''; return; }
  const c = getAuthClient();
  if (!c) return;
  wrap.innerHTML = `<div class="bj-rec">Chargement des dernières slots…</div>`;
  try {
    const { data, error } = await cloudCall('admin', () => c
      .from('slot_releases')
      .select('id,source,title,provider,published_at,posted_to_discord_at,url')
      .order('published_at', { ascending: false })
      .limit(10), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true });
    if (error) throw error;
    const rows = (data || []).map((s) => `
      <tr>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(new Date(s.published_at).toLocaleString('fr-FR'))}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(s.source || '—')}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(s.title || '—')}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(s.provider || '—')}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${s.posted_to_discord_at ? `<span style="color:var(--green);">✔</span>` : `<span style="color:var(--text-dim);">en file</span>`}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">lien</a>` : '—'}</td>
        <td style="padding:8px;border-top:1px solid var(--border);"><button type="button" class="profile-mini-btn" onclick="setSlotOfTheWeek('${escapeHtml(s.id)}');showToast('Slot de la semaine définie','success',1800);">Semaine</button></td>
      </tr>
    `).join('');
    wrap.innerHTML = `
      <div class="mise-section-title" style="margin:6px 0 6px;">DERNIÈRES SLOTS</div>
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;">Date</th>
              <th style="text-align:left;padding:8px;">Source</th>
              <th style="text-align:left;padding:8px;">Slot</th>
              <th style="text-align:left;padding:8px;">Provider</th>
              <th style="text-align:left;padding:8px;">Discord</th>
              <th style="text-align:left;padding:8px;">URL</th>
              <th style="text-align:left;padding:8px;">Semaine</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6" style="padding:10px;color:var(--text-dim);">Aucune slot encore publiée.</td></tr>`}</tbody>
        </table>
      </div>`;
  } catch (e) {
    wrap.innerHTML = `<div class="bj-rec" style="color:#ff9fb1;">${escapeHtml(mapAuthError(e))}</div>`;
  }
}

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
let globalSearchDebounce = null;
let globalSearchCloudUsersCache = [];
let globalSearchCloudUsersAt = 0;
async function runGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const out = document.getElementById('global-search-results');
  if (!input || !out) return;
  const q = String(input.value || '').trim().toLowerCase();
  if (!q) { out.innerHTML = ''; return; }

  const rows = [];
  const reviewKeys = ['review', 'avis', 'retour', 'retours', 'feedback', 'beta', 'bêta', 'testeur', 'testeurs', 'suggestion', 'suggestions', 'bug', 'idee', 'idée'];
  if (reviewKeys.some((k) => q === k || (k.length > 3 && (q.includes(k) || k.includes(q))))) {
    rows.push({ t: 'review', label: 'Page REVIEW — avis & bugs (bêta)', action: `switchPage('review')` });
  }
  const studioKeys = ['studio', 'stream', 'streamer', 'obs', 'hud', 'opener', 'overlay', 'live'];
  if (studioKeys.some((k) => q === k || q.includes(k))) {
    rows.push({ t: 'studio', label: 'Studio Stream — opener, HUD, options live', action: `switchPage('studio')` });
  }
  if (q.includes('live') || q.includes('public') || q.includes('spectateur') || q.includes('viewer')) {
    rows.push({ t: 'live', label: 'Lien public live du hunt (bouton LIEN LIVE)', action: `selectHunt(state.activeHuntId);switchPage('hunt');copyPublicHuntLiveLink()` });
  }
  const newsKeys = ['news', 'actu', 'actus', 'actualité', 'actualités', 'actualite', 'actualites', 'video', 'vidéo', 'youtube', 'slot', 'slots', 'sortie', 'sorties', 'nouveauté', 'nouveautes', 'discord'];
  if (newsKeys.some((k) => q === k || (k.length > 3 && (q.includes(k) || k.includes(q))))) {
    rows.push({ t: 'news', label: 'Page ACTUALITÉS — vidéos YouTube & nouvelles slots', action: `switchPage('news')` });
  }
  (state.hunts || []).forEach((h) => {
    const hName = String(h.name || '').toLowerCase();
    if (hName.includes(q)) rows.push({ t: 'hunt', label: `Hunt: ${h.name}`, action: `selectHunt('${h.id}');switchPage('hunt')` });
    (h.bonuses || []).forEach((b, idx) => {
      const n = String(b.slotName || '').toLowerCase();
      const p = String(b.slotProvider || '').toLowerCase();
      if (n.includes(q) || p.includes(q)) {
        rows.push({ t: 'bonus', label: `${b.slotName} (${b.slotProvider || '—'})`, action: `selectHunt('${h.id}');switchPage('hunt');openOpener(${idx})` });
      }
    });
  });

  if (isCurrentUserAdmin()) {
    let users = [];
    if (currentUser?.cloud) {
      const now = Date.now();
      if ((now - globalSearchCloudUsersAt) > 20000) {
        try {
          globalSearchCloudUsersCache = await adminFetchCloudUsers();
          globalSearchCloudUsersAt = now;
        } catch (_) {}
      }
      users = globalSearchCloudUsersCache;
    } else {
      users = Object.entries(getUsers()).map(([username, u]) => ({ username, email: u?.email || '' }));
    }
    users.forEach((u) => {
      const un = String(u.username || '').toLowerCase();
      const em = String(u.email || '').toLowerCase();
      if (un.includes(q) || em.includes(q)) rows.push({ t: 'user', label: `User: ${u.username}`, action: `switchPage('admin')` });
    });
  }

  const top = rows.slice(0, 20);
  out.innerHTML = top.length
    ? `<div class="table-wrap"><table style="width:100%;border-collapse:collapse;"><tbody>${
        top.map((r) => `<tr><td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.label)}</td><td style="padding:8px;border-top:1px solid var(--border);text-align:right;"><button class="profile-mini-btn" onclick="${r.action}">Ouvrir</button></td></tr>`).join('')
      }</tbody></table></div>`
    : `<div class="bj-rec">Aucun résultat pour "${escapeHtml(q)}"</div>`;
}
function renderUpdatesPage() {
  const changelogWrap = document.getElementById('updates-changelog');
  const wrap = document.getElementById('updates-content');
  if (changelogWrap) {
    if (typeof renderProductChangelogSection === 'function') {
      renderProductChangelogSection().catch(() => {
        if (typeof renderProductChangelogHtml === 'function') changelogWrap.innerHTML = renderProductChangelogHtml();
      });
    } else if (typeof renderProductChangelogHtml === 'function') {
      changelogWrap.innerHTML = renderProductChangelogHtml();
    }
  }
  if (!wrap) return;
  const logs = getRuntimeLogs().slice(0, 10);
  const blocks = getActionGuardStatus();
  const maint = getMaintenanceConfig();
  const snaps = getAutoSnapshots();
  const latestSnap = snaps[0] || null;
  const ops = getOpsAlertsConfig();
  const healthBadge = (v) => {
    if (v === 'up') return '<span style="color:#8fffc3;">UP</span>';
    if (v === 'no-session' || v === 'auth-required') return '<span style="color:#ffd38a;">AUTH</span>';
    if (v === 'degraded') return '<span style="color:#ffb3c3;">DEGRADED</span>';
    if (v === 'down') return '<span style="color:#ff9fb1;">DOWN</span>';
    return '<span style="color:var(--text-dim);">UNKNOWN</span>';
  };
  const syncState = cloudSyncDisabled
    ? 'Désactivée (fallback local actif)'
    : (cloudSyncInFlight ? 'Synchronisation en cours...' : `Active (échecs récents: ${cloudSyncFailureCount})`);
  wrap.innerHTML = `
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">Sprint 1 — Stabilisation Prod (terminé)</div>
      <div class="drop-meta">
        ✅ Sync cloud robuste: retry + fallback + mode offline<br>
        ✅ Surveillance runtime + Health Check Supabase<br>
        ✅ Sécurité auth/admin: anti-spam + cooldown API<br>
        ✅ Sessions: logout local + logout global multi-appareils<br>
        ✅ Mode maintenance: joueurs en lecture seule<br>
        ✅ Audit admin + snapshots auto + restauration d’urgence
      </div>
    </div>
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">État temps réel</div>
      <div class="drop-meta">
        • Sync cloud: ${escapeHtml(syncState)}<br>
        • Connexion: ${navigator.onLine ? 'En ligne' : 'Hors ligne'}<br>
        • Utilisateurs en ligne: ${Math.max(1, Number(onlineCount || 1))}<br>
        • Cooldown actifs: ${blocks.length}<br>
        • Maintenance: ${maint.enabled ? 'ACTIVE' : 'OFF'}
      </div>
    </div>
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">Health Check Supabase</div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button class="profile-mini-btn" onclick="runSupabaseHealthCheck(true)">Refresh check</button>
      </div>
      <div class="drop-meta">
        • Client: ${healthBadge(supaHealth.client)}<br>
        • Auth: ${healthBadge(supaHealth.auth)}<br>
        • DB: ${healthBadge(supaHealth.db)}<br>
        • Realtime: ${healthBadge(supaHealth.realtime)}<br>
        • Latence: ${Number.isFinite(Number(supaHealth.latencyMs)) ? `${Number(supaHealth.latencyMs)} ms` : '—'}<br>
        • Dernier check: ${supaHealth.checkedAt ? new Date(supaHealth.checkedAt).toLocaleTimeString('fr-FR') : '—'}<br>
        • Note: ${escapeHtml(supaHealth.note || 'OK')}
      </div>
    </div>
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">Anti-spam API (Sprint 1)</div>
      <div class="drop-meta" style="margin-bottom:8px;">Protection active sur Auth et actions Admin sensibles.</div>
      <div style="max-height:130px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;background:rgba(8,11,18,0.65);font-family:'Share Tech Mono',monospace;font-size:10px;">
        ${blocks.length ? blocks.map((b) => `<div style="padding:5px;border-bottom:1px solid rgba(255,255,255,0.06);color:#ffcf88;">${escapeHtml(b.key)} — bloqué ${b.waitSec}s</div>`).join('') : '<div style="color:var(--text-dim);">Aucun cooldown actif.</div>'}
      </div>
    </div>
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">Backups auto</div>
      <div class="drop-meta" style="margin-bottom:8px;">
        • Snapshots stockés: ${snaps.length}<br>
        • Dernier snapshot: ${latestSnap ? `${new Date(latestSnap.ts).toLocaleString('fr-FR')} (${escapeHtml(latestSnap.reason || 'save')})` : '—'}<br>
        • Alerting ops webhook: ${ops.enabled ? 'ON' : 'OFF'}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="profile-mini-btn" onclick="restoreLatestSnapshot()">Restaurer dernier snapshot</button>
      </div>
    </div>
    <div class="drop-box">
      <div class="drop-title">Journal runtime récent</div>
      <div class="drop-meta" style="margin-bottom:8px;">Erreurs utiles pour diagnostiquer vite les problèmes production.</div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button class="profile-mini-btn" onclick="clearRuntimeLogs()">Vider le journal</button>
      </div>
      <div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;background:rgba(8,11,18,0.65);font-family:'Share Tech Mono',monospace;font-size:10px;">
        ${logs.length ? logs.map((l) => `<div style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.06);color:${l.level === 'error' ? '#ff9fb1' : '#9fd4ff'};">[${new Date(l.ts).toLocaleTimeString('fr-FR')}] ${escapeHtml(l.level.toUpperCase())} — ${escapeHtml(l.msg)}</div>`).join('') : '<div style="color:var(--text-dim);">Aucun événement.</div>'}
      </div>
    </div>
  `;
}
function getFeedbackQueue() {
  try {
    const raw = JSON.parse(localStorage.getItem(FEEDBACK_QUEUE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function saveFeedbackQueue(items) {
  try {
    localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(items.slice(0, 50)));
  } catch (_) {}
}
async function flushFeedbackQueue() {
  const c = getAuthClient();
  if (!c) return;
  let q = getFeedbackQueue();
  if (!q.length) return;
  const remain = [];
  for (const item of q) {
    const row = {
      category: item.category,
      message: item.message,
      contact: item.contact || null,
      user_id: item.user_id || null,
      client_meta: item.client_meta || {}
    };
    try {
      const { error } = await cloudCall('sync', () => c.from('site_feedback').insert([row]), {
        retries: 1,
        timeoutMs: 14000,
        delayMs: 500,
        quiet: true
      });
      if (error) throw error;
    } catch (_) {
      remain.push(item);
    }
  }
  saveFeedbackQueue(remain);
  renderReviewPage();
}
function renderReviewPage() {
  const st = document.getElementById('review-status');
  if (!st) return;
  const pending = getFeedbackQueue().length;
  if (pending) {
    st.innerHTML = `${pending} message(s) en attente d’envoi (reconnexion / serveur). Ils partiront automatiquement.`;
    st.style.color = '#ffd38a';
  } else {
    st.textContent = '';
    st.style.color = '';
  }
}
async function submitSiteFeedback() {
  const catEl = document.getElementById('review-category');
  const msgEl = document.getElementById('review-message');
  const contactEl = document.getElementById('review-contact');
  const category = String(catEl?.value || 'autre').toLowerCase();
  const message = String(msgEl?.value || '').trim();
  const contact = String(contactEl?.value || '').trim().slice(0, 240);
  if (!['bug', 'idee', 'autre'].includes(category)) {
    showToast('Type de retour invalide', 'error');
    return;
  }
  if (message.length < 3) {
    showToast('Message trop court (3 caractères min.)', 'error');
    return;
  }
  const g = actionGuardAcquire('site:feedback', { limit: 5, windowMs: 120000, blockMs: 180000 });
  if (g.blocked) {
    showToast(`Trop d’envois récents. Réessaie dans ${g.waitSec}s.`, 'error');
    return;
  }
  const userId = (currentUser && !currentUser.isGuest && currentUser.id) ? currentUser.id : null;
  const row = {
    category,
    message: message.slice(0, 4000),
    contact: contact || null,
    user_id: userId,
    client_meta: {
      ua: String(navigator.userAgent || '').slice(0, 280),
      path: String(location.pathname || '') || '/'
    }
  };
  const c = getAuthClient();
  if (!c) {
    const q = getFeedbackQueue();
    q.push({ ...row, queuedAt: Date.now() });
    saveFeedbackQueue(q);
    if (msgEl) msgEl.value = '';
    renderReviewPage();
    showToast('Hors ligne : retour mis en file, envoi automatique plus tard.', 'info', 3200);
    return;
  }
  try {
    const { error } = await cloudCall('sync', () => c.from('site_feedback').insert([row]), {
      retries: 1,
      timeoutMs: 14000,
      delayMs: 500,
      quiet: true
    });
    if (error) throw error;
    if (msgEl) msgEl.value = '';
    if (contactEl) contactEl.value = '';
    renderReviewPage();
    showToast('Merci ! Ton retour a bien été envoyé.', 'success');
    invalidateCache('admin', 'feedback');
  } catch (e) {
    const q = getFeedbackQueue();
    q.push({ ...row, queuedAt: Date.now() });
    saveFeedbackQueue(q);
    renderReviewPage();
    const msg = String(e?.message || e?.details || e || '').toLowerCase();
    const code = String(e?.code || e?.hint || '').toLowerCase();
    const missingTable =
      code === '42p01'
      || msg.includes('pgrst205')
      || (msg.includes('site_feedback') && (
        msg.includes('relation') || msg.includes('schema cache') || msg.includes('does not exist')
        || msg.includes('could not find') || msg.includes('not found')
      ));
    const rlsDenied = msg.includes('permission denied') || msg.includes('row-level security') || msg.includes('rls');
    pushRuntimeLog('warn', `site_feedback insert failed: ${String(e?.message || e).slice(0, 200)}`);
    let toastText = 'Connexion Supabase impossible : retour mis en file (réessaie plus tard).';
    let toastType = 'info';
    if (missingTable) {
      toastText = 'Table site_feedback absente : ouvre Supabase → SQL Editor, exécute site_feedback.sql, puis réessaie.';
      toastType = 'error';
    } else if (rlsDenied) {
      toastText = 'Insertion bloquée (RLS) : vérifie les politiques sur site_feedback dans Supabase.';
      toastType = 'error';
    }
    showToast(toastText, toastType, missingTable || rlsDenied ? 5500 : 4000);
  }
}
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

function adminSetBalancePrompt(username) {
  adminSetBalancePromptAsync(username).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminAdjustBalance(username, delta) {
  adminAdjustBalanceAsync(username, delta).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminAdjustBalanceFromInput(username) {
  const key = encodeURIComponent(String(username || ''));
  const input = document.getElementById(`admin-user-delta-${key}`);
  if (!input) return;
  const amount = Number(String(input.value || '').replace(',', '.'));
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) {
    showToast('Montant invalide', 'error');
    return;
  }
  adminAdjustBalanceAsync(username, amount)
    .then(() => { input.value = ''; })
    .catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminApplyPointsDropAll(onlyPlayers = false) {
  adminApplyPointsDropAllAsync(onlyPlayers).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminToggleUserRole(username) {
  adminToggleUserRoleAsync(username).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminDeleteHuntById(huntId) {
  adminDeleteHuntByIdAsync(huntId).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminSetMaintenanceMode() {
  if (!isCurrentUserAdmin()) return;
  const enabledEl = document.getElementById('admin-maint-enabled');
  const msgEl = document.getElementById('admin-maint-msg');
  const enabled = !!(enabledEl && enabledEl.checked);
  const message = String(msgEl?.value || MAINTENANCE_DEFAULT.message).trim();
  const c = getAuthClient();
  if (!c) {
    showToast('Supabase indisponible — maintenance serveur non modifiable', 'error');
    return;
  }
  cloudCall('admin', () => c.rpc('admin_set_maintenance', {
    p_enabled: enabled,
    p_message: message
  }), { retries: 1, timeoutMs: 12000, delayMs: 400 })
    .then(async ({ error }) => {
      if (error) throw error;
      await refreshMaintenanceConfig(true);
      pushLocalAdminAudit('admin_maintenance', `${enabled ? 'ON' : 'OFF'} ${message}`);
      showToast(enabled ? 'Mode maintenance activé (serveur)' : 'Mode maintenance désactivé', enabled ? 'info' : 'success');
      renderAdminPanel();
    })
    .catch((e) => showToast(mapAuthError(e) || 'Maintenance serveur — appliquez la migration SQL', 'error', 4000));
}
function adminSaveOpsAlerts() {
  if (!isCurrentUserAdmin()) return;
  const enabledEl = document.getElementById('admin-ops-enabled');
  const urlEl = document.getElementById('admin-ops-webhook');
  const enabled = !!(enabledEl && enabledEl.checked);
  const webhookUrl = String(urlEl?.value || '').trim();
  saveOpsAlertsConfig({ enabled, webhookUrl });
  pushLocalAdminAudit('admin_ops_alerts', `${enabled ? 'ON' : 'OFF'} ${webhookUrl ? 'webhook-set' : 'no-webhook'}`);
  showToast('Alerting ops sauvegardé', 'success', 1500);
}
async function adminTestOpsWebhook() {
  if (!isCurrentUserAdmin()) return;
  const cfg = getOpsAlertsConfig();
  if (!cfg.enabled) { showToast('Active d’abord l’alerting ops', 'info', 2400); return; }
  if (!/^https?:\/\//i.test(cfg.webhookUrl || '')) { showToast('URL webhook invalide', 'error'); return; }
  const r = await sendOpsAlert('info', 'Test webhook ops HugoTaSlot — ping depuis le panel admin', { force: true, test: true, source: 'admin_test' });
  if (r.ok) showToast('Webhook : test envoyé avec succès', 'success', 2800);
  else showToast(`Webhook échec (${r.reason})`, 'error', 4200);
}
function adminFireTestProdError() {
  if (!isCurrentUserAdmin()) return;
  pushRuntimeLog('error', 'TEST PROD — erreur simulée admin (chemin alerting ops réel)');
  showToast('Erreur prod simulée loggée — vérifie Discord/Slack si alerting activé', 'info', 3500);
}
async function adminFetchDashboardStats() {
  const c = getAuthClient();
  if (!c || !isCurrentUserAdmin()) return null;
  try {
    const { data, error } = await cloudCall('admin', () => c.rpc('get_admin_dashboard_stats'), {
      retries: 1,
      timeoutMs: 12000,
      delayMs: 300,
      quiet: true
    });
    if (error) throw error;
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    bhWarn('adminFetchDashboardStats', e);
    return null;
  }
}
async function adminSetBalancePromptAsync(username) {
  if (!isCurrentUserAdmin()) return;
  const g = actionGuardAcquire('admin:set_balance', { limit: 8, windowMs: 60000, blockMs: 90000 });
  if (g.blocked) { showToast(`Action temporairement bloquée (${g.waitSec}s)`, 'error'); return; }
  if (currentUser && currentUser.cloud) {
    const data = await adminFetchCloudUsers();
    const rec = data.find(u => (u.username || '').toLowerCase() === String(username || '').toLowerCase());
    if (!rec) return;
    const val = prompt(`Nouveau solde pour ${username}`, String(Number(rec.balance || 0).toFixed(2)));
    if (val === null) return;
    const next = Number(val);
    if (!Number.isFinite(next) || next < 0) { showToast('Solde invalide', 'error'); return; }
    const c = getAuthClient();
    const { error } = await cloudCall('admin', () => c.rpc('admin_set_balance', {
      p_user_id: rec.id,
      p_amount: Number(next.toFixed(2)),
      p_reason: 'admin panel set balance'
    }), { retries: 1, timeoutMs: 12000, delayMs: 500 });
    if (error) throw error;
    invalidateCache('admin');
    invalidateCache('profile', String(rec.id));
    if (currentUser.id === rec.id) {
      currentUser.balance = Number(next.toFixed(2));
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
    await renderAdminPanel();
    pushLocalAdminAudit('admin_set_balance', `${username} -> ${Number(next.toFixed(2))}`);
    showToast(`Solde cloud mis à jour pour ${username}`, 'success');
    return;
  }
  const users = getUsers();
  const rec = users[username];
  if (!rec) return;
  const val = prompt(`Nouveau solde pour ${username}`, String(Number(rec.balance || 0).toFixed(2)));
  if (val === null) return;
  const next = Number(val);
  if (!Number.isFinite(next) || next < 0) { showToast('Solde invalide', 'error'); return; }
  rec.balance = Number(next.toFixed(2));
  saveUsers(users);
  if (currentUser && currentUser.username === username) {
    currentUser.balance = rec.balance;
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_set_balance_local', `${username} -> ${rec.balance}`);
  showToast(`Solde mis à jour pour ${username}`, 'success');
}
async function adminAdjustBalanceAsync(username, delta) {
  if (!isCurrentUserAdmin()) return;
  const amount = Number(delta || 0);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return;
  if (currentUser && currentUser.cloud) {
    const data = await adminFetchCloudUsers();
    const rec = data.find(u => (u.username || '').toLowerCase() === String(username || '').toLowerCase());
    if (!rec) return;
    const isSelf = String(currentUser.id || '') === String(rec.id || '') || String(currentUser.username || '').toLowerCase() === String(username || '').toLowerCase();
    const baseBalance = isSelf ? Number(currentUser.balance || 0) : Number(rec.balance || 0);
    const next = Math.max(0, baseBalance + amount);
    const c = getAuthClient();
    const { error } = await cloudCall('admin', () => c.rpc('admin_set_balance', {
      p_user_id: rec.id,
      p_amount: Number(next.toFixed(2)),
      p_reason: `admin quick adjust ${amount >= 0 ? '+' : ''}${amount.toFixed(2)}`
    }), { retries: 1, timeoutMs: 12000, delayMs: 500 });
    if (error) throw error;
    invalidateCache('admin');
    invalidateCache('profile', String(rec.id));
    if (currentUser.id === rec.id) {
      currentUser.balance = Number(next.toFixed(2));
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
    await renderAdminPanel();
    pushLocalAdminAudit('admin_adjust_balance', `${username} ${amount >= 0 ? '+' : ''}${amount.toFixed(2)} -> ${next.toFixed(2)}`);
    showToast(`Solde ajusté pour ${username}`, 'success', 1400);
    return;
  }
  const users = getUsers();
  const rec = users[username];
  if (!rec) return;
  rec.balance = Math.max(0, Number(rec.balance || 0) + amount);
  saveUsers(users);
  if (currentUser && currentUser.username === username) {
    currentUser.balance = rec.balance;
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_adjust_balance_local', `${username} ${amount >= 0 ? '+' : ''}${amount.toFixed(2)} -> ${rec.balance.toFixed(2)}`);
  showToast(`Solde ajusté pour ${username}`, 'success', 1400);
}
async function adminApplyPointsDropAllAsync(onlyPlayers = false) {
  if (!isCurrentUserAdmin()) return;
  const input = document.getElementById('admin-drop-amount');
  const amount = Number(input?.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) { showToast('Montant de drop invalide', 'error'); return; }
  const g = actionGuardAcquire('admin:drop_points', { limit: 4, windowMs: 60000, blockMs: 90000 });
  if (g.blocked) { showToast(`Action temporairement bloquée (${g.waitSec}s)`, 'error'); return; }
  if (!(await confirm(`Distribuer +${fmtVirtual(amount)} ${onlyPlayers ? 'aux joueurs uniquement' : 'à tous les comptes'} ?`, 'Cette action impacte les soldes de plusieurs comptes.'))) return;

  if (currentUser && currentUser.cloud) {
    const users = await adminFetchCloudUsers();
    const targets = users.filter((u) => !onlyPlayers || (u.role !== 'admin'));
    if (!targets.length) { showToast('Aucun compte cible', 'error'); return; }
    const c = getAuthClient();
    let ok = 0;
    for (const u of targets) {
      const next = Math.max(0, Number(u.balance || 0) + amount);
      const { error } = await cloudCall('admin', () => c.rpc('admin_set_balance', {
        p_user_id: u.id,
        p_amount: Number(next.toFixed(2)),
        p_reason: `admin points drop +${amount.toFixed(2)}`
      }), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
      if (!error) ok += 1;
    }
    invalidateCache('admin');
    invalidateCache('profile');
    await syncCloudBalanceNow().catch(() => {});
    await renderAdminPanel();
    pushLocalAdminAudit('admin_drop_points_all', `amount=${amount.toFixed(2)} targets=${targets.length} ok=${ok} onlyPlayers=${onlyPlayers ? 1 : 0}`);
    showToast(`Drop envoyé: ${ok}/${targets.length} compte(s)`, ok === targets.length ? 'success' : 'info', 2600);
    return;
  }

  const users = getUsers();
  let count = 0;
  Object.entries(users).forEach(([uname, rec]) => {
    if (!rec) return;
    if (onlyPlayers && rec.isAdmin) return;
    rec.balance = Math.max(0, Number(rec.balance || 0) + amount);
    count += 1;
  });
  saveUsers(users);
  if (currentUser && users[currentUser.username]) {
    currentUser.balance = Number(users[currentUser.username].balance || 0);
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_drop_points_all_local', `amount=${amount.toFixed(2)} targets=${count} onlyPlayers=${onlyPlayers ? 1 : 0}`);
  showToast(`Drop local envoyé sur ${count} compte(s)`, 'success', 2200);
}
async function adminToggleUserRoleAsync(username) {
  if (!isCurrentUserAdmin()) return;
  const g = actionGuardAcquire('admin:set_role', { limit: 8, windowMs: 60000, blockMs: 90000 });
  if (g.blocked) { showToast(`Action temporairement bloquée (${g.waitSec}s)`, 'error'); return; }
  if (currentUser && currentUser.cloud) {
    const data = await adminFetchCloudUsers();
    const want = String(username || '').trim().toLowerCase();
    const rec = data.find((u) => {
      const un = String(u.username || '').trim().toLowerCase();
      const em = String(u.email || '').trim().toLowerCase();
      const local = em.includes('@') ? em.split('@')[0] : '';
      return un === want || local === want;
    });
    if (!rec) {
      showToast('Utilisateur introuvable (rafraîchis la liste).', 'error');
      return;
    }
    const roleNorm = String(rec.role || 'player').trim().toLowerCase();
    const nextRole = roleNorm === 'admin' ? 'player' : 'admin';
    const c = getAuthClient();
    const { error } = await cloudCall('admin', () => c.rpc('admin_set_role', {
      p_user_id: rec.id,
      p_role: nextRole,
      p_reason: 'admin panel toggle role'
    }), { retries: 1, timeoutMs: 12000, delayMs: 500 });
    if (error) throw error;
    invalidateCache('admin');
    invalidateCache('profile', String(rec.id));
    const fresh = await loadCloudProfile(rec.id, { force: true });
    mergeCloudProfileIntoCurrentUserIfSame(fresh);
    const onAdminPage = __activePage === 'admin';
    if (onAdminPage && !isCurrentUserAdmin()) {
      switchPage('home');
      showToast('Accès admin retiré pour ta session.', 'info', 2400);
    }
    await renderAdminPanel();
    pushLocalAdminAudit('admin_set_role', `${username} -> ${nextRole}`);
    const label = nextRole === 'admin' ? 'admin' : 'joueur';
    showToast(`${rec.username || username} est maintenant ${label}`, 'info');
    return;
  }
  const users = getUsers();
  const rec = users[username];
  if (!rec) return;
  rec.isAdmin = !rec.isAdmin;
  saveUsers(users);
  if (currentUser && currentUser.username === username) {
    updateAdminTabVisibility();
    renderProfileBadge();
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_set_role_local', `${username} -> ${rec.isAdmin ? 'admin' : 'player'}`);
  showToast(`${username} est maintenant ${rec.isAdmin ? 'admin' : 'joueur'}`, 'info');
}
async function adminDeleteHuntByIdAsync(huntId) {
  if (!isCurrentUserAdmin()) return;
  const g = actionGuardAcquire('admin:delete_hunt', { limit: 10, windowMs: 60000, blockMs: 90000 });
  if (g.blocked) { showToast(`Action temporairement bloquée (${g.waitSec}s)`, 'error'); return; }
  if (currentUser && currentUser.cloud) {
    const c = getAuthClient();
    const { error } = await cloudCall('admin', () => c.rpc('admin_delete_hunt', { p_hunt_id: huntId }), { retries: 1, timeoutMs: 12000, delayMs: 500 });
    if (error) throw error;
    invalidateCache('admin');
    await load();
    renderHuntList();
    if (state.activeHuntId) selectHunt(state.activeHuntId);
    await renderAdminPanel();
    pushLocalAdminAudit('admin_delete_hunt', `${huntId}`);
    showToast('Hunt cloud supprimée', 'error');
    return;
  }
  const idx = state.hunts.findIndex(h => h.id === huntId);
  if (idx < 0) return;
  const name = state.hunts[idx].name;
  state.hunts.splice(idx, 1);
  if (state.activeHuntId === huntId) state.activeHuntId = state.hunts[0]?.id || null;
  save();
  renderHuntList();
  if (state.activeHuntId) selectHunt(state.activeHuntId);
  else {
    document.getElementById('no-hunt-selected').style.display = 'flex';
    document.getElementById('hunt-workspace').classList.add('hidden');
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_delete_hunt_local', `${name} (${huntId})`);
  showToast(`Hunt ${name} supprimé`, 'error');
}
async function adminFetchCloudUsers() {
  const cacheKey = 'users:list';
  const cached = getCacheEntry('admin', cacheKey, CACHE_TTL.adminUsers);
  if (cached) return Array.isArray(cached) ? cached.map((u) => ({ ...u })) : [];
  const c = getAuthClient();
  const { data, error } = await cloudCall('admin', () => c.rpc('admin_list_users'), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  const next = (data || []).map(u => ({
    id: u.id,
    username: u.username || (u.email ? String(u.email).split('@')[0] : 'player'),
    role: u.role || 'player',
    status: u.status || 'active',
    balance: Number(u.balance_amount || 0),
    email: u.email || ''
  }));
  setCacheEntry('admin', cacheKey, next);
  return next.map((u) => ({ ...u }));
}
async function adminFetchCloudHunts() {
  const cacheKey = 'hunts:list';
  const cached = getCacheEntry('admin', cacheKey, CACHE_TTL.adminHunts);
  if (cached) return Array.isArray(cached) ? cached.map((h) => ({ ...h })) : [];
  const c = getAuthClient();
  const { data, error } = await cloudCall('admin', () => c
    .from('hunts')
    .select('id,name,currency,starting_balance,hunt_bonuses(id)')
    .order('created_at', { ascending: false })
    .limit(300), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  const next = (data || []).map(h => ({
    id: h.id,
    name: h.name,
    currency: h.currency,
    startBalance: Number(h.starting_balance || 0),
    bonusCount: Array.isArray(h.hunt_bonuses) ? h.hunt_bonuses.length : 0
  }));
  setCacheEntry('admin', cacheKey, next);
  return next.map((h) => ({ ...h }));
}
async function adminFetchCloudLogs() {
  const cacheKey = 'logs:list';
  const cached = getCacheEntry('admin', cacheKey, CACHE_TTL.adminLogs);
  if (cached) return Array.isArray(cached) ? cached.map((l) => ({ ...l })) : [];
  const c = getAuthClient();
  const { data, error } = await cloudCall('admin', () => c
    .from('admin_audit_logs')
    .select('id,admin_id,action,target_table,target_id,payload,created_at')
    .order('created_at', { ascending: false })
    .limit(80), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  const next = data || [];
  setCacheEntry('admin', cacheKey, next);
  return next.map((l) => ({ ...l }));
}
async function adminFetchCloudFeedback() {
  const cacheKey = 'feedback:list';
  const cached = getCacheEntry('admin', cacheKey, CACHE_TTL.adminFeedback);
  if (cached) return Array.isArray(cached) ? cached.map((f) => ({ ...f })) : [];
  const c = getAuthClient();
  const { data, error } = await cloudCall('admin', () => c
    .from('site_feedback')
    .select('id,created_at,category,message,contact,user_id,client_meta,status')
    .order('created_at', { ascending: false })
    .limit(200), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  const next = data || [];
  setCacheEntry('admin', cacheKey, next);
  return next.map((f) => ({ ...f }));
}
async function adminFeedbackSetStatus(feedbackId, newStatus) {
  if (!isCurrentUserAdmin() || !currentUser?.cloud) return;
  const allowed = new Set(['nouveau', 'a_faire', 'valide', 'fait']);
  if (!feedbackId || !allowed.has(String(newStatus || ''))) return;
  const g = actionGuardAcquire('admin:feedback_mutate', { limit: 80, windowMs: 60000, blockMs: 45000 });
  if (g.blocked) {
    showToast(`Trop d’actions. Réessaie dans ${g.waitSec}s.`, 'error');
    return;
  }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  try {
    const { error } = await cloudCall('admin', () => c.from('site_feedback').update({ status: newStatus }).eq('id', feedbackId), {
      retries: 1,
      timeoutMs: 12000,
      delayMs: 400,
      quiet: true
    });
    if (error) throw error;
    invalidateCache('admin', 'feedback');
    await renderAdminPanel();
    showToast('Statut mis à jour', 'success');
  } catch (e) {
    showToast(mapAuthError(e), 'error');
  }
}
async function adminFeedbackDelete(feedbackId) {
  if (!isCurrentUserAdmin() || !currentUser?.cloud) return;
  if (!feedbackId) return;
  const ok = await confirm('Supprimer ce retour ?', 'Cette action est définitive.');
  if (!ok) return;
  const g = actionGuardAcquire('admin:feedback_mutate', { limit: 80, windowMs: 60000, blockMs: 45000 });
  if (g.blocked) {
    showToast(`Trop d’actions. Réessaie dans ${g.waitSec}s.`, 'error');
    return;
  }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  try {
    const { error } = await cloudCall('admin', () => c.from('site_feedback').delete().eq('id', feedbackId), {
      retries: 1,
      timeoutMs: 12000,
      delayMs: 400,
      quiet: true
    });
    if (error) throw error;
    invalidateCache('admin', 'feedback');
    await renderAdminPanel();
    showToast('Retour supprimé', 'success');
  } catch (e) {
    showToast(mapAuthError(e), 'error');
  }
}
async function renderAdminPanel() {
  const denied = document.getElementById('admin-access-denied');
  const panel = document.getElementById('admin-panel');
  if (!denied || !panel) return;
  if (!isCurrentUserAdmin()) {
    denied.style.display = 'block';
    panel.style.display = 'none';
    return;
  }
  denied.style.display = 'none';
  panel.style.display = 'block';
  const maint = getMaintenanceConfig();
  const ops = getOpsAlertsConfig();
  const maintEnabledEl = document.getElementById('admin-maint-enabled');
  const maintMsgEl = document.getElementById('admin-maint-msg');
  const opsEnabledEl = document.getElementById('admin-ops-enabled');
  const opsUrlEl = document.getElementById('admin-ops-webhook');
  if (maintEnabledEl) maintEnabledEl.checked = !!maint.enabled;
  if (maintMsgEl) maintMsgEl.value = maint.message || '';
  if (opsEnabledEl) opsEnabledEl.checked = !!ops.enabled;
  if (opsUrlEl) opsUrlEl.value = ops.webhookUrl || '';
  renderMaintenanceBanner();

  const isCloud = !!(currentUser && currentUser.cloud);
  let usersMap = getUsers();
  let cloudUsers = [];
  let cloudHunts = [];
  let cloudLogs = [];
  let cloudFeedbacks = [];
  let feedbackLoadErr = null;
  if (isCloud) {
    try {
      cloudUsers = await adminFetchCloudUsers();
      cloudHunts = await adminFetchCloudHunts();
      cloudLogs = await adminFetchCloudLogs();
      try {
        cloudFeedbacks = await adminFetchCloudFeedback();
      } catch (fe) {
        feedbackLoadErr = fe;
      }
    } catch (e) {
      showToast(mapAuthError(e), 'error');
    }
  }
  const userEntries = isCloud ? cloudUsers : Object.values(usersMap);
  const adminCount = userEntries.filter(u => u && (u.isAdmin || u.role === 'admin')).length;
  const totalBalance = userEntries.reduce((a, u) => a + Number(u?.balance || 0), 0);
  const cloudStatus = getCloudUiStatus();
  let dashStats = null;
  if (isCloud && isCurrentUserAdmin()) {
    dashStats = await adminFetchDashboardStats();
  }
  const dashEl = document.getElementById('admin-dashboard-grid');
  if (dashEl) {
    if (dashStats) {
      const month = escapeHtml(String(dashStats.period_month || '—'));
      dashEl.innerHTML = `
        <div class="stat-card"><div class="stat-label">TOURNOI EN ATTENTE</div><div class="stat-value" style="color:${Number(dashStats.tournoi_pending) > 0 ? 'var(--gold)' : 'inherit'}">${Number(dashStats.tournoi_pending || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">VALIDÉS (${month})</div><div class="stat-value">${Number(dashStats.tournoi_verified_month || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">SOUMIS (${month})</div><div class="stat-value">${Number(dashStats.tournoi_submitted_month || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">HUNTS CLOUD</div><div class="stat-value">${Number(dashStats.hunts_cloud_total || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">HUNTS CRÉÉS 7J</div><div class="stat-value">${Number(dashStats.hunts_created_7d || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">JOUEURS ACTIFS 7J</div><div class="stat-value">${Number(dashStats.active_players_7d || 0)}</div></div>
      `;
    } else if (isCloud) {
      dashEl.innerHTML = `<div class="bj-rec" style="grid-column:1/-1;">Dashboard cloud indisponible — applique <code>20260704_admin_dashboard.sql</code> dans Supabase.</div>`;
    } else {
      dashEl.innerHTML = `<div class="bj-rec" style="grid-column:1/-1;">Connecte-toi en compte cloud admin pour les stats communauté.</div>`;
    }
  }
  const statsEl = document.getElementById('admin-stats-grid');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">JOUEURS</div><div class="stat-value">${userEntries.length}</div></div>
      <div class="stat-card"><div class="stat-label">ADMINS</div><div class="stat-value">${adminCount}</div></div>
      <div class="stat-card"><div class="stat-label">HUNTS</div><div class="stat-value">${isCloud ? cloudHunts.length : state.hunts.length}</div></div>
      <div class="stat-card"><div class="stat-label">SOLDE CUMULÉ</div><div class="stat-value">${fmtVirtual(totalBalance)}</div></div>
      <div class="stat-card"><div class="stat-label">ETAT CLOUD</div><div class="stat-value" style="color:${cloudStatus.color};">${cloudStatus.label}</div><div class="bj-rec">${escapeHtml(cloudStatus.detail)}</div></div>
    `;
  }

  const usersTable = document.getElementById('admin-users-table');
  if (usersTable) {
    const allRows = (isCloud ? cloudUsers.map((u) => [u.username, u]) : Object.entries(usersMap));
    const currentUsernameLower = String(currentUser?.username || '').toLowerCase();
    const currentUserId = String(currentUser?.id || '');
    const adminLiveBalanceFor = (username, u) => {
      if (!isCloud || !currentUser || !currentUser.cloud) return Number(u?.balance || 0);
      const sameUserByName = String(username || '').toLowerCase() === currentUsernameLower;
      const sameUserById = String(u?.id || '') && String(u?.id || '') === currentUserId;
      return (sameUserByName || sameUserById) ? Number(currentUser.balance || 0) : Number(u?.balance || 0);
    };
    const q = String(adminViewState.q || '').trim().toLowerCase();
    const role = adminViewState.role || 'all';
    let rows = allRows.filter(([username, u]) => {
      const roleTxt = (u.isAdmin || u.role === 'admin') ? 'admin' : 'player';
      const matchRole = role === 'all' ? true : roleTxt === role;
      const matchQ = !q || String(username || '').toLowerCase().includes(q) || String(u.email || '').toLowerCase().includes(q);
      return matchRole && matchQ;
    }).map(([username, u]) => [username, { ...u, balance: adminLiveBalanceFor(username, u) }]);
    rows.sort((a, b) => {
      const [ua, ra] = a;
      const [ub, rb] = b;
      if (adminViewState.sort === 'balance_desc') return Number(rb.balance || 0) - Number(ra.balance || 0);
      if (adminViewState.sort === 'balance_asc') return Number(ra.balance || 0) - Number(rb.balance || 0);
      return String(ua || '').localeCompare(String(ub || ''), 'fr');
    });
    const totalPages = Math.max(1, Math.ceil(rows.length / adminViewState.pageSize));
    adminViewState.page = Math.max(1, Math.min(adminViewState.page, totalPages));
    const start = (adminViewState.page - 1) * adminViewState.pageSize;
    const pageRows = rows.slice(start, start + adminViewState.pageSize);
    usersTable.innerHTML = `
      <div class="admin-toolbar">
        <input class="profile-menu-input" id="admin-user-search" placeholder="Rechercher pseudo/email..." value="${escapeHtml(adminViewState.q)}">
        <select class="profile-menu-input" id="admin-role-filter" style="width:140px;">
          <option value="all" ${adminViewState.role==='all'?'selected':''}>Tous</option>
          <option value="admin" ${adminViewState.role==='admin'?'selected':''}>Admins</option>
          <option value="player" ${adminViewState.role==='player'?'selected':''}>Joueurs</option>
        </select>
        <select class="profile-menu-input" id="admin-sort" style="width:180px;">
          <option value="name_asc" ${adminViewState.sort==='name_asc'?'selected':''}>Tri pseudo</option>
          <option value="balance_desc" ${adminViewState.sort==='balance_desc'?'selected':''}>Solde décroissant</option>
          <option value="balance_asc" ${adminViewState.sort==='balance_asc'?'selected':''}>Solde croissant</option>
        </select>
        <button class="profile-mini-btn" id="admin-prev-page">Page -</button>
        <button class="profile-mini-btn" id="admin-next-page">Page +</button>
        <div class="bj-rec">Page ${adminViewState.page}/${totalPages}</div>
      </div>
      <div class="admin-toolbar" style="margin-top:8px;">
        <input class="profile-menu-input" id="admin-drop-amount" type="number" min="0.01" step="0.01" value="10" style="width:140px;" placeholder="Montant drop">
        <button class="profile-mini-btn primary" onclick="adminApplyPointsDropAll(false)">Drop à tous</button>
        <button class="profile-mini-btn" onclick="adminApplyPointsDropAll(true)">Drop joueurs</button>
      </div>
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;">Pseudo</th>
              <th style="text-align:left;padding:8px;">Role</th>
              <th style="text-align:left;padding:8px;">Solde</th>
              <th style="text-align:left;padding:8px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.map(([username, u]) => `
              <tr>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(username)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${(u.isAdmin || u.role === 'admin') ? 'ADMIN' : 'JOUEUR'}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${fmtVirtual(Number(u.balance || 0))}</td>
                <td style="padding:8px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;">
                  <input
                    class="profile-menu-input"
                    id="admin-user-delta-${encodeURIComponent(username)}"
                    type="number"
                    step="0.01"
                    placeholder="+10 / -10"
                    style="width:120px;height:36px;"
                    onkeydown="if(event.key==='Enter'){adminAdjustBalanceFromInput(decodeURIComponent('${encodeURIComponent(username)}'));}"
                  >
                  <button class="profile-mini-btn" onclick="adminAdjustBalanceFromInput(decodeURIComponent('${encodeURIComponent(username)}'))">Appliquer</button>
                  <button class="profile-mini-btn" onclick="adminSetBalancePrompt(decodeURIComponent('${encodeURIComponent(username)}'))">Solde</button>
                  <button class="profile-mini-btn ${(u.isAdmin || u.role === 'admin') ? 'danger' : 'primary'}" onclick="adminToggleUserRole(decodeURIComponent('${encodeURIComponent(username)}'))">${(u.isAdmin || u.role === 'admin') ? 'Retirer admin' : 'Passer admin'}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    const searchEl = document.getElementById('admin-user-search');
    const roleEl = document.getElementById('admin-role-filter');
    const sortEl = document.getElementById('admin-sort');
    const prevEl = document.getElementById('admin-prev-page');
    const nextEl = document.getElementById('admin-next-page');
    if (searchEl) searchEl.oninput = () => { adminViewState.q = searchEl.value || ''; adminViewState.page = 1; renderAdminPanel(); };
    if (roleEl) roleEl.onchange = () => { adminViewState.role = roleEl.value || 'all'; adminViewState.page = 1; renderAdminPanel(); };
    if (sortEl) sortEl.onchange = () => { adminViewState.sort = sortEl.value || 'name_asc'; adminViewState.page = 1; renderAdminPanel(); };
    if (prevEl) prevEl.onclick = () => { adminViewState.page = Math.max(1, adminViewState.page - 1); renderAdminPanel(); };
    if (nextEl) nextEl.onclick = () => { adminViewState.page = Math.min(totalPages, adminViewState.page + 1); renderAdminPanel(); };
  }

  const huntsTable = document.getElementById('admin-hunts-table');
  if (huntsTable) {
    huntsTable.innerHTML = `
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;">Hunt</th>
              <th style="text-align:left;padding:8px;">Bonuses</th>
              <th style="text-align:left;padding:8px;">Solde départ</th>
              <th style="text-align:left;padding:8px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${(isCloud ? cloudHunts : state.hunts.map(h => ({ ...h, bonusCount: (h.bonuses || []).length }))).map(h => `
              <tr>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(h.name || 'Hunt')}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${Number(h.bonusCount || 0)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${fmt(Number(h.startBalance || 0), h.currency || 'EUR')}</td>
                <td style="padding:8px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;">
                  ${isCloud ? '' : `<button class="profile-mini-btn" onclick="selectHunt('${h.id}');switchPage('hunt')">Ouvrir</button>`}
                  <button class="profile-mini-btn danger" onclick="adminDeleteHuntById('${h.id}')">Supprimer</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }
  const feedbackTable = document.getElementById('admin-feedback-table');
  if (feedbackTable) {
    if (!isCloud) {
      feedbackTable.innerHTML = `<div class="bj-rec">Les avis testeurs (page REVIEW) sont stockés sur Supabase. Exécute <code>site_feedback.sql</code> puis utilise un compte cloud : ils apparaîtront ici.</div>`;
    } else if (feedbackLoadErr) {
      const hint = String(feedbackLoadErr?.message || feedbackLoadErr || '').toLowerCase().includes('relation')
        ? ' Vérifie que la table <code>site_feedback</code> existe (script <code>site_feedback.sql</code>).'
        : '';
      feedbackTable.innerHTML = `<div class="bj-rec" style="color:#ff9fb1;">${escapeHtml(mapAuthError(feedbackLoadErr))}${hint}</div>`;
    } else {
      const catLabel = (c) => ({ bug: 'Bug', idee: 'Idée', autre: 'Autre' }[String(c || '').toLowerCase()] || c || '—');
      const statusLabels = { nouveau: 'Nouveau', a_faire: 'À faire', valide: 'Validé', fait: 'Fait' };
      const statusOrder = ['nouveau', 'a_faire', 'valide', 'fait'];
      feedbackTable.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button class="profile-mini-btn" onclick="invalidateCache('admin','feedback');renderAdminPanel().catch(()=>{})">Rafraîchir les retours</button>
        </div>
        <div class="table-wrap">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px;">Date</th>
                <th style="text-align:left;padding:8px;">Type</th>
                <th style="text-align:left;padding:8px;">Message</th>
                <th style="text-align:left;padding:8px;">Contact</th>
                <th style="text-align:left;padding:8px;">User</th>
                <th style="text-align:left;padding:8px;">Statut</th>
                <th style="text-align:left;padding:8px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${cloudFeedbacks.length ? cloudFeedbacks.map((f) => {
                const msg = String(f.message || '');
                const msgShort = msg.length > 160 ? `${escapeHtml(msg.slice(0, 160))}…` : escapeHtml(msg);
                const uid = f.user_id ? String(f.user_id).slice(0, 8) : '—';
                const at = f.created_at ? new Date(f.created_at).toLocaleString('fr-FR') : '—';
                const st = String(f.status || 'nouveau').toLowerCase();
                const stNorm = statusOrder.includes(st) ? st : 'nouveau';
                const opts = statusOrder.map((v) =>
                  `<option value="${v}" ${stNorm === v ? 'selected' : ''}>${statusLabels[v]}</option>`
                ).join('');
                const rawId = String(f.id || '');
                return `
                  <tr>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">${escapeHtml(at)}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">${escapeHtml(catLabel(f.category))}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;" title="${escapeHtml(msg)}">${msgShort}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">${escapeHtml(String(f.contact || '—'))}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;font-family:'Share Tech Mono',monospace;font-size:10px;">${escapeHtml(uid)}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">
                      <select class="profile-menu-input" style="min-width:132px;height:38px;font-size:13px;" data-fid="${escapeHtml(rawId)}" onchange="adminFeedbackSetStatus(this.getAttribute('data-fid'), this.value)">${opts}</select>
                    </td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">
                      <button class="profile-mini-btn danger" type="button" onclick="adminFeedbackDelete('${escapeHtml(rawId)}')">Supprimer</button>
                    </td>
                  </tr>
                `;
              }).join('') : `<tr><td colspan="7" style="padding:10px;border-top:1px solid var(--border);color:var(--text-dim);">Aucun retour pour l’instant.</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    }
  }
  const logsTable = document.getElementById('admin-logs-table');
  if (logsTable) {
    const rows = isCloud
      ? cloudLogs.map((l) => ({
          at: l.created_at ? new Date(l.created_at).toLocaleString('fr-FR') : '-',
          admin: String(l.admin_id || '').slice(0, 8) || 'admin',
          action: l.action || '-',
          details: `${l.target_table || ''} ${l.target_id || ''}`.trim() || JSON.stringify(l.payload || {}).slice(0, 80)
        }))
      : getLocalAdminAuditLogs().slice(0, 80).map((l) => ({
          at: l.ts ? new Date(l.ts).toLocaleString('fr-FR') : '-',
          admin: l.admin || 'admin',
          action: l.action || '-',
          details: l.details || '-'
        }));
    logsTable.innerHTML = `
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;">Quand</th>
              <th style="text-align:left;padding:8px;">Admin</th>
              <th style="text-align:left;padding:8px;">Action</th>
              <th style="text-align:left;padding:8px;">Détails</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((r) => `
              <tr>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.at)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.admin)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.action)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.details)}</td>
              </tr>
            `).join('') : `<tr><td colspan="4" style="padding:10px;border-top:1px solid var(--border);color:var(--text-dim);">Aucun log admin.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }
  loadAdminRecentSlots().catch(() => {});
  renderAdminTournoiTable().catch(() => {});
  if (typeof syncAdminSlotPreview === 'function') syncAdminSlotPreview();
}

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

// Update send-slot button text in renderOpener (hook)
const _origRenderOpener = renderOpener;
renderOpener = function() {
  _origRenderOpener();
  const hunt = activeHunt();
  if (!hunt || !hunt.bonuses.length) return;
  const bonus = hunt.bonuses[state.openerIndex];
  const txt = document.getElementById('opener-send-slot-txt');
  if (txt) {
    txt.textContent = `GO TO SLOT · ${getCasinoLabel(hunt.casino).toUpperCase()}`;
  }
};

// ─── GAMDOM URL dans confirmAddBonus (hook) ───
const _origConfirmAdd = confirmAddBonus;
confirmAddBonus = function() {
  // Save gamdomUrl from field before calling original
  const urlField = document.getElementById('modal-gamdom-url');
  window.__pendingGamdomUrl = urlField ? urlField.value.trim() : '';
  _origConfirmAdd();
  if (urlField) urlField.value = '';
};

// Patch confirmAddBonus to inject gamdomUrl
const _origConfirmAddBonus = confirmAddBonus;
// Already patched above — we need to intercept bonus push directly
// Override the bonus object construction by monkey-patching state.hunts.push
const _origPush_gamdom = Array.prototype.push;
// Better: intercept after the fact
document.addEventListener('bonusAdded', (e) => {
  const hunt = activeHunt();
  if (!hunt || !hunt.bonuses.length) return;
  const lastBonus = hunt.bonuses[hunt.bonuses.length - 1];
  if (lastBonus && window.__pendingGamdomUrl) {
    lastBonus.gamdomUrl = window.__pendingGamdomUrl;
    window.__pendingGamdomUrl = '';
    save();
  }
});

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

// ─── SYSTÈME DE COMPTES ───
const AUTH_KEY = 'hm_users_v1';
const SESSION_KEY = 'hm_session_v1';
const SESSION_META_KEY = 'hm_session_meta_v1';
const GUEST_PROFILE_KEY = 'hm_guest_profile_v1';
const BALANCE_SNAPSHOT_KEY = 'hm_balance_snapshot_v1';
const BALANCE_SNAPSHOT_BY_USER_KEY = 'hm_balance_snapshot_by_user_v1';
const PENDING_CLOUD_BALANCE_DELTA_KEY = 'hm_pending_cloud_balance_delta_v1';
if (!window.__hmStakePreview) window.__hmStakePreview = Object.create(null);
window.__hmGameBalAnchor = window.__hmGameBalAnchor ?? null;
const ADMIN_BOOTSTRAP_KEY = 'hm_admin_bootstrap_v1';
const UI_PREFS_KEY = 'hm_ui_prefs_v1';
const FEEDBACK_QUEUE_KEY = 'hm_feedback_queue_v1';
// Aligné sur public.claim_daily_drop() (v_base = 25, +5 % / jour de streak, plafond +200 %).
const DAILY_DROP_BASE = 25;
const DAILY_STREAK_BONUS_PCT_PER_DAY = 5;
let claimDailyDropInFlight = false;
let currentUser = null;
let profileMenuIsOpen = false;
let profileMenuJustOpenedAt = 0;
const GUEST_USER = { username: 'Invité', email: '', balance: 100, isGuest: true };
let pendingAuthOpen = false;
const ONLINE_SUPABASE_URL = 'https://kkqskgxjyurtplbububc.supabase.co';
const ONLINE_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrcXNrZ3hqeXVydHBsYnVidWJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTA0MjcsImV4cCI6MjA5Mjg4NjQyN30.7f8Rub_5lO-yfZSbIUvtaUVZew_1XABwIvvU2yXmG5c';
const FORCED_ADMIN_IDS = new Set([
  '02b7e350-b802-4ddf-937f-a5172080c8fa',
  'c86cbb06-7765-4216-ad83-7e8e8eb0c3a9'
]);
let onlineCount = 1;
let onlineClient = null;
let onlineChannel = null;
let onlineBoundUnload = false;
let authClient = null;
let authReady = false;
const cloudDataCache = {
  profile: new Map(),
  admin: new Map()
};
const CACHE_TTL = {
  profile: 20000,
  adminUsers: 12000,
  adminHunts: 10000,
  adminLogs: 8000,
  adminFeedback: 6000
};
function getCacheEntry(bucket, key, ttlMs) {
  const m = cloudDataCache[bucket];
  if (!m) return null;
  const e = m.get(key);
  if (!e) return null;
  if (Date.now() - Number(e.ts || 0) > ttlMs) {
    m.delete(key);
    return null;
  }
  return e.value;
}
function setCacheEntry(bucket, key, value) {
  const m = cloudDataCache[bucket];
  if (!m) return;
  m.set(key, { ts: Date.now(), value });
}
function invalidateCache(bucket, keyPrefix = '') {
  const m = cloudDataCache[bucket];
  if (!m) return;
  if (!keyPrefix) { m.clear(); return; }
  for (const k of m.keys()) {
    if (String(k).startsWith(String(keyPrefix))) m.delete(k);
  }
}
const adminViewState = {
  q: '',
  role: 'all',
  sort: 'name_asc',
  page: 1,
  pageSize: 8
};

// Legacy stub : les utilisateurs sont gérés exclusivement par Supabase.
// Ces fonctions ne persistent plus rien (cache mémoire éphémère pour ne pas casser le code legacy).
const __legacyUsersMemory = {};
function getUsers() { return __legacyUsersMemory; }
function saveUsers(_users) { /* no-op : tout va en Supabase */ }
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  const bal = Number(user?.balance);
  if (Number.isFinite(bal) && bal >= 0) {
    localStorage.setItem(BALANCE_SNAPSHOT_KEY, String(bal));
    saveBalanceSnapshotScoped(bal, {
      userId: user?.cloud ? String(user?.id || '') : '',
      isGuest: !!user?.isGuest || !user?.cloud
    });
  }
}
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function getSessionMeta() {
  try { return JSON.parse(localStorage.getItem(SESSION_META_KEY) || '{}'); } catch { return {}; }
}
function saveSessionMeta(meta) {
  const cur = getSessionMeta();
  try { localStorage.setItem(SESSION_META_KEY, JSON.stringify({ ...cur, ...(meta || {}) })); } catch (_) {}
}
function getGuestProfile() {
  try { return JSON.parse(localStorage.getItem(GUEST_PROFILE_KEY) || '{}'); } catch { return {}; }
}
function saveGuestProfile(p) { localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(p || {})); }
function getBalanceSnapshotLegacy() {
  const n = Number(localStorage.getItem(BALANCE_SNAPSHOT_KEY));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function getPendingCloudBalanceDeltaBucket() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_CLOUD_BALANCE_DELTA_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}
function getPendingCloudBalanceDelta(userId) {
  const n = Number(getPendingCloudBalanceDeltaBucket()[String(userId || '')] || 0);
  return Number.isFinite(n) ? n : 0;
}
function notePendingCloudBalanceDelta(userId, delta) {
  const uid = String(userId || '');
  if (!uid) return;
  const d = Number(delta || 0);
  if (!Number.isFinite(d) || Math.abs(d) < 0.0001) return;
  const bucket = getPendingCloudBalanceDeltaBucket();
  const next = Number(((Number(bucket[uid] || 0)) + d).toFixed(4));
  if (Math.abs(next) < 0.0001) delete bucket[uid];
  else bucket[uid] = next;
  try { localStorage.setItem(PENDING_CLOUD_BALANCE_DELTA_KEY, JSON.stringify(bucket)); } catch (_) {}
}
function clearPendingCloudBalanceDelta(userId) {
  const uid = String(userId || '');
  if (!uid) return;
  const bucket = getPendingCloudBalanceDeltaBucket();
  if (!Object.prototype.hasOwnProperty.call(bucket, uid)) return;
  delete bucket[uid];
  try { localStorage.setItem(PENDING_CLOUD_BALANCE_DELTA_KEY, JSON.stringify(bucket)); } catch (_) {}
}
function getBalanceSnapshotBucket() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BALANCE_SNAPSHOT_BY_USER_KEY) || '{}');
    const cloud = parsed && typeof parsed.cloud === 'object' && parsed.cloud ? parsed.cloud : {};
    const guest = Number(parsed?.guest);
    return {
      cloud,
      guest: Number.isFinite(guest) && guest >= 0 ? guest : null
    };
  } catch (_) {
    return { cloud: {}, guest: null };
  }
}
function saveBalanceSnapshotBucket(bucket) {
  try { localStorage.setItem(BALANCE_SNAPSHOT_BY_USER_KEY, JSON.stringify(bucket || { cloud: {}, guest: null })); } catch (_) {}
}
function saveBalanceSnapshotScoped(balance, { userId = '', isGuest = false } = {}) {
  const n = Number(balance);
  if (!Number.isFinite(n) || n < 0) return;
  const bucket = getBalanceSnapshotBucket();
  if (userId) bucket.cloud[String(userId)] = n;
  if (isGuest) bucket.guest = n;
  saveBalanceSnapshotBucket(bucket);
}
function getBalanceSnapshot({ userId = '', isGuest = false } = {}) {
  const bucket = getBalanceSnapshotBucket();
  if (userId) {
    const n = Number(bucket.cloud[String(userId)]);
    if (Number.isFinite(n) && n >= 0) return n;
    // IMPORTANT : pas de repli sur le snapshot global pour un compte cloud
    // identifié. Le snapshot legacy est écrit pour le dernier compte actif et
    // contaminerait un autre compte (solde dupliqué / faux reset).
    return null;
  }
  if (isGuest) {
    const n = Number(bucket.guest);
    if (Number.isFinite(n) && n >= 0) return n;
    // Idem pour l'invité : ne pas hériter du solde d'un compte cloud précédent.
    return null;
  }
  return getBalanceSnapshotLegacy();
}
function shouldRejectSuspectServerBalance(serverBal, currentBal, userId = '') {
  const s = Number(serverBal);
  const c = Number(currentBal);
  if (!Number.isFinite(s)) return true;
  if (Math.abs(s - 100) > 0.0001) return false;
  const snap = getBalanceSnapshot({ userId: String(userId || '') });
  const currentFarFrom100 = Number.isFinite(c) && Math.abs(c - 100) > 0.0001;
  const snapFarFrom100 = snap !== null && Math.abs(Number(snap) - 100) > 0.0001;
  return currentFarFrom100 || snapFarFrom100;
}
function shouldRejectRollbackToGameAnchor(serverBal, currentBal) {
  if (!isCloudUser()) return false;
  const anchor = window.__hmGameBalAnchor;
  if (anchor === null || anchor === undefined) return false;
  const s = Number(serverBal);
  const c = Number(currentBal);
  const a = Number(anchor);
  if (!Number.isFinite(s) || !Number.isFinite(c) || !Number.isFinite(a)) return false;
  const isServerAtAnchor = Math.abs(s - a) < 0.0001;
  const currentIsNotAnchor = Math.abs(c - a) > 0.0001;
  return isServerAtAnchor && currentIsNotAnchor;
}
function getPersistedBalanceForUser(userId, { isGuest = false } = {}) {
  const uid = String(userId || '');
  const disk = getSession();
  if (uid && disk && String(disk.id) === uid) {
    const fromDisk = Number(disk.balance);
    if (Number.isFinite(fromDisk) && fromDisk >= 0) return fromDisk;
  }
  if (isGuest) {
    const gp = getGuestProfile();
    const fromGuest = Number(gp.balance);
    if (Number.isFinite(fromGuest) && fromGuest >= 0) return fromGuest;
  }
  const snap = getBalanceSnapshot({ userId: uid, isGuest });
  if (snap !== null) return snap;
  return null;
}
function resolveCloudBalanceMerge(currentBal, serverBal, userId = '') {
  const persisted = userId ? getPersistedBalanceForUser(userId) : null;
  let local = Math.max(
    Number.isFinite(Number(currentBal)) ? Number(currentBal) : 0,
    persisted !== null && Number.isFinite(Number(persisted)) ? Number(persisted) : 0
  );
  const s = Number(serverBal || 0);
  const pending = userId ? getPendingCloudBalanceDelta(userId) : 0;
  if (!Number.isFinite(s)) return Number.isFinite(local) ? local : 0;
  if (!Number.isFinite(local)) return s;
  if (Math.abs(pending) > 0.005) {
    const reconstructed = Math.max(0, Number((s + pending).toFixed(4)));
    if (Math.abs(local - s) < 0.005 && Math.abs(reconstructed - local) > 0.005) {
      local = reconstructed;
    }
  }
  if (Math.abs(local - s) < 0.005) return s;
  // Serveur en retard : ne pas écraser les gains affichés localement.
  if (s + 0.005 < local) {
    if (
      cloudQueuedGameSessions > 0 ||
      cloudGameSettlementInFlight > 0 ||
      hasPendingStakePreviews() ||
      (window.__hmGameBalAnchor !== null && window.__hmGameBalAnchor !== undefined)
    ) {
      return local;
    }
    pushRuntimeLog('warn', `cloud_balance_keep_local: server=${s.toFixed(2)} local=${local.toFixed(2)}`);
    return local;
  }
  // Serveur en avance : pertes locales / refresh avant synchro SQL — ne pas remonter le solde.
  if (local + 0.005 < s && Math.abs(pending) > 0.005) {
    pushRuntimeLog('warn', `cloud_balance_keep_local_pending: server=${s.toFixed(2)} local=${local.toFixed(2)} pending=${pending.toFixed(2)}`);
    return local;
  }
  return s;
}
function getUiPrefs() {
  try { return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}'); } catch { return {}; }
}
function saveUiPrefs(p) {
  const current = getUiPrefs();
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ ...current, ...p }));
}
function getSafeGuestBalance(rawBalance) {
  const n = Number(rawBalance);
  if (Number.isFinite(n) && n >= 0) return n;
  const snap = getBalanceSnapshot({ isGuest: true });
  if (snap !== null) return snap;
  return Number(GUEST_USER.balance || 100);
}
function applyUiPrefs() {
  const p = getUiPrefs();
  const scale = p.uiScale === 'large' ? 1.08 : p.uiScale === 'compact' ? 0.94 : 1;
  document.documentElement.style.fontSize = `${16 * scale}px`;
}
function getAuthClient() {
  if (!window.supabase || !window.supabase.createClient) return null;
  if (!authClient) authClient = window.supabase.createClient(ONLINE_SUPABASE_URL, ONLINE_SUPABASE_ANON);
  return authClient;
}
function usernameToEmail(u) {
  const v = String(u || '').trim().toLowerCase();
  if (!v) return '';
  if (v.includes('@')) return v;
  return `${v.replace(/[^a-z0-9._-]/g, '')}@player.local`;
}
function mapAuthError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('email rate limit exceeded')) return 'Limite email atteinte. Attends 1 minute puis réessaie.';
  if (msg.includes('for security purposes')) return 'Trop de tentatives. Attends un peu puis réessaie.';
  if (msg.includes('email not confirmed')) return 'La confirmation email est active côté Supabase. Désactive-la dans Providers > Email.';
  if (msg.includes('invalid login credentials')) return 'Identifiant ou mot de passe incorrect.';
  if (msg.includes('user already registered')) return 'Compte déjà existant. Essaie de te connecter.';
  if (msg.includes('password')) return 'Mot de passe trop faible (minimum 6 caractères).';
  if (msg.includes('profile_not_found')) return 'Profil utilisateur introuvable. Rafraîchis le panneau admin puis réessaie.';
  return err?.message || 'Erreur d’authentification.';
}
/** Après RPC (ex. admin_set_role), réinjecte le profil serveur dans la session si c’est le compte courant. */
function mergeCloudProfileIntoCurrentUserIfSame(fresh) {
  if (!fresh || !currentUser?.cloud || String(currentUser.id) !== String(fresh.id)) return false;
  Object.assign(currentUser, fresh);
  saveSession(currentUser);
  updateLobbyBalance();
  updateAdminTabVisibility();
  renderProfileBadge();
  return true;
}
async function loadCloudProfile(userId, { force = false } = {}) {
  const c = getAuthClient();
  if (!c || !userId) return null;
  const cacheKey = String(userId);
  if (!force) {
    const cached = getCacheEntry('profile', cacheKey, CACHE_TTL.profile);
    if (cached) return { ...cached };
  }
  const [{ data: p }, { data: b }, sessionRes] = await Promise.all([
    cloudCall('profile', () => c.from('profiles').select('id,username,display_name,avatar_url,role,status,email,daily_streak,last_claim_day,last_claim_at').eq('id', userId).single(), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true }),
    cloudCall('profile', () => c.from('balances').select('amount').eq('user_id', userId).single(), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true }),
    cloudCall('auth', () => c.auth.getSession(), { retries: 0, timeoutMs: 8000, quiet: true, fallback: async () => ({ data: { session: null } }) })
  ]);
  const su = sessionRes?.data?.session?.user && String(sessionRes.data.session.user.id || '') === String(userId)
    ? sessionRes.data.session.user
    : null;
  const metaUsername = String(su?.user_metadata?.username || su?.user_metadata?.display_name || '').trim();
  const profileUsername = String(p?.username || '').trim();
  const usernameResolved = (profileUsername && profileUsername.toLowerCase() !== 'player')
    ? profileUsername
    : (metaUsername || (p?.email ? String(p.email).split('@')[0] : 'player'));
  const profileDisplay = String(p?.display_name || '').trim();
  const displayResolved = profileDisplay || usernameResolved || 'Player';
  const roleResolved = String(p?.role || 'player').trim().toLowerCase();
  const statusResolved = String(p?.status || 'active').trim().toLowerCase();
  const forcedAdmin = FORCED_ADMIN_IDS.has(String(userId || '').toLowerCase());
  const persistedLocal = getPersistedBalanceForUser(userId);
  const localSeed = String(currentUser?.id || '') === String(userId)
    ? Number(currentUser?.balance || 0)
    : (persistedLocal !== null ? persistedLocal : Number(b?.amount || 0));
  const next = {
    id: userId,
    username: usernameResolved,
    email: p?.email || '',
    displayName: displayResolved,
    avatar: p?.avatar_url || '',
    role: forcedAdmin ? 'admin' : roleResolved,
    status: statusResolved,
    balance: resolveCloudBalanceMerge(
      localSeed,
      Number(b?.amount || 0),
      userId
    ),
    streak: Number(p?.daily_streak || 0),
    lastClaimDay: (p?.last_claim_day === null || p?.last_claim_day === undefined) ? null : Number(p.last_claim_day),
    lastClaimAt: p?.last_claim_at || null,
    isGuest: false,
    cloud: true
  };
  const snapBal = getBalanceSnapshot({ userId: String(userId || '') });
  const persistedBal = getPersistedBalanceForUser(userId);
  if (
    shouldRejectSuspectServerBalance(next.balance, persistedBal ?? currentUser?.balance, userId) ||
    shouldRejectRollbackToGameAnchor(next.balance, persistedBal ?? currentUser?.balance)
  ) {
    if (snapBal !== null && Number.isFinite(Number(snapBal))) {
      pushRuntimeLog('warn', `cloud_profile_balance_suspect_reset_100: server=${Number(next.balance || 0).toFixed(2)} snap=${Number(snapBal).toFixed(2)}`);
      next.balance = Number(snapBal);
    } else if (persistedBal !== null) {
      next.balance = Number(persistedBal);
    }
  }
  setCacheEntry('profile', cacheKey, next);
  return { ...next };
}
function isCurrentUserAdmin() {
  if (!currentUser || currentUser.isGuest) return false;
  if (FORCED_ADMIN_IDS.has(String(currentUser.id || '').toLowerCase())) return true;
  if (currentUser.cloud) {
    const role = String(currentUser.role || '').trim().toLowerCase();
    const status = String(currentUser.status || 'active').trim().toLowerCase();
    return role === 'admin' && status === 'active';
  }
  const users = getUsers();
  const rec = users[currentUser.username];
  return !!(rec && rec.isAdmin);
}
function updateAdminTabVisibility() {
  const visible = isCurrentUserAdmin();
  const tab = document.getElementById('sidebar-tab-admin');
  if (tab) tab.style.display = visible ? 'flex' : 'none';
  const homeBtn = document.getElementById('home-admin-btn');
  if (homeBtn) homeBtn.style.display = visible ? '' : 'none';
}
function ensureAdminBootstrap() {
  // Désactivé : le rôle admin est géré exclusivement côté Supabase
  // (colonne profiles.role + RPC admin_set_role).
}
const getDayIndex = () => Math.floor(Date.now() / 86400000);
const dayDiff = (a, b) => Number(a) - Number(b);
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Filtre un URL pour s'assurer qu'il n'est ni `javascript:` ni `data:text/html` (vecteur XSS).
function isSafeUrl(u) {
  if (!u) return false;
  const s = String(u).trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) return true;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return true;
  return false;
}
function normalizeSlotImageUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/\\/g, '/');
  if (s.startsWith('//')) s = `https:${s}`;
  else if (!/^(https?:\/\/|data:image\/|\/|\.\/|\.\.\/)/i.test(s) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) s = `https://${s}`;
  return s;
}
function resolveBonusImageUrl(bonus) {
  const direct = normalizeSlotImageUrl(bonus?.slotImage || bonus?.slot_image || bonus?.image || '');
  if (direct && isSafeUrl(direct)) return direct;
  if (!Array.isArray(state.slots) || !state.slots.length) return '';
  const cat = findCatalogSlotForBonus(bonus);
  if (cat) {
    const fromCat = normalizeSlotImageUrl(cat.image || cat.img || cat.thumbnail || '');
    if (fromCat && isSafeUrl(fromCat)) return fromCat;
  }
  return '';
}
function getDisplayName() {
  if (!currentUser) return 'Invité';
  return currentUser.displayName || currentUser.username || 'Invité';
}
function getAvatarUrl() {
  if (!currentUser) return '';
  return currentUser.avatar || '';
}
function getOnlinePresenceKey() {
  if (currentUser && !currentUser.isGuest) return `user:${currentUser.username || 'player'}`;
  const existing = sessionStorage.getItem('hm_guest_presence_key');
  if (existing) return existing;
  const next = `guest:${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem('hm_guest_presence_key', next);
  return next;
}
function updateOnlineCountUI() {
  const el = document.getElementById('online-users-count');
  if (el) el.textContent = String(Math.max(1, onlineCount));
  const homeOnline = document.getElementById('home-kpi-online');
  if (homeOnline) homeOnline.textContent = String(Math.max(1, onlineCount));
}
function stopOnlinePresence() {
  if (onlineChannel) {
    try { onlineChannel.untrack(); } catch (_) {}
    try { onlineClient?.removeChannel(onlineChannel); } catch (_) {}
  }
  onlineChannel = null;
}
function startOnlinePresence() {
  try {
    if (!window.supabase || !window.supabase.createClient) return;
    if (!onlineClient) onlineClient = window.supabase.createClient(ONLINE_SUPABASE_URL, ONLINE_SUPABASE_ANON);
    stopOnlinePresence();
    const presenceKey = getOnlinePresenceKey();
    onlineChannel = onlineClient.channel('hugotaslot-online', { config: { presence: { key: presenceKey } } });
    onlineChannel.on('presence', { event: 'sync' }, () => {
      const state = onlineChannel.presenceState();
      let total = 0;
      Object.values(state).forEach((arr) => { total += Array.isArray(arr) ? arr.length : 1; });
      onlineCount = Math.max(1, total);
      updateOnlineCountUI();
    });
    onlineChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onlineChannel.track({
          name: getDisplayName(),
          user: currentUser?.username || 'guest',
          at: Date.now()
        }).catch(() => {});
      }
    });
    if (!onlineBoundUnload) {
      window.addEventListener('beforeunload', () => {
        try { onlineChannel?.untrack(); } catch (_) {}
      });
      onlineBoundUnload = true;
    }
    setTimeout(updateOnlineCountUI, 350);
  } catch (_) {}
}
function buildAvatarMarkup(sizeClass = 'profile-avatar') {
  const avatar = getAvatarUrl();
  const display = getDisplayName();
  if (avatar && isSafeUrl(avatar)) {
    return `<div class="${escapeHtml(sizeClass)}"><img src="${escapeHtml(avatar)}" alt="avatar"></div>`;
  }
  return `<div class="${escapeHtml(sizeClass)}">${escapeHtml(display.charAt(0).toUpperCase())}</div>`;
}
function updateCurrentProfile({ displayName, avatar }) {
  if (!currentUser) return;
  const lockedPseudo = String(currentUser.username || 'Invité').trim() || 'Invité';
  const nextName = lockedPseudo;
  const nextAvatar = String(avatar || '').trim();
  if (currentUser.isGuest) {
    currentUser.displayName = nextName;
    currentUser.avatar = nextAvatar;
    saveGuestProfile({ displayName: nextName, avatar: nextAvatar, balance: getSafeGuestBalance(currentUser.balance) });
    renderProfileBadge();
    return;
  }
  const users = getUsers();
  const rec = users[currentUser.username];
  if (rec) {
    rec.displayName = nextName;
    rec.avatar = nextAvatar;
    saveUsers(users);
  }
  currentUser.displayName = nextName;
  currentUser.avatar = nextAvatar;
  saveSession(currentUser);
  if (currentUser.cloud) {
    const c = getAuthClient();
    if (c && currentUser.id) {
      c.from('profiles')
        .update({ display_name: nextName, avatar_url: nextAvatar })
        .eq('id', currentUser.id)
        .then(() => {})
        .catch(() => showToast('Profil cloud non synchronisé', 'error', 1800));
    }
  }
  renderProfileBadge();
}
function describeCloudError(err) {
  if (!err) return 'erreur inconnue';
  if (typeof err === 'string') return err.trim() || 'erreur inconnue';
  const parts = [
    err.message,
    err.details,
    err.hint,
    err.code ? `code ${err.code}` : '',
    err.httpStatus ? `HTTP ${err.httpStatus}` : ''
  ].map((x) => String(x || '').trim()).filter(Boolean);
  if (parts.length) return parts.join(' · ');
  try { return JSON.stringify(err).slice(0, 140); } catch (_) { return String(err); }
}
/** Appel RPC Supabase via fetch + JWT session (contourne circuit breaker / cache client). */
async function supabaseRpc(name, params = {}) {
  const supa = getAuthClient();
  if (!supa) throw new Error('cloud_client_unavailable');
  const { data: { session }, error: sessErr } = await supa.auth.getSession();
  if (sessErr) throw sessErr;
  if (!session?.access_token) throw new Error('auth required');
  const res = await fetch(`${ONLINE_SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: ONLINE_SUPABASE_ANON,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(params || {})
  });
  const bodyText = await res.text();
  let payload = null;
  if (bodyText) {
    try { payload = JSON.parse(bodyText); } catch { payload = { raw: bodyText }; }
  }
  if (!res.ok) {
    const err = new Error(String(payload?.message || payload?.error || bodyText || `HTTP ${res.status}`));
    err.code = payload?.code || String(res.status);
    err.details = payload?.details || '';
    err.hint = payload?.hint || '';
    err.httpStatus = res.status;
    throw err;
  }
  return payload;
}
function reparentProfileMenuHome() {
  const menu = document.getElementById('profile-menu');
  const wrap = document.getElementById('profile-wrap');
  if (menu && wrap && menu.parentElement !== wrap) wrap.appendChild(menu);
}
function attachProfileMenuToBody() {
  const menu = document.getElementById('profile-menu');
  if (!menu || menu.classList.contains('hidden') || menu.parentElement === document.body) return;
  document.body.appendChild(menu);
}

function positionProfileMenu() {
  const menu = document.getElementById('profile-menu');
  const anchor = document.querySelector('#profile-wrap .profile-badge');
  if (!menu || !anchor || menu.classList.contains('hidden')) return;
  attachProfileMenuToBody();
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, Math.max(280, window.innerWidth - 16));
  const maxH = Math.min(window.innerHeight * 0.85, window.innerHeight - rect.bottom - 16);
  menu.style.top = `${Math.max(8, Math.round(rect.bottom + 8))}px`;
  menu.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
  menu.style.left = 'auto';
  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${Math.max(200, maxH)}px`;
}

function toggleProfileMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('profile-menu');
  if (!menu) return;
  if (profileMenuIsOpen) {
    closeProfileMenu();
    return;
  }
  profileMenuIsOpen = true;
  menu.classList.remove('hidden');
  profileMenuJustOpenedAt = Date.now();
  requestAnimationFrame(() => {
    positionProfileMenu();
    requestAnimationFrame(positionProfileMenu);
  });
  if (isCloudUser() && currentUser?.id) {
    loadCloudProfile(currentUser.id, { force: true })
      .then((fresh) => {
        if (!fresh || !currentUser || currentUser.id !== fresh.id) return;
        currentUser = { ...currentUser, ...fresh };
        saveSession(currentUser);
        updateAdminTabVisibility();
        renderProfileBadge({ preserveMenu: true });
        updateLobbyBalance();
      })
      .catch(() => {});
  }
  if (typeof renderProfileTournoiSubmissions === 'function') renderProfileTournoiSubmissions();
}
function closeProfileMenu() {
  profileMenuIsOpen = false;
  const menu = document.getElementById('profile-menu');
  if (menu) menu.classList.add('hidden');
  reparentProfileMenuHome();
}
function applyProfileSettings() {
  const avatarEl = document.getElementById('profile-avatar-url');
  if (!avatarEl) return;
  updateCurrentProfile({ displayName: currentUser?.username || 'Invité', avatar: avatarEl.value });
  showToast('Profil mis à jour', 'success', 1800);
}
function saveProfilePreferences() {
  const scaleEl = document.getElementById('profile-ui-scale');
  const soundEl = document.getElementById('profile-ui-sound');
  const muteEl = document.getElementById('profile-ui-mute');
  const volEl = document.getElementById('profile-ui-volume');
  const gameVolEl = document.getElementById('profile-game-volume');
  const casinoEl = document.getElementById('profile-default-casino');
  const uiScale = scaleEl ? scaleEl.value : 'normal';
  const uiSound = !!(soundEl && soundEl.checked);
  const uiMuted = !!(muteEl && muteEl.checked);
  const uiVolume = Math.max(0, Math.min(100, Number(volEl ? volEl.value : 70)));
  const uiGameVolume = Math.max(0, Math.min(100, Number(gameVolEl ? gameVolEl.value : 85)));
  const defaultCasino = getCasinoKey(casinoEl ? casinoEl.value : 'gamdom');
  saveUiPrefs({ uiScale, uiSound, uiMuted, uiVolume, uiGameVolume, defaultCasino });
  applyUiPrefs();
  showToast('Préférences sauvegardées', 'success', 1800);
}
function resetProfileAvatar() {
  const nameEl = document.getElementById('profile-display-name');
  updateCurrentProfile({ displayName: nameEl ? nameEl.value : getDisplayName(), avatar: '' });
  const avatarEl = document.getElementById('profile-avatar-url');
  if (avatarEl) avatarEl.value = '';
  showToast('Avatar réinitialisé', 'info', 1800);
}
function normalizeAvatarMime(file) {
  let mime = String(file?.type || '').trim().toLowerCase();
  if (mime === 'image/jpg' || mime === 'image/pjpeg') mime = 'image/jpeg';
  if (!mime && file?.name) {
    const ext = String(file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'png') mime = 'image/png';
    else if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
    else if (ext === 'webp') mime = 'image/webp';
    else if (ext === 'gif') mime = 'image/gif';
  }
  return mime;
}
async function onProfileAvatarUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Image trop lourde (max 2 Mo)', 'error', 2400);
    return;
  }
  const mimeNorm = normalizeAvatarMime(file);
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mimeNorm)) {
    showToast('Format non supporté (PNG, JPG, WebP, GIF)', 'error', 2400);
    return;
  }

  const nameEl = document.getElementById('profile-display-name');
  const displayName = nameEl ? nameEl.value : getDisplayName();

  if (isCloudUser()) {
    const supa = getAuthClient();
    if (!supa) { showToast('Connexion Supabase indisponible', 'error', 2200); return; }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${currentUser.id}/avatar-${Date.now()}.${ext}`;
    try {
      await cloudCall('profile', () => supa.auth.getSession(), { retries: 0, timeoutMs: 8000, quiet: true });
      showToast('Upload de l’avatar…', 'info', 1400);
      const { error: upErr } = await cloudCall('profile', () => supa.storage.from('avatars').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: mimeNorm
      }), { retries: 1, timeoutMs: 25000, delayMs: 400, quiet: true });
      if (upErr) {
        const hint = String(upErr.message || upErr).slice(0, 160);
        console.error('[avatar upload]', upErr);
        showToast(`Échec upload : ${hint}`, 'error', 3800);
        return;
      }
      const { data: pub } = supa.storage.from('avatars').getPublicUrl(path);
      const url = pub?.publicUrl || '';
      updateCurrentProfile({ displayName, avatar: url });
      const avatarEl = document.getElementById('profile-avatar-url');
      if (avatarEl) avatarEl.value = url;
      showToast('Photo de profil mise à jour', 'success', 1800);
    } catch (e) {
      console.error('[avatar upload]', e);
      const hint = String(e?.message || e?.details || e || '').slice(0, 160);
      showToast(hint ? `Échec : ${hint}` : 'Échec de l’upload (bucket avatars / réseau)', 'error', 3800);
    }
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    updateCurrentProfile({ displayName, avatar: String(reader.result || '') });
    const avatarEl = document.getElementById('profile-avatar-url');
    if (avatarEl) avatarEl.value = String(reader.result || '');
    showToast('Photo de profil mise à jour', 'success', 1800);
  };
  reader.readAsDataURL(file);
}
function getDailyState() {
  if (!currentUser) return { canClaim: false, streak: 0, nextStreak: 1, reward: DAILY_DROP_BASE, lastClaimDay: null };
  const today = getDayIndex();
  const isGuest = !!currentUser.isGuest;
  const isCloud = !!currentUser.cloud;
  let lastClaimDay = null;
  let streak = 0;
  if (isCloud) {
    lastClaimDay = currentUser.lastClaimDay ?? null;
    streak = Number(currentUser.streak || 0);
  } else if (isGuest) {
    const gp = getGuestProfile();
    lastClaimDay = gp.lastClaimDay ?? null;
    streak = Number(gp.streak || 0);
  } else {
    const users = getUsers();
    const rec = users[currentUser.username] || {};
    lastClaimDay = rec.lastClaimDay ?? null;
    streak = Number(rec.streak || 0);
  }

  let nextStreak = 1;
  if (lastClaimDay !== null) {
    const diff = dayDiff(today, lastClaimDay);
    if (diff === 0) nextStreak = streak || 1;
    else if (diff === 1) nextStreak = (streak || 0) + 1;
    else nextStreak = 1;
  }
  const streakBonusPct = Math.min(200, Math.max(0, (nextStreak - 1) * DAILY_STREAK_BONUS_PCT_PER_DAY));
  const streakReward = Number((DAILY_DROP_BASE * (1 + streakBonusPct / 100)).toFixed(2));
  const rankInfo = getDailyRankDropInfo();
  const reward = Number((streakReward * rankInfo.factor).toFixed(2));
  return {
    canClaim: lastClaimDay === null || dayDiff(today, lastClaimDay) >= 1,
    streak,
    nextStreak,
    streakReward,
    rankLabel: rankInfo.rankLabel,
    rankFactor: rankInfo.factor,
    reward,
    lastClaimDay
  };
}
// Détecte une RPC absente ou une signature non déployée (PostgREST PGRST202),
// pour basculer proprement sur l'ancienne signature sans casser le claim.
function isMissingRpcSignature(err) {
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || err?.details || err?.hint || err || '').toLowerCase();
  return code === 'PGRST202'
    || msg.includes('could not find the function')
    || msg.includes('schema cache')
    || (msg.includes('function') && msg.includes('does not exist'));
}
function parseDailyDropRpcRow(raw) {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object') return null;
  const awarded = row.awarded ?? row.Awarded;
  const newBalance = row.new_balance ?? row.newBalance ?? row.new_bal;
  if (awarded === undefined && newBalance === undefined) return null;
  return {
    awarded: Number(awarded ?? 0),
    newBalance: Number(newBalance),
    streak: Number(row.streak ?? 1),
    claimDay: Number(row.next_claim_day ?? row.nextClaimDay ?? getDayIndex())
  };
}
async function reconcileDailyDropFromCloud() {
  if (!isCloudUser() || !currentUser?.id) return false;
  try {
    const fresh = await loadCloudProfile(currentUser.id, { force: true });
    if (!fresh || String(fresh.id) !== String(currentUser.id)) return false;
    const today = getDayIndex();
    const claimedToday = fresh.lastClaimDay !== null && fresh.lastClaimDay !== undefined
      && dayDiff(today, fresh.lastClaimDay) === 0;
    if (!claimedToday) return false;
    currentUser.streak = Number(fresh.streak || 0);
    currentUser.lastClaimDay = fresh.lastClaimDay ?? null;
    currentUser.lastClaimAt = fresh.lastClaimAt || currentUser.lastClaimAt;
    if (Number.isFinite(Number(fresh.balance))) currentUser.balance = Number(fresh.balance);
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge({ preserveMenu: true });
    return true;
  } catch (_) {
    return false;
  }
}
async function invokeClaimDailyDropRpc(safeFactor) {
  markCircuitSuccess('sync');
  let data;
  let appliedFactorServerSide = true;
  try {
    data = await supabaseRpc('claim_daily_drop', { p_factor: safeFactor });
  } catch (e) {
    if (!isMissingRpcSignature(e)) throw e;
    data = await supabaseRpc('claim_daily_drop', {});
    appliedFactorServerSide = false;
  }
  return { data, appliedFactorServerSide };
}
async function claimDailyDrop() {
  if (!currentUser) return;
  if (claimDailyDropInFlight) return;
  const st = getDailyState();
  if (!st.canClaim) {
    showToast('Drop déjà récupéré aujourd’hui', 'info', 1800);
    return;
  }
  const today = getDayIndex();

  let supaCloud = null;
  if (isCloudUser()) {
    supaCloud = getAuthClient();
    if (!supaCloud) {
      showToast('Connexion Supabase indisponible', 'error', 2200);
      return;
    }
    try {
      const { data: sessData } = await supaCloud.auth.getSession();
      if (!sessData?.session) {
        showToast('Session expirée. Reconnecte-toi pour récupérer le drop.', 'error', 2600);
        return;
      }
      await supaCloud.auth.refreshSession().catch(() => {});
    } catch (_) {}
  }

  claimDailyDropInFlight = true;
  try {
    if (isCloudUser()) {
      const rankInfo = getDailyRankDropInfo();
      const factor = Number(rankInfo.factor || 1);
      const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;

      const { data, appliedFactorServerSide } = await invokeClaimDailyDropRpc(safeFactor);

      let parsed = parseDailyDropRpcRow(data);
      if (!parsed || !Number.isFinite(parsed.newBalance)) {
        const reconciled = await reconcileDailyDropFromCloud();
        if (reconciled) {
          showToast('Drop déjà récupéré aujourd’hui', 'info', 2000);
          return;
        }
        throw new Error(parsed ? 'claim_daily_drop_invalid_balance' : 'claim_daily_drop_empty');
      }

      const { awarded, newBalance, streak, claimDay } = parsed;
      // Le serveur fait foi : on s'aligne immédiatement et on persiste avant
      // tout autre appel pour ne jamais perdre le crédit en cas d'interruption.
      currentUser.balance = newBalance;
      currentUser.streak = streak;
      currentUser.lastClaimDay = claimDay;
      currentUser.lastClaimAt = new Date().toISOString();
      clearPendingCloudBalanceDelta(currentUser.id);
      saveSession(currentUser);

      // Ajustement de rang uniquement si le serveur n'a pas pu l'appliquer
      // (fallback ancienne RPC). Une éventuelle erreur ici n'annule pas le drop.
      if (!appliedFactorServerSide) {
        const adjust = Number((st.reward - awarded).toFixed(2));
        if (Math.abs(adjust) >= 0.01) {
          const adjustedBal = await applyBalanceDeltaCloud(adjust, `daily_rank_adjust_${st.rankLabel}`);
          if (Number.isFinite(Number(adjustedBal))) currentUser.balance = Number(adjustedBal);
          saveSession(currentUser);
        }
      }
      updateLobbyBalance();
      renderProfileBadge({ preserveMenu: true });
      const shownAward = appliedFactorServerSide ? awarded : st.reward;
      showToast(`Drop récupéré: +${fmt(shownAward)} (${st.rankLabel})`, 'success', 2600);
      return;
    }

    setUserBalance(getUserBalance() + st.reward);
    if (currentUser.isGuest) {
      const gp = getGuestProfile();
      gp.lastClaimDay = today;
      gp.streak = st.nextStreak;
      gp.balance = getUserBalance();
      gp.displayName = currentUser.displayName || GUEST_USER.username;
      gp.avatar = currentUser.avatar || '';
      saveGuestProfile(gp);
      saveSession(currentUser);
    } else {
      const users = getUsers();
      if (users[currentUser.username]) {
        users[currentUser.username].lastClaimDay = today;
        users[currentUser.username].streak = st.nextStreak;
        saveUsers(users);
      }
      currentUser.lastClaimDay = today;
      currentUser.streak = st.nextStreak;
      saveSession(currentUser);
    }
    updateLobbyBalance();
    renderProfileBadge();
    showToast(`Drop récupéré: +${fmt(st.reward)} (streak ${st.nextStreak})`, 'success', 2600);
  } catch (e) {
    if (isCloudUser()) {
      const detail = describeCloudError(e);
      const msg = detail.toLowerCase();
      if (msg.includes('already_claimed') || msg.includes('balance_update_failed') || msg.includes('claim_daily_drop_empty') || msg.includes('claim_daily_drop_invalid_balance')) {
        const reconciled = await reconcileDailyDropFromCloud();
        if (reconciled) {
          showToast('Drop déjà récupéré aujourd’hui', 'info', 2000);
          return;
        }
      }
      if (msg.includes('already_claimed')) {
        showToast('Drop déjà récupéré aujourd’hui', 'info', 2000);
      } else if (msg.includes('auth required')) {
        showToast('Session expirée. Reconnecte-toi pour récupérer le drop.', 'error', 2600);
      } else if (msg.includes('profile_not_found')) {
        showToast('Profil introuvable. Déconnecte-toi puis reconnecte-toi.', 'error', 2800);
      } else if (isMissingRpcSignature(e)) {
        showToast('RPC drop non disponible — exécute la migration SQL puis réessaie.', 'error', 3200);
      } else if (msg.includes('circuit') || msg.includes('offline') || msg.includes('timeout') || msg.includes('failed to fetch')) {
        showToast('Connexion cloud instable. Réessaie dans quelques secondes.', 'error', 2800);
      } else {
        console.error('[claim_daily_drop]', e);
        pushRuntimeLog('error', `daily_drop_err: ${detail.slice(0, 180)}`);
        showToast(`Drop impossible : ${detail.slice(0, 120)}`, 'error', 3600);
      }
    } else {
      console.error('[claim_daily_drop_local]', e);
    }
  } finally {
    claimDailyDropInFlight = false;
  }
}

async function initAuth() {
  const diskSession = getSession();
  currentUser = null;
  const c = getAuthClient();
  if (c) {
    try {
      const { data } = await c.auth.getSession();
      const uid = data?.session?.user?.id;
      if (uid) {
        const persistedBal = getPersistedBalanceForUser(uid);
        if (diskSession && String(diskSession.id) === String(uid)) {
          currentUser = {
            ...diskSession,
            cloud: true,
            isGuest: false,
            balance: persistedBal !== null ? persistedBal : Number(diskSession.balance || 0)
          };
        } else if (persistedBal !== null) {
          currentUser = {
            id: uid,
            cloud: true,
            isGuest: false,
            balance: persistedBal,
            username: diskSession?.username || 'player',
            displayName: diskSession?.displayName || 'Joueur',
            avatar: diskSession?.avatar || '',
            role: diskSession?.role || 'player',
            status: diskSession?.status || 'active',
            email: diskSession?.email || ''
          };
        }
        const profile = await loadCloudProfile(uid, { force: true });
        if (profile) {
          currentUser = { ...(currentUser || {}), ...profile };
          saveSession(currentUser);
          saveSessionMeta({ startedAt: Date.now(), mode: 'cloud' });
          authReady = true;
          reconcileCloudBalanceAfterAuth().catch(() => {});
        }
      }
    } catch (_) {}
  }
  if (!currentUser && diskSession?.cloud) {
    const persistedBal = getPersistedBalanceForUser(diskSession.id);
    currentUser = {
      ...diskSession,
      balance: persistedBal !== null ? persistedBal : Number(diskSession.balance || 0)
    };
    saveSession(currentUser);
    authReady = true;
  }
  if (!currentUser) {
    const session = diskSession || getSession();
    if (session && !session.cloud) {
      const guestBal = getPersistedBalanceForUser('', { isGuest: true });
      currentUser = {
        ...session,
        balance: guestBal !== null ? guestBal : Number(session.balance || 0)
      };
      saveSession(currentUser);
      saveSessionMeta({ startedAt: Date.now(), mode: 'local' });
      ensureAdminBootstrap();
    } else {
      currentUser = null;
      pendingAuthOpen = true;
    }
  }
  renderProfileBadge();
  updateLobbyBalance();
  updateAdminTabVisibility();
  startOnlinePresence();
  if (isCloudUser()) {
    try {
      await load();
      renderHuntList();
      if (state.activeHuntId && state.hunts.find(h => h.id === state.activeHuntId)) {
        document.getElementById('no-hunt-selected').style.display = 'none';
        const ws = document.getElementById('hunt-workspace');
        if (ws) { ws.classList.remove('hidden'); ws.style.display = 'flex'; }
        state._huntWsFp = '';
        if (__activePage === 'hunt' && state.huntTab === 'workspace') {
          scheduleHuntUI({ force: true });
        }
      }
    } catch (e) { bhWarn('initAuth cloud reload failed', e); }
  }
}

function showAuth() {
  const overlay = document.getElementById('auth-overlay');
  const err = document.getElementById('auth-error');
  if (!overlay || !err) {
    pendingAuthOpen = true;
    return;
  }
  overlay.classList.remove('hidden');
  err.classList.remove('show');
  pendingAuthOpen = false;
}
function closeAuth() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.classList.add('hidden');
  if (!currentUser) {
    const guest = getGuestProfile();
    currentUser = { ...GUEST_USER, displayName: guest.displayName || GUEST_USER.username, avatar: guest.avatar || '', balance: getSafeGuestBalance(guest.balance), streak: Number(guest.streak || 0), lastClaimDay: guest.lastClaimDay ?? null };
    saveSession(currentUser);
    updateLobbyBalance();
  }
  ensureAdminBootstrap();
  updateAdminTabVisibility();
  startOnlinePresence();
}

let authMode = 'login'; // 'login' | 'register'
const AUTH_GUARD_KEY = 'hm_auth_guard_v1';
const ACTION_GUARD_KEY = 'hm_action_guard_v1';
function getAuthGuard() {
  try { return JSON.parse(localStorage.getItem(AUTH_GUARD_KEY) || '{}'); } catch { return {}; }
}
function saveAuthGuard(v) {
  try { localStorage.setItem(AUTH_GUARD_KEY, JSON.stringify(v || {})); } catch (_) {}
}
function authGuardCheck(identity) {
  const id = String(identity || 'global').toLowerCase();
  const g = getAuthGuard();
  const rec = g[id] || { fails: 0, blockedUntil: 0 };
  if (Date.now() < Number(rec.blockedUntil || 0)) {
    return { blocked: true, waitSec: Math.ceil((Number(rec.blockedUntil) - Date.now()) / 1000) };
  }
  return { blocked: false, waitSec: 0 };
}
function authGuardRecord(identity, ok) {
  const id = String(identity || 'global').toLowerCase();
  const g = getAuthGuard();
  const rec = g[id] || { fails: 0, blockedUntil: 0 };
  if (ok) {
    delete g[id];
    saveAuthGuard(g);
    return;
  }
  rec.fails = Number(rec.fails || 0) + 1;
  if (rec.fails >= 5) {
    const lockMs = Math.min(10 * 60 * 1000, 30 * 1000 * Math.pow(2, rec.fails - 5));
    rec.blockedUntil = Date.now() + lockMs;
  }
  g[id] = rec;
  saveAuthGuard(g);
}
function getActionGuard() {
  try { return JSON.parse(localStorage.getItem(ACTION_GUARD_KEY) || '{}'); } catch { return {}; }
}
function saveActionGuard(v) {
  try { localStorage.setItem(ACTION_GUARD_KEY, JSON.stringify(v || {})); } catch (_) {}
}
function actionGuardAcquire(actionKey, { limit = 5, windowMs = 60000, blockMs = 120000 } = {}) {
  try {
    if (typeof isCurrentUserAdmin === 'function' && isCurrentUserAdmin()) {
      return { blocked: false, waitSec: 0 };
    }
  } catch (_) {}
  const key = String(actionKey || 'global');
  const now = Date.now();
  const data = getActionGuard();
  const rec = data[key] || { hits: [], blockedUntil: 0 };
  const until = Number(rec.blockedUntil || 0);
  if (now < until) {
    return { blocked: true, waitSec: Math.ceil((until - now) / 1000) };
  }
  const minTs = now - Number(windowMs || 60000);
  const hits = Array.isArray(rec.hits) ? rec.hits.filter((t) => Number(t) >= minTs) : [];
  hits.push(now);
  if (hits.length > Number(limit || 5)) {
    rec.hits = hits;
    rec.blockedUntil = now + Number(blockMs || 120000);
    data[key] = rec;
    saveActionGuard(data);
    return { blocked: true, waitSec: Math.ceil(Number(blockMs || 120000) / 1000) };
  }
  rec.hits = hits;
  rec.blockedUntil = 0;
  data[key] = rec;
  saveActionGuard(data);
  return { blocked: false, waitSec: 0 };
}
function getActionGuardStatus() {
  const now = Date.now();
  const data = getActionGuard();
  const entries = Object.entries(data).map(([k, v]) => ({
    key: k,
    blockedUntil: Number(v?.blockedUntil || 0),
    waitSec: Math.max(0, Math.ceil((Number(v?.blockedUntil || 0) - now) / 1000))
  }));
  return entries.filter((e) => e.waitSec > 0).sort((a, b) => b.waitSec - a.waitSec);
}
function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  const isReg = authMode === 'register';
  document.getElementById('auth-title').textContent = isReg ? 'CRÉER UN COMPTE' : 'CONNEXION';
  document.getElementById('auth-submit').textContent = isReg ? 'CRÉER MON COMPTE' : 'SE CONNECTER';
  document.getElementById('auth-switch').innerHTML = isReg
    ? 'Déjà un compte ? <span>Se connecter</span>'
    : 'Pas encore de compte ? <span>Créer un compte</span>';
  document.getElementById('auth-password2-field').style.display = isReg ? 'block' : 'none';
  document.getElementById('auth-error').classList.remove('show');
}

async function authSubmit() {
  const username = document.getElementById('auth-username').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.classList.remove('show');

  if (!username || !password) { errEl.textContent = 'Identifiant et mot de passe requis.'; errEl.classList.add('show'); return; }
  if (password.length < 6) { errEl.textContent = 'Mot de passe trop court (min 6 caractères).'; errEl.classList.add('show'); return; }
  const c = getAuthClient();
  if (!c) { errEl.textContent = 'Client Supabase indisponible.'; errEl.classList.add('show'); return; }
  const guardId = (email || usernameToEmail(username) || username || 'global').trim().toLowerCase();
  const guard = authGuardCheck(guardId);
  if (authMode === 'login' && guard.blocked) {
    errEl.textContent = `Trop de tentatives. Réessaie dans ${guard.waitSec}s.`;
    errEl.classList.add('show');
    return;
  }
  const apiGuard = actionGuardAcquire(`auth:${authMode}`, { limit: 6, windowMs: 60000, blockMs: 120000 });
  if (apiGuard.blocked) {
    pushRuntimeLog('warn', `auth_guard_block:${authMode} wait=${apiGuard.waitSec}s`);
    errEl.textContent = `Trop de requêtes ${authMode}. Réessaie dans ${apiGuard.waitSec}s.`;
    errEl.classList.add('show');
    return;
  }

  try {
    if (authMode === 'register') {
      const pwd2 = document.getElementById('auth-password2').value;
      if (password !== pwd2) { errEl.textContent = 'Les mots de passe ne correspondent pas.'; errEl.classList.add('show'); return; }
      const registerEmail = email || usernameToEmail(username);
      const { error } = await cloudCall('auth', () => c.auth.signUp({
        email: registerEmail,
        password,
        options: {
          data: { username, display_name: username }
        }
      }), { retries: 1, timeoutMs: 12000, delayMs: 600 });
      if (error) throw error;
      await cloudCall('auth', () => c.auth.signInWithPassword({ email: registerEmail, password }), { retries: 1, timeoutMs: 12000, delayMs: 600 });
      const { data } = await cloudCall('auth', () => c.auth.getSession(), { retries: 0, timeoutMs: 10000, quiet: true });
      const uid = data?.session?.user?.id;
      if (!uid) throw new Error('Session cloud introuvable');
      currentUser = await loadCloudProfile(uid);
      saveSession(currentUser);
      saveSessionMeta({ startedAt: Date.now(), mode: 'cloud' });
      authReady = true;
      closeAuth();
      renderProfileBadge();
      updateLobbyBalance();
      startOnlinePresence();
      try { await load(); renderHuntList(); if (state.activeHuntId) selectHunt(state.activeHuntId); } catch (_) {}
      showToast(`Compte cloud créé !`, 'success', 3200);
      return;
    }

    const loginEmail = email || usernameToEmail(username);
    const { error } = await cloudCall('auth', () => c.auth.signInWithPassword({ email: loginEmail, password }), { retries: 1, timeoutMs: 12000, delayMs: 600 });
    if (error) throw error;
    const { data } = await cloudCall('auth', () => c.auth.getSession(), { retries: 0, timeoutMs: 10000, quiet: true });
    const uid = data?.session?.user?.id;
    if (!uid) throw new Error('Session cloud introuvable');
    currentUser = await loadCloudProfile(uid);
    saveSession(currentUser);
    saveSessionMeta({ startedAt: Date.now(), mode: 'cloud' });
    authReady = true;
    closeAuth();
    renderProfileBadge();
    updateLobbyBalance();
    startOnlinePresence();
    try { await load(); renderHuntList(); if (state.activeHuntId) selectHunt(state.activeHuntId); } catch (_) {}
    authGuardRecord(guardId, true);
    showToast(`Bonjour ${currentUser.displayName || currentUser.username} !`, 'success', 2600);
  } catch (e) {
    if (authMode === 'login') authGuardRecord(guardId, false);
    errEl.textContent = mapAuthError(e);
    errEl.classList.add('show');
  }
}

function enterGuestMode(message = 'Déconnecté (mode invité actif)') {
  clearSession();
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LOCAL_SYNCED_KEY); } catch (_) {}
  state.hunts = [];
  state.activeHuntId = null;
  const guest = getGuestProfile();
  currentUser = { ...GUEST_USER, displayName: guest.displayName || GUEST_USER.username, avatar: guest.avatar || '', balance: getSafeGuestBalance(guest.balance), streak: Number(guest.streak || 0), lastClaimDay: guest.lastClaimDay ?? null };
  renderProfileBadge();
  updateLobbyBalance();
  updateAdminTabVisibility();
  startOnlinePresence();
  loadLocal();
  renderHuntList();
  if (state.activeHuntId) selectHunt(state.activeHuntId);
  else {
    document.getElementById('no-hunt-selected').style.display = 'flex';
    const ws = document.getElementById('hunt-workspace');
    if (ws) ws.classList.add('hidden');
  }
  showToast(message, 'info');
}
function logout() {
  if (currentUser && currentUser.cloud) {
    const c = getAuthClient();
    if (c) c.auth.signOut({ scope: 'local' }).then(() => {}).catch(() => {});
  }
  enterGuestMode('Déconnecté (mode invité actif)');
}
async function logoutAllDevices() {
  if (!currentUser || currentUser.isGuest || !currentUser.cloud) {
    logout();
    return;
  }
  const ok = await confirm('Déconnecter tous les appareils ?', 'Toutes les sessions cloud seront fermées (web/mobile/autres navigateurs).');
  if (!ok) return;
  try {
    const c = getAuthClient();
    if (c) await c.auth.signOut({ scope: 'global' });
  } catch (e) {
    pushRuntimeLog('error', `logout_all_devices: ${String(e?.message || e || 'unknown')}`);
  }
  enterGuestMode('Toutes les sessions ont été fermées.');
}

function renderProfileBadge(opts = {}) {
  const preserveMenu = !!opts.preserveMenu;
  const keepMenuOpen = preserveMenu || profileMenuIsOpen;
  // Évite les doublons #profile-menu (détaché sur body après positionProfileMenu).
  document.querySelectorAll('body > #profile-menu').forEach((el) => el.remove());
  // Ajouter le badge dans le header principal
  const area = document.getElementById('header');
  if (!area) return;
  let badge = document.getElementById('profile-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'profile-badge';
    badge.className = 'profile-badge';
    area.appendChild(badge);
  }
  if (currentUser) {
    const pseudoRaw = currentUser.username || getDisplayName() || 'Invité';
    const safePseudo = escapeHtml(pseudoRaw);
    const safeName = escapeHtml(getDisplayName());
    const safeUser = escapeHtml(currentUser.username || 'Invité');
    const safeAvatar = escapeHtml(getAvatarUrl());
    const adminNow = isCurrentUserAdmin();
    const daily = getDailyState();
    const nextBonusPct = Math.min(200, Math.max(0, (daily.nextStreak - 1) * DAILY_STREAK_BONUS_PCT_PER_DAY));
    const sm = getSessionMeta();
    const started = sm?.startedAt ? new Date(sm.startedAt).toLocaleString('fr-FR') : '—';
    const deviceTxt = `${navigator.platform || 'Unknown'} / ${navigator.language || '—'}`;
    badge.innerHTML = `
      <div class="profile-wrap" id="profile-wrap">
        <div class="profile-badge" onclick="toggleProfileMenu(event)">
          ${buildAvatarMarkup()}
          <div>
            <div class="profile-name">${safePseudo}</div>
            <div class="profile-balance" id="profile-badge-balance">${fmtVirtual(getUserBalance())}</div>
            ${typeof getRankBadgeHtml === 'function' ? getRankBadgeHtml() : ''}
            <div class="profile-online"><span class="profile-online-dot"></span><span id="online-users-count">${Math.max(1, onlineCount)}</span> en ligne</div>
          </div>
        </div>
        <div class="profile-menu hidden" id="profile-menu">
          <div class="profile-menu-title">MON COMPTE</div>
          <div class="profile-menu-head">
            ${buildAvatarMarkup('profile-avatar')}
            <div>
              <div class="profile-menu-big">${safePseudo}</div>
              <div class="profile-menu-sub">Nom affiché: ${safeName}</div>
              <div class="profile-menu-sub">Solde actuel: <span id="profile-menu-balance">${fmtVirtual(getUserBalance())}</span>${adminNow ? ' · ADMIN' : ''}</div>
              ${typeof getRankBadgeHtml === 'function' ? getRankBadgeHtml() : ''}
            </div>
          </div>
          <div class="profile-grid">
            <div class="profile-tile">
              <div class="profile-tile-label">STATUT</div>
              <div class="profile-tile-value">${currentUser.isGuest ? 'INVITÉ' : (adminNow ? 'ADMIN' : 'JOUEUR')}</div>
            </div>
            <div class="profile-tile">
              <div class="profile-tile-label">SESSION</div>
              <div class="profile-tile-value">${currentUser.cloud ? 'CLOUD' : 'LOCAL'}</div>
            </div>
          </div>
          <div class="drop-box">
            <div class="drop-title">Drop quotidien</div>
            <div class="drop-meta">
              Streak actuelle: ${daily.streak} jour(s)<br>
              Rank: ${daily.rankLabel} (x${daily.rankFactor.toFixed(2)})<br>
              Prochain drop: +${fmt(daily.reward)} (${nextBonusPct}% bonus streak)
            </div>
            <button class="drop-claim-btn" onclick="claimDailyDrop()" ${daily.canClaim ? '' : 'disabled'}>
              ${daily.canClaim ? 'Récupérer le drop' : 'Déjà récupéré aujourd’hui'}
            </button>
          </div>
          <div class="drop-box" id="profile-weekly-objectives"></div>
          <div class="drop-box">
            <div class="drop-title">Mes soumissions tournoi</div>
            <div class="drop-meta" style="margin-bottom:8px;">Statut : en attente, validé (refus = entrée retirée par l’admin).</div>
            <div id="profile-tournoi-submissions"><div class="drop-meta">Ouvre le menu pour charger…</div></div>
          </div>
          <div class="drop-box">
            <div class="drop-title">Préférences</div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">TAILLE UI</span>
              <select class="profile-menu-input" id="profile-ui-scale" style="width:140px;height:34px;padding:0 8px;">
                <option value="normal">Normal</option>
                <option value="large">Grand</option>
                <option value="compact">Compact</option>
              </select>
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">SONS UI</span>
              <input type="checkbox" id="profile-ui-sound">
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">MUTE GLOBAL</span>
              <input type="checkbox" id="profile-ui-mute">
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">VOLUME</span>
              <input type="range" id="profile-ui-volume" min="0" max="100" step="5" style="width:140px;">
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">VOLUME JEUX</span>
              <input type="range" id="profile-game-volume" min="0" max="100" step="5" style="width:140px;">
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">CASINO PAR DÉFAUT</span>
              <select class="profile-menu-input" id="profile-default-casino" style="width:140px;height:34px;padding:0 8px;"></select>
            </div>
            <button class="profile-mini-btn primary" style="width:100%;" onclick="saveProfilePreferences()">Sauvegarder préférences</button>
          </div>
          <div class="drop-box">
            <div class="drop-title">Sécurité session</div>
            <div class="drop-meta">
              Session active: ${currentUser.cloud ? 'CLOUD' : 'LOCAL'}<br>
              Démarrée: ${escapeHtml(started)}<br>
              Appareil: ${escapeHtml(deviceTxt)}
            </div>
            ${(!currentUser.isGuest && currentUser.cloud)
              ? `<button class="profile-mini-btn danger" style="width:100%;margin-top:8px;" onclick="logoutAllDevices()">Déconnecter tous les appareils</button>`
              : `<div class="bj-rec" style="margin-top:8px;">Option cloud indisponible en mode invité/local.</div>`}
          </div>
          <div class="drop-box">
            <div class="drop-title">Compte Discord</div>
            <div class="drop-meta" style="margin-bottom:8px;">Lie ton compte pour <code>/hunts</code>, <code>/leaderboard</code>, <code>/live slug</code>. <code>/slot</code> et <code>/call</code> (tirage catalogue) sont utilisables par tous sur le serveur.</div>
            ${(!currentUser.isGuest && currentUser.cloud)
              ? `<button class="profile-mini-btn primary" style="width:100%;" onclick="openDiscordLinkModal()">Gérer la liaison Discord</button>`
              : `<div class="bj-rec">Connecte-toi avec un compte cloud pour activer la liaison Discord.</div>`}
          </div>
          <div class="profile-menu-row">
            <label class="profile-menu-label">Pseudo du compte (verrouillé)</label>
            <input class="profile-menu-input" id="profile-display-name" value="${safePseudo}" maxlength="20" disabled title="Le pseudo est verrouillé sur le compte">
          </div>
          <div class="profile-menu-row">
            <label class="profile-menu-label">Photo (URL)</label>
            <input class="profile-menu-input" id="profile-avatar-url" value="${safeAvatar}" placeholder="https://...">
          </div>
          <div class="profile-menu-row">
            <label class="profile-menu-label">Importer une photo</label>
            <input class="profile-menu-input" type="file" accept="image/*" onchange="onProfileAvatarUpload(event)">
          </div>
          <div class="profile-menu-row" style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);">
            Compte: ${safeUser}${currentUser.isGuest ? ' (invité)' : ''}
          </div>
          <div class="profile-menu-row" style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);line-height:1.45;">
            ID session: ${escapeHtml(String(currentUser.id || '—'))}<br>
            Role brut: ${escapeHtml(String(currentUser.role || '—'))} · Statut brut: ${escapeHtml(String(currentUser.status || '—'))}
          </div>
          <div class="profile-menu-actions">
            <button class="profile-mini-btn primary" onclick="applyProfileSettings()">Enregistrer</button>
            <button class="profile-mini-btn" onclick="resetProfileAvatar()">Reset avatar</button>
            ${currentUser.isGuest ? `<button class="profile-mini-btn" onclick="showAuth()">Connexion</button><button class="profile-mini-btn danger" onclick="closeProfileMenu()">Fermer</button>` : `${adminNow ? `<button class="profile-mini-btn primary" onclick="switchPage('admin'); closeProfileMenu();">Panel admin</button>` : `<button class="profile-mini-btn" onclick="closeProfileMenu()">Fermer</button>`}<button class="profile-mini-btn danger" onclick="logout()">Déconnexion</button>`}
          </div>
        </div>
      </div>
    `;
    if (keepMenuOpen) {
      profileMenuIsOpen = true;
      const menu = document.getElementById('profile-menu');
      if (menu) {
        menu.classList.remove('hidden');
        requestAnimationFrame(() => {
          positionProfileMenu();
          requestAnimationFrame(positionProfileMenu);
        });
      }
    }
    const prefs = getUiPrefs();
    const scaleEl = document.getElementById('profile-ui-scale');
    const soundEl = document.getElementById('profile-ui-sound');
    const muteEl = document.getElementById('profile-ui-mute');
    const volEl = document.getElementById('profile-ui-volume');
    const gameVolEl = document.getElementById('profile-game-volume');
    const casinoEl = document.getElementById('profile-default-casino');
    if (scaleEl) scaleEl.value = prefs.uiScale || 'normal';
    if (soundEl) soundEl.checked = prefs.uiSound !== false;
    if (muteEl) muteEl.checked = !!prefs.uiMuted;
    if (volEl) volEl.value = String(Number.isFinite(Number(prefs.uiVolume)) ? Number(prefs.uiVolume) : 70);
    if (gameVolEl) gameVolEl.value = String(Number.isFinite(Number(prefs.uiGameVolume)) ? Number(prefs.uiGameVolume) : 85);
    populateCasinoSelect(casinoEl, getCasinoKey(prefs.defaultCasino || 'gamdom'));
  } else {
    badge.innerHTML = `<span onclick="showAuth()" style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);letter-spacing:1px;cursor:pointer;">CONNEXION</span>`;
  }
  updateOnlineCountUI();
  renderMaintenanceBanner();
  ensureNotifBellInHeader();
  renderWeeklyObjectivesInProfile();
}

function getUserBalance() {
  if (!currentUser) return 0;
  if (currentUser.cloud) return Number(currentUser.balance || 0);
  if (currentUser.isGuest) return currentUser.balance || 0;
  const users = getUsers();
  const u = users[currentUser.username];
  return u ? u.balance : 0;
}

let cloudBalanceSyncTimer = null;
let cloudBalanceSyncRunning = false;
let cloudBalanceSyncQueued = false;
let cloudGameSettlementInFlight = 0;
let cloudQueuedGameSessions = 0;
function getPendingStakePreviewTotal() {
  let total = 0;
  for (const key of Object.keys(window.__hmStakePreview || {})) {
    const q = window.__hmStakePreview[key];
    if (!Array.isArray(q) || !q.length) continue;
    for (const v of q) {
      const n = Number(v || 0);
      if (Number.isFinite(n) && n > 0) total += n;
    }
  }
  return +total.toFixed(4);
}
function hasPendingStakePreviews() {
  return getPendingStakePreviewTotal() > 0.0001;
}
function markCloudSettlementStart() {
  cloudGameSettlementInFlight += 1;
}
function markCloudSettlementEnd() {
  cloudGameSettlementInFlight = Math.max(0, cloudGameSettlementInFlight - 1);
}
function canStartCloudGameRound(showToast = true) {
  if (!isCloudUser() || !CLOUD_STRICT_POINTS) return true;
  const status = getCloudUiStatus();
  if (status.key !== 'online') {
    pushRuntimeLog('warn', `game_gate_blocked: cloud_status=${status.key}`);
    if (showToast) showCloudOfflineToastThrottled();
    return false;
  }
  if (cloudGameSettlementInFlight > 0) {
    pushRuntimeLog('warn', `game_gate_blocked: settlement_in_flight=${cloudGameSettlementInFlight}`);
    if (showToast) showCloudPendingToastThrottled();
    return false;
  }
  return true;
}
function canStartCloudGameRoundForPlinko(showToast = true) {
  if (!isCloudUser() || !CLOUD_STRICT_POINTS) return true;
  const status = getCloudUiStatus();
  if (status.key !== 'online') {
    pushRuntimeLog('warn', `game_gate_blocked_plinko: cloud_status=${status.key}`);
    if (showToast) showCloudOfflineToastThrottled();
    return false;
  }
  return true;
}
async function syncCloudBalanceNow() {
  if (!isCloudUser() || !currentUser?.id) return;
  if (cloudQueuedGameSessions > 0 || cloudGameSettlementInFlight > 0 || hasPendingStakePreviews()) return;
  if (cloudBalanceSyncRunning) { cloudBalanceSyncQueued = true; return; }
  cloudBalanceSyncRunning = true;
  try {
    const fresh = await loadCloudProfile(currentUser.id, { force: true });
    if (fresh && currentUser && currentUser.id === fresh.id) {
      const freshBal = Number(fresh.balance || 0);
      const currBal = Number(currentUser.balance || 0);
      const persistedBal = getPersistedBalanceForUser(currentUser.id);
      if (shouldRejectSuspectServerBalance(freshBal, persistedBal ?? currBal, currentUser.id)) {
        pushRuntimeLog('warn', `cloud_sync_skip_suspect_reset_100: fresh=${freshBal.toFixed(2)} current=${currBal.toFixed(2)}`);
        return;
      }
      const mergedBal = resolveCloudBalanceMerge(currBal, freshBal, currentUser.id);
      if (shouldRejectRollbackToGameAnchor(mergedBal, currBal) && Math.abs(mergedBal - currBal) > 0.005) {
        pushRuntimeLog('warn', `cloud_sync_skip_anchor_rollback: merged=${mergedBal.toFixed(2)} current=${currBal.toFixed(2)}`);
        return;
      }
      if (Math.abs(mergedBal - currBal) < 0.005) return;
      currentUser.balance = mergedBal;
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
  } catch (_) {
    // Best effort: l'UI reste sur la valeur optimiste.
  } finally {
    cloudBalanceSyncRunning = false;
    if (cloudBalanceSyncQueued) {
      cloudBalanceSyncQueued = false;
      setTimeout(() => { syncCloudBalanceNow().catch(() => {}); }, 120);
    }
  }
}
function scheduleCloudBalanceSync(delayMs = 700) {
  if (!isCloudUser()) return;
  if (cloudQueuedGameSessions > 0 || cloudGameSettlementInFlight > 0 || hasPendingStakePreviews()) {
    cloudBalanceSyncQueued = true;
    return;
  }
  if (cloudBalanceSyncTimer) clearTimeout(cloudBalanceSyncTimer);
  cloudBalanceSyncTimer = setTimeout(() => {
    cloudBalanceSyncTimer = null;
    syncCloudBalanceNow().catch(() => {});
  }, Math.max(150, Number(delayMs) || 700));
}
async function reconcileCloudBalanceAfterAuth() {
  if (!isCloudUser() || !currentUser?.id) return;
  const pending = getPendingCloudBalanceDelta(currentUser.id);
  if (Math.abs(pending) < 0.005) return;
  if (cloudQueuedGameSessions > 0 || cloudGameSettlementInFlight > 0 || hasPendingStakePreviews()) return;
  try {
    await applyBalanceDeltaCloud(pending, 'pending_reconcile');
    clearPendingCloudBalanceDelta(currentUser.id);
  } catch (e) {
    pushRuntimeLog('warn', `pending_reconcile_failed: ${String(e?.message || e || 'unknown')}`);
  }
}

function setUserBalance(val) {
  if (!currentUser) return;
  if (isMaintenanceReadOnly()) return;
  if (currentUser.cloud) {
    const next = Math.max(0, Number(val || 0));
    const prev = Number(currentUser.balance || 0);
    const delta = Number((next - prev).toFixed(2));
    if (Math.abs(delta) < 0.005) return;
    markCloudSettlementStart();
    applyBalanceDeltaCloud(delta, 'set')
      .catch(err => bhWarn('[balance] set delta failed', err))
      .finally(() => {
        markCloudSettlementEnd();
        scheduleCloudBalanceSync(900);
      });
    return;
  }
  if (currentUser.isGuest) {
    currentUser.balance = Math.max(0, val);
    saveGuestProfile({
      displayName: currentUser.displayName || GUEST_USER.username,
      avatar: currentUser.avatar || '',
      balance: currentUser.balance,
      streak: Number(currentUser.streak || 0),
      lastClaimDay: currentUser.lastClaimDay ?? null
    });
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
    return;
  }
  const users = getUsers();
  if (users[currentUser.username]) {
    users[currentUser.username].balance = Math.max(0, val);
    saveUsers(users);
    currentUser.balance = users[currentUser.username].balance;
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
  }
}

// Applique un delta sur la balance cloud via le RPC `apply_balance_delta`.
// Le caller doit déjà avoir muté `currentUser.balance` de manière optimiste ;
// cette fonction écrase ensuite avec la valeur officielle renvoyée par le serveur.
async function applyBalanceDeltaCloud(delta, reason = null) {
  if (!isCloudUser()) return Number(currentUser?.balance || 0);
  const supa = getAuthClient();
  if (!supa) return Number(currentUser?.balance || 0);
  try {
    const { data, error } = await cloudCall('sync', () => supa.rpc('apply_balance_delta', {
      p_delta: Number(delta || 0),
      p_reason: reason ? String(reason).slice(0, 200) : null
    }), { retries: 1, timeoutMs: 10000, delayMs: 500 });
    if (error) throw error;
    const newBal = Number(data ?? currentUser.balance);
    if (
      shouldRejectSuspectServerBalance(newBal, currentUser?.balance, currentUser?.id) ||
      shouldRejectRollbackToGameAnchor(newBal, currentUser?.balance)
    ) {
      pushRuntimeLog('warn', `apply_balance_delta_suspect_reset_100: server=${Number(newBal || 0).toFixed(2)} current=${Number(currentUser?.balance || 0).toFixed(2)}`);
      return Number(currentUser?.balance || 0);
    }
    if (Number.isFinite(newBal)) {
      currentUser.balance = newBal;
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
    return newBal;
  } catch (e) {
    console.error('[balance] apply_balance_delta failed', e);
    return Number(currentUser?.balance || 0);
  }
}

// Logge une session de mini-jeu (cloud) ou applique le delta localement (guest).
async function recordGameSession(game, stake, payout) {
  if (!currentUser) return;
  const stakeN = Math.max(0, Number(stake || 0));
  const payoutN = Math.max(0, Number(payout || 0));
  const delta = Number((payoutN - stakeN).toFixed(2));

  if (isCloudUser() && CLOUD_STRICT_POINTS) {
    const supa = getAuthClient();
    if (!supa) throw new Error('cloud_client_unavailable');
    pushRuntimeLog('info', `game_tx_start: ${String(game || 'unknown')} stake=${stakeN.toFixed(2)} payout=${payoutN.toFixed(2)}`);
    markCloudSettlementStart();
    try {
      const { data, error } = await cloudCall('sync', () => supa.rpc('record_game_session', {
        p_game: String(game || 'unknown').slice(0, 60),
        p_stake: stakeN,
        p_payout: payoutN
      }), { retries: 1, timeoutMs: 10000, delayMs: 500 });
      if (error) throw error;
      const newBal = Number(data ?? currentUser.balance);
      if (
        shouldRejectSuspectServerBalance(newBal, currentUser?.balance, currentUser?.id) ||
        shouldRejectRollbackToGameAnchor(newBal, currentUser?.balance)
      ) {
        pushRuntimeLog('warn', `record_game_session_suspect_reset_100: server=${Number(newBal || 0).toFixed(2)} current=${Number(currentUser?.balance || 0).toFixed(2)} game=${String(game || 'unknown')}`);
        return Number(currentUser?.balance || 0);
      }
      if (Number.isFinite(newBal)) {
        currentUser.balance = newBal;
        saveSession(currentUser);
        updateLobbyBalance();
        renderProfileBadge();
      }
      clearPendingCloudBalanceDelta(currentUser?.id);
      pushRuntimeLog('info', `game_tx_ok: ${String(game || 'unknown')} balance=${Number(currentUser?.balance || 0).toFixed(2)}`);
      return newBal;
    } catch (e) {
      console.error('[record_game_session]', e);
      pushRuntimeLog('error', `game_tx_err: ${String(game || 'unknown')} ${String(e?.message || e || 'unknown')}`);
      scheduleCloudBalanceSync(400);
      throw e;
    } finally {
      markCloudSettlementEnd();
      scheduleCloudBalanceSync(600);
    }
  }

  // Guest/local : on applique simplement le delta sur la balance locale.
  const next = Math.max(0, Number(currentUser.balance || 0) + delta);
  setUserBalance(next);
}
let cloudSettlementQueue = Promise.resolve();
let lastCloudValidationToastAt = 0;
function showCloudValidationToastThrottled() {
  const now = Date.now();
  if (now - lastCloudValidationToastAt < 4500) return;
  lastCloudValidationToastAt = now;
  showToast('Gain enregistré localement — synchro cloud en cours', 'info', 2800);
}
let lastCloudOfflineToastAt = 0;
function showCloudOfflineToastThrottled() {
  const now = Date.now();
  if (now - lastCloudOfflineToastAt < 3500) return;
  lastCloudOfflineToastAt = now;
  showToast('Connexion cloud indisponible, réessaie dans quelques secondes', 'error', 2600);
}
function showCloudPendingToastThrottled() {
  /* volontairement silencieux */
}
function queueCloudGameSession(game, stake, payout) {
  if (!isCloudUser()) return recordGameSession(game, stake, payout);
  cloudQueuedGameSessions += 1;
  const task = cloudSettlementQueue
    .catch(() => {})
    .then(async () => {
      try {
        return await recordGameSession(game, stake, payout);
      } catch (e) {
        // Retry court: évite les erreurs cloud transitoires pendant les rafales.
        await gameSleep(320);
        return recordGameSession(game, stake, payout);
      }
    })
    .finally(() => {
      cloudQueuedGameSessions = Math.max(0, cloudQueuedGameSessions - 1);
      if (cloudQueuedGameSessions === 0) scheduleCloudBalanceSync(220);
    });
  cloudSettlementQueue = task.catch(() => {});
  return task;
}
async function applyNetDeltaForGame(game, netAmount) {
  const net = Number(netAmount || 0);
  if (!Number.isFinite(net) || Math.abs(net) < 0.005) return;
  const stake = net < 0 ? Math.abs(net) : 0;
  const payout = net > 0 ? net : 0;
  trackPlayerGameStats(String(game || 'unknown'), stake, payout);
  if (isCloudUser()) {
    if (currentUser) {
      notePendingCloudBalanceDelta(currentUser.id, net);
      currentUser.balance = Math.max(0, Number(currentUser.balance || 0) + net);
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
    queueCloudGameSession(game, stake, payout).catch(() => {});
  } else {
    setUserBalance(getUserBalance() + net);
  }
  updateLobbyBalance();
}

function updateLobbyBalance() {
  const bal = getUserBalance();
  if (Number.isFinite(bal) && bal >= 0) {
    localStorage.setItem(BALANCE_SNAPSHOT_KEY, String(bal));
    saveBalanceSnapshotScoped(bal, {
      userId: isCloudUser() ? String(currentUser?.id || '') : '',
      isGuest: !!currentUser?.isGuest || !isCloudUser()
    });
  }
  const balText = fmtVirtual(bal);
  const el = document.getElementById('lobby-balance');
  if (el && el.textContent !== balText) el.textContent = balText;
  const topBal = document.getElementById('game-window-balance');
  if (topBal && topBal.textContent !== balText) topBal.textContent = balText;
  const controlsBal = document.getElementById('game-controls-balance');
  if (controlsBal && controlsBal.textContent !== balText) controlsBal.textContent = balText;
  const miniBal = document.getElementById('profile-badge-balance');
  if (miniBal && miniBal.textContent !== balText) miniBal.textContent = balText;
  const menuBal = document.getElementById('profile-menu-balance');
  if (menuBal && menuBal.textContent !== balText) menuBal.textContent = balText;
}

// [blackjack] — extrait dans scripts/pages/blackjack.js (LAZY_PAGE_SCRIPTS)

// [mise] — extrait dans scripts/pages/mise.js (LAZY_PAGE_SCRIPTS)

// [tournoi] — extrait dans scripts/pages/tournoi.js (LAZY_PAGE_SCRIPTS)

// [jeux] — extrait dans scripts/pages/mini-jeux.js (LAZY_PAGE_SCRIPTS)

// [roue_depot] — extrait dans scripts/pages/roue-depot.js (LAZY_PAGE_SCRIPTS)


// [jeux] — extrait dans scripts/pages/mini-jeux.js (LAZY_PAGE_SCRIPTS)

const RANK_FAMILIES = ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Master'];
const RANK_STEPS_PER_FAMILY = 5;
const STATS_GAMES = ['blackjack', 'roulette', 'crash', 'keno', 'mines', 'plinko', 'flip', 'dice', 'hilo', 'chicken', 'pump', 'limbo'];
let playerStatsScope = '';
let playerStats = null;
// [stats UI] — renderStatsPage / setStatsWindow dans scripts/pages/stats.js (LAZY_PAGE_SCRIPTS)
function statsScopeKey() {
  if (isCloudUser()) return `cloud:${currentUser.id}`;
  if (currentUser?.isGuest) return `guest:${currentUser.displayName || 'invite'}`;
  return `local:${currentUser?.username || 'unknown'}`;
}
function createEmptyPlayerStats() {
  const games = {};
  STATS_GAMES.forEach((g) => { games[g] = { played: 0, wagered: 0, payout: 0, net: 0 }; });
  return {
    rounds: 0,
    wagered: 0,
    payout: 0,
    net: 0,
    games,
    daily: {},
    sessionsByHour: Array(24).fill(0)
  };
}
function loadPlayerStatsForScope(scope) {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYER_STATS_KEY) || '{}');
    const rec = raw?.[scope];
    if (!rec || typeof rec !== 'object') return createEmptyPlayerStats();
    const stats = createEmptyPlayerStats();
    stats.rounds = Math.max(0, Number(rec.rounds || 0));
    stats.wagered = Math.max(0, Number(rec.wagered || 0));
    stats.payout = Math.max(0, Number(rec.payout || 0));
    stats.net = Number(rec.net || (stats.payout - stats.wagered) || 0);
    STATS_GAMES.forEach((g) => {
      const src = rec.games?.[g] || {};
      stats.games[g] = {
        played: Math.max(0, Number(src.played || 0)),
        wagered: Math.max(0, Number(src.wagered || 0)),
        payout: Math.max(0, Number(src.payout || 0)),
        net: Number(src.net || (Number(src.payout || 0) - Number(src.wagered || 0)) || 0)
      };
    });
    const daily = rec.daily && typeof rec.daily === 'object' ? rec.daily : {};
    stats.daily = {};
    Object.entries(daily).forEach(([k, v]) => {
      stats.daily[k] = {
        wagered: Math.max(0, Number(v?.wagered || 0)),
        payout: Math.max(0, Number(v?.payout || 0)),
        net: Number(v?.net || (Number(v?.payout || 0) - Number(v?.wagered || 0)) || 0),
        rounds: Math.max(0, Number(v?.rounds || 0)),
        sessionsByHour: Array.from({ length: 24 }, (_, i) => Math.max(0, Number(v?.sessionsByHour?.[i] || 0)))
      };
    });
    const hours = Array.isArray(rec.sessionsByHour) ? rec.sessionsByHour : [];
    stats.sessionsByHour = Array.from({ length: 24 }, (_, i) => Math.max(0, Number(hours[i] || 0)));
    return stats;
  } catch (_) {
    return createEmptyPlayerStats();
  }
}
function savePlayerStatsForScope(scope, stats) {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYER_STATS_KEY) || '{}');
    raw[scope] = stats;
    localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(raw));
  } catch (_) {}
}
function ensurePlayerStatsReady() {
  if (!currentUser) return null;
  const scope = statsScopeKey();
  if (!playerStats || playerStatsScope !== scope) {
    playerStatsScope = scope;
    playerStats = loadPlayerStatsForScope(scope);
  }
  return playerStats;
}
function pointsNeededForRankStep(stepIdx) {
  let sum = 0;
  // Paliers volontairement plus exigeants: plus de wager pour chaque rang.
  for (let i = 0; i <= stepIdx; i++) sum += Math.round(850 * Math.pow(1.30, i));
  return sum;
}
function computeRankFromWagered(totalWagered) {
  const w = Math.max(0, Number(totalWagered || 0));
  const maxSteps = RANK_FAMILIES.length * RANK_STEPS_PER_FAMILY;
  let step = 0;
  while (step < (maxSteps - 1) && w >= pointsNeededForRankStep(step)) step += 1;
  const familyIdx = Math.min(RANK_FAMILIES.length - 1, Math.floor(step / RANK_STEPS_PER_FAMILY));
  const level = (step % RANK_STEPS_PER_FAMILY) + 1;
  const prevReq = step <= 0 ? 0 : pointsNeededForRankStep(step - 1);
  const nextReq = pointsNeededForRankStep(step);
  const progress = nextReq > prevReq ? Math.max(0, Math.min(1, (w - prevReq) / (nextReq - prevReq))) : 1;
  return {
    label: `${RANK_FAMILIES[familyIdx]} ${level}`,
    family: RANK_FAMILIES[familyIdx],
    level,
    step,
    prevReq,
    nextReq,
    progress
  };
}
function getDailyRankDropInfo() {
  const stats = ensurePlayerStatsReady();
  const rank = computeRankFromWagered(stats?.wagered || 0);
  const step = Math.max(0, Number(rank.step || 0));
  // Courbe plus exponentielle, tout en restant progressive.
  const factor = Number((0.88 * Math.pow(1.035, step)).toFixed(2));
  return {
    rankLabel: `${rank.family} ${rank.level}`,
    factor
  };
}
function getAllRankDropFactors() {
  const rows = [];
  let globalStep = 0;
  RANK_FAMILIES.forEach((fam) => {
    for (let lvl = 1; lvl <= RANK_STEPS_PER_FAMILY; lvl++) {
      const factor = Number((0.88 * Math.pow(1.035, globalStep)).toFixed(2));
      const wagerRequired = globalStep <= 0 ? 0 : pointsNeededForRankStep(globalStep - 1);
      rows.push({ rank: `${fam} ${lvl}`, factor, wagerRequired });
      globalStep += 1;
    }
  });
  return rows;
}
const WEEKLY_OBJECTIVES_KEY = 'hm_weekly_objectives_v1';
const GAME_HISTORY_MAX = 10;
const WEEKLY_OBJECTIVE_DEFS = [
  { id: 'bj5', game: 'blackjack', target: 5, title: '5 parties de Black Jack', reward: 20, desc: 'Bonus drop hebdomadaire' },
];
function getIsoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
function weeklyObjectivesStorageKey() {
  return `${WEEKLY_OBJECTIVES_KEY}:${statsScopeKey()}`;
}
function loadWeeklyObjectivesState() {
  const weekKey = getIsoWeekKey();
  try {
    const raw = JSON.parse(localStorage.getItem(weeklyObjectivesStorageKey()) || 'null');
    if (!raw || raw.weekKey !== weekKey) return { weekKey, progress: {}, claimed: {} };
    return { weekKey, progress: raw.progress || {}, claimed: raw.claimed || {} };
  } catch (_) {
    return { weekKey, progress: {}, claimed: {} };
  }
}
function saveWeeklyObjectivesState(state) {
  try { localStorage.setItem(weeklyObjectivesStorageKey(), JSON.stringify(state)); } catch (_) {}
}
function getWeeklyObjectivesView() {
  const state = loadWeeklyObjectivesState();
  return WEEKLY_OBJECTIVE_DEFS.map((def) => {
    const progress = Number(state.progress[def.id] || 0);
    const done = progress >= def.target;
    const claimed = !!state.claimed[def.id];
    return { ...def, progress, done, claimed, canClaim: done && !claimed, weekKey: state.weekKey };
  });
}
function bumpWeeklyObjectiveProgress(game) {
  const state = loadWeeklyObjectivesState();
  let changed = false;
  WEEKLY_OBJECTIVE_DEFS.forEach((def) => {
    if (def.game !== game) return;
    const cur = Number(state.progress[def.id] || 0);
    if (cur >= def.target) return;
    state.progress[def.id] = Math.min(def.target, cur + 1);
    changed = true;
  });
  if (!changed) return;
  saveWeeklyObjectivesState(state);
  renderWeeklyObjectivesPanel();
  renderWeeklyObjectivesInProfile();
}
async function claimWeeklyObjectiveBonus(objectiveId) {
  const def = WEEKLY_OBJECTIVE_DEFS.find((d) => d.id === objectiveId);
  if (!def) return;
  const state = loadWeeklyObjectivesState();
  const progress = Number(state.progress[def.id] || 0);
  if (progress < def.target || state.claimed[def.id]) {
    showToast('Objectif non terminé ou déjà récupéré', 'info', 2200);
    return;
  }
  state.claimed[def.id] = true;
  saveWeeklyObjectivesState(state);
  const reward = Number(def.reward || 0);
  if (isCloudUser()) {
    await applyBalanceDeltaCloud(reward, `weekly_objective_${def.id}`);
  } else {
    setUserBalance(getUserBalance() + reward);
    updateLobbyBalance();
  }
  renderProfileBadge({ preserveMenu: true });
  renderWeeklyObjectivesPanel();
  renderWeeklyObjectivesInProfile();
  showToast(`Bonus objectif : +${fmt(reward)}`, 'success', 2600);
}
function buildWeeklyObjectivesHtml(compact) {
  const items = getWeeklyObjectivesView();
  if (!items.length) return '';
  const rows = items.map((o) => {
    const pct = Math.min(100, Math.round((o.progress / o.target) * 100));
    const status = o.claimed ? 'Récupéré' : (o.canClaim ? 'Prêt !' : `${o.progress}/${o.target}`);
    const btn = o.canClaim
      ? `<button type="button" class="profile-mini-btn primary weekly-obj-claim" onclick="claimWeeklyObjectiveBonus('${escapeHtml(o.id)}')">+${fmt(o.reward)} bonus</button>`
      : (o.claimed ? `<span class="weekly-obj-done">✔ Bonus reçu</span>` : `<span class="weekly-obj-pending">${status}</span>`);
    return `<div class="weekly-obj-row${o.claimed ? ' is-claimed' : ''}${o.canClaim ? ' is-ready' : ''}">
      <div class="weekly-obj-head">
        <span class="weekly-obj-title">${escapeHtml(o.title)}</span>
        <span class="weekly-obj-status">${status}</span>
      </div>
      <div class="weekly-obj-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      ${compact ? '' : `<div class="weekly-obj-meta">${escapeHtml(o.desc)} · semaine ${escapeHtml(o.weekKey)}</div>`}
      ${btn}
    </div>`;
  }).join('');
  return `<div class="weekly-obj-wrap">
    <div class="drop-title">${compact ? 'Objectif hebdo' : 'Objectifs hebdo mini-jeux'}</div>
    ${rows}
  </div>`;
}
function renderWeeklyObjectivesPanel() {
  const wrap = document.getElementById('games-weekly-objectives');
  if (!wrap) return;
  wrap.innerHTML = buildWeeklyObjectivesHtml(false);
}
function renderWeeklyObjectivesInProfile() {
  const wrap = document.getElementById('profile-weekly-objectives');
  if (!wrap) return;
  wrap.innerHTML = buildWeeklyObjectivesHtml(true);
}
function renderGamesModeBanner() {
  const wrap = document.getElementById('games-mode-banner');
  if (!wrap) return;
  if (!currentUser) {
    wrap.innerHTML = '';
    return;
  }
  if (currentUser.isGuest) {
    wrap.innerHTML = `<div class="games-mode-banner-inner games-mode-guest">
      <div class="games-mode-icon" aria-hidden="true">👤</div>
      <div class="games-mode-body">
        <div class="games-mode-title">Mode invité</div>
        <div class="games-mode-text">Solde et stats stockés <strong>uniquement sur cet appareil</strong>. Pas de sync cloud, pas de classement wager, drop limité au navigateur.</div>
      </div>
      <button type="button" class="profile-mini-btn primary" onclick="showAuth()">Créer un compte cloud</button>
    </div>`;
    return;
  }
  if (currentUser.cloud) {
    const st = getCloudUiStatus();
    wrap.innerHTML = `<div class="games-mode-banner-inner games-mode-cloud">
      <div class="games-mode-icon" aria-hidden="true">☁</div>
      <div class="games-mode-body">
        <div class="games-mode-title">Mode cloud · ${escapeHtml(st.label)}</div>
        <div class="games-mode-text">Solde synchronisé Supabase, sessions enregistrées pour le classement wager, drop quotidien + streak, objectifs hebdo.</div>
      </div>
    </div>`;
    return;
  }
  wrap.innerHTML = `<div class="games-mode-banner-inner games-mode-local">
    <div class="games-mode-icon" aria-hidden="true">💾</div>
    <div class="games-mode-body">
      <div class="games-mode-title">Mode local (legacy)</div>
      <div class="games-mode-text">Compte sans cloud — solde dans le navigateur. Connecte-toi avec un compte Supabase pour la sync et les classements.</div>
    </div>
    <button type="button" class="profile-mini-btn" onclick="showAuth()">Passer au cloud</button>
  </div>`;
}

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
let v101Initialized = false;
async function initV101() {
  if (v101Initialized) return;
  v101Initialized = true;
  applyUiPrefs();
  await initAuth();
  refreshCurrencyInline();
  renderProfileBadge();
  populateBonusFilterPresetsSelect();
  const gsi = document.getElementById('global-search-input');
  if (gsi) {
    gsi.addEventListener('input', () => {
      clearTimeout(globalSearchDebounce);
      globalSearchDebounce = setTimeout(() => { runGlobalSearch().catch(() => {}); }, 160);
    });
  }
  // Routing initial : on lit l'URL et on monte la bonne page.
  // Si l'URL pointe vers /admin et que l'utilisateur n'est pas admin,
  // switchPage() rebascule automatiquement sur /home.
  const initialRaw = (typeof pathToPage === 'function') ? pathToPage(location.pathname) : 'home';
  let initial = initialRaw;
  let initialHuntTab = null;
  if (HUNT_TAB_FROM_PAGE[initialRaw]) {
    initialHuntTab = HUNT_TAB_FROM_PAGE[initialRaw];
    initial = 'hunt';
  }
  switchPage(initial, { replace: true, huntTab: initialHuntTab });
  consumeSlotPrefillFromUrl();

  await loadLazyPageScript('home').catch(() => {});
  refreshMaintenanceConfig(true).catch(() => {});
  startMaintenancePolling();
  if (typeof maybeShowOnboarding === 'function') maybeShowOnboarding();
  ensureNotifBellInHeader();
  checkInAppNotifications().catch(() => {});
  if (!window.__hmNotifPollBound) {
    window.__hmNotifPollBound = true;
    setInterval(() => { checkInAppNotifications().catch(() => {}); }, 5 * 60 * 1000);
  }

  // Back/forward navigateur
  if (!window.__bhPopStateBound) {
    window.__bhPopStateBound = true;
    window.addEventListener('popstate', (e) => {
      const page = (e.state && e.state.page) || pathToPage(location.pathname);
      const huntTab = (e.state && e.state.huntTab) || pathToHuntTab(location.pathname);
      switchPage(page, { skipHistory: true, huntTab });
    });
  }
  initPwaInstallPrompt();
}

// Le script est chargé avant une partie du HTML: on déclenche l'init v1.01
// quand tout le DOM est prêt.
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
const CATALOG_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const CATALOG_REFRESH_MIN_GAP_MS = 5 * 60 * 1000;
let lastCatalogCheckAt = Date.now();
let catalogRefreshTimer = null;

async function refreshCatalogSilently(reason = 'interval') {
  // Respect du lazy : si l'utilisateur n'a JAMAIS chargé le catalogue
  // (pas allé sur la page Hunt), on ne le fetch pas en arrière-plan.
  // Il sera fetched lors du 1er switchPage('hunt') via ensureSlotsLoaded().
  if (!Array.isArray(state.slots) || state.slots.length === 0) {
    return;
  }
  if (Date.now() - lastCatalogCheckAt < CATALOG_REFRESH_MIN_GAP_MS && reason !== 'focus-force') {
    return;
  }
  lastCatalogCheckAt = Date.now();
  try {
    const res = await fetch('jeux.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return;
    const before = state.slots.length;
    const beforeFirstId = state.slots[0]?.id;
    const afterFirstId = data[0]?.id;
    if (before === data.length && beforeFirstId === afterFirstId) {
      bhWarn(`[catalog] refresh ${reason}: aucun changement (${before} entrées)`);
      return;
    }
    bhWarn(`[catalog] refresh ${reason}: ${before} → ${data.length} entrées, re-render`);
    state.slots = data.map((s) => normalizeCatalogEntry(s));
    buildSlotCatalogIndexes(state.slots);
    state._huntWsFp = '';
    try { filterAndRender(); } catch (_) {}
  } catch (e) {
    bhWarn('[catalog] refresh failed', e?.message || e);
  }
}

function startCatalogAutoRefresh() {
  if (catalogRefreshTimer) clearInterval(catalogRefreshTimer);
  catalogRefreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      refreshCatalogSilently('interval').catch(() => {});
    }
  }, CATALOG_REFRESH_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshCatalogSilently('focus').catch(() => {});
    }
  });
  window.addEventListener('focus', () => {
    refreshCatalogSilently('focus').catch(() => {});
  });
}

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


