/**
 * Passe 4 — workspace hunt + opener/mini-opener
 * Usage: node scripts/extract-hunt-p4.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_JS = path.join(ROOT, 'app.js');
const PAGES_DIR = path.join(ROOT, 'scripts', 'pages');
mkdirSync(PAGES_DIR, { recursive: true });

const lines = readFileSync(APP_JS, 'utf8').split('\n');

function findLine(pattern, after = 0) {
  for (let i = after; i < lines.length; i++) {
    const ok = typeof pattern === 'string' ? lines[i].includes(pattern) : pattern.test(lines[i]);
    if (ok) return i + 1;
  }
  throw new Error(`Pattern introuvable: ${pattern}`);
}

function sliceRange(start, end) {
  return lines.slice(start - 1, end).join('\n');
}

const L = {
  BONUS_FILTER: findLine("document.getElementById('bonus-status-filter').addEventListener"),
  HUNT_PLACEHOLDER: findLine('// [hunt-share]'),
  HUNT_LIST: findLine('function renderHuntList()'),
  OPENER_START: findLine('function openHuntFromButton()'),
  INIT_SECTION: findLine('async function init()'),
  VAR_BONUS_DEBOUNCE: findLine('let bonusFilterDebounce = null'),
};

console.log('Repères hunt P4:', L);

const FILTER_INIT = `
function initHuntBonusFilterListeners() {
  const bind = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.huntFilterBound) return;
    el.dataset.huntFilterBound = '1';
    el.addEventListener(ev, fn);
  };
  bind('bonus-status-filter', 'change', (e) => {
    state.bonusView.status = e.target.value || 'all';
    save();
    const h = activeHunt();
    if (h) renderBonusList(h);
  });
  bind('bonus-type-filter', 'change', (e) => {
    state.bonusView.type = e.target.value || 'all';
    save();
    const h = activeHunt();
    if (h) renderBonusList(h);
  });
  bind('bonus-win-filter', 'change', (e) => {
    state.bonusView.winFilter = e.target.value || 'all';
    save();
    const h = activeHunt();
    if (h) renderBonusList(h);
  });
  bind('bonus-sort', 'change', (e) => {
    state.bonusView.sort = e.target.value || 'order';
    save();
    const h = activeHunt();
    if (h) renderBonusList(h);
  });
  bind('bonus-search-filter', 'input', (e) => {
    state.bonusView.q = String(e.target.value || '').trim().toLowerCase();
    scheduleBonusFilterRender();
  });
  bind('bonus-provider-filter', 'change', (e) => {
    state.bonusView.provider = String(e.target.value || '').toLowerCase();
    save();
    state._huntWsFp = '';
    const h = activeHunt();
    if (h) renderBonusList(h);
  });
  bind('bonus-min-stake', 'input', (e) => {
    state.bonusView.minStake = String(e.target.value || '').trim();
    scheduleBonusFilterRender();
  });
  bind('bonus-max-stake', 'input', (e) => {
    state.bonusView.maxStake = String(e.target.value || '').trim();
    scheduleBonusFilterRender();
  });
  bind('bonus-filter-presets', 'change', (e) => {
    const idx = Number(e.target.value);
    const presets = getBonusFilterPresets();
    const p = Number.isFinite(idx) && idx >= 0 ? presets[idx] : null;
    if (!p) return;
    state.bonusView.status = p.status || 'all';
    state.bonusView.type = p.type || 'all';
    state.bonusView.sort = p.sort || 'order';
    state.bonusView.q = String(p.q || '').toLowerCase();
    state.bonusView.provider = String(p.provider || '').toLowerCase();
    state.bonusView.minStake = String(p.minStake || '');
    state.bonusView.maxStake = String(p.maxStake || '');
    const statusEl = document.getElementById('bonus-status-filter');
    const typeEl = document.getElementById('bonus-type-filter');
    const sortEl = document.getElementById('bonus-sort');
    const qEl = document.getElementById('bonus-search-filter');
    const providerEl = document.getElementById('bonus-provider-filter');
    const minStakeEl = document.getElementById('bonus-min-stake');
    const maxStakeEl = document.getElementById('bonus-max-stake');
    if (statusEl) statusEl.value = state.bonusView.status;
    if (typeEl) typeEl.value = state.bonusView.type;
    if (sortEl) sortEl.value = state.bonusView.sort;
    if (qEl) qEl.value = state.bonusView.q;
    if (providerEl) providerEl.value = state.bonusView.provider;
    if (minStakeEl) minStakeEl.value = state.bonusView.minStake;
    if (maxStakeEl) maxStakeEl.value = state.bonusView.maxStake;
    const h = activeHunt();
    if (h) renderBonusList(h);
    showToast(\`Preset "\${p.name}" appliqué\`, 'success', 1500);
  });
  bind('btn-save-filter-preset', 'click', () => {
    const name = prompt('Nom du preset filtre', \`Filtre \${new Date().toLocaleTimeString('fr-FR')}\`);
    if (!name) return;
    const presets = getBonusFilterPresets();
    presets.unshift({
      name: String(name).slice(0, 50),
      status: state.bonusView.status || 'all',
      type: state.bonusView.type || 'all',
      sort: state.bonusView.sort || 'order',
      q: state.bonusView.q || '',
      provider: state.bonusView.provider || '',
      minStake: state.bonusView.minStake || '',
      maxStake: state.bonusView.maxStake || ''
    });
    saveBonusFilterPresets(presets);
    populateBonusFilterPresetsSelect();
    showToast('Preset filtre sauvegardé', 'success', 1500);
  });
  bind('btn-del-filter-preset', 'click', () => {
    const sel = document.getElementById('bonus-filter-presets');
    const idx = Number(sel?.value);
    if (!Number.isFinite(idx) || idx < 0) { showToast('Choisis un preset', 'info'); return; }
    const presets = getBonusFilterPresets();
    const removed = presets.splice(idx, 1)[0];
    saveBonusFilterPresets(presets);
    populateBonusFilterPresetsSelect();
    showToast(\`Preset "\${removed?.name || ''}" supprimé\`, 'info', 1500);
  });
  bind('btn-reset-filters', 'click', () => {
    state.bonusView = { status: 'all', type: 'all', winFilter: 'all', sort: 'order', q: '', provider: '', minStake: '', maxStake: '' };
    ['bonus-status-filter', 'bonus-type-filter', 'bonus-win-filter', 'bonus-sort', 'bonus-search-filter', 'bonus-provider-filter', 'bonus-min-stake', 'bonus-max-stake', 'bonus-filter-presets'].forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      if (el.tagName === 'SELECT') el.value = id === 'bonus-filter-presets' ? '' : 'all';
      else el.value = '';
    });
    const sortEl = document.getElementById('bonus-sort');
    if (sortEl) sortEl.value = 'order';
    save();
    const h = activeHunt();
    if (h) renderBonusList(h);
    showToast('Filtres réinitialisés', 'success', 1200);
  });
}
function initHuntWorkspaceUi() {
  initHuntBonusFilterListeners();
  const bind = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.huntWsBound) return;
    el.dataset.huntWsBound = '1';
    el.addEventListener(ev, fn);
  };
  bind('btn-new-hunt', 'click', showNewHuntModal);
  bind('new-hunt-cancel', 'click', () => document.getElementById('new-hunt-modal')?.classList.add('hidden'));
  bind('new-hunt-confirm', 'click', createNewHunt);
  bind('new-hunt-name-input', 'keydown', (e) => { if (e.key === 'Enter') createNewHunt(); });
  bind('new-hunt-bal-input', 'input', updateNewHuntCurrencyHint);
  bind('new-hunt-currency', 'change', updateNewHuntCurrencyHint);
  bind('hunt-filter-q', 'input', (e) => {
    state.huntListView.q = String(e.target.value || '');
    clearTimeout(huntListFilterDebounce);
    huntListFilterDebounce = setTimeout(() => renderHuntList(), 120);
  });
  bind('modal-close', 'click', closeAddModal);
  bind('modal-cancel', 'click', closeAddModal);
  const addModal = document.getElementById('add-modal');
  if (addModal && !addModal.dataset.huntWsBound) {
    addModal.dataset.huntWsBound = '1';
    addModal.addEventListener('click', (e) => { if (e.target === e.currentTarget) closeAddModal(); });
  }
  bind('modal-confirm', 'click', confirmAddBonus);
  bind('modal-stake-input', 'keydown', (e) => { if (e.key === 'Enter') confirmAddBonus(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuntWorkspaceUi);
else initHuntWorkspaceUi();
`;

const OPENER_INIT = `
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
`;

const extractions = [
  {
    file: 'hunt-workspace.js',
    label: 'Workspace hunt (liste, bonus, modales)',
    globals: 'state, activeHunt, save, escapeHtml, fmt, confirm, requireWriteAccess, setUndoSnapshot, removeHuntMeta, getHuntMeta, setHuntMeta, scheduleHuntUI, refreshCurrencyInline, switchPage, updateHeaderStats, updatePublicLiveButtons, openOpener, getUiPrefs, populateCurrencySelect, populateCasinoSelect, getCasinoKey, CURRENCY_SYMBOLS, toEUR, renderHuntTemplateGrid, getSelectedNewHuntTemplate, huntBonusMachineConflict, uid, uuidLike, normalizeBonusType, formatBonusTypeLabel, normalizeSlotImageUrl, isSafeUrl, getCasinoLabel, buildCasinoSlotUrl, gamdomPlayUrlFromCatalogSlot, isDirectGamePlayUrl, isGamdomNonDirectStoredUrl, findCatalogSlotForBonus, gamdomSeoCasinoUrlFromNameProvider, beRequiredMultiplier, resolveBonusImageUrl, getBonusGoToUrl, showToast, getBonusFilterPresets, saveBonusFilterPresets, populateBonusFilterPresetsSelect, maybeOpenPendingSlotPrefill, __activePage',
    headerExtra: 'var bonusFilterDebounce = null;\nvar huntListFilterDebounce = null;\nvar __bonusProviderHash = \'\';\n\nfunction scheduleBonusFilterRender() {\n  clearTimeout(bonusFilterDebounce);\n  bonusFilterDebounce = setTimeout(() => {\n    save();\n    state._huntWsFp = \'\';\n    const h = activeHunt();\n    if (h) renderBonusList(h);\n  }, 150);\n}\n\n',
    ranges: [[L.HUNT_LIST, L.OPENER_START - 4]],
    placeholder: '// [hunt-workspace] — scripts/pages/hunt-workspace.js (lazy hunt)',
    extras: FILTER_INIT,
  },
  {
    file: 'hunt-opener.js',
    label: 'Opener + mini-opener + HUD stream',
    globals: 'state, activeHunt, save, showToast, requireWriteAccess, setUndoSnapshot, fmt, normalizeBonusType, formatBonusTypeLabel, resolveBonusImageUrl, isSafeUrl, escapeHtml, beAverageMultiplierForHunt, getProfitMotivation, getOpenerKeybinds, openerKeyMatch, getOpenerKeybinds, STREAMER_OVERLAY_KEY, setStreamerOverlayEnabled, isStreamerOverlayEnabled, openOrFocusStreamerHud, closeStreamerHudWin, updateOpenerStreamerHud, renderHuntWorkspace, renderHuntList, renderOpener, scheduleCloudSync, isCloudUser, LOCAL_SYNCED_KEY, STORAGE_KEY, bhWarn, document, window, broadcastMainMutation, scheduleCloudSync',
    ranges: [[L.OPENER_START, L.INIT_SECTION - 4]],
    placeholder: '// [hunt-opener] — scripts/pages/hunt-opener.js (lazy hunt)',
    extras: OPENER_INIT,
  },
];

const removedLines = new Set();
const placeholderAt = new Map();

for (const ex of extractions) {
  const body = ex.ranges.map(([s, e]) => sliceRange(s, e)).join('\n\n') + (ex.extras || '');
  const header = `'use strict';\n/* globals ${ex.globals} */\n/* ${ex.label} — lazy bundle hunt */\n\n${ex.headerExtra || ''}`;
  const dest = path.join(PAGES_DIR, ex.file);
  writeFileSync(dest, header + body + '\n', 'utf8');
  execSync(`node --check "${dest}"`, { stdio: 'pipe' });
  console.log(`✓ ${ex.file} (${(header + body).split('\n').length} lignes)`);
  for (const [s, e] of ex.ranges) {
    for (let i = s; i <= e; i++) removedLines.add(i);
    if (!placeholderAt.has(s)) placeholderAt.set(s, ex.placeholder);
  }
}

// Filtres bonus (listeners inline) — jusqu'aux placeholders hunt P3
for (let i = L.BONUS_FILTER; i < L.HUNT_LIST - 1; i++) removedLines.add(i);

// Variables debounce déplacées
for (let i = L.VAR_BONUS_DEBOUNCE; i <= L.VAR_BONUS_DEBOUNCE + 4; i++) removedLines.add(i);

const newLines = [];
for (let i = 1; i <= lines.length; i++) {
  if (removedLines.has(i)) {
    if (placeholderAt.has(i)) newLines.push(placeholderAt.get(i));
  } else {
    newLines.push(lines[i - 1]);
  }
}

let appContent = newLines.join('\n');

// LAZY_PAGE_DEPS hunt — workspace + opener avant share
appContent = appContent.replace(
  /hunt:\s+\['\.\/scripts\/pages\/hunt-export\.js', '\.\/scripts\/pages\/hunt-public-live\.js'\],/,
  "hunt:    ['./scripts/pages/hunt-export.js', './scripts/pages/hunt-public-live.js', './scripts/pages/hunt-workspace.js', './scripts/pages/hunt-opener.js'],"
);

// Studio needs openOpener
appContent = appContent.replace(
  /(studio:\s+\['\.\/scripts\/pages\/hub-features\.js'\],)/,
  "studio:  ['./scripts/pages/hub-features.js', './scripts/pages/hunt-opener.js'],"
);

// init() charge hunt avant renderHuntList
if (!appContent.includes('await loadLazyPageScript(\'hunt\')')) {
  appContent = appContent.replace(
    '  await load();\n  const catalogSelect = document.getElementById(\'catalog-mode-filter\');',
    "  await load();\n  await loadLazyPageScript('hunt').catch(() => {});\n  const catalogSelect = document.getElementById('catalog-mode-filter');"
  );
}

writeFileSync(APP_JS, appContent, 'utf8');
execSync(`node --check "${APP_JS}"`, { stdio: 'pipe' });
console.log(`✓ app.js (${newLines.length} lignes, était ${lines.length})`);
console.log('✅ Extraction hunt P4 terminée.');
