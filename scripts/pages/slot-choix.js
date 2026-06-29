// Slot des Choix — même machine que le dépôt, 4 rouleaux (slot · type · nombre · mise)
'use strict';
/* globals showToast, casinoSfx, ensureSlotsLoaded, state, normalizeSlotImageUrl, isSafeUrl, depSlotClearJackpotFx, depSlotPlayJackpotFx */

const CHOIX_LS_KEY = 'bh_slot_choix_prefs_v2';
const CHOIX_CELL_H = 64;
const CHOIX_REPS = 10; // ≥10 pour que la payline du 4e rouleau reste dans la bande
const CHOIX_STRIP_DECK = 24;
const CHOIX_NONE_SLOT = Object.freeze({ id: '__none', nom: 'Aucune machine', image: '' });
const CHOIX_REEL_ORDER = Object.freeze(['machine', 'type', 'count', 'stake']);
const CHOIX_SEC_KEYS = Object.freeze(['machine', 'type', 'count', 'stake']);

const CHOIX_TYPES = Object.freeze([
  { id: 'normal', label: 'Spin normal', short: 'NORMAL' },
  { id: 'boost', label: 'Spin boosté', short: 'BOOST' },
  { id: 'features', label: 'Spin features', short: 'FEAT.' },
  { id: 'buy_simple', label: 'Achat bonus simple', short: 'B.SIMPLE' },
  { id: 'buy_med', label: 'Achat bonus moyen', short: 'B.MOYEN' },
  { id: 'buy_big', label: 'Achat bonus gros', short: 'B.GROS' },
]);

const CHOIX_COUNTS = Object.freeze([1, 2, 3, 4, 5, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);

const CHOIX_STAKES = (() => {
  const out = [0.1, 0.2];
  for (let v = 0.4; v <= 10.0001; v += 0.2) out.push(Math.round(v * 10) / 10);
  return Object.freeze(out);
})();

const CHOIX_TEXT_REELS = Object.freeze([
  { key: 'type', title: 'TYPE', items: CHOIX_TYPES, itemId: (x) => x.id, short: (x) => x.short, full: (x) => x.label },
  { key: 'count', title: 'NOMBRE', items: CHOIX_COUNTS, itemId: (x) => String(x), short: (x) => String(x), full: (x) => String(x) },
  { key: 'stake', title: 'MISE', items: CHOIX_STAKES, itemId: (x) => choixStakeId(x), short: (x) => choixFmtStakeReel(x), full: (x) => `${choixFmtStakeLabel(x)}€` },
]);

let choixSlotSpinning = false;
let choixLastResult = null;

function choixStakeId(v) { return Number(v).toFixed(1); }

function choixFmtStakeLabel(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toFixed(1).replace(/\.0$/, '').replace('.', ',');
}

function choixFmtStakeReel(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n < 1 ? n.toFixed(1) : (Number.isInteger(n) ? String(n) : n.toFixed(1));
}

function choixRoot() { return document.getElementById('hunt-tab-choix') || document; }

function choixWrap() { return choixRoot().querySelector('.choix-wheel-wrap'); }

function choixStage() { return choixWrap()?.querySelector('.deposit-slot-stage') || null; }

function choixSetResult(msg) {
  const el = choixWrap()?.querySelector('.dep-result');
  if (el) el.textContent = msg;
}

function choixOffset(cellIdx) { return -(cellIdx * CHOIX_CELL_H) + CHOIX_CELL_H; }

function choixRandIdx(len, exclude) {
  const skip = exclude instanceof Set ? exclude : new Set();
  const pool = [];
  for (let i = 0; i < len; i += 1) if (!skip.has(i)) pool.push(i);
  if (!pool.length) return 0;
  return pool[Math.floor(Math.random() * pool.length)];
}

function choixPaylineCellForReel(reelIndex, poolLen) {
  const len = Math.max(1, poolLen);
  const total = CHOIX_REPS * len;
  const raw = (3 + reelIndex * 2) * len + Math.floor(Math.random() * len);
  const min = len;
  const max = Math.max(min, total - len - 1);
  return Math.max(min, Math.min(max, raw));
}

function choixLoadPrefs() {
  try {
    const raw = localStorage.getItem(CHOIX_LS_KEY) || localStorage.getItem('bh_slot_choix_prefs');
    if (!raw) return null;
    const p = JSON.parse(raw);
    return p && typeof p === 'object' ? p : null;
  } catch (_) { return null; }
}

function choixSavePrefs() {
  const prefs = {
    machineMode: choixGetMachineMode(),
    machineProviders: choixGetSelectedProviders(),
    sectionsCollapsed: choixGetSectionsCollapsed(),
  };
  CHOIX_TEXT_REELS.forEach((reel) => {
    prefs[reel.key] = choixGetCheckedIds(reel.key);
  });
  try { localStorage.setItem(CHOIX_LS_KEY, JSON.stringify(prefs)); } catch (_) {}
}

function choixSecEl(key) {
  return choixRoot().querySelector(`.choix-sec[data-choix-sec="${key}"]`);
}

function choixGetSectionsCollapsed() {
  const out = {};
  CHOIX_SEC_KEYS.forEach((key) => {
    const sec = choixSecEl(key);
    out[key] = sec ? sec.classList.contains('is-collapsed') : true;
  });
  return out;
}

function choixSetSecCollapsed(key, collapsed) {
  const sec = choixSecEl(key);
  if (!sec) return;
  sec.classList.toggle('is-collapsed', collapsed);
  const head = sec.querySelector('.choix-sec__head');
  if (head) head.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
}

function choixToggleSec(key) {
  const sec = choixSecEl(key);
  if (!sec) return;
  choixSetSecCollapsed(key, !sec.classList.contains('is-collapsed'));
  choixSavePrefs();
}

function choixExpandAllSecs() {
  CHOIX_SEC_KEYS.forEach((key) => choixSetSecCollapsed(key, false));
  choixSavePrefs();
}

function choixCollapseAllSecs() {
  CHOIX_SEC_KEYS.forEach((key) => choixSetSecCollapsed(key, true));
  choixSavePrefs();
}

function choixApplySectionsCollapsed(prefs) {
  const saved = prefs?.sectionsCollapsed;
  const defaultCollapsed = true;
  CHOIX_SEC_KEYS.forEach((key) => {
    const collapsed = saved && typeof saved[key] === 'boolean' ? saved[key] : defaultCollapsed;
    choixSetSecCollapsed(key, collapsed);
  });
}

function choixBindCollapseUi() {
  const cfg = choixRoot().querySelector('.choix-config');
  if (!cfg || cfg.dataset.collapseBound === '1') return;
  cfg.dataset.collapseBound = '1';

  cfg.querySelector('[data-choix-action="expand"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    choixExpandAllSecs();
  });
  cfg.querySelector('[data-choix-action="collapse"]')?.addEventListener('click', (e) => {
    e.preventDefault();
    choixCollapseAllSecs();
  });

  cfg.querySelectorAll('.choix-sec[data-choix-sec]').forEach((sec) => {
    const key = sec.dataset.choixSec;
    const head = sec.querySelector('.choix-sec__head');
    if (!key || !head) return;
    head.addEventListener('click', (e) => {
      if (e.target.closest('.choix-tool')) return;
      e.preventDefault();
      choixToggleSec(key);
    });
  });
}

function choixSummaryMachine() {
  const mode = choixGetMachineMode();
  if (mode === 'none') return 'Aucune machine';
  if (mode === 'all') return 'Toutes les slots';
  const provs = choixGetSelectedProviders();
  if (!provs.length) return 'Provider (aucun)';
  if (provs.length === 1) return provs[0];
  if (provs.length <= 2) return provs.join(', ');
  return `${provs.length} providers`;
}

function choixSummaryReel(key) {
  const reel = choixTextReel(key);
  if (!reel) return '';
  const ids = choixGetCheckedIds(key);
  const total = reel.items.length;
  if (!ids.length) return 'Aucune sélection';
  if (ids.length === total) {
    if (key === 'type') return '6 types';
    if (key === 'count') return '15 nombres';
    if (key === 'stake') return 'Toutes les mises';
  }
  if (ids.length <= 3) {
    const labels = ids.map((id) => {
      const item = reel.items.find((x) => reel.itemId(x) === id);
      if (!item) return id;
      if (key === 'stake') return `${choixFmtStakeLabel(item)}€`;
      if (key === 'type') return reel.full(item);
      return id;
    });
    return labels.join(', ');
  }
  const unit = key === 'type' ? 'type' : (key === 'count' ? 'nombre' : 'mise');
  return `${ids.length} ${unit}${ids.length > 1 ? 's' : ''}`;
}

function choixUpdateSummaries() {
  const machineEl = choixRoot().querySelector('#choix-summary-machine');
  if (machineEl) machineEl.textContent = choixSummaryMachine();
  CHOIX_TEXT_REELS.forEach((reel) => {
    const el = choixRoot().querySelector(`#choix-summary-${reel.key}`);
    if (el) el.textContent = choixSummaryReel(reel.key);
  });
}

function choixGetMachineMode() {
  const on = choixRoot().querySelector('.choix-mode-tab.is-active');
  const m = String(on?.dataset?.choixMode || 'all');
  return m === 'none' || m === 'provider' ? m : 'all';
}

function choixGetSelectedProviders() {
  const sel = choixRoot().querySelector('#choix-machine-provider');
  if (!sel) return [];
  return [...sel.selectedOptions].map((o) => o.value).filter(Boolean);
}

function choixGetCheckedIds(reelKey) {
  return [...choixRoot().querySelectorAll(`.choix-chip[data-choix-reel="${reelKey}"].is-on`)].map((el) => el.dataset.value);
}

function choixSlotImg(slot) {
  if (!slot || slot.id === '__none') return '';
  const raw = normalizeSlotImageUrl(slot.image || slot.img || slot.thumbnail || '');
  return raw && typeof isSafeUrl === 'function' && isSafeUrl(raw) ? raw : '';
}

function choixSlotName(slot) {
  if (!slot || slot.id === '__none') return 'Aucune machine';
  return String(slot.nom || slot.name || slot.title || slot.Name || 'Slot');
}

function choixCatalogSlots() {
  return Array.isArray(state?.slots) ? state.slots : [];
}

function choixMachinePool() {
  const mode = choixGetMachineMode();
  if (mode === 'none') return [];
  let pool = choixCatalogSlots().filter((s) => choixSlotImg(s));
  if (mode === 'provider') {
    const provs = new Set(choixGetSelectedProviders());
    if (!provs.size) return [];
    pool = pool.filter((s) => provs.has(String(s.provider || s.Provider || '')));
  }
  return pool;
}

function choixTextReel(key) { return CHOIX_TEXT_REELS.find((r) => r.key === key) || null; }

function choixResolveIdx(reel, item) {
  const id = reel.itemId(item);
  return reel.items.findIndex((x) => reel.itemId(x) === id);
}

function choixReelEls() {
  const stage = choixStage();
  if (!stage) return [];
  return CHOIX_REEL_ORDER.map((key) => stage.querySelector(`.deposit-slot-reel[data-choix-reel="${key}"]`)).filter(Boolean);
}

function choixStrip(reelEl) { return reelEl?.querySelector('.deposit-slot-strip') || null; }

function choixAppendTextCell(strip, reel, item, valIdx) {
  const cell = document.createElement('div');
  const txt = reel.short(item);
  const sm = reel.key === 'type' && String(txt).length > 6;
  cell.className = 'deposit-slot-cell';
  if (reel.key === 'stake') cell.classList.add('deposit-slot-cell--choix-stake');
  else if (sm) cell.classList.add('deposit-slot-cell--choix-sm');
  cell.textContent = txt;
  cell.dataset.valIdx = String(valIdx);
  strip.appendChild(cell);
}

function choixAppendImgCell(strip, slot, valIdx) {
  const cell = document.createElement('div');
  cell.className = 'deposit-slot-cell deposit-slot-cell--choix-img';
  cell.dataset.valIdx = String(valIdx);
  const url = choixSlotImg(slot);
  if (url) {
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    cell.appendChild(img);
  } else {
    cell.textContent = '—';
  }
  strip.appendChild(cell);
}

function choixBuildTextStrip(strip, reel, paylineIdx, winIdx) {
  strip.innerHTML = '';
  const len = reel.items.length;
  const total = CHOIX_REPS * len;
  for (let c = 0; c < total; c += 1) {
    let idx = winIdx;
    if (paylineIdx < 0 || c !== paylineIdx) {
      if (c === paylineIdx - 1) idx = choixRandIdx(len, new Set([winIdx]));
      else if (c === paylineIdx + 1) {
        const above = Number(strip.children[paylineIdx - 1]?.dataset?.valIdx);
        const ex = new Set([winIdx]);
        if (Number.isFinite(above)) ex.add(above);
        idx = choixRandIdx(len, ex);
      } else idx = choixRandIdx(len, null);
    }
    const safeIdx = Math.max(0, Math.min(len - 1, idx));
    choixAppendTextCell(strip, reel, reel.items[safeIdx], safeIdx);
  }
}

function choixBuildImgStrip(strip, deck, paylineIdx, winIdx) {
  strip.innerHTML = '';
  const len = Math.max(1, deck.length);
  const total = CHOIX_REPS * len;
  for (let c = 0; c < total; c += 1) {
    let idx = winIdx;
    if (paylineIdx < 0 || c !== paylineIdx) {
      if (c === paylineIdx - 1) idx = choixRandIdx(len, new Set([winIdx]));
      else if (c === paylineIdx + 1) {
        const above = Number(strip.children[paylineIdx - 1]?.dataset?.valIdx);
        const ex = new Set([winIdx]);
        if (Number.isFinite(above)) ex.add(above);
        idx = choixRandIdx(len, ex);
      } else idx = choixRandIdx(len, null);
    }
    const safeIdx = Math.max(0, Math.min(len - 1, idx));
    choixAppendImgCell(strip, deck[safeIdx], safeIdx);
  }
}

function choixBuildDeck(pool, winSlot) {
  const deck = [];
  const cap = Math.min(CHOIX_STRIP_DECK, pool.length);
  const used = new Set();
  while (deck.length < cap) {
    const s = pool[Math.floor(Math.random() * pool.length)];
    const id = String(s.id || s.Id || '');
    if (!used.has(id) || deck.length < 8) { deck.push(s); used.add(id); }
  }
  if (!deck.length) deck.push(winSlot);
  let winIdx = deck.findIndex((s) => String(s.id) === String(winSlot.id));
  if (winIdx < 0) {
    winIdx = Math.min(deck.length - 1, Math.floor(deck.length / 2));
    deck[winIdx] = winSlot;
  }
  return { deck, winIdx };
}

function choixPickMachine() {
  const mode = choixGetMachineMode();
  if (mode === 'none') {
    return { key: 'machine', pick: CHOIX_NONE_SLOT, winIdx: 0, deck: [CHOIX_NONE_SLOT] };
  }
  const pool = choixMachinePool();
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const { deck, winIdx } = choixBuildDeck(pool, pick);
  return { key: 'machine', pick, winIdx, deck };
}

function choixPickText(key) {
  const reel = choixTextReel(key);
  if (!reel) return null;
  const checked = choixGetCheckedIds(key);
  if (!checked.length) return null;
  const pool = reel.items.filter((item) => checked.includes(reel.itemId(item)));
  if (!pool.length) return null;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  const winIdx = choixResolveIdx(reel, pick);
  if (winIdx < 0) return null;
  return { key, reel, pick, winIdx };
}

function choixIsReady() {
  if (choixGetMachineMode() === 'provider' && !choixGetSelectedProviders().length) return false;
  if (choixGetMachineMode() !== 'none' && !choixMachinePool().length) return false;
  return CHOIX_TEXT_REELS.every((r) => choixGetCheckedIds(r.key).length > 0);
}

function choixClearWin(stage) {
  if (typeof depSlotClearJackpotFx === 'function') {
    depSlotClearJackpotFx(stage);
    const marquee = stage?.querySelector('.deposit-slot-marquee span');
    if (marquee) marquee.textContent = 'CHOIX';
    return;
  }
  if (!stage) return;
  stage.classList.remove('deposit-slot-stage--win', 'deposit-slot-stage--jackpot');
}

function choixPlayWin(stage) {
  if (typeof depSlotPlayJackpotFx === 'function') {
    depSlotPlayJackpotFx(stage, 0);
    return;
  }
  if (!stage) return;
  stage.classList.add('deposit-slot-stage--win');
}

function choixRenderStrip(reelEl, data, reelIndex) {
  const strip = choixStrip(reelEl);
  if (!strip) return;
  const key = reelEl.dataset.choixReel || '';
  reelEl.classList.remove('spinning', 'stopped');

  if (!data) {
    strip.innerHTML = '';
    for (let k = 0; k < 3; k += 1) {
      const cell = document.createElement('div');
      cell.className = 'deposit-slot-cell';
      cell.textContent = '—';
      strip.appendChild(cell);
    }
    strip.style.transform = 'translateY(0)';
    return;
  }

  let poolLen = 1;
  if (key === 'machine') poolLen = data.deck?.length || 1;
  else poolLen = data.reel?.items?.length || choixTextReel(key)?.items?.length || 1;

  const payline = choixPaylineCellForReel(reelIndex, poolLen);
  reelEl.dataset.depPayline = String(payline);
  strip.style.transition = 'none';

  if (key === 'machine') {
    choixBuildImgStrip(strip, data.deck || [CHOIX_NONE_SLOT], payline, data.winIdx || 0);
  } else {
    const reel = data.reel || choixTextReel(key);
    choixBuildTextStrip(strip, reel, payline, data.winIdx || 0);
  }
  strip.style.transform = `translateY(${choixOffset(payline)}px)`;
  void strip.offsetHeight;
  strip.style.transition = '';
}

function choixSyncVisual() {
  choixSlotSpinning = false;
  const stage = choixStage();
  if (!stage) return;
  choixClearWin(stage);
  const ready = choixIsReady();
  stage.classList.toggle('deposit-slot-stage--empty', !ready);

  const preview = {};
  if (ready) {
    preview.machine = choixPickMachine() || { key: 'machine', pick: CHOIX_NONE_SLOT, winIdx: 0, deck: [CHOIX_NONE_SLOT] };
    CHOIX_TEXT_REELS.forEach((reel) => {
      preview[reel.key] = choixPickText(reel.key) || { key: reel.key, reel, pick: reel.items[0], winIdx: 0 };
    });
  }

  choixReelEls().forEach((reelEl, i) => {
    const key = reelEl.dataset.choixReel;
    choixRenderStrip(reelEl, ready ? preview[key] : null, i);
  });
}

function choixMakeChip(reelKey, value, label, on) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `choix-chip${on ? ' is-on' : ''}`;
  btn.dataset.choixReel = reelKey;
  btn.dataset.value = value;
  btn.textContent = label;
  btn.addEventListener('click', () => {
    btn.classList.toggle('is-on');
    choixSavePrefs();
    choixUpdateSummaries();
    choixSyncVisual();
    if (!choixGetCheckedIds(reelKey).length) {
      const reel = CHOIX_TEXT_REELS.find((r) => r.key === reelKey);
      if (reel) showToast(`Garde au moins une option pour ${reel.title}`, 'error');
    }
  });
  return btn;
}

function choixRenderLists() {
  const prefs = choixLoadPrefs();
  CHOIX_TEXT_REELS.forEach((reel) => {
    const box = choixRoot().querySelector(`#choix-chips-${reel.key}`);
    if (!box) return;
    const saved = new Set((prefs?.[reel.key] || []).map(String));
    const defaultAll = !saved.size;
    box.innerHTML = '';
    reel.items.forEach((item) => {
      const id = reel.itemId(item);
      const on = defaultAll || saved.has(id);
      const label = reel.key === 'stake' ? `${choixFmtStakeLabel(item)}€` : (reel.key === 'type' ? reel.full(item) : id);
      box.appendChild(choixMakeChip(reel.key, id, label, on));
    });
  });
}

function choixPopulateProviders() {
  const sel = choixRoot().querySelector('#choix-machine-provider');
  if (!sel) return;
  const counts = new Map();
  choixCatalogSlots().forEach((s) => {
    const p = String(s.provider || s.Provider || '').trim();
    if (p) counts.set(p, (counts.get(p) || 0) + 1);
  });
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
  sel.innerHTML = '';
  sorted.forEach(([p, n]) => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = `${p} (${n})`;
    sel.appendChild(opt);
  });
}

function choixBindMachine(prefs) {
  const root = choixRoot();
  if (root.dataset.machineBound === '1') return;
  root.dataset.machineBound = '1';

  const mode = prefs?.machineMode || 'all';
  root.querySelectorAll('.choix-mode-tab').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.choixMode === mode);
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      root.querySelectorAll('.choix-mode-tab').forEach((b) => b.classList.remove('is-active'));
      btn.classList.add('is-active');
      choixToggleProviderBox();
      choixSavePrefs();
      choixUpdateSummaries();
      choixSyncVisual();
    });
  });

  const sel = root.querySelector('#choix-machine-provider');
  if (sel) {
    const saved = Array.isArray(prefs?.machineProviders) ? prefs.machineProviders : [];
    if (saved.length) [...sel.options].forEach((o) => { o.selected = saved.includes(o.value); });
    sel.addEventListener('change', () => {
      choixSavePrefs();
      choixUpdateSummaries();
      choixSyncVisual();
      if (choixGetMachineMode() === 'provider' && !choixGetSelectedProviders().length) {
        showToast('Sélectionne au moins un provider', 'error');
      }
    });
  }
  choixToggleProviderBox();
}

function choixToggleProviderBox() {
  const box = choixRoot().querySelector('#choix-provider-box');
  if (box) box.hidden = choixGetMachineMode() !== 'provider';
}

function choixSlotSelectAll(reelKey) {
  choixRoot().querySelectorAll(`.choix-chip[data-choix-reel="${reelKey}"]`).forEach((el) => el.classList.add('is-on'));
  choixSavePrefs();
  choixUpdateSummaries();
  choixSyncVisual();
}

function choixSlotSelectNone(reelKey) {
  choixRoot().querySelectorAll(`.choix-chip[data-choix-reel="${reelKey}"]`).forEach((el) => el.classList.remove('is-on'));
  choixSavePrefs();
  choixUpdateSummaries();
  choixSyncVisual();
  const reel = CHOIX_TEXT_REELS.find((r) => r.key === reelKey);
  if (reel) showToast(`Aucune option pour ${reel.title}`, 'error');
}

function choixFormatResult(picks) {
  if (!picks) return '';
  const parts = [];
  if (picks.machine) parts.push(picks.machine.pick?.id === '__none' ? 'Aucune machine' : choixSlotName(picks.machine.pick));
  CHOIX_TEXT_REELS.forEach((reel) => {
    const p = picks[reel.key];
    if (p?.pick != null) parts.push(reel.full(p.pick));
  });
  return parts.join(' · ');
}

function choixCollectPicks() {
  if (!choixIsReady()) {
    if (choixGetMachineMode() === 'provider' && !choixGetSelectedProviders().length) {
      showToast('Sélectionne au moins un provider', 'error');
    } else if (choixGetMachineMode() !== 'none' && !choixMachinePool().length) {
      showToast('Aucune slot avec image pour ce filtre', 'error');
    } else {
      CHOIX_TEXT_REELS.forEach((reel) => {
        if (!choixGetCheckedIds(reel.key).length) showToast(`Garde au moins une option pour ${reel.title}`, 'error');
      });
    }
    return null;
  }
  const machine = choixPickMachine();
  if (!machine) {
    showToast('Aucune slot avec image pour ce filtre', 'error');
    return null;
  }
  const picks = { machine };
  for (const reel of CHOIX_TEXT_REELS) {
    const p = choixPickText(reel.key);
    if (!p) {
      showToast(`Garde au moins une option pour ${reel.title}`, 'error');
      return null;
    }
    picks[reel.key] = p;
  }
  return picks;
}

function choixSlotSpin() {
  if (choixSlotSpinning) return;
  const picks = choixCollectPicks();
  if (!picks) return;

  const stage = choixStage();
  if (!stage) {
    choixLastResult = picks;
    choixSetResult(choixFormatResult(picks));
    return;
  }

  choixSlotSpinning = true;
  choixLastResult = picks;
  choixSetResult('Les rouleaux tournent…');
  choixClearWin(stage);
  stage.classList.remove('deposit-slot-stage--empty');

  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const durations = reduced ? [0.4, 0.65, 0.9, 1.15] : [1.5, 2.0, 3.2, 4.5];
  const ease = 'cubic-bezier(0.16, 0.84, 0.22, 1)';

  if (typeof casinoSfx === 'function') {
    casinoSfx('spin');
    if (!reduced) {
      const totalMs = durations[3] * 1000 - 280;
      for (let i = 0; i < 28; i += 1) {
        const t = Math.pow(i / 28, 1.55) * totalMs;
        setTimeout(() => { if (choixSlotSpinning) casinoSfx('tick', { pitch: 1.1 - (i / 28) * 0.35 }); }, t);
      }
    }
  }

  const reels = choixReelEls();
  let stopsRemaining = reels.length;

  const allDone = () => {
    choixSlotSpinning = false;
    choixPlayWin(stage);
    const marquee = stage.querySelector('.deposit-slot-marquee span');
    if (marquee) marquee.textContent = 'RÉSULTAT';
    choixSetResult(`🎰 ${choixFormatResult(picks)} — Relance pour un nouveau tirage.`);
    if (typeof casinoSfx === 'function') casinoSfx('bigwin');
  };

  if (!reels.length) { allDone(); return; }

  reels.forEach((reel, r) => {
    const key = reel.dataset.choixReel;
    const data = picks[key];
    const strip = choixStrip(reel);
    if (!strip || !data) {
      stopsRemaining -= 1;
      if (stopsRemaining <= 0) allDone();
      return;
    }

    reel.classList.add('spinning');
    reel.classList.remove('stopped');

    let poolLen = 1;
    if (key === 'machine') poolLen = data.deck?.length || 1;
    else poolLen = data.reel?.items?.length || choixTextReel(key)?.items?.length || 1;

    const paylineCell = choixPaylineCellForReel(r, poolLen);
    reel.dataset.depPayline = String(paylineCell);
    strip.style.transition = 'none';

    if (key === 'machine') choixBuildImgStrip(strip, data.deck, paylineCell, data.winIdx);
    else choixBuildTextStrip(strip, data.reel || choixTextReel(key), paylineCell, data.winIdx);

    const startCell = Math.max(0, paylineCell - (18 + r * 6));
    strip.style.transform = `translateY(${choixOffset(startCell)}px)`;
    void strip.offsetHeight;

    const dur = durations[r] ?? durations[durations.length - 1];
    strip.style.transition = `transform ${dur}s ${ease}`;
    requestAnimationFrame(() => {
      strip.style.transform = `translateY(${choixOffset(paylineCell)}px)`;
    });

    let done = false;
    const finishReel = () => {
      if (done) return;
      done = true;
      window.clearTimeout(fb);
      strip.removeEventListener('transitionend', onEnd);
      reel.classList.remove('spinning');
      reel.classList.add('stopped');
      if (typeof casinoSfx === 'function') casinoSfx('chip');
      stopsRemaining -= 1;
      if (stopsRemaining <= 0) allDone();
    };
    const onEnd = (e) => { if (e.propertyName === 'transform') finishReel(); };
    strip.addEventListener('transitionend', onEnd);
    const fb = window.setTimeout(finishReel, dur * 1000 + 450);
  });
}

if (typeof window !== 'undefined') {
  window.choixToggleSec = choixToggleSec;
  window.choixExpandAllSecs = choixExpandAllSecs;
  window.choixCollapseAllSecs = choixCollapseAllSecs;
  window.choixSlotSelectAll = choixSlotSelectAll;
  window.choixSlotSelectNone = choixSlotSelectNone;
  window.choixSlotSpin = choixSlotSpin;
}

function initChoixSlot() {
  const root = choixRoot();
  if (!root) return;

  const boot = () => {
    delete root.dataset.machineBound;
    const cfg = root.querySelector('.choix-config');
    if (cfg) delete cfg.dataset.collapseBound;
    choixPopulateProviders();
    const prefs = choixLoadPrefs();
    choixBindMachine(prefs);
    choixRenderLists();
    choixBindCollapseUi();
    choixApplySectionsCollapsed(prefs);
    choixUpdateSummaries();
    choixSyncVisual();
    choixSetResult(choixLastResult
      ? `Dernier tirage : ${choixFormatResult(choixLastResult)}`
      : 'Coche tes options, puis lance les rouleaux.');
  };

  if (typeof ensureSlotsLoaded === 'function') {
    ensureSlotsLoaded().then(boot).catch(boot);
  } else {
    boot();
  }
}
