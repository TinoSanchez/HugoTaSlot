/**
 * Complète jeux.json avec les **nouvelles sorties** repérées hors catalogue intégral.
 *
 * Sources :
 *   1) slot.report (API JSON, filtre release_date) — fiable même si SlotCatalog / Cloudflare bloquent.
 *   2) SlotCatalog « New Slots » (via Jina Reader + moteur browser), si la page est lisible.
 *   3) Optionnel : Stake `new-releases` (GraphQL), nécessite souvent VPN hors blocages ANJ.
 *
 * Dédup : même clé nom|provider que sync-stake-catalog.mjs + ids uniques.
 *
 * Usage :
 *   node scripts/sync-recent-slots-to-jeux.mjs
 *   node scripts/sync-recent-slots-to-jeux.mjs --dry-run
 *   INCLUDE_SLOT_REPORT=0 SLOTCATALOG_MAX_PAGES=5 INCLUDE_STAKE_NEW=1 node scripts/sync-recent-slots-to-jeux.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JEUX_PATH = resolve(ROOT, 'jeux.json');

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';

const STAKE_GRAPHQL = 'https://stake.com/_api/graphql';
const STAKE_NEW_QUERY = `
query CasinoGames($categorySlug: String, $first: Int) {
  casinoGames(categorySlug: $categorySlug, first: $first) {
    edges {
      node {
        id
        name
        slug
        thumb
        provider { name }
      }
    }
  }
}`.trim();

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

function loadJeux() {
  const raw = readFileSync(JEUX_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.slots || parsed.games || [];
  if (!Array.isArray(arr) || !arr.length) {
    throw new Error('jeux.json : tableau de jeux introuvable.');
  }
  return arr;
}

function parseCli() {
  return { dryRun: process.argv.includes('--dry-run') };
}

/** SlotCatalog — même logique que discord-bot/src/lib/casino-fetchers.js */
function parseSlotcatalogMarkdown(md, maxAgeDays) {
  const cutoff = Date.now() - maxAgeDays * 24 * 3600 * 1000;
  const out = [];
  const seen = new Set();

  const tileRe =
    /\[!\[Image\s+\d+:\s*([^\]]+?)\s*slot\]\((https?:\/\/[^)]+?)\)\s+!\[Image\s+\d+\]\([^)]+\)\s+###\s+([^\]\n]+?)\]\(https:\/\/slotcatalog\.com\/en\/slots\/([a-z0-9-]+)\)/gi;

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
      kind: 'slotcatalog',
      slug,
      name,
      provider,
      image,
      url: `https://slotcatalog.com/en/slots/${slug}`,
      publishedAt,
    });
  }

  return out;
}

async function fetchJinaMarkdown(slotcatalogPath) {
  const target = `https://slotcatalog.com/en/${slotcatalogPath}`;
  const jinaUrl = `https://r.jina.ai/${target}`;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 120_000);
  try {
    const timeoutSec = String(
      Math.min(300, Math.max(30, parseInt(process.env.JINA_TIMEOUT_SEC || '180', 10) || 180))
    );
    const res = await fetch(jinaUrl, {
      method: 'GET',
      headers: {
        accept: 'text/plain, text/markdown, */*',
        'x-engine': 'browser',
        'x-respond-with': 'markdown',
        'x-timeout': timeoutSec,
        'user-agent': BROWSER_UA,
      },
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`Jina HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function fetchAllSlotcatalogGames() {
  if (process.env.INCLUDE_SLOTCATALOG_JINA === '0' || process.env.INCLUDE_SLOTCATALOG_JINA === 'false') {
    console.log('SlotCatalog (Jina) désactivé (INCLUDE_SLOTCATALOG_JINA=0).');
    return [];
  }
  const maxPages = Math.min(
    20,
    Math.max(1, parseInt(process.env.SLOTCATALOG_MAX_PAGES || '4', 10) || 4)
  );
  const maxAgeDays = Math.min(
    730,
    Math.max(14, parseInt(process.env.SLOTCATALOG_MAX_AGE_DAYS || '365', 10) || 365)
  );

  const mergedMd = [];
  for (let p = 1; p <= maxPages; p++) {
    const path = p === 1 ? 'New-Slots' : `New-Slots?page=${p}`;
    try {
      console.log(`SlotCatalog (Jina) page ${p}/${maxPages}…`);
      const md = await fetchJinaMarkdown(path);
      if (!md || md.length < 200 || /Just a moment|403|Forbidden/i.test(md.slice(0, 500))) {
        console.warn(
          `  page ${p} : page bloquée ou trop courte (Cloudflare / quota Jina). Arrêt SlotCatalog.`
        );
        break;
      }
      mergedMd.push(md);
      await new Promise((r) => setTimeout(r, 1200));
    } catch (e) {
      console.warn(`  page ${p} échouée :`, e.message || e);
      break;
    }
  }

  const bigMd = mergedMd.join('\n\n');
  const games = parseSlotcatalogMarkdown(bigMd, maxAgeDays);
  console.log(`SlotCatalog : ${games.length} entrées parsées (âge max ${maxAgeDays} j., ${mergedMd.length} page(s)).`);
  return games;
}

async function fetchSlotReportRecentRows(maxAgeDays) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  try {
    const res = await fetch('https://slot.report/api/v1/slots.json', {
      headers: {
        accept: 'application/json',
        'user-agent': BROWSER_UA,
      },
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`slot.report HTTP ${res.status}`);
    const data = await res.json();
    const results = Array.isArray(data.results) ? data.results : [];
    const cutoff = Date.now() - maxAgeDays * 86400000;
    const out = [];
    for (const s of results) {
      const rd = s.release_date;
      if (!rd) continue;
      const t = Date.parse(rd);
      if (Number.isNaN(t) || t < cutoff) continue;
      out.push(s);
    }
    out.sort((a, b) => String(b.release_date).localeCompare(String(a.release_date)));
    console.log(
      `slot.report : ${out.length} jeux avec release_date dans les ${maxAgeDays} derniers jours (sur ${results.length} dans l’API).`
    );
    return out;
  } finally {
    clearTimeout(timer);
  }
}

function slotReportRowToJeux(s, idx) {
  const providerSlug = String(s.provider_slug || 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  const slotSlug = String(s.slug || `slot-${idx}`)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '');
  const slotName = String(s.name || '').trim();
  const providerName = String(s.provider || '').trim();
  if (!slotName) return null;
  const rtp =
    typeof s.rtp === 'number' && !Number.isNaN(s.rtp) ? `${s.rtp.toFixed(2)}%` : '';
  const thumbText = encodeURIComponent(`${slotName}\n${providerName}`);
  const generatedThumb = `https://placehold.co/325x234/0b1020/f0a500/png?text=${thumbText}`;
  return {
    id: `sr_${providerSlug}_${slotSlug}`,
    nom: slotName,
    provider: providerName || '—',
    rtp,
    image: generatedThumb,
    gamdomUrl: `https://gamdom.com/slots/search?q=${encodeURIComponent(slotName)}`,
    devise: { active: 'USD', symbole: '$' },
  };
}

function slotcatalogToJeux(g) {
  const slug = String(g.slug || '').trim();
  const name = String(g.name || '').trim();
  if (!slug || !name) return null;
  const prov = String(g.provider || '').trim();
  return {
    id: `sc_${slug}`,
    nom: name,
    provider: prov || '—',
    rtp: '',
    image: String(g.image || '').trim(),
    gamdomUrl:
      g.url ||
      `https://gamdom.com/slots/search?q=${encodeURIComponent(name)}`,
    devise: { active: 'USD', symbole: '$' },
  };
}

async function fetchStakeNewReleases() {
  const first = Math.min(
    120,
    Math.max(20, parseInt(process.env.STAKE_NEW_FIRST || '80', 10) || 80)
  );
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);
  try {
    const res = await fetch(STAKE_GRAPHQL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': BROWSER_UA,
        'x-language': 'en',
        referer: 'https://stake.com/casino/group/new-releases',
        origin: 'https://stake.com',
      },
      body: JSON.stringify({
        query: STAKE_NEW_QUERY,
        variables: { categorySlug: 'new-releases', first },
        operationName: 'CasinoGames',
      }),
      signal: ac.signal,
    });
    if (!res.ok) throw new Error(`Stake GraphQL HTTP ${res.status}`);
    const data = await res.json();
    const edges = data?.data?.casinoGames?.edges || [];
    return edges.map((e) => e?.node).filter(Boolean);
  } finally {
    clearTimeout(timer);
  }
}

function stakeNodeToJeux(node) {
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

async function main() {
  const { dryRun } = parseCli();
  const includeStake =
    process.env.INCLUDE_STAKE_NEW === '1' || process.env.INCLUDE_STAKE_NEW === 'true';
  const includeSlotReport =
    process.env.INCLUDE_SLOT_REPORT !== '0' && process.env.INCLUDE_SLOT_REPORT !== 'false';

  const slotReportDays = Math.min(
    730,
    Math.max(30, parseInt(process.env.SLOT_REPORT_MAX_AGE_DAYS || '180', 10) || 180)
  );

  console.log(`Lecture ${JEUX_PATH}…`);
  const arr = loadJeux();

  const existingKeys = new Set();
  const existingIds = new Set();
  for (const s of arr) {
    const nom = s.nom || s.name || s.title;
    const prov = s.provider || s.Provider || '';
    existingKeys.add(dedupeKey(nom, prov));
    const id = String(s.id || s.Id || '');
    if (id) existingIds.add(id.toLowerCase());
  }

  console.log(`Entrées existantes : ${arr.length}`);

  const toAdd = [];

  const scGames = await fetchAllSlotcatalogGames();
  for (const g of scGames) {
    const entry = slotcatalogToJeux(g);
    if (!entry) continue;
    const k = dedupeKey(entry.nom, entry.provider);
    if (existingKeys.has(k)) continue;
    if (existingIds.has(entry.id.toLowerCase())) continue;
    existingKeys.add(k);
    existingIds.add(entry.id.toLowerCase());
    toAdd.push(entry);
  }

  if (includeSlotReport) {
    try {
      console.log(`slot.report (sorties ≤ ${slotReportDays} j.)…`);
      const rows = await fetchSlotReportRecentRows(slotReportDays);
      for (let i = 0; i < rows.length; i++) {
        const entry = slotReportRowToJeux(rows[i], i);
        if (!entry) continue;
        const k = dedupeKey(entry.nom, entry.provider);
        if (existingKeys.has(k)) continue;
        if (existingIds.has(entry.id.toLowerCase())) continue;
        existingKeys.add(k);
        existingIds.add(entry.id.toLowerCase());
        toAdd.push(entry);
      }
    } catch (e) {
      console.warn('slot.report ignoré :', e.message || e);
    }
  } else {
    console.log('slot.report désactivé (INCLUDE_SLOT_REPORT=0).');
  }

  if (includeStake) {
    console.log('Stake new-releases (GraphQL)…');
    try {
      const nodes = await fetchStakeNewReleases();
      console.log(`Stake : ${nodes.length} jeux « new-releases ».`);
      for (const node of nodes) {
        const entry = stakeNodeToJeux(node);
        if (!entry) continue;
        const k = dedupeKey(entry.nom, entry.provider);
        if (existingKeys.has(k)) continue;
        if (existingIds.has(entry.id.toLowerCase())) continue;
        existingKeys.add(k);
        existingIds.add(entry.id.toLowerCase());
        toAdd.push(entry);
      }
    } catch (e) {
      console.warn('Stake new-releases ignoré :', e.message || e);
    }
  } else {
    console.log('Stake new-releases non demandé (INCLUDE_STAKE_NEW=1 pour activer).');
  }

  console.log(`Nouvelles entrées à ajouter : ${toAdd.length}.`);

  if (dryRun) {
    for (const e of toAdd.slice(0, 40)) {
      console.log(`  - ${e.nom} | ${e.provider} | ${e.id}`);
    }
    if (toAdd.length > 40) console.log(`  … +${toAdd.length - 40} autres`);
    process.exit(0);
  }

  if (!toAdd.length) {
    console.log('Rien à ajouter. jeux.json inchangé.');
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
