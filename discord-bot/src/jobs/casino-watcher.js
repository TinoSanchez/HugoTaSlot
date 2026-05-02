import { child } from '../lib/logger.js';
import { supabase } from '../supabase.js';
import { casinoFetchers, casinoLabels } from '../lib/casino-fetchers.js';
import { getCatalog, isKnownSlot, normalizeSlotKey } from '../lib/catalog.js';

const log = child({ mod: 'casino-watcher' });

// Source recommandée : **slotcatalog** seul.
// SlotCatalog indexe les nouvelles sorties des studios (mêmes jeux que sur Stake, Gamdom, Shuffle, Celsius, etc.) ;
// inutile d’appeler chaque site (Cloudflare + SPA) quand le répertoire est à jour.
// Autres clés (stake, gamdom, …) = expérimental, souvent bloqué en prod.
const ENABLED_SOURCES = (process.env.CASINO_SOURCES || 'slotcatalog')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const MAX_PER_SOURCE_PER_RUN = 25; // garde-fou anti-spam Discord au premier passage

function safeStr(s, max = 240) {
  return String(s || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function buildSlug(source, name, provider) {
  const k = normalizeSlotKey(`${provider || ''}-${name || ''}`);
  return `${source}-${k || Math.random().toString(36).slice(2, 10)}`.slice(0, 200);
}

async function getKnownSlugs(source) {
  // Récupère les slugs déjà connus pour cette source dans slot_releases.
  const { data, error } = await supabase
    .from('slot_releases')
    .select('slug')
    .eq('source', source);
  if (error) {
    log.warn({ source, msg: error.message }, 'lookup slugs failed');
    return new Set();
  }
  return new Set((data || []).map((r) => r.slug));
}

async function processOneSource(source, fetcher, catalog) {
  const label = casinoLabels[source] || source;
  let games;
  try {
    games = await fetcher();
  } catch (e) {
    log.warn({ source, msg: e.message, code: e.code || '' }, 'fetcher threw');
    return { source, fetched: 0, inserted: 0, error: e.message };
  }
  if (!Array.isArray(games) || !games.length) {
    log.info({ source }, 'aucun jeu remonté');
    return { source, fetched: 0, inserted: 0 };
  }
  const knownSlugs = await getKnownSlugs(source);
  const candidates = [];
  for (const g of games) {
    const name = safeStr(g.name, 200);
    if (!name) continue;
    if (isKnownSlot(catalog, name)) continue; // déjà dans jeux.json → connue
    const slug = buildSlug(source, name, g.provider);
    if (knownSlugs.has(slug)) continue;
    const publishedAt = g.publishedAt && !Number.isNaN(Date.parse(g.publishedAt))
      ? new Date(g.publishedAt).toISOString()
      : new Date().toISOString();
    const summary = source === 'slotcatalog'
      ? 'Nouvelle sortie (SlotCatalog : même périmètre que les catalogues Stake, Gamdom, Shuffle, Celsius et autres casinos au moment de la sortie).'
      : `Nouvelle sortie repérée via ${label}.`;
    candidates.push({
      source,
      slug,
      title: name,
      provider: safeStr(g.provider, 80) || null,
      image: safeStr(g.image, 500) || null,
      url: safeStr(g.url, 500) || null,
      summary,
      published_at: publishedAt,
    });
    if (candidates.length >= MAX_PER_SOURCE_PER_RUN) break;
  }
  if (!candidates.length) {
    log.info({ source, fetched: games.length }, 'rien de nouveau à insérer');
    return { source, fetched: games.length, inserted: 0 };
  }
  // Insertion en batch — onConflict ignore les doublons (slug est UNIQUE)
  const { error: insErr } = await supabase
    .from('slot_releases')
    .upsert(candidates, { onConflict: 'slug', ignoreDuplicates: true });
  if (insErr) {
    log.warn({ source, msg: insErr.message }, 'insert candidates failed');
    return { source, fetched: games.length, inserted: 0, error: insErr.message };
  }
  log.info({ source, fetched: games.length, inserted: candidates.length }, 'nouvelles slots insérées');
  return { source, fetched: games.length, inserted: candidates.length };
}

export async function runCasinoCheck() {
  if (!ENABLED_SOURCES.length) return { skipped: true };
  const catalog = await getCatalog().catch(() => ({ knownNames: new Set() }));
  const results = [];
  for (const source of ENABLED_SOURCES) {
    const fetcher = casinoFetchers[source];
    if (!fetcher) {
      log.warn({ source }, 'source inconnue (ignore)');
      continue;
    }
    // Petit délai entre les sources pour éviter de paraître trop bot.
    const r = await processOneSource(source, fetcher, catalog);
    results.push(r);
    await new Promise((r2) => setTimeout(r2, 1500));
  }
  return { results };
}
