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

const sports = await get('/sports');
let found = 0;
for (const sp of sports.slice(0, 50)) {
  const scores = await get(`/sports/${sp.key}/scores`, { days_from: 1 });
  if (!Array.isArray(scores)) continue;
  const withScore = scores.filter((s) => s.home_score != null && s.away_score != null);
  const liveWithScore = withScore.filter((s) => s.live === true);
  if (withScore.length) {
    console.log(sp.key, 'total scores', withScore.length, 'live with score', liveWithScore.length);
    if (liveWithScore[0]) console.log('  live sample', JSON.stringify(liveWithScore[0]));
    else if (withScore[0]) console.log('  sample', JSON.stringify(withScore[0]));
    found++;
    if (found >= 8) break;
  }
}
