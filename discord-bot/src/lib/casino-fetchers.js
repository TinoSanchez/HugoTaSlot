/**
 * Fetchers de « nouveautés slots ».
 * En production, seul **fetchSlotcatalogNewReleases** est fiable : il couvre le même
 * univers de jeux neufs que sur Stake, Gamdom, Shuffle, Celsius (sorties studio),
 * sans devoir scraper chaque site (Cloudflare + SPA).
 * Les fetchers stake/gamdom/shuffle/celsius restent en code pour expérimentation.
 */
import { request } from 'undici';
import { child } from './logger.js';

const log = child({ mod: 'casino' });

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

const COMMON_TIMEOUT_MS = 20_000;

async function httpGet(url, { headers = {}, timeoutMs = COMMON_TIMEOUT_MS } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const { statusCode, body, headers: respHeaders } = await request(url, {
      method: 'GET',
      headers: {
        'user-agent': BROWSER_UA,
        'accept-language': 'en-US,en;q=0.9,fr;q=0.8',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.9,image/avif,image/webp,*/*;q=0.8',
        // NOTE: pas de 'accept-encoding' — undici ne décompresse pas auto, on prend le texte brut.
        'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
        'sec-ch-ua-mobile': '?0',
        'sec-ch-ua-platform': '"Windows"',
        'sec-fetch-dest': 'document',
        'sec-fetch-mode': 'navigate',
        'sec-fetch-site': 'none',
        'sec-fetch-user': '?1',
        'upgrade-insecure-requests': '1',
        'cache-control': 'no-cache',
        pragma: 'no-cache',
        ...headers,
      },
      signal: ac.signal,
    });
    return { statusCode, body, respHeaders };
  } finally {
    clearTimeout(t);
  }
}

async function httpPostJson(url, payload, { headers = {}, timeoutMs = COMMON_TIMEOUT_MS } = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const { statusCode, body, respHeaders } = await request(url, {
      method: 'POST',
      headers: {
        'user-agent': BROWSER_UA,
        'content-type': 'application/json',
        accept: 'application/json,*/*',
        ...headers,
      },
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    return { statusCode, body, respHeaders };
  } finally {
    clearTimeout(t);
  }
}

function shortErr(e) {
  return `${e?.code ? `[${e.code}] ` : ''}${e?.message || String(e)}`.slice(0, 220);
}

/* ─── STAKE ──────────────────────────────────────────────────────────────
 * Endpoint REST documenté : /api/v1/casino/games?categorySlug=new-releases
 * Cloudflare possible — on essaie aussi un fallback GraphQL.
 * ────────────────────────────────────────────────────────────────────── */
const STAKE_REST = 'https://stake.com/api/v1/casino/games?categorySlug=new-releases&limit=80';
const STAKE_GRAPHQL = 'https://stake.com/_api/graphql';

const STAKE_QUERY = `
query CasinoGames($categorySlug: String, $first: Int) {
  casinoGames(categorySlug: $categorySlug, first: $first) {
    edges {
      node {
        id
        name
        slug
        thumbnailUrl
        provider { name slug }
      }
    }
  }
}`.trim();

export async function fetchStakeNewReleases() {
  // Essai REST
  try {
    const { statusCode, body } = await httpGet(STAKE_REST, {
      headers: { 'x-language': 'en', referer: 'https://stake.com/casino/group/new-releases' },
    });
    if (statusCode >= 200 && statusCode < 300) {
      const data = await body.json().catch(() => null);
      const list = data?.data?.games || data?.games || data?.data || [];
      const out = (Array.isArray(list) ? list : []).map((g) => ({
        name: g.name || g.title,
        provider: g.provider?.name || g.provider || '',
        image: g.thumbnailUrl || g.thumbnail || g.image || '',
        url: g.slug ? `https://stake.com/casino/games/${g.slug}` : '',
      })).filter((g) => g.name);
      if (out.length) return out;
    } else {
      log.warn({ casino: 'stake', via: 'rest', http: statusCode }, 'Stake REST non OK');
    }
  } catch (e) {
    log.warn({ casino: 'stake', via: 'rest', err: shortErr(e) }, 'Stake REST failed');
  }

  // Fallback GraphQL
  try {
    const { statusCode, body } = await httpPostJson(STAKE_GRAPHQL, {
      query: STAKE_QUERY,
      variables: { categorySlug: 'new-releases', first: 80 },
      operationName: 'CasinoGames',
    }, {
      headers: { referer: 'https://stake.com/casino/group/new-releases', 'x-language': 'en' },
    });
    if (statusCode < 200 || statusCode >= 300) {
      log.warn({ casino: 'stake', via: 'graphql', http: statusCode }, 'Stake GraphQL non OK');
      return [];
    }
    const data = await body.json().catch(() => null);
    const edges = data?.data?.casinoGames?.edges || [];
    return edges.map((e) => {
      const g = e?.node || {};
      return {
        name: g.name,
        provider: g.provider?.name || '',
        image: g.thumbnailUrl || '',
        url: g.slug ? `https://stake.com/casino/games/${g.slug}` : '',
      };
    }).filter((g) => g.name);
  } catch (e) {
    log.warn({ casino: 'stake', via: 'graphql', err: shortErr(e) }, 'Stake GraphQL failed');
    return [];
  }
}

/* ─── GAMDOM ─────────────────────────────────────────────────────────────
 * Endpoint client : /client-api/casino/games-list (filtre New Games)
 * On essaie 2 chemins connus, plus un fallback HTML.
 * ────────────────────────────────────────────────────────────────────── */
const GAMDOM_LISTS = [
  'https://gamdom.com/client-api/casino/games-list?category=new-games&limit=120',
  'https://gamdom.com/client-api/casino/games-list?categorySlug=new-games&limit=120',
  'https://gamdom.com/api/games?category=new-games&limit=120',
];

export async function fetchGamdomNewReleases() {
  for (const url of GAMDOM_LISTS) {
    try {
      const { statusCode, body } = await httpGet(url, {
        headers: { referer: 'https://gamdom.com/fr-fr/casino', accept: 'application/json,*/*' },
      });
      if (statusCode < 200 || statusCode >= 300) continue;
      const data = await body.json().catch(() => null);
      const list =
        data?.games || data?.data?.games || data?.data || data?.results || data?.items || [];
      const out = (Array.isArray(list) ? list : []).map((g) => {
        const name = g.name || g.title || g.gameName;
        const provider = g.provider?.name || g.provider || g.studio || g.providerName || '';
        const slug = g.slug || g.urlSlug || g.gameSlug || '';
        const image = g.image || g.thumbnail || g.picture || g.imageUrl || '';
        const url2 = slug
          ? `https://gamdom.com/fr-fr/casino/${slug}`
          : g.url || '';
        return { name, provider, image, url: url2 };
      }).filter((g) => g.name);
      if (out.length) return out;
    } catch (e) {
      log.warn({ casino: 'gamdom', url, err: shortErr(e) }, 'Gamdom endpoint failed');
    }
  }
  return [];
}

/* ─── SHUFFLE ────────────────────────────────────────────────────────────
 * Pas d'API publique évidente. On scrape la page latest-releases
 * en cherchant le JSON inline (Next.js __NEXT_DATA__) ou les meta-tags.
 * ────────────────────────────────────────────────────────────────────── */
const SHUFFLE_URL = 'https://shuffle.com/casino/categories/latest-releases';

function extractGamesFromNextData(html) {
  const m = html.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/);
  if (!m) return [];
  try {
    const json = JSON.parse(m[1]);
    const found = [];
    const walk = (obj, depth = 0) => {
      if (!obj || depth > 8) return;
      if (Array.isArray(obj)) {
        for (const v of obj) walk(v, depth + 1);
        return;
      }
      if (typeof obj === 'object') {
        if (obj.name && (obj.slug || obj.gameSlug) && (obj.provider || obj.providerName || obj.providerSlug)) {
          found.push({
            name: obj.name,
            provider: typeof obj.provider === 'object' ? (obj.provider.name || '') : (obj.provider || obj.providerName || ''),
            image: obj.imageUrl || obj.image || obj.thumbnail || '',
            slug: obj.slug || obj.gameSlug || '',
          });
        }
        for (const k of Object.keys(obj)) walk(obj[k], depth + 1);
      }
    };
    walk(json);
    return found.map((g) => ({
      name: g.name,
      provider: g.provider,
      image: g.image,
      url: g.slug ? `https://shuffle.com/casino/games/${g.slug}` : '',
    }));
  } catch (_) {
    return [];
  }
}

export async function fetchShuffleNewReleases() {
  try {
    const { statusCode, body } = await httpGet(SHUFFLE_URL, {
      headers: { referer: 'https://shuffle.com/' },
    });
    if (statusCode < 200 || statusCode >= 300) {
      log.warn({ casino: 'shuffle', http: statusCode }, 'Shuffle HTML non OK');
      return [];
    }
    const html = await body.text();
    const games = extractGamesFromNextData(html);
    if (games.length) return games;
    log.info({ casino: 'shuffle' }, 'Shuffle: pas de jeux extraits du HTML (page probablement client-side)');
    return [];
  } catch (e) {
    log.warn({ casino: 'shuffle', err: shortErr(e) }, 'Shuffle failed');
    return [];
  }
}

/* ─── CELSIUS ────────────────────────────────────────────────────────────
 * Celsius.casino : on tente une URL d'API SoftSwiss/Hub88 standard, puis
 * fallback HTML.
 * ────────────────────────────────────────────────────────────────────── */
const CELSIUS_URLS = [
  'https://celsius.casino/api/v1/games?category=new&limit=120',
  'https://celsius.casino/api/games?category=new&limit=120',
];

const CELSIUS_HTML = 'https://celsius.casino/casino/category/new-releases';

export async function fetchCelsiusNewReleases() {
  for (const url of CELSIUS_URLS) {
    try {
      const { statusCode, body } = await httpGet(url, {
        headers: { referer: 'https://celsius.casino/casino', accept: 'application/json,*/*' },
      });
      if (statusCode < 200 || statusCode >= 300) continue;
      const data = await body.json().catch(() => null);
      const list = data?.data || data?.games || data?.items || data?.results || [];
      const out = (Array.isArray(list) ? list : []).map((g) => ({
        name: g.name || g.title,
        provider: g.provider?.name || g.provider || g.producer || '',
        image: g.image || g.thumbnail || g.icon || '',
        url: g.slug ? `https://celsius.casino/casino/play/${g.slug}` : (g.url || ''),
      })).filter((g) => g.name);
      if (out.length) return out;
    } catch (e) {
      log.warn({ casino: 'celsius', url, err: shortErr(e) }, 'Celsius endpoint failed');
    }
  }
  // Fallback HTML (Next.js inline JSON)
  try {
    const { statusCode, body } = await httpGet(CELSIUS_HTML, {});
    if (statusCode < 200 || statusCode >= 300) return [];
    const html = await body.text();
    const games = extractGamesFromNextData(html);
    return games;
  } catch (e) {
    log.warn({ casino: 'celsius', err: shortErr(e) }, 'Celsius HTML failed');
    return [];
  }
}

/* ─── SLOTCATALOG via Jina Reader (engine browser) ────────────────────────
 * SlotCatalog est protégé par Cloudflare (HTTP 403 en direct).
 * On passe par https://r.jina.ai/<URL> avec `x-engine: browser` pour exécuter
 * le JS et récupérer les game tiles rendues en Markdown.
 *
 * Format attendu (une "tile" = 3 lignes consécutives) :
 *   [![Image N: NAME slot](IMG_URL) ![Image N+1](BRAND_LOGO) ### NAME](https://slotcatalog.com/en/slots/SLUG)
 *   Provider: [PROVIDER_NAME](https://slotcatalog.com/en/soft/SLUG)
 *   Release Date: YYYY-MM-DD
 * ────────────────────────────────────────────────────────────────────── */
const SLOTCATALOG_VIA_JINA = 'https://r.jina.ai/https://slotcatalog.com/en/New-Slots';
const SLOTCATALOG_DAYS = 21;

export async function fetchSlotcatalogNewReleases() {
  let md;
  try {
    const { statusCode, body } = await httpGet(SLOTCATALOG_VIA_JINA, {
      headers: {
        accept: 'text/plain, text/markdown, */*',
        'x-engine': 'browser',
        'x-respond-with': 'markdown',
      },
      timeoutMs: 60_000,
    });
    if (statusCode < 200 || statusCode >= 300) {
      log.warn({ casino: 'slotcatalog', http: statusCode }, 'SlotCatalog (Jina) non OK');
      return [];
    }
    md = await body.text();
  } catch (e) {
    log.warn({ casino: 'slotcatalog', err: shortErr(e) }, 'SlotCatalog (Jina) fetch failed');
    return [];
  }

  const out = [];
  const seen = new Set();
  const cutoff = Date.now() - SLOTCATALOG_DAYS * 24 * 3600 * 1000;

  // Pattern principal : ligne complète d'une tile.
  // Capture : 1=image_url, 2=name, 3=slug
  const tileRe = /\[!\[Image\s+\d+:\s*([^\]]+?)\s*slot\]\((https?:\/\/[^)]+?)\)\s+!\[Image\s+\d+\]\([^)]+\)\s+###\s+([^\]\n]+?)\]\(https:\/\/slotcatalog\.com\/en\/slots\/([a-z0-9-]+)\)/gi;

  let m;
  while ((m = tileRe.exec(md))) {
    const altName = m[1].replace(/\s+/g, ' ').trim();
    const image = m[2];
    const titleName = m[3].replace(/\s+/g, ' ').trim();
    const slug = m[4];
    const name = titleName || altName;

    if (!name || seen.has(slug)) continue;
    seen.add(slug);
    if (/play demo|read review|gamble aware/i.test(name)) continue;

    // Cherche provider + date dans les ~800 chars qui suivent
    const tail = md.slice(m.index + m[0].length, m.index + m[0].length + 1200);
    let provider = '';
    const provM = tail.match(/Provider:\s*\[([^\]]+)\]/i);
    if (provM) provider = provM[1].trim();

    let publishedAt = null;
    const dateM = tail.match(/Release Date:\s*([0-9]{4}-[0-9]{2}-[0-9]{2})/i);
    if (dateM) {
      const t = Date.parse(dateM[1]);
      if (!Number.isNaN(t)) publishedAt = new Date(t).toISOString();
    }
    if (publishedAt && Date.parse(publishedAt) < cutoff) continue;

    out.push({
      name,
      provider,
      image,
      url: `https://slotcatalog.com/en/slots/${slug}`,
      publishedAt,
    });
  }
  log.info({ casino: 'slotcatalog', total: out.length }, 'SlotCatalog parsé (via Jina browser)');
  return out;
}

/* ─── REGISTRE PUBLIC ────────────────────────────────────────────────── */
export const casinoFetchers = {
  slotcatalog: fetchSlotcatalogNewReleases,
  stake: fetchStakeNewReleases,
  gamdom: fetchGamdomNewReleases,
  shuffle: fetchShuffleNewReleases,
  celsius: fetchCelsiusNewReleases,
};

export const casinoLabels = {
  slotcatalog: 'SlotCatalog',
  stake: 'Stake',
  gamdom: 'Gamdom',
  shuffle: 'Shuffle',
  celsius: 'Celsius',
};
