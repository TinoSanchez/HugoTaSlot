import 'dotenv/config';

function req(name) {
  const v = process.env[name];
  if (!v || !String(v).trim()) {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return String(v).trim();
}

function opt(name, fallback = '') {
  const v = process.env[name];
  return v === undefined || v === null ? fallback : String(v).trim();
}

export const config = {
  discord: {
    token: req('DISCORD_TOKEN'),
    clientId: req('DISCORD_CLIENT_ID'),
    guildId: opt('DISCORD_GUILD_ID', ''),
    channels: {
      youtube: opt('DISCORD_CHANNEL_YOUTUBE', ''),
      slots: opt('DISCORD_CHANNEL_SLOTS', ''),
    },
  },
  supabase: {
    url: req('SUPABASE_URL'),
    serviceRoleKey: req('SUPABASE_SERVICE_ROLE_KEY'),
  },
  youtube: {
    channelId: opt('YOUTUBE_CHANNEL_ID', ''),
    channelLabel: opt('YOUTUBE_CHANNEL_LABEL', 'HugoTaSlot'),
    rssUrl(channelId = '') {
      const id = (channelId || this.channelId || '').trim();
      return id ? `https://www.youtube.com/feeds/videos.xml?channel_id=${id}` : '';
    },
  },
  bigwinboard: {
    rss: opt('BIGWINBOARD_RSS', 'https://bigwinboard.com/feed/'),
  },
  cron: {
    youtube: opt('CRON_YOUTUBE', '*/10 * * * *'),
    slots: opt('CRON_SLOTS', '*/30 * * * *'),
    initialDelayMs: parseInt(opt('INITIAL_DELAY_MS', '8000'), 10),
  },
  site: {
    url: opt('SITE_URL', 'https://hugotaslot-cloud.vercel.app'),
  },
  log: {
    level: opt('LOG_LEVEL', 'info'),
  },
  port: parseInt(opt('PORT', '3000'), 10),
};
