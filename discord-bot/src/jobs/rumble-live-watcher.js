import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import { fetchRumbleLiveStream, rumbleChannelPublicUrl } from '../lib/rumble-feed.js';
import { getBotState, setBotState } from '../supabase.js';
import { getChannelSafe } from '../discord/client.js';

const log = child({ mod: 'rumble-live' });
const STATE_KEY = 'rumble_live';

async function loadState() {
  const raw = await getBotState(STATE_KEY);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { activeStreamId: null, announced: {} };
  }
  return {
    activeStreamId: raw.activeStreamId || null,
    announced: raw.announced && typeof raw.announced === 'object' ? raw.announced : {},
  };
}

async function saveState(state) {
  await setBotState(STATE_KEY, state);
}

export async function runRumbleLiveCheck() {
  if (!config.rumble.userSlug) {
    log.warn('RUMBLE_USER_SLUG non défini, skip');
    return { skipped: true };
  }
  if (!config.discord.channels.rumbleLive) {
    log.warn('DISCORD_CHANNEL_RUMBLE_LIVE non défini, skip');
    return { skipped: true };
  }

  const start = Date.now();
  let live;
  try {
    live = await fetchRumbleLiveStream(config.rumble);
  } catch (e) {
    log.warn({ msg: e.message, code: e.code || '' }, 'fetchRumbleLiveStream failed');
    return { error: e.message };
  }

  const state = await loadState();
  if (!live) {
    if (state.activeStreamId) {
      state.activeStreamId = null;
      await saveState(state);
    }
    log.info({ ms: Date.now() - start }, 'Rumble live check — offline');
    return { live: false };
  }

  const streamId = String(live.streamId || live.url || live.title);
  const already = state.announced?.[streamId];
  if (already?.posted_at) {
    state.activeStreamId = streamId;
    await saveState(state);
    log.info({ streamId, ms: Date.now() - start }, 'Rumble live check — déjà annoncé');
    return { live: true, alreadyAnnounced: true, streamId };
  }

  const announced = await announceLive(live);
  if (announced) {
    state.activeStreamId = streamId;
    state.announced[streamId] = {
      posted_at: new Date().toISOString(),
      message_id: announced.id || null,
      title: live.title,
      url: live.url,
    };
    await saveState(state);
    log.info({ streamId, ms: Date.now() - start }, 'Rumble live annoncé');
    return { live: true, posted: true, streamId };
  }

  return { live: true, posted: false, streamId };
}

async function announceLive(live) {
  const ch = await getChannelSafe(config.discord.channels.rumbleLive);
  if (!ch) {
    log.warn('Channel Rumble live non configuré ou introuvable');
    return null;
  }
  const label = config.rumble.channelLabel || '19enplein';
  const channelUrl = rumbleChannelPublicUrl(config.rumble);
  const embed = new EmbedBuilder()
    .setColor(0xFF4500)
    .setAuthor({ name: `🔴 EN LIVE · ${label}`, url: channelUrl })
    .setTitle(live.title?.slice(0, 250) || `${label} est en live !`)
    .setURL(live.url || channelUrl)
    .setTimestamp(live.startedAt ? new Date(live.startedAt) : new Date())
    .setFooter({ text: `Rumble Live · ${label}` });
  if (live.thumbnail) embed.setImage(live.thumbnail);
  const viewers = live.watchingNow != null && live.watchingNow >= 0
    ? `\n👀 **${live.watchingNow}** viewer${live.watchingNow > 1 ? 's' : ''}`
    : '';
  try {
    return await ch.send({
      content: `@everyone 🔴 **${label}** est en live sur Rumble !${viewers}`,
      embeds: [embed],
      allowedMentions: { parse: ['everyone'] },
    });
  } catch (e) {
    log.warn({ err: e }, 'Discord send live failed');
    return null;
  }
}

export { announceLive as announceRumbleLive };
