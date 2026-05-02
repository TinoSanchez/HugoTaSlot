/**
 * Synchronise le catalogue Stake (GraphQL categorySlug=slots) dans jeux.json.
 * Stratégie :
 *   1) fetch() Node (rapide), optionnellement via STAKE_PROXY
 *   2) si échec → Patchright + Chrome puis repli Playwright Chromium ; requêtes GraphQL
 *      avec le même contexte (cookies). Proxy navigateur = même variable STAKE_PROXY.
 *
 * Usage :
 *   npm run sync:stake
 *   node scripts/sync-stake-catalog.mjs --dry-run
 *   FORCE_PLAYWRIGHT=1 npm run sync:stake   # sauter le fetch Node
 *   CI / Cloudflare : PLAYWRIGHT_HEADFUL=1 + xvfb-run + Patchright + Chrome (voir workflow)
 *   SKIP_PATCHRIGHT=1 : forcer l’ancien Playwright Chromium si besoin
 *   STAKE_PROXY / HTTPS_PROXY : URL de proxy (ex. résidentiel) — utile sur GitHub Actions
 */

import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { ProxyAgent } from 'undici';

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

function platformUserAgent() {
  if (process.platform === 'darwin') {
    return 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  if (process.platform === 'win32') {
    return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
  }
  return 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
}

function looksLikeCloudflareHtml(text) {
  const s = String(text || '').slice(0, 1200);
  return s.includes('Just a moment') || s.includes('challenges.cloudflare.com');
}

/** Priorité : STAKE_PROXY (secret CI) puis variables d’environnement classiques. */
function stakeProxyUrlRaw() {
  return (
    process.env.STAKE_PROXY?.trim() ||
    process.env.HTTPS_PROXY?.trim() ||
    process.env.HTTP_PROXY?.trim() ||
    ''
  );
}

let fetchProxyDispatcher;
function getFetchDispatcher() {
  if (fetchProxyDispatcher === false) return undefined;
  if (fetchProxyDispatcher) return fetchProxyDispatcher;
  const raw = stakeProxyUrlRaw();
  if (!raw) {
    fetchProxyDispatcher = false;
    return undefined;
  }
  const url = raw.startsWith('http') ? raw : `http://${raw}`;
  console.log('Fetch Node : requêtes via proxy HTTP(S).');
  fetchProxyDispatcher = new ProxyAgent(url);
  return fetchProxyDispatcher;
}

function getBrowserProxyOption() {
  const raw = stakeProxyUrlRaw();
  if (!raw) return undefined;
  const server = raw.startsWith('http') ? raw : `http://${raw}`;
  console.log('Navigateur : proxy activé (Patchright / Playwright).');
  return { server };
}

async function waitForCloudflareGate(page, maxMs = 120000) {
  console.log('Attente éventuelle Cloudflare sur la page slots…');
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const title = await page.title().catch(() => '');
    const lower = title.toLowerCase();
    if (title && !lower.includes('just a moment')) {
      await new Promise((r) => setTimeout(r, 4000));
      return;
    }
    await new Promise((r) => setTimeout(r, 2500));
  }
  console.warn('Titre « Just a moment » encore présent après délai ; poursuite quand même.');
}

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
  const dispatcher = getFetchDispatcher();
  const res = await fetch(STAKE_GQL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
      'user-agent': platformUserAgent(),
      'x-language': 'en',
      referer: 'https://stake.com/casino/group/slots',
      origin: 'https://stake.com',
    },
    body: JSON.stringify(body),
    ...(dispatcher ? { dispatcher } : {}),
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

async function fetchPagePlaywrightOnce(page, after) {
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
    const hint = looksLikeCloudflareHtml(text)
      ? ' (page Cloudflare — cookies peut‑être pas encore valides)'
      : '';
    throw new Error(`Stake GraphQL HTTP ${status}${hint} : ${text.slice(0, 500)}`);
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

async function fetchPagePlaywrightWithRetries(page, after, { firstPage }) {
  const attempts = firstPage ? 24 : 5;
  const delayMs = 3500;
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetchPagePlaywrightOnce(page, after);
    } catch (e) {
      lastErr = e;
      const msg = String(e.message || '');
      const retry =
        msg.includes('403') ||
        msg.includes('503') ||
        msg.includes('Just a moment') ||
        msg.includes('Cloudflare') ||
        msg.includes('challenges.cloudflare');
      if (!retry || i === attempts - 1) throw e;
      console.warn(`GraphQL (navigateur) ${i + 1}/${attempts} échoué, nouvel essai dans ${delayMs}ms…`);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  throw lastErr;
}

async function stakeBrowserFetchAllSlots(page, label) {
  console.log(`${label} : navigation stake.com/casino/group/slots …`);
  try {
    await page.goto('https://stake.com/casino/group/slots', {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });
  } catch (e) {
    console.warn('Navigation (timeout possible CF) :', e.message, '— on tente quand même le GraphQL.');
  }
  await waitForCloudflareGate(page);

  const all = [];
  let after = null;
  let pages = 0;
  const maxPages = 500;
  for (;;) {
    pages += 1;
    if (pages > maxPages) throw new Error('Trop de pages (limite sécurité).');
    const data = await fetchPagePlaywrightWithRetries(page, after, { firstPage: pages === 1 });
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
}

async function fetchAllStakeSlotsPlaywright() {
  const headful =
    process.env.PLAYWRIGHT_HEADFUL === '1' || process.env.PLAYWRIGHT_HEADFUL === 'true';
  const skipPatch = process.env.SKIP_PATCHRIGHT === '1' || process.env.SKIP_PATCHRIGHT === 'true';

  const proxyOpt = getBrowserProxyOption();

  if (!skipPatch) {
    try {
      const { chromium } = await import('patchright');
      const userDataDir = mkdtempSync(join(tmpdir(), 'stake-patchright-'));
      const context = await chromium.launchPersistentContext(userDataDir, {
        channel: 'chrome',
        headless: !headful,
        locale: 'en-US',
        timezoneId: 'America/New_York',
        viewport: null,
        ...(proxyOpt ? { proxy: proxyOpt } : {}),
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const page = context.pages()[0] ?? (await context.newPage());
      try {
        return await stakeBrowserFetchAllSlots(
          page,
          `Patchright + Chrome (headless=${!headful})`
        );
      } finally {
        await context.close().catch(() => {});
        try {
          rmSync(userDataDir, { recursive: true, force: true });
        } catch (_) {}
      }
    } catch (e) {
      console.warn(
        'Patchright / Google Chrome indisponible ou erreur au lancement — repli Playwright Chromium :',
        e.message || e
      );
    }
  }

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
      headless: !headful,
      ...(proxyOpt ? { proxy: proxyOpt } : {}),
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--window-size=1920,1080',
      ],
    });
    const ua = platformUserAgent();
    const context = await browser.newContext({
      userAgent: ua,
      viewport: { width: 1366, height: 768 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });
    const page = await context.newPage();
    return await stakeBrowserFetchAllSlots(page, `Playwright Chromium fallback (headless=${!headful})`);
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

  if (process.env.GITHUB_SHA) {
    console.log(
      `GitHub Actions : script lancé depuis le commit ${process.env.GITHUB_SHA.slice(0, 7)} (vérifie que c’est bien le dernier sur main).`
    );
  }

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

  if (process.env.GITHUB_ACTIONS === 'true' && !stakeProxyUrlRaw()) {
    console.log(
      'CI : sans secret STAKE_PROXY (proxy HTTP/S), Cloudflare bloque souvent les IP GitHub — ajoute-le dans Settings → Secrets, ou sync en local avec VPN.'
    );
  }

  let nodes;
  let via = 'fetch-node';
  if (forcePw) {
    console.log('FORCE_PLAYWRIGHT=1 → navigateur automatisé uniquement (Patchright / Playwright).');
    nodes = await fetchAllStakeSlotsPlaywright();
    via = 'playwright';
  } else {
    try {
      nodes = await fetchAllStakeSlotsNative();
    } catch (e1) {
      const d1 = e1.cause?.message || '';
      console.warn(
        `\nFetch Node échoué (${e1.message} ${d1}). Fallback Patchright / Playwright…`
      );
      try {
        nodes = await fetchAllStakeSlotsPlaywright();
        via = 'playwright';
      } catch (e2) {
        console.error('\nNavigateur automatisé échoué :', e2.message);
        console.error(
          '\n→ Vérifie les logs au-dessus : doit apparaître « Patchright + Chrome » puis éventuellement le repli Playwright. Contournement CF sur CI : secret STAKE_PROXY (proxy sortie « résidentielle »), ou npm run sync:stake en local (VPN) puis commit de jeux.json.'
        );
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
