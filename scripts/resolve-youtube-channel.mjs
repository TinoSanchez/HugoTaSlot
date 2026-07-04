const handle = process.argv[2] || '@19enpleinn';
const slug = handle.replace(/^@/, '');
const url = `https://www.youtube.com/@${slug}`;
const res = await fetch(url, {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Accept-Language': 'en-US,en;q=0.9',
  },
});
const html = await res.text();
const patterns = [
  /"externalId":"(UC[^"]+)"/,
  /"channelId":"(UC[^"]+)"/,
  /"browseId":"(UC[^"]+)"/,
  /channel_id=(UC[^&"]+)/,
];
for (const p of patterns) {
  const m = html.match(p);
  if (m) {
    console.log(m[1]);
    process.exit(0);
  }
}
const ids = [...html.matchAll(/UC[a-zA-Z0-9_-]{22}/g)].map((x) => x[0]);
console.log(JSON.stringify([...new Set(ids)].slice(0, 8), null, 2));
process.exit(ids.length ? 0 : 1);
