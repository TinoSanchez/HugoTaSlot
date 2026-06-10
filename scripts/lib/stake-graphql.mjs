/**
 * Client GraphQL Stake (schéma moderne `slugKuratorGroup`).
 *
 *   import { fetchStakeGroupGames } from './lib/stake-graphql.mjs';
 *   const nodes = await fetchStakeGroupGames({ slug: 'slots' });
 *
 * Stratégie :
 *   1. Tentative fetch natif (proxy via STAKE_PROXY / HTTPS_PROXY si défini)
 *   2. Si 403/503/Cloudflare → repli Playwright (browser réel sur la page groupe)
 *
 * Échec → throw avec message exploitable.
 */

import { Agent, ProxyAgent } from 'undici';
import { lookup as systemLookup } from 'node:dns';

export const STAKE_GQL_ENDPOINT = 'https://stake.com/_api/graphql';
const PAGE_SIZE_DEFAULT = 39;

/**
 * Résolution DNS via DoH (Cloudflare puis Google) — bypass blocage DNS FAI (ANJ en France).
 * Compatible avec la signature de dns.lookup pour undici Agent.connect.lookup.
 */
const DOH_CACHE = new Map();
const DOH_TTL_MS = 5 * 60 * 1000;
const DOH_PROVIDERS = [
  'https://cloudflare-dns.com/dns-query',
  'https://dns.google/resolve',
];

async function dohResolve(hostname) {
  for (const base of DOH_PROVIDERS) {
    try {
      const res = await fetch(`${base}?name=${encodeURIComponent(hostname)}&type=A`, {
        headers: { accept: 'application/dns-json' },
      });
      if (!res.ok) continue;
      const json = await res.json();
      const ips = (json.Answer || [])
        .filter((a) => a.type === 1 && typeof a.data === 'string')
        .map((a) => a.data);
      if (ips.length) return ips;
    } catch {
      // essai suivant
    }
  }
  return [];
}

function dohLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  const opts = options || {};
  const wantAll = !!opts.all;
  const cached = DOH_CACHE.get(hostname);
  if (cached && cached.expires > Date.now()) {
    if (wantAll) return callback(null, cached.ips.map((ip) => ({ address: ip, family: 4 })));
    return callback(null, cached.ips[0], 4);
  }
  dohResolve(hostname)
    .then((ips) => {
      if (!ips.length) return systemLookup(hostname, options, callback);
      DOH_CACHE.set(hostname, { ips, expires: Date.now() + DOH_TTL_MS });
      if (wantAll) return callback(null, ips.map((ip) => ({ address: ip, family: 4 })));
      return callback(null, ips[0], 4);
    })
    .catch(() => systemLookup(hostname, options, callback));
}

function dohEnabledByDefault() {
  if (process.env.STAKE_USE_DOH === '0' || process.env.STAKE_USE_DOH === 'false') return false;
  return true;
}

let cachedDohDispatcher;
function getDohDispatcher() {
  if (cachedDohDispatcher) return cachedDohDispatcher;
  cachedDohDispatcher = new Agent({
    connect: { lookup: dohLookup, timeout: 15000 },
    headersTimeout: 30000,
    bodyTimeout: 60000,
  });
  return cachedDohDispatcher;
}

const STAKE_QUERY_SLUG_KURATOR_GROUP = `
query SlugKuratorGroup(
  $slug: String!,
  $limit: Int!,
  $offset: Int!,
  $sort: GameKuratorGroupGameSortEnum = popular7d,
  $locale: Locale = "en"
) {
  slugKuratorGroup(slug: $slug) {
    id
    slug
    translation
    type
    gameCount(locale: $locale)
    groupGamesList(limit: $limit, offset: $offset, sort: $sort, locale: $locale) {
      id
      game {
        id
        name
        slug
        thumbnailUrl
        groupGames {
          group {
            id
            type
            slug
            translation
          }
        }
      }
    }
  }
}`.trim();

function platformUserAgent() {
  if (process.platform === 'darwin') {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  if (process.platform === 'win32') {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

function stakeProxyRaw() {
  return (
    process.env.STAKE_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    ''
  );
}

let cachedProxyDispatcher;
function getProxyDispatcher() {
  if (cachedProxyDispatcher === false) return undefined;
  if (cachedProxyDispatcher) return cachedProxyDispatcher;
  const raw = stakeProxyRaw();
  if (!raw) {
    cachedProxyDispatcher = false;
    return undefined;
  }
  const url = raw.startsWith('http') ? raw : `http://${raw}`;
  cachedProxyDispatcher = new ProxyAgent(url);
  return cachedProxyDispatcher;
}

function getFetchDispatcher() {
  const proxy = getProxyDispatcher();
  if (proxy) return proxy;
  if (dohEnabledByDefault()) return getDohDispatcher();
  return undefined;
}

function browserProxyOption() {
  const raw = stakeProxyRaw();
  if (!raw) return undefined;
  const server = raw.startsWith('http') ? raw : `http://${raw}`;
  return { server };
}

function looksLikeCloudflareHtml(text) {
  const s = String(text || '').slice(0, 1500);
  return s.includes('Just a moment') || s.includes('challenges.cloudflare.com');
}

function groupUrlForSlug(slug, locale) {
  const loc = locale && locale !== 'en' ? `/${locale}` : '';
  return `https://stake.com${loc}/casino/group/${encodeURIComponent(slug)}`;
}

function flattenNode(rawGame) {
  if (!rawGame || typeof rawGame !== 'object') return null;
  const groupGames = Array.isArray(rawGame.groupGames) ? rawGame.groupGames : [];
  const providerEntry = groupGames.find((e) => e?.group?.type === 'provider');
  return {
    id: String(rawGame.id || ''),
    name: String(rawGame.name || '').trim(),
    slug: String(rawGame.slug || '').trim(),
    thumbnailUrl: String(rawGame.thumbnailUrl || '').trim(),
    provider: String(providerEntry?.group?.slug || '').trim(),
    providerName: String(providerEntry?.group?.translation || '').trim(),
  };
}

function buildHeaders({ extra = {} } = {}) {
  return {
    'content-type': 'application/json',
    accept: 'application/graphql+json, application/json, text/plain, */*',
    'accept-language': 'en-US,en;q=0.9',
    'user-agent': platformUserAgent(),
    'x-language': 'en',
    'x-operation-name': 'SlugKuratorGroup',
    'x-operation-type': 'query',
    origin: 'https://stake.com',
    ...extra,
  };
}

class StakeGqlError extends Error {
  constructor(message, errors) {
    super(message);
    this.name = 'StakeGqlError';
    this.errors = errors || [];
  }
}

function isPaginationLimitError(errors) {
  if (!Array.isArray(errors)) return false;
  return errors.some((e) => {
    const t = String(e?.errorType || e?.message || '');
    return /numberLess|number_less_equal|outOfRange/i.test(t);
  });
}

async function fetchPageNative({ slug, limit, offset, sort, locale, referer }) {
  const body = {
    operationName: 'SlugKuratorGroup',
    query: STAKE_QUERY_SLUG_KURATOR_GROUP,
    variables: { slug, limit, offset, sort, locale },
  };
  const dispatcher = getFetchDispatcher();
  const res = await fetch(STAKE_GQL_ENDPOINT, {
    method: 'POST',
    headers: buildHeaders({ extra: { referer } }),
    body: JSON.stringify(body),
    ...(dispatcher ? { dispatcher } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint = looksLikeCloudflareHtml(text) ? ' (Cloudflare)' : '';
    throw new Error(`Stake GraphQL HTTP ${res.status}${hint}: ${text.slice(0, 400)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Réponse non-JSON Stake: ${text.slice(0, 300)}`);
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    throw new StakeGqlError(
      `Stake GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`,
      json.errors
    );
  }
  return json.data?.slugKuratorGroup ?? null;
}

async function paginateNative({ slug, sort, locale, pageSize, maxPages, onProgress }) {
  const all = [];
  const referer = groupUrlForSlug(slug, locale);
  let offset = 0;
  let total = null;
  let pages = 0;
  while (pages < maxPages) {
    pages += 1;
    let group;
    try {
      group = await fetchPageNative({ slug, limit: pageSize, offset, sort, locale, referer });
    } catch (e) {
      if (e instanceof StakeGqlError && isPaginationLimitError(e.errors) && all.length > 0) {
        console.warn(
          `Stake: limite de pagination atteinte à offset=${offset} (gameCount=${total ?? '?'}). On garde les ${all.length} jeux déjà reçus.`
        );
        break;
      }
      throw e;
    }
    if (!group) break;
    if (total === null) total = Number(group.gameCount || 0);
    const list = Array.isArray(group.groupGamesList) ? group.groupGamesList : [];
    for (const entry of list) {
      const flat = flattenNode(entry?.game);
      if (flat && flat.name) all.push(flat);
    }
    onProgress?.({ offset, fetched: all.length, total: total || null, page: pages });
    if (list.length < pageSize) break;
    if (total && offset + pageSize >= total) break;
    offset += pageSize;
    await new Promise((r) => setTimeout(r, 150));
  }
  return { nodes: all, total };
}

async function fetchPagePlaywright(page, { slug, limit, offset, sort, locale, referer }) {
  const body = {
    operationName: 'SlugKuratorGroup',
    query: STAKE_QUERY_SLUG_KURATOR_GROUP,
    variables: { slug, limit, offset, sort, locale },
  };
  const resp = await page.request.post(STAKE_GQL_ENDPOINT, {
    headers: buildHeaders({ extra: { referer } }),
    data: body,
  });
  const text = await resp.text();
  const status = resp.status();
  if (status < 200 || status >= 300) {
    const hint = looksLikeCloudflareHtml(text) ? ' (Cloudflare)' : '';
    throw new Error(`Stake GraphQL HTTP ${status}${hint}: ${text.slice(0, 500)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Réponse non-JSON Stake: ${text.slice(0, 300)}`);
  }
  if (Array.isArray(json.errors) && json.errors.length) {
    throw new Error(`Stake GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }
  return json.data?.slugKuratorGroup ?? null;
}

async function waitForCfClearance(page, maxMs = 90000) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const title = await page.title().catch(() => '');
    if (title && !title.toLowerCase().includes('just a moment')) {
      await new Promise((r) => setTimeout(r, 3000));
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

async function paginatePlaywright({ slug, sort, locale, pageSize, maxPages, onProgress }) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error(
      'Playwright introuvable. Exécute : npm install playwright && npx playwright install chromium'
    );
  }
  const forceHeadless =
    process.env.PLAYWRIGHT_HEADLESS === '1' || process.env.PLAYWRIGHT_HEADLESS === 'true';
  const headful =
    process.env.PLAYWRIGHT_HEADFUL === '1' ||
    process.env.PLAYWRIGHT_HEADFUL === 'true' ||
    (!forceHeadless && process.platform === 'win32');
  const proxy = browserProxyOption();

  const browser = await chromium.launch({
    headless: !headful,
    ...(proxy ? { proxy } : {}),
    args: [
      '--disable-blink-features=AutomationControlled',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--window-size=1366,768',
    ],
  });
  try {
    const context = await browser.newContext({
      userAgent: platformUserAgent(),
      viewport: { width: 1366, height: 768 },
      locale: locale && locale.startsWith('fr') ? 'fr-FR' : 'en-US',
      timezoneId: 'America/New_York',
    });
    const page = await context.newPage();
    const groupUrl = groupUrlForSlug(slug, locale);
    try {
      await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    } catch (e) {
      console.warn('Navigation Stake (poursuite quand même) :', e.message);
    }
    await waitForCfClearance(page);

    const all = [];
    let offset = 0;
    let total = null;
    let pages = 0;
    let paginationLimitHit = false;
    while (pages < maxPages) {
      pages += 1;
      let group;
      let attempt = 0;
      const maxAttempts = pages === 1 ? 12 : 5;
      while (attempt < maxAttempts) {
        attempt += 1;
        try {
          group = await fetchPagePlaywright(page, {
            slug,
            limit: pageSize,
            offset,
            sort,
            locale,
            referer: groupUrl,
          });
          break;
        } catch (e) {
          if (e instanceof StakeGqlError && isPaginationLimitError(e.errors) && all.length > 0) {
            console.warn(
              `Stake: limite de pagination atteinte à offset=${offset}. On garde les ${all.length} jeux déjà reçus.`
            );
            paginationLimitHit = true;
            break;
          }
          const msg = String(e?.message || '');
          const retry = /403|503|Cloudflare|Just a moment/i.test(msg);
          if (!retry || attempt === maxAttempts) throw e;
          console.warn(
            `Stake Playwright tentative ${attempt}/${maxAttempts} échouée — retry…`
          );
          await new Promise((r) => setTimeout(r, 3500));
        }
      }
      if (paginationLimitHit) break;
      if (!group) break;
      if (total === null) total = Number(group.gameCount || 0);
      const list = Array.isArray(group.groupGamesList) ? group.groupGamesList : [];
      for (const entry of list) {
        const flat = flattenNode(entry?.game);
        if (flat && flat.name) all.push(flat);
      }
      onProgress?.({ offset, fetched: all.length, total: total || null, page: pages });
      if (list.length < pageSize) break;
      if (total && offset + pageSize >= total) break;
      offset += pageSize;
      await new Promise((r) => setTimeout(r, 120));
    }
    return { nodes: all, total };
  } finally {
    await browser.close().catch(() => {});
  }
}

/**
 * Récupère tous les jeux d'un groupe Stake (slug catégorie ou provider).
 * Options :
 *   - slug      (def: 'slots')
 *   - sort      (def: 'popular7d')   — `newest`, `name_asc`, etc.
 *   - locale    (def: 'en')
 *   - pageSize  (def: 39)
 *   - maxPages  (def: 500)
 *   - forceBrowser : ignorer le fetch natif, aller direct sur Playwright
 *   - skipBrowser  : ne JAMAIS lancer Playwright (utile en CI)
 *   - onProgress(stats) : callback à chaque page
 */
export async function fetchStakeGroupGames(opts = {}) {
  const slug = String(opts.slug || 'slots').trim();
  const sort = String(opts.sort || 'popular7d').trim();
  const locale = String(opts.locale || 'en').trim();
  const pageSize = Number.isFinite(opts.pageSize) ? Math.max(1, opts.pageSize) : PAGE_SIZE_DEFAULT;
  const maxPages = Number.isFinite(opts.maxPages) ? Math.max(1, opts.maxPages) : 500;
  const forceBrowser = !!opts.forceBrowser;
  const skipBrowser = !!opts.skipBrowser;
  const onProgress = opts.onProgress;

  if (!forceBrowser) {
    try {
      return await paginateNative({ slug, sort, locale, pageSize, maxPages, onProgress });
    } catch (e) {
      const msg = String(e?.message || '');
      const cloudflare = /403|503|Cloudflare|Just a moment/i.test(msg);
      if (skipBrowser || !cloudflare) {
        throw e;
      }
      console.warn(`Stake fetch natif échoué (${msg.slice(0, 120)}) — repli Playwright.`);
    }
  }

  if (skipBrowser) {
    throw new Error('Stake bloqué (Cloudflare) et skipBrowser=true.');
  }
  return await paginatePlaywright({ slug, sort, locale, pageSize, maxPages, onProgress });
}
