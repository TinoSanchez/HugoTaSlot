'use strict';
/* globals getUiPrefs, fmt, escapeHtml, state, activeHunt, getAuthClient, cloudCall, bhWarn, isCurrentUserAdmin, currentUser, getUsers, adminFetchCloudUsers, selectHunt, switchPage, openOpener, copyPublicHuntLiveLink, renderUpdatesPage, OPS_ALERTS_KEY, RUNTIME_LOG_KEY, onlineChannel, supaHealth */
/* UI transverse — SFX, toasts, maintenance, a11y, recherche (boot après cloud-hunts) */

let uiAudioCtx = null;
let __sfxNoiseBuf = null;

// ─── MOTEUR AUDIO CASINO ───
// Sons synthétisés en WebAudio (aucun fichier externe) : jetons, cartes,
// roulette, pièces, explosions, fanfares de gain. Volume contrôlé par les
// préférences utilisateur (uiVolume × uiGameVolume, mute respecté).
function __sfxCtx() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!uiAudioCtx) uiAudioCtx = new AC();
  if (uiAudioCtx.state === 'suspended') uiAudioCtx.resume();
  const prefs = getUiPrefs();
  if (prefs.uiMuted) return null;
  const vol = Math.max(0, Math.min(1, (Number(prefs.uiVolume ?? 70) / 100)))
    * Math.max(0, Math.min(1, (Number(prefs.uiGameVolume ?? 85) / 100)));
  if (vol <= 0) return null;
  if (!__sfxNoiseBuf) {
    const len = uiAudioCtx.sampleRate * 1.2;
    __sfxNoiseBuf = uiAudioCtx.createBuffer(1, len, uiAudioCtx.sampleRate);
    const d = __sfxNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }
  return { ctx: uiAudioCtx, vol, now: uiAudioCtx.currentTime };
}
function __sfxNoise(env, { at = 0, dur = 0.1, hp = 0, lp = 20000, peak = 0.05, attack = 0.005 } = {}) {
  const { ctx, vol, now } = env;
  const src = ctx.createBufferSource();
  src.buffer = __sfxNoiseBuf;
  src.loop = true;
  let node = src;
  if (hp > 0) { const f = ctx.createBiquadFilter(); f.type = 'highpass'; f.frequency.value = hp; node.connect(f); node = f; }
  if (lp < 20000) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; node.connect(f); node = f; }
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, now + at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vol), now + at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
  node.connect(g); g.connect(ctx.destination);
  src.start(now + at, Math.random() * 0.5); src.stop(now + at + dur + 0.03);
  return node;
}
function __sfxTone(env, { at = 0, f0 = 440, f1 = 0, dur = 0.12, type = 'sine', peak = 0.05, attack = 0.008 } = {}) {
  const { ctx, vol, now } = env;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(Math.max(20, f0), now + at);
  if (f1 > 0) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), now + at + dur);
  g.gain.setValueAtTime(0.0001, now + at);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak * vol), now + at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
  o.connect(g); g.connect(ctx.destination);
  o.start(now + at); o.stop(now + at + dur + 0.03);
}
function __sfxBell(env, { at = 0, freq = 880, dur = 0.5, peak = 0.05 } = {}) {
  // Cloche : fondamentale + partiel inharmonique ×2.76 (timbre métallique)
  __sfxTone(env, { at, f0: freq, dur, type: 'sine', peak, attack: 0.004 });
  __sfxTone(env, { at, f0: freq * 2.76, dur: dur * 0.55, type: 'sine', peak: peak * 0.32, attack: 0.004 });
}
function casinoSfx(type, opt = {}) {
  try {
    const env = __sfxCtx();
    if (!env) return;
    const p = Math.max(0.4, Math.min(2.4, Number(opt.pitch || 1)));
    switch (type) {
      case 'chip': {
        // Clac céramique : double claquement bref filtré
        __sfxNoise(env, { dur: 0.028, hp: 2200, lp: 9000, peak: 0.075, attack: 0.002 });
        __sfxTone(env, { f0: 2300 * p, f1: 1700 * p, dur: 0.03, type: 'square', peak: 0.022, attack: 0.002 });
        __sfxNoise(env, { at: 0.035, dur: 0.022, hp: 2600, lp: 9500, peak: 0.05, attack: 0.002 });
        break;
      }
      case 'chips': {
        for (let i = 0; i < 4; i++) {
          __sfxNoise(env, { at: i * 0.038, dur: 0.026, hp: 2100 + i * 220, lp: 9200, peak: 0.06, attack: 0.002 });
        }
        break;
      }
      case 'card': {
        // Glissé de carte + snap final
        __sfxNoise(env, { dur: 0.1, hp: 700, lp: 4200, peak: 0.045, attack: 0.03 });
        __sfxNoise(env, { at: 0.085, dur: 0.018, hp: 1400, lp: 7000, peak: 0.065, attack: 0.002 });
        break;
      }
      case 'flip': {
        __sfxNoise(env, { dur: 0.07, hp: 900, lp: 5200, peak: 0.045, attack: 0.015 });
        __sfxTone(env, { at: 0.06, f0: 480 * p, f1: 300 * p, dur: 0.05, type: 'triangle', peak: 0.03 });
        break;
      }
      case 'spin': {
        // Lancer de roue : souffle qui monte puis retombe
        __sfxNoise(env, { dur: 0.55, hp: 380, lp: 2600, peak: 0.05, attack: 0.16 });
        __sfxTone(env, { f0: 160, f1: 90, dur: 0.5, type: 'sine', peak: 0.02, attack: 0.1 });
        break;
      }
      case 'tick': {
        __sfxTone(env, { f0: 1900 * p, dur: 0.014, type: 'square', peak: 0.018, attack: 0.001 });
        break;
      }
      case 'ball': {
        // Bille qui retombe : tic-tic-toc amorti
        __sfxTone(env, { f0: 2300, dur: 0.018, type: 'square', peak: 0.03, attack: 0.001 });
        __sfxTone(env, { at: 0.09, f0: 2100, dur: 0.016, type: 'square', peak: 0.024, attack: 0.001 });
        __sfxTone(env, { at: 0.165, f0: 1900, dur: 0.015, type: 'square', peak: 0.018, attack: 0.001 });
        __sfxNoise(env, { at: 0.22, dur: 0.05, hp: 1200, lp: 6000, peak: 0.035, attack: 0.004 });
        break;
      }
      case 'pop': {
        __sfxTone(env, { f0: (560 + Math.random() * 240) * p, f1: 320 * p, dur: 0.045, type: 'sine', peak: 0.045, attack: 0.002 });
        break;
      }
      case 'coin': {
        const f = (1700 + Math.random() * 900) * p;
        __sfxBell(env, { freq: f, dur: 0.22, peak: 0.035 });
        break;
      }
      case 'cashout': {
        // Cha-ching : double cloche + pluie de pièces
        __sfxBell(env, { freq: 1567, dur: 0.4, peak: 0.05 });
        __sfxBell(env, { at: 0.07, freq: 1975, dur: 0.45, peak: 0.045 });
        for (let i = 0; i < 4; i++) {
          __sfxBell(env, { at: 0.12 + i * 0.06, freq: 1900 + Math.random() * 1300, dur: 0.16, peak: 0.02 });
        }
        break;
      }
      case 'win': {
        // Arpège majeur ascendant + shimmer
        const notes = [880, 1108.7, 1318.5, 1760];
        notes.forEach((f, i) => __sfxBell(env, { at: i * 0.075, freq: f, dur: 0.42, peak: 0.045 }));
        __sfxNoise(env, { at: 0.05, dur: 0.45, hp: 6500, lp: 12000, peak: 0.018, attack: 0.1 });
        for (let i = 0; i < 5; i++) {
          __sfxBell(env, { at: 0.18 + i * 0.07, freq: 1800 + Math.random() * 1500, dur: 0.15, peak: 0.016 });
        }
        break;
      }
      case 'bigwin': {
        // Fanfare : double arpège + sub + averse de pièces
        __sfxTone(env, { f0: 80, f1: 50, dur: 0.4, type: 'sine', peak: 0.07, attack: 0.01 });
        const arp1 = [659.3, 830.6, 987.8, 1318.5];
        const arp2 = [880, 1108.7, 1318.5, 1760];
        arp1.forEach((f, i) => __sfxBell(env, { at: i * 0.085, freq: f, dur: 0.5, peak: 0.05 }));
        arp2.forEach((f, i) => __sfxBell(env, { at: 0.34 + i * 0.085, freq: f, dur: 0.6, peak: 0.05 }));
        for (let i = 0; i < 12; i++) {
          __sfxBell(env, { at: 0.3 + i * 0.075, freq: 1600 + Math.random() * 2200, dur: 0.18, peak: 0.018 });
        }
        __sfxNoise(env, { at: 0.25, dur: 0.9, hp: 7000, lp: 13000, peak: 0.02, attack: 0.2 });
        break;
      }
      case 'lose': {
        // Descente molle + thud sourd
        __sfxTone(env, { f0: 220, f1: 116, dur: 0.32, type: 'triangle', peak: 0.035, attack: 0.01 });
        __sfxNoise(env, { dur: 0.12, lp: 320, peak: 0.05, attack: 0.004 });
        break;
      }
      case 'boom': {
        // Explosion : burst grave + sub qui plonge
        __sfxNoise(env, { dur: 0.42, lp: 900, peak: 0.12, attack: 0.003 });
        __sfxNoise(env, { dur: 0.14, hp: 800, lp: 4500, peak: 0.06, attack: 0.002 });
        __sfxTone(env, { f0: 95, f1: 32, dur: 0.45, type: 'sine', peak: 0.09, attack: 0.004 });
        break;
      }
      case 'rocket': {
        __sfxTone(env, { f0: 130 * p, f1: 520 * p, dur: 0.5, type: 'sawtooth', peak: 0.018, attack: 0.06 });
        __sfxNoise(env, { dur: 0.5, hp: 300, lp: 1800, peak: 0.025, attack: 0.1 });
        break;
      }
      default: {
        __sfxTone(env, { f0: 600, dur: 0.05, type: 'sine', peak: 0.03 });
      }
    }
  } catch (_) {}
}
// Compat : ancien point d'entrée conservé, mappé sur le moteur casino
function playGameSfx(gameId, phase = 'start') {
  if (phase === 'win') casinoSfx('win');
  else if (phase === 'lose') casinoSfx('lose');
  else casinoSfx(gameId === 'roulette' ? 'spin' : 'card');
}

// ─── CÉLÉBRATION DE GAIN (overlay animé dans la fenêtre de jeu) ───
function gameWinFx(prize, mult) {
  try {
    const amount = Number(prize || 0);
    if (amount <= 0) return;
    const m = Number(mult || 0);
    const big = m >= 10 || amount >= 100;
    const host = document.getElementById('game-window');
    if (!host || host.classList.contains('hidden')) return;
    const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const fx = document.createElement('div');
    fx.className = 'game-win-fx' + (big ? ' big' : '');
    let coins = '';
    if (!reduced) {
      const n = big ? 26 : 14;
      for (let i = 0; i < n; i++) {
        const x = (Math.random() * 320 - 160).toFixed(0);
        const y = (-(120 + Math.random() * 220)).toFixed(0);
        const d = (Math.random() * 0.25).toFixed(2);
        const s = (0.6 + Math.random() * 0.9).toFixed(2);
        coins += `<span class="game-win-coin" style="--cx:${x}px;--cy:${y}px;--cd:${d}s;--cs:${s}"></span>`;
      }
    }
    fx.innerHTML = `
      ${big ? '<div class="game-win-banner">BIG WIN</div>' : ''}
      <div class="game-win-amount">+${fmt(amount)}</div>
      ${m > 1 ? `<div class="game-win-mult">×${m.toFixed(2)}</div>` : ''}
      <div class="game-win-coins">${coins}</div>`;
    host.appendChild(fx);
    const bal = document.getElementById('game-window-balance');
    if (bal) { bal.classList.remove('balance-pulse'); void bal.offsetWidth; bal.classList.add('balance-pulse'); }
    setTimeout(() => { try { fx.remove(); } catch (_) {} }, big ? 2300 : 1700);
  } catch (_) {}
}
function playUiTone(kind = 'click') {
  try {
    const prefs = getUiPrefs();
    if (prefs.uiSound === false) return;
    if (prefs.uiMuted) return;
    const volume = Math.max(0, Math.min(1, (Number(prefs.uiVolume ?? 70) / 100)));
    const gameVolume = Math.max(0, Math.min(1, (Number(prefs.uiGameVolume ?? 85) / 100)));
    const finalVolume = volume * gameVolume;
    if (finalVolume <= 0) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!uiAudioCtx) uiAudioCtx = new AC();
    if (uiAudioCtx.state === 'suspended') uiAudioCtx.resume();

    const now = uiAudioCtx.currentTime;
    const osc = uiAudioCtx.createOscillator();
    const gain = uiAudioCtx.createGain();
    osc.type = kind === 'success' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(kind === 'success' ? 620 : 420, now);
    if (kind === 'success') osc.frequency.exponentialRampToValueAtTime(780, now + 0.07);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.028 * finalVolume, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + (kind === 'success' ? 0.13 : 0.07));
    osc.connect(gain);
    gain.connect(uiAudioCtx.destination);
    osc.start(now);
    osc.stop(now + (kind === 'success' ? 0.14 : 0.08));
  } catch {}
}

function showToast(msg, type = 'info', ms = 2600) {
  const c = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  c.appendChild(t);
  if (type === 'success') playUiTone('success');
  setTimeout(() => { t.style.opacity = '0'; t.style.transform = 'translateX(20px)'; t.style.transition = '0.3s'; setTimeout(() => t.remove(), 300); }, ms);
}

function confirm(title, msg) {
  return new Promise(resolve => {
    const o = document.getElementById('confirm-overlay');
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-msg').textContent = msg;
    o.classList.remove('hidden');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    const done = (v) => { o.classList.add('hidden'); ok.onclick = null; cancel.onclick = null; resolve(v); };
    ok.onclick = () => done(true);
    cancel.onclick = () => done(false);
  });
}
function confirmRich(title, html, okText = 'CONFIRMER', cancelText = 'ANNULER') {
  return new Promise(resolve => {
    const o = document.getElementById('confirm-overlay');
    const titleEl = document.getElementById('confirm-title');
    const msgEl = document.getElementById('confirm-msg');
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.innerHTML = html;
    if (ok) ok.textContent = okText;
    if (cancel) cancel.textContent = cancelText;
    o.classList.remove('hidden');
    const done = (v) => {
      o.classList.add('hidden');
      if (ok) { ok.onclick = null; ok.textContent = 'SUPPRIMER'; }
      if (cancel) { cancel.onclick = null; cancel.textContent = 'ANNULER'; }
      if (msgEl) msgEl.innerHTML = '';
      resolve(v);
    };
    if (ok) ok.onclick = () => done(true);
    if (cancel) cancel.onclick = () => done(false);
  });
}

// ═══════════════════════════════════════════════
//  LOAD SLOTS (with fallback & lazy render)
// ═══════════════════════════════════════════════

let lastOpsAlertAt = 0;

const MAINTENANCE_DEFAULT = { enabled: false, message: 'Maintenance en cours. Mode lecture seule temporaire.' };
let maintenanceCache = { ...MAINTENANCE_DEFAULT, fetchedAt: 0, source: 'default' };
const MAINTENANCE_POLL_MS = 60000;
let maintenancePollTimer = null;

function normalizeMaintenanceConfig(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    enabled: !!(src.enabled ?? src.active),
    message: String(src.message || MAINTENANCE_DEFAULT.message).slice(0, 220)
  };
}
function getMaintenanceConfig() {
  return normalizeMaintenanceConfig(maintenanceCache);
}
async function refreshMaintenanceConfig(force = false) {
  const now = Date.now();
  if (!force && maintenanceCache.fetchedAt && (now - maintenanceCache.fetchedAt) < MAINTENANCE_POLL_MS) {
    return getMaintenanceConfig();
  }
  const c = getAuthClient();
  if (!c) {
    if (!maintenanceCache.fetchedAt) {
      maintenanceCache = { ...MAINTENANCE_DEFAULT, fetchedAt: now, source: 'offline' };
    }
    return getMaintenanceConfig();
  }
  try {
    const { data, error } = await cloudCall('sync', () => c.rpc('get_site_maintenance'), {
      retries: 1,
      timeoutMs: 8000,
      delayMs: 300,
      quiet: true
    });
    if (error) throw error;
    const cfg = normalizeMaintenanceConfig(data);
    maintenanceCache = { ...cfg, fetchedAt: now, source: 'cloud' };
    renderMaintenanceBanner();
    return cfg;
  } catch (e) {
    bhWarn('refreshMaintenanceConfig', e);
    if (!maintenanceCache.fetchedAt) {
      maintenanceCache = { ...MAINTENANCE_DEFAULT, fetchedAt: now, source: 'fallback' };
    }
    return getMaintenanceConfig();
  }
}
function startMaintenancePolling() {
  if (maintenancePollTimer) return;
  maintenancePollTimer = setInterval(() => {
    refreshMaintenanceConfig(false).catch(() => {});
  }, MAINTENANCE_POLL_MS);
}
function getOpsAlertsConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(OPS_ALERTS_KEY) || '{}');
    return {
      enabled: !!raw.enabled,
      webhookUrl: String(raw.webhookUrl || '')
    };
  } catch (_) { return { enabled: false, webhookUrl: '' }; }
}
function saveOpsAlertsConfig(cfg) {
  const next = {
    enabled: !!cfg?.enabled,
    webhookUrl: String(cfg?.webhookUrl || '').slice(0, 360)
  };
  try { localStorage.setItem(OPS_ALERTS_KEY, JSON.stringify(next)); } catch (_) {}
}
function getAutoSnapshots() {
  try {
    const raw = localStorage.getItem(AUTO_SNAPSHOT_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
// [cloud-hunts] auto snapshots hunts

async function sendOpsAlert(level, message, opts = {}) {
  try {
    const cfg = getOpsAlertsConfig();
    if (!cfg.enabled || !/^https?:\/\//i.test(cfg.webhookUrl || '')) {
      return { ok: false, reason: 'disabled_or_no_url' };
    }
    const now = Date.now();
    if (!opts.force && now - lastOpsAlertAt < 45000) {
      return { ok: false, reason: 'cooldown' };
    }
    if (!opts.force) lastOpsAlertAt = now;
    const res = await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app: 'HugoTaSlot',
        level: String(level || 'error'),
        message: String(message || '').slice(0, 300),
        ts: new Date().toISOString(),
        url: String(location?.href || ''),
        source: String(opts.source || 'runtime'),
        test: !!opts.test
      })
    });
    if (!res.ok) return { ok: false, reason: `http_${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: String(e?.message || e) };
  }
}
function isMaintenanceReadOnly() {
  const m = getMaintenanceConfig();
  return m.enabled && !isCurrentUserAdmin();
}
function requireWriteAccess(label = 'Action indisponible', opts = {}) {
  if (!opts.ignoreReadOnlyHunt) {
    const hunt = activeHunt();
    if (hunt && hunt.readOnlyShared) {
      showToast(`${label} — Hunt partagé en lecture seule`, 'error', 2400);
      return false;
    }
  }
  if (!isMaintenanceReadOnly()) return true;
  const m = getMaintenanceConfig();
  showToast(`${label} — ${m.message}`, 'error', 2600);
  return false;
}
function renderMaintenanceBanner() {
  const m = getMaintenanceConfig();
  let el = document.getElementById('maintenance-banner');
  if (!m.enabled) {
    if (el) el.style.display = 'none';
    return;
  }
  if (!el) {
    el = document.createElement('div');
    el.id = 'maintenance-banner';
    el.style.cssText = 'position:fixed;left:50%;top:10px;transform:translateX(-50%);z-index:3200;padding:8px 12px;border-radius:10px;border:1px solid rgba(255,196,0,0.45);background:rgba(38,28,8,0.95);color:#ffe3a3;font-family:"Share Tech Mono",monospace;font-size:11px;box-shadow:0 8px 24px rgba(0,0,0,0.35)';
    document.body.appendChild(el);
  }
  const modeTxt = isCurrentUserAdmin() ? 'ADMIN (écriture autorisée)' : 'JOUEUR (lecture seule)';
  el.textContent = `MAINTENANCE ACTIVE · ${modeTxt} · ${m.message}`;
  el.style.display = 'block';
}
function getRuntimeLogs() {
  try {
    const raw = localStorage.getItem(RUNTIME_LOG_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (_) { return []; }
}
function pushRuntimeLog(level, message) {
  try {
    const logs = getRuntimeLogs();
    logs.unshift({
      ts: Date.now(),
      level: String(level || 'info').toLowerCase(),
      msg: String(message || '').slice(0, 240)
    });
    localStorage.setItem(RUNTIME_LOG_KEY, JSON.stringify(logs.slice(0, 40)));
  } catch (_) {}
  const lvl = String(level || 'info').toLowerCase();
  if (lvl === 'error') sendOpsAlert(lvl, message).catch(() => {});
}
function clearRuntimeLogs() {
  try { localStorage.removeItem(RUNTIME_LOG_KEY); } catch (_) {}
  renderUpdatesPage();
}

function isMobileNavMode() {
  return window.matchMedia('(max-width: 720px)').matches;
}

function setMobileSidebarOpen(open) {
  document.body.classList.toggle('sidebar-open', !!open);
  const backdrop = document.getElementById('sidebar-backdrop');
  const toggle = document.getElementById('mobile-nav-toggle');
  if (backdrop) {
    backdrop.hidden = !open;
    backdrop.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (toggle) {
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute(
      'aria-label',
      open ? 'Fermer le menu de navigation' : 'Ouvrir le menu de navigation'
    );
  }
  if (open) {
    const first = document.querySelector(
      '#sidebar .sidebar-btn, #sidebar .sidebar-tab'
    );
    if (first && typeof first.focus === 'function') {
      setTimeout(() => first.focus(), 40);
    }
  }
}

function closeMobileSidebar() {
  if (isMobileNavMode()) setMobileSidebarOpen(false);
}

function initSidebarNavA11y() {
  const nav = document.querySelector('.sidebar-tabs');
  if (nav && !nav.dataset.bound) {
    nav.dataset.bound = '1';
    nav.addEventListener('click', (e) => {
      const btn = e.target.closest('.sidebar-tab[data-page]');
      if (!btn) return;
      switchPage(btn.dataset.page);
    });
  }
  const toggle = document.getElementById('mobile-nav-toggle');
  if (toggle && !toggle.dataset.bound) {
    toggle.dataset.bound = '1';
    toggle.addEventListener('click', () => {
      setMobileSidebarOpen(!document.body.classList.contains('sidebar-open'));
    });
  }
  const backdrop = document.getElementById('sidebar-backdrop');
  if (backdrop && !backdrop.dataset.bound) {
    backdrop.dataset.bound = '1';
    backdrop.addEventListener('click', () => setMobileSidebarOpen(false));
  }
}

function getFocusableIn(container) {
  return [...container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )].filter((el) => el.offsetParent !== null);
}

const modalFocusTraps = new WeakMap();

function bindModalFocusTrap(overlay) {
  if (!overlay || modalFocusTraps.has(overlay)) return;
  const onKeyDown = (e) => {
    if (overlay.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      overlay.classList.add('hidden');
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = getFocusableIn(overlay);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  overlay.addEventListener('keydown', onKeyDown);
  modalFocusTraps.set(overlay, { onKeyDown, previousFocus: null });
}

function focusModalWhenOpened(overlay) {
  bindModalFocusTrap(overlay);
  const trap = modalFocusTraps.get(overlay);
  if (trap) trap.previousFocus = document.activeElement;
  requestAnimationFrame(() => {
    const focusable = getFocusableIn(overlay);
    const target =
      focusable.find((el) => !el.classList.contains('modal-close')) ||
      focusable[0];
    if (target) target.focus();
  });
}

function initModalA11yObserver() {
  document.querySelectorAll('.modal-overlay').forEach(bindModalFocusTrap);
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      const el = m.target;
      if (!el.classList?.contains('modal-overlay')) continue;
      if (!el.classList.contains('hidden')) focusModalWhenOpened(el);
      else {
        const trap = modalFocusTraps.get(el);
        if (trap?.previousFocus?.focus) trap.previousFocus.focus();
      }
    }
  });
  document.querySelectorAll('.modal-overlay').forEach((el) => {
    observer.observe(el, { attributes: true, attributeFilter: ['class'] });
  });
}


let globalSearchDebounce = null;
let globalSearchCloudUsersCache = [];
let globalSearchCloudUsersAt = 0;
async function runGlobalSearch() {
  const input = document.getElementById('global-search-input');
  const out = document.getElementById('global-search-results');
  if (!input || !out) return;
  const q = String(input.value || '').trim().toLowerCase();
  if (!q) { out.innerHTML = ''; return; }

  const rows = [];
  const reviewKeys = ['review', 'avis', 'retour', 'retours', 'feedback', 'beta', 'bêta', 'testeur', 'testeurs', 'suggestion', 'suggestions', 'bug', 'idee', 'idée'];
  if (reviewKeys.some((k) => q === k || (k.length > 3 && (q.includes(k) || k.includes(q))))) {
    rows.push({ t: 'review', label: 'Page REVIEW — avis & bugs (bêta)', action: `switchPage('review')` });
  }
  const studioKeys = ['studio', 'stream', 'streamer', 'obs', 'hud', 'opener', 'overlay', 'live'];
  if (studioKeys.some((k) => q === k || q.includes(k))) {
    rows.push({ t: 'studio', label: 'Studio Stream — opener, HUD, options live', action: `switchPage('studio')` });
  }
  if (q.includes('live') || q.includes('public') || q.includes('spectateur') || q.includes('viewer')) {
    rows.push({ t: 'live', label: 'Lien public live du hunt (bouton LIEN LIVE)', action: `selectHunt(state.activeHuntId);switchPage('hunt');copyPublicHuntLiveLink()` });
  }
  const newsKeys = ['news', 'actu', 'actus', 'actualité', 'actualités', 'actualite', 'actualites', 'video', 'vidéo', 'youtube', 'slot', 'slots', 'sortie', 'sorties', 'nouveauté', 'nouveautes', 'discord'];
  if (newsKeys.some((k) => q === k || (k.length > 3 && (q.includes(k) || k.includes(q))))) {
    rows.push({ t: 'news', label: 'Page ACTUALITÉS — vidéos YouTube & nouvelles slots', action: `switchPage('news')` });
  }
  (state.hunts || []).forEach((h) => {
    const hName = String(h.name || '').toLowerCase();
    if (hName.includes(q)) rows.push({ t: 'hunt', label: `Hunt: ${h.name}`, action: `selectHunt('${h.id}');switchPage('hunt')` });
    (h.bonuses || []).forEach((b, idx) => {
      const n = String(b.slotName || '').toLowerCase();
      const p = String(b.slotProvider || '').toLowerCase();
      if (n.includes(q) || p.includes(q)) {
        rows.push({ t: 'bonus', label: `${b.slotName} (${b.slotProvider || '—'})`, action: `selectHunt('${h.id}');switchPage('hunt');openOpener(${idx})` });
      }
    });
  });

  if (isCurrentUserAdmin()) {
    let users = [];
    if (currentUser?.cloud) {
      const now = Date.now();
      if ((now - globalSearchCloudUsersAt) > 20000) {
        try {
          globalSearchCloudUsersCache = await adminFetchCloudUsers();
          globalSearchCloudUsersAt = now;
        } catch (_) {}
      }
      users = globalSearchCloudUsersCache;
    } else {
      users = Object.entries(getUsers()).map(([username, u]) => ({ username, email: u?.email || '' }));
    }
    users.forEach((u) => {
      const un = String(u.username || '').toLowerCase();
      const em = String(u.email || '').toLowerCase();
      if (un.includes(q) || em.includes(q)) rows.push({ t: 'user', label: `User: ${u.username}`, action: `switchPage('admin')` });
    });
  }

  const top = rows.slice(0, 20);
  out.innerHTML = top.length
    ? `<div class="table-wrap"><table style="width:100%;border-collapse:collapse;"><tbody>${
        top.map((r) => `<tr><td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.label)}</td><td style="padding:8px;border-top:1px solid var(--border);text-align:right;"><button class="profile-mini-btn" onclick="${r.action}">Ouvrir</button></td></tr>`).join('')
      }</tbody></table></div>`
    : `<div class="bj-rec">Aucun résultat pour "${escapeHtml(q)}"</div>`;
}
