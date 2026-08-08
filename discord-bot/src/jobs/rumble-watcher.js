import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import { fetchRumbleVideos, rumbleChannelPublicUrl } from '../lib/rumble-feed.js';
import { getBotState, setBotState } from '../supabase.js';
import { getChannelSafe } from '../discord/client.js';

const log = child({ mod: 'rumble' });
const STATE_KEY = 'rumble_videos';
const CHANNEL_LOOKBACK_HOURS = 72;

async function loadIndex() {
  const raw = await getBotState(STATE_KEY);
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
}

async function saveVideo(videoId, patch) {
  const index = await loadIndex();
  index[videoId] = { ...(index[videoId] || {}), ...patch, video_id: videoId };
  await setBotState(STATE_KEY, index);
}

export async function runRumbleCheck() {
  const slug = config.rumble.userSlug;
  if (!slug) { log.warn('RUMBLE_USER_SLUG non défini, skip'); return { skipped: true }; }
  if (!config.discord.channels.rumble) {
    log.warn('DISCORD_CHANNEL_RUMBLE non défini, skip');
    return { skipped: true };
  }

  const start = Date.now();
  let items;
  try {
    items = await fetchRumbleVideos(config.rumble, { limit: 10 });
  } catch (e) {
    log.warn({ msg: e.message, code: e.code || '' }, 'fetchRumbleVideos failed');
    return { error: e.message };
  }
  if (!items.length) return { count: 0 };

  const index = await loadIndex();
  let posted = 0;
  for (const item of [...items].reverse()) {
    try {
      const row = index[item.videoId] || null;
      const publishedAt = item.publishedAt ? new Date(item.publishedAt) : new Date();
      const tooOld = !row && (Date.now() - publishedAt.getTime()) / 36e5 > CHANNEL_LOOKBACK_HOURS;

      if (!row) {
        await saveVideo(item.videoId, {
          channel_slug: item.channelSlug || slug,
          channel_label: config.rumble.channelLabel || item.author || '',
          title: item.title,
          url: item.url,
          thumbnail: item.thumbnail || null,
          published_at: publishedAt.toISOString(),
        });
      }
      if (row?.posted_to_discord_at || tooOld) continue;

      const announced = await announce(item);
      if (announced) {
        await saveVideo(item.videoId, {
          posted_to_discord_at: new Date().toISOString(),
          discord_message_id: announced.id || null,
        });
        posted += 1;
      }
    } catch (e) {
      log.warn({ err: e, videoId: item.videoId }, 'process rumble video failed');
    }
  }
  log.info({ posted, totalSeen: items.length, ms: Date.now() - start }, 'Rumble check done');
  return { posted, totalSeen: items.length };
}

async function announce(item) {
  const ch = await getChannelSafe(config.discord.channels.rumble);
  if (!ch) { log.warn('Channel Rumble non configuré ou introuvable'); return null; }
  const label = config.rumble.channelLabel || '19enplein';
  const channelUrl = rumbleChannelPublicUrl(config.rumble);
  const embed = new EmbedBuilder()
    .setColor(0x85C742)
    .setAuthor({ name: `Nouvelle vidéo · ${label}`, url: channelUrl })
    .setTitle(item.title?.slice(0, 250) || 'Nouvelle vidéo')
    .setURL(item.url)
    .setImage(item.thumbnail || null)
    .setTimestamp(item.publishedAt ? new Date(item.publishedAt) : new Date())
    .setFooter({ text: `Rumble · ${label}` });
  try {
    return await ch.send({
      content: `@everyone 🎬 **${label}** vient de poster sur Rumble !`,
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] },
    });
  } catch (e) {
    log.warn({ err: e }, 'Discord send failed');
    return null;
  }
}

/** Export pour scripts de test. */
export { announce as announceRumbleVideo, saveVideo as saveRumbleVideoRecord };
