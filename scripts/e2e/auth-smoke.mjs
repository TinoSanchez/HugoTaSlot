/**
 * E2E auth — mode invité, overlay, profil, bannière mini-jeux.
 * Cloud (optionnel) : E2E_CLOUD_EMAIL + E2E_CLOUD_PASSWORD
 */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';

const BASE = (process.env.E2E_BASE_URL || 'http://127.0.0.1:8765').replace(/\/$/, '');
const TIMEOUT = 60_000;

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

async function prepareFreshAuth(page) {
  await page.addInitScript(() => {
    try {
      localStorage.removeItem('hm_session_v1');
      localStorage.removeItem('hm_session_meta_v1');
      localStorage.removeItem('huntmaster_v2');
      localStorage.removeItem('huntmaster_v2_synced');
      localStorage.setItem('hm_onboarding_v1', '1');
      localStorage.setItem('hm_pwa_install_dismissed_v1', '1');
    } catch (_) {}
  });
}

async function waitBootReady(page) {
  await waitFor(async () => page.evaluate(() => (
    typeof switchPage === 'function'
    && typeof state === 'object'
    && typeof __activePage === 'string'
    && __activePage.length > 0
  )));
}

async function waitAuthOverlay(page) {
  await waitFor(async () => page.evaluate(() => {
    const ov = document.getElementById('auth-overlay');
    if (ov && !ov.classList.contains('hidden')) return true;
    if (typeof pendingAuthOpen !== 'undefined' && pendingAuthOpen && typeof showAuth === 'function') {
      showAuth();
    }
    return ov && !ov.classList.contains('hidden');
  }), { ms: 90_000 });
}

async function run() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(TIMEOUT);
  await prepareFreshAuth(page);

  try {
    await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
    await waitBootReady(page);
    await waitAuthOverlay(page);

    await page.evaluate(() => {
      if (typeof closeAuth === 'function') closeAuth();
      if (typeof renderProfileBadge === 'function') renderProfileBadge();
    });
    await waitFor(async () => page.evaluate(() => !!(currentUser && currentUser.isGuest)));

    const guest = await page.evaluate(() => ({
      isGuest: !!currentUser?.isGuest,
      balance: Number(currentUser?.balance || 0),
      hasClient: typeof getAuthClient === 'function' && !!getAuthClient(),
    }));
    assert.ok(guest.isGuest, 'currentUser invité');
    assert.ok(guest.balance >= 0, 'solde invité');
    assert.ok(guest.hasClient, 'client Supabase initialisé');

    const maintOk = await page.evaluate(async () => {
      const c = getAuthClient();
      if (!c) return false;
      const { error } = await c.rpc('get_site_maintenance');
      return !error;
    });
    assert.ok(maintOk, 'RPC get_site_maintenance');

    await waitFor(async () => page.evaluate(() => !!document.getElementById('profile-wrap')));
    const pseudo = await page.textContent('#profile-wrap .profile-name');
    assert.ok(pseudo && pseudo.length > 0, 'pseudo profil');

    await page.evaluate(() => { if (typeof switchPage === 'function') switchPage('jeux'); });
    await waitFor(async () => page.url().includes('/mini-jeux'));
    await waitFor(async () => page.evaluate(() => {
      const b = document.getElementById('games-mode-banner');
      return b && b.textContent && /invité/i.test(b.textContent);
    }));

    const cloudEmail = process.env.E2E_CLOUD_EMAIL || '';
    const cloudPass = process.env.E2E_CLOUD_PASSWORD || '';
    if (cloudEmail && cloudPass) {
      await page.evaluate(() => {
        try {
          localStorage.removeItem('hm_session_v1');
          localStorage.removeItem('hm_session_meta_v1');
        } catch (_) {}
      });
      await page.reload({ waitUntil: 'domcontentloaded' });
      await waitBootReady(page);
      await waitAuthOverlay(page);
      await page.fill('#auth-email', cloudEmail);
      await page.fill('#auth-password', cloudPass);
      await page.click('#auth-submit');
      await waitFor(async () => page.evaluate(() => !!(currentUser && currentUser.cloud)), { ms: 90_000 });
      assert.ok(await page.evaluate(() => currentUser.cloud === true), 'connexion cloud');
      console.log('  ✓ connexion cloud E2E');
    } else {
      console.log('  ⊘ cloud E2E ignoré (E2E_CLOUD_EMAIL / E2E_CLOUD_PASSWORD non définis)');
    }

    console.log('E2E auth OK —', BASE);
  } finally {
    await browser.close();
  }
}

run().catch((e) => {
  console.error('E2E auth FAILED:', e.message || e);
  process.exit(1);
});
