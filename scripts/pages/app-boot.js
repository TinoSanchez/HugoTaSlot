'use strict';
/* globals startCatalogAutoRefresh, initSidebarNavA11y, initHuntHubTabs, initModalA11yObserver, updateCatalogModeHint, setStreamerOverlayEnabled, closeStreamerHudWin, initV101, pendingAuthOpen, showAuth, bhWarn, pushRuntimeLog, renderMaintenanceBanner, showNetBanner, hideNetBanner, handleConnectionRestored, BH_DEBUG, currentUser, saveSession, playUiTone, profileMenuJustOpenedAt, profileMenuIsOpen, closeProfileMenu, positionProfileMenu, showToast, ensurePlayerStatsReady, savePlayerStatsForScope, playerStatsScope, STATS_GAMES, bumpWeeklyObjectiveProgress, __activePage, renderStatsPage */
/* PWA, stats mini-jeux, service worker, listeners DOMContentLoaded (boot après app.js) */

const PWA_INSTALL_DISMISS_KEY = 'hm_pwa_install_dismissed_v1';
let deferredPwaInstallPrompt = null;
function isPwaStandalone() {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  } catch (_) { return false; }
}
function initPwaInstallPrompt() {
  if (window.__hmPwaInitBound) return;
  window.__hmPwaInitBound = true;
  const banner = document.getElementById('pwa-install-banner');
  const btn = document.getElementById('pwa-install-btn');
  const dismiss = document.getElementById('pwa-install-dismiss');
  const showBanner = () => {
    if (!banner || isPwaStandalone()) return;
    if (localStorage.getItem(PWA_INSTALL_DISMISS_KEY) === '1') return;
    if (!deferredPwaInstallPrompt) return;
    banner.classList.remove('hidden');
  };
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPwaInstallPrompt = e;
    showBanner();
  });
  if (btn) {
    btn.addEventListener('click', async () => {
      if (!deferredPwaInstallPrompt) {
        showToast('Installation disponible depuis le menu du navigateur (Ajouter à l’écran d’accueil)', 'info', 3200);
        return;
      }
      deferredPwaInstallPrompt.prompt();
      try { await deferredPwaInstallPrompt.userChoice; } catch (_) {}
      deferredPwaInstallPrompt = null;
      if (banner) banner.classList.add('hidden');
    });
  }
  if (dismiss) {
    dismiss.addEventListener('click', () => {
      try { localStorage.setItem(PWA_INSTALL_DISMISS_KEY, '1'); } catch (_) {}
      if (banner) banner.classList.add('hidden');
    });
  }
  window.addEventListener('appinstalled', () => {
    deferredPwaInstallPrompt = null;
    if (banner) banner.classList.add('hidden');
    showToast('Application installée', 'success', 2200);
  });
  setTimeout(showBanner, 1200);
}
function trackPlayerGameStats(game, stake, payout) {
  const stats = ensurePlayerStatsReady();
  if (!stats) return;
  const gKey = STATS_GAMES.includes(game) ? game : 'blackjack';
  const st = stats.games[gKey] || { played: 0, wagered: 0, payout: 0, net: 0 };
  const stakeN = Math.max(0, Number(stake || 0));
  const payoutN = Math.max(0, Number(payout || 0));
  const netN = payoutN - stakeN;
  stats.rounds += 1;
  stats.wagered += stakeN;
  stats.payout += payoutN;
  stats.net += netN;
  st.played += 1;
  st.wagered += stakeN;
  st.payout += payoutN;
  st.net += netN;
  stats.games[gKey] = st;
  const d = new Date();
  const dayKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const day = stats.daily[dayKey] || { wagered: 0, payout: 0, net: 0, rounds: 0, sessionsByHour: Array(24).fill(0) };
  day.wagered += stakeN;
  day.payout += payoutN;
  day.net += netN;
  day.rounds += 1;
  day.sessionsByHour[d.getHours()] = Math.max(0, Number(day.sessionsByHour[d.getHours()] || 0) + 1);
  stats.daily[dayKey] = day;
  stats.sessionsByHour[d.getHours()] = Math.max(0, Number(stats.sessionsByHour[d.getHours()] || 0) + 1);
  savePlayerStatsForScope(playerStatsScope, stats);
  bumpWeeklyObjectiveProgress(gKey);
  if (__activePage === 'stats' && typeof renderStatsPage === 'function') renderStatsPage();
}
// [stats] — extrait dans scripts/pages/stats.js (LAZY_PAGE_SCRIPTS)


function registerAppServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

/**
 * Rafraîchissement silencieux du catalogue.
 * - Cache HTTP de jeux.json = 5 min (vercel.json) → re-fetch en arrière-plan utilise If-Modified-Since.
 * - Au focus de la page après > 5 min d'inactivité, on revérifie.
 * - Polling toutes les 30 min pour les onglets laissés ouverts.
 * - Si le catalogue a changé, on remplace state.slots et on re-rend la grille SANS interrompre l'UX.
 */
// [catalog-slots] refreshCatalogSilently / startCatalogAutoRefresh

window.addEventListener('DOMContentLoaded', () => {
  registerAppServiceWorker();
  if (typeof startCatalogAutoRefresh === 'function') startCatalogAutoRefresh();
  initSidebarNavA11y();
  initHuntHubTabs();
  initModalA11yObserver();
  if (typeof updateCatalogModeHint === 'function') updateCatalogModeHint();
  window.addEventListener('message', (ev) => {
    if (!ev?.data || ev.data.type !== 'hm-streamer-hud-close') return;
    setStreamerOverlayEnabled(false);
    const t = document.getElementById('opener-streamer-toggle');
    if (t) t.checked = false;
    if (typeof closeStreamerHudWin === 'function') closeStreamerHudWin();
  });
  if (!window.__hmPersistBalanceBound) {
    window.__hmPersistBalanceBound = true;
    const flushBalanceToDisk = () => {
      if (currentUser) saveSession(currentUser);
    };
    window.addEventListener('pagehide', flushBalanceToDisk);
    window.addEventListener('beforeunload', flushBalanceToDisk);
  }
  initV101()
    .then(() => {
      if (pendingAuthOpen) showAuth();
    })
    .catch((e) => {
      bhWarn('initV101 failed', e);
      pushRuntimeLog('error', `initV101: ${String(e?.message || e || 'unknown')}`);
    });
  renderMaintenanceBanner();
  if (!navigator.onLine) showNetBanner('Mode hors ligne: certaines fonctions cloud indisponibles.', true);
  window.addEventListener('offline', () => {
    pushRuntimeLog('warn', 'offline: connexion perdue');
    showNetBanner('Connexion perdue: mode hors ligne.', true);
  });
  window.addEventListener('online', () => {
    pushRuntimeLog('info', 'online: connexion rétablie');
    showNetBanner('Connexion rétablie.', false);
    setTimeout(hideNetBanner, 2000);
    handleConnectionRestored().catch((e) => {
      pushRuntimeLog('warn', `online_recovery_failed: ${String(e?.message || e || 'unknown')}`);
    });
  });
  window.addEventListener('error', (e) => {
    pushRuntimeLog('error', `js: ${String(e?.message || 'inconnue')}`);
    showNetBanner(`Erreur JS: ${String(e?.message || 'inconnue')}`, true);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const msg = String(e?.reason?.message || e?.reason || 'rejet non géré');
    pushRuntimeLog('error', `promise: ${msg}`);
    const low = msg.toLowerCase();
    const looksNetwork = /network|fetch|offline|timeout|cloud|supabase|failed to fetch|aborterror|circuit|http\s*\d{3}/i.test(low);
    if (looksNetwork) {
      showNetBanner('Erreur réseau/cloud détectée. Réessaie dans quelques secondes.', true);
    } else if (BH_DEBUG) {
      showNetBanner(`Erreur interne: ${msg.slice(0, 120)}`, true);
    }
    if (typeof e.preventDefault === 'function') e.preventDefault();
  });
  document.addEventListener('click', (e) => {
    const el = e.target && e.target.closest ? e.target.closest('button, .sidebar-tab, .game-card, .hunt-item, .row-action-btn, .open-btn, .modal-btn, .sidebar-btn') : null;
    if (el) playUiTone('click');
  });
  document.addEventListener('click', (e) => {
    if (Date.now() - Number(profileMenuJustOpenedAt || 0) < 260) return;
    const menu = document.getElementById('profile-menu');
    const wrap = document.getElementById('profile-wrap');
    const badge = e.target && e.target.closest ? e.target.closest('#profile-wrap .profile-badge') : null;
    if (badge) return;
    if (menu && !menu.classList.contains('hidden') && menu.contains(e.target)) return;
    if (profileMenuIsOpen) closeProfileMenu();
    else if (wrap && !wrap.contains(e.target) && menu && !menu.classList.contains('hidden')) closeProfileMenu();
  });
  window.addEventListener('resize', () => {
    const menu = document.getElementById('profile-menu');
    if (menu && !menu.classList.contains('hidden')) positionProfileMenu();
  });
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notif-panel');
    const wrap = document.getElementById('header-notif-wrap');
    if (!panel || panel.classList.contains('hidden')) return;
    if (wrap && wrap.contains(e.target)) return;
    panel.classList.add('hidden');
    const btn = document.getElementById('notif-bell-btn');
    if (btn) btn.setAttribute('aria-expanded', 'false');
  });
  document.addEventListener('error', (e) => {
    const el = e?.target;
    if (!el || el.tagName !== 'IMG') return;
    const src = String(el.getAttribute('src') || '');
    if (src.includes('./assets/virtual-token.svg')) return;
    if (el.dataset && el.dataset.fallbackDone === '1') return;
    if (el.dataset) el.dataset.fallbackDone = '1';
    el.setAttribute('src', './assets/virtual-token.svg');
  }, true);
});



