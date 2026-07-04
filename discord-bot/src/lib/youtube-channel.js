import { child } from './logger.js';

const log = child({ mod: 'youtube-channel' });

let cachedChannelId = '';

/** @returns {string} handle sans @ */
export function normalizeYoutubeHandle(raw = '') {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (s.includes('youtube.com/@')) {
    const m = s.match(/youtube\.com\/@([^/?#]+)/i);
    return m ? m[1] : '';
  }
  return s.replace(/^@/, '');
}

/**
 * Résout un @handle ou URL YouTube → channel_id UC… (RSS Atom).
 * @param {string} handleOrUrl
 */
export async function resolveYoutubeChannelId(handleOrUrl) {
  const slug = normalizeYoutubeHandle(handleOrUrl);
  if (!slug) throw new Error('Handle YouTube vide');
  const url = `https://www.youtube.com/@${encodeURIComponent(slug)}`;
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept-Language': 'en-US,en;q=0.9',
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`YouTube @${slug} HTTP ${res.status}`);
  const html = await res.text();
  const patterns = [
    /"externalId":"(UC[^"]+)"/,
    /"channelId":"(UC[^"]+)"/,
    /"browseId":"(UC[^"]+)"/,
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  throw new Error(`channel_id introuvable pour @${slug}`);
}

/**
 * @param {{ channelId?: string, channelHandle?: string }} cfg
 */
export async function getYoutubeChannelId(cfg) {
  const direct = String(cfg.channelId || '').trim();
  if (direct) return direct;
  if (cachedChannelId) return cachedChannelId;
  const handle = normalizeYoutubeHandle(cfg.channelHandle);
  if (!handle) return '';
  cachedChannelId = await resolveYoutubeChannelId(handle);
  log.info({ handle, channelId: cachedChannelId }, 'YouTube channel_id résolu');
  return cachedChannelId;
}

export function youtubeChannelPublicUrl(cfg, channelId = '') {
  const handle = normalizeYoutubeHandle(cfg.channelHandle);
  if (handle) return `https://www.youtube.com/@${handle}`;
  if (channelId) return `https://www.youtube.com/channel/${channelId}`;
  return 'https://www.youtube.com/';
}
