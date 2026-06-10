import { request } from 'undici';
import { config } from '../config.js';
import { child } from './logger.js';

const log = child({ mod: 'catalog' });

const CATALOG_URL = `${(config.site.url || 'https://hugotaslot.fr').replace(/\/+$/, '')}/jeux.json`;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25_000;
const UA = 'Mozilla/5.0 (compatible; HugoTaSlotBot/1.0; +https://hugotaslot.fr)';

let _cache = {
  ts: 0,
  knownNames: new Set(),
  /** entrées brutes de jeux.json (pour /slot, /call, etc.) */
  slots: [],
  rawCount: 0,
  loadedAt: null,
  inflight: null,
};

export function normalizeSlotKey(name) {
  return String(name || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();
}

async function fetchCatalog() {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const { statusCode, body } = await request(CATALOG_URL, {
      method: 'GET',
      headers: { 'user-agent': UA, accept: 'application/json,*/*' },
      signal: ac.signal,
    });
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`HTTP ${statusCode} sur ${CATALOG_URL}`);
    }
    const text = await body.text();
    const data = JSON.parse(text);
    const arr = Array.isArray(data) ? data : (data.slots || data.games || []);
    const set = new Set();
    for (const s of arr) {
      const name = s?.nom || s?.name || s?.title || s?.Name;
      const k = normalizeSlotKey(name);
      if (k) set.add(k);
    }
    return { knownNames: set, rawCount: arr.length, slots: arr };
  } finally {
    clearTimeout(t);
  }
}

export async function getCatalog({ force = false } = {}) {
  const now = Date.now();
  if (!force && _cache.knownNames.size && (now - _cache.ts) < REFRESH_MS) {
    return _cache;
  }
  if (_cache.inflight) return _cache.inflight;
  _cache.inflight = (async () => {
    try {
      const { knownNames, rawCount, slots } = await fetchCatalog();
      _cache = {
        ts: Date.now(),
        knownNames,
        rawCount,
        slots: Array.isArray(slots) ? slots : [],
        loadedAt: new Date().toISOString(),
        inflight: null,
      };
      log.info({ rawCount, uniques: knownNames.size }, 'Catalog jeux.json chargé');
      return _cache;
    } catch (e) {
      _cache.inflight = null;
      log.warn({ msg: e.message, code: e.code || '' }, 'Impossible de charger jeux.json — déduplication désactivée pour ce run');
      // Retourne un cache vide mais non nul pour ne pas bloquer le scraping.
      return {
        knownNames: _cache.knownNames || new Set(),
        rawCount: _cache.rawCount || 0,
        slots: Array.isArray(_cache.slots) ? _cache.slots : [],
        loadedAt: _cache.loadedAt || null,
      };
    }
  })();
  return _cache.inflight;
}

export function isKnownSlot(catalog, name) {
  if (!catalog?.knownNames?.size) return false;
  const k = normalizeSlotKey(name);
  return k ? catalog.knownNames.has(k) : false;
}

export function slotCatalogTitle(s) {
  return String(s?.nom || s?.name || s?.title || s?.Name || '').trim();
}

const IMAGE_URL_KEYS = [
  'image', 'img', 'thumbnail', 'thumbnailUrl', 'thumbnail_url', 'imageUrl', 'image_url',
  'cover', 'preview', 'icon', 'banner', 'slotImage', 'slot_image', 'artworkUrl', 'artwork',
];

/**
 * Première URL https trouvée dans l’entrée catalogue (plusieurs schémas selon la source du JSON).
 */
export function slotCatalogImageUrl(s) {
  if (!s || typeof s !== 'object') return '';
  for (const k of IMAGE_URL_KEYS) {
    const u = String(s[k] ?? '').trim();
    if (/^https?:\/\//i.test(u)) return u;
  }
  const st = s.staticData || s.static_data;
  if (st && typeof st === 'object') {
    for (const k of ['image', 'img', 'thumbnail', 'backgroundImage', 'background_image']) {
      const u = String(st[k] ?? '').trim();
      if (/^https?:\/\//i.test(u)) return u;
    }
  }
  return '';
}

/** Image embed Discord : URL catalogue ou visuel de secours (nom + provider). */
export function slotCatalogImageOrPlaceholder(s) {
  const direct = slotCatalogImageUrl(s);
  if (direct) return direct;
  const name = slotCatalogTitle(s) || 'Slot';
  const prov = String(s?.provider || s?.Provider || '').trim();
  const line = prov ? `${name.slice(0, 42)} · ${prov.slice(0, 22)}` : name.slice(0, 64);
  return `https://placehold.co/800x450/120d18/ffd700/png?font=noto-sans&text=${encodeURIComponent(line)}`;
}

const SEARCH_STOP_WORDS = new Set([
  'of', 'the', 'a', 'an', 'and', 'or', 'le', 'la', 'les', 'un', 'une', 'des', 'de', 'du', 'et', 'ou', 'sur',
]);

/** Texte normalisé pour recherche (minuscules, sans accents). */
export function normalizeSearchText(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[®™©]/g, '')
    .trim();
}

function searchTokens(query) {
  const raw = normalizeSearchText(query)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !SEARCH_STOP_WORDS.has(t));
  if (raw.length) return raw;
  return normalizeSearchText(query)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8);
}

function scoreSlotMatch(normTitle, qFull, tokens) {
  if (!normTitle || !qFull) return 0;
  if (normTitle === qFull) return 1_000_000;
  if (normTitle.includes(qFull)) return 500_000 + qFull.length * 100;
  let score = 0;
  for (const t of tokens) {
    if (normTitle.includes(t)) score += 10_000 + t.length * 50;
    else return 0;
  }
  return score + tokens.length;
}

/**
 * Recherche dans jeux.json : sous-chaîne ou tous les mots significatifs présents dans le nom.
 */
export async function searchCatalogSlots(query, { limit = 25 } = {}) {
  await getCatalog({ force: false });
  const slots = Array.isArray(_cache.slots) ? _cache.slots : [];
  const qFull = normalizeSearchText(query).replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
  const tokens = searchTokens(query);
  if (!qFull && !tokens.length) return [];

  const ranked = [];
  for (const s of slots) {
    const title = slotCatalogTitle(s);
    if (!title) continue;
    const normTitle = normalizeSearchText(title).replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ').trim();
    const sc = scoreSlotMatch(normTitle, qFull, tokens.length ? tokens : qFull.split(/\s+/).filter(Boolean));
    if (sc > 0) ranked.push({ s, sc, title });
  }
  ranked.sort((a, b) => b.sc - a.sc || a.title.localeCompare(b.title, 'fr'));
  return ranked.slice(0, limit).map((x) => x.s);
}

/** Valeur stable pour Discord autocomplete (max 100 car.). */
export function slotChoiceValue(s) {
  const id = String(s?.id || s?.Id || '').trim();
  if (id) return id.slice(0, 100);
  const title = slotCatalogTitle(s);
  const prov = String(s?.provider || s?.Provider || '').trim();
  const v = prov ? `${title}|${prov}` : title;
  return v.slice(0, 100);
}

/** Retrouve une entrée après choix autocomplete ou saisie manuelle. */
export async function resolveCatalogSlotFromQuery(raw) {
  const value = String(raw || '').trim();
  if (!value) return { slot: null, ambiguous: [] };

  await getCatalog({ force: false });
  const slots = Array.isArray(_cache.slots) ? _cache.slots : [];

  const byId = slots.find((s) => String(s.id || s.Id || '') === value);
  if (byId) return { slot: byId, ambiguous: [] };

  const pipe = value.indexOf('|');
  if (pipe > 0) {
    const t = value.slice(0, pipe).trim();
    const p = value.slice(pipe + 1).trim();
    const hit = slots.find(
      (s) => slotCatalogTitle(s) === t && String(s.provider || s.Provider || '').trim() === p,
    );
    if (hit) return { slot: hit, ambiguous: [] };
  }

  const normVal = normalizeSearchText(value);
  const exact = slots.filter((s) => normalizeSearchText(slotCatalogTitle(s)) === normVal);
  if (exact.length === 1) return { slot: exact[0], ambiguous: [] };
  if (exact.length > 1) return { slot: null, ambiguous: exact.slice(0, 15) };

  const candidates = await searchCatalogSlots(value, { limit: 15 });
  if (candidates.length === 1) return { slot: candidates[0], ambiguous: [] };
  if (candidates.length === 0) return { slot: null, ambiguous: [] };
  return { slot: null, ambiguous: candidates };
}

/** Lien jeu : Gamdom SEO ou direct `gd_*`, sinon page d’accueil du site. */
export function slotGamdomOrSiteUrl(s) {
  const base = `${(config.site.url || 'https://hugotaslot.fr').replace(/\/+$/, '')}/`;
  const u = String(s?.gamdomUrl || s?.gamdom_url || '').trim();
  if (/^https:\/\/(www\.)?gamdom\.com\//i.test(u)) return u;
  const id = String(s?.id || s?.Id || '').trim();
  if (id.startsWith('gd_')) {
    const raw = id.slice(3);
    if (raw) return `https://gamdom.com/casino/games/${encodeURIComponent(raw)}`;
  }
  if (/^https?:\/\//i.test(u)) return u;
  return base;
}

/**
 * Une entrée au hasard dans jeux.json (nom non vide). Utilise le cache de getCatalog().
 */
export async function pickRandomCatalogSlot({ force = false } = {}) {
  await getCatalog({ force });
  const slots = Array.isArray(_cache.slots) ? _cache.slots : [];
  const valid = slots.filter((s) => slotCatalogTitle(s));
  if (!valid.length) return null;
  return valid[Math.floor(Math.random() * valid.length)];
}
