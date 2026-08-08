import 'dotenv/config';
import { request } from 'undici';

const apiKey = process.env.PROPLINE_API_KEY;
const base = 'https://api.prop-line.com/v1';

async function get(path, q = {}) {
  const url = new URL(base + path);
  url.searchParams.set('apiKey', apiKey);
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, String(v));
  const { body } = await request(url, { headers: { accept: 'application/json' } });
  return JSON.parse(await body.text());
}

const odds = await get('/sports/table_tennis/odds', { markets: 'h2h', oddsFormat: 'decimal' });
const live = odds.filter((e) => e.live === true);
console.log('live count', live.length);
if (live[0]) console.log('live odds event', JSON.stringify(live[0], null, 2));

const scores = await get('/sports/table_tennis/scores', { days_from: 1 });
const byId = new Map(scores.map((s) => [String(s.id), s]));
if (live[0]) {
  const sc = byId.get(String(live[0].id));
  console.log('score for live id', sc ? JSON.stringify(sc, null, 2) : 'NOT IN SCORES');
}

const withScore = scores.filter((s) => s.home_score != null || s.away_score != null);
console.log('scores with values', withScore.length);
if (withScore[0]) console.log('sample with score', JSON.stringify(withScore[0], null, 2));

const liveInScores = scores.filter((s) => s.live === true);
console.log('live in scores', liveInScores.length);
if (liveInScores[0]) console.log('live score sample', JSON.stringify(liveInScores[0], null, 2));

const finished = scores.filter((s) => s.status === 'final' || s.status === 'completed');
console.log('finished', finished.length);
if (finished[0]) console.log('finished sample', JSON.stringify(finished[0], null, 2));
