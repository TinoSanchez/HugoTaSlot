'use strict';
/* globals state, save, load, loadLocal, writeLocalCache, escapeHtml, fmt, fmtVirtual, showToast, confirm, bhWarn, pushRuntimeLog, cloudCall, retryAsync, withTimeout, renderHuntList, selectHunt, scheduleHuntUI, switchPage, activeHunt, renderHuntWorkspace, updateHeaderStats, requireWriteAccess, isCurrentUserAdmin, adminFetchCloudUsers, getUsers, ensureAdminBootstrap, updateAdminTabVisibility, getRankBadgeHtml, getDisplayName, getAvatarUrl, buildAvatarMarkup, toEUR, FX_RATES_TO_EUR, flushFeedbackQueue, LOCAL_SYNCED_KEY, STORAGE_KEY, CLOUD_STRICT_POINTS, __activePage, pathToPage, renderHomeHubMetrics, invalidateCache, handleConnectionRestored, runSupabaseHealthCheck, markCircuitSuccess, getCircuitState, hideNetBanner, showNetBanner, dedupeAllHuntsBonuses, playerStatsScope, ensurePlayerStatsReady, savePlayerStatsForScope, STATS_GAMES, renderStatsPage, renderHomeDiscordBanner, maybeOpenPendingSlotPrefill, consumeSlotPrefillFromUrl, openDiscordLinkModal, loadDiscordLinkStatus */
/* Auth cloud Supabase, session, profil, drop quotidien, liaison Discord — chargé au boot (index.html) */

function isCloudUser() {
  return !!(currentUser && !currentUser.isGuest && currentUser.cloud && currentUser.id);
}


let discordLinkCache = { linked: false, username: '', pendingCode: '', checked: false };

function buildSlotHuntPrefillUrl(slot) {
  const title = String(slot?.title || slot?.nom || slot?.name || '').trim();
  if (!title) return '';
  const params = new URLSearchParams();
  params.set('slotTitle', title);
  const provider = String(slot?.provider || '').trim();
  const image = String(slot?.image || '').trim();
  const url = String(slot?.url || slot?.gamdomUrl || '').trim();
  if (provider) params.set('slotProvider', provider);
  if (image) params.set('slotImage', image);
  if (url) params.set('slotUrl', url);
  let origin = 'https://hugotaslot.fr';
  try { origin = location.origin || origin; } catch (_) {}
  return `${origin}/hunt?${params.toString()}`;
}

// [admin] — extrait dans scripts/pages/admin.js (LAZY_PAGE_SCRIPTS)
function maybeOpenPendingSlotPrefill() {
  const slot = window.__pendingSlotPrefill;
  if (!slot || !state.activeHuntId) return;
  window.__pendingSlotPrefill = null;
  if (typeof openAddModal === 'function') {
    setTimeout(() => openAddModal(slot), 120);
  }
}

function consumeSlotPrefillFromUrl() {
  try {
    const params = new URLSearchParams(location.search || '');
    const title = String(params.get('slotTitle') || '').trim();
    if (!title) return;
    window.__pendingSlotPrefill = {
      nom: title,
      name: title,
      title,
      provider: String(params.get('slotProvider') || '').trim(),
      image: String(params.get('slotImage') || '').trim(),
      gamdomUrl: String(params.get('slotUrl') || '').trim(),
      url: String(params.get('slotUrl') || '').trim(),
    };
    history.replaceState(history.state || { page: 'hunt' }, '', location.pathname || '/hunt');
    switchPage('hunt');
    if (state.activeHuntId) {
      maybeOpenPendingSlotPrefill();
    } else {
      showToast('Choisis ou crée un hunt pour ajouter la slot annoncée', 'info', 3600);
    }
  } catch (_) {}
}

async function renderHomeDiscordBanner() {
  const wrap = document.getElementById('home-discord-banner');
  if (!wrap) return;
  const cmds = [
    { code: '/hunts', desc: 'Tes hunts liés' },
    { code: '/leaderboard', desc: 'Top profits communauté' },
    { code: '/live slug', desc: 'Lien hunt public partagé' },
    { code: '/slot · /call', desc: 'Catalogue (tous)' },
  ];
  const cmdHtml = cmds.map((c) => `<span class="home-discord-cmd"><code>${escapeHtml(c.code)}</code> ${escapeHtml(c.desc)}</span>`).join('');
  if (!currentUser?.cloud || currentUser?.isGuest) {
    wrap.innerHTML = `
      <div class="home-discord-inner">
        <div class="home-discord-icon" aria-hidden="true">💬</div>
        <div class="home-discord-body">
          <div class="home-discord-kicker">BOT DISCORD HUGOTASLOT</div>
          <div class="home-discord-title">Lie ton compte pour débloquer les commandes hunt</div>
          <div class="home-discord-cmds">${cmdHtml}</div>
        </div>
        <button type="button" class="home-discord-cta" onclick="showAuth()">CONNEXION CLOUD</button>
      </div>`;
    return;
  }
  wrap.innerHTML = `<div class="home-discord-inner home-discord-loading"><div class="bj-rec">Chargement liaison Discord…</div></div>`;
  await refreshDiscordLinkCache().catch(() => {});
  const linked = discordLinkCache.linked;
  const who = discordLinkCache.username ? ` (${discordLinkCache.username})` : '';
  wrap.innerHTML = `
    <div class="home-discord-inner${linked ? ' is-linked' : ''}">
      <div class="home-discord-icon" aria-hidden="true">${linked ? '✔' : '💬'}</div>
      <div class="home-discord-body">
        <div class="home-discord-kicker">BOT DISCORD HUGOTASLOT</div>
        <div class="home-discord-title">${linked ? `Compte lié${escapeHtml(who)} — commandes actives` : 'Lie ton Discord en 2 minutes'}</div>
        <div class="home-discord-cmds">${cmdHtml}</div>
        ${discordLinkCache.pendingCode ? `<div class="home-discord-pending">Code en attente : <strong>${escapeHtml(discordLinkCache.pendingCode)}</strong> → <code>/link ${escapeHtml(discordLinkCache.pendingCode)}</code></div>` : ''}
      </div>
      <button type="button" class="home-discord-cta" onclick="openDiscordLinkModal()">${linked ? 'GÉRER LA LIAISON' : 'LIER MON DISCORD'}</button>
    </div>`;
}

async function refreshDiscordLinkCache() {
  discordLinkCache = { linked: false, username: '', pendingCode: '', checked: true };
  if (!currentUser?.cloud || currentUser?.isGuest) return discordLinkCache;
  const c = getAuthClient();
  if (!c) return discordLinkCache;
  try {
    const { data, error } = await cloudCall('discord-link', () => c
      .from('discord_links')
      .select('discord_id,discord_username,code,expires_at')
      .eq('user_id', currentUser.id)
      .maybeSingle(), { retries: 1, timeoutMs: 8000, delayMs: 300, quiet: true });
    if (error && error.code !== 'PGRST116') throw error;
    if (data?.discord_id) {
      discordLinkCache.linked = true;
      discordLinkCache.username = data.discord_username || '';
    } else if (data?.code && data?.expires_at && new Date(data.expires_at).getTime() > Date.now()) {
      discordLinkCache.pendingCode = data.code;
    }
  } catch (_) {}
  return discordLinkCache;
}

function generateDiscordLinkRandomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = new Uint8Array(6);
  (window.crypto || window.msCrypto).getRandomValues(buf);
  for (let i = 0; i < 6; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

function openDiscordLinkModal() {
  const modal = document.getElementById('discord-link-modal');
  if (!modal) return;
  modal.classList.remove('hidden');
  loadDiscordLinkStatus().catch(() => {});
}

function closeDiscordLinkModal() {
  const modal = document.getElementById('discord-link-modal');
  if (modal) modal.classList.add('hidden');
}

async function loadDiscordLinkStatus() {
  const status = document.getElementById('discord-link-status');
  const body = document.getElementById('discord-link-body');
  const unlinkBtn = document.getElementById('discord-link-unlink');
  if (!status || !body) return;
  if (!currentUser?.cloud || currentUser?.isGuest) {
    status.innerHTML = `<span style="color:#ff9fb1;">Connecte-toi avec un compte cloud pour lier ton Discord.</span>`;
    body.innerHTML = '';
    if (unlinkBtn) unlinkBtn.style.display = 'none';
    return;
  }
  status.textContent = 'Chargement…';
  body.innerHTML = '';
  if (unlinkBtn) unlinkBtn.style.display = 'none';
  const c = getAuthClient();
  if (!c) { status.innerHTML = `<span style="color:#ff9fb1;">Supabase indisponible.</span>`; return; }
  try {
    const { data, error } = await cloudCall('discord-link', () => c
      .from('discord_links')
      .select('id,discord_id,discord_username,code,expires_at,linked_at')
      .eq('user_id', currentUser.id)
      .maybeSingle(), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true });
    if (error && error.code !== 'PGRST116') throw error;
    if (data?.discord_id) {
      status.innerHTML = `<span style="color:var(--green);">✔ Compte lié à <strong>${escapeHtml(data.discord_username || data.discord_id)}</strong>.</span>`;
      body.innerHTML = `<div class="bj-rec">Commandes liées : <code>/hunts</code>, <code>/leaderboard</code>, <code>/live slug</code> (hunt public). Pour tous : <code>/slot</code>, <code>/call</code>, <code>/lastvideo</code>, <code>/lastslot</code>.</div>`;
      discordLinkCache = { linked: true, username: data.discord_username || '', pendingCode: '', checked: true };
      if (unlinkBtn) unlinkBtn.style.display = 'inline-flex';
      if (typeof renderHomeDiscordBanner === 'function') renderHomeDiscordBanner();
      return;
    }
    if (data?.code && data?.expires_at && new Date(data.expires_at).getTime() > Date.now()) {
      const remainMin = Math.max(1, Math.round((new Date(data.expires_at).getTime() - Date.now()) / 60000));
      status.innerHTML = `<span style="color:var(--gold-dim);">Code en attente (${remainMin} min). Tape <code>/link CODE</code> sur Discord.</span>`;
      body.innerHTML = `
        <div class="discord-code-box">
          <span class="discord-code-value">${escapeHtml(data.code)}</span>
          <button class="profile-mini-btn" type="button" onclick="navigator.clipboard?.writeText('${escapeHtml(data.code)}').then(()=>showToast('Code copié','success'))">Copier</button>
        </div>
        <div class="bj-rec">Sur Discord : <code>/link code:${escapeHtml(data.code)}</code> — puis <code>/hunts</code>, <code>/leaderboard</code>, <code>/live slug</code>.</div>`;
      discordLinkCache = { linked: false, username: '', pendingCode: data.code, checked: true };
      if (typeof renderHomeDiscordBanner === 'function') renderHomeDiscordBanner();
      return;
    }
    status.innerHTML = `Aucune liaison active. Génère un code à utiliser sur Discord.`;
    body.innerHTML = `<div class="bj-rec">Après liaison : <code>/hunts</code>, <code>/leaderboard</code>, <code>/live slug</code> pour les hunts publics partagés.</div>`;
    discordLinkCache = { linked: false, username: '', pendingCode: '', checked: true };
    if (typeof renderHomeDiscordBanner === 'function') renderHomeDiscordBanner();
  } catch (e) {
    status.innerHTML = `<span style="color:#ff9fb1;">${escapeHtml(mapAuthError(e))}</span>`;
  }
}

async function generateDiscordLinkCode() {
  if (!currentUser?.cloud || currentUser?.isGuest) {
    showToast('Compte cloud requis', 'error');
    return;
  }
  const g = actionGuardAcquire('discord:link', { limit: 6, windowMs: 60_000, blockMs: 30_000 });
  if (g.blocked) { showToast(`Trop d’essais. Réessaie dans ${g.waitSec}s.`, 'error'); return; }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  const status = document.getElementById('discord-link-status');
  if (status) status.textContent = 'Génération…';
  const code = generateDiscordLinkRandomCode();
  const expires = new Date(Date.now() + 15 * 60 * 1000).toISOString();
  try {
    const existingRes = await cloudCall('discord-link', () => c
      .from('discord_links')
      .select('id,discord_id')
      .eq('user_id', currentUser.id)
      .maybeSingle(), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true });
    if (existingRes.error && existingRes.error.code !== 'PGRST116') throw existingRes.error;
    const row = existingRes.data;
    if (row?.discord_id) {
      if (status) status.innerHTML = `<span style="color:#ff9fb1;">Compte déjà lié. Délie-le avant de générer un nouveau code.</span>`;
      return;
    }
    if (row?.id) {
      const { error } = await cloudCall('discord-link', () => c
        .from('discord_links')
        .update({ code, expires_at: expires, linked_at: null, discord_username: null })
        .eq('id', row.id), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
      if (error) throw error;
    } else {
      const { error } = await cloudCall('discord-link', () => c
        .from('discord_links')
        .insert({
          user_id: currentUser.id,
          code,
          expires_at: expires,
          discord_id: null,
          discord_username: null,
          linked_at: null
        }), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
      if (error) throw error;
    }
    showToast('Code généré', 'success');
    await loadDiscordLinkStatus();
  } catch (e) {
    if (status) status.innerHTML = `<span style="color:#ff9fb1;">${escapeHtml(mapAuthError(e))}</span>`;
    showToast(mapAuthError(e), 'error');
  }
}

async function unlinkDiscordAccount() {
  if (!currentUser?.cloud || currentUser?.isGuest) return;
  if (!confirm('Délier ton compte Discord ? Tu pourras toujours en relier un autre ensuite.')) return;
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  try {
    const { error } = await cloudCall('discord-link', () => c
      .from('discord_links')
      .delete()
      .eq('user_id', currentUser.id), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true });
    if (error) throw error;
    showToast('Compte Discord délié', 'success');
    await loadDiscordLinkStatus();
  } catch (e) {
    showToast(mapAuthError(e), 'error');
  }
}

// ────────────────────────────────────────────────────────────

// ─── SYSTÈME DE COMPTES ───
const AUTH_KEY = 'hm_users_v1';
const SESSION_KEY = 'hm_session_v1';
const SESSION_META_KEY = 'hm_session_meta_v1';
const GUEST_PROFILE_KEY = 'hm_guest_profile_v1';
const BALANCE_SNAPSHOT_KEY = 'hm_balance_snapshot_v1';
const BALANCE_SNAPSHOT_BY_USER_KEY = 'hm_balance_snapshot_by_user_v1';
const PENDING_CLOUD_BALANCE_DELTA_KEY = 'hm_pending_cloud_balance_delta_v1';
if (!window.__hmStakePreview) window.__hmStakePreview = Object.create(null);
window.__hmGameBalAnchor = window.__hmGameBalAnchor ?? null;
const ADMIN_BOOTSTRAP_KEY = 'hm_admin_bootstrap_v1';
const UI_PREFS_KEY = 'hm_ui_prefs_v1';
// Aligné sur public.claim_daily_drop() (v_base = 25, +5 % / jour de streak, plafond +200 %).
const DAILY_DROP_BASE = 25;
const DAILY_STREAK_BONUS_PCT_PER_DAY = 5;
let claimDailyDropInFlight = false;
let currentUser = null;
let profileMenuIsOpen = false;
let profileMenuJustOpenedAt = 0;
const GUEST_USER = { username: 'Invité', email: '', balance: 100, isGuest: true };
let pendingAuthOpen = false;
const ONLINE_SUPABASE_URL = 'https://kkqskgxjyurtplbububc.supabase.co';
const ONLINE_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrcXNrZ3hqeXVydHBsYnVidWJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTA0MjcsImV4cCI6MjA5Mjg4NjQyN30.7f8Rub_5lO-yfZSbIUvtaUVZew_1XABwIvvU2yXmG5c';
const FORCED_ADMIN_IDS = new Set([
  '02b7e350-b802-4ddf-937f-a5172080c8fa',
  'c86cbb06-7765-4216-ad83-7e8e8eb0c3a9'
]);
let onlineCount = 1;
let onlineClient = null;
let onlineChannel = null;
let onlineBoundUnload = false;
let authClient = null;
let authReady = false;
const cloudDataCache = {
  profile: new Map(),
  admin: new Map()
};
const CACHE_TTL = {
  profile: 20000,
  adminUsers: 12000,
  adminHunts: 10000,
  adminLogs: 8000,
  adminFeedback: 6000
};
function getCacheEntry(bucket, key, ttlMs) {
  const m = cloudDataCache[bucket];
  if (!m) return null;
  const e = m.get(key);
  if (!e) return null;
  if (Date.now() - Number(e.ts || 0) > ttlMs) {
    m.delete(key);
    return null;
  }
  return e.value;
}
function setCacheEntry(bucket, key, value) {
  const m = cloudDataCache[bucket];
  if (!m) return;
  m.set(key, { ts: Date.now(), value });
}
function invalidateCache(bucket, keyPrefix = '') {
  const m = cloudDataCache[bucket];
  if (!m) return;
  if (!keyPrefix) { m.clear(); return; }
  for (const k of m.keys()) {
    if (String(k).startsWith(String(keyPrefix))) m.delete(k);
  }
}
// [admin] — extrait dans scripts/pages/admin.js (LAZY_PAGE_SCRIPTS)

// Legacy stub : les utilisateurs sont gérés exclusivement par Supabase.
// Ces fonctions ne persistent plus rien (cache mémoire éphémère pour ne pas casser le code legacy).
const __legacyUsersMemory = {};
function getUsers() { return __legacyUsersMemory; }
function saveUsers(_users) { /* no-op : tout va en Supabase */ }
function getSession() {
  try { return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null'); } catch { return null; }
}
function saveSession(user) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  const bal = Number(user?.balance);
  if (Number.isFinite(bal) && bal >= 0) {
    localStorage.setItem(BALANCE_SNAPSHOT_KEY, String(bal));
    saveBalanceSnapshotScoped(bal, {
      userId: user?.cloud ? String(user?.id || '') : '',
      isGuest: !!user?.isGuest || !user?.cloud
    });
  }
}
function clearSession() { localStorage.removeItem(SESSION_KEY); }
function getSessionMeta() {
  try { return JSON.parse(localStorage.getItem(SESSION_META_KEY) || '{}'); } catch { return {}; }
}
function saveSessionMeta(meta) {
  const cur = getSessionMeta();
  try { localStorage.setItem(SESSION_META_KEY, JSON.stringify({ ...cur, ...(meta || {}) })); } catch (_) {}
}
function getGuestProfile() {
  try { return JSON.parse(localStorage.getItem(GUEST_PROFILE_KEY) || '{}'); } catch { return {}; }
}
function saveGuestProfile(p) { localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(p || {})); }
function getBalanceSnapshotLegacy() {
  const n = Number(localStorage.getItem(BALANCE_SNAPSHOT_KEY));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function getPendingCloudBalanceDeltaBucket() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_CLOUD_BALANCE_DELTA_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (_) {
    return {};
  }
}
function getPendingCloudBalanceDelta(userId) {
  const n = Number(getPendingCloudBalanceDeltaBucket()[String(userId || '')] || 0);
  return Number.isFinite(n) ? n : 0;
}
function notePendingCloudBalanceDelta(userId, delta) {
  const uid = String(userId || '');
  if (!uid) return;
  const d = Number(delta || 0);
  if (!Number.isFinite(d) || Math.abs(d) < 0.0001) return;
  const bucket = getPendingCloudBalanceDeltaBucket();
  const next = Number(((Number(bucket[uid] || 0)) + d).toFixed(4));
  if (Math.abs(next) < 0.0001) delete bucket[uid];
  else bucket[uid] = next;
  try { localStorage.setItem(PENDING_CLOUD_BALANCE_DELTA_KEY, JSON.stringify(bucket)); } catch (_) {}
}
function clearPendingCloudBalanceDelta(userId) {
  const uid = String(userId || '');
  if (!uid) return;
  const bucket = getPendingCloudBalanceDeltaBucket();
  if (!Object.prototype.hasOwnProperty.call(bucket, uid)) return;
  delete bucket[uid];
  try { localStorage.setItem(PENDING_CLOUD_BALANCE_DELTA_KEY, JSON.stringify(bucket)); } catch (_) {}
}
function getBalanceSnapshotBucket() {
  try {
    const parsed = JSON.parse(localStorage.getItem(BALANCE_SNAPSHOT_BY_USER_KEY) || '{}');
    const cloud = parsed && typeof parsed.cloud === 'object' && parsed.cloud ? parsed.cloud : {};
    const guest = Number(parsed?.guest);
    return {
      cloud,
      guest: Number.isFinite(guest) && guest >= 0 ? guest : null
    };
  } catch (_) {
    return { cloud: {}, guest: null };
  }
}
function saveBalanceSnapshotBucket(bucket) {
  try { localStorage.setItem(BALANCE_SNAPSHOT_BY_USER_KEY, JSON.stringify(bucket || { cloud: {}, guest: null })); } catch (_) {}
}
function saveBalanceSnapshotScoped(balance, { userId = '', isGuest = false } = {}) {
  const n = Number(balance);
  if (!Number.isFinite(n) || n < 0) return;
  const bucket = getBalanceSnapshotBucket();
  if (userId) bucket.cloud[String(userId)] = n;
  if (isGuest) bucket.guest = n;
  saveBalanceSnapshotBucket(bucket);
}
function getBalanceSnapshot({ userId = '', isGuest = false } = {}) {
  const bucket = getBalanceSnapshotBucket();
  if (userId) {
    const n = Number(bucket.cloud[String(userId)]);
    if (Number.isFinite(n) && n >= 0) return n;
    // IMPORTANT : pas de repli sur le snapshot global pour un compte cloud
    // identifié. Le snapshot legacy est écrit pour le dernier compte actif et
    // contaminerait un autre compte (solde dupliqué / faux reset).
    return null;
  }
  if (isGuest) {
    const n = Number(bucket.guest);
    if (Number.isFinite(n) && n >= 0) return n;
    // Idem pour l'invité : ne pas hériter du solde d'un compte cloud précédent.
    return null;
  }
  return getBalanceSnapshotLegacy();
}
function shouldRejectSuspectServerBalance(serverBal, currentBal, userId = '') {
  const s = Number(serverBal);
  const c = Number(currentBal);
  if (!Number.isFinite(s)) return true;
  if (Math.abs(s - 100) > 0.0001) return false;
  const snap = getBalanceSnapshot({ userId: String(userId || '') });
  const currentFarFrom100 = Number.isFinite(c) && Math.abs(c - 100) > 0.0001;
  const snapFarFrom100 = snap !== null && Math.abs(Number(snap) - 100) > 0.0001;
  return currentFarFrom100 || snapFarFrom100;
}
function shouldRejectRollbackToGameAnchor(serverBal, currentBal) {
  if (!isCloudUser()) return false;
  const anchor = window.__hmGameBalAnchor;
  if (anchor === null || anchor === undefined) return false;
  const s = Number(serverBal);
  const c = Number(currentBal);
  const a = Number(anchor);
  if (!Number.isFinite(s) || !Number.isFinite(c) || !Number.isFinite(a)) return false;
  const isServerAtAnchor = Math.abs(s - a) < 0.0001;
  const currentIsNotAnchor = Math.abs(c - a) > 0.0001;
  return isServerAtAnchor && currentIsNotAnchor;
}
function getPersistedBalanceForUser(userId, { isGuest = false } = {}) {
  const uid = String(userId || '');
  const disk = getSession();
  if (uid && disk && String(disk.id) === uid) {
    const fromDisk = Number(disk.balance);
    if (Number.isFinite(fromDisk) && fromDisk >= 0) return fromDisk;
  }
  if (isGuest) {
    const gp = getGuestProfile();
    const fromGuest = Number(gp.balance);
    if (Number.isFinite(fromGuest) && fromGuest >= 0) return fromGuest;
  }
  const snap = getBalanceSnapshot({ userId: uid, isGuest });
  if (snap !== null) return snap;
  return null;
}
function resolveCloudBalanceMerge(currentBal, serverBal, userId = '') {
  const persisted = userId ? getPersistedBalanceForUser(userId) : null;
  let local = Math.max(
    Number.isFinite(Number(currentBal)) ? Number(currentBal) : 0,
    persisted !== null && Number.isFinite(Number(persisted)) ? Number(persisted) : 0
  );
  const s = Number(serverBal || 0);
  const pending = userId ? getPendingCloudBalanceDelta(userId) : 0;
  if (!Number.isFinite(s)) return Number.isFinite(local) ? local : 0;
  if (!Number.isFinite(local)) return s;
  if (Math.abs(pending) > 0.005) {
    const reconstructed = Math.max(0, Number((s + pending).toFixed(4)));
    if (Math.abs(local - s) < 0.005 && Math.abs(reconstructed - local) > 0.005) {
      local = reconstructed;
    }
  }
  if (Math.abs(local - s) < 0.005) return s;
  // Serveur en retard : ne pas écraser les gains affichés localement.
  if (s + 0.005 < local) {
    if (
      cloudQueuedGameSessions > 0 ||
      cloudGameSettlementInFlight > 0 ||
      hasPendingStakePreviews() ||
      (window.__hmGameBalAnchor !== null && window.__hmGameBalAnchor !== undefined)
    ) {
      return local;
    }
    pushRuntimeLog('warn', `cloud_balance_keep_local: server=${s.toFixed(2)} local=${local.toFixed(2)}`);
    return local;
  }
  // Serveur en avance : pertes locales / refresh avant synchro SQL — ne pas remonter le solde.
  if (local + 0.005 < s && Math.abs(pending) > 0.005) {
    pushRuntimeLog('warn', `cloud_balance_keep_local_pending: server=${s.toFixed(2)} local=${local.toFixed(2)} pending=${pending.toFixed(2)}`);
    return local;
  }
  return s;
}
function getUiPrefs() {
  try { return JSON.parse(localStorage.getItem(UI_PREFS_KEY) || '{}'); } catch { return {}; }
}
function saveUiPrefs(p) {
  const current = getUiPrefs();
  localStorage.setItem(UI_PREFS_KEY, JSON.stringify({ ...current, ...p }));
}
function getSafeGuestBalance(rawBalance) {
  const n = Number(rawBalance);
  if (Number.isFinite(n) && n >= 0) return n;
  const snap = getBalanceSnapshot({ isGuest: true });
  if (snap !== null) return snap;
  return Number(GUEST_USER.balance || 100);
}
function applyUiPrefs() {
  const p = getUiPrefs();
  const scale = p.uiScale === 'large' ? 1.08 : p.uiScale === 'compact' ? 0.94 : 1;
  document.documentElement.style.fontSize = `${16 * scale}px`;
}
function getAuthClient() {
  if (!window.supabase || !window.supabase.createClient) return null;
  if (!authClient) authClient = window.supabase.createClient(ONLINE_SUPABASE_URL, ONLINE_SUPABASE_ANON);
  return authClient;
}
function usernameToEmail(u) {
  const v = String(u || '').trim().toLowerCase();
  if (!v) return '';
  if (v.includes('@')) return v;
  return `${v.replace(/[^a-z0-9._-]/g, '')}@player.local`;
}
function mapAuthError(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  if (msg.includes('email rate limit exceeded')) return 'Limite email atteinte. Attends 1 minute puis réessaie.';
  if (msg.includes('for security purposes')) return 'Trop de tentatives. Attends un peu puis réessaie.';
  if (msg.includes('email not confirmed')) return 'La confirmation email est active côté Supabase. Désactive-la dans Providers > Email.';
  if (msg.includes('invalid login credentials')) return 'Identifiant ou mot de passe incorrect.';
  if (msg.includes('user already registered')) return 'Compte déjà existant. Essaie de te connecter.';
  if (msg.includes('password')) return 'Mot de passe trop faible (minimum 6 caractères).';
  if (msg.includes('profile_not_found')) return 'Profil utilisateur introuvable. Rafraîchis le panneau admin puis réessaie.';
  return err?.message || 'Erreur d’authentification.';
}
/** Après RPC (ex. admin_set_role), réinjecte le profil serveur dans la session si c’est le compte courant. */
function mergeCloudProfileIntoCurrentUserIfSame(fresh) {
  if (!fresh || !currentUser?.cloud || String(currentUser.id) !== String(fresh.id)) return false;
  Object.assign(currentUser, fresh);
  saveSession(currentUser);
  updateLobbyBalance();
  updateAdminTabVisibility();
  renderProfileBadge();
  return true;
}
async function loadCloudProfile(userId, { force = false } = {}) {
  const c = getAuthClient();
  if (!c || !userId) return null;
  const cacheKey = String(userId);
  if (!force) {
    const cached = getCacheEntry('profile', cacheKey, CACHE_TTL.profile);
    if (cached) return { ...cached };
  }
  const [{ data: p }, { data: b }, sessionRes] = await Promise.all([
    cloudCall('profile', () => c.from('profiles').select('id,username,display_name,avatar_url,role,status,email,daily_streak,last_claim_day,last_claim_at').eq('id', userId).single(), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true }),
    cloudCall('profile', () => c.from('balances').select('amount').eq('user_id', userId).single(), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true }),
    cloudCall('auth', () => c.auth.getSession(), { retries: 0, timeoutMs: 8000, quiet: true, fallback: async () => ({ data: { session: null } }) })
  ]);
  const su = sessionRes?.data?.session?.user && String(sessionRes.data.session.user.id || '') === String(userId)
    ? sessionRes.data.session.user
    : null;
  const metaUsername = String(su?.user_metadata?.username || su?.user_metadata?.display_name || '').trim();
  const profileUsername = String(p?.username || '').trim();
  const usernameResolved = (profileUsername && profileUsername.toLowerCase() !== 'player')
    ? profileUsername
    : (metaUsername || (p?.email ? String(p.email).split('@')[0] : 'player'));
  const profileDisplay = String(p?.display_name || '').trim();
  const displayResolved = profileDisplay || usernameResolved || 'Player';
  const roleResolved = String(p?.role || 'player').trim().toLowerCase();
  const statusResolved = String(p?.status || 'active').trim().toLowerCase();
  const forcedAdmin = FORCED_ADMIN_IDS.has(String(userId || '').toLowerCase());
  const persistedLocal = getPersistedBalanceForUser(userId);
  const localSeed = String(currentUser?.id || '') === String(userId)
    ? Number(currentUser?.balance || 0)
    : (persistedLocal !== null ? persistedLocal : Number(b?.amount || 0));
  const next = {
    id: userId,
    username: usernameResolved,
    email: p?.email || '',
    displayName: displayResolved,
    avatar: p?.avatar_url || '',
    role: forcedAdmin ? 'admin' : roleResolved,
    status: statusResolved,
    balance: resolveCloudBalanceMerge(
      localSeed,
      Number(b?.amount || 0),
      userId
    ),
    streak: Number(p?.daily_streak || 0),
    lastClaimDay: (p?.last_claim_day === null || p?.last_claim_day === undefined) ? null : Number(p.last_claim_day),
    lastClaimAt: p?.last_claim_at || null,
    isGuest: false,
    cloud: true
  };
  const snapBal = getBalanceSnapshot({ userId: String(userId || '') });
  const persistedBal = getPersistedBalanceForUser(userId);
  if (
    shouldRejectSuspectServerBalance(next.balance, persistedBal ?? currentUser?.balance, userId) ||
    shouldRejectRollbackToGameAnchor(next.balance, persistedBal ?? currentUser?.balance)
  ) {
    if (snapBal !== null && Number.isFinite(Number(snapBal))) {
      pushRuntimeLog('warn', `cloud_profile_balance_suspect_reset_100: server=${Number(next.balance || 0).toFixed(2)} snap=${Number(snapBal).toFixed(2)}`);
      next.balance = Number(snapBal);
    } else if (persistedBal !== null) {
      next.balance = Number(persistedBal);
    }
  }
  setCacheEntry('profile', cacheKey, next);
  return { ...next };
}
function isCurrentUserAdmin() {
  if (!currentUser || currentUser.isGuest) return false;
  if (FORCED_ADMIN_IDS.has(String(currentUser.id || '').toLowerCase())) return true;
  if (currentUser.cloud) {
    const role = String(currentUser.role || '').trim().toLowerCase();
    const status = String(currentUser.status || 'active').trim().toLowerCase();
    return role === 'admin' && status === 'active';
  }
  const users = getUsers();
  const rec = users[currentUser.username];
  return !!(rec && rec.isAdmin);
}
function updateAdminTabVisibility() {
  const visible = isCurrentUserAdmin();
  const tab = document.getElementById('sidebar-tab-admin');
  if (tab) tab.style.display = visible ? 'flex' : 'none';
  const homeBtn = document.getElementById('home-admin-btn');
  if (homeBtn) homeBtn.style.display = visible ? '' : 'none';
}
function ensureAdminBootstrap() {
  // Désactivé : le rôle admin est géré exclusivement côté Supabase
  // (colonne profiles.role + RPC admin_set_role).
}
const getDayIndex = () => Math.floor(Date.now() / 86400000);
const dayDiff = (a, b) => Number(a) - Number(b);
function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
// Filtre un URL pour s'assurer qu'il n'est ni `javascript:` ni `data:text/html` (vecteur XSS).
function isSafeUrl(u) {
  if (!u) return false;
  const s = String(u).trim();
  if (!s) return false;
  if (/^https?:\/\//i.test(s)) return true;
  if (s.startsWith('/') || s.startsWith('./') || s.startsWith('../')) return true;
  if (/^data:image\/(png|jpe?g|gif|webp|svg\+xml);/i.test(s)) return true;
  return false;
}
function normalizeSlotImageUrl(raw) {
  let s = String(raw || '').trim();
  if (!s) return '';
  s = s.replace(/\\/g, '/');
  if (s.startsWith('//')) s = `https:${s}`;
  else if (!/^(https?:\/\/|data:image\/|\/|\.\/|\.\.\/)/i.test(s) && /^[a-z0-9.-]+\.[a-z]{2,}/i.test(s)) s = `https://${s}`;
  return s;
}
function resolveBonusImageUrl(bonus) {
  const direct = normalizeSlotImageUrl(bonus?.slotImage || bonus?.slot_image || bonus?.image || '');
  if (direct && isSafeUrl(direct)) return direct;
  if (!Array.isArray(state.slots) || !state.slots.length) return '';
  const cat = findCatalogSlotForBonus(bonus);
  if (cat) {
    const fromCat = normalizeSlotImageUrl(cat.image || cat.img || cat.thumbnail || '');
    if (fromCat && isSafeUrl(fromCat)) return fromCat;
  }
  return '';
}
function getDisplayName() {
  if (!currentUser) return 'Invité';
  return currentUser.displayName || currentUser.username || 'Invité';
}
function getAvatarUrl() {
  if (!currentUser) return '';
  return currentUser.avatar || '';
}
function getOnlinePresenceKey() {
  if (currentUser && !currentUser.isGuest) return `user:${currentUser.username || 'player'}`;
  const existing = sessionStorage.getItem('hm_guest_presence_key');
  if (existing) return existing;
  const next = `guest:${Math.random().toString(36).slice(2, 10)}`;
  sessionStorage.setItem('hm_guest_presence_key', next);
  return next;
}
function updateOnlineCountUI() {
  const el = document.getElementById('online-users-count');
  if (el) el.textContent = String(Math.max(1, onlineCount));
  const homeOnline = document.getElementById('home-kpi-online');
  if (homeOnline) homeOnline.textContent = String(Math.max(1, onlineCount));
}
function stopOnlinePresence() {
  if (onlineChannel) {
    try { onlineChannel.untrack(); } catch (_) {}
    try { onlineClient?.removeChannel(onlineChannel); } catch (_) {}
  }
  onlineChannel = null;
}
function startOnlinePresence() {
  try {
    if (!window.supabase || !window.supabase.createClient) return;
    if (!onlineClient) onlineClient = window.supabase.createClient(ONLINE_SUPABASE_URL, ONLINE_SUPABASE_ANON);
    stopOnlinePresence();
    const presenceKey = getOnlinePresenceKey();
    onlineChannel = onlineClient.channel('hugotaslot-online', { config: { presence: { key: presenceKey } } });
    onlineChannel.on('presence', { event: 'sync' }, () => {
      const state = onlineChannel.presenceState();
      let total = 0;
      Object.values(state).forEach((arr) => { total += Array.isArray(arr) ? arr.length : 1; });
      onlineCount = Math.max(1, total);
      updateOnlineCountUI();
    });
    onlineChannel.subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onlineChannel.track({
          name: getDisplayName(),
          user: currentUser?.username || 'guest',
          at: Date.now()
        }).catch(() => {});
      }
    });
    if (!onlineBoundUnload) {
      window.addEventListener('beforeunload', () => {
        try { onlineChannel?.untrack(); } catch (_) {}
      });
      onlineBoundUnload = true;
    }
    setTimeout(updateOnlineCountUI, 350);
  } catch (_) {}
}
function buildAvatarMarkup(sizeClass = 'profile-avatar') {
  const avatar = getAvatarUrl();
  const display = getDisplayName();
  if (avatar && isSafeUrl(avatar)) {
    return `<div class="${escapeHtml(sizeClass)}"><img src="${escapeHtml(avatar)}" alt="avatar"></div>`;
  }
  return `<div class="${escapeHtml(sizeClass)}">${escapeHtml(display.charAt(0).toUpperCase())}</div>`;
}
function updateCurrentProfile({ displayName, avatar }) {
  if (!currentUser) return;
  const lockedPseudo = String(currentUser.username || 'Invité').trim() || 'Invité';
  const nextName = lockedPseudo;
  const nextAvatar = String(avatar || '').trim();
  if (currentUser.isGuest) {
    currentUser.displayName = nextName;
    currentUser.avatar = nextAvatar;
    saveGuestProfile({ displayName: nextName, avatar: nextAvatar, balance: getSafeGuestBalance(currentUser.balance) });
    renderProfileBadge();
    return;
  }
  const users = getUsers();
  const rec = users[currentUser.username];
  if (rec) {
    rec.displayName = nextName;
    rec.avatar = nextAvatar;
    saveUsers(users);
  }
  currentUser.displayName = nextName;
  currentUser.avatar = nextAvatar;
  saveSession(currentUser);
  if (currentUser.cloud) {
    const c = getAuthClient();
    if (c && currentUser.id) {
      c.from('profiles')
        .update({ display_name: nextName, avatar_url: nextAvatar })
        .eq('id', currentUser.id)
        .then(() => {})
        .catch(() => showToast('Profil cloud non synchronisé', 'error', 1800));
    }
  }
  renderProfileBadge();
}
function describeCloudError(err) {
  if (!err) return 'erreur inconnue';
  if (typeof err === 'string') return err.trim() || 'erreur inconnue';
  const parts = [
    err.message,
    err.details,
    err.hint,
    err.code ? `code ${err.code}` : '',
    err.httpStatus ? `HTTP ${err.httpStatus}` : ''
  ].map((x) => String(x || '').trim()).filter(Boolean);
  if (parts.length) return parts.join(' · ');
  try { return JSON.stringify(err).slice(0, 140); } catch (_) { return String(err); }
}
/** Appel RPC Supabase via fetch + JWT session (contourne circuit breaker / cache client). */
async function supabaseRpc(name, params = {}) {
  const supa = getAuthClient();
  if (!supa) throw new Error('cloud_client_unavailable');
  const { data: { session }, error: sessErr } = await supa.auth.getSession();
  if (sessErr) throw sessErr;
  if (!session?.access_token) throw new Error('auth required');
  const res = await fetch(`${ONLINE_SUPABASE_URL}/rest/v1/rpc/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: {
      apikey: ONLINE_SUPABASE_ANON,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json'
    },
    body: JSON.stringify(params || {})
  });
  const bodyText = await res.text();
  let payload = null;
  if (bodyText) {
    try { payload = JSON.parse(bodyText); } catch { payload = { raw: bodyText }; }
  }
  if (!res.ok) {
    const err = new Error(String(payload?.message || payload?.error || bodyText || `HTTP ${res.status}`));
    err.code = payload?.code || String(res.status);
    err.details = payload?.details || '';
    err.hint = payload?.hint || '';
    err.httpStatus = res.status;
    throw err;
  }
  return payload;
}
function reparentProfileMenuHome() {
  const menu = document.getElementById('profile-menu');
  const wrap = document.getElementById('profile-wrap');
  if (menu && wrap && menu.parentElement !== wrap) wrap.appendChild(menu);
}
function attachProfileMenuToBody() {
  const menu = document.getElementById('profile-menu');
  if (!menu || menu.classList.contains('hidden') || menu.parentElement === document.body) return;
  document.body.appendChild(menu);
}

function positionProfileMenu() {
  const menu = document.getElementById('profile-menu');
  const anchor = document.querySelector('#profile-wrap .profile-badge');
  if (!menu || !anchor || menu.classList.contains('hidden')) return;
  attachProfileMenuToBody();
  const rect = anchor.getBoundingClientRect();
  const width = Math.min(360, Math.max(280, window.innerWidth - 16));
  const maxH = Math.min(window.innerHeight * 0.85, window.innerHeight - rect.bottom - 16);
  menu.style.top = `${Math.max(8, Math.round(rect.bottom + 8))}px`;
  menu.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
  menu.style.left = 'auto';
  menu.style.width = `${width}px`;
  menu.style.maxHeight = `${Math.max(200, maxH)}px`;
}

function toggleProfileMenu(e) {
  if (e) e.stopPropagation();
  const menu = document.getElementById('profile-menu');
  if (!menu) return;
  if (profileMenuIsOpen) {
    closeProfileMenu();
    return;
  }
  profileMenuIsOpen = true;
  menu.classList.remove('hidden');
  profileMenuJustOpenedAt = Date.now();
  requestAnimationFrame(() => {
    positionProfileMenu();
    requestAnimationFrame(positionProfileMenu);
  });
  if (isCloudUser() && currentUser?.id) {
    loadCloudProfile(currentUser.id, { force: true })
      .then((fresh) => {
        if (!fresh || !currentUser || currentUser.id !== fresh.id) return;
        currentUser = { ...currentUser, ...fresh };
        saveSession(currentUser);
        updateAdminTabVisibility();
        renderProfileBadge({ preserveMenu: true });
        updateLobbyBalance();
      })
      .catch(() => {});
  }
  if (typeof renderProfileTournoiSubmissions === 'function') renderProfileTournoiSubmissions();
}
function closeProfileMenu() {
  profileMenuIsOpen = false;
  const menu = document.getElementById('profile-menu');
  if (menu) menu.classList.add('hidden');
  reparentProfileMenuHome();
}
function applyProfileSettings() {
  const avatarEl = document.getElementById('profile-avatar-url');
  if (!avatarEl) return;
  updateCurrentProfile({ displayName: currentUser?.username || 'Invité', avatar: avatarEl.value });
  showToast('Profil mis à jour', 'success', 1800);
}
function saveProfilePreferences() {
  const scaleEl = document.getElementById('profile-ui-scale');
  const soundEl = document.getElementById('profile-ui-sound');
  const muteEl = document.getElementById('profile-ui-mute');
  const volEl = document.getElementById('profile-ui-volume');
  const gameVolEl = document.getElementById('profile-game-volume');
  const casinoEl = document.getElementById('profile-default-casino');
  const uiScale = scaleEl ? scaleEl.value : 'normal';
  const uiSound = !!(soundEl && soundEl.checked);
  const uiMuted = !!(muteEl && muteEl.checked);
  const uiVolume = Math.max(0, Math.min(100, Number(volEl ? volEl.value : 70)));
  const uiGameVolume = Math.max(0, Math.min(100, Number(gameVolEl ? gameVolEl.value : 85)));
  const defaultCasino = getCasinoKey(casinoEl ? casinoEl.value : 'gamdom');
  saveUiPrefs({ uiScale, uiSound, uiMuted, uiVolume, uiGameVolume, defaultCasino });
  applyUiPrefs();
  showToast('Préférences sauvegardées', 'success', 1800);
}
function resetProfileAvatar() {
  const nameEl = document.getElementById('profile-display-name');
  updateCurrentProfile({ displayName: nameEl ? nameEl.value : getDisplayName(), avatar: '' });
  const avatarEl = document.getElementById('profile-avatar-url');
  if (avatarEl) avatarEl.value = '';
  showToast('Avatar réinitialisé', 'info', 1800);
}
function normalizeAvatarMime(file) {
  let mime = String(file?.type || '').trim().toLowerCase();
  if (mime === 'image/jpg' || mime === 'image/pjpeg') mime = 'image/jpeg';
  if (!mime && file?.name) {
    const ext = String(file.name.split('.').pop() || '').toLowerCase();
    if (ext === 'png') mime = 'image/png';
    else if (ext === 'jpg' || ext === 'jpeg') mime = 'image/jpeg';
    else if (ext === 'webp') mime = 'image/webp';
    else if (ext === 'gif') mime = 'image/gif';
  }
  return mime;
}
async function onProfileAvatarUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) {
    showToast('Image trop lourde (max 2 Mo)', 'error', 2400);
    return;
  }
  const mimeNorm = normalizeAvatarMime(file);
  if (!/^image\/(png|jpeg|webp|gif)$/.test(mimeNorm)) {
    showToast('Format non supporté (PNG, JPG, WebP, GIF)', 'error', 2400);
    return;
  }

  const nameEl = document.getElementById('profile-display-name');
  const displayName = nameEl ? nameEl.value : getDisplayName();

  if (isCloudUser()) {
    const supa = getAuthClient();
    if (!supa) { showToast('Connexion Supabase indisponible', 'error', 2200); return; }
    const ext = (file.name.split('.').pop() || 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
    const path = `${currentUser.id}/avatar-${Date.now()}.${ext}`;
    try {
      await cloudCall('profile', () => supa.auth.getSession(), { retries: 0, timeoutMs: 8000, quiet: true });
      showToast('Upload de l’avatar…', 'info', 1400);
      const { error: upErr } = await cloudCall('profile', () => supa.storage.from('avatars').upload(path, file, {
        cacheControl: '3600',
        upsert: false,
        contentType: mimeNorm
      }), { retries: 1, timeoutMs: 25000, delayMs: 400, quiet: true });
      if (upErr) {
        const hint = String(upErr.message || upErr).slice(0, 160);
        console.error('[avatar upload]', upErr);
        showToast(`Échec upload : ${hint}`, 'error', 3800);
        return;
      }
      const { data: pub } = supa.storage.from('avatars').getPublicUrl(path);
      const url = pub?.publicUrl || '';
      updateCurrentProfile({ displayName, avatar: url });
      const avatarEl = document.getElementById('profile-avatar-url');
      if (avatarEl) avatarEl.value = url;
      showToast('Photo de profil mise à jour', 'success', 1800);
    } catch (e) {
      console.error('[avatar upload]', e);
      const hint = String(e?.message || e?.details || e || '').slice(0, 160);
      showToast(hint ? `Échec : ${hint}` : 'Échec de l’upload (bucket avatars / réseau)', 'error', 3800);
    }
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    updateCurrentProfile({ displayName, avatar: String(reader.result || '') });
    const avatarEl = document.getElementById('profile-avatar-url');
    if (avatarEl) avatarEl.value = String(reader.result || '');
    showToast('Photo de profil mise à jour', 'success', 1800);
  };
  reader.readAsDataURL(file);
}
function getDailyState() {
  if (!currentUser) return { canClaim: false, streak: 0, nextStreak: 1, reward: DAILY_DROP_BASE, lastClaimDay: null };
  const today = getDayIndex();
  const isGuest = !!currentUser.isGuest;
  const isCloud = !!currentUser.cloud;
  let lastClaimDay = null;
  let streak = 0;
  if (isCloud) {
    lastClaimDay = currentUser.lastClaimDay ?? null;
    streak = Number(currentUser.streak || 0);
  } else if (isGuest) {
    const gp = getGuestProfile();
    lastClaimDay = gp.lastClaimDay ?? null;
    streak = Number(gp.streak || 0);
  } else {
    const users = getUsers();
    const rec = users[currentUser.username] || {};
    lastClaimDay = rec.lastClaimDay ?? null;
    streak = Number(rec.streak || 0);
  }

  let nextStreak = 1;
  if (lastClaimDay !== null) {
    const diff = dayDiff(today, lastClaimDay);
    if (diff === 0) nextStreak = streak || 1;
    else if (diff === 1) nextStreak = (streak || 0) + 1;
    else nextStreak = 1;
  }
  const streakBonusPct = Math.min(200, Math.max(0, (nextStreak - 1) * DAILY_STREAK_BONUS_PCT_PER_DAY));
  const streakReward = Number((DAILY_DROP_BASE * (1 + streakBonusPct / 100)).toFixed(2));
  const rankInfo = getDailyRankDropInfo();
  const reward = Number((streakReward * rankInfo.factor).toFixed(2));
  return {
    canClaim: lastClaimDay === null || dayDiff(today, lastClaimDay) >= 1,
    streak,
    nextStreak,
    streakReward,
    rankLabel: rankInfo.rankLabel,
    rankFactor: rankInfo.factor,
    reward,
    lastClaimDay
  };
}
// Détecte une RPC absente ou une signature non déployée (PostgREST PGRST202),
// pour basculer proprement sur l'ancienne signature sans casser le claim.
function isMissingRpcSignature(err) {
  const code = String(err?.code || '').toUpperCase();
  const msg = String(err?.message || err?.details || err?.hint || err || '').toLowerCase();
  return code === 'PGRST202'
    || msg.includes('could not find the function')
    || msg.includes('schema cache')
    || (msg.includes('function') && msg.includes('does not exist'));
}
function parseDailyDropRpcRow(raw) {
  const row = Array.isArray(raw) ? raw[0] : raw;
  if (!row || typeof row !== 'object') return null;
  const awarded = row.awarded ?? row.Awarded;
  const newBalance = row.new_balance ?? row.newBalance ?? row.new_bal;
  if (awarded === undefined && newBalance === undefined) return null;
  return {
    awarded: Number(awarded ?? 0),
    newBalance: Number(newBalance),
    streak: Number(row.streak ?? 1),
    claimDay: Number(row.next_claim_day ?? row.nextClaimDay ?? getDayIndex())
  };
}
async function reconcileDailyDropFromCloud() {
  if (!isCloudUser() || !currentUser?.id) return false;
  try {
    const fresh = await loadCloudProfile(currentUser.id, { force: true });
    if (!fresh || String(fresh.id) !== String(currentUser.id)) return false;
    const today = getDayIndex();
    const claimedToday = fresh.lastClaimDay !== null && fresh.lastClaimDay !== undefined
      && dayDiff(today, fresh.lastClaimDay) === 0;
    if (!claimedToday) return false;
    currentUser.streak = Number(fresh.streak || 0);
    currentUser.lastClaimDay = fresh.lastClaimDay ?? null;
    currentUser.lastClaimAt = fresh.lastClaimAt || currentUser.lastClaimAt;
    if (Number.isFinite(Number(fresh.balance))) currentUser.balance = Number(fresh.balance);
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge({ preserveMenu: true });
    return true;
  } catch (_) {
    return false;
  }
}
async function invokeClaimDailyDropRpc(safeFactor) {
  markCircuitSuccess('sync');
  let data;
  let appliedFactorServerSide = true;
  try {
    data = await supabaseRpc('claim_daily_drop', { p_factor: safeFactor });
  } catch (e) {
    if (!isMissingRpcSignature(e)) throw e;
    data = await supabaseRpc('claim_daily_drop', {});
    appliedFactorServerSide = false;
  }
  return { data, appliedFactorServerSide };
}
async function claimDailyDrop() {
  if (!currentUser) return;
  if (claimDailyDropInFlight) return;
  const st = getDailyState();
  if (!st.canClaim) {
    showToast('Drop déjà récupéré aujourd’hui', 'info', 1800);
    return;
  }
  const today = getDayIndex();

  let supaCloud = null;
  if (isCloudUser()) {
    supaCloud = getAuthClient();
    if (!supaCloud) {
      showToast('Connexion Supabase indisponible', 'error', 2200);
      return;
    }
    try {
      const { data: sessData } = await supaCloud.auth.getSession();
      if (!sessData?.session) {
        showToast('Session expirée. Reconnecte-toi pour récupérer le drop.', 'error', 2600);
        return;
      }
      await supaCloud.auth.refreshSession().catch(() => {});
    } catch (_) {}
  }

  claimDailyDropInFlight = true;
  try {
    if (isCloudUser()) {
      const rankInfo = getDailyRankDropInfo();
      const factor = Number(rankInfo.factor || 1);
      const safeFactor = Number.isFinite(factor) && factor > 0 ? factor : 1;

      const { data, appliedFactorServerSide } = await invokeClaimDailyDropRpc(safeFactor);

      let parsed = parseDailyDropRpcRow(data);
      if (!parsed || !Number.isFinite(parsed.newBalance)) {
        const reconciled = await reconcileDailyDropFromCloud();
        if (reconciled) {
          showToast('Drop déjà récupéré aujourd’hui', 'info', 2000);
          return;
        }
        throw new Error(parsed ? 'claim_daily_drop_invalid_balance' : 'claim_daily_drop_empty');
      }

      const { awarded, newBalance, streak, claimDay } = parsed;
      // Le serveur fait foi : on s'aligne immédiatement et on persiste avant
      // tout autre appel pour ne jamais perdre le crédit en cas d'interruption.
      currentUser.balance = newBalance;
      currentUser.streak = streak;
      currentUser.lastClaimDay = claimDay;
      currentUser.lastClaimAt = new Date().toISOString();
      clearPendingCloudBalanceDelta(currentUser.id);
      saveSession(currentUser);

      // Ajustement de rang uniquement si le serveur n'a pas pu l'appliquer
      // (fallback ancienne RPC). Une éventuelle erreur ici n'annule pas le drop.
      if (!appliedFactorServerSide) {
        const adjust = Number((st.reward - awarded).toFixed(2));
        if (Math.abs(adjust) >= 0.01) {
          const adjustedBal = await applyBalanceDeltaCloud(adjust, `daily_rank_adjust_${st.rankLabel}`);
          if (Number.isFinite(Number(adjustedBal))) currentUser.balance = Number(adjustedBal);
          saveSession(currentUser);
        }
      }
      updateLobbyBalance();
      renderProfileBadge({ preserveMenu: true });
      const shownAward = appliedFactorServerSide ? awarded : st.reward;
      showToast(`Drop récupéré: +${fmt(shownAward)} (${st.rankLabel})`, 'success', 2600);
      return;
    }

    setUserBalance(getUserBalance() + st.reward);
    if (currentUser.isGuest) {
      const gp = getGuestProfile();
      gp.lastClaimDay = today;
      gp.streak = st.nextStreak;
      gp.balance = getUserBalance();
      gp.displayName = currentUser.displayName || GUEST_USER.username;
      gp.avatar = currentUser.avatar || '';
      saveGuestProfile(gp);
      saveSession(currentUser);
    } else {
      const users = getUsers();
      if (users[currentUser.username]) {
        users[currentUser.username].lastClaimDay = today;
        users[currentUser.username].streak = st.nextStreak;
        saveUsers(users);
      }
      currentUser.lastClaimDay = today;
      currentUser.streak = st.nextStreak;
      saveSession(currentUser);
    }
    updateLobbyBalance();
    renderProfileBadge();
    showToast(`Drop récupéré: +${fmt(st.reward)} (streak ${st.nextStreak})`, 'success', 2600);
  } catch (e) {
    if (isCloudUser()) {
      const detail = describeCloudError(e);
      const msg = detail.toLowerCase();
      if (msg.includes('already_claimed') || msg.includes('balance_update_failed') || msg.includes('claim_daily_drop_empty') || msg.includes('claim_daily_drop_invalid_balance')) {
        const reconciled = await reconcileDailyDropFromCloud();
        if (reconciled) {
          showToast('Drop déjà récupéré aujourd’hui', 'info', 2000);
          return;
        }
      }
      if (msg.includes('already_claimed')) {
        showToast('Drop déjà récupéré aujourd’hui', 'info', 2000);
      } else if (msg.includes('auth required')) {
        showToast('Session expirée. Reconnecte-toi pour récupérer le drop.', 'error', 2600);
      } else if (msg.includes('profile_not_found')) {
        showToast('Profil introuvable. Déconnecte-toi puis reconnecte-toi.', 'error', 2800);
      } else if (isMissingRpcSignature(e)) {
        showToast('RPC drop non disponible — exécute la migration SQL puis réessaie.', 'error', 3200);
      } else if (msg.includes('circuit') || msg.includes('offline') || msg.includes('timeout') || msg.includes('failed to fetch')) {
        showToast('Connexion cloud instable. Réessaie dans quelques secondes.', 'error', 2800);
      } else {
        console.error('[claim_daily_drop]', e);
        pushRuntimeLog('error', `daily_drop_err: ${detail.slice(0, 180)}`);
        showToast(`Drop impossible : ${detail.slice(0, 120)}`, 'error', 3600);
      }
    } else {
      console.error('[claim_daily_drop_local]', e);
    }
  } finally {
    claimDailyDropInFlight = false;
  }
}

async function initAuth() {
  const diskSession = getSession();
  currentUser = null;
  const c = getAuthClient();
  if (c) {
    try {
      const { data } = await c.auth.getSession();
      const uid = data?.session?.user?.id;
      if (uid) {
        const persistedBal = getPersistedBalanceForUser(uid);
        if (diskSession && String(diskSession.id) === String(uid)) {
          currentUser = {
            ...diskSession,
            cloud: true,
            isGuest: false,
            balance: persistedBal !== null ? persistedBal : Number(diskSession.balance || 0)
          };
        } else if (persistedBal !== null) {
          currentUser = {
            id: uid,
            cloud: true,
            isGuest: false,
            balance: persistedBal,
            username: diskSession?.username || 'player',
            displayName: diskSession?.displayName || 'Joueur',
            avatar: diskSession?.avatar || '',
            role: diskSession?.role || 'player',
            status: diskSession?.status || 'active',
            email: diskSession?.email || ''
          };
        }
        const profile = await loadCloudProfile(uid, { force: true });
        if (profile) {
          currentUser = { ...(currentUser || {}), ...profile };
          saveSession(currentUser);
          saveSessionMeta({ startedAt: Date.now(), mode: 'cloud' });
          authReady = true;
          reconcileCloudBalanceAfterAuth().catch(() => {});
        }
      }
    } catch (_) {}
  }
  if (!currentUser && diskSession?.cloud) {
    const persistedBal = getPersistedBalanceForUser(diskSession.id);
    currentUser = {
      ...diskSession,
      balance: persistedBal !== null ? persistedBal : Number(diskSession.balance || 0)
    };
    saveSession(currentUser);
    authReady = true;
  }
  if (!currentUser) {
    const session = diskSession || getSession();
    if (session && !session.cloud) {
      const guestBal = getPersistedBalanceForUser('', { isGuest: true });
      currentUser = {
        ...session,
        balance: guestBal !== null ? guestBal : Number(session.balance || 0)
      };
      saveSession(currentUser);
      saveSessionMeta({ startedAt: Date.now(), mode: 'local' });
      ensureAdminBootstrap();
    } else {
      currentUser = null;
      pendingAuthOpen = true;
    }
  }
  renderProfileBadge();
  updateLobbyBalance();
  updateAdminTabVisibility();
  startOnlinePresence();
  if (isCloudUser()) {
    try {
      await load();
      renderHuntList();
      if (state.activeHuntId && state.hunts.find(h => h.id === state.activeHuntId)) {
        document.getElementById('no-hunt-selected').style.display = 'none';
        const ws = document.getElementById('hunt-workspace');
        if (ws) { ws.classList.remove('hidden'); ws.style.display = 'flex'; }
        state._huntWsFp = '';
        if (__activePage === 'hunt' && state.huntTab === 'workspace') {
          scheduleHuntUI({ force: true });
        }
      }
    } catch (e) { bhWarn('initAuth cloud reload failed', e); }
  }
}

function showAuth() {
  const overlay = document.getElementById('auth-overlay');
  const err = document.getElementById('auth-error');
  if (!overlay || !err) {
    pendingAuthOpen = true;
    return;
  }
  overlay.classList.remove('hidden');
  err.classList.remove('show');
  pendingAuthOpen = false;
}
function closeAuth() {
  const overlay = document.getElementById('auth-overlay');
  if (overlay) overlay.classList.add('hidden');
  if (!currentUser) {
    const guest = getGuestProfile();
    currentUser = { ...GUEST_USER, displayName: guest.displayName || GUEST_USER.username, avatar: guest.avatar || '', balance: getSafeGuestBalance(guest.balance), streak: Number(guest.streak || 0), lastClaimDay: guest.lastClaimDay ?? null };
    saveSession(currentUser);
    updateLobbyBalance();
  }
  ensureAdminBootstrap();
  updateAdminTabVisibility();
  startOnlinePresence();
}

let authMode = 'login'; // 'login' | 'register'
const AUTH_GUARD_KEY = 'hm_auth_guard_v1';
const ACTION_GUARD_KEY = 'hm_action_guard_v1';
function getAuthGuard() {
  try { return JSON.parse(localStorage.getItem(AUTH_GUARD_KEY) || '{}'); } catch { return {}; }
}
function saveAuthGuard(v) {
  try { localStorage.setItem(AUTH_GUARD_KEY, JSON.stringify(v || {})); } catch (_) {}
}
function authGuardCheck(identity) {
  const id = String(identity || 'global').toLowerCase();
  const g = getAuthGuard();
  const rec = g[id] || { fails: 0, blockedUntil: 0 };
  if (Date.now() < Number(rec.blockedUntil || 0)) {
    return { blocked: true, waitSec: Math.ceil((Number(rec.blockedUntil) - Date.now()) / 1000) };
  }
  return { blocked: false, waitSec: 0 };
}
function authGuardRecord(identity, ok) {
  const id = String(identity || 'global').toLowerCase();
  const g = getAuthGuard();
  const rec = g[id] || { fails: 0, blockedUntil: 0 };
  if (ok) {
    delete g[id];
    saveAuthGuard(g);
    return;
  }
  rec.fails = Number(rec.fails || 0) + 1;
  if (rec.fails >= 5) {
    const lockMs = Math.min(10 * 60 * 1000, 30 * 1000 * Math.pow(2, rec.fails - 5));
    rec.blockedUntil = Date.now() + lockMs;
  }
  g[id] = rec;
  saveAuthGuard(g);
}
function getActionGuard() {
  try { return JSON.parse(localStorage.getItem(ACTION_GUARD_KEY) || '{}'); } catch { return {}; }
}
function saveActionGuard(v) {
  try { localStorage.setItem(ACTION_GUARD_KEY, JSON.stringify(v || {})); } catch (_) {}
}
function actionGuardAcquire(actionKey, { limit = 5, windowMs = 60000, blockMs = 120000 } = {}) {
  try {
    if (typeof isCurrentUserAdmin === 'function' && isCurrentUserAdmin()) {
      return { blocked: false, waitSec: 0 };
    }
  } catch (_) {}
  const key = String(actionKey || 'global');
  const now = Date.now();
  const data = getActionGuard();
  const rec = data[key] || { hits: [], blockedUntil: 0 };
  const until = Number(rec.blockedUntil || 0);
  if (now < until) {
    return { blocked: true, waitSec: Math.ceil((until - now) / 1000) };
  }
  const minTs = now - Number(windowMs || 60000);
  const hits = Array.isArray(rec.hits) ? rec.hits.filter((t) => Number(t) >= minTs) : [];
  hits.push(now);
  if (hits.length > Number(limit || 5)) {
    rec.hits = hits;
    rec.blockedUntil = now + Number(blockMs || 120000);
    data[key] = rec;
    saveActionGuard(data);
    return { blocked: true, waitSec: Math.ceil(Number(blockMs || 120000) / 1000) };
  }
  rec.hits = hits;
  rec.blockedUntil = 0;
  data[key] = rec;
  saveActionGuard(data);
  return { blocked: false, waitSec: 0 };
}
function getActionGuardStatus() {
  const now = Date.now();
  const data = getActionGuard();
  const entries = Object.entries(data).map(([k, v]) => ({
    key: k,
    blockedUntil: Number(v?.blockedUntil || 0),
    waitSec: Math.max(0, Math.ceil((Number(v?.blockedUntil || 0) - now) / 1000))
  }));
  return entries.filter((e) => e.waitSec > 0).sort((a, b) => b.waitSec - a.waitSec);
}
function toggleAuthMode() {
  authMode = authMode === 'login' ? 'register' : 'login';
  const isReg = authMode === 'register';
  document.getElementById('auth-title').textContent = isReg ? 'CRÉER UN COMPTE' : 'CONNEXION';
  document.getElementById('auth-submit').textContent = isReg ? 'CRÉER MON COMPTE' : 'SE CONNECTER';
  document.getElementById('auth-switch').innerHTML = isReg
    ? 'Déjà un compte ? <span>Se connecter</span>'
    : 'Pas encore de compte ? <span>Créer un compte</span>';
  document.getElementById('auth-password2-field').style.display = isReg ? 'block' : 'none';
  document.getElementById('auth-error').classList.remove('show');
}

async function authSubmit() {
  const username = document.getElementById('auth-username').value.trim();
  const email = document.getElementById('auth-email').value.trim();
  const password = document.getElementById('auth-password').value;
  const errEl = document.getElementById('auth-error');
  errEl.classList.remove('show');

  if (!username || !password) { errEl.textContent = 'Identifiant et mot de passe requis.'; errEl.classList.add('show'); return; }
  if (password.length < 6) { errEl.textContent = 'Mot de passe trop court (min 6 caractères).'; errEl.classList.add('show'); return; }
  const c = getAuthClient();
  if (!c) { errEl.textContent = 'Client Supabase indisponible.'; errEl.classList.add('show'); return; }
  const guardId = (email || usernameToEmail(username) || username || 'global').trim().toLowerCase();
  const guard = authGuardCheck(guardId);
  if (authMode === 'login' && guard.blocked) {
    errEl.textContent = `Trop de tentatives. Réessaie dans ${guard.waitSec}s.`;
    errEl.classList.add('show');
    return;
  }
  const apiGuard = actionGuardAcquire(`auth:${authMode}`, { limit: 6, windowMs: 60000, blockMs: 120000 });
  if (apiGuard.blocked) {
    pushRuntimeLog('warn', `auth_guard_block:${authMode} wait=${apiGuard.waitSec}s`);
    errEl.textContent = `Trop de requêtes ${authMode}. Réessaie dans ${apiGuard.waitSec}s.`;
    errEl.classList.add('show');
    return;
  }

  try {
    if (authMode === 'register') {
      const pwd2 = document.getElementById('auth-password2').value;
      if (password !== pwd2) { errEl.textContent = 'Les mots de passe ne correspondent pas.'; errEl.classList.add('show'); return; }
      const registerEmail = email || usernameToEmail(username);
      const { error } = await cloudCall('auth', () => c.auth.signUp({
        email: registerEmail,
        password,
        options: {
          data: { username, display_name: username }
        }
      }), { retries: 1, timeoutMs: 12000, delayMs: 600 });
      if (error) throw error;
      await cloudCall('auth', () => c.auth.signInWithPassword({ email: registerEmail, password }), { retries: 1, timeoutMs: 12000, delayMs: 600 });
      const { data } = await cloudCall('auth', () => c.auth.getSession(), { retries: 0, timeoutMs: 10000, quiet: true });
      const uid = data?.session?.user?.id;
      if (!uid) throw new Error('Session cloud introuvable');
      currentUser = await loadCloudProfile(uid);
      saveSession(currentUser);
      saveSessionMeta({ startedAt: Date.now(), mode: 'cloud' });
      authReady = true;
      closeAuth();
      renderProfileBadge();
      updateLobbyBalance();
      startOnlinePresence();
      try { await load(); renderHuntList(); if (state.activeHuntId) selectHunt(state.activeHuntId); } catch (_) {}
      showToast(`Compte cloud créé !`, 'success', 3200);
      return;
    }

    const loginEmail = email || usernameToEmail(username);
    const { error } = await cloudCall('auth', () => c.auth.signInWithPassword({ email: loginEmail, password }), { retries: 1, timeoutMs: 12000, delayMs: 600 });
    if (error) throw error;
    const { data } = await cloudCall('auth', () => c.auth.getSession(), { retries: 0, timeoutMs: 10000, quiet: true });
    const uid = data?.session?.user?.id;
    if (!uid) throw new Error('Session cloud introuvable');
    currentUser = await loadCloudProfile(uid);
    saveSession(currentUser);
    saveSessionMeta({ startedAt: Date.now(), mode: 'cloud' });
    authReady = true;
    closeAuth();
    renderProfileBadge();
    updateLobbyBalance();
    startOnlinePresence();
    try { await load(); renderHuntList(); if (state.activeHuntId) selectHunt(state.activeHuntId); } catch (_) {}
    authGuardRecord(guardId, true);
    showToast(`Bonjour ${currentUser.displayName || currentUser.username} !`, 'success', 2600);
  } catch (e) {
    if (authMode === 'login') authGuardRecord(guardId, false);
    errEl.textContent = mapAuthError(e);
    errEl.classList.add('show');
  }
}

function enterGuestMode(message = 'Déconnecté (mode invité actif)') {
  clearSession();
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(LOCAL_SYNCED_KEY); } catch (_) {}
  state.hunts = [];
  state.activeHuntId = null;
  const guest = getGuestProfile();
  currentUser = { ...GUEST_USER, displayName: guest.displayName || GUEST_USER.username, avatar: guest.avatar || '', balance: getSafeGuestBalance(guest.balance), streak: Number(guest.streak || 0), lastClaimDay: guest.lastClaimDay ?? null };
  renderProfileBadge();
  updateLobbyBalance();
  updateAdminTabVisibility();
  startOnlinePresence();
  loadLocal();
  renderHuntList();
  if (state.activeHuntId) selectHunt(state.activeHuntId);
  else {
    document.getElementById('no-hunt-selected').style.display = 'flex';
    const ws = document.getElementById('hunt-workspace');
    if (ws) ws.classList.add('hidden');
  }
  showToast(message, 'info');
}
function logout() {
  if (currentUser && currentUser.cloud) {
    const c = getAuthClient();
    if (c) c.auth.signOut({ scope: 'local' }).then(() => {}).catch(() => {});
  }
  enterGuestMode('Déconnecté (mode invité actif)');
}
async function logoutAllDevices() {
  if (!currentUser || currentUser.isGuest || !currentUser.cloud) {
    logout();
    return;
  }
  const ok = await confirm('Déconnecter tous les appareils ?', 'Toutes les sessions cloud seront fermées (web/mobile/autres navigateurs).');
  if (!ok) return;
  try {
    const c = getAuthClient();
    if (c) await c.auth.signOut({ scope: 'global' });
  } catch (e) {
    pushRuntimeLog('error', `logout_all_devices: ${String(e?.message || e || 'unknown')}`);
  }
  enterGuestMode('Toutes les sessions ont été fermées.');
}

function renderProfileBadge(opts = {}) {
  const preserveMenu = !!opts.preserveMenu;
  const keepMenuOpen = preserveMenu || profileMenuIsOpen;
  // Évite les doublons #profile-menu (détaché sur body après positionProfileMenu).
  document.querySelectorAll('body > #profile-menu').forEach((el) => el.remove());
  // Ajouter le badge dans le header principal
  const area = document.getElementById('header');
  if (!area) return;
  let badge = document.getElementById('profile-badge');
  if (!badge) {
    badge = document.createElement('div');
    badge.id = 'profile-badge';
    badge.className = 'profile-badge';
    area.appendChild(badge);
  }
  if (currentUser) {
    const pseudoRaw = currentUser.username || getDisplayName() || 'Invité';
    const safePseudo = escapeHtml(pseudoRaw);
    const safeName = escapeHtml(getDisplayName());
    const safeUser = escapeHtml(currentUser.username || 'Invité');
    const safeAvatar = escapeHtml(getAvatarUrl());
    const adminNow = isCurrentUserAdmin();
    const daily = getDailyState();
    const nextBonusPct = Math.min(200, Math.max(0, (daily.nextStreak - 1) * DAILY_STREAK_BONUS_PCT_PER_DAY));
    const sm = getSessionMeta();
    const started = sm?.startedAt ? new Date(sm.startedAt).toLocaleString('fr-FR') : '—';
    const deviceTxt = `${navigator.platform || 'Unknown'} / ${navigator.language || '—'}`;
    badge.innerHTML = `
      <div class="profile-wrap" id="profile-wrap">
        <div class="profile-badge" onclick="toggleProfileMenu(event)">
          ${buildAvatarMarkup()}
          <div>
            <div class="profile-name">${safePseudo}</div>
            <div class="profile-balance" id="profile-badge-balance">${fmtVirtual(getUserBalance())}</div>
            ${typeof getRankBadgeHtml === 'function' ? getRankBadgeHtml() : ''}
            <div class="profile-online"><span class="profile-online-dot"></span><span id="online-users-count">${Math.max(1, onlineCount)}</span> en ligne</div>
          </div>
        </div>
        <div class="profile-menu hidden" id="profile-menu">
          <div class="profile-menu-title">MON COMPTE</div>
          <div class="profile-menu-head">
            ${buildAvatarMarkup('profile-avatar')}
            <div>
              <div class="profile-menu-big">${safePseudo}</div>
              <div class="profile-menu-sub">Nom affiché: ${safeName}</div>
              <div class="profile-menu-sub">Solde actuel: <span id="profile-menu-balance">${fmtVirtual(getUserBalance())}</span>${adminNow ? ' · ADMIN' : ''}</div>
              ${typeof getRankBadgeHtml === 'function' ? getRankBadgeHtml() : ''}
            </div>
          </div>
          <div class="profile-grid">
            <div class="profile-tile">
              <div class="profile-tile-label">STATUT</div>
              <div class="profile-tile-value">${currentUser.isGuest ? 'INVITÉ' : (adminNow ? 'ADMIN' : 'JOUEUR')}</div>
            </div>
            <div class="profile-tile">
              <div class="profile-tile-label">SESSION</div>
              <div class="profile-tile-value">${currentUser.cloud ? 'CLOUD' : 'LOCAL'}</div>
            </div>
          </div>
          <div class="drop-box">
            <div class="drop-title">Drop quotidien</div>
            <div class="drop-meta">
              Streak actuelle: ${daily.streak} jour(s)<br>
              Rank: ${daily.rankLabel} (x${daily.rankFactor.toFixed(2)})<br>
              Prochain drop: +${fmt(daily.reward)} (${nextBonusPct}% bonus streak)
            </div>
            <button class="drop-claim-btn" onclick="claimDailyDrop()" ${daily.canClaim ? '' : 'disabled'}>
              ${daily.canClaim ? 'Récupérer le drop' : 'Déjà récupéré aujourd’hui'}
            </button>
          </div>
          <div class="drop-box" id="profile-weekly-objectives"></div>
          <div class="drop-box">
            <div class="drop-title">Mes soumissions tournoi</div>
            <div class="drop-meta" style="margin-bottom:8px;">Statut : en attente, validé (refus = entrée retirée par l’admin).</div>
            <div id="profile-tournoi-submissions"><div class="drop-meta">Ouvre le menu pour charger…</div></div>
          </div>
          <div class="drop-box">
            <div class="drop-title">Préférences</div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">TAILLE UI</span>
              <select class="profile-menu-input" id="profile-ui-scale" style="width:140px;height:34px;padding:0 8px;">
                <option value="normal">Normal</option>
                <option value="large">Grand</option>
                <option value="compact">Compact</option>
              </select>
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">SONS UI</span>
              <input type="checkbox" id="profile-ui-sound">
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">MUTE GLOBAL</span>
              <input type="checkbox" id="profile-ui-mute">
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">VOLUME</span>
              <input type="range" id="profile-ui-volume" min="0" max="100" step="5" style="width:140px;">
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">VOLUME JEUX</span>
              <input type="range" id="profile-game-volume" min="0" max="100" step="5" style="width:140px;">
            </div>
            <div class="profile-pref-row">
              <span class="profile-menu-label" style="margin:0;">CASINO PAR DÉFAUT</span>
              <select class="profile-menu-input" id="profile-default-casino" style="width:140px;height:34px;padding:0 8px;"></select>
            </div>
            <button class="profile-mini-btn primary" style="width:100%;" onclick="saveProfilePreferences()">Sauvegarder préférences</button>
          </div>
          <div class="drop-box">
            <div class="drop-title">Sécurité session</div>
            <div class="drop-meta">
              Session active: ${currentUser.cloud ? 'CLOUD' : 'LOCAL'}<br>
              Démarrée: ${escapeHtml(started)}<br>
              Appareil: ${escapeHtml(deviceTxt)}
            </div>
            ${(!currentUser.isGuest && currentUser.cloud)
              ? `<button class="profile-mini-btn danger" style="width:100%;margin-top:8px;" onclick="logoutAllDevices()">Déconnecter tous les appareils</button>`
              : `<div class="bj-rec" style="margin-top:8px;">Option cloud indisponible en mode invité/local.</div>`}
          </div>
          <div class="drop-box">
            <div class="drop-title">Compte Discord</div>
            <div class="drop-meta" style="margin-bottom:8px;">Lie ton compte pour <code>/hunts</code>, <code>/leaderboard</code>, <code>/live slug</code>. <code>/slot</code> et <code>/call</code> (tirage catalogue) sont utilisables par tous sur le serveur.</div>
            ${(!currentUser.isGuest && currentUser.cloud)
              ? `<button class="profile-mini-btn primary" style="width:100%;" onclick="openDiscordLinkModal()">Gérer la liaison Discord</button>`
              : `<div class="bj-rec">Connecte-toi avec un compte cloud pour activer la liaison Discord.</div>`}
          </div>
          <div class="profile-menu-row">
            <label class="profile-menu-label">Pseudo du compte (verrouillé)</label>
            <input class="profile-menu-input" id="profile-display-name" value="${safePseudo}" maxlength="20" disabled title="Le pseudo est verrouillé sur le compte">
          </div>
          <div class="profile-menu-row">
            <label class="profile-menu-label">Photo (URL)</label>
            <input class="profile-menu-input" id="profile-avatar-url" value="${safeAvatar}" placeholder="https://...">
          </div>
          <div class="profile-menu-row">
            <label class="profile-menu-label">Importer une photo</label>
            <input class="profile-menu-input" type="file" accept="image/*" onchange="onProfileAvatarUpload(event)">
          </div>
          <div class="profile-menu-row" style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);">
            Compte: ${safeUser}${currentUser.isGuest ? ' (invité)' : ''}
          </div>
          <div class="profile-menu-row" style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);line-height:1.45;">
            ID session: ${escapeHtml(String(currentUser.id || '—'))}<br>
            Role brut: ${escapeHtml(String(currentUser.role || '—'))} · Statut brut: ${escapeHtml(String(currentUser.status || '—'))}
          </div>
          <div class="profile-menu-actions">
            <button class="profile-mini-btn primary" onclick="applyProfileSettings()">Enregistrer</button>
            <button class="profile-mini-btn" onclick="resetProfileAvatar()">Reset avatar</button>
            ${currentUser.isGuest ? `<button class="profile-mini-btn" onclick="showAuth()">Connexion</button><button class="profile-mini-btn danger" onclick="closeProfileMenu()">Fermer</button>` : `${adminNow ? `<button class="profile-mini-btn primary" onclick="switchPage('admin'); closeProfileMenu();">Panel admin</button>` : `<button class="profile-mini-btn" onclick="closeProfileMenu()">Fermer</button>`}<button class="profile-mini-btn danger" onclick="logout()">Déconnexion</button>`}
          </div>
        </div>
      </div>
    `;
    if (keepMenuOpen) {
      profileMenuIsOpen = true;
      const menu = document.getElementById('profile-menu');
      if (menu) {
        menu.classList.remove('hidden');
        requestAnimationFrame(() => {
          positionProfileMenu();
          requestAnimationFrame(positionProfileMenu);
        });
      }
    }
    const prefs = getUiPrefs();
    const scaleEl = document.getElementById('profile-ui-scale');
    const soundEl = document.getElementById('profile-ui-sound');
    const muteEl = document.getElementById('profile-ui-mute');
    const volEl = document.getElementById('profile-ui-volume');
    const gameVolEl = document.getElementById('profile-game-volume');
    const casinoEl = document.getElementById('profile-default-casino');
    if (scaleEl) scaleEl.value = prefs.uiScale || 'normal';
    if (soundEl) soundEl.checked = prefs.uiSound !== false;
    if (muteEl) muteEl.checked = !!prefs.uiMuted;
    if (volEl) volEl.value = String(Number.isFinite(Number(prefs.uiVolume)) ? Number(prefs.uiVolume) : 70);
    if (gameVolEl) gameVolEl.value = String(Number.isFinite(Number(prefs.uiGameVolume)) ? Number(prefs.uiGameVolume) : 85);
    populateCasinoSelect(casinoEl, getCasinoKey(prefs.defaultCasino || 'gamdom'));
  } else {
    badge.innerHTML = `<span onclick="showAuth()" style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);letter-spacing:1px;cursor:pointer;">CONNEXION</span>`;
  }
  updateOnlineCountUI();
  renderMaintenanceBanner();
  ensureNotifBellInHeader();
  renderWeeklyObjectivesInProfile();
}

function getUserBalance() {
  if (!currentUser) return 0;
  if (currentUser.cloud) return Number(currentUser.balance || 0);
  if (currentUser.isGuest) return currentUser.balance || 0;
  const users = getUsers();
  const u = users[currentUser.username];
  return u ? u.balance : 0;
}

let cloudBalanceSyncTimer = null;
let cloudBalanceSyncRunning = false;
let cloudBalanceSyncQueued = false;
let cloudGameSettlementInFlight = 0;
let cloudQueuedGameSessions = 0;
function getPendingStakePreviewTotal() {
  let total = 0;
  for (const key of Object.keys(window.__hmStakePreview || {})) {
    const q = window.__hmStakePreview[key];
    if (!Array.isArray(q) || !q.length) continue;
    for (const v of q) {
      const n = Number(v || 0);
      if (Number.isFinite(n) && n > 0) total += n;
    }
  }
  return +total.toFixed(4);
}
function hasPendingStakePreviews() {
  return getPendingStakePreviewTotal() > 0.0001;
}
function markCloudSettlementStart() {
  cloudGameSettlementInFlight += 1;
}
function markCloudSettlementEnd() {
  cloudGameSettlementInFlight = Math.max(0, cloudGameSettlementInFlight - 1);
}
function canStartCloudGameRound(showToast = true) {
  if (!isCloudUser() || !CLOUD_STRICT_POINTS) return true;
  const status = getCloudUiStatus();
  if (status.key !== 'online') {
    pushRuntimeLog('warn', `game_gate_blocked: cloud_status=${status.key}`);
    if (showToast) showCloudOfflineToastThrottled();
    return false;
  }
  if (cloudGameSettlementInFlight > 0) {
    pushRuntimeLog('warn', `game_gate_blocked: settlement_in_flight=${cloudGameSettlementInFlight}`);
    if (showToast) showCloudPendingToastThrottled();
    return false;
  }
  return true;
}
function canStartCloudGameRoundForPlinko(showToast = true) {
  if (!isCloudUser() || !CLOUD_STRICT_POINTS) return true;
  const status = getCloudUiStatus();
  if (status.key !== 'online') {
    pushRuntimeLog('warn', `game_gate_blocked_plinko: cloud_status=${status.key}`);
    if (showToast) showCloudOfflineToastThrottled();
    return false;
  }
  return true;
}
async function syncCloudBalanceNow() {
  if (!isCloudUser() || !currentUser?.id) return;
  if (cloudQueuedGameSessions > 0 || cloudGameSettlementInFlight > 0 || hasPendingStakePreviews()) return;
  if (cloudBalanceSyncRunning) { cloudBalanceSyncQueued = true; return; }
  cloudBalanceSyncRunning = true;
  try {
    const fresh = await loadCloudProfile(currentUser.id, { force: true });
    if (fresh && currentUser && currentUser.id === fresh.id) {
      const freshBal = Number(fresh.balance || 0);
      const currBal = Number(currentUser.balance || 0);
      const persistedBal = getPersistedBalanceForUser(currentUser.id);
      if (shouldRejectSuspectServerBalance(freshBal, persistedBal ?? currBal, currentUser.id)) {
        pushRuntimeLog('warn', `cloud_sync_skip_suspect_reset_100: fresh=${freshBal.toFixed(2)} current=${currBal.toFixed(2)}`);
        return;
      }
      const mergedBal = resolveCloudBalanceMerge(currBal, freshBal, currentUser.id);
      if (shouldRejectRollbackToGameAnchor(mergedBal, currBal) && Math.abs(mergedBal - currBal) > 0.005) {
        pushRuntimeLog('warn', `cloud_sync_skip_anchor_rollback: merged=${mergedBal.toFixed(2)} current=${currBal.toFixed(2)}`);
        return;
      }
      if (Math.abs(mergedBal - currBal) < 0.005) return;
      currentUser.balance = mergedBal;
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
  } catch (_) {
    // Best effort: l'UI reste sur la valeur optimiste.
  } finally {
    cloudBalanceSyncRunning = false;
    if (cloudBalanceSyncQueued) {
      cloudBalanceSyncQueued = false;
      setTimeout(() => { syncCloudBalanceNow().catch(() => {}); }, 120);
    }
  }
}
function scheduleCloudBalanceSync(delayMs = 700) {
  if (!isCloudUser()) return;
  if (cloudQueuedGameSessions > 0 || cloudGameSettlementInFlight > 0 || hasPendingStakePreviews()) {
    cloudBalanceSyncQueued = true;
    return;
  }
  if (cloudBalanceSyncTimer) clearTimeout(cloudBalanceSyncTimer);
  cloudBalanceSyncTimer = setTimeout(() => {
    cloudBalanceSyncTimer = null;
    syncCloudBalanceNow().catch(() => {});
  }, Math.max(150, Number(delayMs) || 700));
}
async function reconcileCloudBalanceAfterAuth() {
  if (!isCloudUser() || !currentUser?.id) return;
  const pending = getPendingCloudBalanceDelta(currentUser.id);
  if (Math.abs(pending) < 0.005) return;
  if (cloudQueuedGameSessions > 0 || cloudGameSettlementInFlight > 0 || hasPendingStakePreviews()) return;
  try {
    await applyBalanceDeltaCloud(pending, 'pending_reconcile');
    clearPendingCloudBalanceDelta(currentUser.id);
  } catch (e) {
    pushRuntimeLog('warn', `pending_reconcile_failed: ${String(e?.message || e || 'unknown')}`);
  }
}

function setUserBalance(val) {
  if (!currentUser) return;
  if (isMaintenanceReadOnly()) return;
  if (currentUser.cloud) {
    const next = Math.max(0, Number(val || 0));
    const prev = Number(currentUser.balance || 0);
    const delta = Number((next - prev).toFixed(2));
    if (Math.abs(delta) < 0.005) return;
    markCloudSettlementStart();
    applyBalanceDeltaCloud(delta, 'set')
      .catch(err => bhWarn('[balance] set delta failed', err))
      .finally(() => {
        markCloudSettlementEnd();
        scheduleCloudBalanceSync(900);
      });
    return;
  }
  if (currentUser.isGuest) {
    currentUser.balance = Math.max(0, val);
    saveGuestProfile({
      displayName: currentUser.displayName || GUEST_USER.username,
      avatar: currentUser.avatar || '',
      balance: currentUser.balance,
      streak: Number(currentUser.streak || 0),
      lastClaimDay: currentUser.lastClaimDay ?? null
    });
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
    return;
  }
  const users = getUsers();
  if (users[currentUser.username]) {
    users[currentUser.username].balance = Math.max(0, val);
    saveUsers(users);
    currentUser.balance = users[currentUser.username].balance;
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
  }
}

// Applique un delta sur la balance cloud via le RPC `apply_balance_delta`.
// Le caller doit déjà avoir muté `currentUser.balance` de manière optimiste ;
// cette fonction écrase ensuite avec la valeur officielle renvoyée par le serveur.
async function applyBalanceDeltaCloud(delta, reason = null) {
  if (!isCloudUser()) return Number(currentUser?.balance || 0);
  const supa = getAuthClient();
  if (!supa) return Number(currentUser?.balance || 0);
  try {
    const { data, error } = await cloudCall('sync', () => supa.rpc('apply_balance_delta', {
      p_delta: Number(delta || 0),
      p_reason: reason ? String(reason).slice(0, 200) : null
    }), { retries: 1, timeoutMs: 10000, delayMs: 500 });
    if (error) throw error;
    const newBal = Number(data ?? currentUser.balance);
    if (
      shouldRejectSuspectServerBalance(newBal, currentUser?.balance, currentUser?.id) ||
      shouldRejectRollbackToGameAnchor(newBal, currentUser?.balance)
    ) {
      pushRuntimeLog('warn', `apply_balance_delta_suspect_reset_100: server=${Number(newBal || 0).toFixed(2)} current=${Number(currentUser?.balance || 0).toFixed(2)}`);
      return Number(currentUser?.balance || 0);
    }
    if (Number.isFinite(newBal)) {
      currentUser.balance = newBal;
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
    return newBal;
  } catch (e) {
    console.error('[balance] apply_balance_delta failed', e);
    return Number(currentUser?.balance || 0);
  }
}

// Logge une session de mini-jeu (cloud) ou applique le delta localement (guest).
async function recordGameSession(game, stake, payout) {
  if (!currentUser) return;
  const stakeN = Math.max(0, Number(stake || 0));
  const payoutN = Math.max(0, Number(payout || 0));
  const delta = Number((payoutN - stakeN).toFixed(2));

  if (isCloudUser() && CLOUD_STRICT_POINTS) {
    const supa = getAuthClient();
    if (!supa) throw new Error('cloud_client_unavailable');
    pushRuntimeLog('info', `game_tx_start: ${String(game || 'unknown')} stake=${stakeN.toFixed(2)} payout=${payoutN.toFixed(2)}`);
    markCloudSettlementStart();
    try {
      const { data, error } = await cloudCall('sync', () => supa.rpc('record_game_session', {
        p_game: String(game || 'unknown').slice(0, 60),
        p_stake: stakeN,
        p_payout: payoutN
      }), { retries: 1, timeoutMs: 10000, delayMs: 500 });
      if (error) throw error;
      const newBal = Number(data ?? currentUser.balance);
      if (
        shouldRejectSuspectServerBalance(newBal, currentUser?.balance, currentUser?.id) ||
        shouldRejectRollbackToGameAnchor(newBal, currentUser?.balance)
      ) {
        pushRuntimeLog('warn', `record_game_session_suspect_reset_100: server=${Number(newBal || 0).toFixed(2)} current=${Number(currentUser?.balance || 0).toFixed(2)} game=${String(game || 'unknown')}`);
        return Number(currentUser?.balance || 0);
      }
      if (Number.isFinite(newBal)) {
        currentUser.balance = newBal;
        saveSession(currentUser);
        updateLobbyBalance();
        renderProfileBadge();
      }
      clearPendingCloudBalanceDelta(currentUser?.id);
      pushRuntimeLog('info', `game_tx_ok: ${String(game || 'unknown')} balance=${Number(currentUser?.balance || 0).toFixed(2)}`);
      return newBal;
    } catch (e) {
      console.error('[record_game_session]', e);
      pushRuntimeLog('error', `game_tx_err: ${String(game || 'unknown')} ${String(e?.message || e || 'unknown')}`);
      scheduleCloudBalanceSync(400);
      throw e;
    } finally {
      markCloudSettlementEnd();
      scheduleCloudBalanceSync(600);
    }
  }

  // Guest/local : on applique simplement le delta sur la balance locale.
  const next = Math.max(0, Number(currentUser.balance || 0) + delta);
  setUserBalance(next);
}
let cloudSettlementQueue = Promise.resolve();
let lastCloudValidationToastAt = 0;
function showCloudValidationToastThrottled() {
  const now = Date.now();
  if (now - lastCloudValidationToastAt < 4500) return;
  lastCloudValidationToastAt = now;
  showToast('Gain enregistré localement — synchro cloud en cours', 'info', 2800);
}
let lastCloudOfflineToastAt = 0;
function showCloudOfflineToastThrottled() {
  const now = Date.now();
  if (now - lastCloudOfflineToastAt < 3500) return;
  lastCloudOfflineToastAt = now;
  showToast('Connexion cloud indisponible, réessaie dans quelques secondes', 'error', 2600);
}
function showCloudPendingToastThrottled() {
  /* volontairement silencieux */
}
function queueCloudGameSession(game, stake, payout) {
  if (!isCloudUser()) return recordGameSession(game, stake, payout);
  cloudQueuedGameSessions += 1;
  const task = cloudSettlementQueue
    .catch(() => {})
    .then(async () => {
      try {
        return await recordGameSession(game, stake, payout);
      } catch (e) {
        // Retry court: évite les erreurs cloud transitoires pendant les rafales.
        await gameSleep(320);
        return recordGameSession(game, stake, payout);
      }
    })
    .finally(() => {
      cloudQueuedGameSessions = Math.max(0, cloudQueuedGameSessions - 1);
      if (cloudQueuedGameSessions === 0) scheduleCloudBalanceSync(220);
    });
  cloudSettlementQueue = task.catch(() => {});
  return task;
}
async function applyNetDeltaForGame(game, netAmount) {
  const net = Number(netAmount || 0);
  if (!Number.isFinite(net) || Math.abs(net) < 0.005) return;
  const stake = net < 0 ? Math.abs(net) : 0;
  const payout = net > 0 ? net : 0;
  trackPlayerGameStats(String(game || 'unknown'), stake, payout);
  if (isCloudUser()) {
    if (currentUser) {
      notePendingCloudBalanceDelta(currentUser.id, net);
      currentUser.balance = Math.max(0, Number(currentUser.balance || 0) + net);
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
    queueCloudGameSession(game, stake, payout).catch(() => {});
  } else {
    setUserBalance(getUserBalance() + net);
  }
  updateLobbyBalance();
}

function updateLobbyBalance() {
  const bal = getUserBalance();
  if (Number.isFinite(bal) && bal >= 0) {
    localStorage.setItem(BALANCE_SNAPSHOT_KEY, String(bal));
    saveBalanceSnapshotScoped(bal, {
      userId: isCloudUser() ? String(currentUser?.id || '') : '',
      isGuest: !!currentUser?.isGuest || !isCloudUser()
    });
  }
  const balText = fmtVirtual(bal);
  const el = document.getElementById('lobby-balance');
  if (el && el.textContent !== balText) el.textContent = balText;
  const topBal = document.getElementById('game-window-balance');
  if (topBal && topBal.textContent !== balText) topBal.textContent = balText;
  const controlsBal = document.getElementById('game-controls-balance');
  if (controlsBal && controlsBal.textContent !== balText) controlsBal.textContent = balText;
  const miniBal = document.getElementById('profile-badge-balance');
  if (miniBal && miniBal.textContent !== balText) miniBal.textContent = balText;
  const menuBal = document.getElementById('profile-menu-balance');
  if (menuBal && menuBal.textContent !== balText) menuBal.textContent = balText;
}

// [blackjack] — extrait dans scripts/pages/blackjack.js (LAZY_PAGE_SCRIPTS)

// [mise] — extrait dans scripts/pages/mise.js (LAZY_PAGE_SCRIPTS)

// [tournoi] — extrait dans scripts/pages/tournoi.js (LAZY_PAGE_SCRIPTS)

// [jeux] — extrait dans scripts/pages/mini-jeux.js (LAZY_PAGE_SCRIPTS)

// [roue_depot] — extrait dans scripts/pages/roue-depot.js (LAZY_PAGE_SCRIPTS)


// [jeux] — extrait dans scripts/pages/mini-jeux.js (LAZY_PAGE_SCRIPTS)

const RANK_FAMILIES = ['Fer', 'Bronze', 'Argent', 'Or', 'Platine', 'Diamant', 'Master'];
const RANK_STEPS_PER_FAMILY = 5;
const STATS_GAMES = ['blackjack', 'roulette', 'crash', 'keno', 'mines', 'plinko', 'flip', 'dice', 'hilo', 'chicken', 'pump', 'limbo'];
let playerStatsScope = '';
let playerStats = null;
// [stats UI] — renderStatsPage / setStatsWindow dans scripts/pages/stats.js (LAZY_PAGE_SCRIPTS)
function statsScopeKey() {
  if (isCloudUser()) return `cloud:${currentUser.id}`;
  if (currentUser?.isGuest) return `guest:${currentUser.displayName || 'invite'}`;
  return `local:${currentUser?.username || 'unknown'}`;
}
function createEmptyPlayerStats() {
  const games = {};
  STATS_GAMES.forEach((g) => { games[g] = { played: 0, wagered: 0, payout: 0, net: 0 }; });
  return {
    rounds: 0,
    wagered: 0,
    payout: 0,
    net: 0,
    games,
    daily: {},
    sessionsByHour: Array(24).fill(0)
  };
}
function loadPlayerStatsForScope(scope) {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYER_STATS_KEY) || '{}');
    const rec = raw?.[scope];
    if (!rec || typeof rec !== 'object') return createEmptyPlayerStats();
    const stats = createEmptyPlayerStats();
    stats.rounds = Math.max(0, Number(rec.rounds || 0));
    stats.wagered = Math.max(0, Number(rec.wagered || 0));
    stats.payout = Math.max(0, Number(rec.payout || 0));
    stats.net = Number(rec.net || (stats.payout - stats.wagered) || 0);
    STATS_GAMES.forEach((g) => {
      const src = rec.games?.[g] || {};
      stats.games[g] = {
        played: Math.max(0, Number(src.played || 0)),
        wagered: Math.max(0, Number(src.wagered || 0)),
        payout: Math.max(0, Number(src.payout || 0)),
        net: Number(src.net || (Number(src.payout || 0) - Number(src.wagered || 0)) || 0)
      };
    });
    const daily = rec.daily && typeof rec.daily === 'object' ? rec.daily : {};
    stats.daily = {};
    Object.entries(daily).forEach(([k, v]) => {
      stats.daily[k] = {
        wagered: Math.max(0, Number(v?.wagered || 0)),
        payout: Math.max(0, Number(v?.payout || 0)),
        net: Number(v?.net || (Number(v?.payout || 0) - Number(v?.wagered || 0)) || 0),
        rounds: Math.max(0, Number(v?.rounds || 0)),
        sessionsByHour: Array.from({ length: 24 }, (_, i) => Math.max(0, Number(v?.sessionsByHour?.[i] || 0)))
      };
    });
    const hours = Array.isArray(rec.sessionsByHour) ? rec.sessionsByHour : [];
    stats.sessionsByHour = Array.from({ length: 24 }, (_, i) => Math.max(0, Number(hours[i] || 0)));
    return stats;
  } catch (_) {
    return createEmptyPlayerStats();
  }
}
function savePlayerStatsForScope(scope, stats) {
  try {
    const raw = JSON.parse(localStorage.getItem(PLAYER_STATS_KEY) || '{}');
    raw[scope] = stats;
    localStorage.setItem(PLAYER_STATS_KEY, JSON.stringify(raw));
  } catch (_) {}
}
function ensurePlayerStatsReady() {
  if (!currentUser) return null;
  const scope = statsScopeKey();
  if (!playerStats || playerStatsScope !== scope) {
    playerStatsScope = scope;
    playerStats = loadPlayerStatsForScope(scope);
  }
  return playerStats;
}
function pointsNeededForRankStep(stepIdx) {
  let sum = 0;
  // Paliers volontairement plus exigeants: plus de wager pour chaque rang.
  for (let i = 0; i <= stepIdx; i++) sum += Math.round(850 * Math.pow(1.30, i));
  return sum;
}
function computeRankFromWagered(totalWagered) {
  const w = Math.max(0, Number(totalWagered || 0));
  const maxSteps = RANK_FAMILIES.length * RANK_STEPS_PER_FAMILY;
  let step = 0;
  while (step < (maxSteps - 1) && w >= pointsNeededForRankStep(step)) step += 1;
  const familyIdx = Math.min(RANK_FAMILIES.length - 1, Math.floor(step / RANK_STEPS_PER_FAMILY));
  const level = (step % RANK_STEPS_PER_FAMILY) + 1;
  const prevReq = step <= 0 ? 0 : pointsNeededForRankStep(step - 1);
  const nextReq = pointsNeededForRankStep(step);
  const progress = nextReq > prevReq ? Math.max(0, Math.min(1, (w - prevReq) / (nextReq - prevReq))) : 1;
  return {
    label: `${RANK_FAMILIES[familyIdx]} ${level}`,
    family: RANK_FAMILIES[familyIdx],
    level,
    step,
    prevReq,
    nextReq,
    progress
  };
}
function getDailyRankDropInfo() {
  const stats = ensurePlayerStatsReady();
  const rank = computeRankFromWagered(stats?.wagered || 0);
  const step = Math.max(0, Number(rank.step || 0));
  // Courbe plus exponentielle, tout en restant progressive.
  const factor = Number((0.88 * Math.pow(1.035, step)).toFixed(2));
  return {
    rankLabel: `${rank.family} ${rank.level}`,
    factor
  };
}
function getAllRankDropFactors() {
  const rows = [];
  let globalStep = 0;
  RANK_FAMILIES.forEach((fam) => {
    for (let lvl = 1; lvl <= RANK_STEPS_PER_FAMILY; lvl++) {
      const factor = Number((0.88 * Math.pow(1.035, globalStep)).toFixed(2));
      const wagerRequired = globalStep <= 0 ? 0 : pointsNeededForRankStep(globalStep - 1);
      rows.push({ rank: `${fam} ${lvl}`, factor, wagerRequired });
      globalStep += 1;
    }
  });
  return rows;
}
const WEEKLY_OBJECTIVES_KEY = 'hm_weekly_objectives_v1';
const GAME_HISTORY_MAX = 10;
const WEEKLY_OBJECTIVE_DEFS = [
  { id: 'bj5', game: 'blackjack', target: 5, title: '5 parties de Black Jack', reward: 20, desc: 'Bonus drop hebdomadaire' },
];
function getIsoWeekKey(d = new Date()) {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
function weeklyObjectivesStorageKey() {
  return `${WEEKLY_OBJECTIVES_KEY}:${statsScopeKey()}`;
}
function loadWeeklyObjectivesState() {
  const weekKey = getIsoWeekKey();
  try {
    const raw = JSON.parse(localStorage.getItem(weeklyObjectivesStorageKey()) || 'null');
    if (!raw || raw.weekKey !== weekKey) return { weekKey, progress: {}, claimed: {} };
    return { weekKey, progress: raw.progress || {}, claimed: raw.claimed || {} };
  } catch (_) {
    return { weekKey, progress: {}, claimed: {} };
  }
}
function saveWeeklyObjectivesState(state) {
  try { localStorage.setItem(weeklyObjectivesStorageKey(), JSON.stringify(state)); } catch (_) {}
}
function getWeeklyObjectivesView() {
  const state = loadWeeklyObjectivesState();
  return WEEKLY_OBJECTIVE_DEFS.map((def) => {
    const progress = Number(state.progress[def.id] || 0);
    const done = progress >= def.target;
    const claimed = !!state.claimed[def.id];
    return { ...def, progress, done, claimed, canClaim: done && !claimed, weekKey: state.weekKey };
  });
}
function bumpWeeklyObjectiveProgress(game) {
  const state = loadWeeklyObjectivesState();
  let changed = false;
  WEEKLY_OBJECTIVE_DEFS.forEach((def) => {
    if (def.game !== game) return;
    const cur = Number(state.progress[def.id] || 0);
    if (cur >= def.target) return;
    state.progress[def.id] = Math.min(def.target, cur + 1);
    changed = true;
  });
  if (!changed) return;
  saveWeeklyObjectivesState(state);
  renderWeeklyObjectivesPanel();
  renderWeeklyObjectivesInProfile();
}
async function claimWeeklyObjectiveBonus(objectiveId) {
  const def = WEEKLY_OBJECTIVE_DEFS.find((d) => d.id === objectiveId);
  if (!def) return;
  const state = loadWeeklyObjectivesState();
  const progress = Number(state.progress[def.id] || 0);
  if (progress < def.target || state.claimed[def.id]) {
    showToast('Objectif non terminé ou déjà récupéré', 'info', 2200);
    return;
  }
  state.claimed[def.id] = true;
  saveWeeklyObjectivesState(state);
  const reward = Number(def.reward || 0);
  if (isCloudUser()) {
    await applyBalanceDeltaCloud(reward, `weekly_objective_${def.id}`);
  } else {
    setUserBalance(getUserBalance() + reward);
    updateLobbyBalance();
  }
  renderProfileBadge({ preserveMenu: true });
  renderWeeklyObjectivesPanel();
  renderWeeklyObjectivesInProfile();
  showToast(`Bonus objectif : +${fmt(reward)}`, 'success', 2600);
}
function buildWeeklyObjectivesHtml(compact) {
  const items = getWeeklyObjectivesView();
  if (!items.length) return '';
  const rows = items.map((o) => {
    const pct = Math.min(100, Math.round((o.progress / o.target) * 100));
    const status = o.claimed ? 'Récupéré' : (o.canClaim ? 'Prêt !' : `${o.progress}/${o.target}`);
    const btn = o.canClaim
      ? `<button type="button" class="profile-mini-btn primary weekly-obj-claim" onclick="claimWeeklyObjectiveBonus('${escapeHtml(o.id)}')">+${fmt(o.reward)} bonus</button>`
      : (o.claimed ? `<span class="weekly-obj-done">✔ Bonus reçu</span>` : `<span class="weekly-obj-pending">${status}</span>`);
    return `<div class="weekly-obj-row${o.claimed ? ' is-claimed' : ''}${o.canClaim ? ' is-ready' : ''}">
      <div class="weekly-obj-head">
        <span class="weekly-obj-title">${escapeHtml(o.title)}</span>
        <span class="weekly-obj-status">${status}</span>
      </div>
      <div class="weekly-obj-bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><span style="width:${pct}%"></span></div>
      ${compact ? '' : `<div class="weekly-obj-meta">${escapeHtml(o.desc)} · semaine ${escapeHtml(o.weekKey)}</div>`}
      ${btn}
    </div>`;
  }).join('');
  return `<div class="weekly-obj-wrap">
    <div class="drop-title">${compact ? 'Objectif hebdo' : 'Objectifs hebdo mini-jeux'}</div>
    ${rows}
  </div>`;
}
function renderWeeklyObjectivesPanel() {
  const wrap = document.getElementById('games-weekly-objectives');
  if (!wrap) return;
  wrap.innerHTML = buildWeeklyObjectivesHtml(false);
}
function renderWeeklyObjectivesInProfile() {
  const wrap = document.getElementById('profile-weekly-objectives');
  if (!wrap) return;
  wrap.innerHTML = buildWeeklyObjectivesHtml(true);
}
function renderGamesModeBanner() {
  const wrap = document.getElementById('games-mode-banner');
  if (!wrap) return;
  if (!currentUser) {
    wrap.innerHTML = '';
    return;
  }
  if (currentUser.isGuest) {
    wrap.innerHTML = `<div class="games-mode-banner-inner games-mode-guest">
      <div class="games-mode-icon" aria-hidden="true">👤</div>
      <div class="games-mode-body">
        <div class="games-mode-title">Mode invité</div>
        <div class="games-mode-text">Solde et stats stockés <strong>uniquement sur cet appareil</strong>. Pas de sync cloud, pas de classement wager, drop limité au navigateur.</div>
      </div>
      <button type="button" class="profile-mini-btn primary" onclick="showAuth()">Créer un compte cloud</button>
    </div>`;
    return;
  }
  if (currentUser.cloud) {
    const st = getCloudUiStatus();
    wrap.innerHTML = `<div class="games-mode-banner-inner games-mode-cloud">
      <div class="games-mode-icon" aria-hidden="true">☁</div>
      <div class="games-mode-body">
        <div class="games-mode-title">Mode cloud · ${escapeHtml(st.label)}</div>
        <div class="games-mode-text">Solde synchronisé Supabase, sessions enregistrées pour le classement wager, drop quotidien + streak, objectifs hebdo.</div>
      </div>
    </div>`;
    return;
  }
  wrap.innerHTML = `<div class="games-mode-banner-inner games-mode-local">
    <div class="games-mode-icon" aria-hidden="true">💾</div>
    <div class="games-mode-body">
      <div class="games-mode-title">Mode local (legacy)</div>
      <div class="games-mode-text">Compte sans cloud — solde dans le navigateur. Connecte-toi avec un compte Supabase pour la sync et les classements.</div>
    </div>
    <button type="button" class="profile-mini-btn" onclick="showAuth()">Passer au cloud</button>
  </div>`;
}

