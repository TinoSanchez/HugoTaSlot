/**
 * Envoie une annonce test Rumble dans DISCORD_CHANNEL_RUMBLE.
 * Usage : railway run node scripts/test-rumble-announce.mjs
 */
import 'dotenv/config';
import { config } from '../src/config.js';
import { client, login } from '../src/discord/client.js';
import { fetchRumbleVideos } from '../src/lib/rumble-feed.js';
import { announceRumbleVideo, saveRumbleVideoRecord } from '../src/jobs/rumble-watcher.js';

if (!config.discord.channels.rumble) {
  console.error('DISCORD_CHANNEL_RUMBLE manquant');
  process.exit(1);
}

const items = await fetchRumbleVideos(config.rumble, { limit: 1 });
const item = items[0];
if (!item) {
  console.error('Aucune vidéo Rumble trouvée');
  process.exit(1);
}

console.log('Vidéo test :', item.videoId, '-', item.title);

await login();
await new Promise((resolve) => (client.isReady() ? resolve() : client.once('ready', resolve)));

const msg = await announceRumbleVideo(item);
if (!msg) {
  console.error('Échec envoi Discord');
  process.exit(1);
}

const publishedAt = item.publishedAt ? new Date(item.publishedAt) : new Date();
await saveRumbleVideoRecord(item.videoId, {
  channel_slug: item.channelSlug || config.rumble.userSlug,
  channel_label: config.rumble.channelLabel || item.author || '',
  title: item.title,
  url: item.url,
  thumbnail: item.thumbnail || null,
  published_at: publishedAt.toISOString(),
  posted_to_discord_at: new Date().toISOString(),
  discord_message_id: msg.id || null,
});

console.log('OK — message Discord', msg.id);
await client.destroy();
process.exit(0);
