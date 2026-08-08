/**
 * Règlement automatique des paris sportifs.
 *
 * 1. Récupère les résultats des matchs finis depuis PropLine (`/scores`).
 * 2. Met à jour sport_events (status=finished, home_score, away_score).
 * 3. Pour chaque pari `pending` sur un event fini, calcule won/lost/void
 *    selon le marché (h2h, totals, correct_score, btts, spreads, double_chance).
 * 4. Appelle la RPC settle_sport_bet (débite/crédite le wallet + audit ledger).
 */
import { supabase } from '../supabase.js';
import { child } from '../lib/logger.js';
import { config } from '../config.js';
import { fetchScores } from '../lib/propline.js';
import { getProplineSportKeys } from '../lib/propline-sports.js';

const log = child({ mod: 'sports-settle' });

/* ─── Parsing des résultats PropLine ──────────────────────────────────── */

import { parseEventScoreEntry } from '../lib/score-parser.js';

/* ─── Résolution des marchés ──────────────────────────────────────────── */

/** Retourne 'won' | 'lost' | 'void'. */
function resolveH2H(selection, homeScore, awayScore, homeTeam, awayTeam) {
  const sel = String(selection).toLowerCase();
  const homeWon = homeScore > awayScore;
  const awayWon = awayScore > homeScore;
  const draw = homeScore === awayScore;
  const isHomeSel = sel === 'home' || sel === homeTeam.toLowerCase();
  const isAwaySel = sel === 'away' || sel === awayTeam.toLowerCase();
  const isDrawSel = sel === 'draw' || sel === 'nul' || sel === 'tie';
  if (isHomeSel) return homeWon ? 'won' : 'lost';
  if (isAwaySel) return awayWon ? 'won' : 'lost';
  if (isDrawSel) return draw ? 'won' : 'lost';
  return 'void';
}

function resolveTotals(selection, details, homeScore, awayScore) {
  const sel = String(selection).toLowerCase(); // "over" | "under"
  const point = Number(details?.point);
  if (!Number.isFinite(point)) return 'void';
  const total = homeScore + awayScore;
  if (Math.abs(total - point) < 1e-9) return 'void'; // push
  const isOver = total > point;
  if (sel === 'over') return isOver ? 'won' : 'lost';
  if (sel === 'under') return !isOver ? 'won' : 'lost';
  return 'void';
}

function resolveSpreads(selection, details, homeScore, awayScore, homeTeam, awayTeam) {
  const sel = String(selection).toLowerCase();
  const point = Number(details?.point);
  if (!Number.isFinite(point)) return 'void';
  // Si sélection sur home : home_score + point vs away_score
  const isHome = sel === 'home' || sel === homeTeam.toLowerCase();
  const isAway = sel === 'away' || sel === awayTeam.toLowerCase();
  let diff;
  if (isHome) diff = (homeScore + point) - awayScore;
  else if (isAway) diff = (awayScore + point) - homeScore;
  else return 'void';
  if (Math.abs(diff) < 1e-9) return 'void'; // push
  return diff > 0 ? 'won' : 'lost';
}

function resolveCorrectScore(selection, homeScore, awayScore) {
  // Format attendu : "H-A" (ex : "2-1")
  const match = String(selection).match(/^\s*(\d+)\s*[-:]\s*(\d+)\s*$/);
  if (!match) return 'void';
  const h = parseInt(match[1], 10);
  const a = parseInt(match[2], 10);
  return (h === homeScore && a === awayScore) ? 'won' : 'lost';
}

function resolveBTTS(selection, homeScore, awayScore) {
  const sel = String(selection).toLowerCase();
  const both = homeScore > 0 && awayScore > 0;
  if (sel === 'yes' || sel === 'oui') return both ? 'won' : 'lost';
  if (sel === 'no' || sel === 'non') return !both ? 'won' : 'lost';
  return 'void';
}

function resolveDoubleChance(selection, homeScore, awayScore, homeTeam, awayTeam) {
  const sel = String(selection).toLowerCase();
  const homeWon = homeScore > awayScore;
  const awayWon = awayScore > homeScore;
  const draw = homeScore === awayScore;
  const h = homeTeam.toLowerCase();
  const a = awayTeam.toLowerCase();
  // Formats possibles : "home_draw", "1x", "home+draw", "H+D", "1-x", "home/draw"
  const normalized = sel.replace(/[\s/+_.-]/g, '');
  if (normalized === 'homedraw' || normalized === '1x' || normalized === `${h}draw`) return (homeWon || draw) ? 'won' : 'lost';
  if (normalized === 'awaydraw' || normalized === 'x2' || normalized === `${a}draw`) return (awayWon || draw) ? 'won' : 'lost';
  if (normalized === 'homeaway' || normalized === '12' || normalized === `${h}${a}`) return (homeWon || awayWon) ? 'won' : 'lost';
  return 'void';
}

function resolveBet(bet, event) {
  const home = event.home_score;
  const away = event.away_score;
  if (home == null || away == null) return null;

  const details = bet.selection_details || {};
  const sel = bet.selection_name;
  switch (bet.market_key) {
    case 'h2h':
      return resolveH2H(sel, home, away, event.home_team, event.away_team);
    case 'totals':
      return resolveTotals(sel, details, home, away);
    case 'spreads':
      return resolveSpreads(sel, details, home, away, event.home_team, event.away_team);
    case 'correct_score':
      return resolveCorrectScore(sel, home, away);
    case 'both_teams_to_score':
      return resolveBTTS(sel, home, away);
    case 'double_chance':
      return resolveDoubleChance(sel, home, away, event.home_team, event.away_team);
    default:
      // Marché inconnu (buteur, cartons, etc.) → void par sécurité (remboursé)
      return 'void';
  }
}

/* ─── Job principal ───────────────────────────────────────────────────── */

async function updateEventScores() {
  let sports = [];
  try {
    sports = await getProplineSportKeys();
  } catch (e) {
    log.warn({ err: e?.message || String(e) }, 'getProplineSportKeys échoué');
    return { fetched: 0, updated: 0 };
  }
  const updates = [];
  for (const sportKey of sports) {
    let scores;
    try {
      scores = await fetchScores(sportKey, { daysFrom: 3 });
    } catch (e) {
      log.warn({ sportKey, err: e?.message }, 'fetchScores échoué');
      continue;
    }
    if (!Array.isArray(scores)) continue;
    for (const s of scores) {
      const parsed = parseEventScoreEntry(s);
      if (!parsed || parsed.status !== 'finished') continue;
      updates.push({
        external_id: parsed.external_id,
        home_score: parsed.home_score,
        away_score: parsed.away_score,
      });
    }
  }

  let updated = 0;
  for (const u of updates) {
    const { error, count } = await supabase
      .from('sport_events')
      .update({
        status: 'finished',
        home_score: u.home_score,
        away_score: u.away_score,
        refreshed_at: new Date().toISOString(),
      }, { count: 'exact' })
      .eq('external_id', u.external_id)
      .neq('status', 'finished');
    if (error) {
      log.warn({ err: error, ev: u.external_id }, 'update event score failed');
    } else if ((count || 0) > 0) {
      updated++;
    }
  }
  return { fetched: updates.length, updated };
}

async function resolveComboBet(bet) {
  const legs = bet.meta?.legs || bet.selection_details?.legs || [];
  if (!Array.isArray(legs) || legs.length < 2) return 'void';

  for (const leg of legs) {
    const eventId = Number(leg.event_id);
    if (!eventId) return null;
    const { data: ev, error } = await supabase
      .from('sport_events')
      .select('id, home_team, away_team, home_score, away_score, status')
      .eq('id', eventId)
      .single();
    if (error || !ev) return null;
    if (ev.status !== 'finished') return null;
    const legOutcome = resolveBet({
      market_key: leg.market_key,
      selection_name: leg.selection_name,
      selection_details: leg.selection_details || {},
    }, ev);
    if (legOutcome === 'lost') return 'lost';
    if (legOutcome === 'void') return 'void';
    if (!legOutcome) return null;
  }
  return 'won';
}

async function settlePendingBets() {
  const { data: simpleBets, error } = await supabase
    .from('sport_bets')
    .select(`
      id, user_id, event_id, market_key, selection_name, selection_details, meta,
      stake, odd, potential_payout, status,
      event:sport_events!inner (id, home_team, away_team, home_score, away_score, status)
    `)
    .eq('status', 'pending')
    .neq('market_key', 'combo')
    .eq('event.status', 'finished')
    .limit(500);

  if (error) {
    log.warn({ err: error }, 'select pending bets failed');
    return { settled: 0 };
  }

  const { data: comboBets } = await supabase
    .from('sport_bets')
    .select('id, user_id, event_id, market_key, selection_name, selection_details, meta, stake, odd, potential_payout, status')
    .eq('status', 'pending')
    .eq('market_key', 'combo')
    .limit(200);

  const bets = [...(simpleBets || []), ...(comboBets || [])];
  if (!bets.length) return { settled: 0 };

  let settled = 0;
  let won = 0;
  let lost = 0;
  let voided = 0;
  for (const b of bets) {
    const outcome = b.market_key === 'combo'
      ? await resolveComboBet(b)
      : resolveBet(b, b.event);
    if (!outcome) continue;
    let payout = 0;
    if (outcome === 'won') payout = Number(b.potential_payout);
    else if (outcome === 'void') payout = Number(b.stake);

    const { error: rpcErr } = await supabase.rpc('settle_sport_bet', {
      p_bet_id: b.id,
      p_status: outcome,
      p_payout: payout,
    });
    if (rpcErr) {
      log.warn({ err: rpcErr, bet: b.id }, 'settle_sport_bet failed');
      continue;
    }
    settled++;
    if (outcome === 'won') won++;
    else if (outcome === 'lost') lost++;
    else if (outcome === 'void') voided++;
  }
  return { settled, won, lost, voided };
}

export async function runSportsBetsSettle() {
  if (!config.propline.apiKey) return { skipped: 'no_api_key' };
  const scoreRes = await updateEventScores();
  const settleRes = await settlePendingBets();
  const out = { ...scoreRes, ...settleRes };
  log.info(out, 'sports bets settle done');
  return out;
}
