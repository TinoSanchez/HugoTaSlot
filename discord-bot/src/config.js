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

/** Railway injecte PORT ; si vide ou invalide, parseInt donne NaN → listen() ne répond pas au healthcheck. */
function listenPort() {
  const raw = opt('PORT', '3000');
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : 3000;
}

export const config = {
  discord: {
    token: req('DISCORD_TOKEN'),
    clientId: req('DISCORD_CLIENT_ID'),
    guildId: opt('DISCORD_GUILD_ID', ''),
    channels: {
      youtube: opt('DISCORD_CHANNEL_YOUTUBE', ''),
      slots: opt('DISCORD_CHANNEL_SLOTS', ''),
      rumble: opt('DISCORD_CHANNEL_RUMBLE', ''),
      rumbleLive: opt('DISCORD_CHANNEL_RUMBLE_LIVE', ''),
      pronos: opt('DISCORD_CHANNEL_PRONOS', ''),
      calls: opt('DISCORD_CHANNEL_CALLS', ''),
    },
  },
  supabase: {
    url: req('SUPABASE_URL'),
    serviceRoleKey: req('SUPABASE_SERVICE_ROLE_KEY'),
  },
  youtube: {
    channelId: opt('YOUTUBE_CHANNEL_ID', ''),
    channelHandle: opt('YOUTUBE_CHANNEL_HANDLE', '19enpleinn'),
    channelLabel: opt('YOUTUBE_CHANNEL_LABEL', '19enplein'),
    rssUrl(channelId = '') {
      const id = (channelId || this.channelId || '').trim();
      return id ? `https://www.youtube.com/feeds/videos.xml?channel_id=${id}` : '';
    },
  },
  rumble: {
    userSlug: opt('RUMBLE_USER_SLUG', '19enplein'),
    channelUrl: opt('RUMBLE_CHANNEL_URL', 'https://rumble.com/user/19enplein'),
    channelLabel: opt('RUMBLE_CHANNEL_LABEL', '19enplein'),
    liveApiUrl: opt('RUMBLE_LIVE_API_URL', ''),
  },
  propline: {
    apiKey: opt('PROPLINE_API_KEY', ''),
    baseUrl: opt('PROPLINE_BASE_URL', 'https://api.prop-line.com/v1'),
    /** Sports à synchroniser. `all` (défaut) = tous les sports actifs via GET /v1/sports. */
    sportsEnv: opt('PROPLINE_SPORTS', 'all'),
    /** Cache de la liste /sports (ms) — évite 1 req API à chaque cron. */
    sportsCacheMs: Math.max(60_000, parseInt(opt('PROPLINE_SPORTS_CACHE_MS', '3600000'), 10) || 3_600_000),
    /** Pause entre chaque sport lors du sync (ms) — respect quota API. */
    syncDelayMs: Math.max(0, parseInt(opt('PROPLINE_SYNC_DELAY_MS', '120'), 10) || 120),
    /** Marchés fetchés pour chaque event (CSV). */
    markets: (opt(
      'PROPLINE_MARKETS',
      ['h2h', 'totals', 'spreads', 'correct_score', 'both_teams_to_score', 'double_chance'].join(','),
    ) || '').split(',').map((s) => s.trim()).filter(Boolean),
    /** Fenêtre d'anticipation (heures) : sync uniquement les matchs commençant dans les X h. */
    hoursAhead: parseInt(opt('PROPLINE_HOURS_AHEAD', '168'), 10) || 168, // 7 jours
    /** Bookmaker prioritaire pour l'affichage (mais on stocke tous les books). */
    primaryBookmaker: opt('PROPLINE_PRIMARY_BOOKMAKER', 'pinnacle'),
    /** `active` = cotes seulement pour sport_keys présents en base (économise ~50 % quota). */
    oddsScope: (opt('PROPLINE_ODDS_SCOPE', 'active') || 'active').toLowerCase(),
    /** Intervalle sync scores PropLine hors-foot (ms) — défaut 45 s si live. */
    scoresIntervalMs: Math.max(30_000, parseInt(opt('PROPLINE_SCORES_INTERVAL_MS', '45000'), 10) || 45_000),
    /** Intervalle sync scores foot ESPN (ms) — 0 quota PropLine. */
    espnScoresIntervalMs: Math.max(15_000, parseInt(opt('ESPN_SCORES_INTERVAL_MS', '30000'), 10) || 30_000),
  },
  bigwinboard: {
    rss: opt('BIGWINBOARD_RSS', 'https://bigwinboard.com/feed/'),
  },
  cron: {
    youtube: opt('CRON_YOUTUBE', '*/10 * * * *'),
    rumble: opt('CRON_RUMBLE', '*/10 * * * *'),
    rumbleLive: opt('CRON_RUMBLE_LIVE', '*/3 * * * *'),
    slots: opt('CRON_SLOTS', '*/30 * * * *'),
    /** Sync PropLine (matchs + cotes) — 5 min, sports actifs en base (~8–15k req/j). */
    sportsOdds: opt('CRON_SPORTS_ODDS', '*/5 * * * *'),
    /** Scores PropLine (hors-foot live) — cron secours 1 min ; boucle rapide via setInterval. */
    sportsScores: opt('CRON_SPORTS_SCORES', '*/1 * * * *'),
    /** Règlement paris — toutes les 5 min. */
    sportsSettle: opt('CRON_SPORTS_SETTLE', '*/5 * * * *'),
    initialDelayMs: parseInt(opt('INITIAL_DELAY_MS', '8000'), 10),
  },
  site: {
    url: opt('SITE_URL', 'https://hugotaslot.fr'),
  },
  presence: {
    /** off | static | rotate */
    mode: (() => {
      const m = opt('PRESENCE_MODE', 'static').toLowerCase();
      if (m === 'off' || m === 'static' || m === 'rotate') return m;
      return 'static';
    })(),
    status: opt('PRESENCE_STATUS', 'online'),
    intervalMs: Math.max(30_000, parseInt(opt('PRESENCE_INTERVAL_MS', '120000'), 10) || 120_000),
    /** Mapping Discord RPC → discord.js (UpdatePresence static) */
    staticPresence: {
      type: opt('PRESENCE_TYPE', 'playing').toLowerCase(),
      details: opt('PRESENCE_DETAILS', '19ENPLEIN CASINO'),
      state: opt('PRESENCE_STATE', 'Gamdom · hugotaslot.fr'),
      /** 0 = depuis le boot du bot (chrono visible si Discord l’accepte) */
      startTimestamp: parseInt(opt('PRESENCE_START_TS', '0'), 10) || 0,
      endTimestamp: parseInt(opt('PRESENCE_END_TS', '0'), 10) || 0,
      largeImageKey: opt('PRESENCE_LARGE_IMAGE_KEY', 'image_19'),
      largeImageText: opt('PRESENCE_LARGE_IMAGE_TEXT', '19ENPLEIN CASINO'),
      smallImageKey: opt('PRESENCE_SMALL_IMAGE_KEY', 'gamdom'),
      smallImageText: opt('PRESENCE_SMALL_IMAGE_TEXT', 'Gamdom'),
      partyId: opt('PRESENCE_PARTY_ID', 'ae488379-351d-4a4f-ad32-2b9b01c91657'),
      partySize: parseInt(opt('PRESENCE_PARTY_SIZE', '1'), 10) || 1,
      partyMax: parseInt(opt('PRESENCE_PARTY_MAX', '5'), 10) || 5,
      joinSecret: opt('PRESENCE_JOIN_SECRET', 'MTI4NzM0OjFpMmhuZToxMjMxMjM='),
      url: opt('PRESENCE_URL', opt('SITE_URL', 'https://hugotaslot.fr')),
    },
    rotation: (() => {
      const raw = opt('PRESENCE_ROTATION_JSON', '');
      if (!raw) return [];
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })(),
  },
  log: {
    level: opt('LOG_LEVEL', 'info'),
  },
  port: listenPort(),
};
