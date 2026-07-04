/**
 * Smoke E2E Playwright — routing, pages critiques, hunt local, historique.
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
      localStorage.removeItem('huntmaster_v2');
      localStorage.removeItem('huntmaster_v2_synced');
    } catch (_) {}
  });
}

async function waitBootReady(page) {
  await waitFor(async () => {
    const ok = await page.evaluate(() => (
      typeof switchPage === 'function'
      && typeof state === 'object'
      && typeof __activePage === 'string'
      && __activePage.length > 0
    ));
    return ok;
  });
}

async function waitHuntLazy(page) {
  await waitFor(async () => {
    return page.evaluate(() => typeof showNewHuntModal === 'function' && typeof createNewHunt === 'function');
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
    await waitBootReady(page);
    const titleHome = await page.title();
    assert.ok(/HugoTaSlot|Accueil/i.test(titleHome), `title accueil: ${titleHome}`);

    // ── Routing URL direct /blackjack ──
    await page.goto(`${BASE}/blackjack`, { waitUntil: 'domcontentloaded' });
    await waitBootReady(page);
    assert.ok(page.url().includes('/blackjack'));
    await waitFor(async () => {
      return page.evaluate(() => !!document.getElementById('page-blackjack') || !!document.querySelector('#bj-rec'));
    });

    // ── Hub hunt ──
    await page.goto(`${BASE}/hunt`, { waitUntil: 'domcontentloaded' });
    await waitBootReady(page);
    await waitFor(async () => page.evaluate(() => {
      const el = document.getElementById('hunt-hub');
      return el && getComputedStyle(el).display !== 'none';
    }));
    assert.ok(await page.$('#hunt-hub-tabs [data-hunt-tab="workspace"]'), 'onglet hunt workspace');

    // ── Onglet hunt via URL /mise-optimale ──
    await page.goto(`${BASE}/mise-optimale`, { waitUntil: 'domcontentloaded' });
    await waitBootReady(page);
    assert.ok(page.url().includes('/mise-optimale'));
    await waitFor(async () => page.evaluate(() => state.huntTab === 'mise'));
    await waitFor(async () => page.evaluate(() => !!document.getElementById('hunt-tab-mise')));

    // ── Création hunt local (mode invité / cache vide) ──
    await page.goto(`${BASE}/hunt`, { waitUntil: 'domcontentloaded' });
    await waitBootReady(page);
    await waitHuntLazy(page);
    await page.evaluate(() => {
      if (typeof showNewHuntModal === 'function') showNewHuntModal();
    });
    await waitFor(async () => !(await page.evaluate(() => document.getElementById('new-hunt-modal')?.classList.contains('hidden'))));
    await page.fill('#new-hunt-bal-input', '100');
    await page.click('#new-hunt-confirm');
    await waitFor(async () => page.evaluate(() => !!(state.activeHuntId && state.hunts.length > 0)));
    const huntName = await page.evaluate(() => {
      const h = state.hunts.find((x) => x.id === state.activeHuntId);
      return h?.name || '';
    });
    assert.ok(huntName.length > 0, 'hunt créé');
    await waitFor(async () => page.evaluate(() => {
      const ws = document.getElementById('hunt-workspace');
      return ws && !ws.classList.contains('hidden');
    }));

    // ── Navigation programmatique → mini-jeux ──
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await waitBootReady(page);
    await page.evaluate(() => { if (typeof switchPage === 'function') switchPage('jeux'); });
    await waitFor(async () => page.url().includes('/mini-jeux'));
    await waitFor(async () => page.evaluate(() => !!document.getElementById('page-jeux') || !!document.getElementById('games-lobby')));

    // ── Historique navigateur (back) ──
    await page.goto(`${BASE}/stats`, { waitUntil: 'domcontentloaded' });
    await waitBootReady(page);
    assert.ok(page.url().includes('/stats'));
    await page.goBack({ waitUntil: 'domcontentloaded' });
    await waitFor(async () => page.url().includes('/mini-jeux'));

    // ── Updates (lazy) ──
    await page.goto(`${BASE}/updates`, { waitUntil: 'domcontentloaded' });
    await waitBootReady(page);
    assert.ok(page.url().includes('/updates'));
    await waitFor(async () => page.evaluate(() => !!document.getElementById('page-updates') || !!document.getElementById('updates-content')));

    console.log('E2E smoke OK —', BASE);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error('E2E smoke FAILED:', e.message || e);
  process.exit(1);
});
