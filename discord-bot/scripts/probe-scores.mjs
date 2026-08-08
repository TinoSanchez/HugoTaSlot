/**
 * Probe PropLine scores pour un sport (défaut: table tennis).
 * Usage: node scripts/probe-scores.mjs [sport_key]
 */
import 'dotenv/config';
import { request } from 'undici';

const apiKey = process.env.PROPLINE_API_KEY;
const base = (process.env.PROPLINE_BASE_URL || 'https://api.prop-line.com/v1').replace(/\/$/, '');
const sportKey = process.argv[2] || 'table_tennis';

if (!apiKey) {
  console.error('PROPLINE_API_KEY manquant');
  process.exit(1);
}

async function get(path, query = {}) {
  const url = new URL(base + path);
  url.searchParams.set('apiKey', apiKey);
  for (const [k, v] of Object.entries(query)) {
    if (v != null && v !== '') url.searchParams.set(k, String(v));
  }
  const { statusCode, body } = await request(url, { headers: { accept: 'application/json' } });
  const text = await body.text();
  return { statusCode, data: text ? JSON.parse(text) : null, url: url.toString().replace(apiKey, '***') };
}

const sports = await get('/sports');
const tt = (Array.isArray(sports.data) ? sports.data : []).filter((s) =>
  String(s.key || '').includes('table') || String(s.title || '').toLowerCase().includes('table'));
console.log('Table tennis keys:', tt.map((s) => `${s.key} (${s.title})`).join(', ') || 'none');

const keysToTry = [sportKey, ...tt.map((s) => s.key)].filter(Boolean);
const seen = new Set();
for (const key of keysToTry) {
  if (seen.has(key)) continue;
  seen.add(key);
  console.log('\n===', key, '===');
  for (const q of [{ daysFrom: 1 }, { days_from: 1 }, {}]) {
    const r = await get(`/sports/${encodeURIComponent(key)}/scores`, q);
    const arr = Array.isArray(r.data) ? r.data : [];
    const live = arr.filter((e) => {
      const st = String(e.status || '').toLowerCase();
      return st.includes('live') || st.includes('progress') || (e.completed === false && Date.parse(e.commence_time) < Date.now());
    });
    console.log('query', q, '→ status', r.statusCode, 'total', arr.length, 'live-ish', live.length);
    if (live[0]) console.log('sample live:', JSON.stringify(live[0], null, 2));
    else if (arr[0]) console.log('sample:', JSON.stringify(arr[0], null, 2));
  }
  const odds = await get(`/sports/${encodeURIComponent(key)}/odds`, { markets: 'h2h', oddsFormat: 'decimal' });
  const oddsArr = Array.isArray(odds.data) ? odds.data : [];
  const liveOdds = oddsArr.filter((e) => e.commence_time && Date.parse(e.commence_time) <= Date.now());
  console.log('odds live-ish', liveOdds.length);
  if (liveOdds[0]) {
    const s = liveOdds[0];
    console.log('odds sample keys:', Object.keys(s).join(', '));
    console.log('odds sample score fields:', JSON.stringify({
      id: s.id, home: s.home_team, away: s.away_team,
      home_score: s.home_score, away_score: s.away_score, scores: s.scores, status: s.status,
    }));
  }
}
