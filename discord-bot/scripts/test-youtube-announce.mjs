/**
 * Envoie une annonce test (dernière vidéo RSS) dans DISCORD_CHANNEL_YOUTUBE.
 * Usage : railway run node scripts/test-youtube-announce.mjs
 */
import 'dotenv/config';
import { EmbedBuilder } from 'discord.js';
import { config } from '../src/config.js';
import { client, login, getChannelSafe } from '../src/discord/client.js';
import { fetchFeed } from '../src/lib/rss.js';
import { getYoutubeChannelId, youtubeChannelPublicUrl } from '../src/lib/youtube-channel.js';
import { supabase } from '../src/supabase.js';

const channelId = await getYoutubeChannelId(config.youtube);
if (!channelId) {
  console.error('YOUTUBE_CHANNEL_ID / YOUTUBE_CHANNEL_HANDLE manquant');
  process.exit(1);
}

const feed = await fetchFeed(config.youtube.rssUrl(channelId), { kind: 'atom' });
const item = (feed.items || []).find((i) => i.videoId);
if (!item) {
  console.error('Aucune vidéo dans le flux RSS');
  process.exit(1);
}

console.log('Vidéo test :', item.videoId, '-', item.title);

await login();
await new Promise((resolve) => (client.isReady() ? resolve() : client.once('ready', resolve)));

const ch = await getChannelSafe(config.discord.channels.youtube);
if (!ch) {
  console.error('Salon Discord introuvable (DISCORD_CHANNEL_YOUTUBE)');
  process.exit(1);
}

const label = config.youtube.channelLabel || '19enplein';
const channelUrl = youtubeChannelPublicUrl(config.youtube, channelId);
const embed = new EmbedBuilder()
  .setColor(0x7F5A83)
  .setAuthor({ name: `Nouvelle vidéo · ${label}`, url: channelUrl })
  .setTitle(item.title?.slice(0, 250) || 'Nouvelle vidéo')
  .setURL(item.url)
  .setImage(item.image || `https://i.ytimg.com/vi/${item.videoId}/maxresdefault.jpg`)
  .setTimestamp(item.publishedAt ? new Date(item.publishedAt) : new Date())
  .setFooter({ text: `YouTube · ${label} · test bot` });
if (item.summary) embed.setDescription(item.summary.slice(0, 350));

const msg = await ch.send({
  content: `@everyone 🎬 **${label}** — annonce test (config chaîne OK)`,
  embeds: [embed],
  allowedMentions: { parse: ['everyone'] },
});

const publishedAt = item.publishedAt ? new Date(item.publishedAt) : new Date();
await supabase.from('youtube_videos').upsert(
  {
    video_id: item.videoId,
    channel_id: item.channelId || channelId,
    channel_label: label,
    title: item.title,
    url: item.url,
    thumbnail: item.image || `https://i.ytimg.com/vi/${item.videoId}/hqdefault.jpg`,
    description: (item.summary || '').slice(0, 1000),
    published_at: publishedAt.toISOString(),
    posted_to_discord_at: new Date().toISOString(),
    discord_message_id: msg.id || null,
  },
  { onConflict: 'video_id' },
);

console.log('OK — message Discord', msg.id, 'dans', ch.name);
await client.destroy();
process.exit(0);
