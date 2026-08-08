'use strict';
/* globals showToast, showAuth, escapeHtml, fmt, fmtVirtual, isSafeUrl, isCurrentUserAdmin, isCloudUser, currentUser, state, getAuthClient, cloudCall, invalidateCache, bhWarn, mapAuthError, actionGuardAcquire, getUsers, saveUsers, saveSession, updateLobbyBalance, renderProfileBadge, getMaintenanceConfig, refreshMaintenanceConfig, MAINTENANCE_DEFAULT, getOpsAlertsConfig, saveOpsAlertsConfig, sendOpsAlert, pushLocalAdminAudit, pushRuntimeLog, buildSlotHuntPrefillUrl, confirm, fetchTournoi, renderTournoiLeaderboard, adminVerifyTournoiEntry, adminRejectTournoiEntry, addNewsSlotToHunt, setSlotOfTheWeek, invalidateNewsCache, renderMaintenanceBanner, getCloudUiStatus */
/* Panel admin + modération tournoi + slots manuelles — lazy via LAZY_PAGE_SCRIPTS */

const adminViewState = {
  q: '',
  role: 'all',
  sort: 'name_asc',
  page: 1,
  pageSize: 8
};

let adminTournoiSelection = new Set();

function adminTournoiToggle(id, checked) {
  const sid = String(id || '');
  if (!sid) return;
  if (checked) adminTournoiSelection.add(sid);
  else adminTournoiSelection.delete(sid);
}

function adminTournoiToggleAll(checked) {
  document.querySelectorAll('.admin-tournoi-cb').forEach((el) => {
    el.checked = !!checked;
    adminTournoiToggle(el.value, checked);
  });
}

function getAdminTournoiSelectedIds() {
  return Array.from(adminTournoiSelection);
}

async function adminBatchModerateTournoi(action) {
  if (!isCurrentUserAdmin()) return;
  const ids = getAdminTournoiSelectedIds();
  if (!ids.length) {
    showToast('Sélectionne au moins une entrée', 'info', 2200);
    return;
  }
  if (action === 'reject') {
    const ok = typeof confirm === 'function'
      ? await confirm(`Refuser ${ids.length} entrée(s) ?`, 'Elles seront retirées du classement en attente.')
      : true;
    if (!ok) return;
  }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  try {
    const { data, error } = await cloudCall('admin', () => c.rpc('admin_moderate_tournament_entries', {
      p_entry_ids: ids,
      p_action: action
    }), { retries: 1, timeoutMs: 15000, delayMs: 400 });
    if (error) throw error;
    const n = Number(data?.count || 0);
    adminTournoiSelection.clear();
    showToast(
      action === 'verify' ? `${n} entrée(s) validée(s)` : `${n} entrée(s) refusée(s)`,
      action === 'verify' ? 'success' : 'info',
      2800
    );
    if (typeof renderAdminPanel === 'function') await renderAdminPanel();
    if (typeof fetchTournoi === 'function') await fetchTournoi();
    if (typeof renderTournoiLeaderboard === 'function') renderTournoiLeaderboard();
  } catch (e) {
    bhWarn('adminBatchModerateTournoi', e);
    let done = 0;
    for (const id of ids) {
      try {
        if (action === 'verify' && typeof adminVerifyTournoiEntry === 'function') {
          await adminVerifyTournoiEntry(id, true);
          done += 1;
        } else if (action === 'reject' && typeof adminRejectTournoiEntry === 'function') {
          await adminRejectTournoiEntry(id);
          done += 1;
        }
      } catch (_) {}
    }
    adminTournoiSelection.clear();
    if (done > 0) {
      showToast(`${done} entrée(s) traitée(s) (mode secours)`, done === ids.length ? 'success' : 'info', 2800);
      if (typeof renderAdminPanel === 'function') await renderAdminPanel();
    } else {
      showToast(mapAuthError(e) || 'Modération en lot impossible — migration admin_dashboard ?', 'error', 4000);
    }
  }
}

async function adminFetchPendingTournoiEntries() {
  const c = getAuthClient();
  if (!c || !isCurrentUserAdmin()) return [];
  try {
    const { data, error } = await cloudCall('admin', () => c.from('tournament_entries')
      .select('id,hunt_name,player_name,gain,mise,multiplier,replay_url,verified,created_at,user_id')
      .eq('verified', false)
      .order('created_at', { ascending: false })
      .limit(40), { retries: 1, timeoutMs: 12000, quiet: true });
    if (error) throw error;
    return data || [];
  } catch (e) {
    bhWarn('adminFetchPendingTournoiEntries', e);
    return [];
  }
}

async function renderAdminTournoiTable() {
  const wrap = document.getElementById('admin-tournoi-table');
  if (!wrap) return;
  if (!isCurrentUserAdmin() || !currentUser?.cloud) {
    wrap.innerHTML = '<div class="bj-rec">Réservé aux admins cloud.</div>';
    return;
  }
  wrap.innerHTML = '<div class="bj-rec">Chargement des soumissions…</div>';
  const rows = await adminFetchPendingTournoiEntries();
  if (!rows.length) {
    wrap.innerHTML = '<div class="bj-rec">Aucune entrée en attente de validation.</div>';
    return;
  }
  wrap.innerHTML = `
    <div class="admin-tournoi-batch">
      <label class="admin-tournoi-select-all"><input type="checkbox" onchange="adminTournoiToggleAll(this.checked)"> Tout</label>
      <button type="button" class="profile-mini-btn primary" onclick="adminBatchModerateTournoi('verify')">Valider la sélection</button>
      <button type="button" class="profile-mini-btn danger" onclick="adminBatchModerateTournoi('reject')">Refuser la sélection</button>
      <span class="bj-rec">${rows.length} en attente</span>
    </div>
    <div class="table-wrap">
      <table class="admin-tournoi-table">
        <thead><tr>
          <th></th><th>Date</th><th>Joueur</th><th>Hunt</th><th>Gain</th><th>Multi</th><th>Replay</th><th>Actions</th>
        </tr></thead>
        <tbody>${rows.map((r) => {
          const rid = String(r.id);
          const checked = adminTournoiSelection.has(rid) ? 'checked' : '';
          const replay = r.replay_url && isSafeUrl(r.replay_url)
            ? `<a href="${escapeHtml(r.replay_url)}" target="_blank" rel="noopener noreferrer">Voir</a>`
            : '<span class="tournoi-replay-missing">Manquant</span>';
          return `<tr>
            <td><input type="checkbox" class="admin-tournoi-cb" value="${escapeHtml(rid)}" ${checked} onchange="adminTournoiToggle('${escapeHtml(rid)}', this.checked)"></td>
            <td>${escapeHtml(new Date(r.created_at).toLocaleDateString('fr-FR'))}</td>
            <td>${escapeHtml(r.player_name || '—')}</td>
            <td>${escapeHtml(r.hunt_name || '—')}</td>
            <td>${fmt(r.gain)} / ${fmt(r.mise)}</td>
            <td>×${Number(r.multiplier || 0).toFixed(2)}</td>
            <td>${replay}</td>
            <td class="admin-tournoi-actions">
              <button type="button" class="profile-mini-btn primary" onclick="adminVerifyTournoiEntry('${escapeHtml(rid)}', true)">Valider</button>
              <button type="button" class="profile-mini-btn danger" onclick="adminRejectTournoiEntry('${escapeHtml(rid)}')">Refuser</button>
            </td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}


function getAdminSlotDraft() {
  return {
    title: String(document.getElementById('admin-slot-title')?.value || '').trim(),
    provider: String(document.getElementById('admin-slot-provider')?.value || '').trim(),
    image: String(document.getElementById('admin-slot-image')?.value || '').trim(),
    url: String(document.getElementById('admin-slot-url')?.value || '').trim(),
    summary: String(document.getElementById('admin-slot-summary')?.value || '').trim(),
  };
}

function syncAdminSlotPreview() {
  const wrap = document.getElementById('admin-slot-preview-wrap');
  const img = document.getElementById('admin-slot-preview-img');
  const linkEl = document.getElementById('admin-slot-prefill-link');
  const draft = getAdminSlotDraft();
  const src = draft.image && typeof isSafeUrl === 'function' && isSafeUrl(draft.image) ? draft.image : '';
  if (wrap && img) {
    if (src) {
      wrap.classList.remove('hidden');
      img.src = src;
    } else {
      wrap.classList.add('hidden');
      img.removeAttribute('src');
    }
  }
  if (linkEl) {
    const huntUrl = buildSlotHuntPrefillUrl(draft);
    if (huntUrl && draft.title) {
      linkEl.style.display = '';
      linkEl.innerHTML = `Lien hunt pré-rempli (Discord) : <a href="${escapeHtml(huntUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(huntUrl)}</a>`;
    } else {
      linkEl.style.display = 'none';
      linkEl.innerHTML = '';
    }
  }
}

function adminPreviewSlotToHunt() {
  const draft = getAdminSlotDraft();
  if (!draft.title) {
    showToast('Renseigne le nom de la slot', 'error');
    return;
  }
  if (typeof addNewsSlotToHunt === 'function') {
    addNewsSlotToHunt({
      title: draft.title,
      provider: draft.provider,
      image: draft.image,
      url: draft.url,
    });
  }
}


function resetAdminSlotForm() {
  ['admin-slot-title', 'admin-slot-provider', 'admin-slot-image', 'admin-slot-url', 'admin-slot-summary'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const st = document.getElementById('admin-slot-status');
  if (st) st.textContent = '';
  syncAdminSlotPreview();
}

function slugifyForSlotRelease(title, provider) {
  const raw = `${provider || ''} ${title || ''}`.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const slug = raw.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);
  return `manual-${slug || Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
}

async function adminPostManualSlot() {
  if (!isCurrentUserAdmin() || !currentUser?.cloud) { showToast('Réservé aux admins cloud', 'error'); return; }
  const title = String(document.getElementById('admin-slot-title')?.value || '').trim();
  const provider = String(document.getElementById('admin-slot-provider')?.value || '').trim();
  const image = String(document.getElementById('admin-slot-image')?.value || '').trim();
  const url = String(document.getElementById('admin-slot-url')?.value || '').trim();
  const summary = String(document.getElementById('admin-slot-summary')?.value || '').trim();
  const statusEl = document.getElementById('admin-slot-status');
  if (!title) { if (statusEl) statusEl.innerHTML = `<span style="color:#ff9fb1;">Le nom de la slot est obligatoire.</span>`; return; }
  const g = actionGuardAcquire('admin:slot_release', { limit: 20, windowMs: 60_000, blockMs: 30_000 });
  if (g.blocked) { showToast(`Trop d’actions. Réessaie dans ${g.waitSec}s.`, 'error'); return; }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  if (statusEl) statusEl.textContent = 'Publication…';
  try {
    const payload = {
      source: 'manual',
      slug: slugifyForSlotRelease(title, provider),
      title,
      provider: provider || null,
      image: image || null,
      summary: summary || null,
      url: url || null,
      created_by: currentUser.id || null,
      published_at: new Date().toISOString()
    };
    const { data, error } = await cloudCall('admin', () => c.from('slot_releases').insert(payload).select('id').single(), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
    if (error) throw error;
    if (data?.id && typeof setSlotOfTheWeek === 'function') setSlotOfTheWeek(data.id);
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--green);">✔ Publiée. Le bot Discord la postera dans les 60 secondes.</span>`;
    showToast('Slot publiée', 'success');
    resetAdminSlotForm();
    invalidateNewsCache();
    await loadAdminRecentSlots();
  } catch (e) {
    if (statusEl) statusEl.innerHTML = `<span style="color:#ff9fb1;">${escapeHtml(mapAuthError(e))}</span>`;
    showToast(mapAuthError(e), 'error');
  }
}

async function loadAdminRecentSlots() {
  const wrap = document.getElementById('admin-recent-slots');
  if (!wrap) return;
  if (!isCurrentUserAdmin() || !currentUser?.cloud) { wrap.innerHTML = ''; return; }
  const c = getAuthClient();
  if (!c) return;
  wrap.innerHTML = `<div class="bj-rec">Chargement des dernières slots…</div>`;
  try {
    const { data, error } = await cloudCall('admin', () => c
      .from('slot_releases')
      .select('id,source,title,provider,published_at,posted_to_discord_at,url')
      .order('published_at', { ascending: false })
      .limit(10), { retries: 1, timeoutMs: 10000, delayMs: 400, quiet: true });
    if (error) throw error;
    const rows = (data || []).map((s) => `
      <tr>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(new Date(s.published_at).toLocaleString('fr-FR'))}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(s.source || '—')}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(s.title || '—')}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(s.provider || '—')}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${s.posted_to_discord_at ? `<span style="color:var(--green);">✔</span>` : `<span style="color:var(--text-dim);">en file</span>`}</td>
        <td style="padding:8px;border-top:1px solid var(--border);">${s.url ? `<a href="${escapeHtml(s.url)}" target="_blank" rel="noopener noreferrer">lien</a>` : '—'}</td>
        <td style="padding:8px;border-top:1px solid var(--border);"><button type="button" class="profile-mini-btn" onclick="setSlotOfTheWeek('${escapeHtml(s.id)}');showToast('Slot de la semaine définie','success',1800);">Semaine</button></td>
      </tr>
    `).join('');
    wrap.innerHTML = `
      <div class="mise-section-title" style="margin:6px 0 6px;">DERNIÈRES SLOTS</div>
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;">Date</th>
              <th style="text-align:left;padding:8px;">Source</th>
              <th style="text-align:left;padding:8px;">Slot</th>
              <th style="text-align:left;padding:8px;">Provider</th>
              <th style="text-align:left;padding:8px;">Discord</th>
              <th style="text-align:left;padding:8px;">URL</th>
              <th style="text-align:left;padding:8px;">Semaine</th>
            </tr>
          </thead>
          <tbody>${rows || `<tr><td colspan="6" style="padding:10px;color:var(--text-dim);">Aucune slot encore publiée.</td></tr>`}</tbody>
        </table>
      </div>`;
  } catch (e) {
    wrap.innerHTML = `<div class="bj-rec" style="color:#ff9fb1;">${escapeHtml(mapAuthError(e))}</div>`;
  }
}


function adminSetBalancePrompt(username) {
  adminSetBalancePromptAsync(username).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminAdjustBalance(username, delta) {
  adminAdjustBalanceAsync(username, delta).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminAdjustBalanceFromInput(username) {
  const key = encodeURIComponent(String(username || ''));
  const input = document.getElementById(`admin-user-delta-${key}`);
  if (!input) return;
  const amount = Number(String(input.value || '').replace(',', '.'));
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) {
    showToast('Montant invalide', 'error');
    return;
  }
  adminAdjustBalanceAsync(username, amount)
    .then(() => { input.value = ''; })
    .catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminApplyPointsDropAll(onlyPlayers = false) {
  adminApplyPointsDropAllAsync(onlyPlayers).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminToggleUserRole(username) {
  adminToggleUserRoleAsync(username).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminDeleteHuntById(huntId) {
  adminDeleteHuntByIdAsync(huntId).catch((e) => showToast(mapAuthError(e), 'error'));
}
function adminSetMaintenanceMode() {
  if (!isCurrentUserAdmin()) return;
  const enabledEl = document.getElementById('admin-maint-enabled');
  const msgEl = document.getElementById('admin-maint-msg');
  const enabled = !!(enabledEl && enabledEl.checked);
  const message = String(msgEl?.value || MAINTENANCE_DEFAULT.message).trim();
  const c = getAuthClient();
  if (!c) {
    showToast('Supabase indisponible — maintenance serveur non modifiable', 'error');
    return;
  }
  cloudCall('admin', () => c.rpc('admin_set_maintenance', {
    p_enabled: enabled,
    p_message: message
  }), { retries: 1, timeoutMs: 12000, delayMs: 400 })
    .then(async ({ error }) => {
      if (error) throw error;
      await refreshMaintenanceConfig(true);
      pushLocalAdminAudit('admin_maintenance', `${enabled ? 'ON' : 'OFF'} ${message}`);
      showToast(enabled ? 'Mode maintenance activé (serveur)' : 'Mode maintenance désactivé', enabled ? 'info' : 'success');
      renderAdminPanel();
    })
    .catch((e) => showToast(mapAuthError(e) || 'Maintenance serveur — appliquez la migration SQL', 'error', 4000));
}
function adminSaveOpsAlerts() {
  if (!isCurrentUserAdmin()) return;
  const enabledEl = document.getElementById('admin-ops-enabled');
  const urlEl = document.getElementById('admin-ops-webhook');
  const enabled = !!(enabledEl && enabledEl.checked);
  const webhookUrl = String(urlEl?.value || '').trim();
  saveOpsAlertsConfig({ enabled, webhookUrl });
  pushLocalAdminAudit('admin_ops_alerts', `${enabled ? 'ON' : 'OFF'} ${webhookUrl ? 'webhook-set' : 'no-webhook'}`);
  showToast('Alerting ops sauvegardé', 'success', 1500);
}
async function adminTestOpsWebhook() {
  if (!isCurrentUserAdmin()) return;
  const cfg = getOpsAlertsConfig();
  if (!cfg.enabled) { showToast('Active d’abord l’alerting ops', 'info', 2400); return; }
  if (!/^https?:\/\//i.test(cfg.webhookUrl || '')) { showToast('URL webhook invalide', 'error'); return; }
  const r = await sendOpsAlert('info', 'Test webhook ops HugoTaSlot — ping depuis le panel admin', { force: true, test: true, source: 'admin_test' });
  if (r.ok) showToast('Webhook : test envoyé avec succès', 'success', 2800);
  else showToast(`Webhook échec (${r.reason})`, 'error', 4200);
}
function adminFireTestProdError() {
  if (!isCurrentUserAdmin()) return;
  pushRuntimeLog('error', 'TEST PROD — erreur simulée admin (chemin alerting ops réel)');
  showToast('Erreur prod simulée loggée — vérifie Discord/Slack si alerting activé', 'info', 3500);
}
async function adminFetchDashboardStats() {
  const c = getAuthClient();
  if (!c || !isCurrentUserAdmin()) return null;
  try {
    const { data, error } = await cloudCall('admin', () => c.rpc('get_admin_dashboard_stats'), {
      retries: 1,
      timeoutMs: 12000,
      delayMs: 300,
      quiet: true
    });
    if (error) throw error;
    return data && typeof data === 'object' ? data : null;
  } catch (e) {
    bhWarn('adminFetchDashboardStats', e);
    return null;
  }
}
async function adminSetBalancePromptAsync(username) {
  if (!isCurrentUserAdmin()) return;
  const g = actionGuardAcquire('admin:set_balance', { limit: 8, windowMs: 60000, blockMs: 90000 });
  if (g.blocked) { showToast(`Action temporairement bloquée (${g.waitSec}s)`, 'error'); return; }
  if (currentUser && currentUser.cloud) {
    const data = await adminFetchCloudUsers();
    const rec = data.find(u => (u.username || '').toLowerCase() === String(username || '').toLowerCase());
    if (!rec) return;
    const val = prompt(`Nouveau solde pour ${username}`, String(Number(rec.balance || 0).toFixed(2)));
    if (val === null) return;
    const next = Number(val);
    if (!Number.isFinite(next) || next < 0) { showToast('Solde invalide', 'error'); return; }
    const c = getAuthClient();
    const { error } = await cloudCall('admin', () => c.rpc('admin_set_balance', {
      p_user_id: rec.id,
      p_amount: Number(next.toFixed(2)),
      p_reason: 'admin panel set balance'
    }), { retries: 1, timeoutMs: 12000, delayMs: 500 });
    if (error) throw error;
    invalidateCache('admin');
    invalidateCache('profile', String(rec.id));
    if (currentUser.id === rec.id) {
      currentUser.balance = Number(next.toFixed(2));
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
    await renderAdminPanel();
    pushLocalAdminAudit('admin_set_balance', `${username} -> ${Number(next.toFixed(2))}`);
    showToast(`Solde cloud mis à jour pour ${username}`, 'success');
    return;
  }
  const users = getUsers();
  const rec = users[username];
  if (!rec) return;
  const val = prompt(`Nouveau solde pour ${username}`, String(Number(rec.balance || 0).toFixed(2)));
  if (val === null) return;
  const next = Number(val);
  if (!Number.isFinite(next) || next < 0) { showToast('Solde invalide', 'error'); return; }
  rec.balance = Number(next.toFixed(2));
  saveUsers(users);
  if (currentUser && currentUser.username === username) {
    currentUser.balance = rec.balance;
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_set_balance_local', `${username} -> ${rec.balance}`);
  showToast(`Solde mis à jour pour ${username}`, 'success');
}
async function adminAdjustBalanceAsync(username, delta) {
  if (!isCurrentUserAdmin()) return;
  const amount = Number(delta || 0);
  if (!Number.isFinite(amount) || Math.abs(amount) < 0.005) return;
  if (currentUser && currentUser.cloud) {
    const data = await adminFetchCloudUsers();
    const rec = data.find(u => (u.username || '').toLowerCase() === String(username || '').toLowerCase());
    if (!rec) return;
    const isSelf = String(currentUser.id || '') === String(rec.id || '') || String(currentUser.username || '').toLowerCase() === String(username || '').toLowerCase();
    const baseBalance = isSelf ? Number(currentUser.balance || 0) : Number(rec.balance || 0);
    const next = Math.max(0, baseBalance + amount);
    const c = getAuthClient();
    const { error } = await cloudCall('admin', () => c.rpc('admin_set_balance', {
      p_user_id: rec.id,
      p_amount: Number(next.toFixed(2)),
      p_reason: `admin quick adjust ${amount >= 0 ? '+' : ''}${amount.toFixed(2)}`
    }), { retries: 1, timeoutMs: 12000, delayMs: 500 });
    if (error) throw error;
    invalidateCache('admin');
    invalidateCache('profile', String(rec.id));
    if (currentUser.id === rec.id) {
      currentUser.balance = Number(next.toFixed(2));
      saveSession(currentUser);
      updateLobbyBalance();
      renderProfileBadge();
    }
    await renderAdminPanel();
    pushLocalAdminAudit('admin_adjust_balance', `${username} ${amount >= 0 ? '+' : ''}${amount.toFixed(2)} -> ${next.toFixed(2)}`);
    showToast(`Solde ajusté pour ${username}`, 'success', 1400);
    return;
  }
  const users = getUsers();
  const rec = users[username];
  if (!rec) return;
  rec.balance = Math.max(0, Number(rec.balance || 0) + amount);
  saveUsers(users);
  if (currentUser && currentUser.username === username) {
    currentUser.balance = rec.balance;
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_adjust_balance_local', `${username} ${amount >= 0 ? '+' : ''}${amount.toFixed(2)} -> ${rec.balance.toFixed(2)}`);
  showToast(`Solde ajusté pour ${username}`, 'success', 1400);
}
async function adminApplyPointsDropAllAsync(onlyPlayers = false) {
  if (!isCurrentUserAdmin()) return;
  const input = document.getElementById('admin-drop-amount');
  const amount = Number(input?.value || 0);
  if (!Number.isFinite(amount) || amount <= 0) { showToast('Montant de drop invalide', 'error'); return; }
  const g = actionGuardAcquire('admin:drop_points', { limit: 4, windowMs: 60000, blockMs: 90000 });
  if (g.blocked) { showToast(`Action temporairement bloquée (${g.waitSec}s)`, 'error'); return; }
  if (!(await confirm(`Distribuer +${fmtVirtual(amount)} ${onlyPlayers ? 'aux joueurs uniquement' : 'à tous les comptes'} ?`, 'Cette action impacte les soldes de plusieurs comptes.'))) return;

  if (currentUser && currentUser.cloud) {
    const users = await adminFetchCloudUsers();
    const targets = users.filter((u) => !onlyPlayers || (u.role !== 'admin'));
    if (!targets.length) { showToast('Aucun compte cible', 'error'); return; }
    const c = getAuthClient();
    let ok = 0;
    for (const u of targets) {
      const next = Math.max(0, Number(u.balance || 0) + amount);
      const { error } = await cloudCall('admin', () => c.rpc('admin_set_balance', {
        p_user_id: u.id,
        p_amount: Number(next.toFixed(2)),
        p_reason: `admin points drop +${amount.toFixed(2)}`
      }), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
      if (!error) ok += 1;
    }
    invalidateCache('admin');
    invalidateCache('profile');
    await syncCloudBalanceNow().catch(() => {});
    await renderAdminPanel();
    pushLocalAdminAudit('admin_drop_points_all', `amount=${amount.toFixed(2)} targets=${targets.length} ok=${ok} onlyPlayers=${onlyPlayers ? 1 : 0}`);
    showToast(`Drop envoyé: ${ok}/${targets.length} compte(s)`, ok === targets.length ? 'success' : 'info', 2600);
    return;
  }

  const users = getUsers();
  let count = 0;
  Object.entries(users).forEach(([uname, rec]) => {
    if (!rec) return;
    if (onlyPlayers && rec.isAdmin) return;
    rec.balance = Math.max(0, Number(rec.balance || 0) + amount);
    count += 1;
  });
  saveUsers(users);
  if (currentUser && users[currentUser.username]) {
    currentUser.balance = Number(users[currentUser.username].balance || 0);
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_drop_points_all_local', `amount=${amount.toFixed(2)} targets=${count} onlyPlayers=${onlyPlayers ? 1 : 0}`);
  showToast(`Drop local envoyé sur ${count} compte(s)`, 'success', 2200);
}
async function adminToggleUserRoleAsync(username) {
  if (!isCurrentUserAdmin()) return;
  const g = actionGuardAcquire('admin:set_role', { limit: 8, windowMs: 60000, blockMs: 90000 });
  if (g.blocked) { showToast(`Action temporairement bloquée (${g.waitSec}s)`, 'error'); return; }
  if (currentUser && currentUser.cloud) {
    const data = await adminFetchCloudUsers();
    const want = String(username || '').trim().toLowerCase();
    const rec = data.find((u) => {
      const un = String(u.username || '').trim().toLowerCase();
      const em = String(u.email || '').trim().toLowerCase();
      const local = em.includes('@') ? em.split('@')[0] : '';
      return un === want || local === want;
    });
    if (!rec) {
      showToast('Utilisateur introuvable (rafraîchis la liste).', 'error');
      return;
    }
    const roleNorm = String(rec.role || 'player').trim().toLowerCase();
    const nextRole = roleNorm === 'admin' ? 'player' : 'admin';
    const c = getAuthClient();
    const { error } = await cloudCall('admin', () => c.rpc('admin_set_role', {
      p_user_id: rec.id,
      p_role: nextRole,
      p_reason: 'admin panel toggle role'
    }), { retries: 1, timeoutMs: 12000, delayMs: 500 });
    if (error) throw error;
    invalidateCache('admin');
    invalidateCache('profile', String(rec.id));
    const fresh = await loadCloudProfile(rec.id, { force: true });
    mergeCloudProfileIntoCurrentUserIfSame(fresh);
    const onAdminPage = __activePage === 'admin';
    if (onAdminPage && !isCurrentUserAdmin()) {
      switchPage('home');
      showToast('Accès admin retiré pour ta session.', 'info', 2400);
    }
    await renderAdminPanel();
    pushLocalAdminAudit('admin_set_role', `${username} -> ${nextRole}`);
    const label = nextRole === 'admin' ? 'admin' : 'joueur';
    showToast(`${rec.username || username} est maintenant ${label}`, 'info');
    return;
  }
  const users = getUsers();
  const rec = users[username];
  if (!rec) return;
  rec.isAdmin = !rec.isAdmin;
  saveUsers(users);
  if (currentUser && currentUser.username === username) {
    updateAdminTabVisibility();
    renderProfileBadge();
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_set_role_local', `${username} -> ${rec.isAdmin ? 'admin' : 'player'}`);
  showToast(`${username} est maintenant ${rec.isAdmin ? 'admin' : 'joueur'}`, 'info');
}
async function adminDeleteHuntByIdAsync(huntId) {
  if (!isCurrentUserAdmin()) return;
  const g = actionGuardAcquire('admin:delete_hunt', { limit: 10, windowMs: 60000, blockMs: 90000 });
  if (g.blocked) { showToast(`Action temporairement bloquée (${g.waitSec}s)`, 'error'); return; }
  if (currentUser && currentUser.cloud) {
    const c = getAuthClient();
    const { error } = await cloudCall('admin', () => c.rpc('admin_delete_hunt', { p_hunt_id: huntId }), { retries: 1, timeoutMs: 12000, delayMs: 500 });
    if (error) throw error;
    invalidateCache('admin');
    await load();
    renderHuntList();
    if (state.activeHuntId) selectHunt(state.activeHuntId);
    await renderAdminPanel();
    pushLocalAdminAudit('admin_delete_hunt', `${huntId}`);
    showToast('Hunt cloud supprimée', 'error');
    return;
  }
  const idx = state.hunts.findIndex(h => h.id === huntId);
  if (idx < 0) return;
  const name = state.hunts[idx].name;
  state.hunts.splice(idx, 1);
  if (state.activeHuntId === huntId) state.activeHuntId = state.hunts[0]?.id || null;
  save();
  renderHuntList();
  if (state.activeHuntId) selectHunt(state.activeHuntId);
  else {
    document.getElementById('no-hunt-selected').style.display = 'flex';
    document.getElementById('hunt-workspace').classList.add('hidden');
  }
  renderAdminPanel();
  pushLocalAdminAudit('admin_delete_hunt_local', `${name} (${huntId})`);
  showToast(`Hunt ${name} supprimé`, 'error');
}
async function adminFetchCloudUsers() {
  const cacheKey = 'users:list';
  const cached = getCacheEntry('admin', cacheKey, CACHE_TTL.adminUsers);
  if (cached && cached.length) return Array.isArray(cached) ? cached.map((u) => ({ ...u })) : [];
  if (typeof ensureCloudSession === 'function') {
    const session = await ensureCloudSession({ refresh: true, promptLogin: false });
    if (!session?.access_token) return [];
  }
  const c = getAuthClient();
  const { data, error } = await cloudCall('admin', () => c.rpc('admin_list_users'), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  const next = (data || []).map(u => ({
    id: u.id,
    username: u.username || u.display_name || (u.email ? String(u.email).split('@')[0] : 'player'),
    role: u.role || 'player',
    status: u.status || 'active',
    balance: Number(u.balance_amount || 0),
    email: u.email || ''
  }));
  if (next.length) setCacheEntry('admin', cacheKey, next);
  return next.map((u) => ({ ...u }));
}
async function adminFetchCloudHunts() {
  const cacheKey = 'hunts:list';
  const cached = getCacheEntry('admin', cacheKey, CACHE_TTL.adminHunts);
  if (cached && cached.length) return Array.isArray(cached) ? cached.map((h) => ({ ...h })) : [];
  if (typeof ensureCloudSession === 'function') {
    const session = await ensureCloudSession({ refresh: true, promptLogin: false });
    if (!session?.access_token) return [];
  }
  const { data, error } = await cloudCall('admin', () => c
    .from('hunts')
    .select('id,name,currency,starting_balance,hunt_bonuses(id)')
    .order('created_at', { ascending: false })
    .limit(300), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  const next = (data || []).map(h => ({
    id: h.id,
    name: h.name,
    currency: h.currency,
    startBalance: Number(h.starting_balance || 0),
    bonusCount: Array.isArray(h.hunt_bonuses) ? h.hunt_bonuses.length : 0
  }));
  if (next.length) setCacheEntry('admin', cacheKey, next);
  return next.map((h) => ({ ...h }));
}
async function adminFetchCloudLogs() {
  const cacheKey = 'logs:list';
  const cached = getCacheEntry('admin', cacheKey, CACHE_TTL.adminLogs);
  if (cached) return Array.isArray(cached) ? cached.map((l) => ({ ...l })) : [];
  const c = getAuthClient();
  const { data, error } = await cloudCall('admin', () => c
    .from('admin_audit_logs')
    .select('id,admin_id,action,target_table,target_id,payload,created_at')
    .order('created_at', { ascending: false })
    .limit(80), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  const next = data || [];
  setCacheEntry('admin', cacheKey, next);
  return next.map((l) => ({ ...l }));
}
async function adminFetchCloudFeedback() {
  const cacheKey = 'feedback:list';
  const cached = getCacheEntry('admin', cacheKey, CACHE_TTL.adminFeedback);
  if (cached) return Array.isArray(cached) ? cached.map((f) => ({ ...f })) : [];
  const c = getAuthClient();
  const { data, error } = await cloudCall('admin', () => c
    .from('site_feedback')
    .select('id,created_at,category,message,contact,user_id,client_meta,status')
    .order('created_at', { ascending: false })
    .limit(200), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  const next = data || [];
  setCacheEntry('admin', cacheKey, next);
  return next.map((f) => ({ ...f }));
}
async function adminFeedbackSetStatus(feedbackId, newStatus) {
  if (!isCurrentUserAdmin() || !currentUser?.cloud) return;
  const allowed = new Set(['nouveau', 'a_faire', 'valide', 'fait']);
  if (!feedbackId || !allowed.has(String(newStatus || ''))) return;
  const g = actionGuardAcquire('admin:feedback_mutate', { limit: 80, windowMs: 60000, blockMs: 45000 });
  if (g.blocked) {
    showToast(`Trop d’actions. Réessaie dans ${g.waitSec}s.`, 'error');
    return;
  }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  try {
    const { error } = await cloudCall('admin', () => c.from('site_feedback').update({ status: newStatus }).eq('id', feedbackId), {
      retries: 1,
      timeoutMs: 12000,
      delayMs: 400,
      quiet: true
    });
    if (error) throw error;
    invalidateCache('admin', 'feedback');
    await renderAdminPanel();
    showToast('Statut mis à jour', 'success');
  } catch (e) {
    showToast(mapAuthError(e), 'error');
  }
}
async function adminFeedbackDelete(feedbackId) {
  if (!isCurrentUserAdmin() || !currentUser?.cloud) return;
  if (!feedbackId) return;
  const ok = await confirm('Supprimer ce retour ?', 'Cette action est définitive.');
  if (!ok) return;
  const g = actionGuardAcquire('admin:feedback_mutate', { limit: 80, windowMs: 60000, blockMs: 45000 });
  if (g.blocked) {
    showToast(`Trop d’actions. Réessaie dans ${g.waitSec}s.`, 'error');
    return;
  }
  const c = getAuthClient();
  if (!c) { showToast('Supabase indisponible', 'error'); return; }
  try {
    const { error } = await cloudCall('admin', () => c.from('site_feedback').delete().eq('id', feedbackId), {
      retries: 1,
      timeoutMs: 12000,
      delayMs: 400,
      quiet: true
    });
    if (error) throw error;
    invalidateCache('admin', 'feedback');
    await renderAdminPanel();
    showToast('Retour supprimé', 'success');
  } catch (e) {
    showToast(mapAuthError(e), 'error');
  }
}
async function renderAdminPanel() {
  const denied = document.getElementById('admin-access-denied');
  const panel = document.getElementById('admin-panel');
  if (!denied || !panel) return;
  if (!isCurrentUserAdmin()) {
    denied.style.display = 'block';
    panel.style.display = 'none';
    return;
  }
  denied.style.display = 'none';
  panel.style.display = 'block';
  const maint = getMaintenanceConfig();
  const ops = getOpsAlertsConfig();
  const maintEnabledEl = document.getElementById('admin-maint-enabled');
  const maintMsgEl = document.getElementById('admin-maint-msg');
  const opsEnabledEl = document.getElementById('admin-ops-enabled');
  const opsUrlEl = document.getElementById('admin-ops-webhook');
  if (maintEnabledEl) maintEnabledEl.checked = !!maint.enabled;
  if (maintMsgEl) maintMsgEl.value = maint.message || '';
  if (opsEnabledEl) opsEnabledEl.checked = !!ops.enabled;
  if (opsUrlEl) opsUrlEl.value = ops.webhookUrl || '';
  renderMaintenanceBanner();

  const isCloud = !!(currentUser && currentUser.cloud);
  let usersMap = getUsers();
  let cloudUsers = [];
  let cloudHunts = [];
  let cloudLogs = [];
  let cloudFeedbacks = [];
  let feedbackLoadErr = null;
  let adminCloudLoadErr = null;
  if (isCloud) {
    if (typeof ensureCloudSession === 'function') {
      const session = await ensureCloudSession({ refresh: true, promptLogin: false });
      if (!session?.access_token) {
        adminCloudLoadErr = new Error('Session Supabase expirée — reconnecte-toi pour gérer les joueurs.');
      }
    }
    if (!adminCloudLoadErr) {
      try {
        cloudUsers = await adminFetchCloudUsers();
        cloudHunts = await adminFetchCloudHunts();
        cloudLogs = await adminFetchCloudLogs();
        try {
          cloudFeedbacks = await adminFetchCloudFeedback();
        } catch (fe) {
          feedbackLoadErr = fe;
        }
        if (!cloudUsers.length && isCurrentUserAdmin()) {
          adminCloudLoadErr = new Error('admin_bootstrap_required');
        }
      } catch (e) {
        adminCloudLoadErr = e;
        showToast(mapAuthError(e), 'error');
      }
    }
  }
  const userEntries = isCloud ? cloudUsers : Object.values(usersMap);
  const adminCount = userEntries.filter(u => u && (u.isAdmin || u.role === 'admin')).length;
  const totalBalance = userEntries.reduce((a, u) => a + Number(u?.balance || 0), 0);
  const cloudStatus = getCloudUiStatus();
  let dashStats = null;
  if (isCloud && isCurrentUserAdmin()) {
    dashStats = await adminFetchDashboardStats();
  }
  const dashEl = document.getElementById('admin-dashboard-grid');
  if (dashEl) {
    if (dashStats) {
      const month = escapeHtml(String(dashStats.period_month || '—'));
      dashEl.innerHTML = `
        <div class="stat-card"><div class="stat-label">TOURNOI EN ATTENTE</div><div class="stat-value" style="color:${Number(dashStats.tournoi_pending) > 0 ? 'var(--gold)' : 'inherit'}">${Number(dashStats.tournoi_pending || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">VALIDÉS (${month})</div><div class="stat-value">${Number(dashStats.tournoi_verified_month || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">SOUMIS (${month})</div><div class="stat-value">${Number(dashStats.tournoi_submitted_month || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">HUNTS CLOUD</div><div class="stat-value">${Number(dashStats.hunts_cloud_total || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">HUNTS CRÉÉS 7J</div><div class="stat-value">${Number(dashStats.hunts_created_7d || 0)}</div></div>
        <div class="stat-card"><div class="stat-label">JOUEURS ACTIFS 7J</div><div class="stat-value">${Number(dashStats.active_players_7d || 0)}</div></div>
      `;
    } else if (isCloud) {
      dashEl.innerHTML = `<div class="bj-rec" style="grid-column:1/-1;">Dashboard cloud indisponible — applique <code>20260704_admin_dashboard.sql</code> dans Supabase.</div>`;
    } else {
      dashEl.innerHTML = `<div class="bj-rec" style="grid-column:1/-1;">Connecte-toi en compte cloud admin pour les stats communauté.</div>`;
    }
  }
  const statsEl = document.getElementById('admin-stats-grid');
  if (statsEl) {
    statsEl.innerHTML = `
      <div class="stat-card"><div class="stat-label">JOUEURS</div><div class="stat-value">${userEntries.length}</div></div>
      <div class="stat-card"><div class="stat-label">ADMINS</div><div class="stat-value">${adminCount}</div></div>
      <div class="stat-card"><div class="stat-label">HUNTS</div><div class="stat-value">${isCloud ? cloudHunts.length : state.hunts.length}</div></div>
      <div class="stat-card"><div class="stat-label">SOLDE CUMULÉ</div><div class="stat-value">${fmtVirtual(totalBalance)}</div></div>
      <div class="stat-card"><div class="stat-label">ETAT CLOUD</div><div class="stat-value" style="color:${cloudStatus.color};">${cloudStatus.label}</div><div class="bj-rec">${escapeHtml(cloudStatus.detail)}</div></div>
    `;
  }

  const usersTable = document.getElementById('admin-users-table');
  if (usersTable) {
    if (adminCloudLoadErr) {
      const isBootstrap = String(adminCloudLoadErr?.message || '') === 'admin_bootstrap_required';
      usersTable.innerHTML = `
        <div class="bj-rec" style="color:#ffb4c4;margin-bottom:10px;">
          ${isBootstrap
            ? `Accès admin UI actif, mais Supabase ne renvoie aucun joueur.<br>
               Exécute <code>supabase/migrations/20260710_admin_owner_bootstrap.sql</code> dans Supabase → SQL Editor, puis reconnecte-toi.`
            : escapeHtml(mapAuthError(adminCloudLoadErr))}
        </div>
        <div class="admin-toolbar">
          <button type="button" class="profile-mini-btn primary" onclick="invalidateCache('admin');renderAdminPanel().catch(()=>{})">Rafraîchir la liste</button>
          <button type="button" class="profile-mini-btn" onclick="forceCloudReauth('Reconnecte-toi pour rétablir l’accès admin.')">Reconnecter</button>
        </div>`;
    } else {
    const allRows = (isCloud ? cloudUsers.map((u) => [u.username, u]) : Object.entries(usersMap));
    const currentUsernameLower = String(currentUser?.username || '').toLowerCase();
    const currentUserId = String(currentUser?.id || '');
    const adminLiveBalanceFor = (username, u) => {
      if (!isCloud || !currentUser || !currentUser.cloud) return Number(u?.balance || 0);
      const sameUserByName = String(username || '').toLowerCase() === currentUsernameLower;
      const sameUserById = String(u?.id || '') && String(u?.id || '') === currentUserId;
      return (sameUserByName || sameUserById) ? Number(currentUser.balance || 0) : Number(u?.balance || 0);
    };
    const q = String(adminViewState.q || '').trim().toLowerCase();
    const role = adminViewState.role || 'all';
    let rows = allRows.filter(([username, u]) => {
      const roleTxt = (u.isAdmin || u.role === 'admin') ? 'admin' : 'player';
      const matchRole = role === 'all' ? true : roleTxt === role;
      const matchQ = !q || String(username || '').toLowerCase().includes(q) || String(u.email || '').toLowerCase().includes(q);
      return matchRole && matchQ;
    }).map(([username, u]) => [username, { ...u, balance: adminLiveBalanceFor(username, u) }]);
    rows.sort((a, b) => {
      const [ua, ra] = a;
      const [ub, rb] = b;
      if (adminViewState.sort === 'balance_desc') return Number(rb.balance || 0) - Number(ra.balance || 0);
      if (adminViewState.sort === 'balance_asc') return Number(ra.balance || 0) - Number(rb.balance || 0);
      return String(ua || '').localeCompare(String(ub || ''), 'fr');
    });
    const totalPages = Math.max(1, Math.ceil(rows.length / adminViewState.pageSize));
    adminViewState.page = Math.max(1, Math.min(adminViewState.page, totalPages));
    const start = (adminViewState.page - 1) * adminViewState.pageSize;
    const pageRows = rows.slice(start, start + adminViewState.pageSize);
    usersTable.innerHTML = `
      <div class="admin-toolbar">
        <input class="profile-menu-input" id="admin-user-search" placeholder="Rechercher pseudo/email..." value="${escapeHtml(adminViewState.q)}">
        <select class="profile-menu-input" id="admin-role-filter" style="width:140px;">
          <option value="all" ${adminViewState.role==='all'?'selected':''}>Tous</option>
          <option value="admin" ${adminViewState.role==='admin'?'selected':''}>Admins</option>
          <option value="player" ${adminViewState.role==='player'?'selected':''}>Joueurs</option>
        </select>
        <select class="profile-menu-input" id="admin-sort" style="width:180px;">
          <option value="name_asc" ${adminViewState.sort==='name_asc'?'selected':''}>Tri pseudo</option>
          <option value="balance_desc" ${adminViewState.sort==='balance_desc'?'selected':''}>Solde décroissant</option>
          <option value="balance_asc" ${adminViewState.sort==='balance_asc'?'selected':''}>Solde croissant</option>
        </select>
        <button class="profile-mini-btn" id="admin-prev-page">Page -</button>
        <button class="profile-mini-btn" id="admin-next-page">Page +</button>
        <div class="bj-rec">Page ${adminViewState.page}/${totalPages}</div>
      </div>
      <div class="admin-toolbar" style="margin-top:8px;">
        <input class="profile-menu-input" id="admin-drop-amount" type="number" min="0.01" step="0.01" value="10" style="width:140px;" placeholder="Montant drop">
        <button class="profile-mini-btn primary" onclick="adminApplyPointsDropAll(false)">Drop à tous</button>
        <button class="profile-mini-btn" onclick="adminApplyPointsDropAll(true)">Drop joueurs</button>
      </div>
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;">Pseudo</th>
              <th style="text-align:left;padding:8px;">Role</th>
              <th style="text-align:left;padding:8px;">Solde</th>
              <th style="text-align:left;padding:8px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${pageRows.map(([username, u]) => `
              <tr>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(username)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${(u.isAdmin || u.role === 'admin') ? 'ADMIN' : 'JOUEUR'}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${fmtVirtual(Number(u.balance || 0))}</td>
                <td style="padding:8px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;">
                  <input
                    class="profile-menu-input"
                    id="admin-user-delta-${encodeURIComponent(username)}"
                    type="number"
                    step="0.01"
                    placeholder="+10 / -10"
                    style="width:120px;height:36px;"
                    onkeydown="if(event.key==='Enter'){adminAdjustBalanceFromInput(decodeURIComponent('${encodeURIComponent(username)}'));}"
                  >
                  <button class="profile-mini-btn" onclick="adminAdjustBalanceFromInput(decodeURIComponent('${encodeURIComponent(username)}'))">Appliquer</button>
                  <button class="profile-mini-btn" onclick="adminSetBalancePrompt(decodeURIComponent('${encodeURIComponent(username)}'))">Solde</button>
                  <button class="profile-mini-btn ${(u.isAdmin || u.role === 'admin') ? 'danger' : 'primary'}" onclick="adminToggleUserRole(decodeURIComponent('${encodeURIComponent(username)}'))">${(u.isAdmin || u.role === 'admin') ? 'Retirer admin' : 'Passer admin'}</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    const searchEl = document.getElementById('admin-user-search');
    const roleEl = document.getElementById('admin-role-filter');
    const sortEl = document.getElementById('admin-sort');
    const prevEl = document.getElementById('admin-prev-page');
    const nextEl = document.getElementById('admin-next-page');
    if (searchEl) searchEl.oninput = () => { adminViewState.q = searchEl.value || ''; adminViewState.page = 1; renderAdminPanel(); };
    if (roleEl) roleEl.onchange = () => { adminViewState.role = roleEl.value || 'all'; adminViewState.page = 1; renderAdminPanel(); };
    if (sortEl) sortEl.onchange = () => { adminViewState.sort = sortEl.value || 'name_asc'; adminViewState.page = 1; renderAdminPanel(); };
    if (prevEl) prevEl.onclick = () => { adminViewState.page = Math.max(1, adminViewState.page - 1); renderAdminPanel(); };
    if (nextEl) nextEl.onclick = () => { adminViewState.page = Math.min(totalPages, adminViewState.page + 1); renderAdminPanel(); };
    }
  }

  const huntsTable = document.getElementById('admin-hunts-table');
  if (huntsTable) {
    if (adminCloudLoadErr) {
      huntsTable.innerHTML = `<div class="bj-rec" style="color:var(--text-dim);">Hunts cloud indisponibles tant que l’accès admin Supabase n’est pas rétabli.</div>`;
    } else {
    huntsTable.innerHTML = `
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;">Hunt</th>
              <th style="text-align:left;padding:8px;">Bonuses</th>
              <th style="text-align:left;padding:8px;">Solde départ</th>
              <th style="text-align:left;padding:8px;">Actions</th>
            </tr>
          </thead>
          <tbody>
            ${(isCloud ? cloudHunts : state.hunts.map(h => ({ ...h, bonusCount: (h.bonuses || []).length }))).map(h => `
              <tr>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(h.name || 'Hunt')}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${Number(h.bonusCount || 0)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${fmt(Number(h.startBalance || 0), h.currency || 'EUR')}</td>
                <td style="padding:8px;border-top:1px solid var(--border);display:flex;gap:8px;flex-wrap:wrap;">
                  ${isCloud ? '' : `<button class="profile-mini-btn" onclick="selectHunt('${h.id}');switchPage('hunt')">Ouvrir</button>`}
                  <button class="profile-mini-btn danger" onclick="adminDeleteHuntById('${h.id}')">Supprimer</button>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
    }
  }
  const feedbackTable = document.getElementById('admin-feedback-table');
  if (feedbackTable) {
    if (!isCloud) {
      feedbackTable.innerHTML = `<div class="bj-rec">Les avis testeurs (page REVIEW) sont stockés sur Supabase. Exécute <code>site_feedback.sql</code> puis utilise un compte cloud : ils apparaîtront ici.</div>`;
    } else if (feedbackLoadErr) {
      const hint = String(feedbackLoadErr?.message || feedbackLoadErr || '').toLowerCase().includes('relation')
        ? ' Vérifie que la table <code>site_feedback</code> existe (script <code>site_feedback.sql</code>).'
        : '';
      feedbackTable.innerHTML = `<div class="bj-rec" style="color:#ff9fb1;">${escapeHtml(mapAuthError(feedbackLoadErr))}${hint}</div>`;
    } else {
      const catLabel = (c) => ({ bug: 'Bug', idee: 'Idée', autre: 'Autre' }[String(c || '').toLowerCase()] || c || '—');
      const statusLabels = { nouveau: 'Nouveau', a_faire: 'À faire', valide: 'Validé', fait: 'Fait' };
      const statusOrder = ['nouveau', 'a_faire', 'valide', 'fait'];
      feedbackTable.innerHTML = `
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button class="profile-mini-btn" onclick="invalidateCache('admin','feedback');renderAdminPanel().catch(()=>{})">Rafraîchir les retours</button>
        </div>
        <div class="table-wrap">
          <table style="width:100%;border-collapse:collapse;">
            <thead>
              <tr>
                <th style="text-align:left;padding:8px;">Date</th>
                <th style="text-align:left;padding:8px;">Type</th>
                <th style="text-align:left;padding:8px;">Message</th>
                <th style="text-align:left;padding:8px;">Contact</th>
                <th style="text-align:left;padding:8px;">User</th>
                <th style="text-align:left;padding:8px;">Statut</th>
                <th style="text-align:left;padding:8px;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${cloudFeedbacks.length ? cloudFeedbacks.map((f) => {
                const msg = String(f.message || '');
                const msgShort = msg.length > 160 ? `${escapeHtml(msg.slice(0, 160))}…` : escapeHtml(msg);
                const uid = f.user_id ? String(f.user_id).slice(0, 8) : '—';
                const at = f.created_at ? new Date(f.created_at).toLocaleString('fr-FR') : '—';
                const st = String(f.status || 'nouveau').toLowerCase();
                const stNorm = statusOrder.includes(st) ? st : 'nouveau';
                const opts = statusOrder.map((v) =>
                  `<option value="${v}" ${stNorm === v ? 'selected' : ''}>${statusLabels[v]}</option>`
                ).join('');
                const rawId = String(f.id || '');
                return `
                  <tr>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">${escapeHtml(at)}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">${escapeHtml(catLabel(f.category))}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;" title="${escapeHtml(msg)}">${msgShort}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">${escapeHtml(String(f.contact || '—'))}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;font-family:'Share Tech Mono',monospace;font-size:10px;">${escapeHtml(uid)}</td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">
                      <select class="profile-menu-input" style="min-width:132px;height:38px;font-size:13px;" data-fid="${escapeHtml(rawId)}" onchange="adminFeedbackSetStatus(this.getAttribute('data-fid'), this.value)">${opts}</select>
                    </td>
                    <td style="padding:8px;border-top:1px solid var(--border);vertical-align:top;">
                      <button class="profile-mini-btn danger" type="button" onclick="adminFeedbackDelete('${escapeHtml(rawId)}')">Supprimer</button>
                    </td>
                  </tr>
                `;
              }).join('') : `<tr><td colspan="7" style="padding:10px;border-top:1px solid var(--border);color:var(--text-dim);">Aucun retour pour l’instant.</td></tr>`}
            </tbody>
          </table>
        </div>
      `;
    }
  }
  const logsTable = document.getElementById('admin-logs-table');
  if (logsTable) {
    const rows = isCloud
      ? cloudLogs.map((l) => ({
          at: l.created_at ? new Date(l.created_at).toLocaleString('fr-FR') : '-',
          admin: String(l.admin_id || '').slice(0, 8) || 'admin',
          action: l.action || '-',
          details: `${l.target_table || ''} ${l.target_id || ''}`.trim() || JSON.stringify(l.payload || {}).slice(0, 80)
        }))
      : getLocalAdminAuditLogs().slice(0, 80).map((l) => ({
          at: l.ts ? new Date(l.ts).toLocaleString('fr-FR') : '-',
          admin: l.admin || 'admin',
          action: l.action || '-',
          details: l.details || '-'
        }));
    logsTable.innerHTML = `
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;">Quand</th>
              <th style="text-align:left;padding:8px;">Admin</th>
              <th style="text-align:left;padding:8px;">Action</th>
              <th style="text-align:left;padding:8px;">Détails</th>
            </tr>
          </thead>
          <tbody>
            ${rows.length ? rows.map((r) => `
              <tr>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.at)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.admin)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.action)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.details)}</td>
              </tr>
            `).join('') : `<tr><td colspan="4" style="padding:10px;border-top:1px solid var(--border);color:var(--text-dim);">Aucun log admin.</td></tr>`}
          </tbody>
        </table>
      </div>
    `;
  }
  loadAdminRecentSlots().catch(() => {});
  renderAdminTournoiTable().catch(() => {});
  if (typeof syncAdminSlotPreview === 'function') syncAdminSlotPreview();
}

const ADMIN_AUDIT_LOCAL_KEY = 'hm_admin_audit_local_v1';

function getLocalAdminAuditLogs() {
  try {
    const raw = localStorage.getItem(ADMIN_AUDIT_LOCAL_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}

function pushLocalAdminAudit(action, details = '') {
  try {
    const logs = getLocalAdminAuditLogs();
    logs.unshift({
      ts: Date.now(),
      admin: currentUser?.username || 'admin',
      action: String(action || 'action').slice(0, 80),
      details: String(details || '').slice(0, 240)
    });
    localStorage.setItem(ADMIN_AUDIT_LOCAL_KEY, JSON.stringify(logs.slice(0, 120)));
  } catch (_) {}
}
