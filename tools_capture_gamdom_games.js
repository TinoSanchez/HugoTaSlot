const fs = require('fs');
const { chromium } = require('playwright');

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  const captures = [];

  page.on('response', async (response) => {
    const url = response.url();
    if (!url.includes('/client-api/casino/')) return;
    const req = response.request();
    const postData = req.postData() || '';
    let bodyText = '';
    try {
      bodyText = await response.text();
    } catch {
      bodyText = '';
    }

    captures.push({
      url,
      method: req.method(),
      status: response.status(),
      postData,
      bodyPreview: bodyText.slice(0, 5000)
    });
  });

  await page.goto('https://gamdom.com/casino', { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(12000);

  fs.writeFileSync('gamdom_casino_api_capture.json', JSON.stringify(captures, null, 2));
  console.log('captured', captures.length, 'responses');
  console.log(captures.map(c => `${c.method} ${c.status} ${c.url}`).join('\n'));

  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
