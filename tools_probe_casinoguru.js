async function main() {
  const res = await fetch('https://casino.guru/usa/slots/free');
  const html = await res.text();
  console.log('len', html.length);
  console.log('contains "Gates of Olympus":', html.includes('Gates of Olympus'));
  const imgMatches = [...html.matchAll(/https?:\/\/[^"'\\s>]+\.(?:jpg|jpeg|png|webp|gif)/gi)].map(m => m[0]);
  console.log('image urls found', imgMatches.length);
  console.log(imgMatches.slice(0, 15).join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
