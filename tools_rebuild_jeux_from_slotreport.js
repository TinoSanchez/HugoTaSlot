const fs = require('fs');

async function main() {
  const response = await fetch('https://slot.report/api/v1/slots.json');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const data = await response.json();
  const results = Array.isArray(data.results) ? data.results : [];

  const mapped = results.map((s, idx) => {
    const providerSlug = String(s.provider_slug || 'unknown')
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');
    const slotSlug = String(s.slug || `slot-${idx}`)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '');

    const rtp = typeof s.rtp === 'number' && !Number.isNaN(s.rtp)
      ? `${s.rtp.toFixed(2)}%`
      : 'N/A';
    const slotName = String(s.name || 'Slot machine').trim();
    const providerName = String(s.provider || 'Provider inconnu').trim();
    const thumbText = encodeURIComponent(`${slotName}\n${providerName}`);
    const generatedThumb = `https://placehold.co/325x234/0b1020/f0a500/png?text=${thumbText}`;

    return {
      id: `sr_${providerSlug}_${slotSlug}`,
      nom: slotName,
      provider: providerName,
      rtp,
      image: generatedThumb,
      gamdomUrl: `https://gamdom.com/slots/search?q=${encodeURIComponent(slotName)}`,
      devise: { active: 'USD', symbole: '$' }
    };
  });

  fs.writeFileSync('jeux.json', JSON.stringify(mapped));
  console.log(`jeux.json regenere: ${mapped.length} machines`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
