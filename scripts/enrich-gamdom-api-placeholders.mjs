/**
 * Complète les placeholders via l’API publique Gamdom (client-api/casino/games-list).
 * Usage : node scripts/enrich-gamdom-api-placeholders.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isPlaceholderImage,
  enrichFromFuzzyCatalogMatch,
  enrichFromLooseNameMatches,
} from './lib/enrich-slot-images.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JEUX_PATH = resolve(ROOT, 'jeux.json');
const BASE_URL = 'https://gamdom.com';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function absUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}

function norm(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function isGenericImage(url) {
  const u = String(url || '');
  return (
    u.includes('placehold.co') ||
    u.includes('/static/dyn/cdn_images/') ||
    u.includes('og_gamdom')
  );
}

async function postJson(path, body, attempt = 1) {
  const opts = { method: 'POST', headers: {} };
  if (body !== undefined) {
    opts.headers['content-type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let data = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  const isRateLimit =
    typeof text === 'string' && text.includes('specific:rateLimit');
  if ((isRateLimit || res.status === 429 || res.status === 503) && attempt <= 8) {
    await sleep(700 * attempt);
    return postJson(path, body, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${path}`);
  return data;
}

function mapGameThumb(game) {
  const s = game?.staticData || {};
  const name = String(s.name || s.game_code || '').trim();
  const provider = String(
    s.provider_name || s.default_provider_name || ''
  ).trim();
  const thumb = s.url_thumb_override || s.url_thumb || s.url_thumbnail_v4 || '';
  const image = absUrl(thumb);
  if (!name || !image || isGenericImage(image)) return null;
  return { name, provider, image, pairKey: `${norm(provider)}__${norm(name)}` };
}

async function fetchProviderGames(providerName) {
  const all = [];
  let page = 1;
  let totalCount = 0;
  let emptyStreak = 0;
  while (page <= 30) {
    const payload = {
      config: [
        {
          sectionType: 'all',
          providerName,
          page,
          filters: ['SLOT'],
          ignoreCountrySupport: true,
        },
      ],
    };
    const data = await postJson('/client-api/casino/games-list', payload);
    const block = data?.games?.[0];
    const list = Array.isArray(block?.gamesList) ? block.gamesList : [];
    totalCount = Number(block?.totalCount || totalCount || 0);
    if (!list.length) {
      emptyStreak += 1;
      if (emptyStreak >= 2) break;
    } else {
      emptyStreak = 0;
      all.push(...list);
    }
    if (totalCount && all.length >= totalCount) break;
    page += 1;
    await sleep(100);
  }
  return all;
}

async function fetchGlobalSlots(maxPages = 80) {
  const all = [];
  let page = 1;
  let totalCount = 0;
  while (page <= maxPages) {
    const payload = {
      config: [
        {
          sectionType: 'all',
          limit: 100,
          page,
          filters: ['SLOT'],
          ignoreCountrySupport: true,
        },
      ],
    };
    const data = await postJson('/client-api/casino/games-list', payload);
    const block = data?.games?.[0];
    const list = Array.isArray(block?.gamesList) ? block.gamesList : [];
    totalCount = Number(block?.totalCount || totalCount || 0);
    if (!list.length) break;
    all.push(...list);
    if (totalCount && all.length >= totalCount) break;
    page += 1;
    await sleep(100);
  }
  return all;
}

function resolveGamdomProviderName(catalogProvider, apiProviderNames) {
  const pk = norm(catalogProvider);
  if (!pk) return '';
  const exact = apiProviderNames.find((n) => norm(n) === pk);
  if (exact) return exact;
  const incl = apiProviderNames.find(
    (n) => norm(n).includes(pk) || pk.includes(norm(n))
  );
  return incl || catalogProvider;
}

async function main() {
  const entries = JSON.parse(readFileSync(JEUX_PATH, 'utf8'));
  const placeholders = entries.filter((e) => isPlaceholderImage(e.image));
  if (!placeholders.length) {
    console.log('Aucun placeholder.');
    return;
  }

  const providersNeeded = [
    ...new Set(placeholders.map((e) => String(e.provider || '').trim()).filter(Boolean)),
  ];
  console.log(
    `Placeholders: ${placeholders.length} — providers à interroger: ${providersNeeded.length}`
  );

  const providersApi = await postJson('/client-api/casino/providers-list', undefined);
  const apiProviderNames = (Array.isArray(providersApi) ? providersApi : [])
    .map((p) => String(p.provider_name || '').trim())
    .filter(Boolean);
  /** @type {Map<string, string>} */
  const providerThumbByNorm = new Map(
    (Array.isArray(providersApi) ? providersApi : []).map((p) => [
      norm(p.provider_name),
      absUrl(p.provider_url_thumb || ''),
    ])
  );

  /** @type {Map<string, string>} */
  const imageByPair = new Map();
  /** @type {Map<string, string>} */
  const imageByNormName = new Map();

  const ingestGames = (games) => {
    for (const g of games) {
      const m = mapGameThumb(g);
      if (!m) continue;
      imageByPair.set(m.pairKey, m.image);
      if (!imageByNormName.has(norm(m.name))) {
        imageByNormName.set(norm(m.name), m.image);
      }
    }
  };

  console.log('Scan global Gamdom (slots)…');
  try {
    const global = await fetchGlobalSlots(100);
    ingestGames(global);
    console.log(`  → ${global.length} jeux indexés, ${imageByPair.size} paires`);
  } catch (e) {
    console.warn('  global:', e.message);
  }

  for (let i = 0; i < providersNeeded.length; i++) {
    const providerName = resolveGamdomProviderName(
      providersNeeded[i],
      apiProviderNames
    );
    process.stdout.write(`[${i + 1}/${providersNeeded.length}] ${providerName}… `);
    try {
      const games = await fetchProviderGames(providerName);
      let n = 0;
      for (const g of games) {
        const m = mapGameThumb(g);
        if (!m) continue;
        imageByPair.set(m.pairKey, m.image);
        if (!imageByNormName.has(norm(m.name))) {
          imageByNormName.set(norm(m.name), m.image);
        }
        n++;
      }
      console.log(`${games.length} jeux, ${n} vignettes`);
    } catch (e) {
      console.log(`erreur: ${e.message}`);
    }
    await sleep(150);
  }

  let direct = 0;
  let byName = 0;
  let providerThumb = 0;
  for (const e of entries) {
    if (!isPlaceholderImage(e.image)) continue;
    const pair = `${norm(e.provider)}__${norm(e.nom || e.name || '')}`;
    const exact = imageByPair.get(pair);
    if (exact) {
      e.image = exact;
      direct++;
      continue;
    }
    const byN = imageByNormName.get(norm(e.nom || e.name || ''));
    if (byN) {
      e.image = byN;
      byName++;
      continue;
    }
    const resolved = resolveGamdomProviderName(
      e.provider || '',
      apiProviderNames
    );
    const thumb =
      providerThumbByNorm.get(norm(resolved)) ||
      providerThumbByNorm.get(norm(e.provider));
    if (thumb && !isGenericImage(thumb)) {
      e.image = thumb;
      providerThumb++;
    }
  }

  const fuzzy = enrichFromFuzzyCatalogMatch(entries);
  const loose = enrichFromLooseNameMatches(entries);

  writeFileSync(JEUX_PATH, JSON.stringify(entries), 'utf8');
  const left = entries.filter((e) => isPlaceholderImage(e.image)).length;
  console.log('Résultat:', {
    direct,
    byName,
    providerThumb,
    fuzzy,
    loose,
    placeholdersRestants: left,
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
