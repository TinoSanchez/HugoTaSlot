/**
 * Sync scores live PropLine (/scores) — hors foot (ESPN = 0 quota).
 * Cible uniquement sports non-soccer LIVE ou coup d'envoi imminent.
 */
import { child } from '../lib/logger.js';
import { config } from '../config.js';
import { fetchScores } from '../lib/propline.js';
import { parseEventScoreEntry } from '../lib/score-parser.js';
import { applyScorePatch } from '../lib/apply-score-patch.js';
import { getScoreSyncSportKeys } from '../lib/sport-event-keys.js';
import { canUsePropline, getProplineQuotaState } from '../lib/propline-quota.js';

const log = child({ mod: 'sports-scores' });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function runSportsScoresSync() {
  if (!config.propline.apiKey) return { skipped: 'no_api_key' };
  if (!canUsePropline(1)) {
    return { skipped: 'quota_paused', quota: getProplineQuotaState() };
  }

  const sports = await getScoreSyncSportKeys();
  if (!sports.length) {
    return { skipped: 'no_live_sports', fetched: 0, updated: 0, requests: 0 };
  }

  const entries = [];
  let requests = 0;
  for (const sportKey of sports) {
    if (!canUsePropline(1)) {
      log.warn({ sportKey, quota: getProplineQuotaState() }, 'quota stop mid-sync');
      break;
    }
    let scores;
    try {
      scores = await fetchScores(sportKey, { daysFrom: 1 });
      requests++;
    } catch (e) {
      const msg = e?.message || String(e);
      if (msg.includes('429') || msg.includes('quota') || msg.includes('daily_limit')) {
        log.warn('PropLine quota — scores sync stop');
        break;
      }
      log.warn({ sportKey, err: msg }, 'fetchScores échoué');
      continue;
    }
    if (!Array.isArray(scores)) continue;
    for (const s of scores) {
      const parsed = parseEventScoreEntry({ ...s, sport_key: s.sport_key || sportKey });
      if (parsed) entries.push(parsed);
    }
    if (config.propline.syncDelayMs) await sleep(Math.min(config.propline.syncDelayMs, 60));
  }

  let updated = 0;
  for (const u of entries) {
    if (await applyScorePatch(u)) updated++;
  }

  log.info({ sports: sports.length, requests, fetched: entries.length, updated, quota: getProplineQuotaState() }, 'sports scores sync done');
  return { sports: sports.length, requests, fetched: entries.length, updated };
}
