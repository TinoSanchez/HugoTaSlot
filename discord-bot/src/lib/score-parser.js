/** Parse scores PropLine / The Odds API → { home, away, status, period }. */

export function parseScoresArray(scoresArr, homeTeam, awayTeam) {
  if (!Array.isArray(scoresArr)) return { home: null, away: null };
  const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const homeN = norm(homeTeam);
  const awayN = norm(awayTeam);
  let home = null;
  let away = null;
  for (const s of scoresArr) {
    if (!s || typeof s.score === 'undefined') continue;
    const val = Number(String(s.score).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(val)) continue;
    const nameN = norm(s.name);
    if (!nameN) continue;
    if (nameN === 'home') home = val;
    else if (nameN === 'away') away = val;
    else if (homeN && (nameN === homeN || nameN.includes(homeN) || homeN.includes(nameN))) home = val;
    else if (awayN && (nameN === awayN || nameN.includes(awayN) || awayN.includes(nameN))) away = val;
  }
  return { home, away };
}

/** Ex. foot « 2nd Half · 67' · 1 - 0 » (pas « sets 1-0 » tennis). */
export function parseGoalsFromPeriod(period) {
  if (!period) return null;
  const s = String(period);
  if (/sets?\s*\d+\s*[-–]\s*\d+/i.test(s)) return null;
  const m = s.match(/(?:^|[·|])\s*(\d+)\s*[-–]\s*(\d+)\s*(?:$|[·|']|\s)/)
    || s.match(/\b(\d+)\s*[-–]\s*(\d+)\b/);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}

export function extractEventScores(raw) {
  if (!raw) return { home: null, away: null };
  let home = raw.home_score;
  let away = raw.away_score;
  if (home != null) home = Number(home);
  if (away != null) away = Number(away);
  if (!Number.isFinite(home) || !Number.isFinite(away)) {
    const parsed = parseScoresArray(raw.scores, raw.home_team, raw.away_team);
    if (!Number.isFinite(home)) home = parsed.home;
    if (!Number.isFinite(away)) away = parsed.away;
  }
  if ((!Number.isFinite(home) || !Number.isFinite(away)) && raw.period) {
    const fromPeriod = parseGoalsFromPeriod(raw.period);
    if (fromPeriod) {
      if (!Number.isFinite(home)) home = fromPeriod.home;
      if (!Number.isFinite(away)) away = fromPeriod.away;
    }
  }
  if (!Number.isFinite(home) || !Number.isFinite(away)) return { home: null, away: null };
  return { home, away };
}

export function isScoreFinal(raw) {
  if (!raw) return false;
  if (raw.completed === true) return true;
  const st = String(raw.status || '').toLowerCase();
  return st === 'final' || st === 'completed' || st === 'finished' || st === 'closed';
}

export function isScoreLive(raw) {
  if (!raw || isScoreFinal(raw)) return false;
  if (raw.live === true) return true;
  const st = String(raw.status || '').toLowerCase();
  return st === 'live' || st === 'in_progress' || st === 'inprogress' || st === 'started';
}

export function parseEventScoreEntry(raw) {
  if (!raw?.id) return null;
  const { home, away } = extractEventScores(raw);
  const hasScores = home != null && away != null;
  const live = isScoreLive(raw);
  const final = isScoreFinal(raw);

  if (!hasScores && !live && !final && raw.live !== true) return null;

  let status = 'live';
  if (final) status = 'finished';
  else if (live || raw.live === true) status = 'live';

  return {
    external_id: String(raw.id),
    sport_key: raw.sport_key ? String(raw.sport_key) : null,
    home_team: raw.home_team ? String(raw.home_team) : null,
    away_team: raw.away_team ? String(raw.away_team) : null,
    home_score: hasScores ? home : null,
    away_score: hasScores ? away : null,
    status,
    period: raw.period ? String(raw.period) : null,
    live: raw.live === true,
  };
}

/** Extrait sets depuis period PropLine ex. "Set 2 · sets 1-0" */
export function parseSetsFromPeriod(period) {
  if (!period) return null;
  const m = String(period).match(/sets?\s*(\d+)\s*[-–]\s*(\d+)/i);
  if (!m) return null;
  return { home: Number(m[1]), away: Number(m[2]) };
}
