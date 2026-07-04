'use strict';
/* globals state, activeHunt, save, showToast, requireWriteAccess, setUndoSnapshot, fmt, normalizeBonusType, formatBonusTypeLabel, resolveBonusImageUrl, isSafeUrl, escapeHtml, beAverageMultiplierForHunt, getProfitMotivation, getOpenerKeybinds, openerKeyMatch, getOpenerKeybinds, STREAMER_OVERLAY_KEY, setStreamerOverlayEnabled, isStreamerOverlayEnabled, openOrFocusStreamerHud, closeStreamerHudWin, updateOpenerStreamerHud, renderHuntWorkspace, renderHuntList, renderOpener, scheduleCloudSync, isCloudUser, LOCAL_SYNCED_KEY, STORAGE_KEY, bhWarn, document, window, broadcastMainMutation, scheduleCloudSync */
/* Opener + mini-opener + HUD stream — lazy bundle hunt */

function openHuntFromButton() {
  const hunt = activeHunt();
  if (!hunt) {
    showToast('Sélectionne ou crée un hunt d’abord', 'error');
    return;
  }
  if (!hunt.bonuses || hunt.bonuses.length === 0) {
    showToast('Ajoute au moins un bonus avant d’ouvrir le hunt', 'error', 3200);
    try {
      const grid = document.getElementById('grid-container') || document.getElementById('slots-grid');
      if (grid && typeof grid.scrollIntoView === 'function') {
        grid.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
      const search = document.getElementById('search-input');
      if (search && typeof search.focus === 'function') setTimeout(() => search.focus(), 250);
    } catch (_) {}
    return;
  }
  const firstPending = hunt.bonuses.findIndex(b => b.win === null);
  openOpener(firstPending >= 0 ? firstPending : 0);
}
document.getElementById('btn-open-hunt').addEventListener('click', openHuntFromButton);
const _btnOpenHeader = document.getElementById('btn-open-hunt-header');
if (_btnOpenHeader) _btnOpenHeader.addEventListener('click', openHuntFromButton);
document.getElementById('opener-close').addEventListener('click', closeOpener);
document.getElementById('opener-confirm').addEventListener('click', openerConfirm);
document.getElementById('opener-prev').addEventListener('click', () => openerNav(-1));
document.getElementById('opener-next').addEventListener('click', () => openerNav(1));

// ─── Mini-opener détaché (popup flottant à garder par-dessus le casino) ──
let _miniOpenerWin = null;
let _miniOpenerPipWin = null;
let _miniOpenerWatch = null;
let _miniOpenerBC = null;
let _miniSyncSuppressStorage = false;
let _miniLastInbound = 0;

function isMiniOpenerOpen() {
  try {
    if (_miniOpenerPipWin && !_miniOpenerPipWin.closed) return true;
    if (_miniOpenerWin && !_miniOpenerWin.closed) return true;
  } catch (_) {}
  return false;
}

function supportsDocPip() {
  try { return !!(window.documentPictureInPicture && typeof window.documentPictureInPicture.requestWindow === 'function'); } catch (_) { return false; }
}

function broadcastMainMutation(reason) {
  try {
    if (!_miniOpenerBC) return;
    _miniOpenerBC.postMessage({ type: 'hunt-mutation', source: 'main', reason: reason || 'edit', at: Date.now() });
  } catch (_) {}
}

function syncMiniBtnState() {
  const btn = document.getElementById('opener-detach');
  if (!btn) return;
  if (isMiniOpenerOpen()) btn.classList.add('active');
  else btn.classList.remove('active');
}

function reloadHuntsFromLocalCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.hunts)) return false;
    state.hunts = parsed.hunts;
    if (parsed.activeHuntId) state.activeHuntId = parsed.activeHuntId;
    return true;
  } catch (e) { bhWarn('reloadHuntsFromLocalCache fail', e); return false; }
}

function handleExternalHuntMutation(reason) {
  // Évite une boucle si on vient juste d'écrire localement
  const now = Date.now();
  if (now - _miniLastInbound < 80) return;
  _miniLastInbound = now;
  if (!reloadHuntsFromLocalCache()) return;
  try { renderHuntList(); } catch (_) {}
  try { renderHuntWorkspace(); } catch (_) {}
  try {
    const opEl = document.getElementById('opener');
    if (opEl && !opEl.classList.contains('hidden')) renderOpener();
  } catch (_) {}
  // Pousse vers le cloud (si user cloud)
  try {
    if (typeof isCloudUser === 'function' && isCloudUser()) {
      try { localStorage.setItem(LOCAL_SYNCED_KEY, '0'); } catch (_) {}
      if (typeof scheduleCloudSync === 'function') scheduleCloudSync();
    }
  } catch (_) {}
}

function ensureMiniSyncBus() {
  if (_miniOpenerBC) return;
  try {
    _miniOpenerBC = new BroadcastChannel('hm-bh-sync');
    _miniOpenerBC.onmessage = (ev) => {
      const data = ev && ev.data;
      if (!data) return;
      if (data.source !== 'mini') return;
      handleExternalHuntMutation(data.reason);
    };
  } catch (_) { /* pas de BroadcastChannel : on reste sur storage event */ }
  // Storage event (cross-window même origine, fallback compatible)
  window.addEventListener('storage', (ev) => {
    if (ev.key !== STORAGE_KEY) return;
    if (_miniSyncSuppressStorage) { _miniSyncSuppressStorage = false; return; }
    handleExternalHuntMutation('storage');
  });
}

async function openMiniOpenerPip() {
  if (!supportsDocPip()) return false;
  let pip = null;
  try {
    // Pré-fetch du HTML AVANT requestWindow pour réduire le délai de paint dans la PiP.
    // (Note : on n'utilise plus d'iframe pour éviter tout blocage X-Frame-Options/CSP.)
    const htmlPromise = fetch('./mini-opener.html', { credentials: 'same-origin', cache: 'no-cache' })
      .then((r) => { if (!r.ok) throw new Error('fetch ' + r.status); return r.text(); });

    pip = await window.documentPictureInPicture.requestWindow({
      width: 440,
      height: 720,
      disallowReturnToOpener: true,
      preferInitialWindowPlacement: true
    });
    _miniOpenerPipWin = pip;

    // Squelette de chargement instantané
    pip.document.open();
    pip.document.write(`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>BH · Mini Opener</title>
      <style>html,body{margin:0;padding:0;height:100%;background:#020202;color:#9DA2AB;font-family:'Share Tech Mono',monospace;font-size:11px;letter-spacing:1px;}.l{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;}</style>
      </head><body><div class="l">CHARGEMENT…</div></body></html>`);
    pip.document.close();

    let html = '';
    try { html = await htmlPromise; } catch (fe) {
      bhWarn('mini-opener fetch failed', fe);
      pip.document.body.innerHTML = '<div style="padding:24px;color:#ff3d5a;font-family:sans-serif">Impossible de charger le mini-opener. Réessaie ou recharge le site.</div>';
      return true;
    }

    // Réécriture complète du document PiP avec le HTML autonome
    pip.document.open();
    pip.document.write(html);
    pip.document.close();

    pip.addEventListener('pagehide', () => {
      _miniOpenerPipWin = null;
      syncMiniBtnState();
    });
    if (_miniOpenerWatch) clearInterval(_miniOpenerWatch);
    _miniOpenerWatch = setInterval(syncMiniBtnState, 1500);
    showToast('Mini-popup épinglé au-dessus de tout. Garde-le visible pendant que tu joues.', 'success', 3800);
    return true;
  } catch (e) {
    bhWarn('Document PiP refusé', e);
    try { if (pip) pip.close(); } catch (_) {}
    return false;
  }
}

async function openMiniOpener() {
  if (isMiniOpenerOpen()) {
    try { (_miniOpenerPipWin || _miniOpenerWin).focus(); } catch (_) {}
    ensureMiniSyncBus();
    syncMiniBtnState();
    return;
  }

  // 1. Essai prioritaire : Document Picture-in-Picture
  //    -> reste TOUJOURS au premier plan, même quand on clique sur le casino.
  if (supportsDocPip()) {
    const ok = await openMiniOpenerPip();
    if (ok) {
      ensureMiniSyncBus();
      syncMiniBtnState();
      return;
    }
  }

  // 2. Fallback : window.open() (passe derrière quand on focus le casino).
  try {
    const w = window.open('./mini-opener.html', 'hm-mini-opener', 'popup=yes,resizable=yes,width=440,height=720,toolbar=no,menubar=no,location=no,status=no');
    if (!w) {
      showToast('Le navigateur bloque la popup. Autorise les fenêtres pop-up pour ce site.', 'error', 4500);
      return;
    }
    _miniOpenerWin = w;
    try { w.focus(); } catch (_) {}
    if (_miniOpenerWatch) clearInterval(_miniOpenerWatch);
    _miniOpenerWatch = setInterval(syncMiniBtnState, 1500);
    if (supportsDocPip()) {
      showToast('Mini-popup ouvert (mode standard). Active "épingler la fenêtre" via Chrome 120+ pour la garder au-dessus.', 'success', 4500);
    } else {
      showToast('Mini-popup ouvert. Pour le garder au-dessus du casino, utilise Chrome/Edge à jour (mode épinglé auto).', 'success', 4500);
    }
  } catch (e) { showToast('Impossible d’ouvrir la popup', 'error'); bhWarn(e); return; }

  ensureMiniSyncBus();
  syncMiniBtnState();
}

const _btnOpenerDetach = document.getElementById('opener-detach');
if (_btnOpenerDetach) _btnOpenerDetach.addEventListener('click', openMiniOpener);

const _streamerToggle = document.getElementById('opener-streamer-toggle');
if (_streamerToggle) {
  _streamerToggle.checked = isStreamerOverlayEnabled();
  _streamerToggle.addEventListener('change', () => {
    setStreamerOverlayEnabled(_streamerToggle.checked);
    if (_streamerToggle.checked) void openOrFocusStreamerHud();
    else updateOpenerStreamerHud();
  });
}

window.addEventListener('storage', (ev) => {
  if (ev.key !== STREAMER_OVERLAY_KEY) return;
  const t = document.getElementById('opener-streamer-toggle');
  if (!t) return;
  const on = ev.newValue === '1';
  t.checked = on;
  if (!on) closeStreamerHudWin();
});

// On démarre le bus sync dès le chargement pour absorber un mini-popup
// éventuellement ré-ouvert depuis un onglet précédent.
try { ensureMiniSyncBus(); } catch (_) {}

// Quand on sauvegarde localement, on prévient les autres fenêtres ouvertes
// (mini-popup notamment) — ne pas en faire trop : juste un postMessage léger.
const _origSave_forMini = (typeof save === 'function') ? save : null;
if (_origSave_forMini && !window.__saveWrappedForMini) {
  window.__saveWrappedForMini = true;
  // eslint-disable-next-line no-func-assign
  save = function () {
    const r = _origSave_forMini.apply(this, arguments);
    try { _miniSyncSuppressStorage = true; broadcastMainMutation('save'); } catch (_) {}
    return r;
  };
}

document.getElementById('opener-win-input').addEventListener('keydown', e => {
  const kb = getOpenerKeybinds();
  const k = String(e.key || '').toLowerCase();
  if (openerKeyMatch(k, kb.confirm) || k === 'arrowdown') { e.preventDefault(); openerConfirm(); }
  if (openerKeyMatch(k, kb.prev)) { e.preventDefault(); openerNav(-1); }
  if (openerKeyMatch(k, kb.next)) { e.preventDefault(); openerNav(1); }
});

// Auto-sauvegarde du gain dès qu'on tape (anti-perte si une re-render
// arrive depuis la sync cloud pendant la saisie).
let _openerSaveTimer = null;
function persistOpenerInputValue() {
  const hunt = activeHunt();
  if (!hunt || !Array.isArray(hunt.bonuses) || !hunt.bonuses[state.openerIndex]) return;
  const inp = document.getElementById('opener-win-input');
  if (!inp) return;
  const raw = String(inp.value || '').trim().replace(',', '.');
  if (raw === '') return;
  const v = parseFloat(raw);
  if (isNaN(v) || v < 0) return;
  const cur = hunt.bonuses[state.openerIndex].win;
  if (cur === v) return;
  hunt.bonuses[state.openerIndex].win = v;
  if (_openerSaveTimer) clearTimeout(_openerSaveTimer);
  _openerSaveTimer = setTimeout(() => save(), 350);
  try { updateOpenerStreamerHud(); } catch (_) {}
}
document.getElementById('opener-win-input').addEventListener('input', persistOpenerInputValue);
document.getElementById('opener-win-input').addEventListener('blur', () => {
  if (_openerSaveTimer) { clearTimeout(_openerSaveTimer); _openerSaveTimer = null; }
  persistOpenerInputValue();
  save();
});

function openOpener(index) {
  const hunt = activeHunt();
  if (!hunt) return;
  state.openerIndex = Math.max(0, Math.min(index, hunt.bonuses.length - 1));
  document.getElementById('opener').classList.remove('hidden');
  document.getElementById('opener-hunt-label').textContent = hunt.name;
  renderOpener();
}

function closeOpener() {
  // Persiste toute saisie en cours avant de fermer (sécurité anti-perte).
  try {
    if (typeof _openerSaveTimer !== 'undefined' && _openerSaveTimer) {
      clearTimeout(_openerSaveTimer);
      _openerSaveTimer = null;
    }
    if (typeof persistOpenerInputValue === 'function') persistOpenerInputValue();
    save();
  } catch (_) {}
  document.getElementById('opener').classList.add('hidden');
  renderHuntWorkspace();
}

function ensureStreamerHudPipLeaveListener() {
  if (window.__streamerHudPipLeaveBound) return;
  window.__streamerHudPipLeaveBound = true;
  try {
    if (!window.documentPictureInPicture) return;
    documentPictureInPicture.addEventListener('leave', () => {
      try {
        setStreamerOverlayEnabled(false);
        const t = document.getElementById('opener-streamer-toggle');
        if (t) t.checked = false;
      } catch (_) {}
    });
  } catch (_) {}
}

function closeStreamerHudWin() {
  hideInlineStreamerHud();
  try {
    const pipApi = window.documentPictureInPicture;
    if (pipApi?.window && !pipApi.window.closed) {
      try { pipApi.window.close(); } catch (_) {}
    }
  } catch (_) {}
  try {
    if (window.__streamerHudWin && !window.__streamerHudWin.closed) {
      window.__streamerHudWin.close();
    }
    window.__streamerHudWin = null;
  } catch (_) {}
  window.__streamerHudMode = null;
}

function isStreamerHudVisible() {
  try {
    const pip = window.documentPictureInPicture?.window;
    if (pip && !pip.closed) return true;
  } catch (_) {}
  if (window.__streamerHudWin && !window.__streamerHudWin.closed) return true;
  const inline = document.getElementById('streamer-hud-inline');
  return !!(inline && !inline.classList.contains('hidden'));
}

function ensureInlineStreamerHudShell() {
  let el = document.getElementById('streamer-hud-inline');
  if (el) return el;
  el = document.createElement('div');
  el.id = 'streamer-hud-inline';
  el.className = 'streamer-hud-inline hidden';
  el.innerHTML = `
    <div class="streamer-hud-inline-head">
      <span>HUD Stream</span>
      <div class="streamer-hud-inline-actions">
        <button type="button" class="streamer-hud-inline-btn" id="streamer-hud-inline-popout" title="Ouvrir dans une fenêtre">Pop-out</button>
        <button type="button" class="streamer-hud-inline-btn" id="streamer-hud-inline-close" title="Fermer">✕</button>
      </div>
    </div>
    <iframe src="./streamer-hud.html?embed=1" title="HUD Stream HugoTaSlot"></iframe>
  `;
  document.body.appendChild(el);
  el.querySelector('#streamer-hud-inline-close')?.addEventListener('click', () => {
    setStreamerOverlayEnabled(false);
    const t = document.getElementById('opener-streamer-toggle');
    if (t) t.checked = false;
    closeStreamerHudWin();
  });
  el.querySelector('#streamer-hud-inline-popout')?.addEventListener('click', () => {
    hideInlineStreamerHud();
    void openOrFocusStreamerHud({ forcePopup: true });
  });
  return el;
}

function showInlineStreamerHud() {
  const el = ensureInlineStreamerHudShell();
  el.classList.remove('hidden');
  window.__streamerHudMode = 'inline';
}

function hideInlineStreamerHud() {
  const el = document.getElementById('streamer-hud-inline');
  if (el) el.classList.add('hidden');
  if (window.__streamerHudMode === 'inline') window.__streamerHudMode = null;
}

async function openOrFocusStreamerHud(opts) {
  opts = opts || {};
  const toggle = document.getElementById('opener-streamer-toggle');
  const enabled = opts.force || toggle?.checked || isStreamerOverlayEnabled();
  if (!enabled) return;

  if (!opts.forcePopup && isStreamerHudVisible()) {
    if (window.__streamerHudMode === 'inline') showInlineStreamerHud();
    else if (window.__streamerHudWin && !window.__streamerHudWin.closed) {
      try { window.__streamerHudWin.focus(); } catch (_) {}
    }
    return;
  }

  if (opts.forcePopup) hideInlineStreamerHud();

  const pipApi = window.documentPictureInPicture;
  if (!opts.forcePopup && pipApi?.requestWindow) {
    try {
      const existing = pipApi.window;
      if (existing && !existing.closed) {
        try { existing.focus(); } catch (_) {}
        window.__streamerHudMode = 'pip';
        return;
      }
      ensureStreamerHudPipLeaveListener();
      const pipWin = await pipApi.requestWindow({
        width: 440,
        height: 640,
      });
      const pipDoc = pipWin.document;
      const st = pipDoc.createElement('style');
      st.textContent = 'html,body{margin:0;height:100%;background:#020202;}iframe{border:0;width:100%;height:100%;vertical-align:top;}';
      pipDoc.head.appendChild(st);
      pipDoc.body.style.margin = '0';
      pipDoc.body.style.minHeight = '100%';
      const iframe = pipDoc.createElement('iframe');
      iframe.src = new URL('streamer-hud.html', window.location.href).href;
      iframe.title = 'HUD Stream HugoTaSlot';
      iframe.style.cssText = 'border:0;width:100%;height:100%;min-height:400px;display:block;';
      pipDoc.body.appendChild(iframe);
      pipWin.addEventListener('pagehide', () => {
        try {
          setStreamerOverlayEnabled(false);
          const t = document.getElementById('opener-streamer-toggle');
          if (t) t.checked = false;
          try { localStorage.setItem(STREAMER_OVERLAY_KEY, '0'); } catch (_) {}
        } catch (_) {}
        window.__streamerHudMode = null;
      });
      window.__streamerHudMode = 'pip';
      showToast('HUD épinglé (Picture-in-Picture)', 'success', 2400);
      return;
    } catch (e) {
      bhWarn('Document PiP HUD', e);
    }
  }

  try {
    if (window.__streamerHudWin && !window.__streamerHudWin.closed) {
      try { window.__streamerHudWin.focus(); } catch (_) {}
      window.__streamerHudMode = 'popup';
      return;
    }
    const w = window.open(
      './streamer-hud.html',
      'hmStreamerHud',
      'popup=yes,width=440,height=600,resizable=yes,scrollbars=yes,toolbar=no,menubar=no,location=no,status=no'
    );
    if (w) {
      window.__streamerHudWin = w;
      window.__streamerHudMode = 'popup';
      return;
    }
  } catch (e) {
    bhWarn('openOrFocusStreamerHud popup', e);
  }

  showInlineStreamerHud();
  if (!window.__hudInlineToastShown) {
    window.__hudInlineToastShown = true;
    showToast(
      'HUD affiché en panneau intégré (popups bloquées). Utilise Pop-out ou l’URL OBS dans Studio si besoin.',
      'info',
      5200
    );
  }
}

function isStreamerOverlayEnabled() {
  try { return localStorage.getItem(STREAMER_OVERLAY_KEY) === '1'; } catch { return false; }
}
function setStreamerOverlayEnabled(on) {
  try { localStorage.setItem(STREAMER_OVERLAY_KEY, on ? '1' : '0'); } catch (_) {}
}

function updateOpenerStreamerHud() {
  const toggle = document.getElementById('opener-streamer-toggle');
  if (!toggle?.checked) {
    closeStreamerHudWin();
    return;
  }
  if (isStreamerHudVisible()) return;
  void openOrFocusStreamerHud();
}

function renderOpener() {
  const hunt = activeHunt();
  if (!hunt || hunt.bonuses.length === 0) return;
  const i = state.openerIndex;
  const bonus = hunt.bonuses[i];
  const total = hunt.bonuses.length;

  document.getElementById('opener-badge').textContent = `BONUS ${i+1} / ${total}`;
  document.getElementById('opener-slot-name').textContent = bonus.slotName || 'Slot';
  document.getElementById('opener-slot-prov').textContent = String(bonus.slotProvider || '').toUpperCase();
  document.getElementById('opener-stake').textContent = `MISE : ${fmt(bonus.stake)}`;
  const openerKind = document.getElementById('opener-bonus-kind');
  if (openerKind) {
    const kind = normalizeBonusType(bonus.bonusType);
    openerKind.textContent = formatBonusTypeLabel(kind);
    openerKind.className = `opener-bonus-kind ${kind}`;
  }

  // progress bar
  const completed = hunt.bonuses.filter(b => b.win !== null).length;
  document.getElementById('opener-progress').style.width = (completed / total * 100) + '%';

  const frame = document.getElementById('opener-img-frame');
  const _normImg = resolveBonusImageUrl(bonus);
  const _safeImg = isSafeUrl(_normImg) ? escapeHtml(_normImg) : '';
  const _safeAlt = escapeHtml(bonus.slotName || '');
  frame.innerHTML = _safeImg
    ? `<img src="${_safeImg}" alt="${_safeAlt}" referrerpolicy="no-referrer" onerror="this.parentElement.innerHTML='<div class=\\'opener-img-placeholder\\'><img src=\\'./assets/virtual-token.svg\\' class=\\'ui-logo-icon big\\' alt=\\'slot\\'></div>'">`
    : `<div class="opener-img-placeholder"><img src="./assets/virtual-token.svg" class="ui-logo-icon big" alt="slot"></div>`;

  // stats
  const totalStake = hunt.bonuses.reduce((s,b) => s + b.stake, 0);
  const startBalance = Number(hunt.startBalance || 0);
  const currentWin = hunt.bonuses.filter(b => b.win !== null).reduce((s,b) => s + b.win, 0);
  const profit = currentWin - startBalance;
  const beMoyen = beAverageMultiplierForHunt(hunt);

  const openerBeVal = document.getElementById('opener-be-val');
  if (openerBeVal) {
    openerBeVal.textContent = beMoyen > 0 ? `${beMoyen.toFixed(4).replace('.', ',')}×` : '—';
    openerBeVal.title = beMoyen > 0
      ? `Solde départ (${fmt(startBalance)}) ÷ mise totale du hunt (${fmt(totalStake)} sur tous les bonus) = multiplicateur moyen pour le break-even.`
      : '';
  }
  document.getElementById('opener-current-win').textContent = fmt(currentWin);
  const beRemainEl = document.getElementById('opener-be-remaining');
  const beProgEl = document.getElementById('opener-be-progress');
  const remain = Math.max(0, startBalance - currentWin);
  const progressPct = startBalance > 0 ? Math.min(100, (currentWin / startBalance) * 100) : 0;
  if (beRemainEl) {
    // Style Anthosaure : BE restant = multiplicateur moyen requis sur les bonus
    // ENCORE à ouvrir pour atteindre le break-even.
    // Formule : (startBalance - currentWin) / (totalStake - stake des bonus déjà ouverts)
    const openedStake = hunt.bonuses
      .filter((b) => b.win !== null && !isNaN(Number(b.win)))
      .reduce((s, b) => s + Number(b.stake || 0), 0);
    const remainStake = Math.max(0, totalStake - openedStake);
    if (remain <= 0.0001) {
      beRemainEl.textContent = 'ATTEINT';
      beRemainEl.title = `Break-even atteint (gains ${fmt(currentWin)} ≥ départ ${fmt(startBalance)})`;
      beRemainEl.className = 'opener-be-val green';
    } else if (remainStake > 0) {
      const remainMult = remain / remainStake;
      beRemainEl.textContent = `${remainMult.toFixed(4).replace('.', ',')}×`;
      beRemainEl.title = `Multiplicateur moyen requis sur les bonus restants (reste ${fmt(remain)} à gagner sur ${fmt(remainStake)} de mise restante).\nBE moyen initial : ${(totalStake > 0 ? (startBalance / totalStake).toFixed(4).replace('.', ',') : '—')}×`;
      const baseAvg = totalStake > 0 ? (startBalance / totalStake) : Infinity;
      beRemainEl.className = `opener-be-val ${remainMult <= baseAvg ? 'gold' : 'red'}`;
    } else {
      beRemainEl.textContent = '∞×';
      beRemainEl.title = 'Plus aucun bonus à ouvrir et break-even non atteint';
      beRemainEl.className = 'opener-be-val red';
    }
  }
  if (beProgEl) {
    beProgEl.textContent = `${progressPct.toFixed(1).replace('.', ',')}%`;
    beProgEl.className = `opener-be-val ${progressPct >= 100 ? 'green' : 'cyan'}`;
  }
  const profEl = document.getElementById('opener-profit');
  if (profit >= 0) { profEl.textContent = '+' + fmt(profit); profEl.className = 'opener-be-val green'; }
  else { profEl.textContent = fmt(profit); profEl.className = 'opener-be-val red'; }
  const openerHint = document.getElementById('opener-profit-hint');
  if (openerHint) openerHint.textContent = getProfitMotivation(profit, startBalance, currentWin);

  // input
  const inp = document.getElementById('opener-win-input');
  // Ne pas écraser une saisie en cours si on est focus sur ce champ pour ce même bonus.
  const isUserTyping = document.activeElement === inp && inp.value !== '' && inp.dataset.bonusIdx === String(state.openerIndex);
  if (!isUserTyping) {
    inp.value = bonus.win !== null && typeof bonus.win !== 'undefined' ? bonus.win : '';
    inp.dataset.bonusIdx = String(state.openerIndex);
    setTimeout(() => { try { inp.focus(); inp.select(); } catch (_) {} }, 60);
  }
  updateOpenerStreamerHud();
}

function openerConfirm() {
  if (!requireWriteAccess('Saisie gain bloquée')) return;
  const hunt = activeHunt();
  if (!hunt) return;
  const val = parseFloat(document.getElementById('opener-win-input').value);
  if (isNaN(val) || val < 0) { showToast('Entre un gain valide (0 ou plus)', 'error'); return; }
  setUndoSnapshot('saisie gain');
  hunt.bonuses[state.openerIndex].win = val;
  save();

  // Move to next pending
  const next = hunt.bonuses.findIndex((b, i) => i > state.openerIndex && b.win === null);
  if (next >= 0) { state.openerIndex = next; renderOpener(); }
  else {
    // All done?
    const anyPending = hunt.bonuses.some(b => b.win === null);
    if (!anyPending) { showToast('Hunt terminé ! Tous les bonus sont ouverts.', 'success', 4000); closeOpener(); }
    else { state.openerIndex = Math.min(state.openerIndex + 1, hunt.bonuses.length - 1); renderOpener(); }
  }
}

function openerNav(dir) {
  const hunt = activeHunt();
  if (!hunt) return;
  // Save current value silently if valid
  const val = parseFloat(document.getElementById('opener-win-input').value);
  if (!isNaN(val) && val >= 0) { hunt.bonuses[state.openerIndex].win = val; save(); }
  state.openerIndex = Math.max(0, Math.min(state.openerIndex + dir, hunt.bonuses.length - 1));
  renderOpener();
}

function initHuntOpenerUi() {
  const bind = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.huntOpBound) return;
    el.dataset.huntOpBound = '1';
    el.addEventListener(ev, fn);
  };
  bind('btn-open-hunt', 'click', openHuntFromButton);
  bind('btn-open-hunt-header', 'click', openHuntFromButton);
  bind('opener-close', 'click', closeOpener);
  bind('opener-confirm', 'click', openerConfirm);
  bind('opener-prev', 'click', () => openerNav(-1));
  bind('opener-next', 'click', () => openerNav(1));
  bind('opener-detach', 'click', openMiniOpener);
  const streamerToggle = document.getElementById('opener-streamer-toggle');
  if (streamerToggle && !streamerToggle.dataset.huntOpBound) {
    streamerToggle.dataset.huntOpBound = '1';
    streamerToggle.checked = isStreamerOverlayEnabled();
    streamerToggle.addEventListener('change', () => {
      setStreamerOverlayEnabled(streamerToggle.checked);
      if (streamerToggle.checked) void openOrFocusStreamerHud();
      else updateOpenerStreamerHud();
    });
  }
  if (!window.__streamerOverlayStorageBound) {
    window.__streamerOverlayStorageBound = true;
    window.addEventListener('storage', (ev) => {
      if (ev.key !== STREAMER_OVERLAY_KEY) return;
      const t = document.getElementById('opener-streamer-toggle');
      if (!t) return;
      const on = ev.newValue === '1';
      t.checked = on;
      if (!on) closeStreamerHudWin();
    });
  }
  try { ensureMiniSyncBus(); } catch (_) {}
  const _origSave_forMini = (typeof save === 'function') ? save : null;
  if (_origSave_forMini && !window.__saveWrappedForMini) {
    window.__saveWrappedForMini = true;
    save = function () {
      const r = _origSave_forMini.apply(this, arguments);
      try { _miniSyncSuppressStorage = true; broadcastMainMutation('save'); } catch (_) {}
      return r;
    };
  }
  const winInp = document.getElementById('opener-win-input');
  if (winInp && !winInp.dataset.huntOpBound) {
    winInp.dataset.huntOpBound = '1';
    winInp.addEventListener('keydown', (e) => {
      const kb = getOpenerKeybinds();
      const k = String(e.key || '').toLowerCase();
      if (openerKeyMatch(k, kb.confirm) || k === 'arrowdown') { e.preventDefault(); openerConfirm(); }
      if (openerKeyMatch(k, kb.prev)) { e.preventDefault(); openerNav(-1); }
      if (openerKeyMatch(k, kb.next)) { e.preventDefault(); openerNav(1); }
    });
    winInp.addEventListener('input', persistOpenerInputValue);
    winInp.addEventListener('blur', () => {
      if (_openerSaveTimer) { clearTimeout(_openerSaveTimer); _openerSaveTimer = null; }
      persistOpenerInputValue();
      save();
    });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuntOpenerUi);
else initHuntOpenerUi();

