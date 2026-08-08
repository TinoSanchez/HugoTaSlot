/**
 * Sync scores foot live via ESPN (gratuit, 0 quota PropLine).
 */
import { supabase } from '../supabase.js';
import { child } from '../lib/logger.js';
import { applyScorePatch } from '../lib/apply-score-patch.js';
import { ESPN_SOCCER_SLUGS, fetchEspnSoccerScores, matchEspnEntry } from '../lib/espn-scores.js';

const log = child({ mod: 'sports-espn-scores' });

export async function runSportsEspnScoresSync() {
  const since = new Date(Date.now() - 4 * 3600 * 1000).toISOString();
  const until = new Date(Date.now() + 2 * 3600 * 1000).toISOString();
  const now = Date.now();

  const { data: rows, error } = await supabase
    .from('sport_events')
    .select('id, external_id, sport_key, home_team, away_team, status, home_score, away_score, commence_at')
    .like('sport_key', 'soccer_%')
    .in('status', ['live', 'upcoming'])
    .gte('commence_at', since)
    .lte('commence_at', until);

  if (error) {
    log.warn({ err: error }, 'load soccer events failed');
    return { skipped: 'db_error' };
  }

  const candidates = (rows || []).filter((r) => {
    if (r.status === 'live') return true;
    const t = Date.parse(r.commence_at);
    return Number.isFinite(t) && t <= now && t > now - 3 * 3600 * 1000;
  });

  if (!candidates.length) return { events: 0, updated: 0, skipped: 'no_live_soccer' };

  const sportKeys = [...new Set(candidates.map((r) => r.sport_key).filter((k) => ESPN_SOCCER_SLUGS[k]))];
  let updated = 0;

  for (const sportKey of sportKeys) {
    const espnEntries = await fetchEspnSoccerScores(sportKey);
    if (!espnEntries.length) continue;

    for (const row of candidates.filter((r) => r.sport_key === sportKey)) {
      const hit = matchEspnEntry(row, espnEntries);
      if (!hit) continue;
      const needsScore = row.home_score == null || row.away_score == null
        || row.home_score !== hit.home_score || row.away_score !== hit.away_score;
      const needsStatus = (hit.status === 'live' || hit.status === 'finished') && row.status !== hit.status;
      if (!needsScore && !needsStatus) continue;

      const ok = await applyScorePatch({
        external_id: row.external_id,
        sport_key: row.sport_key,
        home_team: row.home_team,
        away_team: row.away_team,
        home_score: hit.home_score,
        away_score: hit.away_score,
        status: hit.status,
        period: hit.period,
        live: hit.live,
        source: 'espn',
      });
      if (ok) updated++;
    }
  }

  log.info({ events: candidates.length, sportKeys: sportKeys.length, updated }, 'ESPN scores sync done');
  return { events: candidates.length, updated };
}
