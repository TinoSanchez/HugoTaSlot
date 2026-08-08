/**
 * Scores foot live via ESPN (gratuit, sans clé) — fallback si PropLine indisponible.
 */
import { request } from 'undici';
import { child } from './logger.js';

const log = child({ mod: 'espn-scores' });

/** sport_key PropLine → slug ESPN */
export const ESPN_SOCCER_SLUGS = {
  soccer_fifa_world_cup: 'fifa.world',
  soccer_epl: 'eng.1',
  soccer_la_liga: 'esp.1',
  soccer_serie_a: 'ita.1',
  soccer_bundesliga: 'ger.1',
  soccer_ligue_1: 'fra.1',
  soccer_uefa_champs_league: 'uefa.champions',
  soccer_uefa_europa_league: 'uefa.europa',
  soccer_mls: 'usa.1',
  soccer_efl_champ: 'eng.2',
  soccer_spain_segunda: 'esp.2',
  soccer_fa_cup: 'eng.fa',
  soccer_league_cup: 'eng.league_cup',
};

export function normTeamName(name) {
  return String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function teamsMatch(a, b) {
  const na = normTeamName(a);
  const nb = normTeamName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  const wa = na.split(' ');
  const wb = nb.split(' ');
  if (wa[0] && wb[0] && wa[0] === wb[0] && wa[0].length >= 4) return true;
  return false;
}

export function parseEspnScoreboard(data) {
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

    const periodParts = [st.type?.shortDetail || st.type?.description, st.displayClock]
      .filter(Boolean);
    const period = [...new Set(periodParts)].join(' · ') || null;

    out.push({
      home_team: homeC.team?.displayName || homeC.team?.name || '',
      away_team: awayC.team?.displayName || awayC.team?.name || '',
      home_score: homeScore,
      away_score: awayScore,
      period,
      status: finished ? 'finished' : (live ? 'live' : 'upcoming'),
      live: live && !finished,
    });
  }
  return out;
}

export async function fetchEspnSoccerScores(sportKey) {
  const slug = ESPN_SOCCER_SLUGS[sportKey];
  if (!slug) return [];
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${slug}/scoreboard`;
  try {
    const { statusCode, body } = await request(url, {
      headers: { accept: 'application/json', 'user-agent': 'hugotaslot-bot/1.0' },
    });
    if (statusCode >= 400) {
      log.warn({ sportKey, statusCode }, 'ESPN scoreboard HTTP error');
      return [];
    }
    const data = JSON.parse(await body.text());
    return parseEspnScoreboard(data);
  } catch (e) {
    log.warn({ sportKey, err: e?.message }, 'ESPN scoreboard fetch failed');
    return [];
  }
}

export function matchEspnEntry(eventRow, espnEntries) {
  for (const e of espnEntries) {
    if (teamsMatch(eventRow.home_team, e.home_team) && teamsMatch(eventRow.away_team, e.away_team)) {
      return e;
    }
  }
  return null;
}
