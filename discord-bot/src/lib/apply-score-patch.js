/** Applique un patch score/statut sur sport_events (external_id puis repli équipes). */
import { supabase } from '../supabase.js';
import { child } from './logger.js';

const log = child({ mod: 'score-patch' });

function normTeam(s) {
  return String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function buildPatch(u) {
  const patch = { refreshed_at: new Date().toISOString() };
  if (u.home_score != null && u.away_score != null) {
    patch.home_score = u.home_score;
    patch.away_score = u.away_score;
  }
  if (u.status === 'finished') patch.status = 'finished';
  else if (u.status === 'live' || u.live) patch.status = 'live';
  if (u.period || u.source) {
    patch.result_details = {
      period: u.period || undefined,
      live: u.live === true,
      ...(u.source ? { source: u.source } : {}),
    };
  }
  return patch;
}

async function findByTeams(u) {
  if (!u.home_team || !u.away_team) return null;
  const homeN = normTeam(u.home_team);
  const awayN = normTeam(u.away_team);
  let q = supabase
    .from('sport_events')
    .select('id, external_id, home_team, away_team, sport_key')
    .in('status', ['live', 'upcoming', 'finished'])
    .gte('commence_at', new Date(Date.now() - 5 * 3600 * 1000).toISOString())
    .lte('commence_at', new Date(Date.now() + 2 * 3600 * 1000).toISOString());
  if (u.sport_key) q = q.eq('sport_key', u.sport_key);
  const { data, error } = await q.limit(80);
  if (error || !data?.length) return null;
  return data.find((row) => normTeam(row.home_team) === homeN && normTeam(row.away_team) === awayN) || null;
}

export async function applyScorePatch(u) {
  const patch = buildPatch(u);
  const { error, count } = await supabase
    .from('sport_events')
    .update(patch, { count: 'exact' })
    .eq('external_id', u.external_id)
    .neq('status', 'cancelled');

  if (error) {
    log.warn({ err: error, ev: u.external_id }, 'score patch by external_id failed');
    return false;
  }
  if ((count || 0) > 0) return true;

  const row = await findByTeams(u);
  if (!row) return false;

  const { error: err2 } = await supabase.from('sport_events').update(patch).eq('id', row.id);
  if (err2) {
    log.warn({ err: err2, ev: u.external_id, matched: row.id }, 'score patch by teams failed');
    return false;
  }
  log.debug({ external_id: u.external_id, matched_id: row.id, was: row.external_id }, 'score matched by teams');
  return true;
}
