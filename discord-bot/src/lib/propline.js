/**
 * Client léger pour l'API PropLine (paris sportifs — cotes réelles).
 * Docs : https://prop-line.com/docs
 *
 * Endpoints utilisés :
 *   GET /v1/sports                                    → liste des sports actifs
 *   GET /v1/sports/{sport_key}/odds?markets=...       → cotes par event/marché
 *   GET /v1/sports/{sport_key}/scores?daysFrom=N      → résultats (règlement)
 *
 * Réponse `odds` (format compatible The Odds API) :
 *   [
 *     {
 *       "id": "abc123",                       // event_id PropLine
 *       "sport_key": "soccer_ligue_1",
 *       "sport_title": "Ligue 1",
 *       "commence_time": "2026-07-15T19:00:00Z",
 *       "home_team": "Paris Saint-Germain",
 *       "away_team": "Olympique de Marseille",
 *       "bookmakers": [
 *         {
 *           "key": "pinnacle",
 *           "title": "Pinnacle",
 *           "markets": [
 *             { "key": "h2h", "outcomes": [{"name":"Paris Saint-Germain","price":1.85}, ...] },
 *             { "key": "totals", "outcomes": [{"name":"Over","price":1.95,"point":2.5}, ...] }
 *           ]
 *         }
 *       ]
 *     }
 *   ]
 */
import { request } from 'undici';
import { config } from '../config.js';
import { child } from './logger.js';
import { canUsePropline, ingestProplineHeaders, markQuotaExceeded } from './propline-quota.js';

const log = child({ mod: 'propline' });

function assertKey() {
  if (!config.propline.apiKey) {
    throw new Error('PROPLINE_API_KEY manquant — configure la clé sur Railway.');
  }
}

async function proplineFetch(path, { query = {}, timeoutMs = 15000, skipQuotaCheck = false } = {}) {
  assertKey();
  if (!skipQuotaCheck && !canUsePropline(1)) {
    const err = new Error('propline_quota_paused');
    err.status = 429;
    throw err;
  }
  const url = new URL(config.propline.baseUrl.replace(/\/$/, '') + path);
  url.searchParams.set('apiKey', config.propline.apiKey);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const controller = new AbortController();
  const to = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const { statusCode, body, headers } = await request(url, {
      method: 'GET',
      headers: { accept: 'application/json', 'user-agent': 'hugotaslot-bot/1.0' },
      signal: controller.signal,
    });
    const raw = await body.text();
    ingestProplineHeaders(headers);
    if (statusCode >= 400) {
      if (statusCode === 429 || raw.includes('daily_limit')) markQuotaExceeded();
      log.warn({ status: statusCode, url: url.pathname, body: raw.slice(0, 400) }, 'PropLine HTTP error');
      const err = new Error(`propline_http_${statusCode}`);
      err.status = statusCode;
      err.body = raw;
      throw err;
    }
    const remain = headers?.['x-requests-remaining'];
    const used = headers?.['x-requests-used'];
    if (remain || used) log.debug({ remain, used, path }, 'PropLine quota');
    return raw ? JSON.parse(raw) : null;
  } finally {
    clearTimeout(to);
  }
}

export async function fetchSports() {
  return proplineFetch('/sports');
}

export async function fetchOdds(sportKey, { markets, bookmakers, oddsFormat = 'decimal' } = {}) {
  return proplineFetch(`/sports/${encodeURIComponent(sportKey)}/odds`, {
    query: {
      markets: (markets || []).join(','),
      bookmakers: (bookmakers || []).join(','),
      oddsFormat,
      dateFormat: 'iso',
    },
  });
}

export async function fetchScores(sportKey, { daysFrom = 3 } = {}) {
  return proplineFetch(`/sports/${encodeURIComponent(sportKey)}/scores`, {
    query: { days_from: daysFrom },
  });
}
