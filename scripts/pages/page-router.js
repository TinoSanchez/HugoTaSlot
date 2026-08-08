'use strict';
/* globals state, activeHunt, fmt, toEUR, getUserBalance, showToast, closeMobileSidebar, isCurrentUserAdmin, initAuth, renderProfileBadge, populateBonusFilterPresetsSelect, refreshMaintenanceConfig, startMaintenancePolling, applyHuntAppHooks, ensureSlotsLoaded, scheduleHuntUI, calcMise, initDepositWheel, initChoixSlot, renderTournoiLeaderboard, updateLobbyBalance, flushFeedbackQueue, runSupabaseHealthCheck, closeGame, bhWarn, consumeSlotPrefillFromUrl, applyUiPrefs, runGlobalSearch, globalSearchDebounce, ensureNotifBellInHeader, checkInAppNotifications, renderHomeHubMetrics, renderHomeLeaderboard, renderHomeDiscordBanner, renderStudioPage, renderUpdatesPage, renderReviewPage, renderNewsPage, renderStatsPage, renderAdminPanel, renderBJTable, renderGamesModeBanner, renderWeeklyObjectivesPanel, renderGamesLobby */
/* Routing multi-pages — URLs, templates HTML, lazy loader, initV101 (boot après core-ui) */

const __detachedPanels = Object.create(null);

function stashPageMount() {
  const mount = document.getElementById('page-mount');
  if (!mount || !mount.firstElementChild) return;
  const panel = mount.firstElementChild;
  const cacheKey = panel.id === 'page-jeux' ? 'jeux' : null;
  if (cacheKey) {
    __detachedPanels[cacheKey] = panel;
    mount.removeChild(panel);
  } else {
    mount.innerHTML = '';
  }
}

function mountCachedPage(page) {
  const mount = document.getElementById('page-mount');
  if (!mount || !__PAGE_HTML[page]) return null;
  if (__detachedPanels[page]) {
    mount.innerHTML = '';
    mount.appendChild(__detachedPanels[page]);
    delete __detachedPanels[page];
    const panel = mount.firstElementChild;
    if (panel) panel.classList.add('active');
    return panel;
  }
  mount.innerHTML = __PAGE_HTML[page];
  const panel = mount.firstElementChild;
  if (panel) panel.classList.add('active', 'anim-in');
  setTimeout(() => panel?.classList.remove('anim-in'), 320);
  return panel;
}

// ─── PAGE NAVIGATION (URL routing) ───
// Chaque onglet sidebar = une URL propre, gérée via History API.
// Le serveur (Vercel) rewrite déjà toutes les routes vers index.html, donc
// un refresh ou un partage de lien direct (/blackjack, /hunt...) marche.
const PAGE_TO_SLUG = Object.freeze({
  home: '',
  hunt: 'hunt',
  studio: 'studio',
  blackjack: 'blackjack',
  mise: 'mise-optimale',
  roue_depot: 'roue-depot',
  slot_choix: 'slot-choix',
  tournoi: 'tournoi',
  stats: 'stats',
  jeux: 'mini-jeux',
  updates: 'updates',
  news: 'actualites',
  review: 'review',
  admin: 'admin',
  roue_multi: 'roue-multi-tirages',
  roue_tournoi_equipes: 'roue-tournoi-equipes',
  paris_sportifs: 'paris-sportifs',
});
const SLUG_TO_PAGE = (() => {
  const m = Object.create(null);
  for (const [page, slug] of Object.entries(PAGE_TO_SLUG)) m[slug] = page;
  return m;
})();
const PAGE_TITLES = Object.freeze({
  home: 'Accueil',
  hunt: 'Bonus Hunt',
  studio: 'Studio Stream',
  blackjack: 'Tableau Blackjack',
  mise: 'Mise Optimale',
  roue_depot: 'Roue du Dépôt',
  slot_choix: 'Slot des Choix',
  tournoi: 'Tournoi',
  stats: 'Statistiques',
  jeux: 'Mini Jeux',
  updates: 'Nouveautés',
  news: 'Actualités',
  review: 'Review',
  admin: 'Admin',
  roue_multi: 'Roue Multi-Tirages',
  roue_tournoi_equipes: 'Roue Tournoi Équipes',
  paris_sportifs: 'Paris Sportifs',
});
const SITE_NAME = 'HugoTaSlot X 19EnPlein';
function pageToPath(page) {
  const slug = PAGE_TO_SLUG[page] ?? '';
  return slug ? `/${slug}` : '/';
}
function pathToPage(path) {
  const seg = String(path || '/').replace(/^\/+|\/+$/g, '').split('/')[0] || '';
  return SLUG_TO_PAGE[seg] || 'home';
}
function setDocumentTitleForPage(page) {
  const sub = PAGE_TITLES[page];
  try { document.title = sub ? `${sub} — ${SITE_NAME}` : SITE_NAME; } catch (_) {}
}

const HUNT_TAB_FROM_PAGE = Object.freeze({
  mise: 'mise',
  roue_depot: 'depot',
  slot_choix: 'choix',
  tournoi: 'tournoi',
});
const HUNT_TAB_TO_SLUG = Object.freeze({
  workspace: 'hunt',
  mise: 'mise-optimale',
  depot: 'roue-depot',
  choix: 'slot-choix',
  tournoi: 'tournoi',
});
const HUNT_TAB_TITLES = Object.freeze({
  workspace: 'Bonus Hunt',
  mise: 'Mise Optimale',
  depot: 'Slot du Dépôt',
  choix: 'Slot des Choix',
  tournoi: 'Tournoi',
});

function normalizeHuntTab(tab) {
  const t = String(tab || 'workspace').toLowerCase();
  return ['workspace', 'mise', 'depot', 'choix', 'tournoi'].includes(t) ? t : 'workspace';
}
function huntTabToPath(tab) {
  const slug = HUNT_TAB_TO_SLUG[normalizeHuntTab(tab)] || 'hunt';
  return slug === 'hunt' ? '/hunt' : `/${slug}`;
}
function pathToHuntTab(path) {
  const page = pathToPage(path);
  if (page === 'hunt') return 'workspace';
  return HUNT_TAB_FROM_PAGE[page] || null;
}
/** Onglet hunt à ouvrir selon le lien cliqué (pas le dernier onglet mémorisé). */
function resolveHuntTabForNavigation(requestedPage, opts) {
  opts = opts || {};
  if (opts.huntTab != null) return normalizeHuntTab(opts.huntTab);
  if (HUNT_TAB_FROM_PAGE[requestedPage]) return HUNT_TAB_FROM_PAGE[requestedPage];
  if (requestedPage === 'hunt') return 'workspace';
  const fromPath = pathToHuntTab(location.pathname);
  if (fromPath) return fromPath;
  return 'workspace';
}
function sidebarPageKey(page) {
  if (page !== 'hunt') return page;
  return state.huntTab === 'depot' ? 'roue_depot' : 'hunt';
}
function syncSidebarActivePage(page) {
  const key = sidebarPageKey(page);
  document.querySelectorAll('.sidebar-tab').forEach((t) => {
    t.classList.remove('active');
    t.removeAttribute('aria-current');
  });
  document.querySelectorAll(`[data-page="${key}"]`).forEach((t) => {
    t.classList.add('active');
    if (t.classList.contains('sidebar-tab')) t.setAttribute('aria-current', 'page');
  });
}
function setDocumentTitleForHuntTab(tab) {
  const sub = HUNT_TAB_TITLES[normalizeHuntTab(tab)] || PAGE_TITLES.hunt;
  try { document.title = sub ? `${sub} — ${SITE_NAME}` : SITE_NAME; } catch (_) {}
}
function showHuntHub() {
  const hub = document.getElementById('hunt-hub');
  if (hub) { hub.classList.add('active'); hub.style.display = 'flex'; }
  stashPageMount();
}
function hideHuntHub() {
  const hub = document.getElementById('hunt-hub');
  if (hub) { hub.classList.remove('active'); hub.style.display = 'none'; }
}
function runHuntTabInit(tab) {
  const t = normalizeHuntTab(tab);
  if (t === 'mise') {
    return loadLazyPageScript('mise').then(() => {
      const balInput = document.getElementById('m-balance');
      if (balInput && (!balInput.value || Number(balInput.value) <= 0)) {
        balInput.value = Math.max(1, Number(getUserBalance() || 100)).toFixed(2);
      }
      if (typeof calcMise === 'function') calcMise();
    }).catch(() => {});
  }
  if (t === 'depot') {
    return loadLazyPageScript('roue_depot').then(() => {
      if (typeof initDepositWheel === 'function') initDepositWheel();
    }).catch(() => {});
  }
  if (t === 'choix') {
    return loadLazyPageScript('slot_choix').then(() => {
      const p = typeof ensureSlotsLoaded === 'function'
        ? ensureSlotsLoaded().catch(() => {})
        : Promise.resolve();
      return p.then(() => {
        if (typeof initChoixSlot === 'function') initChoixSlot();
      });
    }).catch(() => {});
  }
  if (t === 'tournoi') {
    return loadLazyPageScript('tournoi').then(() => {
      if (typeof renderTournoiLeaderboard === 'function') renderTournoiLeaderboard();
    }).catch(() => {});
  }
  if (t === 'workspace') {
    return ensureSlotsLoaded().then(() => {
      scheduleHuntUI({ force: false });
    }).catch(() => {});
  }
  return Promise.resolve();
}
function switchHuntTab(tab, opts) {
  opts = opts || {};
  tab = normalizeHuntTab(tab);
  state.huntTab = tab;
  document.querySelectorAll('.hunt-hub-tab').forEach((btn) => {
    const on = normalizeHuntTab(btn.dataset.huntTab) === tab;
    btn.classList.toggle('active', on);
    if (on) btn.setAttribute('aria-current', 'true');
    else btn.removeAttribute('aria-current');
  });
  document.querySelectorAll('.hunt-tab-panel').forEach((panel) => {
    const panelTab = String(panel.id || '').replace('hunt-tab-', '');
    const on = panelTab === tab;
    panel.classList.toggle('active', on);
    panel.hidden = !on;
    panel.style.display = on ? '' : 'none';
  });
  const content = document.getElementById('content');
  const noHunt = document.getElementById('no-hunt-selected');
  if (tab === 'workspace') {
    if (content) content.style.display = 'flex';
    if (noHunt) noHunt.style.display = state.activeHuntId ? 'none' : 'flex';
  } else {
    if (content) content.style.display = 'none';
    if (noHunt) noHunt.style.display = 'none';
  }
  const statsBar = document.getElementById('stats-bar');
  const openHdr = document.getElementById('btn-open-hunt-header');
  const titleMain = document.getElementById('current-hunt-name');
  const titleSub = document.getElementById('current-hunt-date');
  if (statsBar) statsBar.style.display = tab === 'workspace' ? '' : 'none';
  if (openHdr) openHdr.style.display = tab === 'workspace' ? '' : 'none';
  if (tab !== 'workspace' && titleMain && titleSub) {
    const tabTitles = { mise: 'MISE OPTIMALE', depot: 'SLOT DU DÉPÔT', choix: 'SLOT DES CHOIX', tournoi: 'TOURNOI BONUS HUNT' };
    titleMain.textContent = tabTitles[tab] || 'BONUS HUNT';
    const h = activeHunt();
    titleSub.textContent = h ? h.name : 'Outil intégré au hub Bonus Hunt';
  } else if (tab === 'workspace' && titleMain && titleSub) {
    const h = activeHunt();
    if (h) {
      titleMain.textContent = h.name;
      const created = new Date(h.createdAt);
      const dateStr = created.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
      const timeStr = created.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
      const eurHint = Number(h.startBalanceEUR || toEUR(h.startBalance || 0, h.currency || 'EUR')).toFixed(0);
      titleSub.textContent = `${dateStr} ${timeStr} · ${fmt(h.startBalance, h.currency)} (≈${eurHint}€)`;
    } else {
      titleMain.textContent = '— SÉLECTIONNER UN HUNT —';
      titleSub.textContent = '';
    }
  }
  if (!opts.skipInit) runHuntTabInit(tab);
  if (!opts.skipTitle) setDocumentTitleForHuntTab(tab);
  if (!opts.skipSidebar && __activePage === 'hunt') syncSidebarActivePage('hunt');
}

function switchPage(page, opts) {
  opts = opts || {};
  const requestedPage = page;
  let huntTab = resolveHuntTabForNavigation(requestedPage, opts);
  if (HUNT_TAB_FROM_PAGE[requestedPage]) {
    page = 'hunt';
  }
  if (page === 'admin' && !isCurrentUserAdmin()) {
    page = 'home';
    showToast('Accès admin requis', 'error');
  }
  try {
    const gw = document.getElementById('game-window');
    if (gw && !gw.classList.contains('hidden') && typeof closeGame === 'function') {
      closeGame();
    }
  } catch (e) { /* noop */ }
  document.querySelectorAll('.page-panel').forEach(p => p.classList.remove('active', 'anim-in'));

  if (page === 'hunt') {
    showHuntHub();
    const mainIds = ['no-hunt-selected', 'hunt-workspace'];
    mainIds.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (id === 'no-hunt-selected') el.style.display = state.activeHuntId ? 'none' : 'flex';
      else if (id === 'hunt-workspace') {
        if (state.activeHuntId) {
          el.classList.remove('hidden');
          el.style.display = 'flex';
        } else {
          el.classList.add('hidden');
          el.style.display = 'none';
        }
      }
    });
    const content = document.getElementById('content');
    if (content) content.style.display = 'flex';
    switchHuntTab(huntTab, { skipTitle: true, skipInit: opts.skipHuntTabInit, skipSidebar: true });
    setDocumentTitleForHuntTab(state.huntTab);
  } else {
    hideHuntHub();
    stashPageMount();
    mountCachedPage(page);

    // Lazy load + rendu : le script de la page est chargé (si dans LAZY_PAGE_SCRIPTS),
    // PUIS la fonction de rendu est appelée. Pour les pages sans lazy script, la promesse
    // est déjà résolue et le rendu se fait dès la prochaine microtask.
    const __renderFn = (function buildPageRender(p) {
      switch (p) {
        case 'blackjack': return () => { if (typeof renderBJTable === 'function') renderBJTable(); };
        case 'jeux': return () => {
          if (typeof renderGamesModeBanner === 'function') renderGamesModeBanner();
          if (typeof renderWeeklyObjectivesPanel === 'function') renderWeeklyObjectivesPanel();
          if (typeof renderGamesLobby === 'function') renderGamesLobby();
        };
        case 'stats': return () => { if (typeof renderStatsPage === 'function') renderStatsPage(); };
        case 'admin': return () => { if (typeof renderAdminPanel === 'function') renderAdminPanel(); };
        case 'home': return () => {
          if (typeof renderHomeHubMetrics === 'function') renderHomeHubMetrics();
          if (typeof renderHomeLeaderboard === 'function') renderHomeLeaderboard();
          if (typeof renderHomeDiscordBanner === 'function') renderHomeDiscordBanner();
        };
        case 'studio': return () => { if (typeof renderStudioPage === 'function') renderStudioPage(); };
        case 'updates': return () => {
          if (typeof renderUpdatesPage === 'function') renderUpdatesPage();
          if (typeof runSupabaseHealthCheck === 'function') runSupabaseHealthCheck(false).catch(() => {});
        };
        case 'review': return () => {
          if (typeof renderReviewPage === 'function') renderReviewPage();
          flushFeedbackQueue().catch(() => {});
        };
        case 'news': return () => { if (typeof renderNewsPage === 'function') renderNewsPage(); };
        case 'paris_sportifs': return () => { if (typeof renderParisSportifsPage === 'function') renderParisSportifsPage(); };
        default: return null;
      }
    })(page);

    loadLazyPageScript(page)
      .then(() => { if (__renderFn) __renderFn(); })
      .catch((e) => {
        bhWarn(`[lazy] ${page}`, e?.message || e);
        // Fallback si le script échoue mais que la fonction est déjà globale
        try { if (__renderFn) __renderFn(); } catch (_) {}
      });

    updateLobbyBalance();
  }
  syncSidebarActivePage(page);
  closeMobileSidebar();

  if (page === 'hunt') setDocumentTitleForHuntTab(state.huntTab);
  else setDocumentTitleForPage(page);
  if (!opts.skipHistory) {
    const path = page === 'hunt' ? huntTabToPath(state.huntTab) : pageToPath(page);
    const histState = page === 'hunt' ? { page: 'hunt', huntTab: state.huntTab } : { page };
    try {
      if (location.pathname !== path) {
        if (opts.replace) history.replaceState(histState, '', path);
        else history.pushState(histState, '', path);
      } else if (!history.state || history.state.page !== page || (page === 'hunt' && history.state.huntTab !== state.huntTab)) {
        history.replaceState(histState, '', path);
      }
    } catch (_) { /* history API indisponible : ignore */ }
  }
  __activePage = page;
}


// ─── LAZY CHARGEMENT DE MODULES PAR PAGE ───
// Infrastructure prête pour la Passe 2 du refactoring multi-pages :
// chaque entrée du registre = un script externe chargé au 1er accès à la page.
// Tant qu'une page n'a pas son script ici, elle reste dans app.js (rétrocompat).
//
// Pour activer une page lazy :
//   1. Extraire ses fonctions de app.js dans /scripts/pages/<slug>.js
//      (les fonctions restent globales, pas de module ES — migration progressive)
//   2. Supprimer ces fonctions d'app.js
//   3. Ajouter une entrée : <page>: './scripts/pages/<slug>.js'
//
// Le loader est idempotent et ne re-télécharge jamais un script déjà chargé.
// Page actuellement affichée (utilisé pour remplacer les checks getElementById('page-x').active)
let __activePage = 'home';

// ─── TEMPLATES HTML DES PAGES (injectés dynamiquement par switchPage) ───────
// Chaque page n'est dans le DOM que quand l'utilisateur la visite.
// Le HTML est injecté dans <div id="page-mount"> puis retiré lors de la navigation.
const __PAGE_HTML = {
  home: `
<div class="page-panel" id="page-home">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ACCUEIL</div>
      <div class="hunt-title-sub">Bienvenue sur HugoTaSlot X 19EnPlein</div>
    </div>
  </header>
  <div class="page-content">
    <div class="home-hero">
      <div class="home-hero-brand">
        <img src="./assets/logo-hugotaslot.jpg" class="home-hero-logo" alt="HugoTaSlot">
        <span class="home-hero-x" aria-hidden="true">×</span>
        <img src="./assets/19enplein-logo.png" class="home-hero-logo" alt="19EnPlein">
        <div>
          <div class="home-hero-title">HUGOTASLOT <span class="home-hero-title-x">×</span> 19ENPLEIN</div>
          <div class="home-hero-sub">BONUS HUNT MANAGER — TEAM STREAMERS CASINO</div>
        </div>
      </div>
      <a class="home-partner-banner" href="https://gamdom.com" target="_blank" rel="noopener noreferrer" aria-label="Partenaire officiel : Gamdom">
        <img src="./assets/gamdom-tower.png" class="home-partner-tower" alt="">
        <div class="home-partner-text">
          <div class="home-partner-label">PARTENAIRE OFFICIEL</div>
          <img src="./assets/gamdom-logo-white-transparent.png" class="home-partner-logo" alt="Gamdom">
        </div>
        <span class="home-partner-cta">JOUER SUR GAMDOM →</span>
      </a>
      <div id="home-discord-banner" class="home-discord-banner" aria-live="polite"></div>
      <div class="home-grid">
        <div class="home-card">
          <div class="home-card-head"><img src="./assets/icon-hunt.svg" class="ui-logo-icon" alt=""><div class="home-card-title">DÉMARRAGE RAPIDE</div></div>
          <div class="home-card-text">Crée un hunt, ajoute tes slots puis ouvre les bonus avec saisie instantanée des gains.</div>
        </div>
        <div class="home-card">
          <div class="home-card-head"><img src="./assets/icon-cards.svg" class="ui-logo-icon" alt=""><div class="home-card-title">ANALYSE EN DIRECT</div></div>
          <div class="home-card-text">Suivi du profit, BE moyen, progression et validation rapide au clavier dans l’opener.</div>
        </div>
        <div class="home-card">
          <div class="home-card-head"><img src="./assets/icon-games.svg" class="ui-logo-icon" alt=""><div class="home-card-title">OUTILS INTÉGRÉS</div></div>
          <div class="home-card-text">Sessions, mise optimale, slot dépôt, tournoi et mini-jeux — tout regroupé dans le hub Bonus Hunt.</div>
        </div>
      </div>
      <div class="hub-kpi-grid" id="home-kpi-grid">
        <div class="hub-kpi"><div class="hub-kpi-l">HUNTS</div><div class="hub-kpi-v" id="home-kpi-hunts">0</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">BONUS TOTAL</div><div class="hub-kpi-v" id="home-kpi-bonus">0</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">PROFIT GLOBAL</div><div class="hub-kpi-v" id="home-kpi-profit">0,00€</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">EN LIGNE</div><div class="hub-kpi-v" id="home-kpi-online">1</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">PROFIT 7J</div><div class="hub-kpi-v" id="home-kpi-profit-7d">0,00€</div></div>
        <div class="hub-kpi"><div class="hub-kpi-l">PROFIT 30J</div><div class="hub-kpi-v" id="home-kpi-profit-30d">0,00€</div></div>
      </div>
    </div>
    <div class="mise-section">
      <div class="mise-section-title">CLASSEMENTS COMMUNAUTÉ</div>
      <div class="bj-rec" style="margin-bottom:10px;">Tournoi mensuel, points misés aux mini-jeux et streak de drops quotidiens.</div>
      <div class="home-lb-tabs" id="home-lb-tabs" role="tablist">
        <button type="button" class="home-lb-tab active" data-lb-tab="tournoi" aria-selected="true">Tournoi</button>
        <button type="button" class="home-lb-tab" data-lb-tab="wager">Mini-jeux</button>
        <button type="button" class="home-lb-tab" data-lb-tab="streak">Streak drop</button>
      </div>
      <div id="home-leaderboard"><div class="bj-rec">Chargement…</div></div>
    </div>
    <div class="home-landing-showcase">
      <div class="home-showcase-item"><img src="./assets/icon-hunt.svg" alt=""><span>Bonus Hunt live</span></div>
      <div class="home-showcase-item"><img src="./assets/icon-cards.svg" alt=""><span>Opener + HUD stream</span></div>
      <div class="home-showcase-item"><img src="./assets/icon-games.svg" alt=""><span>12 mini-jeux</span></div>
      <div class="home-showcase-item"><img src="./assets/virtual-token.svg" alt=""><span>Drops & streak</span></div>
    </div>
    <div class="home-hero-cta-row">
      <button type="button" class="play-btn home-hero-cta" onclick="showNewHuntModal();switchPage('hunt');">CRÉER MON PREMIER HUNT</button>
      <button type="button" class="home-cmd-btn" onclick="startOnboarding(true)">GUIDE DÉMARRAGE</button>
    </div>
    <div class="mise-section home-quick-panel">
      <div class="mise-section-title">COMMANDES RAPIDES</div>
      <div class="home-quick-cmds">
        <button class="play-btn" onclick="showNewHuntModal()">+ NOUVEAU HUNT</button>
        <button class="home-cmd-btn" onclick="switchPage('hunt')">ALLER AU BONUS HUNT</button>
        <button class="home-cmd-btn" onclick="switchPage('studio')">STUDIO STREAM</button>
        <button class="home-cmd-btn" onclick="startOnboarding(true)">GUIDE DÉMARRAGE</button>
        <button class="home-cmd-btn" onclick="switchPage('blackjack')">TABLEAU BJ</button>
        <button class="home-cmd-btn" onclick="switchPage('hunt',{huntTab:'mise'})">MISE OPTIMALE</button>
        <button class="home-cmd-btn" onclick="switchPage('hunt',{huntTab:'tournoi'})">TOURNOI</button>
        <button class="home-cmd-btn" onclick="switchPage('jeux')">MINI JEUX</button>
        <button class="home-cmd-btn" onclick="switchPage('updates')">NOUVEAUTÉS</button>
        <button class="home-cmd-btn" onclick="switchPage('review')">REVIEW / AVIS</button>
        <button class="home-cmd-btn" id="home-admin-btn" onclick="switchPage('admin')" style="display:none;">ADMIN</button>
      </div>
    </div>
    <div class="mise-section">
      <div class="mise-section-title">RECHERCHE GLOBALE</div>
      <input class="profile-menu-input" id="global-search-input" placeholder="Rechercher hunt, bonus, provider, joueur..." style="max-width:560px;">
      <div id="global-search-results" style="margin-top:10px;"></div>
    </div>
  </div>
</div>
  `,
  admin: `
<div class="page-panel" id="page-admin">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ADMIN</div>
      <div class="hunt-title-sub">Gestion globale des comptes, soldes et sessions</div>
    </div>
  </header>
  <div class="page-content">
    <div class="mise-section" id="admin-access-denied" style="display:none;">
      <div class="mise-section-title">ACCÈS REFUSÉ</div>
      <div class="bj-rec">Tu dois être admin pour accéder à ce panneau.</div>
    </div>
    <div id="admin-panel">
      <div class="mise-section" style="margin-bottom:14px;">
        <div class="mise-section-title">MAINTENANCE (serveur Supabase)</div>
        <div class="bj-rec" style="margin-bottom:8px;">État global pour tous les joueurs — plus de flag localStorage navigateur. Migration : <code>20260704_site_maintenance.sql</code></div>
        <div class="bj-input-row">
          <label class="bj-label" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="admin-maint-enabled"> Activer maintenance (joueurs en lecture seule)
          </label>
        </div>
        <div class="profile-menu-row" style="margin-top:8px;">
          <label class="profile-menu-label">Message bannière</label>
          <input class="profile-menu-input" id="admin-maint-msg" maxlength="220" placeholder="Maintenance en cours...">
        </div>
        <button class="profile-mini-btn primary" onclick="adminSetMaintenanceMode()">Appliquer mode maintenance</button>
      </div>
      <div class="mise-section" style="margin-bottom:14px;">
        <div class="mise-section-title">ALERTING OPS</div>
        <div class="bj-input-row">
          <label class="bj-label" style="display:flex;align-items:center;gap:8px;">
            <input type="checkbox" id="admin-ops-enabled"> Activer alertes erreurs critiques (webhook)
          </label>
        </div>
        <div class="profile-menu-row" style="margin-top:8px;">
          <label class="profile-menu-label">Webhook URL</label>
          <input class="profile-menu-input" id="admin-ops-webhook" maxlength="360" placeholder="https://...">
        </div>
        <button class="profile-mini-btn primary" onclick="adminSaveOpsAlerts()">Sauvegarder alerting ops</button>
        <div class="admin-toolbar" style="margin-top:10px;">
          <button type="button" class="profile-mini-btn" onclick="adminTestOpsWebhook()">Tester le webhook</button>
          <button type="button" class="profile-mini-btn" onclick="adminFireTestProdError()">Simuler erreur prod</button>
        </div>
        <div class="bj-rec" style="margin-top:8px;">Le webhook reçoit les erreurs <code>pushRuntimeLog('error', …)</code> en prod (cooldown 45 s). « Simuler erreur prod » déclenche ce chemin réel.</div>
      </div>
      <div class="mise-section-title" style="margin-bottom:8px;">DASHBOARD COMMUNAUTÉ</div>
      <div class="stats-grid" id="admin-dashboard-grid" style="margin-bottom:14px;"></div>
      <div class="stats-grid" id="admin-stats-grid" style="margin-bottom:14px;"></div>
      <div class="mise-section" style="margin-bottom:14px;">
        <div class="mise-section-title">UTILISATEURS</div>
        <div id="admin-users-table"></div>
      </div>
      <div class="mise-section">
        <div class="mise-section-title">HUNTS</div>
        <div id="admin-hunts-table"></div>
      </div>
      <div class="mise-section" style="margin-top:14px;">
        <div class="mise-section-title">ANNONCER UNE SLOT (DISCORD + ACTUALITÉS)</div>
        <div class="drop-meta" style="margin-bottom:10px;">Le bot poste l'annonce sur Discord dans les 60 secondes et la slot apparaît immédiatement dans la page Actualités.</div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Nom de la slot (obligatoire)</label>
          <input type="text" class="profile-menu-input" id="admin-slot-title" maxlength="160" placeholder="Ex. : Sweet Bonanza Super Scatter" oninput="syncAdminSlotPreview()">
        </div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Provider</label>
          <input type="text" class="profile-menu-input" id="admin-slot-provider" maxlength="80" placeholder="Ex. : Pragmatic Play" oninput="syncAdminSlotPreview()">
        </div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Image (URL)</label>
          <input type="url" class="profile-menu-input" id="admin-slot-image" maxlength="500" placeholder="https://..." oninput="syncAdminSlotPreview()">
        </div>
        <div id="admin-slot-preview-wrap" class="admin-slot-preview-wrap hidden">
          <img id="admin-slot-preview-img" class="admin-slot-preview-img" alt="Aperçu slot" loading="lazy" referrerpolicy="no-referrer">
        </div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Lien (review, vidéo, page provider…)</label>
          <input type="url" class="profile-menu-input" id="admin-slot-url" maxlength="500" placeholder="https://...">
        </div>
        <div class="profile-menu-row">
          <label class="profile-menu-label">Résumé (optionnel)</label>
          <textarea class="profile-menu-input" id="admin-slot-summary" rows="3" maxlength="600" placeholder="Mécanique, RTP, gros multis, premières impressions…" style="min-height:84px;resize:vertical;font-family:inherit;"></textarea>
        </div>
        <div class="bj-rec" id="admin-slot-status" style="margin:6px 0 10px;"></div>
        <div class="bj-rec" id="admin-slot-prefill-link" style="margin-bottom:8px;display:none;"></div>
        <div style="display:flex;gap:10px;flex-wrap:wrap;">
          <button class="profile-mini-btn primary" type="button" onclick="adminPostManualSlot()">Publier la slot</button>
          <button class="profile-mini-btn" type="button" onclick="adminPreviewSlotToHunt()">Tester dans mon hunt</button>
          <button class="profile-mini-btn" type="button" onclick="resetAdminSlotForm()">Vider le formulaire</button>
        </div>
        <div id="admin-recent-slots" style="margin-top:14px;"></div>
      </div>
      <div class="mise-section" style="margin-top:14px;">
        <div class="mise-section-title">VALIDATION TOURNOI</div>
        <div class="drop-meta" style="margin-bottom:10px;">Entrées en attente de vérification. Valide ou refuse après contrôle du replay / des chiffres.</div>
        <div id="admin-tournoi-table"></div>
      </div>
      <div class="mise-section" style="margin-top:14px;">
        <div class="mise-section-title">RETOURS BETA (REVIEW)</div>
        <div id="admin-feedback-table"></div>
      </div>
      <div class="mise-section" style="margin-top:14px;">
        <div class="mise-section-title">AUDIT ADMIN</div>
        <div id="admin-logs-table"></div>
      </div>
    </div>
  </div>
</div>
  `,
  blackjack: `
<div class="page-panel" id="page-blackjack">
  <header class="page-header">
    <div class="hunt-title-area">
      <div class="hunt-title-main">TABLE DE BLACKJACK</div>
      <div class="hunt-title-sub">Stratégie de base — Optimise tes chances au maximum</div>
    </div>
  </header>
  <div class="page-content">
    <div class="mise-section">
      <div class="mise-section-title">STRATÉGIE DE BASE</div>
      <div class="bj-input-row">
        <div class="bj-input-group">
          <label class="bj-label">MA MAIN (total)</label>
          <input type="number" class="bj-input" id="bj-player" value="16" min="4" max="21">
        </div>
        <div class="bj-input-group">
          <label class="bj-label">CARTE DEALER</label>
          <input type="number" class="bj-input" id="bj-dealer" value="10" min="2" max="11">
        </div>
        <div class="bj-input-group">
          <label class="bj-label">J'AI UN AS ?</label>
          <select class="bj-input" id="bj-soft" style="width:100px">
            <option value="0">Non</option>
            <option value="1">Oui (soft)</option>
          </select>
        </div>
        <div class="bj-input-group">
          <label class="bj-label">PAIRE ?</label>
          <select class="bj-input" id="bj-pair" style="width:100px">
            <option value="0">Non</option>
            <option value="1">Oui (split?)</option>
          </select>
        </div>
        <button class="play-btn" onclick="bjGetAdvice()" style="height:44px;margin-left:0;">CONSEIL</button>
      </div>
      <div class="bj-rec" id="bj-rec">
        <strong>CONSEIL STRATÉGIQUE</strong>
        Renseigne ta main et la carte visible du dealer, puis clique CONSEIL.
      </div>
    </div>
    <div class="mise-section">
      <div class="mise-section-title">TABLE STRATÉGIE COMPLÈTE</div>
      <p style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);margin-bottom:12px;letter-spacing:1px;">
        DEALER → / MA MAIN ↓ &nbsp;|&nbsp;
        <span style="color:var(--green)">H=Tirer</span> &nbsp;
        <span style="color:var(--red)">S=Rester</span> &nbsp;
        <span style="color:var(--blue)">D=Doubler</span> &nbsp;
        <span style="color:var(--gold-true)">P=Séparer</span>
      </p>
      <div class="bj-table-wrap">
        <table class="bj-table" id="bj-strategy-table"></table>
      </div>
    </div>
            </div>
        </div>
  `,
  stats: `
<div class="page-panel" id="page-stats">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">STATISTIQUES & RANGS</div>
      <div class="hunt-title-sub">Progression de rank, jeux joués et perf gains/pertes</div>
    </div>
  </header>
  <div class="page-content">
    <div id="stats-root"></div>
  </div>
</div>
  `,
  jeux: `
<div class="page-panel" id="page-jeux">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">MINI JEUX</div>
      <div class="hunt-title-sub">Joue avec ton solde virtuel</div>
    </div>
    <div style="display:flex;flex-direction:column;align-items:flex-end;">
      <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-muted);letter-spacing:2px;">SOLDE</div>
      <div style="font-family:'Rajdhani',sans-serif;font-weight:700;font-size:20px;color:var(--gold-true)" id="lobby-balance">0,00€</div>
    </div>
  </header>
  <div class="page-content">
    <div id="games-mode-banner" class="games-mode-banner" aria-live="polite"></div>
    <div id="games-weekly-objectives" class="games-weekly-objectives" aria-live="polite"></div>
    <div class="games-grid" id="games-lobby"></div>
  </div>
</div>
  `,
  updates: `
<div class="page-panel" id="page-updates">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">NOUVEAUTÉS & UPDATES</div>
      <div class="hunt-title-sub">Changelog produit + suivi technique production</div>
    </div>
  </header>
  <div class="page-content" style="padding:14px;">
    <div id="updates-changelog"></div>
    <div id="updates-content"></div>
  </div>
</div>
  `,
  studio: `
<div class="page-panel" id="page-studio">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">STUDIO STREAM</div>
      <div class="hunt-title-sub">Opener, mini-opener, HUD OBS et options d’affichage live</div>
    </div>
  </header>
  <div class="page-content" style="padding:14px;">
    <div id="studio-content"><div class="bj-rec">Chargement…</div></div>
  </div>
</div>
  `,
  review: `
<div class="page-panel" id="page-review">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">REVIEW</div>
      <div class="hunt-title-sub">Bugs, idées et retours pour améliorer le site (bêta ouverte)</div>
    </div>
  </header>
  <div class="page-content" style="padding:14px;">
    <div class="drop-box" style="margin-bottom:14px;">
      <div class="drop-title">Envoyer un retour</div>
      <div class="drop-meta" style="margin-bottom:12px;">Décris ce qui coince, ce qu’il manque ou ce que tu aimerais voir. Les admins lisent tout dans le panneau Admin.</div>
      <div class="profile-menu-row" style="margin-bottom:10px;">
        <label class="profile-menu-label">Type</label>
        <select class="profile-menu-input" id="review-category" style="max-width:280px;">
          <option value="bug">Bug / problème</option>
          <option value="idee">Idée / suggestion</option>
          <option value="autre">Autre</option>
        </select>
      </div>
      <div class="profile-menu-row" style="margin-bottom:10px;">
        <label class="profile-menu-label">Message (obligatoire)</label>
        <textarea class="profile-menu-input" id="review-message" rows="6" maxlength="4000" placeholder="Ex. : Le bouton X ne répond pas sur mobile…" style="min-height:120px;resize:vertical;font-family:inherit;"></textarea>
      </div>
      <div class="profile-menu-row" style="margin-bottom:10px;">
        <label class="profile-menu-label">Contact ou pseudo (optionnel)</label>
        <input type="text" class="profile-menu-input" id="review-contact" maxlength="240" placeholder="Discord, email, pseudo…">
      </div>
      <div class="bj-rec" id="review-status" style="margin-bottom:10px;"></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:center;">
        <button class="profile-mini-btn primary" type="button" onclick="submitSiteFeedback()">Envoyer le retour</button>
      </div>
    </div>
  </div>
</div>
  `,
  news: `
<div class="page-panel" id="page-news">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ACTUALITÉS</div>
      <div class="hunt-title-sub">Vidéos & news de la team — nouvelles sorties slots (mêmes titres sur Gamdom, Stake, Shuffle, Celsius)</div>
    </div>
    <span class="news-team-badge"><img src="./assets/19enplein-logo.png" alt="" aria-hidden="true">TEAM 19ENPLEIN</span>
    <div style="margin-left:auto;display:flex;gap:8px;">
      <button class="profile-mini-btn" type="button" onclick="renderNewsPage(true)">↻ Rafraîchir</button>
    </div>
  </header>
  <div class="page-content" style="padding:14px;display:flex;flex-direction:column;gap:14px;">
    <div id="news-slot-week" class="news-slot-week hidden"></div>
    <div class="drop-box news-box-team">
      <div class="drop-title">Dernières vidéos de la team</div>
      <div class="drop-meta" style="margin-bottom:10px;">Postées automatiquement par le bot Discord depuis la chaîne HugoTaSlot — la team 19EnPlein en action.</div>
      <div id="news-videos-grid" class="news-grid"><div class="bj-rec">Chargement…</div></div>
    </div>
    <div class="drop-box">
      <div class="drop-title">Nouvelles sorties slots</div>
      <div class="drop-meta" style="margin-bottom:10px;">Le bot suit SlotCatalog (nouveautés mondiales — tu retrouves les mêmes titres sur Stake, Gamdom, Shuffle, Celsius quand ils sortent). Complété par BigWinBoard si dispo + ajouts admin.</div>
      <div id="news-slots-grid" class="news-grid"><div class="bj-rec">Chargement…</div></div>
    </div>
  </div>
</div>
  `,
  roue_multi: `
<div class="page-panel" id="page-roue_multi">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ROUE MULTI-TIRAGES</div>
      <div class="hunt-title-sub">La Roue de 19EnPlein — tirages classiques et multi-vainqueurs</div>
    </div>
    <div class="roue-script-credit" title="Script par !Bloodz">
      <span class="roue-script-credit__avatar" aria-hidden="true"></span>
      <span class="roue-script-credit__name">!Bloodz</span>
    </div>
  </header>
  <div class="page-content page-content--embed">
    <iframe class="roue-embed-frame" src="./roue-multi-tirages.html" title="La Roue de 19enplein - Multi-Tirages"></iframe>
  </div>
</div>
  `,
  roue_tournoi_equipes: `
<div class="page-panel" id="page-roue_tournoi_equipes">
  <header style="height:90px;flex-shrink:0;background:var(--bg-panel);border-bottom:1px solid var(--border);backdrop-filter:blur(20px);padding:0 28px;display:flex;align-items:center;gap:16px;">
    <div class="hunt-title-area">
      <div class="hunt-title-main">ROUE TOURNOI ÉQUIPES</div>
      <div class="hunt-title-sub">19EnPlein — tirage des équipes et suivi des gains</div>
    </div>
    <div class="roue-script-credit" title="Script par !Bloodz">
      <span class="roue-script-credit__avatar" aria-hidden="true"></span>
      <span class="roue-script-credit__name">!Bloodz</span>
    </div>
  </header>
  <div class="page-content page-content--embed">
    <iframe class="roue-embed-frame" src="./roue-tournoi-equipes.html" title="19enplein - Roue Tournoi Casino"></iframe>
  </div>
</div>
  `,
  paris_sportifs: `
<div class="page-panel ps-wmx" id="page-paris-sportifs">
  <header class="ps-wmx-header">
    <div class="ps-wmx-header-brand">
      <span class="ps-wmx-logo">Paris Sportifs</span>
      <span class="ps-wmx-tagline">HugoCoins · virtuel</span>
    </div>
    <nav class="ps-wmx-header-nav" role="tablist">
      <button type="button" class="ps-main-tab active" data-tab="matches" role="tab">Matchs</button>
      <button type="button" class="ps-main-tab ps-main-tab--live" data-tab="live" role="tab">En direct <span class="ps-live-tab-count"></span></button>
      <button type="button" class="ps-main-tab" data-tab="mine" role="tab">Mes paris</button>
      <button type="button" class="ps-main-tab" data-tab="leaderboard" role="tab">Classement</button>
    </nav>
    <div class="ps-wmx-header-right">
      <button type="button" class="ps-wmx-bonus-btn" id="ps-bonus-btn" title="Bonus quotidien">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/></svg>
        Bonus
      </button>
      <div class="ps-wmx-balance" id="ps-wallet-badge">
        <span class="ps-wmx-balance-label">Solde</span>
        <span class="ps-wmx-balance-val" id="ps-wallet-amount">—</span>
      </div>
    </div>
  </header>

  <div class="ps-wmx-legal">
    <strong>100 % virtuel</strong> · Aucune mise d'argent réel · Les HugoCoins n'ont aucune valeur monétaire.
  </div>

  <div class="ps-wmx-shell" id="ps-wmx-shell-matches">
    <aside class="ps-wmx-sidebar" id="ps-sidebar-competitions" aria-label="Compétitions"></aside>
    <main class="ps-wmx-main">
      <div class="ps-wmx-toolbar">
        <input type="search" id="ps-search" class="ps-wmx-search" placeholder="Rechercher une équipe, un joueur…" autocomplete="off">
      </div>
      <div class="ps-wmx-sport-strip-wrap">
        <nav class="ps-wmx-sport-strip" id="ps-sport-nav" aria-label="Sports"></nav>
      </div>
      <div class="ps-wmx-matches" id="ps-leagues-container">
        <div class="ps-empty">Chargement des matchs…</div>
      </div>
    </main>
    <aside class="ps-wmx-betslip" id="ps-betslip" aria-label="Panier de paris">
      <div class="ps-slip-head">
        <span class="ps-slip-count" id="ps-slip-count">0 sélection</span>
        <button type="button" class="ps-slip-clear" id="ps-slip-clear" title="Vider le panier" hidden>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/></svg>
        </button>
      </div>
      <div class="ps-slip-tabs">
        <button type="button" class="ps-slip-tab active" data-slip-mode="simple">Simple</button>
        <button type="button" class="ps-slip-tab" data-slip-mode="combo">Combiné</button>
      </div>
      <div class="ps-slip-body" id="ps-slip-body">
        <div class="ps-slip-empty" id="ps-slip-empty">
          <div class="ps-slip-empty-icon">🎒</div>
          <p>Ton panier est vide !</p>
          <span>Ajoute tes paris en cliquant sur les cotes.</span>
        </div>
        <div class="ps-slip-list" id="ps-slip-list" hidden></div>
      </div>
      <div class="ps-slip-footer" id="ps-slip-footer" hidden>
        <label class="ps-slip-stake-label">Mise (HC)
          <input type="number" id="ps-slip-stake" class="ps-slip-stake-input" min="10" max="500000" step="10" value="100">
        </label>
        <div class="ps-slip-quick">
          <button type="button" class="ps-slip-quick-btn" data-stake="50">50</button>
          <button type="button" class="ps-slip-quick-btn" data-stake="100">100</button>
          <button type="button" class="ps-slip-quick-btn" data-stake="500">500</button>
          <button type="button" class="ps-slip-quick-btn" data-stake="1000">1K</button>
          <button type="button" class="ps-slip-quick-btn" data-stake="max">Max</button>
        </div>
        <div class="ps-slip-gains">
          <span>Cote totale</span>
          <strong id="ps-slip-total-odd">—</strong>
        </div>
        <div class="ps-slip-gains">
          <span>Gains potentiels</span>
          <strong id="ps-slip-payout">0 HC</strong>
        </div>
        <button type="button" class="ps-slip-submit" id="ps-slip-submit" disabled>Parier</button>
        <div class="ps-slip-error" id="ps-slip-error" hidden></div>
      </div>
    </aside>
  </div>

  <section class="ps-wmx-full" id="ps-section-mine" hidden>
    <div class="ps-mine-filters">
      <button type="button" class="ps-mine-filter active" data-filter="all">Tous</button>
      <button type="button" class="ps-mine-filter" data-filter="pending">En cours</button>
      <button type="button" class="ps-mine-filter" data-filter="won">Gagnés</button>
      <button type="button" class="ps-mine-filter" data-filter="lost">Perdus</button>
    </div>
    <div class="ps-mine-summary" id="ps-mine-summary"></div>
    <div class="ps-mine-list" id="ps-mine-list"><div class="ps-empty">Chargement…</div></div>
  </section>

  <section class="ps-wmx-full" id="ps-section-leaderboard" hidden>
    <div class="ps-leaderboard-header">
      <h3>Top parieurs du mois</h3>
      <p class="ps-leaderboard-sub">Profit net · reset le 1er du mois</p>
    </div>
    <div class="ps-leaderboard" id="ps-leaderboard-list"><div class="ps-empty">Chargement…</div></div>
  </section>

  <div class="ps-match-detail" id="ps-match-detail" hidden>
    <div class="ps-match-detail-backdrop" id="ps-match-detail-backdrop"></div>
    <div class="ps-match-detail-panel">
      <button type="button" class="ps-match-detail-close" id="ps-match-detail-close" aria-label="Fermer">×</button>
      <div id="ps-match-detail-body"></div>
    </div>
  </div>
</div>
  `
};

const LAZY_PAGE_SCRIPTS = Object.freeze({
  // Passe 2 — scripts chargés uniquement quand l'utilisateur visite la page.
  blackjack:   './scripts/pages/blackjack.js',
  mise:        './scripts/pages/mise.js',
  tournoi:     './scripts/pages/tournoi.js',
  roue_depot:  './scripts/pages/roue-depot.js',
  slot_choix:  './scripts/pages/slot-choix.js',
  jeux:        './scripts/pages/mini-jeux.js',
  home:        './scripts/pages/hub-features.js',
  studio:      './scripts/pages/hub-features.js',
  stats:       './scripts/pages/stats.js',
  admin:       './scripts/pages/admin.js',
  news:        './scripts/pages/news.js',
  updates:     './scripts/pages/updates.js',
  review:      './scripts/pages/review.js',
  hunt:        './scripts/pages/hunt-share.js',
  paris_sportifs: './scripts/pages/paris-sportifs.js?v=20260710c',
});
/** Scripts à charger avant la page (helpers partagés hub-features / tournoi). */
const LAZY_PAGE_DEPS = Object.freeze({
  admin:   ['./scripts/pages/hub-features.js', './scripts/pages/tournoi.js'],
  news:    ['./scripts/pages/hub-features.js'],
  updates: ['./scripts/pages/hub-features.js'],
  hunt:    ['./scripts/pages/hunt-export.js', './scripts/pages/hunt-public-live.js', './scripts/pages/catalog-slots.js', './scripts/pages/hunt-workspace.js', './scripts/pages/hunt-opener.js'],
  studio:  ['./scripts/pages/hub-features.js', './scripts/pages/hunt-opener.js'],
});
const __lazyScriptLoaded = new Map(); // absUrl -> Promise<void>
function resolveLazyScriptUrl(rel) {
  try { return new URL(rel, document.baseURI || location.href).href; }
  catch (_) { return String(rel || ''); }
}
function loadLazyScriptByRel(rel) {
  const abs = resolveLazyScriptUrl(rel);
  if (__lazyScriptLoaded.has(abs)) return __lazyScriptLoaded.get(abs);
  const existing = [...document.scripts].find((el) => {
    if (!el.src) return false;
    try { return resolveLazyScriptUrl(el.getAttribute('src') || el.src) === abs; }
    catch (_) { return false; }
  });
  if (existing) {
    if (!__lazyScriptLoaded.has(abs)) {
      const p = new Promise((resolve, reject) => {
        if (existing.dataset.lazyLoaded === '1') { resolve(); return; }
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error(`lazy script failed: ${rel}`)), { once: true });
      });
      __lazyScriptLoaded.set(abs, p);
    }
    return __lazyScriptLoaded.get(abs);
  }
  const p = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = rel;
    s.async = true;
    s.dataset.lazySrc = abs;
    s.addEventListener('load', () => {
      s.dataset.lazyLoaded = '1';
      resolve();
    });
    s.addEventListener('error', () => {
      __lazyScriptLoaded.delete(abs);
      reject(new Error(`lazy script failed: ${rel}`));
    });
    document.head.appendChild(s);
  });
  __lazyScriptLoaded.set(abs, p);
  return p;
}
function loadLazyPageScript(page) {
  const deps = LAZY_PAGE_DEPS[page] || [];
  const rel = LAZY_PAGE_SCRIPTS[page];
  const chain = [...deps.map((d) => () => loadLazyScriptByRel(d))];
  if (rel) chain.push(() => loadLazyScriptByRel(rel));
  if (!chain.length) return Promise.resolve();
  return chain.reduce((acc, fn) => acc.then(fn), Promise.resolve()).then(() => {
    if (page === 'hunt') applyHuntAppHooks();
  });
}

// ─── LAZY CHARGEMENT DU CATALOGUE jeux.json ───
// jeux.json (~1-2 Mo) n'est plus chargé au boot mais uniquement quand
// l'utilisateur entre sur la page Hunt (où la grille est affichée).

let v101Initialized = false;
async function initV101() {
  if (v101Initialized) return;
  v101Initialized = true;
  applyUiPrefs();
  await initAuth();
  refreshCurrencyInline();
  renderProfileBadge();
  populateBonusFilterPresetsSelect();
  const gsi = document.getElementById('global-search-input');
  if (gsi) {
    gsi.addEventListener('input', () => {
      clearTimeout(globalSearchDebounce);
      globalSearchDebounce = setTimeout(() => { runGlobalSearch().catch(() => {}); }, 160);
    });
  }
  // Routing initial : on lit l'URL et on monte la bonne page.
  // Si l'URL pointe vers /admin et que l'utilisateur n'est pas admin,
  // switchPage() rebascule automatiquement sur /home.
  const initialRaw = (typeof pathToPage === 'function') ? pathToPage(location.pathname) : 'home';
  let initial = initialRaw;
  let initialHuntTab = null;
  if (HUNT_TAB_FROM_PAGE[initialRaw]) {
    initialHuntTab = HUNT_TAB_FROM_PAGE[initialRaw];
    initial = 'hunt';
  }
  switchPage(initial, { replace: true, huntTab: initialHuntTab });
  consumeSlotPrefillFromUrl();

  await loadLazyPageScript('home').catch(() => {});
  await loadLazyPageScript('hunt').catch(() => {});
  refreshMaintenanceConfig(true).catch(() => {});
  startMaintenancePolling();
  if (typeof maybeShowOnboarding === 'function') maybeShowOnboarding();
  ensureNotifBellInHeader();
  checkInAppNotifications().catch(() => {});
  if (!window.__hmNotifPollBound) {
    window.__hmNotifPollBound = true;
    setInterval(() => { checkInAppNotifications().catch(() => {}); }, 5 * 60 * 1000);
  }

  // Back/forward navigateur
  if (!window.__bhPopStateBound) {
    window.__bhPopStateBound = true;
    window.addEventListener('popstate', (e) => {
      const page = (e.state && e.state.page) || pathToPage(location.pathname);
      const huntTab = (e.state && e.state.huntTab) || pathToHuntTab(location.pathname);
      switchPage(page, { skipHistory: true, huntTab });
    });
  }
  initPwaInstallPrompt();
}

// Le script est chargé avant une partie du HTML: on déclenche l'init v1.01
// quand tout le DOM est prêt.
