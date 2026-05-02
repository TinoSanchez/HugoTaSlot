/**
 * Synchronise le catalogue Stake (GraphQL categorySlug=slots) dans jeux.json.
 * Stratégie en 2 temps :
 *   1) fetch() Node (rapide)
 *   2) si échec → Playwright Chromium : navigation stake.com puis requêtes GraphQL
 *      avec le même jar de cookies (contourne Cloudflare / ANJ côté TLS « navigateur »).
 *
 * Usage :
 *   npm run sync:stake
 *   node scripts/sync-stake-catalog.mjs --dry-run
 *   FORCE_PLAYWRIGHT=1 npm run sync:stake   # sauter le fetch Node
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JEUX_PATH = resolve(ROOT, 'jeux.json');

const STAKE_GQL = 'https://stake.com/_api/graphql';
const PAGE_SIZE = 50;

// Aligné sur le schéma actuel (voir StakeAPI GraphQLQueries.CASINO_GAMES) : champ image = `thumb`, pas `thumbnailUrl`.
const QUERY = `
query CasinoGames($first: Int, $after: String, $categorySlug: String) {
  casinoGames(first: $first, after: $after, categorySlug: $categorySlug) {
    edges {
      node {
        id
        name
        slug
        thumb
        provider { name }
      }
    }
    pageInfo {
      hasNextPage
      endCursor
    }
  }
}`.trim();

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''′`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeKey(nom, prov) {
  return `${norm(nom)}|${norm(prov)}`;
}

function parseArgs() {
  return process.argv.includes('--dry-run');
}

async function fetchPageNative(after) {
  const body = {
    query: QUERY,
    variables: {
      categorySlug: 'slots',
      first: PAGE_SIZE,
      after: after || null,
    },
    operationName: 'CasinoGames',
  };
  const res = await fetch(STAKE_GQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': BROWSER_UA,
      'x-language': 'en',
      referer: 'https://stake.com/casino/group/slots',
      origin: 'https://stake.com',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Stake GraphQL HTTP ${res.status} : ${text.slice(0, 400)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Réponse non-JSON : ${text.slice(0, 300)}`);
  }
  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }
  return json.data;
}

async function fetchAllStakeSlotsNative() {
  const all = [];
  let after = null;
  let pages = 0;
  const maxPages = 500;
  for (;;) {
    pages += 1;
    if (pages > maxPages) throw new Error('Trop de pages (limite sécurité).');
    const data = await fetchPageNative(after);
    const conn = data?.casinoGames;
    const edges = conn?.edges || [];
    for (const e of edges) {
      const n = e?.node;
      if (n) all.push(n);
    }
    const pi = conn?.pageInfo;
    if (!pi?.hasNextPage) break;
    after = pi.endCursor || null;
    if (!after) break;
    await new Promise((r) => setTimeout(r, 150));
  }
  return all;
}

async function fetchPagePlaywright(page, after) {
  const resp = await page.request.post(STAKE_GQL, {
    data: {
      query: QUERY,
      variables: {
        categorySlug: 'slots',
        first: PAGE_SIZE,
        after: after || null,
      },
      operationName: 'CasinoGames',
    },
    headers: {
      'content-type': 'application/json',
      'x-language': 'en',
      referer: 'https://stake.com/casino/group/slots',
      origin: 'https://stake.com',
    },
  });
  const text = await resp.text();
  const status = resp.status();
  if (status < 200 || status >= 300) {
    throw new Error(`Stake GraphQL HTTP ${status} : ${text.slice(0, 500)}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Réponse non-JSON : ${text.slice(0, 300)}`);
  }
  if (json.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 800)}`);
  }
  return json.data;
}

async function fetchAllStakeSlotsPlaywright() {
  let browser;
  try {
    let chromium;
    try {
      ({ chromium } = await import('playwright'));
    } catch (e) {
      throw new Error(
        'Playwright introuvable. Exécute : npm install playwright && npx playwright install chromium'
      );
    }
    browser = await chromium.launch({
      headless: true,
      args: ['--disable-blink-features=AutomationControlled', '--no-sandbox', '--disable-setuid-sandbox'],
    });
    const context = await browser.newContext({
      userAgent: BROWSER_UA,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    const page = await context.newPage();
    console.log('Playwright : navigation stake.com/casino/group/slots …');
    try {
      await page.goto('https://stake.com/casino/group/slots', {
        waitUntil: 'domcontentloaded',
        timeout: 120000,
      });
    } catch (e) {
      console.warn('Navigation (timeout possible CF) :', e.message, '— on tente quand même le GraphQL.');
    }
    await new Promise((r) => setTimeout(r, 6000));

    const all = [];
    let after = null;
    let pages = 0;
    const maxPages = 500;
    for (;;) {
      pages += 1;
      if (pages > maxPages) throw new Error('Trop de pages (limite sécurité).');
      const data = await fetchPagePlaywright(page, after);
      const conn = data?.casinoGames;
      if (!conn) {
        throw new Error('Réponse GraphQL sans casinoGames (réponse tronquée ou blocage).');
      }
      const edges = conn.edges || [];
      for (const e of edges) {
        const n = e?.node;
        if (n) all.push(n);
      }
      const pi = conn.pageInfo;
      if (!pi?.hasNextPage) break;
      after = pi.endCursor || null;
      if (!after) break;
      await new Promise((r) => setTimeout(r, 120));
    }
    return all;
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

function toJeuxEntry(node) {
  const slug = String(node.slug || '').trim();
  const name = String(node.name || '').trim();
  const prov = String(node.provider?.name || node.provider || '').trim();
  if (!slug || !name) return null;
  return {
    id: `stake_${slug}`,
    nom: name,
    provider: prov || '—',
    rtp: '',
    image: String(node.thumb || node.thumbnailUrl || '').trim(),
    gamdomUrl: `https://stake.com/casino/games/${encodeURIComponent(slug)}`,
    devise: { active: 'USD', symbole: '$' },
  };
}

async function loadJeux() {
  const raw = readFileSync(JEUX_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : (parsed.slots || parsed.games || []);
  if (!Array.isArray(arr) || !arr.length) {
    throw new Error('jeux.json : tableau de jeux introuvable.');
  }
  return arr;
}

async function main() {
  const dryRun = parseArgs();
  const forcePw = process.env.FORCE_PLAYWRIGHT === '1' || process.env.FORCE_PLAYWRIGHT === 'true';

  console.log(`Lecture ${JEUX_PATH}…`);
  const arr = await loadJeux();

  const existingKeys = new Set();
  const existingIds = new Set();
  for (const s of arr) {
    const nom = s.nom || s.name || s.title;
    const prov = s.provider || s.Provider || '';
    existingKeys.add(dedupeKey(nom, prov));
    const id = String(s.id || s.Id || '');
    if (id) existingIds.add(id.toLowerCase());
  }

  console.log(`Entrées existantes : ${arr.length} (clés nom|provider : ${existingKeys.size})`);
  console.log('Récupération Stake (categorySlug=slots)…');

  let nodes;
  let via = 'fetch-node';
  if (forcePw) {
    console.log('FORCE_PLAYWRIGHT=1 → Playwright uniquement.');
    nodes = await fetchAllStakeSlotsPlaywright();
    via = 'playwright';
  } else {
    try {
      nodes = await fetchAllStakeSlotsNative();
    } catch (e1) {
      const d1 = e1.cause?.message || '';
      console.warn(`\nFetch Node échoué (${e1.message} ${d1}). Fallback Playwright…`);
      try {
        nodes = await fetchAllStakeSlotsPlaywright();
        via = 'playwright';
      } catch (e2) {
        console.error('\nPlaywright échoué :', e2.message);
        console.error('\nDernière option : lance le workflow GitHub Actions « Sync Stake → jeux.json » (runner US + Chromium).');
        process.exit(1);
      }
    }
  }

  console.log(`Stake : ${nodes.length} jeux récupérés (via ${via}).`);

  const toAdd = [];
  for (const node of nodes) {
    const entry = toJeuxEntry(node);
    if (!entry) continue;
    const k = dedupeKey(entry.nom, entry.provider);
    if (existingKeys.has(k)) continue;
    if (existingIds.has(entry.id.toLowerCase())) continue;
    existingKeys.add(k);
    existingIds.add(entry.id.toLowerCase());
    toAdd.push(entry);
  }

  console.log(`Nouvelles entrées à ajouter : ${toAdd.length}.`);

  if (dryRun) {
    for (const e of toAdd.slice(0, 25)) {
      console.log(`  - ${e.nom} | ${e.provider} | ${e.gamdomUrl}`);
    }
    if (toAdd.length > 25) console.log(`  … +${toAdd.length - 25} autres`);
    process.exit(0);
  }

  if (!toAdd.length) {
    console.log('Rien à ajouter. Fichier inchangé.');
    process.exit(0);
  }

  const merged = arr.concat(toAdd);
  writeFileSync(JEUX_PATH, JSON.stringify(merged), 'utf8');
  console.log(`OK : jeux.json mis à jour → ${merged.length} entrées (+${toAdd.length}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
