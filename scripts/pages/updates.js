'use strict';
/* globals escapeHtml, getRuntimeLogs, getActionGuardStatus, getMaintenanceConfig, getAutoSnapshots, getOpsAlertsConfig, cloudSyncDisabled, cloudSyncInFlight, cloudSyncFailureCount, onlineCount, supaHealth, renderProductChangelogSection, renderProductChangelogHtml */
/* Page Updates / ops — lazy via LAZY_PAGE_SCRIPTS */

function renderUpdatesPage() {
  const changelogWrap = document.getElementById('updates-changelog');
  const wrap = document.getElementById('updates-content');
  if (changelogWrap) {
    if (typeof renderProductChangelogSection === 'function') {
      renderProductChangelogSection().catch(() => {
        if (typeof renderProductChangelogHtml === 'function') changelogWrap.innerHTML = renderProductChangelogHtml();
      });
    } else if (typeof renderProductChangelogHtml === 'function') {
      changelogWrap.innerHTML = renderProductChangelogHtml();
    }
  }
  if (!wrap) return;
  const logs = getRuntimeLogs().slice(0, 10);
  const blocks = getActionGuardStatus();
  const maint = getMaintenanceConfig();
  const snaps = getAutoSnapshots();
  const latestSnap = snaps[0] || null;
  const ops = getOpsAlertsConfig();
  const healthBadge = (v) => {
    if (v === 'up') return '<span style="color:#8fffc3;">UP</span>';
    if (v === 'no-session' || v === 'auth-required') return '<span style="color:#ffd38a;">AUTH</span>';
    if (v === 'degraded') return '<span style="color:#ffb3c3;">DEGRADED</span>';
    if (v === 'down') return '<span style="color:#ff9fb1;">DOWN</span>';
    return '<span style="color:var(--text-dim);">UNKNOWN</span>';
  };
  const syncState = cloudSyncDisabled
    ? 'Désactivée (fallback local actif)'
    : (cloudSyncInFlight ? 'Synchronisation en cours...' : `Active (échecs récents: ${cloudSyncFailureCount})`);
  wrap.innerHTML = `
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">Sprint 1 — Stabilisation Prod (terminé)</div>
      <div class="drop-meta">
        ✅ Sync cloud robuste: retry + fallback + mode offline<br>
        ✅ Surveillance runtime + Health Check Supabase<br>
        ✅ Sécurité auth/admin: anti-spam + cooldown API<br>
        ✅ Sessions: logout local + logout global multi-appareils<br>
        ✅ Mode maintenance: joueurs en lecture seule<br>
        ✅ Audit admin + snapshots auto + restauration d’urgence
      </div>
    </div>
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">État temps réel</div>
      <div class="drop-meta">
        • Sync cloud: ${escapeHtml(syncState)}<br>
        • Connexion: ${navigator.onLine ? 'En ligne' : 'Hors ligne'}<br>
        • Utilisateurs en ligne: ${Math.max(1, Number(onlineCount || 1))}<br>
        • Cooldown actifs: ${blocks.length}<br>
        • Maintenance: ${maint.enabled ? 'ACTIVE' : 'OFF'}
      </div>
    </div>
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">Health Check Supabase</div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button class="profile-mini-btn" onclick="runSupabaseHealthCheck(true)">Refresh check</button>
      </div>
      <div class="drop-meta">
        • Client: ${healthBadge(supaHealth.client)}<br>
        • Auth: ${healthBadge(supaHealth.auth)}<br>
        • DB: ${healthBadge(supaHealth.db)}<br>
        • Realtime: ${healthBadge(supaHealth.realtime)}<br>
        • Latence: ${Number.isFinite(Number(supaHealth.latencyMs)) ? `${Number(supaHealth.latencyMs)} ms` : '—'}<br>
        • Dernier check: ${supaHealth.checkedAt ? new Date(supaHealth.checkedAt).toLocaleTimeString('fr-FR') : '—'}<br>
        • Note: ${escapeHtml(supaHealth.note || 'OK')}
      </div>
    </div>
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">Anti-spam API (Sprint 1)</div>
      <div class="drop-meta" style="margin-bottom:8px;">Protection active sur Auth et actions Admin sensibles.</div>
      <div style="max-height:130px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;background:rgba(8,11,18,0.65);font-family:'Share Tech Mono',monospace;font-size:10px;">
        ${blocks.length ? blocks.map((b) => `<div style="padding:5px;border-bottom:1px solid rgba(255,255,255,0.06);color:#ffcf88;">${escapeHtml(b.key)} — bloqué ${b.waitSec}s</div>`).join('') : '<div style="color:var(--text-dim);">Aucun cooldown actif.</div>'}
      </div>
    </div>
    <div class="drop-box" style="margin-bottom:12px;">
      <div class="drop-title">Backups auto</div>
      <div class="drop-meta" style="margin-bottom:8px;">
        • Snapshots stockés: ${snaps.length}<br>
        • Dernier snapshot: ${latestSnap ? `${new Date(latestSnap.ts).toLocaleString('fr-FR')} (${escapeHtml(latestSnap.reason || 'save')})` : '—'}<br>
        • Alerting ops webhook: ${ops.enabled ? 'ON' : 'OFF'}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        <button class="profile-mini-btn" onclick="restoreLatestSnapshot()">Restaurer dernier snapshot</button>
      </div>
    </div>
    <div class="drop-box">
      <div class="drop-title">Journal runtime récent</div>
      <div class="drop-meta" style="margin-bottom:8px;">Erreurs utiles pour diagnostiquer vite les problèmes production.</div>
      <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
        <button class="profile-mini-btn" onclick="clearRuntimeLogs()">Vider le journal</button>
      </div>
      <div style="max-height:260px;overflow:auto;border:1px solid var(--border);border-radius:8px;padding:8px;background:rgba(8,11,18,0.65);font-family:'Share Tech Mono',monospace;font-size:10px;">
        ${logs.length ? logs.map((l) => `<div style="padding:6px;border-bottom:1px solid rgba(255,255,255,0.06);color:${l.level === 'error' ? '#ff9fb1' : '#9fd4ff'};">[${new Date(l.ts).toLocaleTimeString('fr-FR')}] ${escapeHtml(l.level.toUpperCase())} — ${escapeHtml(l.msg)}</div>`).join('') : '<div style="color:var(--text-dim);">Aucun événement.</div>'}
      </div>
    </div>
  `;
}
