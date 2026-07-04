/**
 * Passe 5 — catalogue slots (grille, loadSlots, refresh)
 * Usage: node scripts/extract-catalog-p5.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const APP_JS = path.join(ROOT, 'app.js');
const OUT = path.join(ROOT, 'scripts', 'pages', 'catalog-slots.js');
mkdirSync(path.dirname(OUT), { recursive: true });

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
  CATALOG_VARS: findLine('let currentPage = 0;'),
  DETACHED: findLine('const __detachedPanels'),
  HUNT_FP: findLine('function huntWorkspaceFingerprint()'),
  JEUX_EMBED: findLine('let jeuxEmbedLoadPromise = null'),
  LOAD_SLOTS_END: findLine('function updateCatalogModeHint()') - 1,
  CATALOG_HINT_END: findLine('function isMobileNavMode()') - 1,
  FILTER: findLine('function filterAndRender()'),
  RENDER_PAGE_END: findLine('// Infinite scroll'),
  LISTENERS_END: findLine('// slot-create listeners'),
  ENSURE_SLOTS: findLine('let __slotsLoadPromise = null'),
  ENSURE_SLOTS_END: findLine('// [news]') - 1,
  REFRESH_START: findLine('const CATALOG_REFRESH_INTERVAL_MS'),
  REFRESH_END: findLine('window.addEventListener(\'DOMContentLoaded\''),
};

console.log('Repères catalog P5:', L);

const INIT_UI = `
function initCatalogSlotsUi() {
  if (initCatalogSlotsUi._done) return;
  initCatalogSlotsUi._done = true;
  const bind = (id, ev, fn) => {
    const el = document.getElementById(id);
    if (!el || el.dataset.catalogBound) return;
    el.dataset.catalogBound = '1';
    el.addEventListener(ev, fn);
  };
  const grid = document.getElementById('grid-container');
  if (grid && !grid.dataset.catalogBound) {
    grid.dataset.catalogBound = '1';
    grid.addEventListener('scroll', function() {
      const el = this;
      clearTimeout(catalogScrollDebounce);
      catalogScrollDebounce = setTimeout(() => {
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 200) {
          if (currentPage * PAGE_SIZE < state.filteredSlots.length) renderPage();
        }
      }, 60);
    });
  }
  bind('search-input', 'input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(filterAndRender, 120);
  });
  bind('catalog-mode-filter', 'change', (e) => {
    state.catalogMode = e.target.value === 'extended' ? 'extended' : 'gamdom';
    save();
    updateCatalogModeHint();
    filterAndRender();
    showToast(
      state.catalogMode === 'extended'
        ? 'Mode catalogue étendu activé'
        : 'Mode Gamdom pur activé',
      'info',
      1800
    );
  });
  bind('provider-filter', 'change', filterAndRender);
  updateCatalogModeHint();
  startCatalogAutoRefresh();
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => { try { initCatalogSlotsUi(); } catch (_) {} });
} else {
  try { initCatalogSlotsUi(); } catch (_) {}
}
`;

const globals = [
  'state', 'save', 'escapeHtml', 'isSafeUrl', 'activeHunt', 'scheduleHuntUI',
  'normalizeCatalogEntry', 'isCatalogPlaceholderImage', 'fetchJSONWithRetry',
  'openAddModal', 'showToast', 'bhWarn',
].join(', ');

const body = [
  sliceRange(L.CATALOG_VARS, L.DETACHED - 1),
  sliceRange(L.JEUX_EMBED, L.CATALOG_HINT_END),
  sliceRange(L.FILTER, L.RENDER_PAGE_END - 1),
  sliceRange(L.ENSURE_SLOTS, L.ENSURE_SLOTS_END),
  sliceRange(L.REFRESH_START, L.REFRESH_END - 1),
].join('\n\n');

const catalogJs = `'use strict';
/* globals ${globals} */
/* Catalogue slots — grille hunt, loadSlots, refresh jeux.json (lazy hunt) */

let searchDebounce = null;

${body}
${INIT_UI}
`;

writeFileSync(OUT, catalogJs, 'utf8');
console.log('Écrit', OUT, `(${catalogJs.split('\\n').length} lignes)`);

// ─── Patch app.js ───
let app = readFileSync(APP_JS, 'utf8');

const block1Start = lines[L.CATALOG_VARS - 1];
const block1End = lines[L.DETACHED - 2];
app = app.replace(
  lines.slice(L.CATALOG_VARS - 1, L.DETACHED - 1).join('\n'),
  `// [catalog-slots] — scripts/pages/catalog-slots.js (lazy hunt)\n`
);

// jeux embed + loadSlots + updateCatalogModeHint
const jeuxBlock = lines.slice(L.JEUX_EMBED - 1, L.CATALOG_HINT_END).join('\n');
app = app.replace(jeuxBlock, '// [catalog-slots] loadSlots / updateCatalogModeHint\n');

// filter through listeners
const filterBlock = lines.slice(L.FILTER - 1, L.LISTENERS_END - 1).join('\n');
app = app.replace(filterBlock, '// [catalog-slots] filterAndRender / renderPage / listeners → initCatalogSlotsUi()\n');

// ensureSlotsLoaded
const ensureBlock = lines.slice(L.ENSURE_SLOTS - 1, L.ENSURE_SLOTS_END).join('\n');
app = app.replace(
  ensureBlock,
  `// [catalog-slots] ensureSlotsLoaded — scripts/pages/catalog-slots.js\n`
);

// refresh block at end
const refreshBlock = lines.slice(L.REFRESH_START - 1, L.REFRESH_END - 1).join('\n');
app = app.replace(refreshBlock, '// [catalog-slots] refreshCatalogSilently / startCatalogAutoRefresh\n');

// LAZY_PAGE_DEPS hunt — insert catalog-slots before workspace
app = app.replace(
  "hunt:    ['./scripts/pages/hunt-export.js', './scripts/pages/hunt-public-live.js', './scripts/pages/hunt-workspace.js', './scripts/pages/hunt-opener.js'],",
  "hunt:    ['./scripts/pages/hunt-export.js', './scripts/pages/hunt-public-live.js', './scripts/pages/catalog-slots.js', './scripts/pages/hunt-workspace.js', './scripts/pages/hunt-opener.js'],"
);

// DOMContentLoaded — remove duplicate startCatalogAutoRefresh / updateCatalogModeHint
app = app.replace(
  `  registerAppServiceWorker();
  startCatalogAutoRefresh();
  initSidebarNavA11y();
  initHuntHubTabs();
  initModalA11yObserver();
  updateCatalogModeHint();`,
  `  registerAppServiceWorker();
  initSidebarNavA11y();
  initHuntHubTabs();
  initModalA11yObserver();
  try { if (typeof initCatalogSlotsUi === 'function') initCatalogSlotsUi(); } catch (_) {}`
);

writeFileSync(APP_JS, app, 'utf8');

execSync(`node --check "${OUT}"`, { stdio: 'inherit' });
execSync(`node --check "${APP_JS}"`, { stdio: 'inherit' });
console.log('P5 extract OK — lancer npm test');
