import { request } from 'undici';
import { config } from '../config.js';
import { child } from './logger.js';

const log = child({ mod: 'catalog' });

const CATALOG_URL = `${(config.site.url || 'https://hugotaslot-cloud.vercel.app').replace(/\/+$/, '')}/jeux.json`;
const REFRESH_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 25_000;
const UA = 'Mozilla/5.0 (compatible; HugoTaSlotBot/1.0; +https://hugotaslot-cloud.vercel.app)';

let _cache = {
  ts: 0,
  knownNames: new Set(),
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
    return { knownNames: set, rawCount: arr.length };
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
      const { knownNames, rawCount } = await fetchCatalog();
      _cache = {
        ts: Date.now(),
        knownNames,
        rawCount,
        loadedAt: new Date().toISOString(),
        inflight: null,
      };
      log.info({ rawCount, uniques: knownNames.size }, 'Catalog jeux.json chargé');
      return _cache;
    } catch (e) {
      _cache.inflight = null;
      log.warn({ msg: e.message, code: e.code || '' }, 'Impossible de charger jeux.json — déduplication désactivée pour ce run');
      // Retourne un cache vide mais non nul pour ne pas bloquer le scraping.
      return { knownNames: _cache.knownNames || new Set(), rawCount: _cache.rawCount || 0, loadedAt: null };
    }
  })();
  return _cache.inflight;
}

export function isKnownSlot(catalog, name) {
  if (!catalog?.knownNames?.size) return false;
  const k = normalizeSlotKey(name);
  return k ? catalog.knownNames.has(k) : false;
}
