/**
 * Logique cloud pure (testable sans navigateur).
 * Alignée sur claim_daily_drop SQL et le parsing client dans app.js.
 */

export const DAILY_DROP_BASE = 25;
export const DAILY_STREAK_BONUS_PCT_PER_DAY = 5;
export const DAILY_STREAK_BONUS_CAP = 2.0;

/** Miroir SQL : v_bonus_pct := least(2.0, (v_streak - 1) * 0.05) */
export function computeDailyDropAward(streak, factor = 1) {
  const s = Math.max(1, Math.floor(Number(streak) || 1));
  const f = Math.min(4, Math.max(0.5, Number(factor) || 1));
  const bonusPct = Math.min(DAILY_STREAK_BONUS_CAP, (s - 1) * (DAILY_STREAK_BONUS_PCT_PER_DAY / 100));
  return Math.round(DAILY_DROP_BASE * (1 + bonusPct) * f * 100) / 100;
}

/** Parse la ligne RPC claim_daily_drop (formats PostgREST). */
export function parseDailyDropRpcRow(raw, dayIndexFallback = 0) {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object') return null;
  const awarded = row.awarded ?? row.Awarded;
  const newBalance = row.new_balance ?? row.newBalance ?? row.new_bal;
  if (awarded === undefined && newBalance === undefined) return null;
  const nb = Number(newBalance);
  return {
    awarded: Number(awarded ?? 0),
    newBalance: Number.isFinite(nb) ? nb : NaN,
    streak: Number(row.streak ?? 1),
    claimDay: Number(row.next_claim_day ?? row.nextClaimDay ?? dayIndexFallback),
  };
}

/** Valide qu’un solde cloud peut être appliqué après refresh / claim. */
export function assertValidCloudBalance(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    throw new Error('invalid_cloud_balance');
  }
  return Math.round(n * 100) / 100;
}

/** Simule la persistance session après claim (refresh ne doit pas écraser). */
export function mergeSessionAfterClaim(session, claim) {
  const balance = assertValidCloudBalance(claim.newBalance);
  return {
    ...session,
    balance,
    streak: Number(claim.streak || 1),
    lastClaimDay: claim.claimDay,
    lastClaimAt: new Date().toISOString(),
  };
}

export function normalizeMaintenanceConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: !!(src.enabled ?? src.active),
    message: String(src.message || 'Maintenance en cours. Mode lecture seule temporaire.').slice(0, 220),
  };
}

/** Valide une soumission tournoi avant insert Supabase. */
export function validateTournoiSubmission({ name, gain, mise, replay }) {
  const huntName = String(name || '').trim();
  const g = Number(gain);
  const m = Number(mise);
  if (!huntName) return { ok: false, error: 'missing_name' };
  if (!Number.isFinite(g) || g < 0) return { ok: false, error: 'invalid_gain' };
  if (!Number.isFinite(m) || m <= 0) return { ok: false, error: 'invalid_mise' };
  const replayUrl = String(replay || '').trim();
  if (replayUrl && !/^https?:\/\//i.test(replayUrl)) return { ok: false, error: 'invalid_replay_url' };
  return {
    ok: true,
    payload: {
      hunt_name: huntName.slice(0, 120),
      gain: Math.round(g * 100) / 100,
      mise: Math.round(m * 100) / 100,
      replay_url: replayUrl || null,
      verified: false,
    },
  };
}
