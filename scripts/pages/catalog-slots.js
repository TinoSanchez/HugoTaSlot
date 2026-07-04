'use strict';
/* globals state, save, escapeHtml, isSafeUrl, activeHunt, scheduleHuntUI, normalizeCatalogEntry, isCatalogPlaceholderImage, fetchJSONWithRetry, openAddModal, showToast, bhWarn */
/* Catalogue slots — grille hunt, loadSlots, refresh jeux.json (lazy hunt) */

let searchDebounce = null;

let currentPage = 0;
const PAGE_SIZE = 64;
let catalogScrollDebounce = null;

function slotGamdomEligible(s) {
  const id = String(s.id || s.Id || '').toLowerCase();
  const url = String(s.gamdomUrl || s.gamdom_url || '').toLowerCase();
  const img = String(s.image || s.img || s.thumbnail || '').toLowerCase();
  return id.startsWith('gd_')
    || id.startsWith('stake_')
    || url.includes('gamdom.com')
    || url.includes('stake.com/casino/games/')
    || img.includes('cdn.hub88.io')
    || img.includes('ppgames.net')
    || img.includes('thumbs.alea.com')
    || img.includes('gamdom.com/static/dyn/');
}

function buildSlotCatalogIndexes(slots) {
  state.searchIndex = [];
  state.slotMeta = [];
  state.slotRefIndex = new Map();
  state.gamdomSlotIndices = [];
  const providerCounts = new Map();
  for (let i = 0; i < slots.length; i++) {
    const s = slots[i] || {};
    const nom = (s.nom || s.name || s.title || s.Name || '').toLowerCase();
    const provRaw = (s.provider || s.Provider || '');
    const prov = String(provRaw).toLowerCase();
    const gamdomEligible = slotGamdomEligible(s);
    state.searchIndex.push({ nom, prov });
    state.slotMeta.push({ gamdomEligible });
    state.slotRefIndex.set(slots[i], i);
    if (gamdomEligible) state.gamdomSlotIndices.push(i);
    if (provRaw) providerCounts.set(provRaw, (providerCounts.get(provRaw) || 0) + 1);
  }
  return providerCounts;
}

let jeuxEmbedLoadPromise = null;
function loadJeuxEmbedScript() {
  if (Array.isArray(window.__JEUX__) && window.__JEUX__.length) {
    return Promise.resolve();
  }
  if (jeuxEmbedLoadPromise) return jeuxEmbedLoadPromise;
  const paths = ['./jeux-embed.js', '/jeux-embed.js', 'jeux-embed.js'];
  jeuxEmbedLoadPromise = (async () => {
    for (const src of paths) {
      try {
        await new Promise((resolve, reject) => {
          const s = document.createElement('script');
          s.src = src;
          s.async = true;
          s.onload = () => resolve();
          s.onerror = () => reject(new Error('embed load failed'));
          document.head.appendChild(s);
        });
        if (Array.isArray(window.__JEUX__) && window.__JEUX__.length) return;
      } catch (_) { /* essai chemin suivant */ }
    }
    throw new Error('jeux-embed.js introuvable');
  })();
  return jeuxEmbedLoadPromise;
}

async function loadSlots() {
  const loader = document.getElementById('grid-loader');
  const loaderText = document.getElementById('loader-text');
  const errState = document.getElementById('error-state');
  const grid = document.getElementById('slots-grid');
  if (loader) loader.classList.remove('hidden');
  if (errState) errState.classList.add('hidden');
  if (grid) grid.innerHTML = '';

  // Animated loading messages
  const loadMsgs = ['CHARGEMENT DES SLOTS...', 'PARSING 7000+ ENTRÉES...', 'INDEXATION DES PROVIDERS...', 'OPTIMISATION DE LA GRILLE...'];
  let msgIdx = 0;
  const msgTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % loadMsgs.length;
    if (loaderText) loaderText.textContent = loadMsgs[msgIdx];
  }, 600);

  try {
    let data = null;

    // 1) Un seul fetch à la fois (évite 3× le même JSON en parallèle).
    const paths = ['jeux.json', './jeux.json', '/jeux.json'];
    for (const p of paths) {
      try {
        data = await fetchJSONWithRetry(p, { retries: 0, timeoutMs: 3500 });
        if (data) break;
      } catch (_) { /* chemin suivant */ }
    }

    // 2) Secours : jeux-embed.js (~2 Mo), chargé uniquement si jeux.json indisponible
    if (!data) {
      try {
        await loadJeuxEmbedScript();
      } catch (_) { /* pas d’embed : fallback synthétique ci-dessous */ }
      if (Array.isArray(window.__JEUX__) && window.__JEUX__.length) {
        data = window.__JEUX__;
      }
    }

    if (!data) {
      // Fallback local: garde le site utilisable même sans jeux.json.
      const providers = ['Pragmatic Play', 'Hacksaw', 'NoLimit City', 'NetEnt', 'Playn GO', 'Relax Gaming'];
      data = Array.from({ length: 7000 }, (_, i) => ({
        id: `fallback-${i + 1}`,
        name: `Slot ${i + 1}`,
        provider: providers[i % providers.length],
        image: ''
      }));
      if (errState) {
        errState.classList.remove('hidden');
        errState.innerHTML = `
        <div class="error-banner">
          ℹ Base de données introuvable : fallback 7000 slots chargée.
        </div>`;
      }
    } else if (errState) {
      errState.classList.add('hidden');
    }

    const rawSlots = Array.isArray(data) ? data : (data.slots || data.games || []);
    state.slots = rawSlots.map((s) => normalizeCatalogEntry(s));
    const providerCounts = buildSlotCatalogIndexes(state.slots);

    // Build provider list (single pass counts, much faster).
    const providers = Array.from(providerCounts.keys()).sort();
    const pf = document.getElementById('provider-filter');
    if (pf) {
      pf.innerHTML = '<option value="">Tous les providers</option>';
      providers.forEach((p) => {
        const o = document.createElement('option');
        o.value = p;
        o.textContent = `${p} (${providerCounts.get(p) || 0})`;
        pf.appendChild(o);
      });
    }

    filterAndRender();
    state._huntWsFp = '';
    try {
      if (state.activeHuntId && activeHunt()) scheduleHuntUI({ force: true });
    } catch (_) {}
  } catch (e) {
    console.error('loadSlots fatal', e);
    if (errState) {
      errState.classList.remove('hidden');
      errState.innerHTML = `<div class="error-banner">Erreur de chargement des slots. Recharge la page.</div>`;
    }
    state.slots = [];
    state.filteredSlots = [];
  } finally {
    clearInterval(msgTimer);
    if (loader) loader.classList.add('hidden');
  }
}

function updateCatalogModeHint() {
  const el = document.getElementById('catalog-mode-hint');
  if (!el) return;
  const ext = state.catalogMode === 'extended';
  el.classList.remove('hidden', 'catalog-mode-hint--warn');
  if (ext) {
    el.textContent =
      'Mode étendu : inclut les slots slot.report. Pastille « Hors Gamdom » = pas encore sur le casino ou vignette manquante.';
    el.classList.add('catalog-mode-hint--warn');
  } else {
    el.textContent =
      'Mode Gamdom pur : jeux avec lien Gamdom, Stake ou vignette catalogue reconnue (Hub88, Pragmatic, etc.).';
  }
}


function filterAndRender() {
  const qRaw = document.getElementById('search-input').value.trim();
  const q = qRaw.toLowerCase();
  const prov = document.getElementById('provider-filter').value.toLowerCase();
  const sourceFiltered = state.catalogMode === 'extended'
    ? state.slots
    : (state.gamdomSlotIndices || []).map((i) => state.slots[i]).filter(Boolean);

  if (!q && !prov) {
    state.filteredSlots = sourceFiltered;
  } else {
    state.filteredSlots = sourceFiltered.filter((s) => {
      const idxPos = state.slotRefIndex.get(s);
      const idx = idxPos >= 0 ? state.searchIndex[idxPos] : { nom: '', prov: '' };
      const matchQ = !q || idx.nom.includes(q) || idx.prov.includes(q);
      const matchP = !prov || idx.prov === prov;
      return matchQ && matchP;
    });
  }

  document.getElementById('results-count').textContent = state.filteredSlots.length.toLocaleString('fr') + ' slots';
  toggleCreateSlotBox(qRaw);
  updateCatalogModeHint();
  currentPage = 0;
  renderPage(true);
}

function toggleCreateSlotBox(queryText = '') {
  const box = document.getElementById('slot-create-empty');
  if (!box) return;
  const trimmed = String(queryText || '').trim();
  const hasQuery = trimmed.length > 0;
  const noResult = state.filteredSlots.length === 0;
  box.style.display = hasQuery ? 'block' : 'none';
  const titleEl = document.getElementById('slot-create-title');
  if (titleEl) {
    titleEl.textContent = noResult
      ? `Aucune slot trouvée — créer "${trimmed}" en custom`
      : `Pas la bonne slot ? Crée-la avec le nom exact (${state.filteredSlots.length.toLocaleString('fr')} résultat(s))`;
  }
  if (hasQuery) {
    const nameEl = document.getElementById('slot-create-name');
    if (nameEl && !String(nameEl.value || '').trim()) nameEl.value = trimmed;
  }
}

function renderPage(reset = false) {
  const grid = document.getElementById('slots-grid');
  if (!grid) return;
  if (reset) {
    grid.innerHTML = '';
    currentPage = 0;
  }

  const start = currentPage * PAGE_SIZE;
  if (start >= state.filteredSlots.length) return;

  const hunt = activeHunt();
  const addedIds = new Set(hunt ? hunt.bonuses.map(b => b.slotId) : []);

  // Réserve l’index tout de suite : évite les doublons si le scroll déclenche 2× avant append (ex. fermeture opener / reflow).
  currentPage++;
  const slice = state.filteredSlots.slice(start, start + PAGE_SIZE);

  const frag = document.createDocumentFragment();
  slice.forEach(slot => {
    const id = slot.id || slot.Id;
    const name = slot.nom || slot.name || slot.title || slot.Name || 'Slot';
    const provider = slot.provider || slot.Provider || '';
    const img = slot.image || slot.img || slot.thumbnail || '';
    const already = addedIds.has(id);

    const nameSafe = escapeHtml(name);
    const nameSlice = name.length > 22 ? name.slice(0, 22) + '…' : name;
    const nameSliceSafe = escapeHtml(nameSlice);
    const provSlice = provider.slice(0, 14);
    const provSliceSafe = escapeHtml(provSlice);
    const imgSafe = isSafeUrl(img) ? escapeHtml(img) : '';

    const card = document.createElement('div');
    card.className = 'slot-card';
    card.title = `${name}\n${provider}`;
    card.dataset.id = id;

    const alreadyDot = already ? `<div class="green-dot" style="position:absolute;top:6px;left:6px;width:10px;height:10px;background:var(--green);border-radius:50%;box-shadow:0 0 6px var(--green);z-index:3;"></div>` : '';
    const provBadge = provider ? `<div class="slot-provider-badge">${provSliceSafe}</div>` : '';
    const offCatalog =
      state.catalogMode === 'extended' &&
      (String(id).startsWith('sr_') || isCatalogPlaceholderImage(img));
    if (offCatalog) card.classList.add('slot-card--off-catalog');
    const offBadge = offCatalog
      ? '<div class="slot-off-badge" title="Référence slot.report — pas sur Gamdom ou sans vignette">Hors Gamdom</div>'
      : '';

    if (imgSafe) {
      card.innerHTML = `
        <img src="${imgSafe}" alt="${nameSafe}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">
        <div class="slot-no-img" style="display:none"><div class="icon"><img src="./assets/virtual-token.svg" class="ui-logo-icon" alt="slot"></div><div class="label">${nameSliceSafe}</div></div>
        <div class="slot-overlay"><div class="slot-name">${nameSafe}</div></div>
        ${provBadge}${offBadge}${alreadyDot}
      `;
    } else {
      card.innerHTML = `
        <div class="slot-no-img"><div class="icon"><img src="./assets/virtual-token.svg" class="ui-logo-icon" alt="slot"></div><div class="label">${nameSliceSafe}</div></div>
        ${provBadge}${offBadge}${alreadyDot}
      `;
    }

    card.addEventListener('click', () => openAddModal(slot));
    frag.appendChild(card);
  });
  grid.appendChild(frag);
}


let __slotsLoadPromise = null;
function ensureSlotsLoaded() {
  if (Array.isArray(state.slots) && state.slots.length > 0) {
    return Promise.resolve(state.slots);
  }
  if (__slotsLoadPromise) return __slotsLoadPromise;
  if (typeof loadSlots !== 'function') return Promise.resolve([]);
  __slotsLoadPromise = loadSlots().catch((e) => {
    console.error('loadSlots failed', e);
    __slotsLoadPromise = null; // permet le retry si l'utilisateur revient
    state.slots = state.slots || [];
    return state.slots;
  });
  return __slotsLoadPromise;
}

const CATALOG_REFRESH_INTERVAL_MS = 30 * 60 * 1000;
const CATALOG_REFRESH_MIN_GAP_MS = 5 * 60 * 1000;
let lastCatalogCheckAt = Date.now();
let catalogRefreshTimer = null;

async function refreshCatalogSilently(reason = 'interval') {
  // Respect du lazy : si l'utilisateur n'a JAMAIS chargé le catalogue
  // (pas allé sur la page Hunt), on ne le fetch pas en arrière-plan.
  // Il sera fetched lors du 1er switchPage('hunt') via ensureSlotsLoaded().
  if (!Array.isArray(state.slots) || state.slots.length === 0) {
    return;
  }
  if (Date.now() - lastCatalogCheckAt < CATALOG_REFRESH_MIN_GAP_MS && reason !== 'focus-force') {
    return;
  }
  lastCatalogCheckAt = Date.now();
  try {
    const res = await fetch('jeux.json', { cache: 'no-cache' });
    if (!res.ok) return;
    const data = await res.json();
    if (!Array.isArray(data) || !data.length) return;
    const before = state.slots.length;
    const beforeFirstId = state.slots[0]?.id;
    const afterFirstId = data[0]?.id;
    if (before === data.length && beforeFirstId === afterFirstId) {
      bhWarn(`[catalog] refresh ${reason}: aucun changement (${before} entrées)`);
      return;
    }
    bhWarn(`[catalog] refresh ${reason}: ${before} → ${data.length} entrées, re-render`);
    state.slots = data.map((s) => normalizeCatalogEntry(s));
    buildSlotCatalogIndexes(state.slots);
    state._huntWsFp = '';
    try { filterAndRender(); } catch (_) {}
  } catch (e) {
    bhWarn('[catalog] refresh failed', e?.message || e);
  }
}

function startCatalogAutoRefresh() {
  if (catalogRefreshTimer) clearInterval(catalogRefreshTimer);
  catalogRefreshTimer = setInterval(() => {
    if (document.visibilityState === 'visible') {
      refreshCatalogSilently('interval').catch(() => {});
    }
  }, CATALOG_REFRESH_INTERVAL_MS);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshCatalogSilently('focus').catch(() => {});
    }
  });
  window.addEventListener('focus', () => {
    refreshCatalogSilently('focus').catch(() => {});
  });
}


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

