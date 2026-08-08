/**
 * Résout la liste des sports PropLine à synchroniser.
 * PROPLINE_SPORTS=all (défaut) → GET /v1/sports (tous les sports actifs).
 * PROPLINE_SPORTS=soccer_epl,tennis → liste fixe.
 */
import { config } from '../config.js';
import { fetchSports } from './propline.js';
import { child } from './logger.js';

const log = child({ mod: 'propline-sports' });

const STATIC_LABELS = {
  soccer_ligue_1: 'Ligue 1',
  soccer_epl: 'Premier League',
  soccer_la_liga: 'La Liga',
  soccer_serie_a: 'Serie A',
  soccer_bundesliga: 'Bundesliga',
  soccer_fifa_world_cup: 'Coupe du monde',
  soccer_uefa_champs_league: 'Champions League',
  soccer_mls: 'MLS',
  basketball_nba: 'NBA',
  basketball_ncaab: 'NCAAB',
  baseball_mlb: 'MLB',
  hockey_nhl: 'NHL',
  football_nfl: 'NFL',
  football_ncaaf: 'NCAAF',
  tennis: 'Tennis',
  mma_ufc: 'UFC',
  boxing: 'Boxe',
  golf: 'Golf',
};

let _cache = { keys: null, labels: new Map(), ts: 0 };

function parseEnvSports() {
  const raw = String(config.propline.sportsEnv || '').trim();
  if (!raw || raw.toLowerCase() === 'all' || raw === '*') return null;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function labelForSportKey(key, fallback) {
  return _cache.labels.get(key) || STATIC_LABELS[key] || fallback || key;
}

export async function getProplineSportKeys({ forceRefresh = false } = {}) {
  const fromEnv = parseEnvSports();
  if (fromEnv?.length) return fromEnv;

  const ttl = config.propline.sportsCacheMs;
  if (!forceRefresh && _cache.keys && Date.now() - _cache.ts < ttl) {
    return _cache.keys;
  }

  const sports = await fetchSports();
  const list = Array.isArray(sports) ? sports : [];
  const keys = [];
  for (const s of list) {
    if (!s?.key) continue;
    if (s.active === false) continue;
    keys.push(s.key);
    if (s.title) _cache.labels.set(s.key, String(s.title));
  }

  if (!keys.length) {
    log.warn('PropLine /sports vide — fallback liste statique minimale');
    return Object.keys(STATIC_LABELS);
  }

  _cache.keys = keys;
  _cache.ts = Date.now();
  log.info({ count: keys.length }, 'sports PropLine actifs');
  return keys;
}
