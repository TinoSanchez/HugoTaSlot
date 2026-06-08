// Calcul mise optimale
// Chargé lazily par scripts/pages/mise.js via LAZY_PAGE_SCRIPTS dans app.js
'use strict';
/* globals fmt, showToast, getUserBalance, setUserBalance, activeHunt, state, save, bhWarn, getAuthClient, currentUser, isCloudUser, isCurrentUserAdmin, recordGameSession, queueCloudGameSession */

// ─── CALCUL MISE OPTIMALE ───
function calcMise() {
  const balance = Math.max(0, parseFloat(document.getElementById('m-balance').value) || 0);
  if (balance <= 0) {
    showToast('Entre un solde valide', 'error');
    return;
  }

  const hunt = activeHunt();
  const machineCount = Math.max(1, hunt?.bonuses?.length || 20);
  const bankrollPerMachine = balance / machineCount;

  // Cadre pratique "spin": budget machine / nombre de spins visés.
  // 120 spins = standard de session, puis profils conservateur/agressif.
  const targetSpinsStd = 120;
  const targetSpinsSafe = 180;
  const targetSpinsAgg = 80;

  const spinSafe = Math.max(0.01, bankrollPerMachine / targetSpinsSafe);
  const spinStd = Math.max(0.01, bankrollPerMachine / targetSpinsStd);
  const spinAgg = Math.max(0.01, bankrollPerMachine / targetSpinsAgg);

  const spinsStdPerMachine = Math.floor(bankrollPerMachine / spinStd);
  const totalSpinsStd = spinsStdPerMachine * machineCount;

  const beTargetX = machineCount > 0 ? (balance / (spinStd * machineCount)) : 0;

  document.getElementById('mise-results').style.display = 'block';
  document.getElementById('mise-grid-content').innerHTML = `
    <div class="mise-result-card">
      <div class="mise-result-label">MACHINES CIBLÉES (AUTO)</div>
      <div class="mise-result-val">${machineCount}</div>
    </div>
    <div class="mise-result-card">
      <div class="mise-result-label">BUDGET PAR MACHINE</div>
      <div class="mise-result-val">${fmt(bankrollPerMachine)}</div>
    </div>
    <div class="mise-result-card">
      <div class="mise-result-label">SPIN CONSERVATEUR</div>
      <div class="mise-result-val" style="color:var(--cyan)">${fmt(spinSafe)}</div>
    </div>
    <div class="mise-result-card">
      <div class="mise-result-label">SPIN RECOMMANDÉ</div>
      <div class="mise-result-val" style="color:var(--gold)">${fmt(spinStd)}</div>
    </div>
    <div class="mise-result-card">
      <div class="mise-result-label">SPIN AGRESSIF</div>
      <div class="mise-result-val" style="color:var(--red)">${fmt(spinAgg)}</div>
    </div>
    <div class="mise-result-card">
      <div class="mise-result-label">SPINS TOTAUX (RECOMMANDÉ)</div>
      <div class="mise-result-val">${totalSpinsStd}</div>
    </div>
  `;

  document.getElementById('mise-advice').innerHTML = `
    <strong>PLAN DE SPIN AUTO</strong>
    Tu saisis seulement le solde, le reste est calculé automatiquement selon ton hunt actif.<br>
    → Machines prises en compte: <b>${machineCount}</b><br>
    → Mise de spin recommandée: <b style="color:var(--gold)">${fmt(spinStd)}</b> par machine<br>
    → Volume visé: <b>${spinsStdPerMachine}</b> spins par machine (~${totalSpinsStd} spins au total)<br>
    → BE indicatif de session: <b style="color:var(--blue)">${beTargetX.toFixed(2).replace('.', ',')}×</b><br>
    ${machineCount <= 1 ? 'Ajoute plus de bonus pour une meilleure répartition du risque.' : 'Répartition bankroll équilibrée pour limiter la variance.'}
  `;
}