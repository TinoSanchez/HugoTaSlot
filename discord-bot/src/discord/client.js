import { Client, GatewayIntentBits, Partials } from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import { setupPresence } from './presence.js';

const log = child({ mod: 'discord' });

export const client = new Client({
  intents: [GatewayIntentBits.Guilds],
  partials: [Partials.Channel],
});

client.once('ready', (c) => {
  log.info({ tag: c.user.tag, id: c.user.id, presence: config.presence.mode }, 'Bot Discord prêt');
  setupPresence(c);
});

client.on('error', (err) => log.error({ err }, 'Discord client error'));
client.on('shardError', (err) => log.error({ err }, 'Discord shard error'));

let _ready;
export function login() {
  if (_ready) return _ready;
  _ready = client.login(config.discord.token);
  return _ready;
}

export async function getChannelSafe(channelId) {
  if (!channelId) return null;
  try {
    let ch = client.channels.cache.get(channelId);
    if (!ch) ch = await client.channels.fetch(channelId).catch(() => null);
    return ch || null;
  } catch (e) {
    log.warn({ err: e, channelId }, 'getChannelSafe failed');
    return null;
  }
}
