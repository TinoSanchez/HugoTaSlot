const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await (await browser.newContext()).newPage();
  const seen = new Set();

  page.on('request', (req) => {
    const u = req.url();
    if (u.includes('game-thumbnail-v4') || u.includes('cdn_images') || u.includes('slots-lobby-assets')) {
      if (!seen.has(u)) {
        seen.add(u);
        console.log(u);
      }
    }
  });

  await page.goto('https://gamdom.com/casino', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(12000);
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
