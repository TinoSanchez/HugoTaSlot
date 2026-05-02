import { fetchSlotcatalogNewReleases } from '../src/lib/casino-fetchers.js';

const out = await fetchSlotcatalogNewReleases();
console.log(`Total parsed: ${out.length}`);
for (const g of out.slice(0, 12)) {
  console.log(`- ${g.name} | ${g.provider || '?'} | ${g.publishedAt || '?'} | ${g.url}`);
}
