import { EmbedBuilder } from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import { fetchFeed } from '../lib/rss.js';
import { getYoutubeChannelId, youtubeChannelPublicUrl } from '../lib/youtube-channel.js';
import { supabase } from '../supabase.js';
import { getChannelSafe } from '../discord/client.js';

const log = child({ mod: 'youtube' });
const CHANNEL_LOOKBACK_HOURS = 72; // ne pas spammer si on redécouvre des très vieilles vidéos

export async function runYoutubeCheck() {
  const channelId = await getYoutubeChannelId(config.youtube);
  if (!channelId) { log.warn('YOUTUBE_CHANNEL_ID / YOUTUBE_CHANNEL_HANDLE non défini, skip'); return { skipped: true }; }
  const url = config.youtube.rssUrl(channelId);
  if (!url) return { skipped: true };
  const start = Date.now();
  let feed;
  try {
    feed = await fetchFeed(url, { kind: 'atom' });
  } catch (e) {
    log.warn({ msg: e.message, code: e.code || '' }, 'fetchFeed YouTube failed');
    return { error: e.message };
  }
  const items = (feed.items || []).filter((i) => i.videoId).slice(0, 10); // RSS = 15 derniers
  if (!items.length) return { count: 0 };

  let posted = 0;
  for (const item of items.reverse()) { // ordre chronologique (plus ancien d'abord)
    try {
      const exists = await supabase
        .from('youtube_videos')
        .select('id, posted_to_discord_at')
        .eq('video_id', item.videoId)
        .maybeSingle();
      if (exists.error && exists.error.code !== 'PGRST116') throw exists.error;
      const row = exists.data;

      // Garde-fou : ne pas annoncer une vidéo trop ancienne au premier run
      const publishedAt = item.publishedAt ? new Date(item.publishedAt) : new Date();
      const tooOld = !row && (Date.now() - publishedAt.getTime()) / 36e5 > CHANNEL_LOOKBACK_HOURS;

      if (!row) {
        await supabase.from('youtube_videos').insert({
          video_id: item.videoId,
          channel_id: item.channelId || channelId,
          channel_label: config.youtube.channelLabel || item.author || '',
          title: item.title,
          url: item.url,
          thumbnail: item.image || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
          description: (item.summary || '').slice(0, 1000),
          published_at: publishedAt.toISOString(),
        });
      }
      const alreadyPosted = row?.posted_to_discord_at;
      if (alreadyPosted || tooOld) continue;

      const announced = await announce(item, channelId);
      if (announced) {
        await supabase
          .from('youtube_videos')
          .update({
            posted_to_discord_at: new Date().toISOString(),
            discord_message_id: announced.id || null,
          })
          .eq('video_id', item.videoId);
        posted += 1;
      }
    } catch (e) {
      log.warn({ err: e, videoId: item.videoId }, 'process video failed');
    }
  }
  log.info({ posted, totalSeen: items.length, ms: Date.now() - start }, 'YouTube check done');
  return { posted, totalSeen: items.length };
}

async function announce(item, channelId) {
  const ch = await getChannelSafe(config.discord.channels.youtube);
  if (!ch) { log.warn('Channel YouTube non configuré ou introuvable'); return null; }
  const label = config.youtube.channelLabel || '19enplein';
  const channelUrl = youtubeChannelPublicUrl(config.youtube, channelId);
  const embed = new EmbedBuilder()
    .setColor(0x7F5A83)
    .setAuthor({ name: `Nouvelle vidéo · ${label}`, url: channelUrl })
    .setTitle(item.title?.slice(0, 250) || 'Nouvelle vidéo')
    .setURL(item.url)
    .setImage(item.image || `https://i.ytimg.com/vi/${item.videoId}/maxresdefault.jpg`)
    .setTimestamp(item.publishedAt ? new Date(item.publishedAt) : new Date())
    .setFooter({ text: `YouTube · ${label}` });
  if (item.summary) embed.setDescription(item.summary.slice(0, 350));
  try {
    return await ch.send({ content: `🎬 **${label}** vient de poster une vidéo !`, embeds: [embed] });
  } catch (e) {
    log.warn({ err: e }, 'Discord send failed');
    return null;
  }
}
