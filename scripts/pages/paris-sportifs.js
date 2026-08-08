'use strict';
/* globals getAuthClient, isCloudUser, getUserBalance, setUserBalance, showToast, currentUser, ensureCloudSession, loadCloudProfile, saveSession, updateLobbyBalance, showAuth */
/* Page « Paris sportifs » — look bookmaker (Betclic/Winamax) : tabs sport, groupement par ligue. */

const PS_STATE = {
  bootstrapped: false,
  events: [],
  activeSportKey: 'all',
  activeTab: 'matches',
  viewMode: 'all',
  searchQuery: '',
  mineFilter: 'all',
  detailEventId: null,
  slipMode: 'simple',
  wallet: 0,
  slip: [],
  slipStake: 100,
  refreshTimer: null,
  visibilityBound: false,
  lastRefreshAt: 0,
};

/* ────────────────────────────────────────────────────────────────────────────
   ICÔNES SPORTS (assets SVG) + LOGOS ÉQUIPES (TheSportsDB + ESPN)
   ──────────────────────────────────────────────────────────────────────────── */

const PS_SPORT_ICON_FILES = {
  all: './assets/icon-sport-all.svg',
  football: './assets/icon-sport-football.svg',
  basketball: './assets/icon-sport-basketball.svg',
  tennis: './assets/icon-sport-tennis.svg',
  combat: './assets/icon-sport-combat.svg',
  americanFootball: './assets/icon-sport-nfl.svg',
  hockey: './assets/icon-sport-hockey.svg',
  baseball: './assets/icon-sport-baseball.svg',
  motorsport: './assets/icon-sport-nfl.svg',
  golf: './assets/icon-sport-golf.svg',
  esport: './assets/icon-sport-all.svg',
  tableTennis: './assets/icon-sport-tennis.svg',
  trophy: './assets/icon-sport-all.svg',
};

const PS_FLAG_CODES = {
  FR: 'fr', GB: 'gb-eng', ES: 'es', IT: 'it', DE: 'de', US: 'us',
  World: 'un', UEFA: 'eu', 'ATP/WTA': 'un', MMA: 'un', Pro: 'un', PGA: 'us',
};

/** Logos ESPN (NBA / NFL / NHL / MLB) — instantanés, pas d'API. */
const PS_ESPN_ABBR = {
  /* NBA */
  'atlanta hawks': 'atl', 'boston celtics': 'bos', 'brooklyn nets': 'bkn',
  'charlotte hornets': 'cha', 'chicago bulls': 'chi', 'cleveland cavaliers': 'cle',
  'dallas mavericks': 'dal', 'denver nuggets': 'den', 'detroit pistons': 'det',
  'golden state warriors': 'gs', 'houston rockets': 'hou', 'indiana pacers': 'ind',
  'los angeles clippers': 'lac', 'la clippers': 'lac', 'los angeles lakers': 'lal',
  'la lakers': 'lal', 'memphis grizzlies': 'mem', 'miami heat': 'mia',
  'milwaukee bucks': 'mil', 'minnesota timberwolves': 'min', 'new orleans pelicans': 'no',
  'new york knicks': 'ny', 'oklahoma city thunder': 'okc', 'orlando magic': 'orl',
  'philadelphia 76ers': 'phi', 'phoenix suns': 'phx', 'portland trail blazers': 'por',
  'sacramento kings': 'sac', 'san antonio spurs': 'sa', 'toronto raptors': 'tor',
  'utah jazz': 'utah', 'washington wizards': 'wsh',
  /* NFL */
  'arizona cardinals': 'ari', 'atlanta falcons': 'atl', 'baltimore ravens': 'bal',
  'buffalo bills': 'buf', 'carolina panthers': 'car', 'chicago bears': 'chi',
  'cincinnati bengals': 'cin', 'cleveland browns': 'cle', 'dallas cowboys': 'dal',
  'denver broncos': 'den', 'detroit lions': 'det', 'green bay packers': 'gb',
  'houston texans': 'hou', 'indianapolis colts': 'ind', 'jacksonville jaguars': 'jax',
  'kansas city chiefs': 'kc', 'las vegas raiders': 'lv', 'los angeles chargers': 'lac',
  'los angeles rams': 'lar', 'miami dolphins': 'mia', 'minnesota vikings': 'min',
  'new england patriots': 'ne', 'new orleans saints': 'no', 'new york giants': 'nyg',
  'new york jets': 'nyj', 'philadelphia eagles': 'phi', 'pittsburgh steelers': 'pit',
  'san francisco 49ers': 'sf', 'seattle seahawks': 'sea', 'tampa bay buccaneers': 'tb',
  'tennessee titans': 'ten', 'washington commanders': 'wsh',
};

const PS_LOGO_CACHE = new Map(); // normalized name → url | null
const PS_LOGO_PENDING = new Map(); // normalized name → Promise

function psNormTeamKey(name) {
  return String(name || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function psSportIconImg(family, size = 22) {
  const src = PS_SPORT_ICON_FILES[family] || PS_SPORT_ICON_FILES.trophy;
  return `<img class="ps-sport-icon-img" src="${src}" width="${size}" height="${size}" alt="" loading="lazy">`;
}

function psLeagueFlag(country) {
  const code = PS_FLAG_CODES[country];
  if (!code) return '';
  return `<img class="ps-league-flag" src="https://flagcdn.com/w40/${code}.png" width="24" height="18" alt="" loading="lazy">`;
}

/** Sélections nationales (CM, Euro…) → drapeau flagcdn. */
const PS_NATIONAL_FLAGS = {
  france: 'fr', morocco: 'ma', argentina: 'ar', brazil: 'br', germany: 'de',
  spain: 'es', italy: 'it', portugal: 'pt', england: 'gb-eng', netherlands: 'nl',
  belgium: 'be', croatia: 'hr', uruguay: 'uy', colombia: 'co', mexico: 'mx',
  usa: 'us', 'united states': 'us', canada: 'ca', japan: 'jp', 'south korea': 'kr',
  australia: 'au', senegal: 'sn', cameroon: 'cm', ghana: 'gh', nigeria: 'ng',
  'ivory coast': 'ci', 'cote d ivoire': 'ci', tunisia: 'tn', algeria: 'dz',
  egypt: 'eg', switzerland: 'ch', poland: 'pl', sweden: 'se', denmark: 'dk',
  austria: 'at', serbia: 'rs', wales: 'gb-wls', scotland: 'gb-sct', iran: 'ir',
  'saudi arabia': 'sa', qatar: 'qa', ecuador: 'ec', chile: 'cl', peru: 'pe',
  paraguay: 'py', 'costa rica': 'cr', panama: 'pa', jamaica: 'jm', honduras: 'hn',
  georgia: 'ge', slovakia: 'sk', slovenia: 'si', ukraine: 'ua', turkey: 'tr',
  'czech republic': 'cz', czechia: 'cz', romania: 'ro', hungary: 'hu', finland: 'fi',
  norway: 'no', ireland: 'ie', 'northern ireland': 'gb-nir', iceland: 'is',
};

function psNationalFlagCode(teamName) {
  return PS_NATIONAL_FLAGS[psNormTeamKey(teamName)] || null;
}

function psEspnLogoUrl(teamName, sportFamily) {
  const key = psNormTeamKey(teamName);
  const abbr = PS_ESPN_ABBR[key];
  if (!abbr) return null;
  const league = { basketball: 'nba', americanFootball: 'nfl', hockey: 'nhl', baseball: 'mlb' }[sportFamily];
  if (!league) return null;
  return `https://a.espncdn.com/i/teamlogos/${league}/500/${abbr}.png`;
}

async function psFetchLogoTheSportsDB(teamName, sportFamily) {
  const q = encodeURIComponent(teamName.trim());
  const isTennis = sportFamily === 'tennis';
  const url = isTennis
    ? `https://www.thesportsdb.com/api/v1/json/3/searchplayers.php?p=${q}`
    : `https://www.thesportsdb.com/api/v1/json/3/searchteams.php?t=${q}`;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (isTennis) {
      const p = data?.player?.[0];
      return p?.strCutout || p?.strThumb || p?.strRender || null;
    }
    const teams = data?.teams || [];
    if (!teams.length) return null;
    const want = psNormTeamKey(teamName);
    const best = teams.find((t) => psNormTeamKey(t.strTeam).includes(want) || want.includes(psNormTeamKey(t.strTeam))) || teams[0];
    return best.strTeamBadge || best.strTeamLogo || null;
  } catch {
    return null;
  }
}

async function psResolveTeamLogo(teamName, sportFamily) {
  const key = psNormTeamKey(teamName);
  if (!key) return null;
  if (PS_LOGO_CACHE.has(key)) return PS_LOGO_CACHE.get(key);
  if (PS_LOGO_PENDING.has(key)) return PS_LOGO_PENDING.get(key);

  const p = (async () => {
    const espn = psEspnLogoUrl(teamName, sportFamily);
    if (espn) { PS_LOGO_CACHE.set(key, espn); return espn; }
    const tdb = await psFetchLogoTheSportsDB(teamName, sportFamily);
    PS_LOGO_CACHE.set(key, tdb);
    return tdb;
  })();
  PS_LOGO_PENDING.set(key, p);
  try { return await p; } finally { PS_LOGO_PENDING.delete(key); }
}

function psTeamLogoHtml(teamName, sportFamily, size = 36) {
  const key = psNormTeamKey(teamName);
  const cached = PS_LOGO_CACHE.get(key);
  if (cached) {
    return `<img class="ps-team-logo" src="${psEscape(cached)}" width="${size}" height="${size}" alt="" loading="lazy" onerror="this.classList.add('ps-team-logo--err')">`;
  }
  if (sportFamily === 'football') {
    const fc = psNationalFlagCode(teamName);
    if (fc) {
      const url = `https://flagcdn.com/w80/${fc}.png`;
      PS_LOGO_CACHE.set(key, url);
      return `<img class="ps-team-logo ps-team-flag" src="${url}" width="${size}" height="${Math.round(size * 0.75)}" alt="" loading="lazy">`;
    }
  }
  const espn = psEspnLogoUrl(teamName, sportFamily);
  if (espn) {
    PS_LOGO_CACHE.set(key, espn);
    return `<img class="ps-team-logo" src="${psEscape(espn)}" width="${size}" height="${size}" alt="" loading="lazy" onerror="this.classList.add('ps-team-logo--err')">`;
  }
  return `<span class="ps-team-logo-slot" data-team-logo="${psEscape(teamName)}" data-sport-family="${psEscape(sportFamily)}" style="width:${size}px;height:${size}px">${psTeamBadge(teamName, size)}</span>`;
}

async function psHydrateTeamLogos(root) {
  if (!root) return;
  const slots = [...root.querySelectorAll('.ps-team-logo-slot[data-team-logo]')];
  const byName = new Map();
  for (const slot of slots) {
    const name = slot.dataset.teamLogo;
    if (!name || byName.has(name)) continue;
    byName.set(name, slot.dataset.sportFamily || 'football');
  }
  for (const [name, fam] of byName) {
    const url = await psResolveTeamLogo(name, fam);
    if (!url) continue;
    for (const el of slots) {
      if (el.dataset.teamLogo !== name) continue;
      const sz = el.style.width || '36px';
      el.outerHTML = `<img class="ps-team-logo" src="${psEscape(url)}" style="width:${sz};height:${sz}" alt="" loading="lazy">`;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
}

/* Correspondance sport_key PropLine → famille de sport + libellé ligue.
   Utilisé pour :
   - Grouper les matchs par grande famille (Football / Basket / Tennis / Combat / …)
   - Afficher un nom lisible de ligue */
const PS_SPORT_MAP = {
  soccer_ligue_1:        { family: 'football', league: 'Ligue 1',           country: 'FR' },
  soccer_epl:            { family: 'football', league: 'Premier League',    country: 'GB' },
  soccer_la_liga:        { family: 'football', league: 'La Liga',           country: 'ES' },
  soccer_serie_a:        { family: 'football', league: 'Serie A',           country: 'IT' },
  soccer_bundesliga:     { family: 'football', league: 'Bundesliga',        country: 'DE' },
  soccer_fifa_world_cup: { family: 'football', league: 'Coupe du Monde',    country: 'World' },
  soccer_uefa_champs_league: { family: 'football', league: 'Champions League', country: 'UEFA' },
  soccer_mls:            { family: 'football', league: 'MLS',               country: 'US' },
  basketball_nba:        { family: 'basketball', league: 'NBA',             country: 'US' },
  basketball_ncaab:      { family: 'basketball', league: 'NCAAB',           country: 'US' },
  tennis:                { family: 'tennis',    league: 'Tennis',           country: 'ATP/WTA' },
  mma_ufc:               { family: 'combat',    league: 'UFC',              country: 'MMA' },
  boxing:                { family: 'combat',    league: 'Boxe',             country: 'Pro' },
  football_nfl:          { family: 'americanFootball', league: 'NFL',       country: 'US' },
  football_ncaaf:        { family: 'americanFootball', league: 'NCAAF',     country: 'US' },
  hockey_nhl:            { family: 'hockey',    league: 'NHL',              country: 'US' },
  baseball_mlb:          { family: 'baseball',  league: 'MLB',              country: 'US' },
  golf:                  { family: 'golf',      league: 'Golf',             country: 'PGA' },
};

const PS_FAMILY_LABELS = {
  all: 'Tous les sports',
  football: 'Football',
  basketball: 'Basket',
  tennis: 'Tennis',
  combat: 'Combat',
  americanFootball: 'Football US',
  hockey: 'Hockey',
  baseball: 'Baseball',
  motorsport: 'Auto/Moto',
  golf: 'Golf',
  golf: 'Golf',
  esport: 'Esports',
  tableTennis: 'Ping-pong',
  trophy: 'Autres sports',
};

/** Limite par compétition lors du fallback multi-RPC. */
const PS_EVENTS_PER_SPORT = 80;
const PS_EVENTS_MAX_TOTAL = 4000;

const PS_MARKETS_LABELS = {
  h2h: 'Vainqueur',
  totals: 'Nombre de buts',
  spreads: 'Handicap',
  correct_score: 'Score exact',
  both_teams_to_score: 'Les 2 équipes marquent',
  double_chance: 'Double chance',
};

/* ────────────────────────────────────────────────────────────────────────────
   Utils
   ──────────────────────────────────────────────────────────────────────────── */

function psFmt(n) {
  const v = Math.round(Number(n || 0));
  return v.toLocaleString('fr-FR');
}
function psFmtOdd(n) {
  const v = psNormalizeDecimalOdd(n);
  if (v == null) return '—';
  return v.toFixed(2);
}

/** Cotes US (+110 / -245) ou décimal (1.65) → décimal normalisé. */
function psNormalizeDecimalOdd(raw) {
  const v = Number(raw);
  if (!Number.isFinite(v)) return null;
  if (v <= -100) {
    const dec = Math.round((100 / Math.abs(v) + 1) * 100) / 100;
    return dec >= 1.01 ? dec : null;
  }
  if (v >= 100) {
    const dec = Math.round((v / 100 + 1) * 100) / 100;
    return dec >= 1.01 && dec <= 501 ? dec : null;
  }
  if (v >= 1.01 && v <= 501) return Math.round(v * 100) / 100;
  return null;
}

function psIsEventLive(ev) {
  if (!ev) return false;
  if (ev.status === 'live') return true;
  if (ev.status === 'finished' || ev.status === 'cancelled') return false;
  const t = Date.parse(ev.commence_at);
  if (!Number.isFinite(t)) return false;
  const now = Date.now();
  return t <= now && t > now - 3 * 3600 * 1000;
}

function psCountLiveEvents(events = PS_STATE.events) {
  return events.filter((ev) => psIsEventLive(ev)).length;
}

function psIsEventFinished(ev) {
  return ev?.status === 'finished';
}

function psEventScore(ev) {
  const h = ev?.home_score;
  const a = ev?.away_score;
  if (h != null && a != null) return { home: Number(h), away: Number(a), has: true };
  return { home: null, away: null, has: false };
}

function psParseSetsFromPeriod(period) {
  if (!period) return null;
  const m = String(period).match(/sets?\s*(\d+)\s*[-–]\s*(\d+)/i);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

function psParseGoalsFromPeriod(period) {
  if (!period) return null;
  const s = String(period);
  if (/sets?\s*\d+\s*[-–]\s*\d+/i.test(s)) return null;
  const m = s.match(/(?:^|[·|])\s*(\d+)\s*[-–]\s*(\d+)\s*(?:$|[·|']|\s)/)
    || s.match(/\b(\d+)\s*[-–]\s*(\d+)\b/);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

/** ESPN foot live (fallback gratuit si PropLine sans scores). */
const PS_ESPN_SOCCER_SLUGS = {
  soccer_fifa_world_cup: 'fifa.world',
  soccer_epl: 'eng.1',
  soccer_la_liga: 'esp.1',
  soccer_serie_a: 'ita.1',
  soccer_bundesliga: 'ger.1',
  soccer_ligue_1: 'fra.1',
  soccer_uefa_champs_league: 'uefa.champions',
  soccer_uefa_europa_league: 'uefa.europa',
  soccer_mls: 'usa.1',
};
const PS_ESPN_CACHE = new Map();

function psTeamsMatchEspn(a, b) {
  const na = psNormTeamKey(a);
  const nb = psNormTeamKey(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = na.split(' ');
  const wb = nb.split(' ');
  return wa[0] && wb[0] && wa[0] === wb[0] && wa[0].length >= 4;
}

function psParseEspnScoreboard(data) {
  const out = [];
  for (const event of data?.events || []) {
    const comp = event.competitions?.[0];
    if (!comp) continue;
    const homeC = comp.competitors?.find((c) => c.homeAway === 'home');
    const awayC = comp.competitors?.find((c) => c.homeAway === 'away');
    if (!homeC || !awayC) continue;
    const homeScore = Number(homeC.score);
    const awayScore = Number(awayC.score);
    if (!Number.isFinite(homeScore) || !Number.isFinite(awayScore)) continue;
    const st = comp.status || {};
    const state = String(st.type?.state || '').toLowerCase();
    const finished = st.type?.completed === true || state === 'post';
    const live = state === 'in' || /half|progress|overtime/i.test(String(st.type?.description || ''));
    const period = [...new Set([st.type?.shortDetail || st.type?.description, st.displayClock].filter(Boolean))].join(' · ') || null;
    out.push({
      home_team: homeC.team?.displayName || homeC.team?.name || '',
      away_team: awayC.team?.displayName || awayC.team?.name || '',
      home_score: homeScore,
      away_score: awayScore,
      period,
      status: finished ? 'finished' : (live ? 'live' : 'upcoming'),
    });
  }
  return out;
}

async function psFetchEspnSoccerScores(sportKey, cacheTtl = 30_000) {
  const slug = PS_ESPN_SOCCER_SLUGS[sportKey];
  if (!slug) return [];
  const cached = PS_ESPN_CACHE.get(sportKey);
  if (cached && Date.now() - cached.ts < cacheTtl) return cached.entries;
  try {
    const r = await fetch(`https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`);
    if (!r.ok) return [];
    const entries = psParseEspnScoreboard(await r.json());
    PS_ESPN_CACHE.set(sportKey, { ts: Date.now(), entries });
    return entries;
  } catch {
    return [];
  }
}

async function psHydrateEspnLiveScores(events) {
  const targets = events.filter((ev) =>
    ev.sport_key?.startsWith('soccer_') && psIsEventLive(ev));
  if (!targets.length) return;
    const cacheTtl = PS_STATE.activeTab === 'live' ? 8_000 : 20_000;
  const keys = [...new Set(targets.map((ev) => ev.sport_key).filter((k) => PS_ESPN_SOCCER_SLUGS[k]))];
  for (const sk of keys) {
    const board = await psFetchEspnSoccerScores(sk, cacheTtl);
    for (const ev of targets.filter((e) => e.sport_key === sk)) {
      const hit = board.find((e) =>
        psTeamsMatchEspn(ev.home_team, e.home_team) && psTeamsMatchEspn(ev.away_team, e.away_team));
      if (!hit) continue;
      ev.home_score = hit.home_score;
      ev.away_score = hit.away_score;
      if (hit.status === 'live' || hit.status === 'finished') ev.status = hit.status;
      ev.result_details = { ...(ev.result_details || {}), period: hit.period, live: hit.status === 'live', source: 'espn' };
    }
  }
}

function psDisplayScore(ev, isLive, isFinished) {
  const period = ev?.result_details?.period || ev?.period || null;
  const sets = psParseSetsFromPeriod(period);
  const score = psEventScore(ev);
  const periodGoals = (!score.has && period) ? psParseGoalsFromPeriod(period) : null;

  if (sets && (isLive || isFinished || score.has)) {
    return { mode: 'score', home: sets.home, away: sets.away, sub: period };
  }
  if (score.has) {
    return { mode: 'score', home: score.home, away: score.away, sub: period };
  }
  if (periodGoals && (isLive || isFinished)) {
    return { mode: 'score', home: periodGoals.home, away: periodGoals.away, sub: period };
  }
  if (period && isLive) {
    return { mode: 'period', text: period };
  }
  if (isLive) {
    return { mode: 'live', text: 'En cours' };
  }
  return { mode: 'vs' };
}

function psFmtScorePart(n) {
  if (n == null) return '–';
  return String(n);
}

function psCountdownLabel(commenceAt) {
  const ms = Date.parse(commenceAt) - Date.now();
  if (ms <= 0 || ms > 48 * 3600 * 1000) return null;
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `Dans ${h}h${String(m).padStart(2, '0')}` : `Dans ${m} min`;
}

function psCombinedOdd(slip = PS_STATE.slip) {
  if (!slip.length) return 0;
  return slip.reduce((acc, s) => acc * s.odd, 1);
}

function psNormalizeEventsMarkets(events) {
  for (const ev of events) {
    const markets = ev.markets || {};
    for (const mk of Object.keys(markets)) {
      const m = markets[mk];
      if (!m?.outcomes) continue;
      m.outcomes = (m.outcomes || []).map((o) => {
        const dec = psNormalizeDecimalOdd(o.price);
        return { ...o, price: dec != null ? dec : o.price };
      }).filter((o) => Number(o.price) >= 1.01 && Number(o.price) <= 501);
    }
  }
  return events;
}
function psFmtDate(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '—';
  return d.toLocaleString('fr-FR', {
    weekday: 'short', day: '2-digit', month: 'short',
    hour: '2-digit', minute: '2-digit',
  });
}
function psFmtCountdown(iso) {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return '';
  const diffMs = d.getTime() - Date.now();
  if (diffMs < 0) return 'En direct';
  const mins = Math.floor(diffMs / 60000);
  if (mins < 60) return `dans ${mins}min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `dans ${hours}h${mins % 60 ? ' ' + (mins % 60) + 'min' : ''}`;
  const days = Math.floor(hours / 24);
  return `dans ${days}j`;
}
function psToast(msg, type = 'info') {
  if (typeof showToast === 'function') showToast(msg, type);
  else console.log(`[ps] ${type}: ${msg}`);
}
function psGetSb() {
  if (typeof getAuthClient !== 'function') return null;
  return getAuthClient();
}
function psRequireAuth() {
  if (typeof isCloudUser !== 'function' || !isCloudUser()) {
    psToast('Connecte-toi pour parier.', 'warn');
    if (typeof showAuth === 'function') showAuth();
    return Promise.resolve(false);
  }
  if (typeof ensureCloudSession === 'function') {
    return ensureCloudSession({ refresh: true, promptLogin: true }).then((s) => !!s);
  }
  return Promise.resolve(true);
}

function psMapRpcError(e) {
  const msg = String(e?.message || e?.details || e || '').toLowerCase();
  if (msg.includes('auth_required') || msg.includes('auth required') || msg.includes('jwt')) {
    return 'Session expirée — reconnecte-toi.';
  }
  if (msg.includes('insufficient_balance')) return 'Solde insuffisant — réclame le bonus quotidien (+100 HC).';
  if (msg.includes('event_not_open') || msg.includes('event_starting_soon')) return 'Paris fermés sur ce match (live ou déjà commencé).';
  if (msg.includes('odd_changed')) return 'Cote modifiée — réessaie.';
  if (msg.includes('market_not_found') || msg.includes('selection_not_found')) return 'Marché indisponible — rafraîchis la page.';
  if (msg.includes('profile_inactive')) return 'Compte inactif — contacte un admin.';
  if (msg.includes('already_claimed')) return 'Bonus déjà réclamé aujourd’hui.';
  return 'Opération impossible — réessaie dans quelques secondes.';
}
function psEscape(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* Hash déterministe d'un nom → couleur HSL stable pour les badges équipes.
   Deux équipes différentes ont ~toujours des couleurs différentes. */
function psTeamColor(name) {
  let h = 0;
  const s = String(name || '');
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  const hue = Math.abs(h) % 360;
  return `hsl(${hue} 55% 42%)`;
}
function psTeamInitials(name) {
  const s = String(name || '').trim();
  if (!s) return '?';
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return s.slice(0, 1).toUpperCase();
}
function psTeamBadge(name, size = 40) {
  const initials = psTeamInitials(name);
  const bg = psTeamColor(name);
  return `<span class="ps-team-badge" style="background:${bg};width:${size}px;height:${size}px;font-size:${Math.round(size * 0.38)}px" aria-hidden="true">${initials}</span>`;
}

function psSportInfo(sportKey, sportLabel) {
  if (PS_SPORT_MAP[sportKey]) return PS_SPORT_MAP[sportKey];
  const k = String(sportKey || '');
  const label = sportLabel || k;
  if (k.startsWith('soccer_')) {
    return { family: 'football', league: label, country: '' };
  }
  if (k.startsWith('basketball_')) {
    return { family: 'basketball', league: label, country: 'US' };
  }
  if (k.startsWith('football_')) {
    return { family: 'americanFootball', league: label, country: 'US' };
  }
  if (k.startsWith('hockey_')) {
    return { family: 'hockey', league: label, country: 'US' };
  }
  if (k.startsWith('baseball_')) {
    return { family: 'baseball', league: label, country: 'US' };
  }
  if (k.startsWith('mma_') || k === 'boxing') {
    return { family: 'combat', league: label, country: 'MMA' };
  }
  if (k === 'tennis') {
    return { family: 'tennis', league: 'Tennis', country: 'ATP/WTA' };
  }
  if (k === 'table_tennis') {
    return { family: 'tableTennis', league: label || 'Ping-pong', country: '' };
  }
  if (k === 'golf') {
    return { family: 'golf', league: 'Golf', country: 'PGA' };
  }
  if (k.startsWith('esports_') || k.startsWith('esport_')) {
    return { family: 'esport', league: label, country: '' };
  }
  if (k.startsWith('cricket_')) {
    return { family: 'trophy', league: label, country: '' };
  }
  if (k.includes('rugby')) {
    return { family: 'trophy', league: label, country: '' };
  }
  if (k.startsWith('motorsports') || k.includes('nascar') || k.includes('formula')) {
    return { family: 'motorsport', league: label, country: '' };
  }
  if (k.startsWith('volleyball_') || k.startsWith('handball_') || k.startsWith('lacrosse_')) {
    return { family: 'trophy', league: label, country: '' };
  }
  return { family: 'trophy', league: label, country: '' };
}
function psFamilyIcon(family) {
  return psSportIconImg(family, 22);
}

/* Libellé lisible d'un outcome selon le marché. */
function psOutcomeLabel(marketKey, outcomeName, event) {
  const raw = String(outcomeName || '').trim();
  const lower = raw.toLowerCase();
  if (marketKey === 'h2h') {
    if (lower === 'home' || lower === event.home_team.toLowerCase()) return event.home_team;
    if (lower === 'away' || lower === event.away_team.toLowerCase()) return event.away_team;
    if (lower === 'draw') return 'Nul';
  }
  if (marketKey === 'totals') return lower === 'over' ? '+ de' : lower === 'under' ? '- de' : raw;
  if (marketKey === 'both_teams_to_score') return lower === 'yes' ? 'Oui' : lower === 'no' ? 'Non' : raw;
  if (marketKey === 'double_chance') {
    const n = lower.replace(/[\s/+_.-]/g, '');
    if (n === 'homedraw' || n === '1x') return `${event.home_team} ou nul`;
    if (n === 'awaydraw' || n === 'x2') return `${event.away_team} ou nul`;
    if (n === 'homeaway' || n === '12') return `${event.home_team} ou ${event.away_team}`;
  }
  return raw;
}

/* Version courte pour la carte match (h2h : 1 / N / 2). */
function psShortH2HLabel(name, event) {
  const lower = String(name).toLowerCase();
  if (lower === 'home' || lower === event.home_team.toLowerCase()) return '1';
  if (lower === 'draw') return 'N';
  if (lower === 'away' || lower === event.away_team.toLowerCase()) return '2';
  return name;
}

/* ────────────────────────────────────────────────────────────────────────────
   Chargements Supabase
   ──────────────────────────────────────────────────────────────────────────── */

async function psLoadWallet() {
  if (typeof isCloudUser === 'function' && isCloudUser() && currentUser?.id) {
    if (typeof ensureCloudSession === 'function') {
      await ensureCloudSession({ refresh: true }).catch(() => null);
    }
    if (typeof loadCloudProfile === 'function') {
      try {
        const fresh = await loadCloudProfile(currentUser.id, { force: true });
        if (fresh && String(fresh.id) === String(currentUser.id)) {
          Object.assign(currentUser, fresh);
          if (typeof saveSession === 'function') saveSession(currentUser);
          if (typeof updateLobbyBalance === 'function') updateLobbyBalance();
        }
      } catch (e) {
        console.warn('[ps] wallet sync', e);
      }
    }
  }
  if (typeof getUserBalance === 'function') {
    const bal = Number(getUserBalance() || 0);
    PS_STATE.wallet = bal;
    psRenderWalletBadge();
    return bal;
  }
  return 0;
}
async function psLoadEventsBySportKeys(sb, sportKeys) {
  const keys = [...new Set((sportKeys || []).filter(Boolean))];
  if (!keys.length) return [];

  const batches = await Promise.all(
    keys.map((sk) =>
      sb.rpc('list_upcoming_events', {
        p_sport_key: sk,
        p_limit: PS_EVENTS_PER_SPORT,
        p_hours_ahead: 168,
      }).then(({ data, error }) => {
        if (error) {
          console.warn('[ps] list_upcoming_events', sk, error);
          return [];
        }
        return Array.isArray(data) ? data : [];
      })
    )
  );

  const seen = new Set();
  const merged = [];
  for (const batch of batches) {
    for (const ev of batch) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      merged.push(ev);
      if (merged.length >= PS_EVENTS_MAX_TOTAL) break;
    }
    if (merged.length >= PS_EVENTS_MAX_TOTAL) break;
  }
  merged.sort((a, b) => new Date(a.commence_at) - new Date(b.commence_at));
  return merged;
}

async function psDiscoverSportKeys(sb) {
  const { data, error } = await sb.rpc('list_upcoming_sport_keys', { p_hours_ahead: 168 });
  if (!error && Array.isArray(data) && data.length) {
    return data.map((r) => r.sport_key || r).filter(Boolean);
  }

  const since = new Date().toISOString();
  const until = new Date(Date.now() + 168 * 3600 * 1000).toISOString();
  const { data: rows, error: qErr } = await sb
    .from('sport_events')
    .select('sport_key')
    .in('status', ['upcoming', 'live'])
    .gte('commence_at', new Date(Date.now() - 3 * 3600 * 1000).toISOString())
    .lte('commence_at', until);
  if (qErr || !rows?.length) return Object.keys(PS_SPORT_MAP);
  return [...new Set(rows.map((r) => r.sport_key).filter(Boolean))];
}

async function psLoadEvents() {
  const sb = psGetSb();
  if (!sb) return [];

  const { data, error } = await sb.rpc('list_upcoming_events_balanced', {
    p_per_sport: PS_EVENTS_PER_SPORT,
    p_hours_ahead: 168,
    p_max_total: PS_EVENTS_MAX_TOTAL,
  });
  if (!error && Array.isArray(data)) {
    return psNormalizeEventsMarkets(data);
  }
  if (error) console.warn('[ps] list_upcoming_events_balanced', error);

  const sportKeys = await psDiscoverSportKeys(sb);
  return psNormalizeEventsMarkets(await psLoadEventsBySportKeys(sb, sportKeys));
}
async function psLoadMyBets(status = null) {
  const sb = psGetSb();
  if (!sb) return [];
  const { data, error } = await sb.rpc('my_sport_bets', { p_status: status, p_limit: 100 });
  if (error) { console.warn('[ps] my_sport_bets', error); return []; }
  return Array.isArray(data) ? data : [];
}
async function psLoadLeaderboard() {
  const sb = psGetSb();
  if (!sb) return [];
  const now = new Date();
  const { data, error } = await sb.rpc('sport_bets_leaderboard', {
    p_year: now.getFullYear(),
    p_month: now.getMonth() + 1,
    p_limit: 20,
  });
  if (error) { console.warn('[ps] leaderboard', error); return []; }
  return Array.isArray(data) ? data : [];
}
async function psClaimDailyBonus() {
  if (!(await psRequireAuth())) return null;
  const sb = psGetSb();
  if (!sb) {
    psToast('Connexion cloud indisponible.', 'error');
    return null;
  }
  const { data, error } = await sb.rpc('claim_daily_bet_bonus');
  if (error) {
    psToast(psMapRpcError(error), error.message?.includes('already_claimed') ? 'info' : 'error');
    if (String(error.message || '').includes('auth_required') && typeof showAuth === 'function') showAuth();
    return null;
  }
  const row = Array.isArray(data) ? data[0] : data;
  if (!row) return null;
  PS_STATE.wallet = Number(row.new_balance || 0);
  if (typeof setUserBalance === 'function') setUserBalance(PS_STATE.wallet);
  psRenderWalletBadge();
  psToast(`+${psFmt(row.awarded)} HugoCoins (streak ${row.streak} j)`, 'success');
  return row;
}
async function psPlaceComboBet(legs, stake) {
  const sb = psGetSb();
  if (!sb) throw new Error('no_client');
  const payload = legs.map((s) => ({
    event_id: s.event_id,
    market_key: s.market_key,
    bookmaker: s.bookmaker,
    selection_name: s.selection_name,
    selection_label: s.selection_label,
    selection_details: s.selection_details || {},
    odd: s.odd,
  }));
  const { data, error } = await sb.rpc('place_sport_combo_bet', {
    p_legs: payload,
    p_stake: stake,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}
async function psPlaceBet(bet) {
  const sb = psGetSb();
  if (!sb) throw new Error('no_client');
  const { data, error } = await sb.rpc('place_sport_bet', {
    p_event_id: bet.event_id,
    p_market_key: bet.market_key,
    p_bookmaker: bet.bookmaker,
    p_selection_name: bet.selection_name,
    p_selection_label: bet.selection_label,
    p_selection_details: bet.selection_details || {},
    p_stake: bet.stake,
    p_odd: bet.odd,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/* ────────────────────────────────────────────────────────────────────────────
   Rendu
   ──────────────────────────────────────────────────────────────────────────── */

function psRenderWalletBadge() {
  const el = document.getElementById('ps-wallet-amount');
  if (el) el.textContent = psFmt(PS_STATE.wallet);
}

/* Compteurs par compétition (sport_key PropLine) pour les onglets. */
function psCountBySportKey(events) {
  const counts = { all: events.length };
  const labels = new Map();
  for (const ev of events) {
    const key = ev.sport_key || 'other';
    counts[key] = (counts[key] || 0) + 1;
    if (!labels.has(key)) {
      labels.set(key, ev.sport_label || psSportInfo(key, ev.sport_label).league || key);
    }
  }
  return { counts, labels };
}

function psRenderSportNav() {
  const nav = document.getElementById('ps-sport-nav');
  if (!nav) return;
  const { counts, labels } = psCountBySportKey(PS_STATE.events);
  const sportKeys = Object.keys(counts).filter((k) => k !== 'all');
  sportKeys.sort((a, b) => (counts[b] - counts[a]));
  const items = [
    { key: 'all', label: 'Tous', icon: psSportIconImg('all', 24), count: counts.all },
    ...sportKeys.map((sk) => {
      const fam = psSportInfo(sk, labels.get(sk)).family;
      return {
        key: sk,
        label: labels.get(sk) || sk,
        icon: psSportIconImg(fam, 24),
        count: counts[sk],
      };
    }),
  ];
  nav.innerHTML = items.map((it) => `
    <button type="button" class="ps-wmx-sport-tab ${PS_STATE.activeSportKey === it.key ? 'active' : ''}" data-sport-key="${psEscape(it.key)}">
      <span class="ps-wmx-sport-icon">${it.icon}</span>
      <span class="ps-wmx-sport-name">${psEscape(it.label)}</span>
    </button>
  `).join('');
  nav.querySelectorAll('.ps-wmx-sport-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      PS_STATE.activeSportKey = btn.dataset.sportKey;
      psRenderSportNav();
      psRenderSidebarCompetitions();
      psRenderLeagues();
    });
  });
}

function psFilteredEvents() {
  let events = PS_STATE.activeSportKey === 'all'
    ? PS_STATE.events
    : PS_STATE.events.filter((ev) => ev.sport_key === PS_STATE.activeSportKey);
  if (PS_STATE.viewMode === 'live') {
    events = events.filter((ev) => psIsEventLive(ev));
  }
  const q = String(PS_STATE.searchQuery || '').trim().toLowerCase();
  if (q) {
    events = events.filter((ev) =>
      `${ev.home_team} ${ev.away_team} ${ev.sport_label || ''}`.toLowerCase().includes(q));
  }
  return events;
}

function psRenderSidebarCompetitions() {
  const sidebar = document.getElementById('ps-sidebar-competitions');
  if (!sidebar) return;
  const { counts, labels } = psCountBySportKey(PS_STATE.events);
  const keys = Object.keys(counts).filter((k) => k !== 'all').sort((a, b) => counts[b] - counts[a]);
  const families = new Map();
  for (const sk of keys) {
    const fam = psSportInfo(sk, labels.get(sk)).family;
    if (!families.has(fam)) families.set(fam, []);
    families.get(fam).push({ key: sk, label: labels.get(sk), count: counts[sk] });
  }
  sidebar.innerHTML = `
    <div class="ps-wmx-sidebar-title">Sports</div>
    <button type="button" class="ps-wmx-sidebar-item ${PS_STATE.activeSportKey === 'all' ? 'active' : ''}" data-sport-key="all">
      <span class="ps-wmx-sidebar-icon">${psSportIconImg('all', 18)}</span>
      <span>Tous les matchs</span>
      <span class="ps-wmx-sidebar-count">${counts.all || 0}</span>
    </button>
    ${[...families.entries()].map(([fam, items]) => `
      <div class="ps-wmx-sidebar-group">
        <div class="ps-wmx-sidebar-group-head">
          ${psSportIconImg(fam, 16)}
          <span>${psEscape(PS_FAMILY_LABELS[fam] || fam)}</span>
        </div>
        ${items.map((it) => `
          <button type="button" class="ps-wmx-sidebar-item ${PS_STATE.activeSportKey === it.key ? 'active' : ''}" data-sport-key="${psEscape(it.key)}">
            <span>${psEscape(it.label)}</span>
            <span class="ps-wmx-sidebar-count">${it.count}</span>
          </button>
        `).join('')}
      </div>
    `).join('')}
  `;
  sidebar.querySelectorAll('[data-sport-key]').forEach((btn) => {
    btn.addEventListener('click', () => {
      PS_STATE.activeSportKey = btn.dataset.sportKey;
      psRenderSidebarCompetitions();
      psRenderSportNav();
      psRenderLeagues();
    });
  });
}

/* Regroupe les events par ligue (sport_key). */
function psGroupByLeague(events) {
  const groups = new Map();
  for (const ev of events) {
    const key = ev.sport_key || 'other';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  }
  const result = Array.from(groups.entries()).map(([sportKey, evs]) => {
    const info = psSportInfo(sportKey, evs[0]?.sport_label);
    return {
      sport_key: sportKey,
      family: info.family,
      league: evs[0]?.sport_label || info.league,
      country: info.country,
      events: evs.sort((a, b) => {
        const la = psIsEventLive(a) ? 0 : 1;
        const lb = psIsEventLive(b) ? 0 : 1;
        if (la !== lb) return la - lb;
        return new Date(a.commence_at) - new Date(b.commence_at);
      }),
    };
  });
  result.sort((a, b) => b.events.length - a.events.length || (a.events[0].commence_at || '').localeCompare(b.events[0].commence_at || ''));
  return result;
}

function psRenderLeagues() {
  const container = document.getElementById('ps-leagues-container');
  if (!container) return;
  const events = psFilteredEvents();
  if (!events.length) {
    const msg = PS_STATE.viewMode === 'live'
      ? 'Aucun match en direct pour l’instant.'
      : 'Aucun match à venir pour ce sport. Reviens plus tard, les cotes sont rafraîchies toutes les minutes.';
    container.innerHTML = `<div class="ps-empty">${msg}</div>`;
    return;
  }

  const groups = psGroupByLeague(events);
  container.innerHTML = groups.map((g) => psRenderLeagueBlock(g)).join('');

  psBindMatchListeners(container);
  psHydrateTeamLogos(container);
}

function psRenderSportSection(family, events) {
  const groups = psGroupByLeague(events);
  const label = PS_FAMILY_LABELS[family] || family;
  return `
    <section class="ps-sport-section" data-sport-family="${family}">
      <header class="ps-sport-section-header">
        ${psSportIconImg(family, 32)}
        <div class="ps-sport-section-titles">
          <h2 class="ps-sport-section-name">${psEscape(label)}</h2>
          <span class="ps-sport-section-meta">${events.length} match${events.length > 1 ? 's' : ''} · ${groups.length} compétition${groups.length > 1 ? 's' : ''}</span>
        </div>
      </header>
      <div class="ps-sport-section-body">
        ${groups.map((g) => psRenderLeagueBlock(g)).join('')}
      </div>
    </section>
  `;
}

function psRenderStatusHtml(disp, isLive, isFinished) {
  if (disp.mode === 'score') {
    return `<div class="ps-m-status-score">
      <span class="ps-m-score">${psEscape(String(disp.home))}</span>
      <span class="ps-m-score-sep">-</span>
      <span class="ps-m-score">${psEscape(String(disp.away))}</span>
      ${disp.sub ? `<span class="ps-m-period">${psEscape(disp.sub)}</span>` : ''}
    </div>`;
  }
  if (disp.mode === 'period') {
    return `<span class="ps-m-status-pill ps-m-status-pill--period">${psEscape(disp.text)}</span>`;
  }
  if (disp.mode === 'live') {
    return `<span class="ps-m-status-pill ps-m-status-pill--live">EN COURS</span>`;
  }
  if (isFinished) {
    return `<span class="ps-m-status-pill ps-m-status-pill--ft">Terminé</span>`;
  }
  return `<span class="ps-m-status-vs">VS</span>`;
}

function psRenderLeagueBlock(group) {
  return `
    <section class="ps-wmx-comp" data-sport-key="${group.sport_key}">
      <header class="ps-wmx-comp-head" role="button" tabindex="0" aria-expanded="true">
        <span class="ps-wmx-comp-chevron"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg></span>
        ${psLeagueFlag(group.country)}
        <h3 class="ps-wmx-comp-name">${psEscape(group.league)}</h3>
        <span class="ps-wmx-comp-count">${group.events.length}</span>
      </header>
      <div class="ps-wmx-comp-matches">
        ${group.events.map((ev) => psRenderMatchRow(ev, group.family)).join('')}
      </div>
    </section>
  `;
}

function psRenderMatchRow(ev, sportFamily) {
  const fam = sportFamily || psSportInfo(ev.sport_key, ev.sport_label).family;
  const markets = ev.markets || {};
  const h2h = markets.h2h;
  const outcomes = h2h?.outcomes || [];
  const homeOutcome = outcomes.find((o) => {
    const l = String(o.name).toLowerCase();
    return l === 'home' || l === ev.home_team.toLowerCase();
  });
  const drawOutcome = outcomes.find((o) => String(o.name).toLowerCase() === 'draw');
  const awayOutcome = outcomes.find((o) => {
    const l = String(o.name).toLowerCase();
    return l === 'away' || l === ev.away_team.toLowerCase();
  });
  const otherMarketsCount = Object.keys(markets).filter((k) => k !== 'h2h').length;
  const hasDraw = !!drawOutcome;
  const cols = hasDraw ? 3 : 2;

  const oddBtn = (outcome, align, shortLbl) => {
    if (!outcome || !h2h) {
      return `<div class="ps-m-odd ps-m-odd--off ps-m-odd--${align}"><span class="ps-m-odd-lbl">${psEscape(shortLbl || '—')}</span><span class="ps-m-odd-val">—</span></div>`;
    }
    const odd = psNormalizeDecimalOdd(outcome.price);
    if (!odd) {
      return `<div class="ps-m-odd ps-m-odd--off ps-m-odd--${align}"><span class="ps-m-odd-lbl">${psEscape(shortLbl || '—')}</span><span class="ps-m-odd-val">—</span></div>`;
    }
    const label = psOutcomeLabel('h2h', outcome.name, ev);
    const slipId = `${ev.id}|h2h|${outcome.name}`;
    const inSlip = PS_STATE.slip.some((s) => s.id === slipId);
    return `
      <button type="button" class="ps-m-odd ps-m-odd--${align} ${inSlip ? 'is-selected' : ''}"
        data-event-id="${ev.id}" data-market-key="h2h" data-bookmaker="${psEscape(h2h.bookmaker)}"
        data-selection-name="${psEscape(outcome.name)}" data-selection-label="${psEscape(label)}"
        data-odd="${odd}" title="${psEscape(label)}">
        <span class="ps-m-odd-lbl">${psEscape(shortLbl || psShortH2HLabel(outcome.name, ev))}</span>
        <span class="ps-m-odd-val">${psFmtOdd(odd)}</span>
      </button>`;
  };

  const timeStr = new Date(ev.commence_at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = new Date(ev.commence_at).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
  const isLive = psIsEventLive(ev);
  const isFinished = psIsEventFinished(ev);
  const countdown = !isLive && !isFinished ? psCountdownLabel(ev.commence_at) : null;
  const disp = psDisplayScore(ev, isLive, isFinished);

  const statusHtml = psRenderStatusHtml(disp, isLive, isFinished);
  const badgeSize = 22;
  const useVertical = !hasDraw;

  const timeCol = `
    <div class="ps-m-timecol">
      ${isFinished
    ? `<span class="ps-m-ft">FT</span>`
    : isLive
      ? `<span class="ps-wmx-live-badge"><span class="ps-wmx-live-dot"></span>LIVE</span>`
      : ''}
      <span class="ps-m-clock ${!isLive && !isFinished ? 'ps-m-clock--kick' : ''}">${timeStr}</span>
      ${!isLive && !isFinished ? `<span class="ps-m-date">${dateStr}</span>${countdown ? `<span class="ps-wmx-countdown">${countdown}</span>` : ''}` : ''}
    </div>`;

  const oddsBlock = !isFinished ? `
    <div class="ps-m-oddscol">
      <div class="ps-m-odds ps-m-odds--${cols}">
        ${oddBtn(homeOutcome, 'home', '1')}
        ${hasDraw ? oddBtn(drawOutcome, 'draw', 'N') : ''}
        ${oddBtn(awayOutcome, 'away', '2')}
      </div>
      <button type="button" class="ps-m-detail-btn" data-event-id="${ev.id}" title="Tous les marchés" aria-label="Plus de marchés">+</button>
    </div>` : `
    <div class="ps-m-final-col">${disp.mode === 'score' ? `${disp.home} - ${disp.away}` : (disp.sub || disp.text || '—')}</div>`;

  const marketsBtn = !isFinished && otherMarketsCount > 0
    ? `<button type="button" class="ps-m-markets-link ps-wmx-more" data-event-id="${ev.id}">+ ${otherMarketsCount} marché${otherMarketsCount > 1 ? 's' : ''}</button>`
    : '';

  const teamsBlock = useVertical ? `
    <div class="ps-m-teams-grid">
      <div class="ps-m-teamline ps-m-teamline--home">
        <span class="ps-m-name" title="${psEscape(ev.home_team)}">${psEscape(ev.home_team)}</span>
        ${psTeamLogoHtml(ev.home_team, fam, badgeSize)}
      </div>
      <div class="ps-m-status">${statusHtml}</div>
      <div class="ps-m-teamline ps-m-teamline--away">
        ${psTeamLogoHtml(ev.away_team, fam, badgeSize)}
        <span class="ps-m-name" title="${psEscape(ev.away_team)}">${psEscape(ev.away_team)}</span>
      </div>
    </div>` : `
    <div class="ps-m-teams ps-m-teams--h">
      <div class="ps-m-team ps-m-team--home">
        ${psTeamLogoHtml(ev.home_team, fam, 26)}
        <span class="ps-m-name" title="${psEscape(ev.home_team)}">${psEscape(ev.home_team)}</span>
      </div>
      <div class="ps-m-status ps-m-status--inline">${statusHtml}</div>
      <div class="ps-m-team ps-m-team--away">
        <span class="ps-m-name" title="${psEscape(ev.away_team)}">${psEscape(ev.away_team)}</span>
        ${psTeamLogoHtml(ev.away_team, fam, 26)}
      </div>
    </div>`;

  return `
    <article class="ps-m${isLive ? ' ps-m--live' : ''}${isFinished ? ' ps-m--finished' : ''}${useVertical ? ' ps-m--vert' : ''}" data-event-id="${ev.id}">
      <div class="ps-m-row${useVertical ? ' ps-m-row--vert' : ''}">
        ${timeCol}
        <div class="ps-m-center">
          ${teamsBlock}
          ${marketsBtn}
        </div>
        ${oddsBlock}
      </div>
      ${!isFinished ? `<div class="ps-match-extra" id="ps-extra-${ev.id}" hidden></div>` : ''}
    </article>
  `;
}

function psBindMatchListeners(root) {
  root.querySelectorAll('.ps-wmx-comp-head').forEach((hdr) => {
    const toggle = () => {
      const block = hdr.closest('.ps-wmx-comp');
      if (!block) return;
      block.classList.toggle('is-collapsed');
      hdr.setAttribute('aria-expanded', block.classList.contains('is-collapsed') ? 'false' : 'true');
    };
    hdr.addEventListener('click', toggle);
    hdr.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
    });
  });
  root.querySelectorAll('.ps-m-odd:not(.ps-m-odd--off)').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      psAddToSlip({
        event_id: Number(btn.dataset.eventId),
        market_key: btn.dataset.marketKey,
        bookmaker: btn.dataset.bookmaker,
        selection_name: btn.dataset.selectionName,
        selection_label: btn.dataset.selectionLabel,
        selection_details: {},
        odd: Number(btn.dataset.odd),
      });
    });
  });
  root.querySelectorAll('.ps-wmx-more').forEach((btn) => {
    btn.addEventListener('click', () => psToggleMatchExtra(Number(btn.dataset.eventId)));
  });
  root.querySelectorAll('.ps-m-detail-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      psOpenMatchDetail(Number(btn.dataset.eventId));
    });
  });
}

function psToggleMatchExtra(eventId) {
  const ev = PS_STATE.events.find((e) => Number(e.id) === Number(eventId));
  if (!ev) return;
  const panel = document.getElementById(`ps-extra-${eventId}`);
  if (!panel) return;
  const btn = document.querySelector(`.ps-wmx-more[data-event-id="${eventId}"]`);
  if (!panel.hasAttribute('hidden')) {
    panel.setAttribute('hidden', ''); panel.innerHTML = '';
    if (btn) btn.classList.remove('open');
    return;
  }
  const otherKeys = Object.keys(ev.markets || {}).filter((k) => k !== 'h2h');
  if (!otherKeys.length) { psToast('Pas d’autres marchés pour ce match.', 'info'); return; }
  panel.innerHTML = otherKeys.map((mk) => {
    const mdata = ev.markets[mk];
    return `
      <div class="ps-extra-market">
        <div class="ps-extra-market-label">${PS_MARKETS_LABELS[mk] || mk}</div>
        <div class="ps-extra-market-outcomes">
          ${(mdata.outcomes || []).map((o) => {
            const label = psOutcomeLabel(mk, o.name, ev);
            const pt = (o.point !== undefined && o.point !== null) ? ` ${o.point}` : '';
            return `
              <button type="button" class="ps-extra-outcome"
                data-event-id="${ev.id}"
                data-market-key="${mk}"
                data-bookmaker="${psEscape(mdata.bookmaker)}"
                data-selection-name="${psEscape(o.name)}"
                data-selection-label="${psEscape(label + pt)}"
                data-selection-point="${o.point != null ? o.point : ''}"
                data-odd="${psNormalizeDecimalOdd(o.price) || ''}">
                <span class="ps-extra-outcome-label">${psEscape(label)}${pt ? `<em class="ps-extra-point">${pt}</em>` : ''}</span>
                <span class="ps-extra-outcome-odd">${psFmtOdd(o.price)}</span>
              </button>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');
  panel.removeAttribute('hidden');
  if (btn) btn.classList.add('open');
  panel.querySelectorAll('.ps-extra-outcome').forEach((b) => {
    b.addEventListener('click', () => {
      const details = {};
      if (b.dataset.selectionPoint) details.point = Number(b.dataset.selectionPoint);
      psAddToSlip({
        event_id: Number(b.dataset.eventId),
        market_key: b.dataset.marketKey,
        bookmaker: b.dataset.bookmaker,
        selection_name: b.dataset.selectionName,
        selection_label: b.dataset.selectionLabel,
        selection_details: details,
        odd: Number(b.dataset.odd),
      });
    });
  });
}

function psOpenMatchDetail(eventId) {
  const ev = PS_STATE.events.find((e) => Number(e.id) === Number(eventId));
  if (!ev) return;
  PS_STATE.detailEventId = eventId;
  const overlay = document.getElementById('ps-match-detail');
  const body = document.getElementById('ps-match-detail-body');
  if (!overlay || !body) return;
  const fam = psSportInfo(ev.sport_key, ev.sport_label).family;
  const isLive = psIsEventLive(ev);
  const isFinished = psIsEventFinished(ev);
  const disp = psDisplayScore(ev, isLive, isFinished);
  const markets = ev.markets || {};
  const marketKeys = Object.keys(markets);
  body.innerHTML = `
    <header class="ps-detail-head">
      <div class="ps-detail-comp">${psEscape(ev.sport_label || ev.sport_key)}</div>
      <div class="ps-detail-teams">
        <div class="ps-detail-team">
          ${psTeamLogoHtml(ev.home_team, fam, 40)}
          <span class="ps-detail-team-name">${psEscape(ev.home_team)}</span>
          ${disp.mode === 'score' ? `<strong class="ps-detail-score">${disp.home}</strong>` : ''}
        </div>
        <div class="ps-detail-vs">${isLive ? '<span class="ps-wmx-live-badge"><span class="ps-wmx-live-dot"></span>LIVE</span>' : disp.mode === 'score' ? `${disp.home} – ${disp.away}` : 'vs'}</div>
        <div class="ps-detail-team">
          ${disp.mode === 'score' ? `<strong class="ps-detail-score">${disp.away}</strong>` : ''}
          <span class="ps-detail-team-name">${psEscape(ev.away_team)}</span>
          ${psTeamLogoHtml(ev.away_team, fam, 40)}
        </div>
      </div>
      ${disp.sub ? `<div class="ps-detail-period">${psEscape(disp.sub)}</div>` : ''}
    </header>
    <div class="ps-detail-markets">
      ${marketKeys.length ? marketKeys.map((mk) => {
    const mdata = markets[mk];
    return `
        <section class="ps-detail-market">
          <h4>${PS_MARKETS_LABELS[mk] || mk}</h4>
          <div class="ps-detail-outcomes">
            ${(mdata.outcomes || []).map((o) => {
      const label = psOutcomeLabel(mk, o.name, ev);
      const pt = (o.point != null) ? ` ${o.point}` : '';
      const odd = psNormalizeDecimalOdd(o.price);
      if (!odd) return '';
      const slipId = `${ev.id}|${mk}|${o.name}`;
      const inSlip = PS_STATE.slip.some((s) => s.id === slipId);
      return `
              <button type="button" class="ps-wmx-odd ${inSlip ? 'is-selected' : ''}"
                data-event-id="${ev.id}" data-market-key="${mk}" data-bookmaker="${psEscape(mdata.bookmaker)}"
                data-selection-name="${psEscape(o.name)}" data-selection-label="${psEscape(label + pt)}"
                data-selection-point="${o.point != null ? o.point : ''}" data-odd="${odd}">
                <span class="ps-wmx-odd-lbl">${psEscape(label)}${pt ? `<em>${pt.trim()}</em>` : ''}</span>
                <span class="ps-wmx-odd-val">${psFmtOdd(odd)}</span>
              </button>`;
    }).join('')}
          </div>
        </section>`;
  }).join('') : '<div class="ps-empty">Aucun marché disponible.</div>'}
    </div>`;
  overlay.hidden = false;
  document.body.classList.add('ps-detail-open');
  body.querySelectorAll('.ps-wmx-odd').forEach((btn) => {
    btn.addEventListener('click', () => {
      const details = {};
      if (btn.dataset.selectionPoint) details.point = Number(btn.dataset.selectionPoint);
      psAddToSlip({
        event_id: Number(btn.dataset.eventId),
        market_key: btn.dataset.marketKey,
        bookmaker: btn.dataset.bookmaker,
        selection_name: btn.dataset.selectionName,
        selection_label: btn.dataset.selectionLabel,
        selection_details: details,
        odd: Number(btn.dataset.odd),
      });
      psOpenMatchDetail(eventId);
    });
  });
  psHydrateTeamLogos(body);
}

function psCloseMatchDetail() {
  PS_STATE.detailEventId = null;
  const overlay = document.getElementById('ps-match-detail');
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('ps-detail-open');
}

/* ────────────────────────────────────────────────────────────────────────────
   Panier Winamax
   ──────────────────────────────────────────────────────────────────────────── */

function psAddToSlip(bet) {
  const odd = psNormalizeDecimalOdd(bet.odd);
  if (!odd || odd < 1.01) { psToast('Cote indisponible.', 'warn'); return; }
  const ev = PS_STATE.events.find((e) => Number(e.id) === Number(bet.event_id));
  if (!ev) { psToast('Match introuvable.', 'warn'); return; }
  if (psIsEventFinished(ev)) { psToast('Match terminé — paris fermés.', 'warn'); return; }
  const id = `${bet.event_id}|${bet.market_key}|${bet.selection_name}`;
  if (PS_STATE.slipMode === 'combo') {
    if (PS_STATE.slip.length >= 8 && !PS_STATE.slip.some((s) => s.id === id)) {
      psToast('Combiné limité à 8 sélections.', 'warn');
      return;
    }
    PS_STATE.slip = PS_STATE.slip.filter((s) => s.id !== id);
    if (!PS_STATE.slip.some((s) => s.event_id === bet.event_id)) {
      PS_STATE.slip.push({
        id, event_id: bet.event_id, market_key: bet.market_key, bookmaker: bet.bookmaker,
        selection_name: bet.selection_name, selection_label: bet.selection_label,
        selection_details: bet.selection_details || {},
        odd, event: ev, teams: `${ev.home_team} - ${ev.away_team}`,
      });
    } else {
      PS_STATE.slip = PS_STATE.slip.filter((s) => s.event_id !== bet.event_id);
      PS_STATE.slip.push({
        id, event_id: bet.event_id, market_key: bet.market_key, bookmaker: bet.bookmaker,
        selection_name: bet.selection_name, selection_label: bet.selection_label,
        selection_details: bet.selection_details || {},
        odd, event: ev, teams: `${ev.home_team} - ${ev.away_team}`,
      });
    }
  } else {
    PS_STATE.slip = PS_STATE.slip.filter((s) => s.event_id !== bet.event_id);
    PS_STATE.slip.push({
      id, event_id: bet.event_id, market_key: bet.market_key, bookmaker: bet.bookmaker,
      selection_name: bet.selection_name, selection_label: bet.selection_label,
      selection_details: bet.selection_details || {},
      odd, event: ev, teams: `${ev.home_team} - ${ev.away_team}`,
    });
  }
  psRenderSlip();
  psRenderLeagues();
  if (PS_STATE.detailEventId) psOpenMatchDetail(PS_STATE.detailEventId);
}

function psRemoveFromSlip(id) {
  PS_STATE.slip = PS_STATE.slip.filter((s) => s.id !== id);
  psRenderSlip();
  psRenderLeagues();
}

function psClearSlip() {
  PS_STATE.slip = [];
  psRenderSlip();
  psRenderLeagues();
}

function psRenderSlip() {
  const countEl = document.getElementById('ps-slip-count');
  const emptyEl = document.getElementById('ps-slip-empty');
  const listEl = document.getElementById('ps-slip-list');
  const footerEl = document.getElementById('ps-slip-footer');
  const clearBtn = document.getElementById('ps-slip-clear');
  const n = PS_STATE.slip.length;
  if (countEl) countEl.textContent = `${n} sélection${n > 1 ? 's' : ''}`;
  if (clearBtn) clearBtn.hidden = n === 0;
  if (emptyEl) emptyEl.hidden = n > 0;
  if (listEl) {
    listEl.hidden = n === 0;
    listEl.innerHTML = PS_STATE.slip.map((s) => `
      <div class="ps-slip-item">
        <button type="button" class="ps-slip-remove" data-slip-id="${psEscape(s.id)}">×</button>
        <div class="ps-slip-item-teams">${psEscape(s.teams)}</div>
        <div class="ps-slip-item-sel"><strong>${psEscape(s.selection_label)}</strong></div>
        <div class="ps-slip-item-odd">${psFmtOdd(s.odd)}</div>
      </div>
    `).join('');
    listEl.querySelectorAll('.ps-slip-remove').forEach((btn) => {
      btn.addEventListener('click', () => psRemoveFromSlip(btn.dataset.slipId));
    });
  }
  if (footerEl) footerEl.hidden = n === 0;
  psUpdateSlipSummary();
}

function psUpdateSlipSummary() {
  const stakeInput = document.getElementById('ps-slip-stake');
  const payoutEl = document.getElementById('ps-slip-payout');
  const totalOddEl = document.getElementById('ps-slip-total-odd');
  const submitBtn = document.getElementById('ps-slip-submit');
  const stake = Number(stakeInput?.value || PS_STATE.slipStake || 100);
  PS_STATE.slipStake = stake;
  const isCombo = PS_STATE.slipMode === 'combo' && PS_STATE.slip.length >= 2;
  const combined = isCombo ? psCombinedOdd() : (PS_STATE.slip[0]?.odd || 0);
  const payout = combined ? Math.round(stake * combined) : 0;
  const authOk = typeof isCloudUser === 'function' && isCloudUser();
  if (totalOddEl) totalOddEl.textContent = combined ? psFmtOdd(combined) : '—';
  if (payoutEl) payoutEl.textContent = `${psFmt(payout)} HC`;
  if (submitBtn) {
    const minLegs = isCombo ? 2 : 1;
    const lowBalance = authOk && PS_STATE.wallet < 10;
    submitBtn.disabled = !authOk || PS_STATE.slip.length < minLegs || stake < 10 || stake > 500000 || stake > PS_STATE.wallet;
    submitBtn.textContent = !authOk ? 'Connecte-toi pour parier'
      : lowBalance ? 'Solde à 0 — Bonus quotidien'
        : stake > PS_STATE.wallet ? 'Solde insuffisant'
          : isCombo ? `Parier combiné ${psFmt(stake)} HC` : `Parier ${psFmt(stake)} HC`;
  }
  const errEl = document.getElementById('ps-slip-error');
  if (errEl && authOk && PS_STATE.wallet < 10 && PS_STATE.slip.length > 0) {
    errEl.textContent = 'Solde HugoCoins insuffisant — clique sur « Bonus » en haut pour récupérer +100 HC.';
    errEl.hidden = false;
  } else if (errEl && authOk && PS_STATE.slip.length === 0) {
    errEl.hidden = true;
  }
}

async function psConfirmSlip() {
  if (!PS_STATE.slip.length) return;
  if (!(await psRequireAuth())) return;
  const stake = Number(document.getElementById('ps-slip-stake')?.value || 100);
  const errEl = document.getElementById('ps-slip-error');
  if (PS_STATE.wallet < 10) {
    if (errEl) {
      errEl.textContent = 'Solde à 0 — réclame le bonus quotidien (+100 HC) via le bouton « Bonus ».';
      errEl.hidden = false;
    }
    psToast('Réclame d’abord le bonus quotidien pour obtenir des HugoCoins.', 'warn');
    return;
  }
  if (stake < 10 || stake > PS_STATE.wallet) {
    if (errEl) { errEl.textContent = 'Mise invalide.'; errEl.hidden = false; }
    return;
  }
  const isCombo = PS_STATE.slipMode === 'combo' && PS_STATE.slip.length >= 2;
  const btn = document.getElementById('ps-slip-submit');
  if (btn) { btn.disabled = true; btn.textContent = 'En cours…'; }
  try {
    if (isCombo) {
      const row = await psPlaceComboBet(PS_STATE.slip, stake);
      PS_STATE.wallet = Number(row.new_balance || 0);
      if (typeof setUserBalance === 'function') setUserBalance(PS_STATE.wallet);
      psRenderWalletBadge();
      psClearSlip();
      psToast(`Combiné validé @ ${psFmtOdd(row.combined_odd)}`, 'success');
    } else {
      const sel = PS_STATE.slip[0];
      const row = await psPlaceBet({
        event_id: sel.event_id, market_key: sel.market_key, bookmaker: sel.bookmaker,
        selection_name: sel.selection_name, selection_label: sel.selection_label,
        selection_details: sel.selection_details || {}, stake, odd: sel.odd,
      });
      PS_STATE.wallet = Number(row.new_balance || 0);
      if (typeof setUserBalance === 'function') setUserBalance(PS_STATE.wallet);
      psRenderWalletBadge();
      psClearSlip();
      psToast(`Pari validé @ ${psFmtOdd(sel.odd)}`, 'success');
    }
    if (errEl) errEl.hidden = true;
  } catch (e) {
    if (errEl) {
      errEl.textContent = psMapRpcError(e);
      errEl.hidden = false;
    }
    if (String(e?.message || '').includes('auth_required') && typeof showAuth === 'function') showAuth();
    psUpdateSlipSummary();
  }
}
/* ────────────────────────────────────────────────────────────────────────────
   Onglets Mes paris / Leaderboard
   ──────────────────────────────────────────────────────────────────────────── */

async function psRenderMineTab() {
  const list = document.getElementById('ps-mine-list');
  const summary = document.getElementById('ps-mine-summary');
  if (!list) return;
  if (!(await psRequireAuth())) { list.innerHTML = '<div class="ps-empty">Connecte-toi pour voir tes paris.</div>'; return; }
  list.innerHTML = '<div class="ps-empty">Chargement…</div>';
  const filter = PS_STATE.mineFilter === 'all' ? null : PS_STATE.mineFilter;
  const bets = await psLoadMyBets(filter);
  if (!bets.length) {
    list.innerHTML = '<div class="ps-empty">Tu n’as pas encore parié. Choisis un match dans l’onglet Matchs à venir.</div>';
    if (summary) summary.innerHTML = '';
    return;
  }
  const stats = bets.reduce((acc, b) => {
    acc.total++;
    if (b.status === 'won') { acc.won++; acc.profit += (Number(b.payout) || 0) - Number(b.stake); }
    else if (b.status === 'lost') { acc.profit -= Number(b.stake); acc.lost++; }
    else if (b.status === 'pending') { acc.pending++; acc.pendingStake += Number(b.stake); }
    return acc;
  }, { total: 0, won: 0, lost: 0, pending: 0, pendingStake: 0, profit: 0 });
  if (summary) summary.innerHTML = `
    <div class="ps-stat"><span>Paris</span><strong>${stats.total}</strong></div>
    <div class="ps-stat"><span>Gagnés</span><strong>${stats.won}</strong></div>
    <div class="ps-stat"><span>En cours</span><strong>${stats.pending}</strong></div>
    <div class="ps-stat ps-stat--${stats.profit >= 0 ? 'gain' : 'loss'}"><span>Profit net</span><strong>${stats.profit >= 0 ? '+' : ''}${psFmt(stats.profit)}</strong></div>
  `;
  list.innerHTML = bets.map((b) => psRenderBetRow(b)).join('');
}
function psRenderBetRow(b) {
  const snap = b.event_snapshot || {};
  const statusLabel = { pending: 'En cours', won: 'Gagné', lost: 'Perdu', void: 'Remboursé', refunded: 'Remboursé' }[b.status] || b.status;
  const teams = snap.home_team && snap.away_team ? `${snap.home_team} vs ${snap.away_team}` : `Event #${b.event_id}`;
  const isCombo = b.market_key === 'combo';
  const scoreLine = snap.home_score != null && snap.away_score != null
    ? `<div class="ps-bet-score">Score : ${snap.home_score} – ${snap.away_score}</div>` : '';
  return `
    <div class="ps-bet-row ps-bet-row--${b.status}">
      <div class="ps-bet-main">
        <div class="ps-bet-teams">${psEscape(teams)}</div>
        <div class="ps-bet-selection">${isCombo ? 'Combiné' : (PS_MARKETS_LABELS[b.market_key] || b.market_key)} — <strong>${psEscape(b.selection_label || b.selection_name)}</strong> @ ${psFmtOdd(b.odd)}</div>
        ${scoreLine}
        <div class="ps-bet-meta">${psFmtDate(b.placed_at)} · ${psEscape(snap.sport_label || snap.sport_key || '')}</div>
      </div>
      <div class="ps-bet-figures">
        <div class="ps-bet-stake">Mise : <strong>${psFmt(b.stake)}</strong></div>
        <div class="ps-bet-payout">${b.status === 'won' ? 'Gain :' : b.status === 'pending' ? 'Gain potentiel :' : ''} ${b.status === 'lost' ? '—' : `<strong>${psFmt(b.status === 'won' ? b.payout : b.potential_payout)}</strong>`}</div>
        <div class="ps-bet-status ps-bet-status--${b.status}">${statusLabel}</div>
      </div>
    </div>
  `;
}
async function psRenderLeaderboardTab() {
  const list = document.getElementById('ps-leaderboard-list');
  if (!list) return;
  list.innerHTML = '<div class="ps-empty">Chargement…</div>';
  const rows = await psLoadLeaderboard();
  if (!rows.length) {
    list.innerHTML = '<div class="ps-empty">Aucun pari réglé ce mois-ci. Sois le premier !</div>';
    return;
  }
  list.innerHTML = rows.map((r, i) => `
    <div class="ps-leader-row ${i === 0 ? 'ps-leader-row--gold' : ''}">
      <div class="ps-leader-rank">${i + 1}</div>
      <div class="ps-leader-user">
        ${r.avatar_url ? `<img src="${psEscape(r.avatar_url)}" alt="" class="ps-leader-avatar">` : '<div class="ps-leader-avatar ps-leader-avatar--empty"></div>'}
        <span>${psEscape(r.display_name || 'Joueur')}</span>
      </div>
      <div class="ps-leader-stats">
        <span title="Paris">${r.bets_count}p</span>
        <span title="Taux de réussite">${r.hit_rate}%</span>
        <strong class="ps-leader-profit ps-leader-profit--${Number(r.net_profit) >= 0 ? 'gain' : 'loss'}">${Number(r.net_profit) >= 0 ? '+' : ''}${psFmt(r.net_profit)} HC</strong>
      </div>
    </div>
  `).join('');
}

function psSwitchTab(tab) {
  PS_STATE.activeTab = tab;
  PS_STATE.viewMode = tab === 'live' ? 'live' : 'all';
  document.querySelectorAll('.ps-main-tab').forEach((t) => {
    t.classList.toggle('active', t.dataset.tab === tab);
  });
  const shell = document.getElementById('ps-wmx-shell-matches');
  if (shell) shell.hidden = tab !== 'matches' && tab !== 'live';
  document.getElementById('ps-section-mine').hidden = tab !== 'mine';
  document.getElementById('ps-section-leaderboard').hidden = tab !== 'leaderboard';
  if (tab === 'mine') psRenderMineTab();
  else if (tab === 'leaderboard') psRenderLeaderboardTab();
  else psRenderLeagues();
  psUpdateLiveTabBadge();
  if (typeof PS_STATE._refreshReschedule === 'function') PS_STATE._refreshReschedule();
  else if (tab === 'matches' || tab === 'live') psRefreshMatches();
}

function psUpdateLiveTabBadge() {
  const tab = document.querySelector('.ps-main-tab[data-tab="live"]');
  if (!tab) return;
  const n = psCountLiveEvents();
  const badge = tab.querySelector('.ps-live-tab-count');
  if (badge) badge.textContent = n > 0 ? String(n) : '';
  tab.classList.toggle('has-live', n > 0);
}

async function psRefreshMatches() {
  if (!psPageEl()) return;
  PS_STATE.events = await psLoadEvents();
  await psHydrateEspnLiveScores(PS_STATE.events);
  PS_STATE.events.sort((a, b) => {
    const la = psIsEventLive(a) ? 0 : 1;
    const lb = psIsEventLive(b) ? 0 : 1;
    if (la !== lb) return la - lb;
    return new Date(a.commence_at) - new Date(b.commence_at);
  });
  PS_STATE.lastRefreshAt = Date.now();

  psRenderSidebarCompetitions();
  psRenderSportNav();
  psUpdateLiveTabBadge();

  const onMatches = PS_STATE.activeTab === 'matches' || PS_STATE.activeTab === 'live';
  if (onMatches) {
    psRenderLeagues();
    psRenderSlip();
    if (PS_STATE.detailEventId) psOpenMatchDetail(PS_STATE.detailEventId);
  } else if (PS_STATE.activeTab === 'mine') {
    psRenderMineTab();
  }
}

function psStopAutoRefresh() {
  if (PS_STATE.refreshTimer) {
    clearInterval(PS_STATE.refreshTimer);
    PS_STATE.refreshTimer = null;
  }
}

function psRefreshIntervalMs() {
  if (PS_STATE.activeTab === 'live') return 8_000;
  if (PS_STATE.activeTab === 'matches') return 25_000;
  return 40_000;
}

function psArmAutoRefresh() {
  psStopAutoRefresh();
  let refreshing = false;
  const tick = async () => {
    if (!psPageEl()) return;
    if (refreshing) return;
    if (document.hidden && PS_STATE.activeTab !== 'live') return;
    refreshing = true;
    try {
      await psRefreshMatches();
    } catch (e) {
      console.warn('[ps] refresh', e);
    } finally {
      refreshing = false;
    }
  };

  PS_STATE.refreshTimer = setInterval(tick, psRefreshIntervalMs());
  tick();

  PS_STATE._refreshReschedule = () => {
    psStopAutoRefresh();
    PS_STATE.refreshTimer = setInterval(tick, psRefreshIntervalMs());
    tick();
  };
}

function psBindVisibilityRefresh() {
  if (PS_STATE.visibilityBound) return;
  PS_STATE.visibilityBound = true;

  document.addEventListener('visibilitychange', () => {
    if (!psPageEl() || document.hidden) return;
    if (typeof PS_STATE._refreshReschedule === 'function') PS_STATE._refreshReschedule();
  });

  window.addEventListener('pageshow', (e) => {
    if (!psPageEl()) return;
    if (e.persisted && typeof PS_STATE._refreshReschedule === 'function') {
      PS_STATE._refreshReschedule();
    }
  });

  window.addEventListener('focus', () => {
    if (!psPageEl()) return;
    const stale = Date.now() - (PS_STATE.lastRefreshAt || 0) > 5_000;
    if (stale && typeof PS_STATE._refreshReschedule === 'function') PS_STATE._refreshReschedule();
  });
}

function psPageEl() {
  return document.getElementById('page-paris-sportifs');
}

function psBindEvents() {
  if (PS_STATE.bootstrapped) return;
  PS_STATE.bootstrapped = true;
  psBindVisibilityRefresh();

  document.addEventListener('click', (e) => {
    const page = psPageEl();
    if (!page?.contains(e.target)) return;

    const mainTab = e.target.closest('.ps-main-tab');
    if (mainTab?.dataset.tab) psSwitchTab(mainTab.dataset.tab);
    if (e.target.closest('#ps-bonus-btn')) psClaimDailyBonus();
    if (e.target.closest('#ps-slip-submit')) psConfirmSlip();
    if (e.target.closest('#ps-slip-clear')) psClearSlip();
    if (e.target.closest('#ps-match-detail-close') || e.target.closest('#ps-match-detail-backdrop')) psCloseMatchDetail();

    const slipTab = e.target.closest('.ps-slip-tab');
    if (slipTab?.dataset.slipMode) {
      PS_STATE.slipMode = slipTab.dataset.slipMode;
      document.querySelectorAll('.ps-slip-tab').forEach((t) => t.classList.toggle('active', t.dataset.slipMode === PS_STATE.slipMode));
      psUpdateSlipSummary();
    }

    const mineFilter = e.target.closest('.ps-mine-filter');
    if (mineFilter?.dataset.filter) {
      PS_STATE.mineFilter = mineFilter.dataset.filter;
      document.querySelectorAll('.ps-mine-filter').forEach((t) => t.classList.toggle('active', t.dataset.filter === PS_STATE.mineFilter));
      psRenderMineTab();
    }

    const quick = e.target.closest('.ps-slip-quick-btn');
    if (quick) {
      const input = document.getElementById('ps-slip-stake');
      if (!input) return;
      const val = quick.dataset.stake;
      input.value = val === 'max' ? String(Math.max(10, Math.floor(PS_STATE.wallet || 0))) : val;
      psUpdateSlipSummary();
    }
  });

  document.addEventListener('input', (e) => {
    if (e.target?.id === 'ps-slip-stake' && psPageEl()?.contains(e.target)) psUpdateSlipSummary();
    if (e.target?.id === 'ps-search' && psPageEl()?.contains(e.target)) {
      PS_STATE.searchQuery = e.target.value;
      psRenderLeagues();
    }
  });
}

async function renderParisSportifsPage() {
  psBindEvents();
  await psLoadWallet();
  await psRefreshMatches();
  if (PS_STATE.activeTab === 'matches' || PS_STATE.activeTab === 'live') {
    psRenderSlip();
  }
  psArmAutoRefresh();
}

// Expose global (le router appelle window.renderParisSportifsPage())
window.renderParisSportifsPage = renderParisSportifsPage;
