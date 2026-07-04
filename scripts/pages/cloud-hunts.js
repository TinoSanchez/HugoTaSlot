'use strict';
/* globals state, getAuthClient, currentUser, isCloudUser, isUuidString, uuidLike, getCasinoKey, inferCasinoFromBonuses, dedupeAllHuntsBonuses, showToast, bhWarn, pushRuntimeLog, confirm, requireWriteAccess, renderHuntList, selectHunt, renderHuntWorkspace, updateHeaderStats, schedulePublicHuntLivePublish, LOCAL_SYNCED_KEY, STORAGE_KEY, invalidateCache, loadCloudProfile, runSupabaseHealthCheck, renderAdminPanel, flushFeedbackQueue, __activePage, supaHealth */
/* Sync hunts Supabase, cache local, circuit breaker — boot (index.html, après auth-cloud) */

function huntFromCloudRow(h) {
  const bonuses = (h.hunt_bonuses || []).slice().sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0)).map(b => ({
    id: String(b.id),
    slotId: b.slot_id || '',
    slotName: b.slot_name || 'Slot',
    slotProvider: b.provider || '',
    slotImage: b.slot_image || '',
    stake: Number(b.bet || 0),
    bonusType: b.bonus_type || 'normal',
    gamdomUrl: b.gamdom_url || '',
    win: b.win_value === null || typeof b.win_value === 'undefined' ? null : Number(b.win_value)
  }));
  return {
    id: h.id,
    name: h.name,
    casino: getCasinoKey(h.casino || inferCasinoFromBonuses(h.hunt_bonuses)),
    currency: h.currency || 'EUR',
    startBalance: Number(h.starting_balance || 0),
    startBalanceEUR: Number(h.start_balance_eur ?? h.starting_balance ?? 0),
    createdAt: h.created_at ? Date.parse(h.created_at) : Date.now(),
    bonuses
  };
}

async function cloudLoadHunts() {
  const c = getAuthClient();
  if (!c || !currentUser?.id) throw new Error('cloud client not ready');
  const { data, error } = await cloudCall('sync', () => c
    .from('hunts')
    .select('id,name,currency,starting_balance,start_balance_eur,created_at,archived,hunt_bonuses(id,slot_id,slot_name,provider,slot_image,bet,win,win_value,bonus_type,sort_order,gamdom_url)')
    .eq('user_id', currentUser.id)
    .eq('archived', false)
    .order('created_at', { ascending: false }), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  return (data || []).map(huntFromCloudRow);
}

/**
 * Fusionne les hunts cloud et locaux pour ne JAMAIS écraser un gain saisi
 * localement (ex. ouverture en cours) si le serveur n'a pas encore ce gain.
 * Stratégie : on garde la structure cloud (ids/bonus ids officiels) mais on
 * ré-applique les `win` locaux quand ils sont plus complets.
 * Stratégie indices : on essaie d'apparier les bonus par (slotId, sort_order),
 * puis (slotName, position), puis position seule.
 */
/**
 * @param {Record<string,string>} [localIdRemap] — après sync, ancien id local → id cloud (évite les doublons si l’id local n’était pas un UUID)
 */
function mergeCloudHuntsPreservingLocalWins(cloudHunts, localHunts, localIdRemap) {
  const safeCloud = Array.isArray(cloudHunts) ? cloudHunts : [];
  const safeLocal = Array.isArray(localHunts) ? localHunts : [];
  if (!safeCloud.length) return safeLocal.slice();
  const localById = new Map(safeLocal.map((h) => [String(h.id || ''), h]));
  const merged = safeCloud.map((ch) => {
    const lh = localById.get(String(ch.id || ''));
    if (!lh || !Array.isArray(lh.bonuses) || !lh.bonuses.length) return ch;
    const localBonuses = lh.bonuses;
    const usedLocalIdx = new Set();
    const matchLocalForCloud = (cb, posIdx) => {
      const cId = String(cb.slotId || '').toLowerCase();
      const cName = String(cb.slotName || '').toLowerCase().trim();
      let candidate = -1;
      if (cId) {
        candidate = localBonuses.findIndex((lb, i) => !usedLocalIdx.has(i) && String(lb.slotId || '').toLowerCase() === cId);
      }
      if (candidate < 0 && cName) {
        candidate = localBonuses.findIndex((lb, i) => !usedLocalIdx.has(i) && String(lb.slotName || '').toLowerCase().trim() === cName);
      }
      if (candidate < 0 && posIdx < localBonuses.length && !usedLocalIdx.has(posIdx)) {
        candidate = posIdx;
      }
      if (candidate >= 0) usedLocalIdx.add(candidate);
      return candidate >= 0 ? localBonuses[candidate] : null;
    };
    const bonuses = (ch.bonuses || []).map((cb, idx) => {
      const lb = matchLocalForCloud(cb, idx);
      if (!lb) return cb;
      const cWin = cb.win;
      const lWin = lb.win;
      const cloudHasWin = cWin !== null && typeof cWin !== 'undefined' && !isNaN(Number(cWin));
      const localHasWin = lWin !== null && typeof lWin !== 'undefined' && !isNaN(Number(lWin));
      // Priorité : si le local a un gain et pas le cloud, on garde le local.
      // Si les deux ont un gain et qu'ils diffèrent, on garde le local (saisie utilisateur la plus récente).
      let resolvedWin = cWin;
      if (localHasWin && (!cloudHasWin || Number(lWin) !== Number(cWin))) {
        resolvedWin = Number(lWin);
      }
      return { ...cb, win: resolvedWin };
    });
    return { ...ch, bonuses };
  });
  // Garder les hunts locaux qui ne sont pas (encore) côté cloud.
  const cloudIds = new Set(safeCloud.map((h) => String(h.id || '')));
  const remappedLocalIds = new Set();
  if (localIdRemap && typeof localIdRemap === 'object') {
    for (const k of Object.keys(localIdRemap)) {
      const oldId = String(k);
      const newId = String(localIdRemap[k] || '');
      if (newId && newId !== oldId && cloudIds.has(newId)) remappedLocalIds.add(oldId);
    }
  }
  safeLocal.forEach((lh) => {
    const lid = String(lh.id || '');
    if (cloudIds.has(lid)) return;
    if (remappedLocalIds.has(lid)) return;
    merged.push(lh);
  });
  return merged;
}

let cloudSyncTimer = null;
let cloudSyncInFlight = false;
let cloudSyncRequested = false;
let cloudSyncFailureCount = 0;
let cloudSyncDisabled = false;
let cloudSyncLastErrSig = '';

function isMissingReplaceHuntsRpc(err) {
  const msg = String(err?.message || err?.details || err?.hint || err || '').toLowerCase();
  return msg.includes('replace_user_hunts') && (msg.includes('not find') || msg.includes('does not exist') || msg.includes('could not find'));
}

function scheduleCloudSync(immediate = false) {
  if (!isCloudUser() || cloudSyncDisabled) return;
  if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
  const retryDelay = Math.min(12000, 900 * Math.max(1, cloudSyncFailureCount + 1));
  cloudSyncTimer = setTimeout(runCloudSync, immediate ? 0 : retryDelay);
}

async function runCloudSync() {
  if (!isCloudUser() || cloudSyncDisabled) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    scheduleCloudSync();
    return;
  }
  if (cloudSyncInFlight) { cloudSyncRequested = true; return; }
  cloudSyncInFlight = true;
  cloudSyncRequested = false;
  try {
    await cloudReplaceAllHunts(state.hunts);
    cloudSyncFailureCount = 0;
    cloudSyncLastErrSig = '';
    try { localStorage.setItem(LOCAL_SYNCED_KEY, '1'); } catch (_) {}
  } catch (e) {
    bhWarn('Cloud sync failed', e);
    pushRuntimeLog('error', `cloud sync: ${String(e?.message || e || 'unknown')}`);
    cloudSyncFailureCount++;
    const errSig = String(e?.message || e?.details || e?.hint || e || '').slice(0, 180);
    const shouldToast = cloudSyncFailureCount <= 2 || errSig !== cloudSyncLastErrSig;
    cloudSyncLastErrSig = errSig;
    if (isMissingReplaceHuntsRpc(e)) {
      cloudSyncDisabled = true;
      if (shouldToast) showToast('Sync cloud désactivée: RPC Supabase manquante (replace_user_hunts)', 'error', 5000);
    } else if (shouldToast) {
      showToast('Synchronisation cloud temporairement indisponible — données gardées en local', 'error', 3200);
    }
  } finally {
    cloudSyncInFlight = false;
    if (cloudSyncRequested && !cloudSyncDisabled) scheduleCloudSync(true);
  }
}

// Persistance transactionnelle des hunts via le RPC `replace_user_hunts`.
// L'opération est atomique côté serveur (un seul appel SQL) puis on recharge
// les hunts officielles pour récupérer les bonus IDs générés.
async function cloudReplaceAllHunts(localHunts) {
  const c = getAuthClient();
  if (!c || !currentUser?.id) throw new Error('cloud client not ready');

  const snapshot = JSON.parse(JSON.stringify(localHunts || []));
  const idMap = {};

  const huntsPayload = snapshot.map(hunt => {
    let cloudId = isUuidString(hunt.id) ? hunt.id : uuidLike();
    idMap[String(hunt.id)] = cloudId;
    const bonuses = (hunt.bonuses || []).map((b, i) => ({
      slot_id: b.slotId ? String(b.slotId) : '',
      slot_name: b.slotName || 'Slot',
      provider: b.slotProvider || '',
      slot_image: b.slotImage || '',
      bet: Number(b.stake || 0),
      win: b.win === null || typeof b.win === 'undefined' ? 0 : Number(b.win),
      win_value: b.win === null || typeof b.win === 'undefined' ? null : Number(b.win),
      bonus_type: b.bonusType || 'normal',
      gamdom_url: b.gamdomUrl || '',
      sort_order: i + 1
    }));
    return {
      id: cloudId,
      name: hunt.name || 'Hunt',
      currency: hunt.currency || 'EUR',
      starting_balance: Number(hunt.startBalance || 0) || 0.01,
      start_balance_eur: Number(hunt.startBalanceEUR || hunt.startBalance || 0),
      archived: false,
      created_at: hunt.createdAt ? new Date(hunt.createdAt).toISOString() : null,
      bonuses
    };
  });

  const { error: rpcErr } = await withTimeout(
    () => c.rpc('replace_user_hunts', { p_hunts: huntsPayload }),
    20000
  );
  if (rpcErr) {
    // Fallback robuste: certains environnements n'ont pas encore la RPC.
    if (isMissingReplaceHuntsRpc(rpcErr)) {
      await cloudReplaceAllHuntsFallback(c, huntsPayload);
    } else {
      throw rpcErr;
    }
  }

  // Recharge la source de vérité (avec les IDs bigint des bonuses).
  const fresh = await cloudLoadHunts();
  // Fusion défensive : si le serveur a perdu un win (latence/RPC), on garde la version locale.
  state.hunts = mergeCloudHuntsPreservingLocalWins(fresh, snapshot, idMap);

  if (state.activeHuntId && idMap[String(state.activeHuntId)]) {
    state.activeHuntId = idMap[String(state.activeHuntId)];
  }
  if (state.activeHuntId && !state.hunts.find(h => h.id === state.activeHuntId)) {
    state.activeHuntId = null;
  }

  writeLocalCache();
  return idMap;
}

async function cloudReplaceAllHuntsFallback(c, huntsPayload) {
  const payload = Array.isArray(huntsPayload) ? huntsPayload : [];
  const keepIds = payload.map((h) => String(h.id));

  // 1) Upsert des hunts (payload minimal compatible anciens schémas)
  const huntRows = payload.map((h) => ({
    id: h.id,
    user_id: currentUser.id,
    name: h.name || 'Hunt',
    currency: h.currency || 'EUR',
    starting_balance: Number(h.starting_balance || 0) || 0.01
  }));
  if (huntRows.length) {
    const { error } = await withTimeout(
      () => c.from('hunts').upsert(huntRows, { onConflict: 'id' }),
      20000
    );
    if (error) throw error;
  }

  // 2) Supprime les hunts retirés côté local
  const { data: existing, error: existingErr } = await withTimeout(
    () => c.from('hunts').select('id').eq('user_id', currentUser.id).eq('archived', false),
    12000
  );
  if (existingErr) throw existingErr;
  const toDelete = (existing || []).map((r) => String(r.id)).filter((id) => !keepIds.includes(id));
  for (const huntId of toDelete) {
    const { error } = await withTimeout(() => c.from('hunts').delete().eq('id', huntId), 12000);
    if (error) throw error;
  }

  // 3) Remplace les bonus pour chaque hunt (delete + insert ordonné, minimal)
  for (const h of payload) {
    const huntId = String(h.id);
    const { error: delErr } = await withTimeout(() => c.from('hunt_bonuses').delete().eq('hunt_id', huntId), 15000);
    if (delErr) throw delErr;
    const rows = (h.bonuses || []).map((b, i) => ({
      hunt_id: huntId,
      slot_name: b.slot_name || 'Slot',
      provider: b.provider || '',
      bet: Number(b.bet || 0) || 0.01,
      win: b.win === null || typeof b.win === 'undefined' ? 0 : Number(b.win),
      bonus_type: b.bonus_type || 'normal',
      sort_order: Number(b.sort_order || (i + 1))
    }));
    if (rows.length) {
      const { error: insErr } = await withTimeout(() => c.from('hunt_bonuses').insert(rows), 20000);
      if (insErr) throw insErr;
    }
  }
}

function writeLocalCache() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      hunts: state.hunts,
      activeHuntId: state.activeHuntId,
      catalogMode: state.catalogMode,
      bonusView: state.bonusView
    }));
  } catch (e) { bhWarn('LocalStorage save failed', e); }
}

function save() {
  writeLocalCache();
  createAutoSnapshot('save');
  if (isCloudUser()) {
    try { localStorage.setItem(LOCAL_SYNCED_KEY, '0'); } catch (_) {}
    scheduleCloudSync();
    schedulePublicHuntLivePublish();
  }
}

function applyHistorySnapshot(snapshot) {
  state.hunts = JSON.parse(JSON.stringify(snapshot?.hunts || []));
  state.activeHuntId = snapshot?.activeHuntId || null;
  save();
  renderHuntList();
  if (state.activeHuntId) {
    const exists = state.hunts.find((h) => h.id === state.activeHuntId);
    if (exists) {
      document.getElementById('no-hunt-selected').style.display = 'none';
      document.getElementById('hunt-workspace').classList.remove('hidden');
      renderHuntWorkspace();
      return;
    }
  }
  document.getElementById('hunt-workspace').classList.add('hidden');
  document.getElementById('no-hunt-selected').style.display = 'flex';
  updateHeaderStats(null);
}

function setUndoSnapshot(reason = '') {
  undoStack.push({
    reason,
    hunts: JSON.parse(JSON.stringify(state.hunts)),
    activeHuntId: state.activeHuntId
  });
  if (undoStack.length > HISTORY_STACK_LIMIT) undoStack = undoStack.slice(-HISTORY_STACK_LIMIT);
  redoStack = [];
}

function runUndo() {
  if (!requireWriteAccess('Undo bloqué')) return;
  if (!undoStack.length) { showToast('Aucune action à annuler', 'info'); return; }
  const prev = undoStack.pop();
  redoStack.push({
    reason: 'redo',
    hunts: JSON.parse(JSON.stringify(state.hunts)),
    activeHuntId: state.activeHuntId
  });
  if (redoStack.length > HISTORY_STACK_LIMIT) redoStack = redoStack.slice(-HISTORY_STACK_LIMIT);
  applyHistorySnapshot(prev);
  showToast(`Action annulée${prev.reason ? ` (${prev.reason})` : ''}`, 'success');
}
function runRedo() {
  if (!requireWriteAccess('Redo bloqué')) return;
  if (!redoStack.length) { showToast('Aucune action à rétablir', 'info'); return; }
  const next = redoStack.pop();
  undoStack.push({
    reason: 'undo',
    hunts: JSON.parse(JSON.stringify(state.hunts)),
    activeHuntId: state.activeHuntId
  });
  if (undoStack.length > HISTORY_STACK_LIMIT) undoStack = undoStack.slice(-HISTORY_STACK_LIMIT);
  applyHistorySnapshot(next);
  showToast('Action rétablie', 'success');
}
function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    state.hunts = d.hunts || [];
    state.activeHuntId = d.activeHuntId || null;
    state.catalogMode = d.catalogMode === 'extended' ? 'extended' : 'gamdom';
    state.bonusView = {
      status: 'all',
      type: 'all',
      winFilter: 'all',
      sort: 'order',
      q: '',
      provider: '',
      minStake: '',
      maxStake: '',
      ...(d.bonusView || {})
    };
  } catch(e) { state.hunts = []; state.activeHuntId = null; }
}

let __loadInFlight = null;
async function load() {
  if (__loadInFlight) return __loadInFlight;
  __loadInFlight = (async () => {
  loadLocal();

  const applyBonusDedupeAfterLoad = () => {
    const r = dedupeAllHuntsBonuses();
    if (r > 0) {
      save();
      showToast(`${r} bonus en double retirés (même machine)`, 'info', 4500);
    }
  };

  if (!isCloudUser()) {
    applyBonusDedupeAfterLoad();
    return;
  }

  let isSynced = false;
  try { isSynced = localStorage.getItem(LOCAL_SYNCED_KEY) === '1'; } catch (_) {}

  if (!isSynced && Array.isArray(state.hunts) && state.hunts.length > 0) {
    try {
      await cloudReplaceAllHunts(state.hunts);
      try { localStorage.setItem(LOCAL_SYNCED_KEY, '1'); } catch (_) {}
      showToast(`${state.hunts.length} hunt(s) local(aux) migré(s) vers ton compte cloud`, 'success', 3500);
    } catch (e) {
      bhWarn('Initial cloud migration failed', e);
      if (isMissingReplaceHuntsRpc(e)) {
        cloudSyncDisabled = true;
        showToast('Sync cloud inactive: RPC replace_user_hunts absente dans Supabase', 'error', 5000);
      } else {
        showToast('Migration cloud échouée — les hunts restent en local', 'error', 4000);
      }
      applyBonusDedupeAfterLoad();
      return;
    }
  }

  try {
    const localSnapshot = JSON.parse(JSON.stringify(state.hunts || []));
    const cloudHunts = await cloudLoadHunts();
    state.hunts = mergeCloudHuntsPreservingLocalWins(cloudHunts, localSnapshot);
    if (state.activeHuntId && !state.hunts.find(h => h.id === state.activeHuntId)) {
      state.activeHuntId = state.hunts[0]?.id || null;
    } else if (!state.activeHuntId && state.hunts.length) {
      state.activeHuntId = state.hunts[0].id;
    }
    writeLocalCache();
    try { localStorage.setItem(LOCAL_SYNCED_KEY, '1'); } catch (_) {}
  } catch (e) {
    bhWarn('Cloud load failed, using local cache', e);
  }
  applyBonusDedupeAfterLoad();
  })();
  try {
    return await __loadInFlight;
  } finally {
    __loadInFlight = null;
  }
}

// ═══════════════════════════════════════════════

let netBannerEl = null;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
async function withTimeout(promiseFactory, timeoutMs = 9000) {
  let to = null;
  const timeout = new Promise((_, reject) => {
    to = setTimeout(() => reject(new Error(`Timeout ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promiseFactory(), timeout]);
  } finally {
    clearTimeout(to);
  }
}
const cloudCircuit = {
  auth: { failures: 0, openUntil: 0, lastSig: '' },
  profile: { failures: 0, openUntil: 0, lastSig: '' },
  admin: { failures: 0, openUntil: 0, lastSig: '' },
  sync: { failures: 0, openUntil: 0, lastSig: '' }
};
function getCircuitState(bucket = 'sync') {
  if (!cloudCircuit[bucket]) cloudCircuit[bucket] = { failures: 0, openUntil: 0, lastSig: '' };
  return cloudCircuit[bucket];
}
function markCircuitFailure(bucket = 'sync', err) {
  const c = getCircuitState(bucket);
  c.failures += 1;
  const ms = Math.min(30000, 1200 * Math.max(1, c.failures));
  c.openUntil = Date.now() + ms;
  c.lastSig = String(err?.message || err?.details || err?.hint || err || '').slice(0, 180);
  return c;
}
function markCircuitSuccess(bucket = 'sync') {
  const c = getCircuitState(bucket);
  c.failures = 0;
  c.openUntil = 0;
  c.lastSig = '';
}
async function cloudCall(bucket, fn, {
  retries = 1,
  timeoutMs = 12000,
  delayMs = 400,
  quiet = false,
  fallback = null
} = {}) {
  const c = getCircuitState(bucket);
  const now = Date.now();
  if (c.openUntil > now) {
    if (typeof fallback === 'function') return await fallback();
    throw new Error(`Circuit ${bucket} ouvert (${Math.ceil((c.openUntil - now) / 1000)}s)`);
  }
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    if (!quiet) showNetBanner('Mode hors ligne: appels cloud en attente', true);
    if (typeof fallback === 'function') return await fallback();
    throw new Error('Offline');
  }
  try {
    const out = await retryAsync(() => withTimeout(fn, timeoutMs), { retries, delayMs });
    markCircuitSuccess(bucket);
    if (!quiet) hideNetBanner();
    return out;
  } catch (err) {
    const prevSig = c.lastSig;
    const next = markCircuitFailure(bucket, err);
    if (!quiet && (next.failures <= 2 || next.lastSig !== prevSig)) {
      showNetBanner(`Réseau cloud instable (${bucket})`, true);
    }
    if (typeof fallback === 'function') return await fallback();
    throw err;
  }
}
function getCloudUiStatus() {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    return { key: 'offline', label: 'OFFLINE', color: '#ff9fb1', detail: 'Connexion perdue' };
  }
  if (cloudSyncDisabled) {
    return { key: 'degraded', label: 'DEGRADE', color: '#ffd38a', detail: 'Sync cloud partielle (fallback local)' };
  }
  const buckets = ['auth', 'profile', 'admin', 'sync'];
  const opened = buckets.some((b) => getCircuitState(b).openUntil > Date.now());
  if (opened || supaHealth.db === 'degraded' || supaHealth.auth === 'down' || supaHealth.client === 'down') {
    return { key: 'degraded', label: 'DEGRADE', color: '#ffd38a', detail: 'Cloud instable, retries actifs' };
  }
  return { key: 'online', label: 'ONLINE', color: '#8fffc3', detail: 'Cloud stable' };
}
async function handleConnectionRestored() {
  if (!isCloudUser()) return;
  markCircuitSuccess('auth');
  markCircuitSuccess('profile');
  markCircuitSuccess('admin');
  markCircuitSuccess('sync');
  invalidateCache('admin');
  if (currentUser?.id) invalidateCache('profile', String(currentUser.id));
  try {
    await runSupabaseHealthCheck(true);
  } catch (_) {}
  try {
    await loadCloudProfile(currentUser.id, { force: true });
  } catch (_) {}
  try {
    if (!cloudSyncDisabled) scheduleCloudSync(true);
  } catch (_) {}
  if (__activePage === 'admin') {
    renderAdminPanel().catch(() => {});
  }
  flushFeedbackQueue().catch(() => {});
}
async function retryAsync(fn, { retries = 2, delayMs = 380 } = {}) {
  let lastErr = null;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (i < retries) await sleep(delayMs * (i + 1));
    }
  }
  throw lastErr;
}

let lastSnapshotAt = 0;
let undoStack = [];
let redoStack = [];
const HISTORY_STACK_LIMIT = 40;

function createAutoSnapshot(reason = 'save') {
  try {
    const now = Date.now();
    if (now - lastSnapshotAt < 60000) return;
    lastSnapshotAt = now;
    const snaps = getAutoSnapshots();
    snaps.unshift({
      ts: now,
      reason: String(reason || 'save').slice(0, 40),
      activeHuntId: state.activeHuntId,
      hunts: JSON.parse(JSON.stringify(state.hunts || []))
    });
    localStorage.setItem(AUTO_SNAPSHOT_KEY, JSON.stringify(snaps.slice(0, 25)));
  } catch (_) {}
}
function restoreLatestSnapshot() {
  const snaps = getAutoSnapshots();
  if (!snaps.length) { showToast('Aucun snapshot disponible', 'error'); return; }
  const s = snaps[0];
  const ok = confirm('Restaurer le dernier snapshot ?', `Snapshot ${new Date(s.ts).toLocaleString('fr-FR')} (${s.reason})`);
  if (!ok) return;
  state.hunts = Array.isArray(s.hunts) ? s.hunts : [];
  state.activeHuntId = s.activeHuntId || (state.hunts[0]?.id || null);
  save();
  renderHuntList();
  if (state.activeHuntId) selectHunt(state.activeHuntId);
  else {
    const nh = document.getElementById('no-hunt-selected');
    const ws = document.getElementById('hunt-workspace');
    if (nh) nh.style.display = 'flex';
    if (ws) ws.classList.add('hidden');
  }
  showToast('Snapshot restauré', 'success');
}
