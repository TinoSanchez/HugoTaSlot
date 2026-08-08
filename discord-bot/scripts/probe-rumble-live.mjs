import { request } from 'undici';
import fs from 'node:fs';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const url = 'https://rumble.com/user/19enplein';
const { body } = await request(url, { headers: { 'user-agent': UA } });
const html = await body.text();

const customTags = [...new Set([...html.matchAll(/<(rum-[a-z0-9-]+)/gi)].map((m) => m[1]))];
console.log('custom tags', customTags);

for (const tag of customTags) {
  const re = new RegExp(`<${tag}[^>]*>\\s*<script type="application/json">\\s*([\\s\\S]*?)\\s*<\\/script>`, 'i');
  const m = html.match(re);
  if (m) {
    try {
      const j = JSON.parse(m[1]);
      console.log('\n===', tag, 'keys:', Object.keys(j).slice(0, 20));
      if (j.live !== undefined) console.log('live', j.live);
      if (j.items) {
        const liveOnes = j.items.filter((i) => i.live === true);
        console.log('items', j.items.length, 'live true', liveOnes.length);
      }
      if (j.title || j.url) console.log({ title: j.title, url: j.url, live: j.live, status: j.livestream_status });
    } catch (e) {
      console.log(tag, 'parse err', e.message);
    }
  }
}

// Search all JSON blocks for live===true objects
const blocks = [...html.matchAll(/<script type="application\/json">\s*([\s\S]*?)\s*<\/script>/g)];
let liveObjects = 0;
for (const b of blocks) {
  try {
    const j = JSON.parse(b[1]);
    const str = JSON.stringify(j);
    if (str.includes('"live":true') || j.live === true) {
      liveObjects++;
      if (liveObjects <= 3) {
        console.log('\nLIVE BLOCK sample keys', typeof j === 'object' ? Object.keys(j).slice(0, 15) : j);
        if (j.title) console.log({ title: j.title, url: j.url, live: j.live, status: j.livestream_status, permalink: j.permalink_id });
        if (j.items) {
          const li = j.items.find((i) => i.live === true);
          if (li) console.log('live item', { title: li.title, url: li.url, status: li.livestream_status });
        }
      }
    }
  } catch {}
}
console.log('\nlive json blocks total', liveObjects);
