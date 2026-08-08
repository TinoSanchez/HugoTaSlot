/**
 * Sport keys à synchroniser — dérivés de sport_events (évite de polluer le quota PropLine).
 */
import { supabase } from '../supabase.js';
import { config } from '../config.js';
import { child } from './logger.js';

const log = child({ mod: 'sport-event-keys' });

export async function getEventsInWindow({ liveOnly = false, nonSoccer = false } = {}) {
  const since = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
  const until = new Date(Date.now() + config.propline.hoursAhead * 3600 * 1000).toISOString();
  let q = supabase
    .from('sport_events')
    .select('sport_key, status, commence_at')
    .gte('commence_at', since)
    .lte('commence_at', until);

  if (liveOnly) {
    q = q.eq('status', 'live');
  } else {
    q = q.in('status', ['live', 'upcoming']);
  }

  const { data, error } = await q;
  if (error) {
    log.warn({ err: error }, 'getEventsInWindow failed');
    return [];
  }

  let rows = data || [];
  if (nonSoccer) rows = rows.filter((r) => !String(r.sport_key || '').startsWith('soccer_'));
  return rows;
}

/** Sports avec au moins un match live/upcoming (cotes complètes). */
export async function getOddsSportKeys() {
  const rows = await getEventsInWindow();
  return [...new Set(rows.map((r) => r.sport_key).filter(Boolean))];
}

/** Sports non-foot avec match LIVE → PropLine /scores (priorité max). */
export async function getLiveNonSoccerSportKeys() {
  const rows = await getEventsInWindow({ liveOnly: true, nonSoccer: true });
  return [...new Set(rows.map((r) => r.sport_key).filter(Boolean))];
}

/** Matchs venant de commencer (±15 min) — attraper le passage live. */
export async function getImminentNonSoccerSportKeys() {
  const now = Date.now();
  const rows = await getEventsInWindow({ nonSoccer: true });
  const keys = new Set();
  for (const r of rows) {
    if (r.status === 'live') {
      keys.add(r.sport_key);
      continue;
    }
    const t = Date.parse(r.commence_at);
    if (!Number.isFinite(t)) continue;
    const delta = t - now;
    if (delta <= 15 * 60 * 1000 && delta >= -20 * 60 * 1000) keys.add(r.sport_key);
  }
  return [...keys];
}

/** Union live + imminent (PropLine /scores). */
export async function getScoreSyncSportKeys() {
  const [live, imminent] = await Promise.all([
    getLiveNonSoccerSportKeys(),
    getImminentNonSoccerSportKeys(),
  ]);
  return [...new Set([...live, ...imminent])];
}

/** Sports avec au moins un match live (sync rapide h2h). */
export async function getLiveSportKeys() {
  const rows = await getEventsInWindow({ liveOnly: true });
  return [...new Set(rows.map((r) => r.sport_key).filter(Boolean))];
}
