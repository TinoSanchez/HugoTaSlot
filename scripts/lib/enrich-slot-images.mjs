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
  'red-tiger': 'redtiger',
  'push-gaming': 'push',
  'netent': 'netent',
  'big-time-gaming': 'btg',
  'btg': 'btg',
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

/**
 * Tente des URLs Hub88 courantes (surtout Hacksaw hsg_*).
 */
export async function tryHub88Thumbnail(providerSlug, slotSlug) {
  const folder = hubFolderForProviderSlug(providerSlug);
  const slug = String(slotSlug || '')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .trim();
  if (!folder || !slug) return '';

  const stem = slug.replace(/-/g, '');
  const base = `https://cdn.hub88.io/${folder}`;
  const candidates = [];

  if (folder === 'hacksawgaming') {
    candidates.push(
      `${base}/hsg_${stem}.jpg`,
      `${base}/hsg_${stem}.png`,
      `${base}/${slug}-thumbnail.jpg`,
      `${base}/${slug}-thumbnail.png`
    );
    const words = slug.split('-').filter(Boolean);
    if (words.length) {
      const pascalSnake = words
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join('_');
      candidates.push(
        `${base}/${pascalSnake}_thumb.jpg`,
        `${base}/${pascalSnake}_Thumbnail.jpg`,
        `${base}/${pascalSnake}_thumb.png`
      );
    }
  }
  if (folder === 'pragmatic') {
    candidates.push(
      `${base}/pgs_${stem}.jpg`,
      `${base}/pgs_${stem}.png`,
      `${base}/${slug}.png`,
      `${base}/${slug}.jpg`
    );
  }
  if (folder === 'nolimitcity') {
    candidates.push(`${base}/nlc_${stem}.jpg`, `${base}/nlc_${stem}.png`);
  }
  if (folder === 'playngo') {
    candidates.push(`${base}/png_${stem}.jpg`, `${base}/png_${stem}.png`);
  }

  for (const url of candidates) {
    if (await urlLooksLikeImage(url)) return url;
  }
  return '';
}

/**
 * Pour chaque entrée sr_* encore en placeholder : srSlug + probe Hub88.
 * @returns {Promise<number>}
 */
export async function enrichSrFromHub88Probes(entries, { maxProbes = 120 } = {}) {
  let done = 0;
  let n = 0;
  for (const e of entries) {
    if (done >= maxProbes) break;
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
    const img = await tryHub88Thumbnail(pslug, slug);
    if (img) {
      e.image = img;
      n++;
    }
    await new Promise((r) => setTimeout(r, 40));
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
  // Ex. : 'sr_hacksaw-gaming_le-hooligan': 'https://…',
};

/**
 * Pipeline complet : métadonnées → correspondances de noms → Hub88.
 */
export async function enrichCatalogImages(entries, {
  hubMax = 400,
  skipHub = false,
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
  const m2 = skipHub ? 0 : await enrichSrFromHub88Probes(entries, { maxProbes: hubMax });
  return { seoUrls: u0, manual, meta: m0, loose: m1, hub88: m2 };
}
