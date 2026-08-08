import 'dotenv/config';
import { request } from 'undici';

const k = process.env.PROPLINE_API_KEY;
async function g(path, q = {}) {
  const u = new URL('https://api.prop-line.com/v1' + path);
  u.searchParams.set('apiKey', k);
  for (const [a, b] of Object.entries(q)) u.searchParams.set(a, b);
  const { body } = await request(u);
  return JSON.parse(await body.text());
}

const sportsRaw = await g('/sports');
const sports = Array.isArray(sportsRaw) ? sportsRaw : sportsRaw?.data || sportsRaw?.sports || [];
const wc = sports.filter((s) => /world|fifa|coupe/i.test(`${s.key} ${s.title}`));
console.log('wc sports:', wc.map((s) => `${s.key} (${s.title})`).join(', ') || 'none');

for (const sp of wc.length ? wc : [{ key: 'soccer_fifa_world_cup' }]) {
  const sk = sp.key;
  const scores = await g(`/sports/${sk}/scores`, { days_from: 1 });
  const odds = await g(`/sports/${sk}/odds`, { markets: 'h2h', oddsFormat: 'decimal' });
  const fr = [...scores, ...odds].filter((s) =>
    /france|maroc|morocco/i.test(`${s.home_team} ${s.away_team}`));
  console.log(`\n=== ${sk} ===`);
  console.log('scores total', scores.length, 'odds', odds.length);
  for (const m of fr.slice(0, 3)) {
    console.log(JSON.stringify({
      id: m.id, home: m.home_team, away: m.away_team,
      live: m.live, status: m.status,
      home_score: m.home_score, away_score: m.away_score, period: m.period,
      commence: m.commence_time,
    }));
  }
  const liveScores = scores.filter((s) => s.live && s.home_score != null);
  console.log('live with score', liveScores.length);
  if (liveScores[0]) console.log('live score sample', JSON.stringify(liveScores[0]));
}
