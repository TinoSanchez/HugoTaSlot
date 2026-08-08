/**
 * Test annonce live Rumble (force un message test dans DISCORD_CHANNEL_RUMBLE_LIVE).
 * Usage : railway run node scripts/test-rumble-live-announce.mjs
 */
import 'dotenv/config';
import { config } from '../src/config.js';
import { client, login } from '../src/discord/client.js';
import { fetchRumbleVideos } from '../src/lib/rumble-feed.js';
import { announceRumbleLive } from '../src/jobs/rumble-live-watcher.js';

if (!config.discord.channels.rumbleLive) {
  console.error('DISCORD_CHANNEL_RUMBLE_LIVE manquant');
  process.exit(1);
}

const latest = (await fetchRumbleVideos(config.rumble, { limit: 1 }))[0];
const live = {
  streamId: `test-${Date.now()}`,
  title: latest?.title || 'Stream test 19enplein',
  url: latest?.url || config.rumble.channelUrl,
  thumbnail: latest?.thumbnail || null,
  watchingNow: 42,
  startedAt: new Date().toISOString(),
};

console.log('Test live :', live.title);

await login();
await new Promise((resolve) => (client.isReady() ? resolve() : client.once('ready', resolve)));

const msg = await announceRumbleLive(live);
if (!msg) {
  console.error('Échec envoi Discord');
  process.exit(1);
}

console.log('OK — message test live', msg.id);
await client.destroy();
process.exit(0);
