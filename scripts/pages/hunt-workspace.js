'use strict';
/* globals state, activeHunt, save, escapeHtml, fmt, confirm, requireWriteAccess, setUndoSnapshot, removeHuntMeta, getHuntMeta, setHuntMeta, scheduleHuntUI, refreshCurrencyInline, switchPage, updateHeaderStats, updatePublicLiveButtons, openOpener, getUiPrefs, populateCurrencySelect, populateCasinoSelect, getCasinoKey, CURRENCY_SYMBOLS, toEUR, renderHuntTemplateGrid, getSelectedNewHuntTemplate, huntBonusMachineConflict, uid, uuidLike, normalizeBonusType, formatBonusTypeLabel, normalizeSlotImageUrl, isSafeUrl, getCasinoLabel, buildCasinoSlotUrl, gamdomPlayUrlFromCatalogSlot, isDirectGamePlayUrl, isGamdomNonDirectStoredUrl, findCatalogSlotForBonus, gamdomSeoCasinoUrlFromNameProvider, beRequiredMultiplier, resolveBonusImageUrl, getBonusGoToUrl, showToast, getBonusFilterPresets, saveBonusFilterPresets, populateBonusFilterPresetsSelect, maybeOpenPendingSlotPrefill, __activePage */
/* Workspace hunt (liste, bonus, modales) — lazy bundle hunt */

var bonusFilterDebounce = null;
var huntListFilterDebounce = null;
var __bonusProviderHash = '';

function scheduleBonusFilterRender() {
  clearTimeout(bonusFilterDebounce);
  bonusFilterDebounce = setTimeout(() => {
    save();
    state._huntWsFp = '';
    const h = activeHunt();
    if (h) renderBonusList(h);
  }, 150);
}

function renderHuntList() {
  const list = document.getElementById('hunt-list');
  const empty = document.getElementById('hunts-empty');
  const qEl = document.getElementById('hunt-filter-q');
  if (qEl && document.activeElement !== qEl) qEl.value = state.huntListView?.q || '';
  list.querySelectorAll('.hunt-item').forEach(e => e.remove());
  if (state.hunts.length === 0) { empty.style.display = 'flex'; return; }
  empty.style.display = 'none';
  const q = String(state.huntListView?.q || '').trim().toLowerCase();

  const shown = state.hunts.slice().reverse().filter((hunt) => {
    const base = String(hunt.name || '').toLowerCase();
    const qOk = !q || base.includes(q);
    return qOk;
  });
  shown.forEach(hunt => {
    const completed = hunt.bonuses.filter(b => b.win !== null).length;
    const ro = !!hunt.readOnlyShared;
    const metaLabel = ro ? 'RO' : '';
    const div = document.createElement('div');
    div.className = 'hunt-item' + (hunt.id === state.activeHuntId ? ' active' : '');
    div.dataset.id = hunt.id;
    const date = new Date(hunt.createdAt).toLocaleDateString('fr-FR', {day:'2-digit',month:'2-digit',year:'2-digit'});
    div.innerHTML = `
      <div class="hunt-item-name">${escapeHtml(hunt.name)}</div>
      <div class="hunt-item-meta">${date} · ${hunt.bonuses.length} bonus · ${completed} ouverts${metaLabel ? ` · ${escapeHtml(metaLabel)}` : ''}</div>
      <div class="hunt-item-actions">
        <button class="hunt-action-btn danger" title="Supprimer" data-del="${escapeHtml(hunt.id)}">🗑</button>
                    </div>
    `;
    div.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      selectHunt(hunt.id);
    });
    div.querySelector('[data-del]').addEventListener('click', async (e) => {
      e.stopPropagation();
      const ok = await confirm('Supprimer le hunt ?', `"${hunt.name}" sera définitivement supprimé.`);
      if (ok) deleteHunt(hunt.id);
    });
    list.appendChild(div);
  });
  if (!shown.length) empty.style.display = 'flex';
}

function selectHunt(id, opts = {}) {
  state.activeHuntId = id;
  save();
  state._huntWsFp = '';
  if (!opts.skipList) renderHuntList();
  refreshCurrencyInline();
  if (!opts.skipWorkspace) scheduleHuntUI({ loadCatalog: !state.slots?.length, force: true });
  if (typeof maybeOpenPendingSlotPrefill === 'function') maybeOpenPendingSlotPrefill();
  document.getElementById('no-hunt-selected').style.display = 'none';
  document.getElementById('hunt-workspace').classList.remove('hidden');
  document.getElementById('hunt-workspace').style.display = 'flex';
  document.body.classList.remove('hunt-sessions-open');
  const sessionsBtn = document.getElementById('btn-hunt-sessions-toggle');
  if (sessionsBtn) sessionsBtn.setAttribute('aria-expanded', 'false');
  const openBtn = document.getElementById('btn-open-hunt');
  if (openBtn) openBtn.disabled = false;
}
function editHuntMeta(huntId) {
  const hunt = state.hunts.find((h) => h.id === huntId);
  if (!hunt) return;
  const cur = getHuntMeta(huntId);
  const folder = prompt(`Dossier pour "${hunt.name}" (vide = aucun)`, cur.folder || '');
  if (folder === null) return;
  const tagsRaw = prompt('Tags séparés par des virgules (ex: highvol, weekend)', (cur.tags || []).join(', '));
  if (tagsRaw === null) return;
  const tags = String(tagsRaw || '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8);
  setHuntMeta(huntId, { folder, tags });
  renderHuntList();
  showToast('Dossier / tags sauvegardés', 'success', 1300);
}

function deleteHunt(id) {
  // ignoreReadOnlyHunt : supprimer un hunt partagé (lecture seule) doit rester
  // possible — on ne retire que la copie locale, et le check portait de toute
  // façon sur le hunt ACTIF, pas sur celui qu'on supprime.
  if (!requireWriteAccess('Suppression hunt bloquée', { ignoreReadOnlyHunt: true })) return;
  setUndoSnapshot('suppression hunt');
  state.hunts = state.hunts.filter(h => h.id !== id);
  removeHuntMeta(id);
  if (state.activeHuntId === id) {
    state.activeHuntId = state.hunts.length ? state.hunts[state.hunts.length - 1].id : null;
  }
  save();
  renderHuntList();
  if (state.activeHuntId) selectHunt(state.activeHuntId);
  else {
    document.getElementById('no-hunt-selected').style.display = 'flex';
    document.getElementById('hunt-workspace').classList.add('hidden');
    const openBtn = document.getElementById('btn-open-hunt');
    if (openBtn) openBtn.disabled = true;
    updateHeaderStats(null);
  }
  showToast('Hunt supprimé', 'error');
}

// ═══════════════════════════════════════════════
//  NEW HUNT MODAL
// ═══════════════════════════════════════════════
function showNewHuntModal() {
  const modal = document.getElementById('new-hunt-modal');
  modal.classList.remove('hidden');
  document.getElementById('new-hunt-name-input').value = `Hunt #${state.hunts.length + 1}`;
  document.getElementById('new-hunt-bal-input').value = '';
  populateCurrencySelect(document.getElementById('new-hunt-currency'), 'EUR');
  const prefs = getUiPrefs();
  populateCasinoSelect(document.getElementById('new-hunt-casino'), getCasinoKey(prefs.defaultCasino || 'gamdom'));
  renderHuntTemplateGrid();
  updateNewHuntCurrencyHint();
  setTimeout(() => document.getElementById('new-hunt-name-input').focus(), 50);
}
document.getElementById('btn-new-hunt').addEventListener('click', showNewHuntModal);
document.getElementById('new-hunt-cancel').addEventListener('click', () => document.getElementById('new-hunt-modal').classList.add('hidden'));
document.getElementById('new-hunt-confirm').addEventListener('click', createNewHunt);
document.getElementById('new-hunt-name-input').addEventListener('keydown', e => { if (e.key === 'Enter') createNewHunt(); });
document.getElementById('new-hunt-bal-input').addEventListener('input', updateNewHuntCurrencyHint);
document.getElementById('new-hunt-currency').addEventListener('change', updateNewHuntCurrencyHint);
document.getElementById('hunt-filter-q').addEventListener('input', (e) => {
  state.huntListView.q = String(e.target.value || '');
  clearTimeout(huntListFilterDebounce);
  huntListFilterDebounce = setTimeout(() => renderHuntList(), 120);
});

function updateNewHuntCurrencyHint() {
  const currency = document.getElementById('new-hunt-currency').value || 'EUR';
  const bal = parseFloat(document.getElementById('new-hunt-bal-input').value) || 0;
  const eur = toEUR(bal, currency);
  const hint = document.getElementById('new-hunt-eur-hint');
  const sym = document.getElementById('new-hunt-currency-symbol');
  if (sym) sym.textContent = CURRENCY_SYMBOLS[currency] || '€';
  if (hint) hint.textContent = `≈ ${Number(eur).toFixed(2).replace('.', ',')}€`;
}

function createNewHunt() {
  if (!requireWriteAccess('Création hunt bloquée', { ignoreReadOnlyHunt: true })) return;
  const name = document.getElementById('new-hunt-name-input').value.trim() || `Hunt #${state.hunts.length + 1}`;
  const bal = parseFloat(document.getElementById('new-hunt-bal-input').value) || 0;
  const currency = document.getElementById('new-hunt-currency').value || 'EUR';
  const casino = getCasinoKey(document.getElementById('new-hunt-casino')?.value || 'gamdom');
  const tpl = getSelectedNewHuntTemplate();
  const finalBal = tpl ? Number(tpl.startBalance || bal || 100) : bal;
  if (!Number.isFinite(finalBal) || finalBal <= 0) { showToast('Balance de départ invalide', 'error'); return; }
  const hunt = {
    id: uuidLike(),
    name,
    casino: tpl ? getCasinoKey(tpl.casino) : casino,
    currency: tpl ? (tpl.currency || currency) : currency,
    startBalance: finalBal,
    startBalanceEUR: toEUR(finalBal, tpl ? (tpl.currency || currency) : currency),
    createdAt: Date.now(),
    bonuses: []
  };
  if (tpl) {
    for (const b of tpl.bonuses || []) {
      const stakeN = Number(b.stake || 0);
      if (!Number.isFinite(stakeN) || stakeN <= 0) continue;
      const row = {
        id: uid(),
        slotId: b.slotId || uid(),
        slotName: b.slotName || 'Slot',
        slotProvider: b.slotProvider || '',
        slotImage: b.slotImage || '',
        stake: stakeN,
        bonusType: normalizeBonusType(b.bonusType),
        gamdomUrl: b.gamdomUrl || '',
        win: null
      };
      if (!huntBonusMachineConflict(hunt, row)) hunt.bonuses.push(row);
    }
  }
  setUndoSnapshot('création hunt');
  state.hunts.push(hunt);
  document.getElementById('new-hunt-modal').classList.add('hidden');
  save();
  state.activeHuntId = hunt.id;
  renderHuntList();
  refreshCurrencyInline();
  switchPage('hunt');
  document.getElementById('no-hunt-selected').style.display = 'none';
  document.getElementById('hunt-workspace').classList.remove('hidden');
  document.getElementById('hunt-workspace').style.display = 'flex';
  const openBtn = document.getElementById('btn-open-hunt');
  if (openBtn) openBtn.disabled = false;
  scheduleHuntUI({ loadCatalog: true, force: true });
  showToast(`Hunt "${name}" créé !`, 'success');
}

async function bulkClearOpenedBonuses() {
  if (!requireWriteAccess('Suppression bonus bloquée')) return;
  const hunt = activeHunt();
  if (!hunt) return;
  const count = (hunt.bonuses || []).filter((b) => b.win !== null).length;
  if (!count) { showToast('Aucun bonus ouvert à supprimer', 'info'); return; }
  const ok = await confirm('Supprimer les bonus ouverts ?', `${count} bonus seront retirés du hunt.`);
  if (!ok) return;
  setUndoSnapshot('bulk clear opened');
  hunt.bonuses = (hunt.bonuses || []).filter((b) => b.win === null);
  save();
  renderHuntWorkspace();
  showToast(`${count} bonus ouverts supprimés`, 'success');
}
async function bulkResetBonusWins() {
  if (!requireWriteAccess('Reset gains bloqué')) return;
  const hunt = activeHunt();
  if (!hunt) return;
  const count = (hunt.bonuses || []).filter((b) => b.win !== null).length;
  if (!count) { showToast('Aucun gain à reset', 'info'); return; }
  const ok = await confirm('Reset des gains ?', `${count} bonus repassent en "à ouvrir".`);
  if (!ok) return;
  setUndoSnapshot('bulk reset wins');
  (hunt.bonuses || []).forEach((b) => { b.win = null; });
  save();
  renderHuntWorkspace();
  showToast(`${count} gains réinitialisés`, 'success');
}

// ═══════════════════════════════════════════════
//  ADD BONUS MODAL
// ═══════════════════════════════════════════════
function openAddModal(slot) {
  if (!state.activeHuntId) { showToast('Sélectionne ou crée un hunt d\'abord', 'error'); return; }
  state.pendingSlot = slot;
  const name = slot.nom || slot.name || slot.title || slot.Name || 'Slot';
  const prov = slot.provider || slot.Provider || '';
  const img = normalizeSlotImageUrl(slot.image || slot.img || slot.thumbnail || '');

  document.getElementById('modal-name').textContent = name;
  document.getElementById('modal-prov').textContent = prov.toUpperCase();
  const imgEl = document.getElementById('modal-img');
  if (img && isSafeUrl(img)) {
    imgEl.referrerPolicy = 'no-referrer';
    imgEl.src = img;
    imgEl.style.display = 'block';
  } else { imgEl.style.display = 'none'; }

  document.getElementById('modal-stake-input').value = '';
  document.getElementById('modal-bonus-type').value = 'normal';
  document.getElementById('modal-gamdom-url').value = '';
  document.getElementById('add-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-stake-input').focus(), 80);
}

function closeAddModal() { document.getElementById('add-modal').classList.add('hidden'); state.pendingSlot = null; }

function confirmAddBonus() {
  if (!requireWriteAccess('Ajout bonus bloqué')) return;
  if (!state.pendingSlot) return;
  const stake = parseFloat(document.getElementById('modal-stake-input').value);
  if (isNaN(stake) || stake <= 0) { showToast('Entre une mise valide !', 'error'); return; }
  const bonusType = String(document.getElementById('modal-bonus-type')?.value || 'normal').toLowerCase();
  const gamdomUrl = String(document.getElementById('modal-gamdom-url')?.value || '').trim();
  const hunt = activeHunt();
  const slot = state.pendingSlot;
  const slotNameResolved = slot.nom || slot.name || slot.title || slot.Name || 'Slot';
  let resolvedGo = gamdomUrl;
  if (!resolvedGo) {
    const fromSlot = String(slot.gamdomUrl || slot.gamdom_url || '').trim();
    if (getCasinoKey(hunt?.casino) === 'gamdom') {
      if (isDirectGamePlayUrl(fromSlot)) resolvedGo = fromSlot;
      else resolvedGo = gamdomPlayUrlFromCatalogSlot(slot) || '';
      if (!resolvedGo && fromSlot && !isGamdomNonDirectStoredUrl(fromSlot)) resolvedGo = fromSlot;
      if (!resolvedGo) resolvedGo = buildCasinoSlotUrl(hunt?.casino, slotNameResolved);
    } else {
      resolvedGo = fromSlot || buildCasinoSlotUrl(hunt?.casino, slotNameResolved);
    }
  }
  const bonus = {
    id: uid(),
    slotId: slot.id || slot.Id,
    slotName: slotNameResolved,
    slotProvider: slot.provider || slot.Provider || '',
    slotImage: normalizeSlotImageUrl(slot.image || slot.img || slot.thumbnail || ''),
    stake,
    bonusType: ['normal', 'bounty', 'epic'].includes(bonusType) ? bonusType : 'normal',
    gamdomUrl: resolvedGo,
    win: null
  };
  if (huntBonusMachineConflict(hunt, bonus)) {
    showToast('Cette machine est déjà dans le hunt', 'error');
    return;
  }
  setUndoSnapshot('ajout bonus');
  hunt.bonuses.push(bonus);
  save();
  closeAddModal();
  renderHuntWorkspace();
  showToast(`${bonus.slotName} ajouté (${formatBonusTypeLabel(bonus.bonusType)}) !`, 'success');
}

function createCustomSlotBonus() {
  if (!requireWriteAccess('Ajout slot custom bloqué')) return;
  const hunt = activeHunt();
  if (!hunt) { showToast('Sélectionne ou crée un hunt d\'abord', 'error'); return; }
  const name = String(document.getElementById('slot-create-name')?.value || '').trim();
  const providerRaw = String(document.getElementById('slot-create-provider')?.value || '').trim();
  const stakeRaw = String(document.getElementById('slot-create-stake')?.value || '').trim();
  const typeRaw = String(document.getElementById('slot-create-type')?.value || 'normal').toLowerCase();
  const stake = Number(stakeRaw.replace(',', '.'));
  if (!name) { showToast('Entre un nom de slot', 'error'); return; }
  if (!Number.isFinite(stake) || stake <= 0) { showToast('Entre une mise valide', 'error'); return; }
  const bonusType = ['normal', 'bounty', 'epic'].includes(typeRaw) ? typeRaw : 'normal';

  // Si le nom + provider correspond à une entrée catalogue, on récupère l’id, l’image et le lien direct.
  const catHit = findCatalogSlotForBonus({ slotName: name, slotProvider: providerRaw, slotId: '' });
  const slotId = catHit ? String(catHit.id || catHit.Id || `custom_${uid()}`) : `custom_${uid()}`;
  const slotImg = catHit ? normalizeSlotImageUrl(catHit.image || catHit.img || catHit.thumbnail || '') : '';
  const providerResolved = providerRaw || (catHit ? String(catHit.provider || catHit.Provider || '') : '') || 'CUSTOM';

  let customGo = '';
  if (catHit) customGo = gamdomPlayUrlFromCatalogSlot(catHit);
  if (!customGo && getCasinoKey(hunt?.casino) === 'gamdom' && providerRaw) {
    customGo = gamdomSeoCasinoUrlFromNameProvider(name, providerRaw);
  }
  if (!customGo) customGo = buildCasinoSlotUrl(hunt?.casino, name);

  const customRow = {
    id: uid(),
    slotId,
    slotName: name,
    slotProvider: providerResolved,
    slotImage: slotImg,
    stake,
    bonusType,
    gamdomUrl: customGo,
    win: null
  };
  if (huntBonusMachineConflict(hunt, customRow)) {
    showToast('Cette machine est déjà dans le hunt', 'error');
    return;
  }
  setUndoSnapshot('ajout slot custom');
  hunt.bonuses.push(customRow);
  save();
  renderHuntWorkspace();
  const box = document.getElementById('slot-create-empty');
  if (box) box.style.display = 'none';
  const stakeInput = document.getElementById('slot-create-stake');
  if (stakeInput) stakeInput.value = '';
  const provInput = document.getElementById('slot-create-provider');
  if (provInput) provInput.value = '';
  const labelHint = catHit ? ' (lien Gamdom direct)' : (providerRaw ? ' (lien Gamdom estimé)' : '');
  showToast(`Slot "${name}" ajoutée au hunt${labelHint}`, 'success');
}

// ═══════════════════════════════════════════════
//  HUNT WORKSPACE RENDER
// ═══════════════════════════════════════════════
function renderHuntWorkspace(force = false) {
  if (!force && (__activePage !== 'hunt' || state.huntTab !== 'workspace')) return;
  const hunt = activeHunt();
  if (!hunt) return;
  refreshCurrencyInline();

  const _openBtn = document.getElementById('btn-open-hunt');
  if (_openBtn) {
    _openBtn.disabled = false;
    _openBtn.title = (hunt.bonuses && hunt.bonuses.length)
      ? 'Ouvrir le rouleau de bonus'
      : 'Ajoute des bonus avant d’ouvrir le hunt';
  }
  const _openBtnHeader = document.getElementById('btn-open-hunt-header');
  if (_openBtnHeader) _openBtnHeader.disabled = false;

  document.getElementById('current-hunt-name').textContent = hunt.name;
  const created = new Date(hunt.createdAt);
  const dateStr = created.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = created.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
  const eurHint = Number(hunt.startBalanceEUR || toEUR(hunt.startBalance || 0, hunt.currency || 'EUR')).toFixed(0);
  document.getElementById('current-hunt-date').textContent =
    `${dateStr} ${timeStr} · ${fmt(hunt.startBalance, hunt.currency)} (≈${eurHint}€)`;

  updateHeaderStats(hunt);
  renderBonusList(hunt);
  document.getElementById('tab-bonus-count').textContent = hunt.bonuses.length;
  updatePublicLiveButtons(hunt);

  // refresh grid indicators
  if (document.getElementById('slots-grid').children.length > 0) {
    const addedIds = new Set(hunt.bonuses.map(b => b.slotId));
    document.querySelectorAll('.slot-card').forEach(card => {
      const dot = card.querySelector('.green-dot');
      const id = card.dataset.id;
      if (addedIds.has(id) && !dot) {
        const d = document.createElement('div');
        d.className = 'green-dot';
        d.style.cssText = 'position:absolute;top:6px;left:6px;width:10px;height:10px;background:var(--green);border-radius:50%;box-shadow:0 0 6px var(--green);';
        card.appendChild(d);
      } else if (!addedIds.has(id) && dot) dot.remove();
    });
  }
  state._huntWsFp = huntWorkspaceFingerprint();
}

function updateHeaderStats(hunt) {
  if (!hunt) {
    ['stat-count','stat-total-win','stat-total-money','stat-profit','stat-be-avg'].forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      el.textContent = '—';
      if (el.classList.contains('stat-value')) el.className = 'stat-value';
    });
    const hintEl = document.getElementById('stat-profit-hint');
    if (hintEl) hintEl.textContent = 'Ajoute des bonus pour lancer le hunt.';
    const subEl = document.getElementById('stat-bonus-sub');
    if (subEl) subEl.textContent = '0 ouverts';
    return;
  }
  const { bonuses } = hunt;
  const startBalance = Number(hunt.startBalance || 0);
  const totalStake = bonuses.reduce((s, b) => s + Number(b.stake || 0), 0);
  const won = bonuses.filter(b => b.win !== null && !isNaN(Number(b.win)));
  const totalWin = won.reduce((s, b) => s + Number(b.win || 0), 0);
  const profit = totalWin - startBalance;
  const openedCount = bonuses.filter(b => b.win !== null).length;

  const countEl = document.getElementById('stat-count');
  if (countEl) countEl.textContent = bonuses.length;
  const subEl = document.getElementById('stat-bonus-sub');
  if (subEl) subEl.textContent = `${openedCount}/${bonuses.length} ouverts`;
  const winEl = document.getElementById('stat-total-win');
  if (winEl) winEl.textContent = fmt(totalWin);
  const totalMoneyEl = document.getElementById('stat-total-money');
  if (totalMoneyEl) totalMoneyEl.textContent = fmt(startBalance);

  const profEl = document.getElementById('stat-profit');
  if (profEl) {
    if (profit >= 0) { profEl.textContent = '+' + fmt(profit); profEl.className = 'stat-value green'; }
    else { profEl.textContent = fmt(profit); profEl.className = 'stat-value red'; }
  }
  const hintEl = document.getElementById('stat-profit-hint');
  if (hintEl) {
    hintEl.textContent = bonuses.length
      ? `${fmt(startBalance)} départ · ${fmt(totalWin)} gains`
      : 'Ajoute des bonus pour lancer le hunt.';
  }

  const beEl = document.getElementById('stat-be-avg');
  if (!beEl) return;
  if (bonuses.length === 0 || totalStake <= 0) { beEl.textContent = '—'; beEl.className = 'stat-value'; }
  else {
    const avgBe = Number(hunt.startBalance || 0) / totalStake;
    beEl.textContent = `${avgBe.toFixed(4).replace('.', ',')}×`;
    beEl.className = 'stat-value gold';
  }
}

function getProfitMotivation(profit, totalStake, totalWin) {
  if (totalStake <= 0) return 'Charge le hunt, on va allumer la session.';
  if (profit >= 0) {
    if (profit === 0) return 'Break-even atteint, maintenant on push le vert.';
    if (profit < totalStake * 0.1) return 'Tu es dans le vert, clean et efficace.';
    if (profit < totalStake * 0.3) return 'Gros momentum, continue comme un boss.';
    return 'Run monstrueux, machine de guerre activée !';
  }
  const missingPct = ((totalStake - totalWin) / Math.max(totalStake, 0.01)) * 100;
  if (missingPct <= 1) return 'Allez encore un peu champion, le vert est juste là !';
  if (missingPct <= 5) return 'Presque break-even, encore 1 hit et ça bascule.';
  if (missingPct <= 15) return 'Belle remontée, le comeback est lancé.';
  if (missingPct <= 35) return 'Session standard, on prépare le gros multiplicateur.';
  return 'Début de run compliqué, mais un max win peut tout retourner.';
}

function normalizeBonusType(type) {
  const t = String(type || 'normal').toLowerCase();
  return ['normal', 'bounty', 'epic'].includes(t) ? t : 'normal';
}

function formatBonusTypeLabel(type) {
  const t = normalizeBonusType(type);
  if (t === 'bounty') return 'BOUNTY';
  if (t === 'epic') return 'EPIC BONUS';
  return 'NORMAL';
}

function renderBonusList(hunt) {
  const list = document.getElementById('bonus-list');
  const empty = document.getElementById('bonus-list-empty');
  list.innerHTML = '';

  if (hunt.bonuses.length === 0) {
    empty.style.display = 'flex';
    return;
  }
  let shown = hunt.bonuses.map((bonus, i) => ({ bonus, i }));
  const { status, type, sort, q, provider, minStake, maxStake, winFilter } = state.bonusView;
  const providerFilterEl = document.getElementById('bonus-provider-filter');
  if (providerFilterEl) {
    const providers = [...new Set((hunt.bonuses || []).map((b) => String(b.slotProvider || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));
    const hash = providers.join('|');
    if (hash !== __bonusProviderHash) {
      __bonusProviderHash = hash;
      providerFilterEl.innerHTML = ['<option value="">Provider: tous</option>']
        .concat(providers.map((p) => `<option value="${escapeHtml(p.toLowerCase())}">${escapeHtml(p)}</option>`))
        .join('');
    }
    const want = String(provider || '').toLowerCase();
    if (providerFilterEl.value !== want) providerFilterEl.value = want;
  }
  if (status === 'pending') shown = shown.filter(x => x.bonus.win === null);
  if (status === 'opened') shown = shown.filter(x => x.bonus.win !== null);
  const wf = winFilter || (status === 'positive' || status === 'negative' ? status : 'all');
  if (wf === 'positive') shown = shown.filter(x => Number(x.bonus.win || 0) > 0);
  if (wf === 'negative') shown = shown.filter(x => x.bonus.win !== null && Number(x.bonus.win || 0) <= 0);
  if (type !== 'all') shown = shown.filter(x => normalizeBonusType(x.bonus.bonusType) === type);
  if (provider) shown = shown.filter(({ bonus }) => String(bonus.slotProvider || '').toLowerCase() === provider);
  const minStakeNum = Number(String(minStake || '').replace(',', '.'));
  const maxStakeNum = Number(String(maxStake || '').replace(',', '.'));
  if (Number.isFinite(minStakeNum) && minStake !== '') shown = shown.filter(({ bonus }) => Number(bonus.stake || 0) >= minStakeNum);
  if (Number.isFinite(maxStakeNum) && maxStake !== '') shown = shown.filter(({ bonus }) => Number(bonus.stake || 0) <= maxStakeNum);
  if (q) {
    shown = shown.filter(({ bonus }) => {
      const n = String(bonus.slotName || '').toLowerCase();
      const p = String(bonus.slotProvider || '').toLowerCase();
      return n.includes(q) || p.includes(q);
    });
  }
  if (sort === 'stake_desc') shown.sort((a, b) => Number(b.bonus.stake || 0) - Number(a.bonus.stake || 0));
  if (sort === 'stake_asc') shown.sort((a, b) => Number(a.bonus.stake || 0) - Number(b.bonus.stake || 0));
  if (sort === 'win_desc') shown.sort((a, b) => Number(b.bonus.win ?? -Infinity) - Number(a.bonus.win ?? -Infinity));
  if (sort === 'win_asc') shown.sort((a, b) => Number(a.bonus.win ?? Infinity) - Number(b.bonus.win ?? Infinity));
  if (sort === 'multi_desc') shown.sort((a, b) => (Number(b.bonus.win || 0) / Math.max(0.01, Number(b.bonus.stake || 0))) - (Number(a.bonus.win || 0) / Math.max(0.01, Number(a.bonus.stake || 0))));
  if (sort === 'multi_asc') shown.sort((a, b) => (Number(a.bonus.win || 0) / Math.max(0.01, Number(a.bonus.stake || 0))) - (Number(b.bonus.win || 0) / Math.max(0.01, Number(b.bonus.stake || 0))));
  if (sort === 'name_asc') shown.sort((a, b) => String(a.bonus.slotName || '').localeCompare(String(b.bonus.slotName || ''), 'fr'));

  if (shown.length === 0) {
    empty.style.display = 'flex';
    empty.querySelector('.empty-text').textContent = 'AUCUN BONUS DANS CE FILTRE';
    return;
  }
  empty.style.display = 'none';
  empty.querySelector('.empty-text').textContent = 'AUCUN BONUS AJOUTÉ';

  shown.forEach(({ bonus, i }) => {
    const bonusType = normalizeBonusType(bonus.bonusType);
    const beMultiplier = beRequiredMultiplier(hunt, Number(bonus.stake || 0));
    const multi = bonus.win !== null ? (bonus.win / bonus.stake).toFixed(1) : null;
    const beRequiredAmount = Number(hunt.startBalance || 0);
    const isGood = bonus.win !== null && bonus.win >= beRequiredAmount;
    const row = document.createElement('div');
    row.className = 'bonus-row' + (bonus.win !== null ? ' completed' : '');

    const safeSlotName = escapeHtml(bonus.slotName || '');
    const normalizedSlotImg = resolveBonusImageUrl(bonus);
    const safeSlotImg = isSafeUrl(normalizedSlotImg) ? escapeHtml(normalizedSlotImg) : '';
    const safeProv = escapeHtml(String(bonus.slotProvider || '').toUpperCase());
    row.innerHTML = `
      <div class="bonus-pos-bar"></div>
      <div class="bonus-thumb">
        ${safeSlotImg
          ? `<img src="${safeSlotImg}" alt="${safeSlotName}" loading="lazy" referrerpolicy="no-referrer" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div class="bonus-thumb-placeholder" style="display:none"><img src="./assets/virtual-token.svg" class="ui-logo-icon" alt="slot"></div>`
          : `<div class="bonus-thumb-placeholder"><img src="./assets/virtual-token.svg" class="ui-logo-icon" alt="slot"></div>`}
        <div class="bonus-thumb-pos">#${i+1}</div>
        </div>
      <div class="bonus-info">
        <div class="bonus-slot-name">${safeSlotName}</div>
        <div class="bonus-slot-prov">${safeProv}</div>
        <span class="bonus-stake-badge">MISE: ${fmt(bonus.stake)}</span>
        <span class="bonus-type-badge ${escapeHtml(bonusType)}">${escapeHtml(formatBonusTypeLabel(bonusType))}</span>
      </div>
      <div class="bonus-be-block">
        <div class="bonus-be-label">BE REQUIS</div>
        <div class="bonus-be-val">${beMultiplier.toFixed(4).replace('.', ',')}×</div>
      </div>
      <div class="bonus-gain-block">
        <div class="bonus-gain-label">GAIN</div>
        <div class="bonus-win ${bonus.win === null ? 'none' : ('set' + (isGood ? ' good' : ''))}">${bonus.win === null ? '0.00€' : fmt(bonus.win)}</div>
        ${multi !== null ? `<div class="bonus-multi ${isGood ? 'hot' : ''}">${multi}×</div>` : ''}
      </div>
      <div class="bonus-row-actions">
        <button class="row-action-btn" title="Go to Slot (${escapeHtml(getCasinoLabel(hunt?.casino))})" data-gamdom="${i}"><img src="./assets/virtual-token.svg" class="sidebar-tab-icon-logo" alt="slot"></button>
        <button class="row-action-btn" title="Ouvrir dans le rouleau" data-edit="${i}">✎</button>
        <button class="row-action-btn danger" title="Supprimer" data-remove="${i}">✕</button>
      </div>
    `;
    row.querySelector('[data-gamdom]').addEventListener('click', (e) => {
      e.stopPropagation();
      const url = getBonusGoToUrl(hunt, bonus);
      window.open(url, '_blank');
    });
    row.querySelector('[data-edit]').addEventListener('click', () => openOpener(i));
    row.querySelector('[data-remove]').addEventListener('click', async () => {
      const ok = await confirm('Supprimer ce bonus ?', `"${bonus.slotName}" sera retiré du hunt.`);
      if (ok) { setUndoSnapshot('suppression bonus'); hunt.bonuses.splice(i, 1); save(); renderHuntWorkspace(); showToast('Bonus supprimé', 'error'); }
    });
    list.appendChild(row);
  });
}

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
    showToast(`Preset "${p.name}" appliqué`, 'success', 1500);
  });
  bind('btn-save-filter-preset', 'click', () => {
    const name = prompt('Nom du preset filtre', `Filtre ${new Date().toLocaleTimeString('fr-FR')}`);
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
    showToast(`Preset "${removed?.name || ''}" supprimé`, 'info', 1500);
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
  bind('slot-create-btn', 'click', createCustomSlotBonus);
  bind('slot-create-stake', 'keydown', (e) => { if (e.key === 'Enter') createCustomSlotBonus(); });
  bind('slot-create-name', 'keydown', (e) => { if (e.key === 'Enter') createCustomSlotBonus(); });
  bind('slot-create-provider', 'keydown', (e) => { if (e.key === 'Enter') createCustomSlotBonus(); });
  bind('btn-bulk-clear-opened', 'click', bulkClearOpenedBonuses);
  bind('btn-bulk-reset-wins', 'click', bulkResetBonusWins);
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuntWorkspaceUi);
else initHuntWorkspaceUi();

