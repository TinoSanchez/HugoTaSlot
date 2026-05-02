const fs = require('fs');

const BASE_URL = 'https://gamdom.com';
const INCLUDE_ALL_CATEGORIES = false;
const MERGE_SLOTREPORT_MISSING = false;

function absUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.startsWith('/')) return `${BASE_URL}${url}`;
  return `${BASE_URL}/${url}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
  return u.includes('placehold.co') || u.includes('/static/dyn/cdn_images/');
}

function nameKey(v) {
  return norm(v).replace(/\b(slot|game|megaways|tm|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
}

function diceCoeff(a, b) {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const bigrams = (s) => {
    const out = new Map();
    for (let i = 0; i < s.length - 1; i += 1) {
      const bg = s.slice(i, i + 2);
      out.set(bg, (out.get(bg) || 0) + 1);
    }
    return out;
  };
  const bx = bigrams(x);
  const by = bigrams(y);
  let overlap = 0;
  for (const [bg, c] of bx.entries()) overlap += Math.min(c, by.get(bg) || 0);
  const total = [...bx.values()].reduce((s, n) => s + n, 0) + [...by.values()].reduce((s, n) => s + n, 0);
  return total > 0 ? (2 * overlap) / total : 0;
}

/** Plusieurs orthographes / sous-titres pour matcher slot.report ↔ Gamdom. */
function nameVariants(name) {
  const base = String(name || '').trim();
  const out = new Set([base]);
  let x = base.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (x) out.add(x);
  x = base.replace(/\s*:\s*.+$/u, '').trim();
  if (x) out.add(x);
  x = base.replace(/\s*(megaways|extreme|deluxe|gold|max|hold\s*and\s*win)\s*$/i, '').trim();
  if (x) out.add(x);
  x = base.replace(/\s*(slot|slots)\s*$/i, '').trim();
  if (x) out.add(x);
  x = base.replace(/\s*!\s*$/u, '').trim();
  if (x) out.add(x);
  return [...out];
}

function buildRefFirstCharIndex(allRealRefs) {
  const map = new Map();
  for (const ref of allRealRefs) {
    const c = nameKey(ref.name)[0] || '_';
    if (!map.has(c)) map.set(c, []);
    map.get(c).push(ref);
  }
  return map;
}

function extremeGlobalCandidates(item, charIndex, allRealRefs) {
  const out = new Set();
  for (const v of nameVariants(item.nom)) {
    const c = nameKey(v)[0] || '_';
    const list = charIndex.get(c);
    if (list) list.forEach((r) => out.add(r));
  }
  return out.size ? [...out] : allRealRefs;
}

function bestRealImageExtreme(item, realByProvider, allRealRefs, charIndex) {
  const pv = norm(item.provider);
  const variants = nameVariants(item.nom);
  const scoreAgainst = (ref) => {
    let m = 0;
    for (const v of variants) m = Math.max(m, diceCoeff(v, ref.name));
    return m;
  };

  let bestScore = 0;
  let bestImage = '';
  const sameList = realByProvider.get(pv) || [];
  for (const ref of sameList) {
    const sc = scoreAgainst(ref);
    if (sc > bestScore) {
      bestScore = sc;
      bestImage = ref.image;
    }
  }
  if (bestScore >= 0.72 && bestImage) return bestImage;

  bestScore = 0;
  bestImage = '';
  const globalPool = extremeGlobalCandidates(item, charIndex, allRealRefs);
  for (const ref of globalPool) {
    const sc = scoreAgainst(ref);
    if (sc > bestScore) {
      bestScore = sc;
      bestImage = ref.image;
    }
  }
  if (bestScore >= 0.86 && bestImage) return bestImage;
  return '';
}

function bestSafeProviderImage(name, provider, realByProvider) {
  const refs = realByProvider.get(norm(provider)) || [];
  if (!refs.length) return '';
  const variants = nameVariants(name);
  let bestScore = 0;
  let bestImage = '';
  for (const ref of refs) {
    let sc = 0;
    for (const v of variants) sc = Math.max(sc, diceCoeff(v, ref.name));
    if (sc > bestScore) {
      bestScore = sc;
      bestImage = ref.image;
    }
  }
  return bestScore >= 0.90 ? bestImage : '';
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
  try { data = JSON.parse(text); } catch { data = null; }

  const isRateLimit = typeof text === 'string' && text.includes('specific:rateLimit');
  const isTemporary = res.status === 503 || res.status === 502 || res.status === 429;
  if (isRateLimit && attempt <= 8) {
    await sleep(700 * attempt);
    return postJson(path, body, attempt + 1);
  }
  if (isTemporary && attempt <= 8) {
    await sleep(1200 * attempt);
    return postJson(path, body, attempt + 1);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}: ${text.slice(0, 250)}`);
  }
  return data;
}

function isSlotLike(staticData) {
  const category = String(staticData.category || '').toLowerCase();
  const filters = String(staticData.filters || '').toUpperCase();
  if (category.includes('live')) return false;
  if (filters.includes('LIVE')) return false;
  if (filters.includes('SLOT')) return true;
  if (category.includes('slot')) return true;
  return false;
}

function mapGameToJeu(game) {
  const s = game?.staticData || {};
  const provider = String(s.provider_name || s.default_provider_name || s.producer_id || 'Provider inconnu').trim();
  const name = String(s.name || s.game_code || 'Slot machine').trim();
  const rtp = typeof s.rtp === 'number'
    ? `${(s.rtp / 100).toFixed(2)}%`
    : 'N/A';

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

async function fetchProviderGames(providerName) {
  const all = [];
  const seenCodes = new Set();
  let totalCount = 0;

  // 1) Page 1 pour connaître totalCount.
  const firstPayload = { config: [{ sectionType: 'all', providerName, page: 1, filters: ['SLOT'], ignoreCountrySupport: true }] };
  const firstData = await postJson('/client-api/casino/games-list', firstPayload);
  const firstBlock = firstData?.games?.[0];
  const firstList = Array.isArray(firstBlock?.gamesList) ? firstBlock.gamesList : [];
  totalCount = Number(firstBlock?.totalCount || 0);
  for (const g of firstList) {
    const code = String(g?.staticData?.game_code || '').toLowerCase();
    if (!code || seenCodes.has(code)) continue;
    seenCodes.add(code);
    all.push(g);
  }

  // 2) En pratique, l'API provider Gamdom renvoie p1/p2 puis 0.
  // On scanne seulement une petite fenêtre stable (p2..p6) puis arrêt.
  const lastPageToScan = 6;
  for (let page = 2; page <= lastPageToScan; page += 1) {
    const payload = { config: [{ sectionType: 'all', providerName, page, filters: ['SLOT'], ignoreCountrySupport: true }] };
    const data = await postJson('/client-api/casino/games-list', payload);
    const block = data?.games?.[0];
    const list = Array.isArray(block?.gamesList) ? block.gamesList : [];
    for (const g of list) {
      const code = String(g?.staticData?.game_code || '').toLowerCase();
      if (!code || seenCodes.has(code)) continue;
      seenCodes.add(code);
      all.push(g);
    }
    await sleep(120);
  }

  return {
    providerName,
    totalCount,
    fetchedUnique: all.length,
    cappedByApi: all.length >= 200 && totalCount > all.length,
    games: all
  };
}

async function fetchGlobalSlots() {
  const all = [];
  let totalCount = null;
  let page = 1;
  let emptyStreak = 0;
  const MAX_PAGES = 260;

  while (page <= MAX_PAGES) {
    const payload = { config: [{ sectionType: 'all', limit: 100, page, filters: ['SLOT'], ignoreCountrySupport: true }] };
    const data = await postJson('/client-api/casino/games-list', payload);
    const block = data?.games?.[0];
    const list = Array.isArray(block?.gamesList) ? block.gamesList : [];
    totalCount = Number(block?.totalCount || totalCount || 0);

    if (!list.length) {
      emptyStreak += 1;
      if (emptyStreak >= 2) break;
      page += 1;
      await sleep(120);
      continue;
    }
    emptyStreak = 0;
    all.push(...list);

    if (totalCount && all.length >= totalCount) break;
    page += 1;
    await sleep(120);
  }

  return all;
}

async function fetchSlotReportSlots() {
  const res = await fetch('https://slot.report/api/v1/slots.json');
  if (!res.ok) throw new Error(`slot.report HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}

async function main() {
  const global = await fetchGlobalSlots();
  console.log(`Global fetched: ${global.length}`);

  const providers = await postJson('/client-api/casino/providers-list', undefined);
  const providerThumbByName = new Map(
    (Array.isArray(providers) ? providers : []).map((p) => [
      norm(p.provider_name),
      absUrl(p.provider_url_thumb || '')
    ])
  );
  const providerNames = (Array.isArray(providers) ? providers : [])
    .map((p) => String(p.provider_name || '').trim())
    .filter(Boolean);

  const merged = [...global];
  const providerAudit = [];
  for (let i = 0; i < providerNames.length; i += 1) {
    const providerName = providerNames[i];
    console.log(`[${i + 1}/${providerNames.length}] ${providerName}`);
    const result = await fetchProviderGames(providerName);
    providerAudit.push({
      provider: providerName,
      totalCount: result.totalCount,
      fetchedUnique: result.fetchedUnique,
      cappedByApi: !!result.cappedByApi
    });
    merged.push(...result.games);
  }

  const allRealGamdomRefs = [];
  const seenRealKey = new Set();
  const realByProvider = new Map();

  const uniq = new Map();
  const gamdomByNormProviderAndName = new Set();
  const gamdomExactImageByProviderAndName = new Map();
  const gamdomImageByNormName = new Map();
  const gamdomRealByProviderPrefix = new Map();
  const gamdomRealByPrefix = new Map();
  let keptCount = 0;
  let keptWithImageCount = 0;
  for (const game of merged) {
    const s = game?.staticData || {};
    if (!INCLUDE_ALL_CATEGORIES && !isSlotLike(s)) continue;
    keptCount += 1;
    const item = mapGameToJeu(game);
    if (item.image && !isGenericImage(item.image)) {
      const rk = String(s.game_code || '').toLowerCase().trim()
        || `${norm(item.nom)}__${norm(item.provider)}`;
      if (!seenRealKey.has(rk)) {
        seenRealKey.add(rk);
        const ref = { name: item.nom, provider: item.provider, image: item.image };
        allRealGamdomRefs.push(ref);
        const pk = norm(item.provider);
        if (!realByProvider.has(pk)) realByProvider.set(pk, []);
        realByProvider.get(pk).push(ref);
      }
    }
    if (!item.image) continue;
    keptWithImageCount += 1;
    const key = [
      String(s.game_code || '').toLowerCase().trim(),
      String(s.game_id ?? ''),
      String(s.provider_id || '').toLowerCase().trim(),
      String(s.imported_from || '').toLowerCase().trim(),
      String(item.provider || '').toLowerCase().trim(),
      String(item.nom || '').toLowerCase().trim()
    ].join('__');
    if (!uniq.has(key)) {
      uniq.set(key, item);
      const exactPair = `${norm(item.provider)}__${norm(item.nom)}`;
      gamdomByNormProviderAndName.add(exactPair);
      if (item.image && !isGenericImage(item.image)) {
        gamdomExactImageByProviderAndName.set(exactPair, item.image);
      }
      if (item.image && !isGenericImage(item.image)) {
        const n = norm(item.nom);
        if (!gamdomImageByNormName.has(n)) gamdomImageByNormName.set(n, item.image);
        const p = norm(item.provider);
        const nk = nameKey(item.nom);
        const pref = nk.slice(0, 4);
        const ppKey = `${p}__${pref}`;
        if (!gamdomRealByProviderPrefix.has(ppKey)) gamdomRealByProviderPrefix.set(ppKey, []);
        gamdomRealByProviderPrefix.get(ppKey).push({ name: item.nom, image: item.image, provider: item.provider });
        if (!gamdomRealByPrefix.has(pref)) gamdomRealByPrefix.set(pref, []);
        gamdomRealByPrefix.get(pref).push({ name: item.nom, image: item.image, provider: item.provider });
      }
    }
  }

  if (MERGE_SLOTREPORT_MISSING) {
    const sr = await fetchSlotReportSlots();
    let addedFromSlotReport = 0;
    for (const s of sr) {
      const provider = String(s.provider || 'Provider inconnu').trim();
      const name = String(s.name || 'Slot machine').trim();
      const pairKey = `${norm(provider)}__${norm(name)}`;
      if (gamdomByNormProviderAndName.has(pairKey)) continue;

      const providerThumb = providerThumbByName.get(norm(provider)) || '';
      const rtp = typeof s.rtp === 'number' && !Number.isNaN(s.rtp)
        ? `${s.rtp.toFixed(2)}%`
        : 'N/A';
      const id = `sr_${String(s.provider_slug || 'unknown')}_${String(s.slug || `${provider}_${name}`)}`
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '_');

      // Matching strict uniquement: provider + nom exact normalises.
      // On evite volontairement les fuzzy-matchs qui donnent de "mauvaises photos".
      const exactPair = `${norm(provider)}__${norm(name)}`;
      const strictImage = gamdomExactImageByProviderAndName.get(exactPair) || '';
      const safeProviderImage = strictImage ? '' : bestSafeProviderImage(name, provider, realByProvider);

      const item = {
        id,
        nom: name,
        provider,
        rtp,
        image: strictImage
          || safeProviderImage
          || providerThumb
          || `https://placehold.co/325x234/0b1020/f0a500/png?text=${encodeURIComponent(`${name}\n${provider}`)}`,
        gamdomUrl: `https://gamdom.com/slots/search?q=${encodeURIComponent(name)}`,
        devise: { active: 'USD', symbole: '$' }
      };
      uniq.set(`sr__${pairKey}`, item);
      addedFromSlotReport += 1;
    }
    console.log(`Ajoutes depuis slot.report: ${addedFromSlotReport}`);
  }

  // Anti-doublons par identifiant de jeu (game_code) deja applique via "uniq".
  // On ne re-fusionne pas par nom/provider pour ne pas perdre des slots distincts.
  const items = Array.from(uniq.values());

  // Passe safe+ : uniquement même provider, seuil élevé.
  let safePlusUpgrades = 0;
  for (const item of items) {
    if (!isGenericImage(item.image)) continue;
    const img = bestSafeProviderImage(item.nom, item.provider, realByProvider);
    if (img) {
      item.image = img;
      safePlusUpgrades += 1;
    }
  }
  console.log(`Mode images safe+: ${safePlusUpgrades} remplacements (meme provider)`);

  console.log('Mode Gamdom pur: aucune image externe/fallback applique');
  const suspiciousProviders = providerAudit.filter((p) => p.cappedByApi);
  console.log(`Audit providers: ${providerAudit.length} providers scannes`);
  console.log(`Providers limités par API provider: ${suspiciousProviders.length}`);
  if (suspiciousProviders.length) {
    console.log(JSON.stringify(suspiciousProviders.slice(0, 20)));
  }

  items.sort((a, b) => a.nom.localeCompare(b.nom));
  fs.writeFileSync('jeux.json', JSON.stringify(items));
  console.log(`Items bruts gardes: ${keptCount}`);
  console.log(`Items gardes avec image: ${keptWithImageCount}`);
  console.log(`jeux.json regenere avec vraies images: ${items.length} entrees`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
