const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE_URL = 'https://gamdom.com';

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function absUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}

function isSlotLike(staticData) {
  const category = String(staticData.category || '').toLowerCase();
  const filters = String(staticData.filters || '').toUpperCase();
  if (category.includes('live')) return false;
  if (filters.includes('LIVE')) return false;
  return filters.includes('SLOT') || category.includes('slot');
}

function mapGameToJeu(game) {
  const s = game?.staticData || {};
  const provider = String(s.provider_name || s.default_provider_name || s.producer_id || 'Provider inconnu').trim();
  const name = String(s.name || s.game_code || 'Slot machine').trim();
  const rtp = typeof s.rtp === 'number' ? `${(s.rtp / 100).toFixed(2)}%` : 'N/A';
  const thumb = s.url_thumb_override || s.url_thumb || '';
  const image = absUrl(thumb) || absUrl(s.url_thumbnail_v4 || '');
  const gameCode = String(s.game_code || '').trim();
  return {
    id: `gd_${String(gameCode || `${provider}_${name}`.toLowerCase()).replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}`,
    nom: name,
    provider,
    rtp,
    image,
    gamdomUrl: `https://gamdom.com/casino/games/${encodeURIComponent(gameCode || name.toLowerCase().replace(/\s+/g, '-'))}`,
    devise: { active: 'USD', symbole: '$' }
  };
}

async function postJson(request, pathName, body, attempt = 1) {
  const options = { method: 'POST', headers: {} };
  if (body !== undefined) {
    options.headers['content-type'] = 'application/json';
    options.data = body;
  }
  const res = await request.fetch(`${BASE_URL}${pathName}`, options);
  const txt = await res.text();
  let data = null;
  try { data = JSON.parse(txt); } catch {}

  const isRateLimit = txt.includes('specific:rateLimit') || res.status() === 429 || res.status() === 503;
  if (isRateLimit && attempt <= 10) {
    await sleep(700 * attempt);
    return postJson(request, pathName, body, attempt + 1);
  }
  if (!res.ok()) throw new Error(`HTTP ${res.status()} ${pathName}: ${txt.slice(0, 200)}`);
  return data;
}

async function fetchGlobalSlots(request) {
  const all = [];
  let page = 1;
  const maxPages = 260;
  while (page <= maxPages) {
    const payload = { config: [{ sectionType: 'all', limit: 100, page, filters: ['SLOT'], ignoreCountrySupport: true }] };
    const data = await postJson(request, '/client-api/casino/games-list', payload);
    const list = data?.games?.[0]?.gamesList || [];
    if (!Array.isArray(list) || !list.length) break;
    all.push(...list);
    page += 1;
    await sleep(120);
  }
  return all;
}

async function fetchProviderGames(request, providerName) {
  const all = [];
  const seen = new Set();
  for (let page = 1; page <= 6; page += 1) {
    const payload = { config: [{ sectionType: 'all', providerName, page, filters: ['SLOT'], ignoreCountrySupport: true }] };
    const data = await postJson(request, '/client-api/casino/games-list', payload);
    const list = data?.games?.[0]?.gamesList || [];
    if (!Array.isArray(list) || !list.length) continue;
    for (const g of list) {
      const code = String(g?.staticData?.game_code || '').toLowerCase();
      if (!code || seen.has(code)) continue;
      seen.add(code);
      all.push(g);
    }
    await sleep(120);
  }
  return all;
}

async function main() {
  const userDataDir = path.join(process.cwd(), '.playwright-gamdom-profile');
  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    viewport: { width: 1400, height: 900 }
  });
  const page = context.pages()[0] || await context.newPage();

  console.log('Ouverture Gamdom... connecte-toi si necessaire.');
  await page.goto(`${BASE_URL}/casino`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  console.log('Attente de session utilisateur (60s)...');
  await page.waitForTimeout(60000);

  const request = context.request;
  const providers = await postJson(request, '/client-api/casino/providers-list', undefined);
  const providerNames = (Array.isArray(providers) ? providers : [])
    .map((p) => String(p.provider_name || '').trim())
    .filter(Boolean);

  const global = await fetchGlobalSlots(request);
  console.log('Global recupere:', global.length);

  const merged = [...global];
  for (let i = 0; i < providerNames.length; i += 1) {
    const p = providerNames[i];
    console.log(`[${i + 1}/${providerNames.length}] ${p}`);
    const g = await fetchProviderGames(request, p);
    merged.push(...g);
  }

  const uniq = new Map();
  for (const game of merged) {
    const s = game?.staticData || {};
    if (!isSlotLike(s)) continue;
    const item = mapGameToJeu(game);
    if (!item.image) continue;
    const key = [
      String(s.game_code || '').toLowerCase().trim(),
      String(s.game_id ?? ''),
      String(s.provider_id || '').toLowerCase().trim(),
      String(s.imported_from || '').toLowerCase().trim(),
      String(item.provider || '').toLowerCase().trim(),
      String(item.nom || '').toLowerCase().trim()
    ].join('__');
    if (!uniq.has(key)) uniq.set(key, item);
  }

  const items = Array.from(uniq.values()).sort((a, b) => a.nom.localeCompare(b.nom));
  fs.writeFileSync('jeux.json', JSON.stringify(items));
  console.log(`jeux.json regenere via session: ${items.length} entrees`);

  await context.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
