import { request } from 'undici';
import { child } from './logger.js';

const log = child({ mod: 'rumble-feed' });

const BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/120.0.0.0 Safari/537.36';

/** Slug utilisateur ou URL complète → https://rumble.com/user/{slug} */
export function rumbleChannelPageUrl(cfg) {
  const raw = String(cfg?.userSlug || cfg?.channelUrl || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw.replace(/\?.*$/, '');
  const slug = raw.replace(/^@/, '').replace(/^\/+|\/+$/g, '');
  return slug ? `https://rumble.com/user/${encodeURIComponent(slug)}` : '';
}

export function rumbleChannelPublicUrl(cfg) {
  const page = rumbleChannelPageUrl(cfg);
  return page || 'https://rumble.com/';
}

function mapGridItem(it, cfg, channelSlug) {
  return {
    videoId: String(it.permalink_id),
    title: String(it.title || '').trim(),
    url: String(it.url || `https://rumble.com/${it.permalink_id}`).trim(),
    thumbnail: String(it.thumb || '').trim(),
    publishedAt: String(it.upload_date || it.live_streamed_on || it.live_datetime || ''),
    channelSlug,
    author: String(it.by?.name || cfg.channelLabel || '').trim(),
    live: it.live === true,
    livestreamStatus: Number(it.livestream_status || 0),
    watchingNow: it.watching_now != null ? Number(it.watching_now) : null,
    streamId: String(it.id || it.permalink_id || ''),
  };
}

async function fetchChannelGrid(cfg, { timeoutMs = 15000 } = {}) {
  const pageUrl = rumbleChannelPageUrl(cfg);
  if (!pageUrl) return { pageUrl: '', items: [] };

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const { statusCode, body } = await request(pageUrl, {
      method: 'GET',
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'fr-FR,fr;q=0.9,en;q=0.8',
      },
      signal: ac.signal,
    });
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`HTTP ${statusCode} sur ${pageUrl}`);
    }
    const html = await body.text();
    const gridMatch = html.match(/<rum-videos-grid>\s*<script type="application\/json">\s*([\s\S]*?)\s*<\/script>/);
    if (!gridMatch) {
      log.warn({ pageUrl }, 'rum-videos-grid JSON introuvable');
      return { pageUrl, items: [] };
    }
    const data = JSON.parse(gridMatch[1]);
    const slugMatch = pageUrl.match(/\/user\/([^/?#]+)/i);
    const channelSlug = slugMatch?.[1] || cfg.userSlug || '';
    const items = (data.items || [])
      .filter((it) => it?.object_type === 'video' && it?.permalink_id)
      .map((it) => mapGridItem(it, cfg, channelSlug));
    return { pageUrl, items };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Récupère les dernières vidéos depuis la page chaîne Rumble.
 */
export async function fetchRumbleVideos(cfg, { limit = 10, timeoutMs = 15000 } = {}) {
  try {
    const { items } = await fetchChannelGrid(cfg, { timeoutMs });
    return items.slice(0, limit);
  } catch (e) {
    const code = e?.code || e?.cause?.code || '';
    const msg = e?.message || String(e);
    const err = new Error(`fetchRumbleVideos échoué : ${code ? `[${code}] ` : ''}${msg}`);
    err.code = code;
    throw err;
  }
}

async function fetchRumbleLiveApi(apiUrl, { timeoutMs = 12000 } = {}) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const { statusCode, body } = await request(apiUrl, {
      method: 'GET',
      headers: {
        'user-agent': BROWSER_UA,
        accept: 'application/json,text/plain,*/*',
      },
      signal: ac.signal,
    });
    if (statusCode < 200 || statusCode >= 300) {
      throw new Error(`HTTP ${statusCode} sur API live Rumble`);
    }
    const data = JSON.parse(await body.text());
    const live = (data.livestreams || []).find((s) => s?.is_live === true);
    if (!live) return null;
    return {
      streamId: String(live.id || live.stream_key || live.title || 'live'),
      title: String(live.title || 'Live Rumble').trim(),
      url: String(live.url || '').trim(),
      thumbnail: String(live.thumb || live.thumbnail || '').trim(),
      watchingNow: live.watching_now != null ? Number(live.watching_now) : null,
      startedAt: String(live.created_on || ''),
      source: 'api',
    };
  } finally {
    clearTimeout(timer);
  }
}

function findLiveOnGridItems(items, cfg) {
  const liveItem = items.find((it) => it.live === true);
  if (!liveItem) return null;
  return {
    streamId: liveItem.streamId || liveItem.videoId,
    title: liveItem.title,
    url: liveItem.url,
    thumbnail: liveItem.thumbnail,
    watchingNow: liveItem.watchingNow,
    startedAt: liveItem.publishedAt,
    source: 'page',
  };
}

/**
 * Retourne le live en cours (ou null). API officielle si RUMBLE_LIVE_API_URL, sinon page chaîne.
 */
export async function fetchRumbleLiveStream(cfg) {
  let fromApi = null;
  if (cfg.liveApiUrl) {
    try {
      fromApi = await fetchRumbleLiveApi(cfg.liveApiUrl);
    } catch (e) {
      log.warn({ err: e }, 'fetchRumbleLiveApi failed');
    }
  }

  let fromPage = null;
  try {
    const { items } = await fetchChannelGrid(cfg);
    fromPage = findLiveOnGridItems(items, cfg);
  } catch (e) {
    log.warn({ err: e }, 'fetchChannelGrid for live failed');
    if (fromApi) {
      return {
        ...fromApi,
        url: fromApi.url || rumbleChannelPublicUrl(cfg),
      };
    }
    throw e;
  }

  if (fromApi && fromPage) {
    return {
      streamId: fromPage.streamId || fromApi.streamId,
      title: fromPage.title || fromApi.title,
      url: fromPage.url || fromApi.url || rumbleChannelPublicUrl(cfg),
      thumbnail: fromPage.thumbnail || fromApi.thumbnail || null,
      watchingNow: fromPage.watchingNow ?? fromApi.watchingNow,
      startedAt: fromPage.startedAt || fromApi.startedAt,
      source: 'api+page',
    };
  }
  if (fromPage) return fromPage;
  if (fromApi) {
    return {
      ...fromApi,
      url: fromApi.url || rumbleChannelPublicUrl(cfg),
    };
  }
  return null;
}
