/**
 * Enrichit les vignettes des entrées catalogue (sr_* slot.report, placeholders).
 * 1) Reprise depuis une autre entrée même jeu (nom « loose » + provider).
 * 2) Devinettes CDN Hub88 (HEAD) pour quelques studios (Hacksaw, etc.).
 */

export function isPlaceholderImage(url) {
  const u = String(url || '').toLowerCase();
  return !u || u.includes('placehold.co') || u.includes('via.placeholder');
}

export function normLoose(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

/** Clé nom+provider sans ponctuation (gère « Le Bandit - Miami » vs « Le Bandit Miami »). */
export function looseCatalogKey(nom, provider) {
  return `${normLoose(nom)}|${normLoose(provider)}`;
}

function normFuzzy(v) {
  return String(v || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameKeyFuzzy(v) {
  return normFuzzy(v)
    .replace(/\b(slot|game|megaways|tm|the)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function nameVariantsFuzzy(name) {
  const base = String(name || '').trim();
  const out = new Set([base]);
  let x = base.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (x) out.add(x);
  x = base.replace(/\s*:\s*.+$/u, '').trim();
  if (x) out.add(x);
  x = base.replace(/\s*(megaways|extreme|deluxe|gold|max|hold\s*and\s*win)\s*$/i, '').trim();
  if (x) out.add(x);
  x = base.replace(/\s*!\s*$/u, '').trim();
  if (x) out.add(x);
  return [...out];
}

function diceCoeffFuzzy(a, b) {
  const x = nameKeyFuzzy(a);
  const y = nameKeyFuzzy(b);
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
  const total =
    [...bx.values()].reduce((s, n) => s + n, 0) +
    [...by.values()].reduce((s, n) => s + n, 0);
  return total > 0 ? (2 * overlap) / total : 0;
}

function buildFuzzyImageRefs(entries) {
  /** @type {Array<{ name: string, provider: string, image: string }>} */
  const all = [];
  /** @type {Map<string, Array<{ name: string, image: string }>>} */
  const byProvider = new Map();
  for (const e of entries) {
    const img = String(e.image || '').trim();
    if (!img || isPlaceholderImage(img)) continue;
    const name = String(e.nom || e.name || e.title || '').trim();
    const provider = String(e.provider || e.Provider || '').trim();
    if (!name) continue;
    const ref = { name, provider, image: img };
    all.push(ref);
    const pk = normFuzzy(provider);
    if (!byProvider.has(pk)) byProvider.set(pk, []);
    byProvider.get(pk).push({ name, image: img });
  }
  return { all, byProvider };
}

/**
 * Reprise floue depuis entrées catalogue déjà illustrées (gd_, etc.).
 * @returns {number}
 */
export function enrichFromFuzzyCatalogMatch(entries) {
  const { all, byProvider } = buildFuzzyImageRefs(entries);
  if (!all.length) return 0;

  const charIndex = new Map();
  for (const ref of all) {
    const c = nameKeyFuzzy(ref.name)[0] || '_';
    if (!charIndex.has(c)) charIndex.set(c, []);
    charIndex.get(c).push(ref);
  }

  let n = 0;
  for (const e of entries) {
    if (!isPlaceholderImage(e.image)) continue;
    const nom = e.nom || e.name || e.title || '';
    const prov = e.provider || e.Provider || '';
    const pv = normFuzzy(prov);
    const variants = nameVariantsFuzzy(nom);
    const scoreAgainst = (refName) => {
      let m = 0;
      for (const v of variants) m = Math.max(m, diceCoeffFuzzy(v, refName));
      return m;
    };

    let bestScore = 0;
    let bestImage = '';
    const sameList = byProvider.get(pv) || [];
    for (const ref of sameList) {
      const sc = scoreAgainst(ref.name);
      if (sc > bestScore) {
        bestScore = sc;
        bestImage = ref.image;
      }
    }
    if (bestScore >= 0.72 && bestImage) {
      e.image = bestImage;
      n++;
      continue;
    }

    bestScore = 0;
    bestImage = '';
    const c0 = nameKeyFuzzy(nom)[0] || '_';
    const pool = charIndex.get(c0) || all;
    for (const ref of pool) {
      const sc = scoreAgainst(ref.name);
      if (sc > bestScore) {
        bestScore = sc;
        bestImage = ref.image;
      }
    }
    if (bestScore >= 0.86 && bestImage) {
      e.image = bestImage;
      n++;
    }
  }
  return n;
}

/**
 * Indexe les images « réelles » déjà présentes dans le catalogue.
 * @param {Array<object>} entries
 * @returns {Map<string, string>}
 */
export function buildLooseImageMap(entries) {
  const m = new Map();
  for (const e of entries) {
    const img = String(e.image || '').trim();
    if (!img || isPlaceholderImage(img)) continue;
    const nom = e.nom || e.name || e.title || '';
    const prov = e.provider || e.Provider || '';
    const k = looseCatalogKey(nom, prov);
    if (!m.has(k)) m.set(k, img);
  }
  return m;
}

/**
 * Copie les vignettes lorsque le même jeu existe déjà sous un autre id (gd_, stake_, etc.).
 * @returns {number} nombre d’entrées mises à jour
 */
export function enrichFromLooseNameMatches(entries) {
  const map = buildLooseImageMap(entries);
  let n = 0;
  for (const e of entries) {
    if (!isPlaceholderImage(e.image)) continue;
    const nom = e.nom || e.name || e.title || '';
    const prov = e.provider || e.Provider || '';
    const k = looseCatalogKey(nom, prov);
    const img = map.get(k);
    if (img) {
      e.image = img;
      n++;
    }
  }
  return n;
}

/** Dossiers Hub88 connus (slug slot.report → dossier cdn). */
const HUB_FOLDER_BY_PROVIDER_SLUG = {
  'hacksaw-gaming': 'hacksawgaming',
  'hacksaw': 'hacksawgaming',
  'pragmatic-play': 'pragmatic',
  'pragmatic': 'pragmatic',
  'playngo': 'playngo',
  'play-n-go': 'playngo',
  'nolimit-city': 'nolimitcity',
  'relax-gaming': 'relaxgaming',
  'relax': 'relaxgaming',
  'red-tiger': 'redtiger',
  'push-gaming': 'push',
  'netent': 'netent',
  'big-time-gaming': 'btg',
  'btg': 'btg',
  'endorphina': 'endorphina',
  'betsoft': 'betsoft',
  'avatarux': 'avatarux',
  'avatar-ux': 'avatarux',
  'yggdrasil': 'yggdrasil',
  'microgaming': 'microgaming',
  'games-global': 'microgaming',
  'wazdan': 'wazdan',
  'kalamba-games': 'kalamba',
  'kalamba': 'kalamba',
  'spinomenal': 'spinomenal',
  'octoplay': 'octoplay',
  'pg-soft': 'pgsoft',
  'pgsoft': 'pgsoft',
  'evolution': 'evolution',
  'gameburger-studios': 'gameburger',
  'foxium': 'foxium',
  'fantasma-games': 'fantasma',
  'just-for-the-win': 'jftw',
  'reelplay': 'relaxgaming',
  'reel-play': 'relaxgaming',
  'alchemy-gaming': 'alchemygaming',
};

function hubFolderForProviderSlug(slug) {
  const s = String(slug || '')
    .toLowerCase()
    .trim();
  if (HUB_FOLDER_BY_PROVIDER_SLUG[s]) return HUB_FOLDER_BY_PROVIDER_SLUG[s];
  const compact = s.replace(/[^a-z0-9]/g, '');
  for (const [k, v] of Object.entries(HUB_FOLDER_BY_PROVIDER_SLUG)) {
    if (k.replace(/[^a-z0-9]/g, '') === compact) return v;
  }
  return '';
}

const FETCH_IMG_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
  referer: 'https://gamdom.com/',
};

const FETCH_HTML_HEADERS = {
  'user-agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8',
  'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
};

const GENERIC_GAMDOM_OG_RE =
  /og_gamdom|placehold\.co|via\.placeholder|\/static\/img\/og[_-]/i;

const GAME_THUMB_URL_RE =
  /https?:\/\/[^\s"'<>\\]+(?:ppgames\.net|cdn\.hub88\.io|usercontent\.cc|thumbs\.alea\.com|gamdom\.com\/static\/dyn)[^\s"'<>\\]*/gi;

function extractOgImageFromHtml(html) {
  const t = String(html || '');
  const m =
    t.match(/property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    t.match(/content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  return m?.[1]?.trim() || '';
}

function scoreGameThumbnailUrl(url) {
  const u = String(url || '').toLowerCase();
  if (!u.startsWith('http') || GENERIC_GAMDOM_OG_RE.test(u)) return 0;
  if (u.includes('ppgames.net') && u.includes('slots-lobby-assets')) return 100;
  if (u.includes('cdn.hub88.io')) return 90;
  if (u.includes('usercontent.cc')) return 85;
  if (u.includes('thumbs.alea.com')) return 80;
  if (u.includes('gamdom.com/static/dyn')) return 75;
  if (u.includes('ppgames.net')) return 70;
  return 0;
}

/** Meilleure vignette jeu dans le HTML SEO Gamdom (ignore og: générique). */
export function pickGameThumbnailFromGamdomHtml(html) {
  const candidates = [];
  const og = extractOgImageFromHtml(html);
  if (og) candidates.push(og);
  const found = String(html || '').match(GAME_THUMB_URL_RE) || [];
  for (const raw of found) {
    candidates.push(raw.replace(/\\u002F/g, '/').replace(/&amp;/g, '&'));
  }
  let best = '';
  let bestScore = 0;
  const seen = new Set();
  for (const u of candidates) {
    if (!u || seen.has(u)) continue;
    seen.add(u);
    const sc = scoreGameThumbnailUrl(u);
    if (sc > bestScore) {
      bestScore = sc;
      best = u;
    }
  }
  return bestScore > 0 ? best : '';
}

export async function fetchGamdomPageThumbnail(pageUrl, timeoutMs = 14000) {
  const url = String(pageUrl || '').trim();
  if (!url.includes('gamdom.com')) return '';
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      headers: FETCH_HTML_HEADERS,
      signal: ac.signal,
      redirect: 'follow',
    });
    if (!r.ok) return '';
    const html = await r.text();
    const picked = pickGameThumbnailFromGamdomHtml(html);
    if (!picked) return '';
    if (await urlLooksLikeImage(picked, 6000)) return picked;
    return picked;
  } catch {
    return '';
  } finally {
    clearTimeout(t);
  }
}

function gamdomSeoUrlForEntry(e) {
  const existing = String(e.gamdomUrl || '').trim();
  if (existing.includes('gamdom.com') && !existing.includes('/slots/search')) {
    return existing;
  }
  const nom = e.nom || e.name || e.title || '';
  const prov = e.provider || e.Provider || '';
  const a = gamdomSlugPart(nom);
  const b = gamdomSlugPart(prov);
  if (!a || !b) return '';
  return `https://gamdom.com/fr-fr/casino/${a}-${b}`;
}

/**
 * Scrape les pages SEO Gamdom (Pragmatic ppgames, parfois Hub88 dans le HTML).
 * @returns {Promise<number>}
 */
export async function enrichSrFromGamdomPages(
  entries,
  { maxFetches = 400, concurrency = 6, delayMs = 80 } = {}
) {
  const unlimited =
    !maxFetches || maxFetches < 0 || maxFetches === Number.POSITIVE_INFINITY;
  const queue = [];
  for (const e of entries) {
    const id = String(e.id || '');
    if (!id.startsWith('sr_')) continue;
    if (!isPlaceholderImage(e.image)) continue;
    const pageUrl = gamdomSeoUrlForEntry(e);
    if (!pageUrl) continue;
    queue.push({ e, pageUrl });
  }
  if (!queue.length) return 0;

  const limit = unlimited ? queue.length : Math.min(queue.length, maxFetches);
  const work = queue.slice(0, limit);
  let n = 0;
  let idx = 0;

  async function worker() {
    while (idx < work.length) {
      const i = idx++;
      const { e, pageUrl } = work[i];
      const img = await fetchGamdomPageThumbnail(pageUrl);
      if (img && isPlaceholderImage(e.image)) {
        e.image = img;
        n++;
      }
      if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
    }
  }

  const workers = Math.min(concurrency, work.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return n;
}

async function urlLooksLikeImage(url, timeoutMs = 8000) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    let r = await fetch(url, {
      method: 'HEAD',
      headers: FETCH_IMG_HEADERS,
      signal: ac.signal,
    });
    let ct = r.headers.get('content-type') || '';
    if (r.ok && /^image\//i.test(ct)) return true;
    if (r.status === 405 || !r.ok) {
      r = await fetch(url, {
        method: 'GET',
        headers: { ...FETCH_IMG_HEADERS, Range: 'bytes=0-2048' },
        signal: ac.signal,
      });
      ct = r.headers.get('content-type') || '';
      return r.ok && /^image\//i.test(ct);
    }
    return r.ok && /^image\//i.test(ct);
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

/** Secours : préfixes usuels par dossier Hub88 (clé = dossier en minuscules). */
const DEFAULT_FOLDER_PREFIXES = {
  hacksawgaming: ['hsg'],
  pragmatic: ['pgs'],
  nolimitcity: ['nlc'],
  playngo: ['png'],
  relaxgaming: ['rlx', 'big'],
  relax: ['rlx'],
  redtiger: ['rtg'],
  netent: ['ntn'],
  push: ['psh'],
  btg: ['btg'],
  yggdrasil: ['ygg'],
  endorphina: ['end'],
  microgaming: ['mgg'],
  betsoft: ['bst'],
  avatarux: ['avx'],
  wazdan: ['wzn'],
  kalamba: ['klb'],
  spinomenal: ['spm'],
  octoplay: ['oct'],
  pgsoft: ['pgs'],
  evolution: ['evo'],
  egt: ['egt'],
  booongo: ['boo'],
  voltent: ['vlt'],
  trueflip: ['tfl'],
  gameburger: ['gbs'],
  foxium: ['fox'],
  fantasma: ['fan'],
  jftw: ['jfw'],
  alchemygaming: ['alg'],
  genii: ['gnii'],
  fazi: ['faz'],
  shadylady: ['shd'],
  slotmill: ['slm'],
  spinplaygames: ['spg'],
  nekogames: ['nek'],
  onetouch: ['ont'],
  peterandsons: ['pas'],
  penguinking: ['pkg'],
  indislots: ['ind'],
  caleta: ['cal'],
  mgasia: ['mga'],
  novomatic: ['nov'],
};

function hubFolderKey(folder) {
  try {
    return decodeURIComponent(String(folder || '')).toLowerCase();
  } catch {
    return String(folder || '').toLowerCase();
  }
}

/**
 * Déduit le dossier Hub88 dominant par nom de fournisseur (entrées déjà avec vignette Hub88).
 * @param {Array<object>} entries
 * @returns {Map<string, string>}
 */
export function mineNormProviderToHubFolder(entries) {
  /** @type {Map<string, Map<string, number>>} */
  const perPk = new Map();
  for (const e of entries) {
    const img = String(e.image || '');
    const m = img.match(/cdn\.hub88\.io\/([^/]+)\//i);
    if (!m) continue;
    const pk = normLoose(e.provider || e.Provider || '');
    if (!pk) continue;
    const folder = m[1];
    if (!perPk.has(pk)) perPk.set(pk, new Map());
    const fm = perPk.get(pk);
    fm.set(folder, (fm.get(folder) || 0) + 1);
  }
  /** @type {Map<string, string>} */
  const best = new Map();
  for (const [pk, fm] of perPk) {
    let bf = '';
    let bc = 0;
    for (const [f, c] of fm) {
      if (c > bc) {
        bc = c;
        bf = f;
      }
    }
    if (bf) best.set(pk, bf);
  }
  return best;
}

function extractFilenamePrefix(filename) {
  const base = String(filename || '')
    .replace(/\.(jpg|jpeg|png|webp)$/i, '')
    .replace(/-thumb$/i, '')
    .replace(/_thumbnail$/i, '');
  const i = base.indexOf('_');
  if (i < 2 || i > 8) return '';
  const pre = base.slice(0, i).toLowerCase();
  if (!/^[a-z0-9]{2,6}$/.test(pre)) return '';
  return pre;
}

/**
 * Préfixes de fichiers les plus fréquents par dossier Hub88 (calculé sur le catalogue).
 * @returns {Map<string, string[]>} clé = hubFolderKey(folder)
 */
export function mineHubFolderPrefixes(entries) {
  /** @type {Map<string, Map<string, number>>} */
  const perFolder = new Map();
  for (const e of entries) {
    const img = String(e.image || '');
    const m = img.match(/cdn\.hub88\.io\/([^/]+)\/([^/?]+)$/i);
    if (!m) continue;
    const fk = hubFolderKey(m[1]);
    const fn = m[2];
    const pref = extractFilenamePrefix(fn);
    if (!pref) continue;
    if (!perFolder.has(fk)) perFolder.set(fk, new Map());
    const pm = perFolder.get(fk);
    pm.set(pref, (pm.get(pref) || 0) + 1);
  }
  /** @type {Map<string, string[]>} */
  const out = new Map();
  for (const [fk, pm] of perFolder) {
    const sorted = [...pm.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([p]) => p);
    out.set(fk, sorted);
  }
  return out;
}

function resolveHubFolder(providerSlug, providerName, mineProviderToFolder) {
  let folder = hubFolderForProviderSlug(providerSlug);
  if (folder) return folder;
  const pk = normLoose(providerName || '');
  if (pk && mineProviderToFolder.has(pk)) return mineProviderToFolder.get(pk);
  return '';
}

/**
 * Construit une liste de candidats Hub88 (ordre : mining → défauts → variantes nom).
 * @param {string[]} minedPrefixes
 */
function buildHub88CandidateUrls(folder, slug, minedPrefixes = []) {
  const slugClean = String(slug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .trim();
  if (!folder || !slugClean) return [];
  const stem = slugClean.replace(/-/g, '');
  const fk = hubFolderKey(folder);
  const def = DEFAULT_FOLDER_PREFIXES[fk] || [];
  const prefs = [...new Set([...minedPrefixes, ...def])].filter(Boolean);
  const base = `https://cdn.hub88.io/${folder}`;
  const exts = ['jpg', 'png', 'webp'];
  /** @type {string[]} */
  const urls = [];
  const add = (u) => {
    if (!urls.includes(u)) urls.push(u);
  };

  for (const px of prefs) {
    for (const ext of exts) {
      add(`${base}/${px}_${stem}.${ext}`);
    }
  }

  add(`${base}/${slugClean}-thumbnail.jpg`);
  add(`${base}/${slugClean}-thumbnail.png`);
  add(`${base}/${stem}-thumbnail.jpg`);
  add(`${base}/${slugClean}.jpg`);
  add(`${base}/${slugClean}.png`);
  add(`${base}/${stem}.jpg`);

  if (fk === 'hacksawgaming') {
    const words = slugClean.split('-').filter(Boolean);
    if (words.length) {
      const pascalSnake = words
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('_');
      add(`${base}/${pascalSnake}_thumb.jpg`);
      add(`${base}/${pascalSnake}_Thumbnail.jpg`);
      add(`${base}/${pascalSnake}_thumb.png`);
    }
  }

  return urls.slice(0, 96);
}

async function firstUrlHit(urls, batchSize = 14) {
  for (let i = 0; i < urls.length; i += batchSize) {
    const chunk = urls.slice(i, i + batchSize);
    const hits = await Promise.all(
      chunk.map(async (u) => ((await urlLooksLikeImage(u)) ? u : null))
    );
    const ok = hits.find(Boolean);
    if (ok) return ok;
  }
  return '';
}

/**
 * Probe Hub88 avec mining optionnel (dossier / préfixes depuis le catalogue).
 */
export async function probeHub88Thumbnail(
  providerSlug,
  slotSlug,
  providerName,
  { mineProviderToFolder = new Map(), mineFolderPrefixes = new Map() } = {}
) {
  const slug = String(slotSlug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .trim();
  if (!slug) return '';
  const folder = resolveHubFolder(providerSlug, providerName, mineProviderToFolder);
  if (!folder) return '';
  const fk = hubFolderKey(folder);
  const minedPrefs = mineFolderPrefixes.get(fk) || [];
  const urls = buildHub88CandidateUrls(folder, slug, minedPrefs);
  return firstUrlHit(urls, 14);
}

/**
 * Tente des URLs Hub88 (rétrocompatible : sans mining, préfixes par défaut uniquement).
 */
export async function tryHub88Thumbnail(providerSlug, slotSlug) {
  return probeHub88Thumbnail(providerSlug, slotSlug, '', {
    mineProviderToFolder: new Map(),
    mineFolderPrefixes: new Map(),
  });
}

/**
 * Pour chaque entrée sr_* encore en placeholder : srSlug + probe Hub88.
 * `maxProbes` <= 0 : traite toutes les entrées éligibles.
 * @returns {Promise<number>}
 */
export async function enrichSrFromHub88Probes(entries, { maxProbes = 120 } = {}) {
  const mineProviderToFolder = mineNormProviderToHubFolder(entries);
  const mineFolderPrefixes = mineHubFolderPrefixes(entries);
  const unlimited = !maxProbes || maxProbes < 0 || maxProbes === Number.POSITIVE_INFINITY;
  let done = 0;
  let n = 0;
  for (const e of entries) {
    if (!unlimited && done >= maxProbes) break;
    const id = String(e.id || '');
    if (!id.startsWith('sr_')) continue;
    if (!isPlaceholderImage(e.image)) continue;
    const slug = String(e.srSlug || '').trim();
    if (!slug) continue;
    const rest = id.slice(3);
    const us = rest.indexOf('_');
    const pslugFromId = us >= 0 ? rest.slice(0, us) : '';
    const pslug = String(e.srProviderSlug || '').trim().toLowerCase() || pslugFromId;
    done++;
    const prov = e.provider || e.Provider || '';
    const img = await probeHub88Thumbnail(pslug, slug, prov, {
      mineProviderToFolder,
      mineFolderPrefixes,
    });
    if (img) {
      e.image = img;
      n++;
    }
    await new Promise((r) => setTimeout(r, 12));
  }
  return n;
}

/**
 * Ajoute srSlug / srProviderSlug aux entrées sr_* depuis l’API slot.report (même ids que le sync).
 */
export async function backfillSrSlugMetadata(entries) {
  const res = await fetch('https://slot.report/api/v1/slots.json', {
    headers: {
      accept: 'application/json',
      'user-agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36',
    },
  });
  if (!res.ok) return 0;
  const data = await res.json();
  const rows = Array.isArray(data.results) ? data.results : [];
  const byId = new Map();
  for (let idx = 0; idx < rows.length; idx++) {
    const s = rows[idx];
    const providerSlug = String(s.provider_slug || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    const slotSlug = String(s.slug || `slot-${idx}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    byId.set(`sr_${providerSlug}_${slotSlug}`, {
      srSlug: String(s.slug || '').trim(),
      srProviderSlug: String(s.provider_slug || '').trim().toLowerCase(),
    });
  }
  let n = 0;
  for (const e of entries) {
    const id = String(e.id || '');
    if (!id.startsWith('sr_')) continue;
    const meta = byId.get(id);
    if (!meta) continue;
    let touched = false;
    if (!e.srSlug && meta.srSlug) {
      e.srSlug = meta.srSlug;
      touched = true;
    }
    if (!e.srProviderSlug && meta.srProviderSlug) {
      e.srProviderSlug = meta.srProviderSlug;
      touched = true;
    }
    if (touched) n++;
  }
  return n;
}

function gamdomSlugPart(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''`´]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

/** Remplace les vieux liens /slots/search par l’URL SEO Gamdom quand possible. */
export function upgradeSrGamdomUrlsToSeo(entries) {
  let n = 0;
  for (const e of entries) {
    const id = String(e.id || '');
    if (!id.startsWith('sr_')) continue;
    const u = String(e.gamdomUrl || '');
    if (!u.includes('gamdom.com/slots/search')) continue;
    const nom = e.nom || e.name || '';
    const prov = e.provider || '';
    const a = gamdomSlugPart(nom);
    const b = gamdomSlugPart(prov);
    if (a && b) {
      e.gamdomUrl = `https://gamdom.com/fr-fr/casino/${a}-${b}`;
      n++;
    }
  }
  return n;
}

/**
 * Surcharges manuelles si aucun CDN ne publie encore la vignette (id sr_*).
 * Compléter au fil des sorties très récentes.
 */
export const MANUAL_THUMB_BY_SR_ID = {
  'sr_pragmatic-play_the-big-dog-house':
    'https://common-static.ppgames.net/gs2c/common/lobby/v1/apps/slots-lobby-assets/vs20bgdoghouse/vs20bgdoghouse_325x234_NB.png',
};

/**
 * Pipeline complet : métadonnées → correspondances → Gamdom HTML → Hub88.
 */
export async function enrichCatalogImages(entries, {
  hubMax = 400,
  skipHub = false,
  gamdomMax = 400,
  skipGamdom = false,
} = {}) {
  const u0 = upgradeSrGamdomUrlsToSeo(entries);
  let manual = 0;
  for (const e of entries) {
    const id = String(e.id || '');
    const ov = MANUAL_THUMB_BY_SR_ID[id];
    if (ov && isPlaceholderImage(e.image)) {
      e.image = ov;
      manual++;
    }
  }
  const m0 = await backfillSrSlugMetadata(entries);
  const m1 = enrichFromLooseNameMatches(entries);
  const mFuzzy = enrichFromFuzzyCatalogMatch(entries);
  const mGamdom = skipGamdom
    ? 0
    : await enrichSrFromGamdomPages(entries, { maxFetches: gamdomMax });
  const m2 = skipHub ? 0 : await enrichSrFromHub88Probes(entries, { maxProbes: hubMax });
  return {
    seoUrls: u0,
    manual,
    meta: m0,
    loose: m1,
    fuzzy: mFuzzy,
    gamdom: mGamdom,
    hub88: m2,
  };
}
