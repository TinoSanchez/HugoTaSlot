import { request } from 'undici';

async function tryEngine(engine) {
  const headers = {
    accept: 'text/plain, text/markdown, */*',
    'x-respond-with': 'markdown',
  };
  if (engine) headers['x-engine'] = engine;
  console.log(`\n--- engine=${engine || 'default'} ---`);
  const r = await request('https://r.jina.ai/https://slotcatalog.com/en/New-Slots', { headers });
  console.log('http:', r.statusCode);
  const t = await r.body.text();
  console.log('len:', t.length);
  const lines = t.split('\n');
  const keep = lines.filter((l) =>
    /Play Demo|^###\s|Provider:|Release Date:|slotcatalog\.com\/en\/slots\//.test(l)
  );
  console.log('matching lines:', keep.length);
  console.log(keep.slice(0, 30).join('\n'));
}

await tryEngine('browser').catch((e) => console.error('browser err:', e.message));
await tryEngine('cf-browser-rendering').catch((e) => console.error('cf err:', e.message));
await tryEngine('chrome').catch((e) => console.error('chrome err:', e.message));
