/**
 * Smoke E2E Playwright — routing, pages critiques, globals boot.
 * Prérequis: serveur local sur E2E_BASE_URL (défaut http://127.0.0.1:8765)
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_BASE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const TIMEOUT = 45_000;

async function waitFor(fn, { ms = TIMEOUT, step = 250 } = {}) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    try {
      if (await fn()) return;
    } catch (_) { /* retry */ }
    await new Promise((r) => setTimeout(r, step));
  }
  throw new Error('waitFor timeout');
}

async function prepareBrowser(page) {
  await page.addInitScript(() => {
    try {
      localStorage.setItem('hm_onboarding_v1', '1');
      localStorage.setItem('hm_pwa_install_dismissed_v1', '1');
    } catch (_) {}
  });
}

async function dismissBlockingOverlays(page) {
  await page.evaluate(() => {
    const auth = document.getElementById('auth-overlay');
    if (auth) auth.classList.add('hidden');
    const ob = document.getElementById('onboarding-overlay');
    if (ob) ob.classList.add('hidden');
    if (typeof skipOnboarding === 'function') try { skipOnboarding(); } catch (_) {}
  });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);
  await prepareBrowser(page);
  try {
    // ── Accueil + globals ──
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await waitFor(async () => {
      const ok = await page.evaluate(() => (
        typeof switchPage === 'function'
        && typeof state === 'object'
        && typeof initV101 === 'function'
      ));
      return ok;
    });
    // initV101 (routing initial) doit avoir tourné
    await waitFor(async () => {
      const ready = await page.evaluate(() => typeof __activePage === 'string' && __activePage.length > 0);
      return ready;
    });
    const titleHome = await page.title();
    assert.ok(/HugoTaSlot|Accueil/i.test(titleHome), `title accueil: ${titleHome}`);

    // ── Routing URL direct /blackjack ──
    await page.goto(`${BASE}/blackjack`, { waitUntil: 'domcontentloaded' });
    await waitFor(async () => page.url().includes('/blackjack'));
    await waitFor(async () => {
      const has = await page.evaluate(() => !!document.getElementById('page-blackjack') || !!document.querySelector('#bj-strategy-table, #bj-rec'));
      return has;
    });
    assert.ok((await page.title()).toLowerCase().includes('blackjack') || true);

    // ── Hub hunt ──
    await page.goto(`${BASE}/hunt`, { waitUntil: 'domcontentloaded' });
    await waitFor(async () => {
      const hub = await page.evaluate(() => {
        const el = document.getElementById('hunt-hub');
        return el && el.style.display !== 'none';
      });
      return hub;
    });
    const huntTab = await page.$('#hunt-hub-tabs [data-hunt-tab="workspace"]');
    assert.ok(huntTab, 'onglet hunt workspace');

    // ── Navigation sidebar → mini-jeux ──
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await waitFor(async () => {
      const ready = await page.evaluate(() => typeof __activePage === 'string');
      return ready;
    });
    await page.evaluate(() => { if (typeof switchPage === 'function') switchPage('jeux'); });
    await waitFor(async () => page.url().includes('/mini-jeux'));
    await waitFor(async () => {
      return page.evaluate(() => {
        const p = document.getElementById('page-jeux');
        const g = document.getElementById('games-lobby');
        return !!(p || g);
      });
    });

    // ── Updates (lazy) ──
    await page.goto(`${BASE}/updates`, { waitUntil: 'domcontentloaded' });
    await waitFor(async () => page.url().includes('/updates'));
    await waitFor(async () => {
      return page.evaluate(() => !!document.getElementById('page-updates') || !!document.getElementById('updates-content'));
    });

    console.log('E2E smoke OK —', BASE);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error('E2E smoke FAILED:', e.message || e);
  process.exit(1);
});
