import { request } from 'undici';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const url = process.argv[2] || 'https://rumble.com/user/19enplein';
const { statusCode, body } = await request(url, {
  headers: { 'user-agent': UA, accept: 'text/html,application/xhtml+xml' },
});
console.log('status', statusCode);
const html = await body.text();
console.log('len', html.length);

const jsonBlocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
console.log('ld+json blocks', jsonBlocks.length);
for (const m of jsonBlocks.slice(0, 2)) {
  try {
    const j = JSON.parse(m[1]);
    console.log('ld type', j['@type'], j.name || j.url || '');
  } catch (e) {
    console.log('ld parse err', e.message);
  }
}

const videoLinks = [...html.matchAll(/href="(\/v[^"]+\.html)"/g)].slice(0, 8);
const seen = new Set();
for (const m of videoLinks) {
  const path = m[1];
  if (seen.has(path)) continue;
  seen.add(path);
  const idMatch = path.match(/-([a-z0-9]+)\.html$/i);
  console.log('video', idMatch?.[1], path);
}

const gridMatch = html.match(/<rum-videos-grid>\s*<script type="application\/json">\s*([\s\S]*?)\s*<\/script>/);
if (gridMatch) {
  const data = JSON.parse(gridMatch[1]);
  console.log('grid items', data.items?.length);
  const liveItems = (data.items || []).filter((i) => i.live === true || [1, 2].includes(i.livestream_status));
  console.log('live items in grid', liveItems.length);
  if (liveItems[0]) {
    console.log('live sample', JSON.stringify({
      title: liveItems[0].title,
      live: liveItems[0].live,
      status: liveItems[0].livestream_status,
      url: liveItems[0].url,
      watching: liveItems[0].watching_now,
      videoId: liveItems[0].permalink_id,
    }));
  }
  const first = data.items?.[0];
  if (first && !liveItems.length) {
    console.log('latest non-live', { live: first.live, status: first.livestream_status, title: first.title?.slice(0, 50) });
  }
} else {
  console.log('no rum-videos-grid json');
}

const liveTrue = (html.match(/"live"\s*:\s*true/g) || []).length;
console.log('"live":true occurrences', liveTrue);
