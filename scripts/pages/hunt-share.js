'use strict';
/* globals activeHunt, showToast, escapeHtml, confirmRich, requireWriteAccess, getCasinoLabel, getCasinoKey, toEUR, uuidLike, uid, normalizeBonusType, huntBonusMachineConflict, setUndoSnapshot, state, save, renderHuntList, selectHunt, inferCasinoFromBonuses */
/* Share code + import fichier hunt — lazy bundle hunt */

function encodeSharePayload(payload) {
  try { return btoa(unescape(encodeURIComponent(JSON.stringify(payload)))); } catch (_) { return ''; }
}
function decodeSharePayload(code) {
  const text = decodeURIComponent(escape(atob(String(code || '').trim())));
  return JSON.parse(text);
}
async function exportShareCode() {
  const hunt = activeHunt();
  if (!hunt) { showToast('Sélectionne un hunt à partager', 'error'); return; }
  const payload = {
    format: 'hugotaslot-share-v1',
    sharedAt: Date.now(),
    hunt: {
      ...hunt,
      readOnlyShared: true
    }
  };
  const code = encodeSharePayload(payload);
  if (!code) { showToast('Impossible de générer le code de partage', 'error'); return; }
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(code);
      showToast('Code de partage copié', 'success', 1700);
      return;
    }
  } catch (_) {}
  prompt('Code de partage (copie-le)', code);
}
async function importShareCode() {
  if (!requireWriteAccess('Import share bloqué', { ignoreReadOnlyHunt: true })) return;
  const raw = prompt('Colle le code de partage');
  if (!raw) return;
  try {
    const parsed = decodeSharePayload(raw);
    if (!parsed || parsed.format !== 'hugotaslot-share-v1' || !parsed.hunt || !Array.isArray(parsed.hunt.bonuses)) {
      showToast('Code de partage invalide', 'error');
      return;
    }
    const shared = parsed.hunt;
    const ok = await confirmRich(
      'Importer hunt partagé (lecture seule)',
      `<div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);line-height:1.5;">
        Hunt: ${escapeHtml(shared.name || 'Hunt partagé')}<br>
        Bonus: ${Array.isArray(shared.bonuses) ? shared.bonuses.length : 0}<br>
        Casino: ${escapeHtml(getCasinoLabel(getCasinoKey(shared.casino || 'gamdom')))}<br>
        Mode: lecture seule
      </div>`,
      'IMPORTER',
      'ANNULER'
    );
    if (!ok) return;
    const hunt = {
      id: uuidLike(),
      name: `${String(shared.name || 'Hunt partagé').slice(0, 64)} (shared)`,
      casino: getCasinoKey(shared.casino || 'gamdom'),
      currency: shared.currency || 'EUR',
      startBalance: Number(shared.startBalance || 0),
      startBalanceEUR: Number(shared.startBalanceEUR || toEUR(Number(shared.startBalance || 0), shared.currency || 'EUR')),
      createdAt: Date.now(),
      readOnlyShared: true,
      bonuses: []
    };
    for (const b of shared.bonuses || []) {
      const stakeN = Number(b.stake || 0);
      if (!Number.isFinite(stakeN) || stakeN <= 0) continue;
      const row = {
        id: uid(),
        slotId: b.slotId || uid(),
        slotName: b.slotName || b.nom || 'Slot',
        slotProvider: b.slotProvider || b.provider || '',
        slotImage: b.slotImage || b.image || '',
        stake: stakeN,
        win: (b.win === null || b.win === undefined || !Number.isFinite(Number(b.win)) || Number(b.win) < 0) ? null : Number(b.win),
        bonusType: normalizeBonusType(b.bonusType),
        gamdomUrl: b.gamdomUrl || ''
      };
      if (!huntBonusMachineConflict(hunt, row)) hunt.bonuses.push(row);
    }
    setUndoSnapshot('import share');
    state.hunts.push(hunt);
    state.activeHuntId = hunt.id;
    save();
    renderHuntList();
    selectHunt(hunt.id);
    showToast('Hunt partagé importé (lecture seule)', 'success', 2200);
  } catch (_) {
    showToast('Code de partage invalide ou corrompu', 'error');
  }
}

function importHuntFile(file) {
  if (!requireWriteAccess('Import hunt bloqué', { ignoreReadOnlyHunt: true })) return;
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(String(reader.result || '{}'));
      const imported = parsed?.hunt || parsed;
      const format = String(parsed?.format || '');
      const schemaVersion = Number(parsed?.schemaVersion || 1);
      if (format && !['hugotaslot-hunt-v2', 'hugotaslot-hunt-v3'].includes(format)) {
        showToast('Format de fichier non supporté', 'error');
        return;
      }
      if (!imported || typeof imported !== 'object' || !Array.isArray(imported.bonuses)) {
        showToast('Fichier hunt invalide', 'error');
        return;
      }
      const bonusRows = imported.bonuses || [];
      const invalidRows = bonusRows.filter((b) => !Number.isFinite(Number(b.stake || 0)) || Number(b.stake || 0) <= 0).length;
      const invalidWins = bonusRows.filter((b) => b.win !== null && b.win !== undefined && (!Number.isFinite(Number(b.win)) || Number(b.win) < 0)).length;
      const previewName = imported.name || `Hunt importé #${state.hunts.length + 1}`;
      const previewCurrency = imported.currency || 'EUR';
      const previewCasino = getCasinoKey(imported.casino || inferCasinoFromBonuses(imported.bonuses));
      const previewSchema = schemaVersion || 1;
      const previewRows = bonusRows.slice(0, 20).map((b, i) => ({
        i: i + 1,
        slot: String(b.slotName || b.nom || 'Slot'),
        provider: String(b.slotProvider || b.provider || ''),
        stake: Number(b.stake || 0),
        win: (b.win === null || b.win === undefined) ? null : Number(b.win),
        type: normalizeBonusType(b.bonusType)
      }));
      const rowsHtml = previewRows.length
        ? previewRows.map((r) => `
            <tr>
              <td style="padding:6px;border-top:1px solid var(--border);">${r.i}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${escapeHtml(r.slot.slice(0, 28))}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${escapeHtml((r.provider || '—').slice(0, 18))}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${Number(r.stake || 0).toFixed(2)}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${r.win === null || !Number.isFinite(r.win) ? '—' : Number(r.win).toFixed(2)}</td>
              <td style="padding:6px;border-top:1px solid var(--border);">${escapeHtml(r.type)}</td>
            </tr>
          `).join('')
        : `<tr><td colspan="6" style="padding:8px;border-top:1px solid var(--border);">Aucune ligne</td></tr>`;
      const ok = await confirmRich(
        'Prévisualisation import hunt',
        `
          <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);line-height:1.5;margin-bottom:8px;">
            Nom: ${escapeHtml(previewName)}<br>
            Devise: ${escapeHtml(previewCurrency)} · Casino: ${escapeHtml(previewCasino)} · Schema: v${previewSchema}<br>
            Bonus: ${bonusRows.length} · Mises invalides: ${invalidRows} · Gains invalides: ${invalidWins}
          </div>
          <div style="max-height:220px;overflow:auto;border:1px solid var(--border);border-radius:8px;">
            <table style="width:100%;border-collapse:collapse;font-family:'Share Tech Mono',monospace;font-size:10px;">
              <thead>
                <tr>
                  <th style="text-align:left;padding:6px;">#</th>
                  <th style="text-align:left;padding:6px;">Slot</th>
                  <th style="text-align:left;padding:6px;">Provider</th>
                  <th style="text-align:left;padding:6px;">Mise</th>
                  <th style="text-align:left;padding:6px;">Gain</th>
                  <th style="text-align:left;padding:6px;">Type</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
          <div style="margin-top:8px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);">
            Aperçu limité aux 20 premières lignes.
          </div>
        `,
        'IMPORTER',
        'ANNULER'
      );
      if (!ok) return;
      setUndoSnapshot('import');
      const hunt = {
        id: uuidLike(),
        name: imported.name ? `${imported.name} (import)` : `Hunt importé #${state.hunts.length + 1}`,
        casino: getCasinoKey(imported.casino || inferCasinoFromBonuses(imported.bonuses)),
        currency: imported.currency || 'EUR',
        startBalance: Number(imported.startBalance || 0),
        startBalanceEUR: Number(imported.startBalanceEUR || toEUR(Number(imported.startBalance || 0), imported.currency || 'EUR')),
        createdAt: Date.now(),
        bonuses: []
      };
      for (const b of imported.bonuses || []) {
        if (Number(b.stake || 0) <= 0) continue;
        const row = {
          id: uid(),
          slotId: b.slotId || b.id || uid(),
          slotName: b.slotName || b.nom || 'Slot',
          slotProvider: b.slotProvider || b.provider || '',
          slotImage: b.slotImage || b.image || '',
          stake: Number(b.stake || 0),
          win: (b.win === null || b.win === undefined || !Number.isFinite(Number(b.win)) || Number(b.win) < 0) ? null : Number(b.win || 0),
          bonusType: normalizeBonusType(b.bonusType),
          gamdomUrl: b.gamdomUrl || ''
        };
        if (!huntBonusMachineConflict(hunt, row)) hunt.bonuses.push(row);
      }
      state.hunts.push(hunt);
      state.activeHuntId = hunt.id;
      save();
      renderHuntList();
      selectHunt(hunt.id);
      showToast('Hunt importé avec succès', 'success');
    } catch {
      showToast('Erreur de lecture du fichier', 'error');
    }
  };
  reader.readAsText(file);
}

function initHuntShareToolbar() {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el && !el.dataset.huntBound) { el.dataset.huntBound = '1'; el.addEventListener('click', fn); } };
  bind('btn-import-hunt', () => document.getElementById('hunt-import-input')?.click());
  bind('btn-share-hunt', exportShareCode);
  bind('btn-import-share', importShareCode);
  const input = document.getElementById('hunt-import-input');
  if (input && !input.dataset.huntBound) {
    input.dataset.huntBound = '1';
    input.addEventListener('change', (e) => {
      importHuntFile(e.target.files && e.target.files[0]);
      e.target.value = '';
    });
  }
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuntShareToolbar);
else initHuntShareToolbar();

