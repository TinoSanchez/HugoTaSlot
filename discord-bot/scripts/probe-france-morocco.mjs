/**
 * Probe scores France/Maroc + état Supabase.
 * Usage: railway run node scripts/probe-france-morocco.mjs
 */
import 'dotenv/config';
import { request } from 'undici';

const apiKey = process.env.PROPLINE_API_KEY;
const sbUrl = process.env.SUPABASE_URL;
const sbKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

async function propline(path, q = {}) {
  const u = new URL('https://api.prop-line.com/v1' + path);
  u.searchParams.set('apiKey', apiKey);
  for (const [k, v] of Object.entries(q)) u.searchParams.set(k, String(v));
  const { statusCode, body } = await request(u, { headers: { accept: 'application/json' } });
  const text = await body.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { statusCode, data };
}

async function supabaseQuery(table, query = '') {
  if (!sbUrl || !sbKey) return { error: 'no supabase creds' };
  const u = `${sbUrl.replace(/\/$/, '')}/rest/v1/${table}?${query}`;
  const { statusCode, body } = await request(u, {
    headers: { apikey: sbKey, authorization: `Bearer ${sbKey}`, accept: 'application/json' },
  });
  return { statusCode, data: JSON.parse(await body.text()) };
}

function arr(v) {
  return Array.isArray(v) ? v : [];
}

function pick(ev) {
  if (!ev) return null;
  return {
    id: ev.id,
    external_id: ev.external_id,
    home: ev.home_team,
    away: ev.away_team,
    status: ev.status,
    home_score: ev.home_score,
    away_score: ev.away_score,
    result_details: ev.result_details,
    commence_at: ev.commence_at,
    live: ev.live,
    period: ev.period,
    scores: ev.scores,
  };
}

const sportKeys = [
  'soccer_fifa_world_cup',
  'soccer_world_cup',
  'soccer_fifa_world_cup_winner',
];

const sportsRes = await propline('/sports');
const sports = arr(sportsRes.data);
const wc = sports.filter((s) => /world|fifa|coupe/i.test(`${s.key} ${s.title}`));
console.log('PropLine sports WC:', wc.map((s) => s.key).join(', ') || 'none found');
for (const s of wc) sportKeys.unshift(s.key);

const seen = new Set();
for (const sk of sportKeys) {
  if (seen.has(sk)) continue;
  seen.add(sk);
  console.log(`\n======== ${sk} ========`);

  for (const ep of ['scores', 'odds']) {
    const q = ep === 'scores' ? { days_from: 1 } : { markets: 'h2h', oddsFormat: 'decimal' };
    const r = await propline(`/sports/${encodeURIComponent(sk)}/${ep}`, q);
    const list = arr(r.data);
    console.log(`${ep} HTTP ${r.statusCode} count=${list.length}`);
    if (r.statusCode >= 400) {
      console.log('  err', typeof r.data === 'string' ? r.data.slice(0, 200) : r.data);
      continue;
    }
    const fr = list.filter((e) => /france|maroc|morocco/i.test(`${e.home_team} ${e.away_team}`));
    for (const m of fr) {
      console.log('  match', JSON.stringify(pick(m)));
    }
    const liveWithScore = list.filter((e) => (e.live || e.status === 'live') && (e.home_score != null || e.scores?.length));
    console.log(`  live-ish with score data: ${liveWithScore.length}`);
    if (liveWithScore[0] && !fr.length) {
      console.log('  live sample', JSON.stringify(pick(liveWithScore[0])));
    }
  }
}

console.log('\n======== Supabase sport_events ========');
const q = 'home_team=ilike.*France*&away_team=ilike.*Morocco*&select=id,external_id,sport_key,home_team,away_team,status,home_score,away_score,result_details,commence_at,refreshed_at&order=commence_at.desc&limit=5';
const db = await supabaseQuery('sport_events', q);
console.log('HTTP', db.statusCode);
if (Array.isArray(db.data)) {
  for (const row of db.data) console.log(JSON.stringify(row));
} else {
  console.log(db.data);
}

console.log('\n======== RPC list (france morocco in results) ========');
if (sbUrl && sbKey) {
  const { statusCode, body } = await request(`${sbUrl.replace(/\/$/, '')}/rest/v1/rpc/list_upcoming_events_balanced`, {
    method: 'POST',
    headers: {
      apikey: sbKey,
      authorization: `Bearer ${sbKey}`,
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ p_per_sport: 20, p_hours_ahead: 168, p_max_total: 500 }),
  });
  const rows = JSON.parse(await body.text());
  if (Array.isArray(rows)) {
    const fr = rows.filter((e) => /france|morocco|maroc/i.test(`${e.home_team} ${e.away_team}`));
    for (const r of fr) console.log(JSON.stringify(pick(r)));
  } else {
    console.log('RPC err', statusCode, rows);
  }
}
