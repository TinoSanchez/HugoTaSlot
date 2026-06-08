// Roue du Dépôt
// Chargé lazily par scripts/pages/roue-depot.js via LAZY_PAGE_SCRIPTS dans app.js
'use strict';
/* globals fmt, showToast, getUserBalance, setUserBalance, activeHunt, state, save, bhWarn, getAuthClient, currentUser, isCloudUser, isCurrentUserAdmin, recordGameSession, queueCloudGameSession */

// ROUE DU DEPOT : entiers N,00 ; règle selon le max de plage (pas de décimales dans la valeur).
// Variables d'état (déplacées ici depuis mini-jeux.js lors de la Passe 2)
let depositWheelValues = [];
let depositWheelSelected = -1;
let depositWheelSpinRotation = 0;
let depositWheelSpinning = false;

function depositWheelSetResult(msg) {
  document.querySelectorAll('.dep-result').forEach((el) => {
    el.textContent = msg;
  });
}
function depositWheelDisplay(v) {
  const n = Math.max(0, Math.round(Number(v) || 0));
  return `${n},00`;
}
/** max ≤100 → finit par 0 ou 5 ; 100 < max ≤300 → multiple de 10 ; max >300 → …00/25/50/75 */
function depositWheelTier(maxPlage) {
  const m = Number(maxPlage);
  if (!Number.isFinite(m)) return 'large';
  if (m <= 100) return 'small';
  if (m <= 300) return 'med';
  return 'large';
}
function depositWheelValueOk(n, tier) {
  const u = ((n % 10) + 10) % 10;
  if (tier === 'small') return u === 0 || u === 5;
  if (tier === 'med') return u === 0;
  const h = ((n % 100) + 100) % 100;
  return h === 0 || h === 25 || h === 50 || h === 75;
}
function depositWheelListValidInts(lo, hi, tier) {
  const a = Math.ceil(lo);
  const b = Math.floor(hi);
  if (b < a) return [];
  const out = [];
  for (let n = a; n <= b; n += 1) {
    if (depositWheelValueOk(n, tier)) out.push(n);
  }
  return out;
}
function depositWheelFillMiddle8Stratified(interior) {
  const nI = interior.length;
  const middle = [];
  for (let i = 0; i < 8; i += 1) {
    const loIdx = Math.floor((i * nI) / 8);
    const hiIdx = Math.floor(((i + 1) * nI) / 8) - 1;
    const lo = Math.max(0, Math.min(nI - 1, loIdx));
    const hi = Math.max(lo, Math.min(nI - 1, hiIdx));
    const j = lo + Math.floor(Math.random() * (hi - lo + 1));
    middle.push(interior[j]);
  }
  middle.sort((a, b) => a - b);
  return middle;
}
/** Case 1 = min, case 10 = max ; milieu stratifié ou tirage avec remise si plage courte. */
function depositWheelStratifiedEndingInts(min, max) {
  const tier = depositWheelTier(max);
  const valid = depositWheelListValidInts(min, max, tier);
  const nV = valid.length;
  if (nV < 1) return [];
  const first = valid[0];
  const last = valid[nV - 1];
  const interior = valid.slice(1, nV - 1);
  const nI = interior.length;
  let middle;
  if (nI >= 8) middle = depositWheelFillMiddle8Stratified(interior);
  else {
    const pool = nI > 0 ? interior : valid;
    middle = [];
    for (let k = 0; k < 8; k += 1) {
      middle.push(pool[Math.floor(Math.random() * pool.length)]);
    }
    middle.sort((a, b) => a - b);
  }
  return [first, ...middle, last];
}
function depositWheelRender() {
  document.querySelectorAll('.deposit-wheel-grid').forEach((grid) => {
    const cells = grid.querySelectorAll('.deposit-wheel-cell');
    if (cells.length !== 10) return;
    cells.forEach((cell, i) => {
      const v = Number(depositWheelValues[i] || 0);
      cell.textContent = v > 0 ? depositWheelDisplay(v) : '—';
      cell.classList.toggle('active', depositWheelSelected === i);
    });
  });
}
function depositWheelSyncRouletteVisual() {
  depositWheelSpinRotation = 0;
  depositWheelSpinning = false;
  document.querySelectorAll('.deposit-wheel-wrap').forEach((wrap) => {
    const disc = wrap.querySelector('.deposit-roulette-disc');
    const stage = wrap.querySelector('.deposit-roulette-stage');
    if (!disc || !stage) return;
    disc.style.transition = 'none';
    disc.style.transform = 'rotate(0deg)';
    void disc.offsetHeight;
    disc.style.transition = '';
    if (!depositWheelValues.length) {
      disc.innerHTML = '';
      disc.style.background = 'linear-gradient(180deg, rgba(14,22,38,0.95), rgba(8,14,24,0.98))';
      stage.classList.add('deposit-roulette-stage--empty');
      return;
    }
    stage.classList.remove('deposit-roulette-stage--empty');
    const c0 = 'rgba(38,62,98,0.97)';
    const c1 = 'rgba(16,28,48,0.99)';
    /* 0° = haut (12h), sens horaire — aligné sur rotate(i*36+18) des labels (pas de from -90deg). */
    let gradient = 'conic-gradient(from 0deg';
    for (let i = 0; i < 10; i += 1) {
      gradient += `, ${i % 2 === 0 ? c0 : c1} ${i * 36}deg ${(i + 1) * 36}deg`;
    }
    gradient += ')';
    disc.style.background = gradient;
    const labels = document.createElement('div');
    labels.className = 'deposit-roulette-labels';
    const r = 118;
    for (let i = 0; i < 10; i += 1) {
      const v = Number(depositWheelValues[i] || 0);
      const txt = v > 0 ? depositWheelDisplay(v) : '—';
      const ang = i * 36 + 18;
      const el = document.createElement('div');
      el.className = 'deposit-roulette-slice-txt';
      el.style.transform = `rotate(${ang}deg) translateY(-${r}px)`;
      const span = document.createElement('span');
      span.textContent = txt;
      span.style.transform = `rotate(${-ang}deg)`;
      el.appendChild(span);
      labels.appendChild(el);
    }
    disc.innerHTML = '';
    disc.appendChild(labels);
  });
}
function depositWheelGenerate() {
  const minEl = document.getElementById('dep-min');
  const maxEl = document.getElementById('dep-max');
  const min = Math.max(0.01, Number(minEl?.value || 0));
  const max = Math.max(0.01, Number(maxEl?.value || 0));
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) {
    showToast('Plage invalide (max > min)', 'error');
    return;
  }
  depositWheelValues = depositWheelStratifiedEndingInts(min, max);
  if (!depositWheelValues.length) {
    const t = depositWheelTier(max);
    const hint =
      t === 'small'
        ? 'Aucun entier se terminant par 0 ou 5 dans cette plage. Élargis min/max.'
        : t === 'med'
          ? 'Aucun multiple de 10 dans cette plage. Élargis min/max.'
          : 'Aucun montant …00/25/50/75 dans cette plage. Élargis min/max.';
    showToast(hint, 'error');
    return;
  }
  depositWheelSelected = -1;
  depositWheelRender();
  depositWheelSyncRouletteVisual();
  depositWheelSetResult('Roue générée. Lance pour tirer une case.');
}
function depositWheelSpin() {
  const pairs = [];
  document.querySelectorAll('.deposit-wheel-wrap').forEach((wrap) => {
    const disc = wrap.querySelector('.deposit-roulette-disc');
    const stage = wrap.querySelector('.deposit-roulette-stage');
    if (disc && stage) pairs.push({ disc, stage });
  });
  if (!depositWheelValues.length) {
    depositWheelGenerate();
    if (!depositWheelValues.length) return;
  }
  if (depositWheelSpinning) return;
  if (!pairs.length) {
    const idx0 = Math.floor(Math.random() * 10);
    depositWheelSelected = idx0;
    depositWheelRender();
    const value0 = Number(depositWheelValues[idx0] || 0);
    depositWheelSetResult(`Case tirée: ${depositWheelDisplay(value0)}. « Go dépôt » ouvre Gamdom, ou relance la roue.`);
    playGameSfx('roulette', 'start');
    return;
  }
  const idx = Math.floor(Math.random() * 10);
  const seg = 36;
  const jitter = (Math.random() - 0.5) * 14;
  const centerDeg = idx * seg + seg / 2 + jitter;
  const currentRem = ((depositWheelSpinRotation % 360) + 360) % 360;
  const targetRem = ((-centerDeg % 360) + 360) % 360;
  let delta = (targetRem - currentRem + 360) % 360;
  const fullSpins = 6 + Math.floor(Math.random() * 4);
  delta += fullSpins * 360;
  if (delta < 360 * 4) delta += 360;
  depositWheelSpinning = true;
  pairs.forEach(({ stage }) => stage.classList.add('deposit-roulette-stage--spinning'));
  depositWheelSelected = -1;
  depositWheelRender();
  depositWheelSetResult('La roue tourne…');
  playGameSfx('roulette', 'start');
  const dur = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0.85 : 5.2;
  const ease = 'cubic-bezier(0.08, 0.72, 0.12, 1)';
  depositWheelSpinRotation += delta;
  pairs.forEach(({ disc }) => {
    disc.style.transition = `transform ${dur}s ${ease}`;
  });
  requestAnimationFrame(() => {
    pairs.forEach(({ disc }) => {
      disc.style.transform = `rotate(${depositWheelSpinRotation}deg)`;
    });
  });
  const leadDisc = pairs[0].disc;
  let spinFinished = false;
  let fallbackTimer = 0;
  const leadTe = (e) => {
    if (e.propertyName !== 'transform') return;
    finishSpin();
  };
  const finishSpin = () => {
    if (spinFinished) return;
    spinFinished = true;
    window.clearTimeout(fallbackTimer);
    leadDisc.removeEventListener('transitionend', leadTe);
    pairs.forEach(({ stage }) => stage.classList.remove('deposit-roulette-stage--spinning'));
    depositWheelSpinning = false;
    depositWheelSelected = idx;
    depositWheelRender();
    const value = Number(depositWheelValues[idx] || 0);
    depositWheelSetResult(`Case tirée: ${depositWheelDisplay(value)}. « Go dépôt » ouvre Gamdom, ou relance la roue.`);
  };
  leadDisc.addEventListener('transitionend', leadTe);
  fallbackTimer = window.setTimeout(finishSpin, dur * 1000 + 550);
}
function initDepositWheel() {
  depositWheelValues = [];
  depositWheelSelected = -1;
  depositWheelRender();
  depositWheelSyncRouletteVisual();
  depositWheelSetResult('Génère ta roue pour commencer.');
}