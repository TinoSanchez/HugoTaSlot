// Tournoi (Supabase)
// Chargé lazily par scripts/pages/tournoi.js via LAZY_PAGE_SCRIPTS dans app.js
'use strict';
/* globals fmt, showToast, getUserBalance, setUserBalance, activeHunt, state, save, bhWarn, getAuthClient, currentUser, isCloudUser, isCurrentUserAdmin, recordGameSession, queueCloudGameSession */

// ─── TOURNOI (Supabase) — mensuel Europe/Paris ───
let tournoiCacheCurrent = [];
let tournoiCachePodium = [];
let tournoiMonthKeys = { curKey: '', prevKey: '' };
let tournoiLoaded = false;

/** Mois calendaire actuel / précédent (fuseau Europe/Paris), clés YYYY-MM */
function parisTournoiMonthKeys() {
  const s = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const [y, m] = s.split('-').map(Number);
  let py = y;
  let pm = m - 1;
  if (pm < 1) {
    pm = 12;
    py -= 1;
  }
  const curKey = `${y}-${String(m).padStart(2, '0')}`;
  const prevKey = `${py}-${String(pm).padStart(2, '0')}`;
  return { curKey, prevKey };
}

function formatTournoiMonthLabelFR(ym) {
  const parts = String(ym || '').split('-');
  if (parts.length < 2) return ym;
  const y = Number(parts[0]);
  const mo = Number(parts[1]);
  if (!y || !mo) return ym;
  const d = new Date(y, mo - 1, 1);
  return d.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
}

function mapTournoiRow(e) {
  return {
    id: e.id,
    huntName: e.hunt_name,
    player: e.player_name,
    gain: Number(e.gain || 0),
    mise: Number(e.mise || 0),
    multiplier: Number(e.multiplier || 0),
    replay: e.replay_url || '',
    verified: !!e.verified,
    periodMonth: e.period_month || '',
    date: e.created_at ? Date.parse(e.created_at) : Date.now(),
  };
}

function tournoiCardHtml(e, rankLabel) {
  const safeReplay = isSafeUrl(e.replay) ? escapeHtml(e.replay) : '';
  return `
    <div class="tournoi-card">
      <div class="tournoi-rank">${rankLabel}</div>
      <div class="tournoi-info">
        <div class="tournoi-name">${escapeHtml(e.huntName)}</div>
        <div class="tournoi-meta">Par ${escapeHtml(e.player)} · Mise: ${fmt(e.mise)} · ${new Date(e.date).toLocaleDateString('fr-FR')}</div>
        ${safeReplay ? `<a href="${safeReplay}" target="_blank" rel="noopener noreferrer" style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--blue);">Voir le replay</a>` : ''}
      </div>
      <div>
        <div class="tournoi-score">${fmt(e.gain)}</div>
        <div style="font-family:'Share Tech Mono',monospace;font-size:9px;color:var(--text-dim);text-align:right;">×${Number(e.multiplier).toFixed(2)}</div>
        <div style="text-align:right;margin-top:4px;"><span class="tournoi-badge ${e.verified ? 'verified' : 'pending'}">${e.verified ? 'VÉRIFIÉ' : 'EN ATTENTE'}</span></div>
      </div>
    </div>`;
}

async function fetchTournoi() {
  const c = getAuthClient();
  tournoiMonthKeys = parisTournoiMonthKeys();
  if (!c) {
    tournoiCacheCurrent = [];
    tournoiCachePodium = [];
    tournoiLoaded = true;
    return { current: tournoiCacheCurrent, podium: tournoiCachePodium };
  }
  const sel = 'id,user_id,hunt_name,player_name,gain,mise,multiplier,replay_url,verified,created_at,period_month';
  try {
    const [curRes, prevRes] = await Promise.all([
      retryAsync(
        () => withTimeout(() => c.from('tournament_entries').select(sel).eq('period_month', tournoiMonthKeys.curKey).order('multiplier', { ascending: false }).limit(200), 12000),
        { retries: 1, delayMs: 400 },
      ),
      retryAsync(
        () => withTimeout(() => c.from('tournament_entries').select(sel).eq('period_month', tournoiMonthKeys.prevKey).order('multiplier', { ascending: false }).limit(3), 12000),
        { retries: 1, delayMs: 400 },
      ),
    ]);
    if (curRes.error) throw curRes.error;
    if (prevRes.error) throw prevRes.error;
    tournoiCacheCurrent = (curRes.data || []).map(mapTournoiRow);
    tournoiCachePodium = (prevRes.data || []).map(mapTournoiRow);
  } catch (e) {
    bhWarn('Tournoi load failed', e);
    tournoiCacheCurrent = [];
    tournoiCachePodium = [];
  }
  tournoiLoaded = true;
  return { current: tournoiCacheCurrent, podium: tournoiCachePodium };
}

function getTournoi() {
  return tournoiCacheCurrent.slice();
}

async function renderTournoiLeaderboard() {
  const lb = document.getElementById('tournoi-leaderboard');
  const pod = document.getElementById('tournoi-podium-prev');
  const titlePod = document.getElementById('tournoi-podium-title');
  const subPod = document.getElementById('tournoi-podium-sub');
  const titleCur = document.getElementById('tournoi-current-title');
  const subCur = document.getElementById('tournoi-current-sub');
  if (!lb || !pod) return;
  if (!tournoiLoaded) {
    lb.innerHTML = '<div class="empty-state" style="height:120px;"><div class="empty-text">Chargement du classement…</div></div>';
    pod.innerHTML = '';
    await fetchTournoi();
  }
  const { curKey, prevKey } = tournoiMonthKeys;
  const labelPrev = formatTournoiMonthLabelFR(prevKey);
  const labelCur = formatTournoiMonthLabelFR(curKey);
  if (titlePod) titlePod.textContent = 'PODIUM DU MOIS PRÉCÉDENT';
  if (subPod) subPod.textContent = `Top 3 multiplicateur · ${labelPrev} · fuseau Europe/Paris`;
  if (titleCur) titleCur.textContent = 'CLASSEMENT DU MOIS EN COURS';
  if (subCur) subCur.textContent = `${labelCur} — réinitialisé chaque 1er du mois · nouvelles entrées comptent pour ce mois uniquement`;

  const podiumMedals = ['🥇', '🥈', '🥉'];
  if (!tournoiCachePodium.length) {
    pod.innerHTML = '<div class="empty-state" style="min-height:120px;"><div class="empty-text">Aucune entrée pour ce mois (ou mois encore vide).</div></div>';
  } else {
    pod.innerHTML = tournoiCachePodium.map((e, i) => tournoiCardHtml(e, podiumMedals[i] || '#' + (i + 1))).join('');
  }

  const entries = tournoiCacheCurrent.slice().sort((a, b) => b.multiplier - a.multiplier);
  if (!entries.length) {
    lb.innerHTML = '<div class="empty-state" style="height:200px;"><div class="empty-icon"><img src="./assets/virtual-token.svg" class="ui-logo-icon" alt="tournoi"></div><div class="empty-text">AUCUNE ENTRÉE CE MOIS-CI — SOIS LE PREMIER !</div></div>';
    return;
  }
  lb.innerHTML = entries.map((e, i) => tournoiCardHtml(e, '#' + (i + 1))).join('');
}

function showSubmitTournoi() {
  if (!isCloudUser()) {
    showToast('Connecte-toi pour soumettre un hunt au tournoi', 'error', 3500);
    showAuth();
    return;
  }
  document.getElementById('tournoi-modal').classList.remove('hidden');
}
function closeTournoiModal() { document.getElementById('tournoi-modal').classList.add('hidden'); }

async function submitTournoi() {
  const name = document.getElementById('t-hunt-name').value.trim();
  const gain = parseFloat(document.getElementById('t-gain').value);
  const mise = parseFloat(document.getElementById('t-mise').value);
  const replay = document.getElementById('t-replay').value.trim();
  if (!name || isNaN(gain) || isNaN(mise) || mise <= 0) { showToast('Remplis tous les champs obligatoires', 'error'); return; }
  if (!replay) { showToast('Un lien de preuve est requis pour vérification', 'error'); return; }
  if (!isCloudUser()) { showToast('Connecte-toi pour soumettre', 'error'); return; }

  const c = getAuthClient();
  if (!c) { showToast('Client Supabase indisponible', 'error'); return; }
  try {
    const { error } = await withTimeout(() => c.from('tournament_entries').insert([{
      user_id: currentUser.id,
      hunt_name: name,
      player_name: currentUser.displayName || currentUser.username || 'Anonyme',
      gain,
      mise,
      replay_url: replay,
      verified: false
    }]), 12000);
    if (error) throw error;
    closeTournoiModal();
    await fetchTournoi();
    renderTournoiLeaderboard();
    showToast('Hunt soumis ! En attente de vérification.', 'success', 4000);
  } catch (e) {
    showToast(mapAuthError(e) || 'Soumission impossible', 'error', 3500);
  }
}