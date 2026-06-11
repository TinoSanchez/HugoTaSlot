// Slot du Dépôt — machine à sous 3 rouleaux
// Chargé lazily par scripts/pages/roue-depot.js via LAZY_PAGE_SCRIPTS dans app.js
'use strict';
/* globals fmt, showToast, getUserBalance, setUserBalance, activeHunt, state, save, bhWarn, getAuthClient, currentUser, isCloudUser, isCurrentUserAdmin, recordGameSession, queueCloudGameSession, casinoSfx */

// SLOT DU DEPOT : entiers N,00 ; règle selon le max de plage (pas de décimales dans la valeur).
// Le tirage reste 1 valeur parmi 10 ; le visuel est une machine à sous : les
// 3 rouleaux défilent puis s'arrêtent un par un sur la même valeur (jackpot).
let depositWheelValues = [];
let depositWheelSelected = -1;
let depositWheelSpinning = false;

const DEP_SLOT_CELL_H = 64;   // hauteur d'une cellule de rouleau (synchro avec le CSS)
const DEP_SLOT_REPS = 9;      // répétitions de la liste des 10 valeurs dans chaque bande

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
/** Position translateY (px) pour centrer la cellule `cellIdx` sur la payline (3 lignes visibles). */
function depSlotOffsetFor(cellIdx) {
  return -(cellIdx * DEP_SLOT_CELL_H) + DEP_SLOT_CELL_H;
}
/** Index aléatoire parmi les 10 montants (exclut optionnellement certains indices). */
function depSlotPickRandomIdx(exclude) {
  const skip = exclude instanceof Set ? exclude : new Set();
  const pool = [];
  for (let i = 0; i < depositWheelValues.length; i += 1) {
    if (!skip.has(i)) pool.push(i);
  }
  if (!pool.length) return Math.floor(Math.random() * depositWheelValues.length);
  return pool[Math.floor(Math.random() * pool.length)];
}
function depSlotAppendCell(strip, valIdx) {
  const cell = document.createElement('div');
  cell.className = 'deposit-slot-cell';
  cell.textContent = depositWheelDisplay(depositWheelValues[valIdx]);
  cell.dataset.valIdx = String(valIdx);
  strip.appendChild(cell);
}
/**
 * Construit une bande de rouleau avec symboles aléatoires.
 * Seule la cellule payline (winIdx) est fixée ; au-dessus et en dessous
 * = montants tirés au hasard, différents du gain et entre eux.
 */
function depSlotBuildRandomStrip(strip, paylineCellIdx, winIdx) {
  strip.innerHTML = '';
  const total = DEP_SLOT_REPS * 10;
  for (let c = 0; c < total; c += 1) {
    let valIdx;
    if (paylineCellIdx >= 0 && c === paylineCellIdx) {
      valIdx = winIdx;
    } else if (paylineCellIdx >= 0 && c === paylineCellIdx - 1) {
      valIdx = depSlotPickRandomIdx(new Set([winIdx]));
    } else if (paylineCellIdx >= 0 && c === paylineCellIdx + 1) {
      const above = Number(strip.children[paylineCellIdx - 1]?.dataset?.valIdx);
      const exclude = new Set([winIdx]);
      if (Number.isFinite(above)) exclude.add(above);
      valIdx = depSlotPickRandomIdx(exclude);
    } else {
      valIdx = depSlotPickRandomIdx(null);
    }
    depSlotAppendCell(strip, valIdx);
  }
}
/** Index de la cellule payline pour un rouleau (plus à droite = plus loin dans la bande). */
function depSlotPaylineCellForReel(reelIndex) {
  return (3 + reelIndex * 2) * 10 + Math.floor(Math.random() * 10);
}
/** Retire overlay jackpot, classes et marquage des cellules gagnantes. */
function depSlotClearJackpotFx(stage) {
  if (!stage) return;
  stage.classList.remove('deposit-slot-stage--win', 'deposit-slot-stage--jackpot');
  stage.querySelectorAll('.deposit-slot-cell--jackpot').forEach((c) => {
    c.classList.remove('deposit-slot-cell--jackpot');
  });
  const machine = stage.querySelector('.deposit-slot-machine');
  if (machine) machine.querySelectorAll('.deposit-slot-jp-overlay').forEach((el) => el.remove());
  const marqueeWrap = stage.querySelector('.deposit-slot-marquee');
  if (marqueeWrap) marqueeWrap.classList.remove('deposit-slot-marquee--jackpot');
  const marquee = marqueeWrap?.querySelector('span');
  if (marquee) marquee.textContent = 'DÉPÔT';
}
/** Célébration jackpot : marquee JACKPOT, flashs, étincelles, clignotement des 3 cases gagnantes. */
function depSlotPlayJackpotFx(stage, _value) {
  if (!stage) return;
  const reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  stage.classList.add('deposit-slot-stage--win');
  if (!reduced) stage.classList.add('deposit-slot-stage--jackpot');

  stage.querySelectorAll('.deposit-slot-reel').forEach((reel) => {
    const pi = Number(reel.dataset.depPayline);
    const strip = reel.querySelector('.deposit-slot-strip');
    const center = strip?.children?.[pi];
    if (center) center.classList.add('deposit-slot-cell--jackpot');
  });

  const marqueeWrap = stage.querySelector('.deposit-slot-marquee');
  const marquee = marqueeWrap?.querySelector('span');
  if (marqueeWrap) marqueeWrap.classList.add('deposit-slot-marquee--jackpot');
  if (marquee) marquee.textContent = 'JACKPOT';

  const machine = stage.querySelector('.deposit-slot-machine');
  if (machine && !reduced) {
    const sparks = [];
    for (let i = 0; i < 20; i += 1) {
      const x = (8 + Math.random() * 84).toFixed(0);
      const y = (5 + Math.random() * 90).toFixed(0);
      const d = (Math.random() * 0.55).toFixed(2);
      const s = (0.5 + Math.random() * 1.1).toFixed(2);
      sparks.push(`<span class="deposit-slot-jp-spark" style="--jx:${x}%;--jy:${y}%;--jd:${d}s;--js:${s}"></span>`);
    }
    const overlay = document.createElement('div');
    overlay.className = 'deposit-slot-jp-overlay';
    overlay.innerHTML = `
      <div class="deposit-slot-jp-flash" aria-hidden="true"></div>
      <div class="deposit-slot-jp-flash deposit-slot-jp-flash--2" aria-hidden="true"></div>
      <div class="deposit-slot-jp-ring" aria-hidden="true"></div>
      <div class="deposit-slot-jp-sparks">${sparks.join('')}</div>`;
    machine.appendChild(overlay);
    window.setTimeout(() => overlay.classList.add('deposit-slot-jp-overlay--fade'), 2200);
    window.setTimeout(() => { try { overlay.remove(); } catch (_) {} }, 3200);
  }

  if (!reduced) {
    window.setTimeout(() => stage.classList.remove('deposit-slot-stage--jackpot'), 2800);
  }
}
/** (Re)construit les 3 bandes de rouleau. Nom historique conservé : appelé par mini-jeux.js. */
function depositWheelSyncRouletteVisual() {
  depositWheelSpinning = false;
  document.querySelectorAll('.deposit-wheel-wrap').forEach((wrap) => {
    const stage = wrap.querySelector('.deposit-slot-stage');
    if (!stage) return;
    depSlotClearJackpotFx(stage);
    const hasValues = depositWheelValues.length === 10;
    stage.classList.toggle('deposit-slot-stage--empty', !hasValues);
    stage.querySelectorAll('.deposit-slot-reel').forEach((reel, r) => {
      const strip = reel.querySelector('.deposit-slot-strip');
      if (!strip) return;
      reel.classList.remove('stopped', 'spinning');
      strip.style.transition = 'none';
      strip.innerHTML = '';
      if (!hasValues) {
        for (let k = 0; k < 3; k += 1) {
          const cell = document.createElement('div');
          cell.className = 'deposit-slot-cell';
          cell.textContent = '—';
          strip.appendChild(cell);
        }
        strip.style.transform = 'translateY(0px)';
        return;
      }
      const paylineCell = 10 + ((r * 3) % 10);
      const winIdx = depositWheelSelected >= 0
        ? depositWheelSelected
        : depSlotPickRandomIdx(null);
      depSlotBuildRandomStrip(strip, paylineCell, winIdx);
      strip.style.transform = `translateY(${depSlotOffsetFor(paylineCell)}px)`;
      void strip.offsetHeight;
      strip.style.transition = '';
    });
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
  depositWheelSetResult('Machine prête. Lance les rouleaux !');
}
function depositWheelSpin() {
  if (!depositWheelValues.length) {
    depositWheelGenerate();
    if (!depositWheelValues.length) return;
  }
  if (depositWheelSpinning) return;

  const stages = [...document.querySelectorAll('.deposit-wheel-wrap .deposit-slot-stage')];
  const idx = Math.floor(Math.random() * 10);
  const value = Number(depositWheelValues[idx] || 0);

  if (!stages.length) {
    depositWheelSelected = idx;
    depositWheelRender();
    depositWheelSetResult(`Montant tiré : ${depositWheelDisplay(value)}. « Go dépôt » ouvre Gamdom, ou relance.`);
    if (typeof casinoSfx === 'function') casinoSfx('spin');
    return;
  }

  depositWheelSpinning = true;
  depositWheelSelected = -1;
  depositWheelRender();
  depositWheelSetResult('Les rouleaux tournent…');

  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Arrêts échelonnés : rouleau 1, puis 2, puis 3.
  const durations = reduced ? [0.4, 0.7, 1.0] : [1.7, 2.9, 4.2];
  const ease = 'cubic-bezier(0.16, 0.84, 0.22, 1)';

  if (typeof casinoSfx === 'function') {
    casinoSfx('spin');
    // Tics qui décélèrent jusqu'à l'arrêt du dernier rouleau.
    if (!reduced) {
      const totalMs = durations[2] * 1000 - 300;
      for (let i = 0; i < 30; i += 1) {
        const t = Math.pow(i / 30, 1.6) * totalMs;
        setTimeout(() => { if (depositWheelSpinning) casinoSfx('tick', { pitch: 1.1 - (i / 30) * 0.35 }); }, t);
      }
    }
  }

  let stopsRemaining = 0;
  const allDone = () => {
    depositWheelSpinning = false;
    depositWheelSelected = idx;
    depositWheelRender();
    stages.forEach((stage) => depSlotPlayJackpotFx(stage, value));
    depositWheelSetResult(`🎰 JACKPOT — ${depositWheelDisplay(value)} ! « Go dépôt » ouvre Gamdom, ou relance.`);
    if (typeof casinoSfx === 'function') casinoSfx('bigwin');
  };

  stages.forEach((stage) => {
    depSlotClearJackpotFx(stage);
    stage.querySelectorAll('.deposit-slot-reel').forEach((reel, r) => {
      const strip = reel.querySelector('.deposit-slot-strip');
      if (!strip) return;
      stopsRemaining += 1;
      reel.classList.add('spinning');
      reel.classList.remove('stopped');
      // Bande aléatoire : seul le centre (payline) = montant tiré ;
      // au-dessus / en dessous = symboles aléatoires distincts par rouleau.
      const paylineCell = depSlotPaylineCellForReel(r);
      reel.dataset.depPayline = String(paylineCell);
      strip.style.transition = 'none';
      depSlotBuildRandomStrip(strip, paylineCell, idx);
      const startCell = Math.max(0, paylineCell - (18 + r * 6));
      strip.style.transform = `translateY(${depSlotOffsetFor(startCell)}px)`;
      void strip.offsetHeight;
      const dur = durations[r];
      strip.style.transition = `transform ${dur}s ${ease}`;
      requestAnimationFrame(() => {
        strip.style.transform = `translateY(${depSlotOffsetFor(paylineCell)}px)`;
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
  });

  // Sécurité : si aucun rouleau trouvé dans les stages (DOM inattendu)
  if (stopsRemaining === 0) allDone();
}
function initDepositWheel() {
  depositWheelValues = [];
  depositWheelSelected = -1;
  depositWheelRender();
  depositWheelSyncRouletteVisual();
  depositWheelSetResult('Génère tes 10 montants pour commencer.');
}