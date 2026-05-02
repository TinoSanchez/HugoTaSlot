import { request } from 'undici';

const r = await request('https://r.jina.ai/https://slotcatalog.com/en/New-Slots', {
  headers: {
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'accept-language': 'en-US,en;q=0.9,fr;q=0.8',
    accept: 'text/plain, text/markdown, */*',
    'x-engine': 'browser',
    'x-respond-with': 'markdown',
  },
});
console.log('http:', r.statusCode);
const t = await r.body.text();
console.log('len:', t.length);

const tileRe = /\[!\[Image\s+\d+:\s*([^\]]+?)\s*slot\]\((https?:\/\/[^)]+?)\)\s+!\[Image\s+\d+\]\([^)]+\)\s+###\s+([^\]\n]+?)\]\(https:\/\/slotcatalog\.com\/en\/slots\/([a-z0-9-]+)\)/gi;
let n = 0;
let m;
while ((m = tileRe.exec(t))) {
  n++;
  if (n <= 5) console.log(`MATCH ${n}: ${m[3]} | slug=${m[4]}`);
}
console.log(`TOTAL MATCHES: ${n}`);

if (!n) {
  // Find any line that looks like a tile to debug
  const sample = t.split('\n').filter((l) => /Image\s+\d+:.*slot/i.test(l)).slice(0, 3);
  console.log('---SAMPLE LINES WITH "Image N: NAME slot":---');
  for (const l of sample) console.log(JSON.stringify(l));
}
