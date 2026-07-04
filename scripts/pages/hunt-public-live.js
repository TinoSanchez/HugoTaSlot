'use strict';
/* globals activeHunt, isCloudUser, showToast, showAuth, getAuthClient, cloudCall, writeLocalCache, pushRuntimeLog, requireWriteAccess, bhWarn, getHuntExportSummary, getCasinoLabel, getCasinoKey, schedulePublicHuntLivePublish */
/* Lien public live /h/slug — lazy bundle hunt */

let publicHuntPublishTimer = null;
let publicHuntPublishInFlight = false;
let publicHuntPublishQueued = false;

function buildPublicHuntLivePayload(hunt) {
  const summary = getHuntExportSummary(hunt);
  return {
    format: 'hugotaslot-live-v1',
    updatedAt: Date.now(),
    hunt: {
      name: hunt.name,
      currency: hunt.currency,
      startBalance: hunt.startBalance,
      startBalanceEUR: hunt.startBalanceEUR,
      casino: hunt.casino,
      bonuses: (hunt.bonuses || []).map((b) => ({
        slotName: b.slotName,
        slotProvider: b.slotProvider,
        slotImage: b.slotImage,
        stake: b.stake,
        win: b.win,
        bonusType: b.bonusType,
      })),
    },
    stats: {
      currency: summary.currency,
      startBalance: summary.startBalance,
      totalWin: summary.totalWin,
      profit: summary.profit,
      beAvg: summary.beAvg,
      bonusCount: summary.bonusCount,
      openedCount: summary.openedCount,
      casinoLabel: summary.casinoLabel,
    },
  };
}

function getPublicHuntLiveUrl(slug) {
  const s = String(slug || '').trim().toLowerCase();
  if (!s) return '';
  try { return `${location.origin}/h/${s}`; } catch (_) { return `https://hugotaslot.fr/h/${s}`; }
}

function updatePublicLiveButtons(hunt) {
  const stopBtn = document.getElementById('btn-stop-live-hunt');
  const liveBtn = document.getElementById('btn-live-hunt');
  const on = !!(hunt && hunt.publicShareEnabled && hunt.publicShareSlug);
  if (stopBtn) stopBtn.style.display = on ? '' : 'none';
  if (liveBtn) liveBtn.classList.toggle('live-active', on);
}

async function publishActiveHuntLiveShareNow() {
  const hunt = activeHunt();
  if (!hunt || !isCloudUser()) return null;
  if (!hunt.publicShareEnabled && !hunt.publicShareSlug) return null;
  const c = getAuthClient();
  if (!c) return null;
  const payload = buildPublicHuntLivePayload(hunt);
  const { data, error } = await cloudCall('sync', () => c.rpc('publish_public_hunt_share', {
    p_hunt_id: String(hunt.id),
    p_payload: payload,
  }), { retries: 1, timeoutMs: 12000, delayMs: 400, quiet: true });
  if (error) throw error;
  const slug = String(data || hunt.publicShareSlug || '').trim().toLowerCase();
  if (slug) {
    hunt.publicShareSlug = slug;
    hunt.publicShareEnabled = true;
    writeLocalCache();
    updatePublicLiveButtons(hunt);
  }
  return slug;
}

function schedulePublicHuntLivePublish() {
  if (!isCloudUser()) return;
  const hunt = activeHunt();
  if (!hunt || !hunt.publicShareEnabled) return;
  if (publicHuntPublishTimer) clearTimeout(publicHuntPublishTimer);
  publicHuntPublishTimer = setTimeout(async () => {
    publicHuntPublishTimer = null;
    if (publicHuntPublishInFlight) {
      publicHuntPublishQueued = true;
      return;
    }
    publicHuntPublishInFlight = true;
    try {
      await publishActiveHuntLiveShareNow();
    } catch (e) {
      pushRuntimeLog('warn', `public_hunt_publish: ${String(e?.message || e)}`);
    } finally {
      publicHuntPublishInFlight = false;
      if (publicHuntPublishQueued) {
        publicHuntPublishQueued = false;
        schedulePublicHuntLivePublish();
      }
    }
  }, 900);
}

async function enablePublicHuntLiveLink() {
  if (!requireWriteAccess('Lien live bloqué')) return;
  if (!isCloudUser()) {
    showToast('Connecte-toi pour un lien public live', 'error', 3000);
    showAuth();
    return;
  }
  const hunt = activeHunt();
  if (!hunt) {
    showToast('Sélectionne un hunt', 'error');
    return;
  }
  if (!(hunt.bonuses || []).length) {
    showToast('Ajoute au moins un bonus avant le lien live', 'error', 2600);
    return;
  }
  hunt.publicShareEnabled = true;
  try {
    const slug = await publishActiveHuntLiveShareNow();
    if (!slug) throw new Error('publish_failed');
    const url = getPublicHuntLiveUrl(slug);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
    } catch (_) {}
    showToast(`Lien live actif (maj auto pendant le farm)`, 'success', 3200);
    updatePublicLiveButtons(hunt);
  } catch (e) {
    hunt.publicShareEnabled = false;
    bhWarn('enablePublicHuntLiveLink', e);
    const msg = String(e?.message || e || '').toLowerCase();
    if (msg.includes('publish_public_hunt_share') || msg.includes('public_hunt_shares') || msg.includes('does not exist')) {
      showToast('Applique la migration Supabase public_hunt_shares', 'error', 4500);
    } else {
      showToast('Impossible d’activer le lien live', 'error', 2800);
    }
  }
}

async function disablePublicHuntLiveLink() {
  const hunt = activeHunt();
  if (!hunt || !isCloudUser()) return;
  const c = getAuthClient();
  if (c) {
    try {
      await cloudCall('sync', () => c.rpc('disable_public_hunt_share', { p_hunt_id: String(hunt.id) }), { retries: 1, timeoutMs: 10000, quiet: true });
    } catch (_) {}
  }
  hunt.publicShareEnabled = false;
  hunt.publicShareSlug = '';
  writeLocalCache();
  updatePublicLiveButtons(hunt);
  showToast('Lien live désactivé', 'info', 2200);
}

async function copyPublicHuntLiveLink() {
  const hunt = activeHunt();
  if (hunt?.publicShareEnabled && hunt?.publicShareSlug) {
    const url = getPublicHuntLiveUrl(hunt.publicShareSlug);
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(url);
      showToast('Lien live copié', 'success', 1800);
    } catch (_) {
      showToast(url, 'info', 5000);
    }
    return;
  }
  await enablePublicHuntLiveLink();
}

function initHuntPublicLiveToolbar() {
  const live = document.getElementById('btn-live-hunt');
  if (live && !live.dataset.huntBound) {
    live.dataset.huntBound = '1';
    live.addEventListener('click', () => { copyPublicHuntLiveLink().catch(() => {}); });
  }
  const stop = document.getElementById('btn-stop-live-hunt');
  if (stop && !stop.dataset.huntBound) {
    stop.dataset.huntBound = '1';
    stop.addEventListener('click', () => { disablePublicHuntLiveLink().catch(() => {}); });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuntPublicLiveToolbar);
else initHuntPublicLiveToolbar();

