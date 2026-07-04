import { ActivityType } from 'discord.js';
import { config } from '../config.js';
import { child } from '../lib/logger.js';

const log = child({ mod: 'presence' });

const TYPE_MAP = {
  playing: ActivityType.Playing,
  watching: ActivityType.Watching,
  listening: ActivityType.Listening,
  streaming: ActivityType.Streaming,
  competing: ActivityType.Competing,
  custom: ActivityType.Custom,
};

/** Équivalent discord.js du bloc UpdatePresence() RPC (mode static par défaut). */
function buildStaticRichPresence(p) {
  const activity = {
    name: String(p.details || 'Competitive').slice(0, 128),
    type: TYPE_MAP[String(p.type || 'playing').toLowerCase()] ?? ActivityType.Playing,
    state: String(p.state || 'Playing Solo').slice(0, 128),
  };

  if (p.startTimestamp || p.endTimestamp) {
    activity.timestamps = {};
    if (p.startTimestamp) activity.timestamps.start = new Date(p.startTimestamp * 1000);
    if (p.endTimestamp) activity.timestamps.end = new Date(p.endTimestamp * 1000);
  }

  if (p.largeImageKey || p.smallImageKey) {
    activity.assets = {};
    if (p.largeImageKey) {
      activity.assets.largeImage = String(p.largeImageKey).slice(0, 128);
      if (p.largeImageText) activity.assets.largeText = String(p.largeImageText).slice(0, 128);
    }
    if (p.smallImageKey) {
      activity.assets.smallImage = String(p.smallImageKey).slice(0, 128);
      if (p.smallImageText) activity.assets.smallText = String(p.smallImageText).slice(0, 128);
    }
  }

  if (p.partyId) {
    activity.party = {
      id: String(p.partyId).slice(0, 128),
      size: [Math.max(0, p.partySize || 0), Math.max(1, p.partyMax || 1)],
    };
  }

  if (p.joinSecret) {
    activity.secrets = { join: String(p.joinSecret).slice(0, 128) };
  }

  if (activity.type === ActivityType.Streaming && p.url) {
    activity.url = p.url;
  }

  return activity;
}

function buildSimpleActivity(entry) {
  const type = TYPE_MAP[String(entry.type || 'watching').toLowerCase()] ?? ActivityType.Watching;
  const activity = { name: String(entry.name || 'hugotaslot.fr').slice(0, 128), type };
  if (type === ActivityType.Streaming) {
    activity.url = entry.url || config.site.url || 'https://hugotaslot.fr';
  }
  if (type === ActivityType.Custom && entry.state) {
    activity.state = String(entry.state).slice(0, 128);
  }
  return activity;
}

let rotateTimer = null;
let rotateIndex = 0;

function applyPresence(client) {
  if (!client?.user) return;
  const { status, mode, staticPresence, rotation } = config.presence;

  if (mode === 'off') {
    client.user.setStatus(status);
    return;
  }

  let activity;
  if (mode === 'static') {
    activity = buildStaticRichPresence(staticPresence);
  } else {
    const list = rotation.length ? rotation : [];
    if (!list.length) {
      activity = buildStaticRichPresence(staticPresence);
    } else {
      activity = buildSimpleActivity(list[rotateIndex % list.length]);
      rotateIndex += 1;
    }
  }

  client.user.setPresence({ status, activities: [activity] });
  log.info({ status, details: activity.name, state: activity.state }, 'Rich presence static appliquée');
}

/**
 * @param {import('discord.js').Client} client
 */
export function setupPresence(client) {
  const { mode, intervalMs } = config.presence;
  if (mode === 'off') return;

  applyPresence(client);

  if (mode !== 'rotate' || !config.presence.rotation.length) return;

  if (rotateTimer) clearInterval(rotateTimer);
  rotateTimer = setInterval(() => applyPresence(client), intervalMs);
  rotateTimer.unref?.();

  client.once('destroy', () => {
    if (rotateTimer) clearInterval(rotateTimer);
    rotateTimer = null;
  });
}
