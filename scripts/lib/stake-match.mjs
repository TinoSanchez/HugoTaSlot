/**
 * Logique pure de matching entre une entrée catalogue et un node Stake.
 * Séparé pour être testable sans réseau (voir scripts/stake-match.test.mjs).
 */

const LIGATURE_MAP = {
  œ: 'oe',
  Œ: 'oe',
  æ: 'ae',
  Æ: 'ae',
  ß: 'ss',
};

export function normalizeStr(s) {
  return String(s ?? '')
    .replace(/[œŒæÆß]/g, (c) => LIGATURE_MAP[c] || c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''′`´]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function normalizeSlug(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const PROVIDER_ALIASES = new Map([
  ['playn-go', 'play-n-go'],
  ['playngo', 'play-n-go'],
  ['play-n-go', 'play-n-go'],
  ['pragmatic-play', 'pragmatic-play'],
  ['pragmaticplay', 'pragmatic-play'],
  ['nolimit-city', 'nolimit-city'],
  ['nolimitcity', 'nolimit-city'],
  ['no-limit-city', 'nolimit-city'],
  ['hacksaw-gaming', 'hacksaw'],
  ['hacksaw', 'hacksaw'],
  ['print-studios', 'print-studios'],
  ['printstudios', 'print-studios'],
  ['big-time-gaming', 'big-time-gaming'],
  ['bigtimegaming', 'big-time-gaming'],
  ['btg', 'big-time-gaming'],
  ['games-global', 'games-global'],
  ['microgaming', 'games-global'],
  ['relax-gaming', 'relax-gaming'],
  ['stake-engine', 'stake-originals'],
  ['stake-originals', 'stake-originals'],
  ['stakeoriginals', 'stake-originals'],
  ['pg-soft', 'pg-soft'],
  ['pgsoft', 'pg-soft'],
  ['avatar-ux', 'avatarux'],
  ['avatarux', 'avatarux'],
  ['bgaming', 'bgaming'],
  ['b-gaming', 'bgaming'],
  ['peter-sons', 'peter-and-sons'],
  ['peter-and-sons', 'peter-and-sons'],
  ['peterandsons', 'peter-and-sons'],
  ['booming', 'booming-games'],
  ['booming-games', 'booming-games'],
  ['boominggames', 'booming-games'],
  ['red-tiger', 'red-tiger'],
  ['redtiger', 'red-tiger'],
  ['netent', 'netent'],
  ['novomatic', 'novomatic'],
  ['gamomat', 'gamomat'],
  ['fantasma-games', 'fantasma-games'],
  ['fantasmagames', 'fantasma-games'],
]);

export function normalizeProvider(s) {
  const slug = normalizeSlug(s);
  return PROVIDER_ALIASES.get(slug) ?? slug;
}

/**
 * Construit l'index de matching depuis les nodes Stake.
 *  - byNameProv : "nom_norm|provider_norm" (le plus strict)
 *  - byName     : "nom_norm" (fallback)
 *  - bySlug     : slug stake (utile si srSlug arrive à matcher direct)
 */
export function buildStakeMatchIndex(stakeNodes) {
  const byNameProv = new Map();
  const byName = new Map();
  const bySlug = new Map();
  for (const node of stakeNodes || []) {
    if (!node || !node.name) continue;
    const thumb = String(node.thumbnailUrl || node.thumb || '').trim();
    if (!thumb) continue;
    const entry = {
      id: String(node.id || ''),
      name: String(node.name || ''),
      slug: String(node.slug || ''),
      thumbnailUrl: thumb,
      provider: String(node.provider || ''),
      providerName: String(node.providerName || ''),
    };
    const nameKey = normalizeStr(entry.name);
    const provKey = normalizeProvider(entry.provider);
    if (nameKey) {
      if (provKey) {
        byNameProv.set(`${nameKey}|${provKey}`, entry);
      }
      if (!byName.has(nameKey)) byName.set(nameKey, entry);
    }
    const slugKey = normalizeSlug(entry.slug);
    if (slugKey) bySlug.set(slugKey, entry);
  }
  return { byNameProv, byName, bySlug };
}

/**
 * Trouve le node Stake pour une entrée catalogue (placeholder sr_*).
 * Renvoie { node, via } ou null.
 */
export function findStakeNodeForCatalog(catEntry, index) {
  if (!catEntry || !index) return null;
  const nameKey = normalizeStr(catEntry.nom || catEntry.name || catEntry.title);
  if (!nameKey) return null;
  const provKey = normalizeProvider(catEntry.provider || catEntry.Provider || '');
  if (provKey) {
    const exact = index.byNameProv.get(`${nameKey}|${provKey}`);
    if (exact) return { node: exact, via: 'name+provider' };
  }
  const srSlug = String(catEntry.srSlug || '').trim();
  if (srSlug) {
    const hit = index.bySlug.get(normalizeSlug(srSlug));
    if (hit) return { node: hit, via: 'srSlug' };
  }
  const loose = index.byName.get(nameKey);
  if (loose) return { node: loose, via: 'name-only' };
  return null;
}
