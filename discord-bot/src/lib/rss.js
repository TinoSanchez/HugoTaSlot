import { request } from 'undici';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  removeNSPrefix: false,
  trimValues: true,
});

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

/**
 * Récupère et parse un flux RSS / Atom. Retourne { raw, items: [...] }
 * où chaque item est normalisé : { id, title, url, summary, image, publishedAt }.
 *
 * Important : on utilise un UA navigateur car certains sites (BigWinBoard via Cloudflare)
 * jettent en HTTP 403 les UA "bot".
 */
export async function fetchFeed(url, { kind = 'auto', timeoutMs = 15000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const { statusCode, body, headers } = await request(url, {
      method: 'GET',
      headers: {
        'user-agent': BROWSER_UA,
        'accept-language': 'en-US,en;q=0.9,fr;q=0.8',
        accept: 'application/atom+xml, application/rss+xml, application/xml;q=0.9, text/xml;q=0.8, */*;q=0.5',
      },
      signal: ac.signal,
    });
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`HTTP ${statusCode} sur ${url}`);
    }
    const xml = await body.text();
    const data = parser.parse(xml);
    const isAtom = kind === 'atom' || !!data?.feed?.entry || (kind === 'auto' && !!data?.feed);
    if (isAtom) return { raw: data, items: normalizeAtom(data) };
    return { raw: data, items: normalizeRss(data) };
  } catch (e) {
    // Logs propres : on garde juste le code + message au lieu de dumper le certificat TLS,
    // les Buffers, les chaînes d'issuers, etc.
    const code = e?.code || e?.cause?.code || '';
    const msg = e?.message || e?.cause?.message || String(e);
    let hint = '';
    if (code === 'ERR_TLS_CERT_ALTNAME_INVALID' && /anj\.fr/i.test(msg)) {
      hint = ' (probable blocage ANJ depuis une connexion FR — résolu en prod sur Railway)';
    } else if (code === 'UND_ERR_CONNECT_TIMEOUT' || code === 'ECONNRESET') {
      hint = ' (réseau instable, réessayé au prochain cron)';
    }
    const err = new Error(`fetchFeed ${url} échoué : ${code ? `[${code}] ` : ''}${msg}${hint}`);
    err.code = code;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function asArray(x) {
  if (x === null || x === undefined) return [];
  return Array.isArray(x) ? x : [x];
}

function normalizeAtom(data) {
  const entries = asArray(data?.feed?.entry);
  return entries.map((e) => {
    // YouTube atom feed → media:thumbnail @url, link @href
    const link = asArray(e.link).find((l) => (l['@rel'] || 'alternate') === 'alternate') || asArray(e.link)[0];
    const url = link?.['@href'] || (typeof e.link === 'string' ? e.link : '');
    const media = e['media:group'] || {};
    const thumb = media['media:thumbnail']?.['@url'] || media?.['media:content']?.['@url'] || '';
    const summary = (typeof e.summary === 'string' ? e.summary : e.summary?.['#text']) || media?.['media:description'] || '';
    const videoId = e['yt:videoId'] || '';
    const channelId = e['yt:channelId'] || '';
    const author = (typeof e.author === 'object' ? e.author?.name : e.author) || '';
    return {
      id: String(e.id || videoId || url),
      videoId: videoId ? String(videoId) : null,
      channelId: channelId ? String(channelId) : null,
      title: String(e.title?.['#text'] || e.title || '').trim(),
      url: String(url || '').trim(),
      summary: String(summary || '').trim(),
      image: String(thumb || '').trim(),
      publishedAt: String(e.published || e.updated || ''),
      author: String(author || '').trim(),
    };
  });
}

function normalizeRss(data) {
  const items = asArray(data?.rss?.channel?.item || data?.channel?.item);
  return items.map((it) => {
    const enclosureUrl = it.enclosure?.['@url'] || '';
    const media = it['media:content']?.['@url'] || it['media:thumbnail']?.['@url'] || '';
    const description = typeof it.description === 'string' ? it.description : it.description?.['#text'] || '';
    let image = enclosureUrl || media || '';
    if (!image && typeof description === 'string') {
      const m = description.match(/<img[^>]+src=["']([^"']+)["']/i);
      if (m) image = m[1];
    }
    const guid = (typeof it.guid === 'string' ? it.guid : it.guid?.['#text']) || it.link || it.title || '';
    const categoryRaw = asArray(it.category).map((c) => (typeof c === 'string' ? c : c?.['#text'])).filter(Boolean);
    return {
      id: String(guid),
      title: String(it.title || '').trim(),
      url: String(it.link || '').trim(),
      summary: stripHtml(description).slice(0, 600),
      image: String(image || '').trim(),
      publishedAt: String(it.pubDate || it['dc:date'] || ''),
      author: String((it['dc:creator'] || it.author || '')).trim(),
      categories: categoryRaw.map((c) => String(c).trim()),
    };
  });
}

export function stripHtml(s) {
  return String(s || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}
