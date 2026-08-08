/**
 * Synchronise les matchs et cotes depuis PropLine vers Supabase.
 *
 * - Tous les sports actifs (GET /v1/sports) sauf PROPLINE_SPORTS= liste CSV.
 * - Upsert sport_events (external_id = event PropLine).
 * - Upsert sport_markets (une row par (event, market_key, bookmaker)).
 */
import { supabase } from '../supabase.js';
import { child } from '../lib/logger.js';
import { config } from '../config.js';
import { fetchOdds } from '../lib/propline.js';
import { getProplineSportKeys, labelForSportKey } from '../lib/propline-sports.js';
import { extractEventScores } from '../lib/score-parser.js';
import { getOddsSportKeys } from '../lib/sport-event-keys.js';
import { canUsePropline, getProplineQuotaState } from '../lib/propline-quota.js';

const log = child({ mod: 'sports-odds' });

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Convertit cotes US (+110 / -245) ou décimal → décimal (2.10 / 1.41). */
function normalizeDecimalOdd(raw) {
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

export async function runSportsOddsSync() {
  if (!config.propline.apiKey) {
    log.info('PROPLINE_API_KEY vide → sync sports skip.');
    return { skipped: 'no_api_key' };
  }
  if (!canUsePropline(1)) {
    return { skipped: 'quota_paused', quota: getProplineQuotaState() };
  }

  let sports = [];
  try {
    sports = await getProplineSportKeys();
  } catch (e) {
    log.warn({ err: e?.message || String(e) }, 'getProplineSportKeys échoué');
    return { skipped: 'sports_list_failed' };
  }
  if (!sports.length) return { skipped: 'no_sports' };

  if (config.propline.oddsScope !== 'all') {
    const active = await getOddsSportKeys();
    if (active.length) {
      const set = new Set(active);
      sports = sports.filter((sk) => set.has(sk));
      log.debug({ active: sports.length }, 'odds sync scoped to DB sport_keys');
    }
  }
  if (!sports.length) return { skipped: 'no_active_odds_sports' };

  const totals = { sports: sports.length, fetched: 0, events: 0, markets: 0, errors: 0, requests: 0 };
  const nowMs = Date.now();
  const cutoffMs = nowMs + config.propline.hoursAhead * 3600 * 1000;

  for (const sportKey of sports) {
    if (!canUsePropline(1)) {
      log.warn({ quota: getProplineQuotaState() }, 'quota stop mid odds sync');
      break;
    }
    let events = [];
    try {
      events = await fetchOdds(sportKey, {
        markets: config.propline.markets,
        oddsFormat: 'decimal',
      });
      totals.requests++;
      if (!Array.isArray(events)) events = [];
      totals.fetched += events.length;
      log.debug({ sportKey, n: events.length }, 'events fetched');
    } catch (e) {
      log.warn({ sportKey, err: e?.message || String(e) }, 'fetchOdds échoué');
      totals.errors++;
      if (config.propline.syncDelayMs) await sleep(config.propline.syncDelayMs);
      continue;
    }

    for (const ev of events) {
      if (!ev?.id || !ev?.home_team || !ev?.away_team || !ev?.commence_time) continue;
      const commenceMs = Date.parse(ev.commence_time);
      if (!Number.isFinite(commenceMs) || commenceMs > cutoffMs) continue;
      if (commenceMs + 3 * 3600 * 1000 < nowMs) continue;

      const isLive = ev.live === true || (commenceMs <= nowMs && commenceMs + 3 * 3600 * 1000 >= nowMs);
      const scores = extractEventScores(ev);
      const eventRow = {
        external_id: ev.id,
        sport_key: ev.sport_key || sportKey,
        sport_label: labelForSportKey(ev.sport_key || sportKey, ev.sport_title),
        home_team: ev.home_team,
        away_team: ev.away_team,
        commence_at: new Date(commenceMs).toISOString(),
        status: ev.live === true ? 'live' : (isLive ? 'live' : 'upcoming'),
        refreshed_at: new Date().toISOString(),
      };
      if (scores.home != null && scores.away != null) {
        eventRow.home_score = scores.home;
        eventRow.away_score = scores.away;
      }
      if (ev.period) {
        eventRow.result_details = { period: String(ev.period), live: ev.live === true };
      }

      const { data: upserted, error: upErr } = await supabase
        .from('sport_events')
        .upsert(eventRow, { onConflict: 'external_id' })
        .select('id, external_id')
        .single();

      if (upErr || !upserted?.id) {
        log.warn({ ev: ev.id, err: upErr }, 'upsert event failed');
        totals.errors++;
        continue;
      }
      totals.events++;

      const marketsByKey = new Map();
      for (const bk of ev.bookmakers || []) {
        if (!bk?.key) continue;
        for (const mk of bk.markets || []) {
          if (!mk?.key || !Array.isArray(mk.outcomes) || !mk.outcomes.length) continue;
          const key = `${bk.key}|${mk.key}`;
          const normalizedOutcomes = mk.outcomes.map((o) => {
            const dec = normalizeDecimalOdd(o.price);
            return {
              name: String(o.name),
              price: dec != null ? dec : Number(o.price),
              ...(o.point !== undefined ? { point: Number(o.point) } : {}),
              ...(o.description ? { description: String(o.description) } : {}),
            };
          }).filter((o) => Number.isFinite(o.price) && o.price >= 1.01 && o.price <= 501);
          const existing = marketsByKey.get(key);
          if (existing) {
            existing.outcomes.push(...normalizedOutcomes);
            const ts = mk.last_update ? new Date(mk.last_update).toISOString() : existing.last_update;
            if (ts > existing.last_update) existing.last_update = ts;
          } else {
            marketsByKey.set(key, {
              event_id: upserted.id,
              market_key: mk.key,
              bookmaker: bk.key,
              outcomes: normalizedOutcomes,
              last_update: mk.last_update ? new Date(mk.last_update).toISOString() : new Date().toISOString(),
            });
          }
        }
      }
      const marketRows = Array.from(marketsByKey.values());
      if (marketRows.length) {
        const { error: mErr } = await supabase
          .from('sport_markets')
          .upsert(marketRows, { onConflict: 'event_id,market_key,bookmaker' });
        if (mErr) {
          log.warn({ ev: ev.id, err: mErr }, 'upsert markets failed');
          totals.errors++;
        } else {
          totals.markets += marketRows.length;
        }
      }
    }

    if (config.propline.syncDelayMs) await sleep(config.propline.syncDelayMs);
  }

  log.info({ ...totals, quota: getProplineQuotaState() }, 'sports odds sync done');
  return totals;
}
