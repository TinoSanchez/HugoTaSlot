'use strict';
/* globals onlineCount, toEUR, showToast, showAuth, isCloudUser, currentUser, escapeHtml, fmt, activeHunt, state, switchPage, showNewHuntModal, openOpener, openMiniOpener, openOrFocusStreamerHud, setStreamerOverlayEnabled, isStreamerOverlayEnabled, getAuthClient, cloudCall, withTimeout, bhWarn, computeRankFromWagered, ensurePlayerStatsReady, loadLazyPageScript */

var ONBOARDING_KEY = 'hm_onboarding_v1';
var ONBOARDING_ROLE_KEY = 'hm_onboarding_role_v1';
var STUDIO_PREFS_KEY = 'hm_studio_prefs_v1';

var PRODUCT_CHANGELOG_FALLBACK = [
  {
    version: '1.03',
    date: '2026-07-04',
    items: ['Changelog — voir product-changelog.json'],
  },
];

var __productChangelogCache = null;

async function loadProductChangelog() {
  if (__productChangelogCache) return __productChangelogCache;
  try {
    const res = await fetch('./product-changelog.json', { cache: 'no-cache' });
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data?.entries) && data.entries.length) {
        __productChangelogCache = data.entries;
        return __productChangelogCache;
      }
    }
  } catch (e) {
    bhWarn('loadProductChangelog', e);
  }
  __productChangelogCache = PRODUCT_CHANGELOG_FALLBACK;
  return __productChangelogCache;
}

function buildProductChangelogHtml(entries) {
  const list = Array.isArray(entries) && entries.length ? entries : PRODUCT_CHANGELOG_FALLBACK;
  return `
    <div class="drop-box" style="margin-bottom:14px;">
      <div class="drop-title">Nouveautés produit</div>
      <div class="drop-meta" style="margin-bottom:12px;">Ce qui change pour toi sur hugotaslot.fr — distinct du monitoring technique ci-dessous. Source : <code>product-changelog.json</code> (mise à jour à chaque release).</div>
      <div class="changelog-list">
        ${list.map((entry) => `
          <div class="changelog-item">
            <div class="changelog-item-head">
              <span class="changelog-version">v${escapeHtml(entry.version)}</span>
              <span class="changelog-date">${escapeHtml(entry.date)}</span>
            </div>
            <ul>${(entry.items || []).map((it) => `<li>${escapeHtml(it)}</li>`).join('')}</ul>
          </div>
        `).join('')}
      </div>
    </div>`;
}

function renderProductChangelogHtml(entries) {
  return buildProductChangelogHtml(entries || __productChangelogCache);
}

async function renderProductChangelogSection() {
  const wrap = document.getElementById('updates-changelog');
  if (!wrap) return;
  wrap.innerHTML = '<div class="bj-rec">Chargement du changelog produit…</div>';
  const entries = await loadProductChangelog();
  wrap.innerHTML = buildProductChangelogHtml(entries);
}

var PRODUCT_CHANGELOG = PRODUCT_CHANGELOG_FALLBACK;

var ONBOARDING_STEPS = [
  {
    title: 'Bienvenue sur HugoTaSlot',
    text: 'Choisis ton profil : streamer (Bonus Hunt live) ou viewer (mini-jeux, drops, actus). Tu pourras relancer le guide depuis l’accueil.',
    action: null,
  },
  {
    title: 'Étape 1 — Crée un hunt',
    text: 'Définis le nom, le solde de départ et la devise. Tous tes bonus et stats seront suivis automatiquement.',
    action: { label: 'Créer un hunt', fn: () => { showNewHuntModal(); switchPage('hunt'); } },
  },
  {
    title: 'Étape 2 — Ajoute des slots',
    text: 'Parcours le catalogue (~8000 jeux), filtre par provider et ajoute tes bonus avec mise et type (Normal / Bounty / Epic).',
    action: { label: 'Aller au hunt', fn: () => switchPage('hunt') },
  },
  {
    title: 'Étape 3 — Ouvre en live',
    text: 'Lance l’opener plein écran ou le mini-opener pour saisir les gains au clavier. Active le HUD stream pour OBS.',
    action: { label: 'Ouvrir le Studio', fn: () => switchPage('studio') },
  },
  {
    title: 'Étape 4 — Drop & communauté',
    text: 'Récupère ton drop quotidien dans le menu profil. Monte au classement via le tournoi mensuel et les mini-jeux.',
    action: { label: 'Voir le tournoi', fn: () => switchPage('hunt', { huntTab: 'tournoi' }) },
  },
];

function isOnboardingDone() {
  try { return localStorage.getItem(ONBOARDING_KEY) === '1'; } catch { return false; }
}
function setOnboardingDone() {
  try { localStorage.setItem(ONBOARDING_KEY, '1'); } catch (_) {}
}
function getOnboardingRole() {
  try { return localStorage.getItem(ONBOARDING_ROLE_KEY) || ''; } catch { return ''; }
}
function setOnboardingRole(role) {
  try { localStorage.setItem(ONBOARDING_ROLE_KEY, String(role || '')); } catch (_) {}
}

var onboardingStepIdx = 0;
var onboardingRole = '';

function renderOnboardingDots(step) {
  const wrap = document.getElementById('onboarding-dots');
  if (!wrap) return;
  wrap.innerHTML = ONBOARDING_STEPS.map((_, i) => {
    let cls = 'onboarding-dot';
    if (i === step) cls += ' active';
    else if (i < step) cls += ' done';
    return `<div class="${cls}"></div>`;
  }).join('');
}

function renderOnboardingStep(step) {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  onboardingStepIdx = Math.max(0, Math.min(step, ONBOARDING_STEPS.length - 1));
  const s = ONBOARDING_STEPS[onboardingStepIdx];
  const title = document.getElementById('onboarding-title');
  const text = document.getElementById('onboarding-text');
  const kicker = document.getElementById('onboarding-kicker');
  const roleRow = document.getElementById('onboarding-role-row');
  const actionBtn = document.getElementById('onboarding-action-btn');
  const backBtn = document.getElementById('onboarding-back-btn');
  if (title) title.textContent = s.title;
  if (text) text.textContent = s.text;
  if (kicker) kicker.textContent = onboardingStepIdx === 0 ? 'GUIDE DE DÉMARRAGE' : `ÉTAPE ${onboardingStepIdx} / ${ONBOARDING_STEPS.length - 1}`;
  if (roleRow) roleRow.style.display = onboardingStepIdx === 0 ? 'flex' : 'none';
  if (backBtn) backBtn.style.visibility = onboardingStepIdx <= 1 ? 'hidden' : 'visible';
  if (actionBtn) {
    if (s.action) {
      actionBtn.style.display = '';
      actionBtn.textContent = s.action.label;
      actionBtn.onclick = () => { s.action.fn(); nextOnboardingStep(); };
    } else {
      actionBtn.style.display = 'none';
    }
  }
  renderOnboardingDots(onboardingStepIdx);
  overlay.classList.remove('hidden');
}

function startOnboarding(force) {
  if (!force && isOnboardingDone()) return;
  onboardingStepIdx = 0;
  onboardingRole = getOnboardingRole();
  renderOnboardingStep(0);
  document.querySelectorAll('.onboarding-role-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.role === onboardingRole);
  });
}

function selectOnboardingRole(role) {
  onboardingRole = String(role || '');
  setOnboardingRole(onboardingRole);
  document.querySelectorAll('.onboarding-role-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.role === onboardingRole);
  });
}

function nextOnboardingStep() {
  if (onboardingStepIdx >= ONBOARDING_STEPS.length - 1) {
    finishOnboarding();
    return;
  }
  renderOnboardingStep(onboardingStepIdx + 1);
}

function prevOnboardingStep() {
  if (onboardingStepIdx <= 0) return;
  renderOnboardingStep(onboardingStepIdx - 1);
}

function skipOnboarding() {
  finishOnboarding();
}

function finishOnboarding() {
  setOnboardingDone();
  const overlay = document.getElementById('onboarding-overlay');
  if (overlay) overlay.classList.add('hidden');
  if (onboardingRole === 'streamer') switchPage('hunt');
  else if (onboardingRole === 'viewer') switchPage('jeux');
}

function maybeShowOnboarding() {
  if (isOnboardingDone()) return;
  setTimeout(() => startOnboarding(false), 700);
}

function renderProductChangelogHtmlLegacy() {
  return buildProductChangelogHtml(__productChangelogCache);
}

function parisMonthKey() {
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit' }).format(new Date());
  return s.slice(0, 7);
}

async function fetchHomeLeaderboard() {
  const c = typeof getAuthClient === 'function' ? getAuthClient() : null;
  if (!c) return [];
  const month = parisMonthKey();
  try {
    const { data, error } = await cloudCall('profile', () => withTimeout(
      () => c.from('tournament_entries').select('hunt_name,player_name,multiplier,gain,mise,verified').eq('period_month', month).order('multiplier', { ascending: false }).limit(5),
      10000
    ), { retries: 1, timeoutMs: 11000, delayMs: 300, quiet: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    bhWarn('home leaderboard', e);
    return [];
  }
}

async function fetchHomeLeaderboardWager() {
  const c = typeof getAuthClient === 'function' ? getAuthClient() : null;
  if (!c) return [];
  try {
    const { data, error } = await cloudCall('profile', () => withTimeout(
      () => c.rpc('get_leaderboard_wager', { p_limit: 5 }),
      10000
    ), { retries: 1, timeoutMs: 11000, delayMs: 300, quiet: true });
    if (error) throw error;
    return Array.isArray(data) ? data : (data ? JSON.parse(JSON.stringify(data)) : []);
  } catch (e) {
    bhWarn('home leaderboard wager', e);
    return [];
  }
}

async function fetchHomeLeaderboardStreak() {
  const c = typeof getAuthClient === 'function' ? getAuthClient() : null;
  if (!c) return [];
  try {
    const { data, error } = await cloudCall('profile', () => withTimeout(
      () => c.rpc('get_leaderboard_streak', { p_limit: 5 }),
      10000
    ), { retries: 1, timeoutMs: 11000, delayMs: 300, quiet: true });
    if (error) throw error;
    return Array.isArray(data) ? data : (data ? JSON.parse(JSON.stringify(data)) : []);
  } catch (e) {
    bhWarn('home leaderboard streak', e);
    return [];
  }
}

var __homeLbTab = 'tournoi';

function renderLeaderboardCardsHtml(rows, tab) {
  if (!rows.length) {
    const empty = {
      tournoi: 'Aucune entrée tournoi ce mois-ci.',
      wager: 'Aucune mise mini-jeu enregistrée.',
      streak: 'Aucun streak de drop actif.',
    };
    return `<div class="bj-rec">${empty[tab] || 'Aucune donnée.'}</div>`;
  }
  const medals = ['🥇', '🥈', '🥉', '4.', '5.'];
  return `<div class="home-leaderboard-grid">${rows.map((r, i) => {
    if (tab === 'tournoi') {
      return `<div class="leaderboard-card">
        <div class="leaderboard-rank">${medals[i] || `#${i + 1}`}</div>
        <div class="leaderboard-meta">
          <div class="leaderboard-name">${escapeHtml(r.hunt_name || 'Hunt')}</div>
          <div class="leaderboard-sub">${escapeHtml(r.player_name || 'Joueur')}${r.verified ? ' · vérifié' : ''}</div>
        </div>
        <div class="leaderboard-score">×${Number(r.multiplier || 0).toFixed(2)}</div>
      </div>`;
    }
    if (tab === 'wager') {
      return `<div class="leaderboard-card">
        <div class="leaderboard-rank">${medals[i] || `#${i + 1}`}</div>
        <div class="leaderboard-meta">
          <div class="leaderboard-name">${escapeHtml(r.player_name || 'Joueur')}</div>
          <div class="leaderboard-sub">${Number(r.rounds || 0)} parties</div>
        </div>
        <div class="leaderboard-score">${typeof fmtVirtual === 'function' ? fmtVirtual(r.wager) : Number(r.wager || 0).toFixed(0)}</div>
      </div>`;
    }
    return `<div class="leaderboard-card">
      <div class="leaderboard-rank">${medals[i] || `#${i + 1}`}</div>
      <div class="leaderboard-meta">
        <div class="leaderboard-name">${escapeHtml(r.player_name || 'Joueur')}</div>
        <div class="leaderboard-sub">Drop quotidien</div>
      </div>
      <div class="leaderboard-score">🔥 ${Number(r.streak || 0)}j</div>
    </div>`;
  }).join('')}</div>`;
}

async function renderHomeLeaderboardTab(tab) {
  const wrap = document.getElementById('home-leaderboard');
  if (!wrap) return;
  __homeLbTab = tab || 'tournoi';
  wrap.innerHTML = '<div class="bj-rec">Chargement du classement…</div>';
  document.querySelectorAll('#home-lb-tabs .home-lb-tab').forEach((btn) => {
    const on = btn.dataset.lbTab === __homeLbTab;
    btn.classList.toggle('active', on);
    btn.setAttribute('aria-selected', on ? 'true' : 'false');
  });
  let rows = [];
  if (__homeLbTab === 'tournoi') rows = await fetchHomeLeaderboard();
  else if (__homeLbTab === 'wager') rows = await fetchHomeLeaderboardWager();
  else rows = await fetchHomeLeaderboardStreak();
  wrap.innerHTML = renderLeaderboardCardsHtml(rows, __homeLbTab);
  if (__homeLbTab === 'tournoi' && !rows.length) {
    wrap.innerHTML += ' <button type="button" class="profile-mini-btn" onclick="switchPage(\'hunt\',{huntTab:\'tournoi\'})">Soumettre un hunt</button>';
  }
}

async function renderHomeLeaderboard() {
  if (!document.getElementById('home-lb-tabs')?.dataset.bound) {
    const tabs = document.getElementById('home-lb-tabs');
    if (tabs) {
      tabs.dataset.bound = '1';
      tabs.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-lb-tab]');
        if (!btn) return;
        renderHomeLeaderboardTab(btn.dataset.lbTab);
      });
    }
  }
  await renderHomeLeaderboardTab(__homeLbTab);
}

function tournoiStatusLabel(entry) {
  if (!entry) return '—';
  if (entry.verified) return 'Validé';
  return 'En attente';
}
function tournoiStatusClass(entry) {
  if (!entry) return '';
  return entry.verified ? 'tournoi-status--ok' : 'tournoi-status--pending';
}

async function fetchMyTournoiSubmissions() {
  if (!isCloudUser() || !currentUser?.id) return [];
  const c = getAuthClient();
  if (!c) return [];
  try {
    const { data, error } = await cloudCall('profile', () => withTimeout(
      () => c.from('tournament_entries')
        .select('id,hunt_name,gain,mise,multiplier,verified,created_at,replay_url')
        .eq('user_id', currentUser.id)
        .order('created_at', { ascending: false })
        .limit(8),
      10000
    ), { retries: 1, timeoutMs: 11000, delayMs: 300, quiet: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    bhWarn('profile tournoi submissions', e);
    return [];
  }
}

async function renderProfileTournoiSubmissions() {
  const box = document.getElementById('profile-tournoi-submissions');
  if (!box) return;
  if (!isCloudUser()) {
    box.innerHTML = '<div class="drop-meta">Connecte-toi pour voir tes soumissions tournoi.</div>';
    return;
  }
  box.innerHTML = '<div class="drop-meta">Chargement…</div>';
  const rows = await fetchMyTournoiSubmissions();
  if (!rows.length) {
    box.innerHTML = '<div class="drop-meta">Aucune soumission ce mois ou avant. Soumets un hunt depuis le menu ⋯ ou l’onglet Tournoi.</div>';
    return;
  }
  box.innerHTML = rows.map((r) => {
    const when = r.created_at ? new Date(r.created_at).toLocaleDateString('fr-FR') : '—';
    const replay = r.replay_url && typeof isSafeUrl === 'function' && isSafeUrl(r.replay_url)
      ? `<a href="${escapeHtml(r.replay_url)}" target="_blank" rel="noopener noreferrer" class="profile-tournoi-link">Replay</a>`
      : '<span class="profile-tournoi-link muted">Sans replay</span>';
    return `<div class="profile-tournoi-row">
      <div class="profile-tournoi-main">
        <div class="profile-tournoi-name">${escapeHtml(r.hunt_name || 'Hunt')}</div>
        <div class="profile-tournoi-meta">${when} · ×${Number(r.multiplier || 0).toFixed(2)} · ${replay}</div>
      </div>
      <span class="tournoi-status-badge ${tournoiStatusClass(r)}">${tournoiStatusLabel(r)}</span>
    </div>`;
  }).join('');
}

var SLOT_WEEK_KEY = 'hm_slot_week_pick_v1';

function setSlotOfTheWeek(slotId) {
  if (!slotId) return;
  try {
    localStorage.setItem(SLOT_WEEK_KEY, JSON.stringify({ id: slotId, until: Date.now() + 7 * 86400000 }));
  } catch (_) {}
}

function pickSlotOfTheWeek(slots) {
  if (!Array.isArray(slots) || !slots.length) return null;
  try {
    const saved = JSON.parse(localStorage.getItem(SLOT_WEEK_KEY) || 'null');
    if (saved?.id && Number(saved.until) > Date.now()) {
      const hit = slots.find((s) => String(s.id) === String(saved.id));
      if (hit) return hit;
    }
  } catch (_) {}
  const weekAgo = Date.now() - 7 * 86400000;
  return slots.find((s) => s.published_at && new Date(s.published_at).getTime() >= weekAgo) || slots[0];
}

function addNewsSlotToHunt(slot) {
  if (!slot) return;
  if (!state.activeHuntId) {
    showToast('Crée ou sélectionne un hunt d’abord', 'info', 2800);
    switchPage('hunt');
    if (typeof showNewHuntModal === 'function') showNewHuntModal();
    return;
  }
  if (typeof openAddModal !== 'function') {
    showToast('Module hunt indisponible', 'error');
    return;
  }
  switchPage('hunt');
  openAddModal({
    nom: slot.title,
    name: slot.title,
    provider: slot.provider || '',
    image: slot.image || '',
    gamdomUrl: slot.url || '',
  });
}

function addNewsSlotWeekToHunt() {
  addNewsSlotToHunt(window.__newsSlotWeekPick);
}

function getRankBadgeHtml() {
  if (typeof computeRankFromWagered !== 'function' || typeof ensurePlayerStatsReady !== 'function') return '';
  const stats = ensurePlayerStatsReady();
  const rank = computeRankFromWagered(stats?.wagered || 0);
  const streak = Number(currentUser?.streak || 0);
  const streakTxt = streak > 0 ? ` · 🔥${streak}j` : '';
  return `<div class="profile-rank-badge">⬡ ${escapeHtml(rank.label)}${streakTxt}</div>`;
}

function getStudioPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(STUDIO_PREFS_KEY) || '{}');
    return {
      showBonusCount: p.showBonusCount !== false,
      showBe: p.showBe !== false,
      showStartBalance: p.showStartBalance !== false,
      showHuntName: p.showHuntName !== false,
    };
  } catch {
    return { showBonusCount: true, showBe: true, showStartBalance: true, showHuntName: true };
  }
}
function saveStudioPrefs(p) {
  try { localStorage.setItem(STUDIO_PREFS_KEY, JSON.stringify({ ...getStudioPrefs(), ...p })); } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('hm-studio-prefs-changed', { detail: getStudioPrefs() })); } catch (_) {}
}

function renderStudioPage() {
  const wrap = document.getElementById('studio-content');
  if (!wrap) return;
  const prefs = getStudioPrefs();
  const hudUrl = new URL('./streamer-hud.html', window.location.href).href;
  const hunt = typeof activeHunt === 'function' ? activeHunt() : null;
  wrap.innerHTML = `
    <div class="studio-grid">
      <div class="studio-card">
        <div class="studio-card-title">Opener plein écran</div>
        <div class="studio-card-text">Saisie rapide des gains bonus par bonus, BE évolutif et raccourcis clavier.</div>
        <div class="studio-actions">
          <button type="button" class="profile-mini-btn primary" onclick="studioOpenOpener()">Lancer l’opener</button>
          <button type="button" class="profile-mini-btn" onclick="switchPage('hunt')">Retour hunt</button>
        </div>
      </div>
      <div class="studio-card">
        <div class="studio-card-title">Mini-opener (popup)</div>
        <div class="studio-card-text">Fenêtre compacte toujours au-dessus — idéal second écran ou PiP Chrome.</div>
        <div class="studio-actions">
          <button type="button" class="profile-mini-btn primary" onclick="openMiniOpener()">Ouvrir mini-opener</button>
        </div>
      </div>
      <div class="studio-card">
        <div class="studio-card-title">HUD Stream OBS</div>
        <div class="studio-card-text">Source navigateur ou fenêtre Picture-in-Picture. Copie l’URL pour OBS Browser Source.</div>
        <div class="studio-actions">
          <button type="button" class="profile-mini-btn primary" onclick="studioOpenHud()">Ouvrir le HUD</button>
          <button type="button" class="profile-mini-btn" onclick="studioCopyHudUrl()">Copier URL HUD</button>
        </div>
        <div class="studio-url-box" id="studio-hud-url">${escapeHtml(hudUrl)}</div>
      </div>
      <div class="studio-card">
        <div class="studio-card-title">Affichage HUD / overlay</div>
        <div class="studio-card-text">Ces options sont lues par le HUD et le mode stream de l’opener.${hunt ? ` Hunt actif : <strong>${escapeHtml(hunt.name || '')}</strong>.` : ' Aucun hunt sélectionné.'}</div>
        <div class="studio-toggle-row"><span>Nom du hunt</span><input type="checkbox" id="studio-pref-hunt" ${prefs.showHuntName ? 'checked' : ''} onchange="studioTogglePref('showHuntName', this.checked)"></div>
        <div class="studio-toggle-row"><span>Bonus restants</span><input type="checkbox" id="studio-pref-bonus" ${prefs.showBonusCount ? 'checked' : ''} onchange="studioTogglePref('showBonusCount', this.checked)"></div>
        <div class="studio-toggle-row"><span>BE évolutif / moyen</span><input type="checkbox" id="studio-pref-be" ${prefs.showBe ? 'checked' : ''} onchange="studioTogglePref('showBe', this.checked)"></div>
        <div class="studio-toggle-row"><span>Solde de départ</span><input type="checkbox" id="studio-pref-bal" ${prefs.showStartBalance ? 'checked' : ''} onchange="studioTogglePref('showStartBalance', this.checked)"></div>
        <div class="studio-toggle-row"><span>Overlay stream intégré</span><input type="checkbox" id="studio-stream-toggle" ${typeof isStreamerOverlayEnabled === 'function' && isStreamerOverlayEnabled() ? 'checked' : ''} onchange="studioStreamToggle(this.checked)"></div>
      </div>
      <div class="studio-card">
        <div class="studio-card-title">Raccourcis opener</div>
        <div class="studio-card-text">Dans l’opener : Entrée valide le gain · flèches gauche/droite naviguent · Échap ferme.</div>
      </div>
    </div>`;
}

function studioOpenOpener() {
  const hunt = typeof activeHunt === 'function' ? activeHunt() : null;
  if (!hunt || !(hunt.bonuses || []).length) {
    showToast('Sélectionne un hunt avec au moins un bonus', 'info', 2600);
    switchPage('hunt');
    return;
  }
  const idx = Math.max(0, (hunt.bonuses || []).findIndex((b) => !b.opened));
  openOpener(idx >= 0 ? idx : 0);
}

function studioOpenHud() {
  if (typeof setStreamerOverlayEnabled === 'function') setStreamerOverlayEnabled(true);
  const t = document.getElementById('studio-stream-toggle');
  if (t) t.checked = true;
  const openerT = document.getElementById('opener-streamer-toggle');
  if (openerT) openerT.checked = true;
  if (typeof openOrFocusStreamerHud === 'function') openOrFocusStreamerHud({ force: true });
  else showToast('HUD indisponible sur cet appareil', 'error');
}

function studioCopyHudUrl() {
  const url = new URL('./streamer-hud.html', window.location.href).href;
  navigator.clipboard.writeText(url).then(() => showToast('URL HUD copiée', 'success', 1800)).catch(() => showToast(url, 'info', 4000));
}

function studioTogglePref(key, val) {
  saveStudioPrefs({ [key]: !!val });
}

function studioStreamToggle(on) {
  if (typeof setStreamerOverlayEnabled === 'function') setStreamerOverlayEnabled(!!on);
  if (on && typeof openOrFocusStreamerHud === 'function') openOrFocusStreamerHud();
}

function getActiveHuntTournoiStats() {
  const hunt = typeof activeHunt === 'function' ? activeHunt() : null;
  if (!hunt) return null;
  const bonuses = hunt.bonuses || [];
  if (!bonuses.length) return null;
  const mise = bonuses.reduce((s, b) => s + Number(b.stake || 0), 0);
  const openedBonuses = bonuses.filter((b) => b.win !== null);
  const gain = openedBonuses.reduce((s, b) => s + Number(b.win || 0), 0);
  if (mise <= 0) return null;
  const opened = openedBonuses.length;
  let liveUrl = '';
  try {
    if (hunt.publicShareEnabled && hunt.publicShareSlug && typeof getPublicHuntLiveUrl === 'function') {
      liveUrl = getPublicHuntLiveUrl(hunt.publicShareSlug);
    }
  } catch (_) {}
  return { huntName: hunt.name || 'Mon Hunt', gain, mise, opened, total: bonuses.length, liveUrl };
}

async function submitActiveHuntToTournoi() {
  if (!isCloudUser()) {
    showToast('Connecte-toi pour soumettre au tournoi', 'error', 3000);
    showAuth();
    return;
  }
  const stats = getActiveHuntTournoiStats();
  if (!stats) {
    showToast('Ajoute des bonus à ton hunt avant de soumettre', 'error', 2600);
    return;
  }
  if (stats.opened < stats.total) {
    showToast(`Hunt incomplet (${stats.opened}/${stats.total} bonus ouverts) — tu peux quand même soumettre`, 'info', 3200);
  }
  await loadLazyPageScript('tournoi');
  if (typeof showSubmitTournoi !== 'function') {
    showToast('Module tournoi indisponible', 'error');
    return;
  }
  showSubmitTournoi();
  const nameEl = document.getElementById('t-hunt-name');
  const gainEl = document.getElementById('t-gain');
  const miseEl = document.getElementById('t-mise');
  const replayEl = document.getElementById('t-replay');
  const hintEl = document.getElementById('tournoi-modal-hint');
  if (nameEl) nameEl.value = stats.huntName;
  if (gainEl) gainEl.value = Number(stats.gain).toFixed(2);
  if (miseEl) miseEl.value = Number(stats.mise).toFixed(2);
  if (replayEl && stats.liveUrl) replayEl.value = stats.liveUrl;
  if (hintEl) {
    hintEl.textContent = stats.liveUrl
      ? 'Lien live pré-rempli. Ajoute ta VOD quand elle est prête — le replay reste optionnel.'
      : 'Replay optionnel : sans lien, la validation admin peut prendre plus de temps.';
  }
}


/* renderHomeHubMetrics — extrait app.js P10 */
function renderHomeHubMetrics() {
  const hunts = state.hunts || [];
  const huntCount = hunts.length;
  const bonusCount = hunts.reduce((a, h) => a + ((h.bonuses || []).length), 0);
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const profitForWindow = (days) => hunts.reduce((acc, h) => {
    const created = Number(h.createdAt || 0);
    if (!created || (now - created) > (days * dayMs)) return acc;
    const startEur = Number(h.startBalanceEUR || toEUR(Number(h.startBalance || 0), h.currency || 'EUR'));
    const totalWin = (h.bonuses || []).reduce((w, b) => w + Number(b.win || 0), 0);
    const totalWinEur = toEUR(totalWin, h.currency || 'EUR');
    return acc + (totalWinEur - startEur);
  }, 0);
  const totalProfitEur = hunts.reduce((acc, h) => {
    const startEur = Number(h.startBalanceEUR || toEUR(Number(h.startBalance || 0), h.currency || 'EUR'));
    const totalWin = (h.bonuses || []).reduce((w, b) => w + Number(b.win || 0), 0);
    const totalWinEur = toEUR(totalWin, h.currency || 'EUR');
    return acc + (totalWinEur - startEur);
  }, 0);
  const p7 = profitForWindow(7);
  const p30 = profitForWindow(30);
  const eH = document.getElementById('home-kpi-hunts');
  const eB = document.getElementById('home-kpi-bonus');
  const eP = document.getElementById('home-kpi-profit');
  const eO = document.getElementById('home-kpi-online');
  const e7 = document.getElementById('home-kpi-profit-7d');
  const e30 = document.getElementById('home-kpi-profit-30d');
  if (eH) eH.textContent = String(huntCount);
  if (eB) eB.textContent = String(bonusCount);
  if (eP) {
    eP.textContent = fmt(totalProfitEur, 'EUR');
    eP.style.color = totalProfitEur >= 0 ? 'var(--green)' : 'var(--red)';
  }
  if (eO) eO.textContent = String(Math.max(1, onlineCount || 1));
  if (e7) { e7.textContent = fmt(p7, 'EUR'); e7.style.color = p7 >= 0 ? 'var(--green)' : 'var(--red)'; }
  if (e30) { e30.textContent = fmt(p30, 'EUR'); e30.style.color = p30 >= 0 ? 'var(--green)' : 'var(--red)'; }
}
