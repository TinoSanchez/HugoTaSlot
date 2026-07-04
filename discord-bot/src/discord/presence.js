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

const bootUnix = Math.floor(Date.now() / 1000);

/**
 * Rich Presence bot — Discord n’affiche en pratique que name + state (+ lien si Streaming).
 * Images / party / joinSecret : ignorés par le client pour les bots (limitation API).
 */
function buildStaticRichPresence(p) {
  const type = TYPE_MAP[String(p.type || 'playing').toLowerCase()] ?? ActivityType.Playing;
  const partyMax = Math.max(1, p.partyMax || 1);
  const partySize = Math.max(0, Math.min(p.partySize || 0, partyMax));

  let state = String(p.state || 'Gamdom · hugotaslot.fr').slice(0, 128);
  if (p.showPartyInState !== false && p.partyId && !state.includes('/')) {
    state = `${state} · ${partySize}/${partyMax}`.slice(0, 128);
  }

  const activity = {
    name: String(p.details || '19ENPLEIN CASINO').slice(0, 128),
    type,
    state,
  };

  const startTs = p.startTimestamp > 0 ? p.startTimestamp : bootUnix;
  activity.timestamps = { start: new Date(startTs * 1000) };
  if (p.endTimestamp > 0) {
    activity.timestamps.end = new Date(p.endTimestamp * 1000);
  }

  if (p.largeImageKey || p.smallImageKey) {
    activity.assets = {};
    if (p.largeImageKey) {
      activity.assets.largeImage = String(p.largeImageKey).slice(0, 32);
      if (p.largeImageText) activity.assets.largeText = String(p.largeImageText).slice(0, 128);
    }
    if (p.smallImageKey) {
      activity.assets.smallImage = String(p.smallImageKey).slice(0, 32);
      if (p.smallImageText) activity.assets.smallText = String(p.smallImageText).slice(0, 128);
    }
  }

  if (p.partyId) {
    activity.party = {
      id: String(p.partyId).slice(0, 128),
      size: [partySize, partyMax],
    };
  }

  if (p.joinSecret) {
    activity.secrets = { join: String(p.joinSecret).slice(0, 128) };
  }

  if (type === ActivityType.Streaming) {
    activity.url = p.url || config.site.url || 'https://hugotaslot.fr';
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
  log.info(
    {
      status,
      name: activity.name,
      state: activity.state,
      assets: activity.assets || null,
      note: 'Images/party/join ignorés par Discord pour les bots',
    },
    'Rich presence appliquée',
  );
}

/** @param {import('discord.js').Client} client */
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
