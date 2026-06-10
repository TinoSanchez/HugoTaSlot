// Mini Jeux (lobby + engine + 12 jeux)
// Chargé lazily par scripts/pages/mini-jeux.js via LAZY_PAGE_SCRIPTS dans app.js
'use strict';
/* globals fmt, showToast, getUserBalance, setUserBalance, activeHunt, state, save, bhWarn, getAuthClient, currentUser, isCloudUser, isCurrentUserAdmin, recordGameSession, queueCloudGameSession */

// ─── MINI JEUX ───
const GAMES = [
  { id: 'blackjack', name: 'Black Jack', icon: './assets/icon-game-blackjack.svg', rtp: '99.5%' },
  { id: 'roulette', name: 'Roulette', icon: './assets/icon-game-roulette.svg', rtp: '97.3%' },
  { id: 'hilo', name: 'Hi-Lo', icon: './assets/icon-game-hilo.svg', rtp: '98%' },
  { id: 'dice', name: 'Dice', icon: './assets/icon-game-dice.svg', rtp: '98.5%' },
  { id: 'plinko', name: 'Plinko', icon: './assets/icon-game-plinko.svg', rtp: '97%' },
  { id: 'mines', name: 'Mines', icon: './assets/icon-game-mines.svg', rtp: '99%' },
  { id: 'limbo', name: 'Limbo', icon: './assets/icon-game-limbo.svg', rtp: '99%' },
  { id: 'keno', name: 'Keno', icon: './assets/icon-game-keno.svg', rtp: '96%' },
  { id: 'chicken', name: 'Chicken', icon: './assets/icon-game-chicken.svg', rtp: 'Var.' },
  { id: 'crash', name: 'Crash', icon: './assets/icon-game-crash.svg', rtp: '97%' },
  { id: 'pump', name: 'Pump', icon: './assets/icon-game-pump.svg', rtp: '97%' },
  { id: 'flip', name: 'Flip', icon: './assets/icon-game-flip.svg', rtp: '98%' },
];

let currentGame = null;
let gameInterval = null;
let activeGameBalanceAnchor = null;
// depositWheelValues, depositWheelSelected, depositWheelSpinRotation, depositWheelSpinning
// → déclarés dans roue-depot.js (chargé lazily quand deposit_wheel est ouvert)

function renderGamesLobby() {
  const grid = document.getElementById('games-lobby');
  if (!grid) return;
  grid.innerHTML = GAMES.map((g, i) => `
    <div class="game-card stagger-in" style="animation-delay:${i * 38}ms" onclick="openGame('${g.id}')">
      <span class="game-card-icon"><img src="${g.icon}" class="ui-logo-icon" alt="${g.name}"></span>
      <div class="game-card-name">${g.name.toUpperCase()}</div>
      <div class="game-card-rtp">RTP ${g.rtp}</div>
                    </div>
  `).join('');
}

function openGame(id) {
  if (!currentUser) {
    const guest = getGuestProfile();
    currentUser = { ...GUEST_USER, displayName: guest.displayName || GUEST_USER.username, avatar: guest.avatar || '', balance: getSafeGuestBalance(guest.balance), streak: Number(guest.streak || 0), lastClaimDay: guest.lastClaimDay ?? null };
    saveSession(currentUser);
  }
  currentGame = GAMES.find(g => g.id === id);
  if (!currentGame) return;
  activeGameBalanceAnchor = Number(getUserBalance() || 0);
  const win = document.getElementById('game-window');
  win.classList.add('da-pro');
  win.setAttribute('data-game', id);
  win.classList.remove('hidden');
  const titleEl = document.getElementById('game-window-title');
  if (titleEl) {
    if (id === 'blackjack') titleEl.textContent = 'Blackjack en Ligne — Joue au Blackjack sur HugoTaSlot';
    else if (id === 'plinko') titleEl.textContent = 'Jeu Plinko en Ligne — Joue et Gagne des Crédits';
    else titleEl.textContent = `${currentGame.name} en Ligne — Joue et Gagne des Crédits`;
  }
  updateLobbyBalance();
  loadGameUI(id);
}

function closeGame() {
  plinkoStopAutoFire();
  const gw = document.getElementById('game-window');
  gw.classList.add('hidden');
  gw.removeAttribute('data-game');
  if (gameInterval) { clearInterval(gameInterval); gameInterval = null; }
  currentGame = null;
  activeGameBalanceAnchor = null;
}

function getBet() { return Math.max(0.01, parseFloat(document.getElementById('bet-input').value) || 1); }
function handleMainBetInput() {
  if ((currentGame?.id || '') !== 'roulette') return;
  syncRouletteChipFromBetInput();
  updateRouletteUI();
}
function addBetChip(amount) {
  const input = document.getElementById('bet-input');
  if (!input) return;
  const cur = Math.max(0, parseFloat(input.value) || 0);
  input.value = (cur + amount).toFixed(2);
  casinoSfx('chip');
}
function betHalf() { document.getElementById('bet-input').value = (getBet() / 2).toFixed(2); casinoSfx('chip'); }
function betDouble() { document.getElementById('bet-input').value = Math.min(getBet() * 2, getUserBalance()).toFixed(2); casinoSfx('chip'); }
function betMax() { document.getElementById('bet-input').value = getUserBalance().toFixed(2); casinoSfx('chips'); }

const pendingStakePreviewByGame = Object.create(null);
function previewStakeDeduction(game, bet) {
  const gameKey = String(game || currentGame?.id || 'unknown');
  const stake = Math.max(0, Number(bet || 0));
  if (!gameKey || !Number.isFinite(stake) || stake <= 0) return false;
  if (!Array.isArray(pendingStakePreviewByGame[gameKey])) pendingStakePreviewByGame[gameKey] = [];
  pendingStakePreviewByGame[gameKey].push(stake);
  if (isCloudUser()) {
    currentUser.balance = Math.max(0, Number(currentUser?.balance || 0) - stake);
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
  } else {
    setUserBalance(Math.max(0, getUserBalance() - stake));
    updateLobbyBalance();
  }
  return true;
}
function consumeStakePreview(game, fallbackBet) {
  const gameKey = String(game || currentGame?.id || 'unknown');
  const queue = Array.isArray(pendingStakePreviewByGame[gameKey]) ? pendingStakePreviewByGame[gameKey] : [];
  const nextStake = Number(queue.length ? queue.shift() : 0);
  if (!queue.length) delete pendingStakePreviewByGame[gameKey];
  if (nextStake > 0) {
    return { hadPreview: true, stake: nextStake };
  }
  return { hadPreview: false, stake: Math.max(0, Number(fallbackBet || 0)) };
}
function resolveSettlementGameId(preferredGameId, bet) {
  const preferred = String(preferredGameId || '');
  const hasPreferredQueue = preferred && Array.isArray(pendingStakePreviewByGame[preferred]) && pendingStakePreviewByGame[preferred].length > 0;
  if (hasPreferredQueue) return preferred;
  const activeKeys = Object.keys(pendingStakePreviewByGame).filter((k) => Array.isArray(pendingStakePreviewByGame[k]) && pendingStakePreviewByGame[k].length > 0);
  if (!activeKeys.length) return preferred || 'unknown';
  const targetBet = Math.max(0, Number(bet || 0));
  const byStakeMatch = activeKeys.find((k) => {
    const first = Number((pendingStakePreviewByGame[k] || [])[0] || 0);
    return Math.abs(first - targetBet) < 0.0001;
  });
  if (byStakeMatch) return byStakeMatch;
  if (activeKeys.length === 1) return activeKeys[0];
  return preferred || activeKeys[0] || 'unknown';
}

function winGame(bet, multiplier) {
  const gameId = resolveSettlementGameId(currentGame?.id || 'unknown', bet);
  const stakeState = consumeStakePreview(gameId, bet);
  const stake = stakeState.stake;
  const prize = Number(bet || 0) * Number(multiplier || 0);
  trackPlayerGameStats(String(gameId), stake, prize);
  if (isCloudUser()) {
    const optimisticDelta = stakeState.hadPreview ? prize : (prize - stake);
    currentUser.balance = Math.max(0, Number(currentUser?.balance || 0) + optimisticDelta);
    saveSession(currentUser);
    updateLobbyBalance();
    renderProfileBadge();
    queueCloudGameSession(gameId, stake, prize)
      .catch((e) => {
        pushRuntimeLog('warn', `win_game_settlement_failed: ${String(e?.message || e || 'unknown')}`);
        showCloudValidationToastThrottled();
        scheduleCloudBalanceSync(120);
      })
      .finally(() => {
        updateLobbyBalance();
        renderProfileBadge();
      });
  } else {
    setUserBalance(stakeState.hadPreview ? (getUserBalance() + prize) : (getUserBalance() - stake + prize));
  }
  updateLobbyBalance();
  // Feedback casino : son + célébration visuelle proportionnels au gain
  const m = Number(multiplier || 0);
  if (m >= 10 || prize >= 100) casinoSfx('bigwin');
  else if (m > 1.01) casinoSfx('win');
  else if (prize > 0) casinoSfx('coin');
  if (typeof gameWinFx === 'function' && m > 1.01) gameWinFx(prize, m);
  return prize;
}
function loseGame(bet, sfxType) {
  const gameId = resolveSettlementGameId(currentGame?.id || 'unknown', bet);
  const stakeState = consumeStakePreview(gameId, bet);
  const stake = stakeState.stake;
  trackPlayerGameStats(String(gameId), stake, 0);
  if (isCloudUser()) {
    queueCloudGameSession(gameId, stake, 0)
      .catch((e) => {
        pushRuntimeLog('warn', `lose_game_settlement_failed: ${String(e?.message || e || 'unknown')}`);
        showCloudValidationToastThrottled();
      })
      .finally(() => {
        updateLobbyBalance();
        renderProfileBadge();
      });
  } else {
    if (!stakeState.hadPreview) setUserBalance(getUserBalance() - stake);
  }
  updateLobbyBalance();
  casinoSfx(sfxType || 'lose');
}

function playGame() {
  if (!currentGame) return;
  loadGamePlay(currentGame.id).catch((e) => {
    pushRuntimeLog('warn', `play_game_failed:${String(e?.message || e || 'unknown')}`);
    showCloudValidationToastThrottled();
  });
}

function renderGameControls(id) {
  const ctrl = document.getElementById('game-controls');
  if (!ctrl) return;
  const playText = id === 'blackjack' ? 'Lancer une partie' : 'Lancer une partie';
  ctrl.innerHTML = `
    <div class="gc-block">
      <div class="gc-title">Balance disponible</div>
      <div class="gc-value small"><span id="game-controls-balance">${fmtVirtual(getUserBalance())}</span></div>
    </div>
    <div class="gc-block">
      <div class="gc-title">Montant du pari</div>
      <div class="gc-row">
        <input type="number" class="bet-input" id="bet-input" value="1" min="0.01" step="0.01" oninput="handleMainBetInput()">
        <button class="bet-btn bet-quick-btn" onclick="betHalf()">1/2</button>
        <button class="bet-btn bet-quick-btn" onclick="betDouble()">2x</button>
      </div>
    </div>
    <div class="gc-block" id="rou-total-side" style="display:${id === 'roulette' ? 'block' : 'none'};">
      <div class="gc-title">Cases jouées</div>
      <div class="gc-value small"><span id="roulette-played-count">0</span></div>
    </div>
    <button class="play-btn" id="main-play-btn" type="button" ${id === 'plinko' ? `onmousedown="plinkoPressStart(event)" onmouseup="plinkoPressEnd()" onmouseleave="plinkoPressEnd()" ontouchstart="plinkoPressStart(event)" ontouchend="plinkoPressEnd()" ontouchcancel="plinkoPressEnd()" onclick="plinkoPressClick(event)"` : 'onclick="playGame()"'}>${playText}</button>
    <div class="gc-block" id="bj-actions-side" style="display:${id === 'blackjack' ? 'block' : 'none'};">
      <div class="gc-title">Actions</div>
      <div class="gc-actions-grid">
        <button class="bet-btn gc-action-btn" id="bj-side-hit" onclick="miniBjHit()" disabled>Tirer</button>
        <button class="bet-btn gc-action-btn" id="bj-side-stand" onclick="miniBjStand()" disabled>Rester</button>
        <button class="bet-btn gc-action-btn" id="bj-side-split" disabled>Diviser</button>
        <button class="bet-btn gc-action-btn" id="bj-side-double" disabled>Doubler</button>
      </div>
    </div>
    <div class="gc-block" id="bj-sidebets-side" style="display:${id === 'blackjack' ? 'block' : 'none'};">
      <div class="gc-title">Side Bets</div>
      <div class="gc-row" style="margin-bottom:8px;">
        <input type="number" class="bet-input" id="mini-bj-side-pairs" min="0" step="0.01" value="0" placeholder="Perfect Pairs">
        <button class="bet-btn side-chip-btn" onclick="placeBjSideChip('pairs')">Jeton +</button>
      </div>
      <div class="gc-row">
        <input type="number" class="bet-input" id="mini-bj-side-21p3" min="0" step="0.01" value="0" placeholder="21+3">
        <button class="bet-btn side-chip-btn" onclick="placeBjSideChip('21p3')">Jeton +</button>
      </div>
    </div>
  `;
}

function loadGameUI(id) {
  if (id !== 'plinko') plinkoStopAutoFire();
  const body = document.getElementById('game-window-body');
  const ctrl = document.getElementById('game-controls');
  ctrl.style.display = 'flex';
  renderGameControls(id);

  const UIs = {
    blackjack: `<div class="antho-bj-stage">
      <button class="antho-bj-reset" onclick="loadGameUI('blackjack')" title="Reset">↻</button>
      <div class="mini-bj-result" id="mini-bj-result">Clique Lancer une partie</div>
      <div class="mini-bj-side-badge" id="mini-bj-side-badge"></div>
      <div class="antho-bj-table">
        <div class="antho-bj-seat">
          <div class="antho-bj-pill"><strong>Dealer</strong> <span class="score" id="antho-dealer-score">0</span></div>
          <div class="antho-bj-cards mini-bj-cards" id="mini-bj-dealer-cards"></div>
          <div class="mini-bj-total" id="mini-bj-dealer-total" style="display:none;">0</div>
        </div>
        <div class="antho-bj-divider"></div>
        <div class="antho-bj-seat">
          <div class="antho-bj-pill"><strong>${escapeHtml(currentUser?.displayName || currentUser?.username || 'Joueur')}</strong> <span class="score" id="antho-player-score">0</span></div>
          <div class="antho-bj-cards mini-bj-cards" id="mini-bj-player-cards"></div>
          <div class="mini-bj-total" id="mini-bj-player-total" style="display:none;">0</div>
        </div>
      </div>
      <button id="mini-bj-hit" style="display:none;" onclick="miniBjHit()"></button>
      <button id="mini-bj-stand" style="display:none;" onclick="miniBjStand()"></button>
      <div id="bj-betting-phase" style="display:none;">FAITES VOS JEUX</div>
      <div id="mini-bj-dealer-say" style="display:none;">Bienvenue</div>
      <div id="mini-bj-history" style="display:none;"></div>
      <div id="bj-chip-rack" style="display:none;"></div>
      <button id="bj-undo-chip-btn" style="display:none;"></button>
      <div id="bj-spot-main" style="display:none;">0</div>
      <div id="bj-spot-pairs" style="display:none;">0</div>
      <div id="bj-spot-21p3" style="display:none;">0</div>
      <div id="bj-stack-main" style="display:none;"></div>
      <div id="bj-stack-pairs" style="display:none;"></div>
      <div id="bj-stack-21p3" style="display:none;"></div>
    </div>`,

    dice: `<div style="text-align:center;">
      <div class="dice-display" id="dice-face">
        <div class="dice-cube face-1" id="dice-cube">
          <div class="dice-side side-1"><span class="pip p5 on"></span></div>
          <div class="dice-side side-2"><span class="pip p1 on"></span><span class="pip p9 on"></span></div>
          <div class="dice-side side-3"><span class="pip p1 on"></span><span class="pip p5 on"></span><span class="pip p9 on"></span></div>
          <div class="dice-side side-4"><span class="pip p1 on"></span><span class="pip p3 on"></span><span class="pip p7 on"></span><span class="pip p9 on"></span></div>
          <div class="dice-side side-5"><span class="pip p1 on"></span><span class="pip p3 on"></span><span class="pip p5 on"></span><span class="pip p7 on"></span><span class="pip p9 on"></span></div>
          <div class="dice-side side-6"><span class="pip p1 on"></span><span class="pip p3 on"></span><span class="pip p4 on"></span><span class="pip p6 on"></span><span class="pip p7 on"></span><span class="pip p9 on"></span></div>
        </div>
      </div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text-dim);margin-bottom:12px;">PRÉDIS LE RÉSULTAT</div>
      <div style="display:flex;gap:10px;justify-content:center;">
        <button class="bet-btn active" id="dice-low" onclick="dicePlayChoice('low')" style="border-color:var(--blue);color:var(--blue);">BAS (1-3)</button>
        <button class="bet-btn" id="dice-high" onclick="dicePlayChoice('high')" style="">HAUT (4-6)</button>
      </div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:12px;color:var(--text-dim);margin-top:10px;" id="dice-mult">Multiplicateur: ×1.00</div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:22px;color:var(--gold);margin-top:16px;" id="dice-result">—</div></div>`,
    
    flip: `<div class="flip-wrap"><div class="flip-coin show-face" id="flip-coin">
      <div class="flip-coin-face face"><div class="flip-coin-logo site" aria-label="logo site"></div></div>
      <div class="flip-coin-face pile"><div class="flip-coin-logo coin" aria-label="logo coin"></div></div>
    </div>
      <div style="display:flex;gap:12px;justify-content:center;margin-bottom:12px;" class="hilo-btns">
        <button class="hilo-btn higher" id="flip-heads" onclick="flipPlay('heads')">FACE</button>
        <button class="hilo-btn lower" id="flip-tails" onclick="flipPlay('tails')">PILE</button>
                </div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:12px;color:var(--text-dim);margin-top:-4px;margin-bottom:8px;" id="flip-mult">Multiplicateur: ×1.00 | Prochain: ×1.00</div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:22px;color:var(--gold);" id="flip-result">—</div></div>`,

    limbo: `<div style="text-align:center;width:100%;max-width:400px;">
      <div class="limbo-display" id="limbo-val">1.00×</div>
      <div style="margin:16px 0;display:flex;gap:8px;align-items:center;justify-content:center;">
        <span class="bet-label">OBJECTIF ×</span>
        <input type="number" class="bj-input" id="limbo-target" value="2" min="1.01" step="0.01" style="width:80px;">
        <select class="bj-input" id="limbo-speed" style="width:100px;height:40px;font-size:12px;">
          <option value="fast">Rapide</option>
          <option value="normal" selected>Normal</option>
          <option value="slow">Lent</option>
        </select>
      </div>
      <div class="limbo-scene" id="limbo-scene">
        <div class="limbo-cloud"></div>
        <div class="limbo-hills-far"></div>
        <div class="limbo-hills-near"></div>
        <div class="limbo-bird"><img class="limbo-sprite" src="./assets/limbo-bird.svg" alt="bird"></div>
        <div class="limbo-plane"><img class="limbo-sprite" src="./assets/limbo-plane.svg" alt="plane"></div>
        <div class="limbo-meteor"><img class="limbo-sprite" src="./assets/limbo-meteor.svg" alt="meteor"></div>
        <div class="limbo-boom"><img class="limbo-sprite" src="./assets/limbo-explosion.svg" alt="explosion"></div>
        <div class="limbo-thunder"><img class="limbo-sprite" src="./assets/limbo-lightning.svg" alt="lightning"></div>
      </div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:18px;color:var(--text-dim);margin-top:12px;" id="limbo-result">Clique sur Lancer une partie</div>
    </div>`,

    crash: `<div class="crash-wrap">
      <div class="crash-multiplier" id="crash-mult">1.00×</div>
      <div class="crash-graph" id="crash-graph"><div class="crash-skyline"></div><div class="crash-line" id="crash-line"></div><div class="crash-trail" id="crash-trail"></div><div class="crash-rocket" id="crash-rocket"></div></div>
      <div class="crash-controls">
        <span class="bet-label" style="font-size:11px;">AUTO CASHOUT</span>
        <input class="bj-input" id="crash-auto" type="number" min="1.01" step="0.01" value="2.00" />
      </div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text-dim);" id="crash-status">En attente du prochain lancement...</div>
      <div class="crash-history" id="crash-history"></div>
      </div>`,

    mines: `<div style="text-align:center;"><div style="margin-bottom:14px;display:flex;gap:10px;align-items:center;justify-content:center;flex-wrap:wrap;">
        <span class="bet-label" style="font-size:12px;">MINES (1–24)</span>
        <input type="number" class="bj-input" id="mines-count" min="1" max="24" step="1" value="3" title="Nombre de mines sur la grille 5×5"
          style="width:88px;height:46px;font-size:18px;text-align:center;" />
            </div>
      <div class="mines-grid" id="mines-grid" style="grid-template-columns:repeat(5,1fr);"></div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:28px;color:var(--gold);margin-top:14px;" id="mines-mult">×1.00</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:11px;color:var(--text-dim);margin-top:8px;" id="mines-result">Clique sur Lancer une partie</div>
      <button class="bet-btn" id="mines-cashout" onclick="minesCashout()" style="margin-top:10px;display:none;border-color:var(--green);color:var(--green);height:48px;padding:0 18px;font-size:14px;">ENCAISSER</button>
      </div>`,

    keno: `<div style="text-align:center;width:100%;"><div style="margin-bottom:12px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);">CHOISIS 1 À 10 NUMÉROS</div>
      <div class="keno-grid" id="keno-grid"></div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:18px;color:var(--gold);margin-top:12px;" id="keno-result">—</div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:10px;">
        <button class="bet-btn" onclick="replayKenoSelection()">REJOUER NUMÉROS</button>
        <button class="bet-btn" onclick="clearKenoBoard()">VIDER LE TABLEAU</button>
      </div></div>`,

    chicken: `<div class="chicken-road-wrap" style="text-align:center;">
      <div style="margin-bottom:12px;font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);">8 rangées · risque exponentiel · mult 1000^(k/8) · traversée complète exactement 0,01 %</div>
      <div class="chicken-road" id="chicken-road"></div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:12px;color:var(--text-dim);margin-top:10px;" id="chicken-mult">Multiplicateur: ×1.00</div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:20px;color:var(--gold);margin-top:8px;" id="chicken-result">Clique sur Lancer une partie</div>
      <div style="display:flex;justify-content:center;gap:10px;margin-top:10px;">
        <button class="bet-btn" id="chicken-step-btn" onclick="chickenStep()" style="border-color:var(--blue);color:var(--blue);">AVANCER</button>
      </div>
    </div>`,

    hilo: `<div style="text-align:center;"><div class="hilo-card black" id="hilo-card">
      <span class="hilo-rank-corner top">A♠</span>
      <span class="hilo-center"><span class="hilo-center-rank">A</span><span class="hilo-center-suit">♠</span></span>
      <span class="hilo-rank-corner bottom">A♠</span>
    </div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:20px;color:var(--gold);margin:12px 0;" id="hilo-val">?</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:12px;color:var(--text-dim);margin-top:-4px;margin-bottom:10px;" id="hilo-mult">Multiplicateur: ×1.00</div>
      <div class="hilo-btns">
        <button class="hilo-btn higher" onclick="hiloPlay('higher')">PLUS HAUT</button>
        <button class="hilo-btn lower" onclick="hiloPlay('lower')">PLUS BAS</button>
        </div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:18px;color:var(--text-dim);margin-top:12px;" id="hilo-result">—</div></div>`,

    roulette: `<div class="roulette-layout antho-roulette-stage">
      <div class="roulette-phase" id="rou-phase">FAITES VOS JEUX</div>
      <div class="roulette-result" id="rou-result">—</div>
      <div class="antho-roulette-main">
        <div class="roulette-wheel-wrap">
          <div class="roulette-wheel" id="roulette-wheel"><div class="roulette-wheel-numbers" id="roulette-wheel-numbers"></div></div>
          <div class="roulette-ball-orbit"><div class="roulette-ball" id="roulette-ball"></div></div>
        </div>
        <div class="antho-roulette-board">
          <div class="roulette-bet-grid">
            <div class="roulette-zero" data-rou-key="num:0">0</div>
            <div class="roulette-numbers" id="roulette-numbers"></div>
            <div class="roulette-columns">
              <div class="roulette-colbet" data-rou-key="column:3">2 TO 1</div>
              <div class="roulette-colbet" data-rou-key="column:2">2 TO 1</div>
              <div class="roulette-colbet" data-rou-key="column:1">2 TO 1</div>
            </div>
          </div>
          <div class="roulette-outside" id="roulette-outside">
            <div class="roulette-out dozen" data-rou-key="dozen:1">1e 12</div>
            <div class="roulette-out dozen" data-rou-key="dozen:2">2e 12</div>
            <div class="roulette-out dozen" data-rou-key="dozen:3">3e 12</div>
            <div class="roulette-out low" data-rou-key="range:low">1-18</div>
            <div class="roulette-out high" data-rou-key="range:high">19-36</div>
            <div class="roulette-out simple" data-rou-key="parity:even">PAIR</div>
            <div class="roulette-out simple red" data-rou-key="color:red">ROUGE</div>
            <div class="roulette-out simple black" data-rou-key="color:black">NOIR</div>
            <div class="roulette-out simple" data-rou-key="parity:odd">IMPAIR</div>
          </div>
          <div class="roulette-advanced" id="roulette-advanced">
            <div class="roulette-adv-title">MISES SUR 2 OU 4 NUMÉROS</div>
            <div class="roulette-adv-row">
              <span class="roulette-adv-label">Cheval · 2 cases (17:1)</span>
              <input type="number" class="roulette-adv-input" id="rou-split-a" min="1" max="36" step="1" placeholder="n°" title="Premier numéro (1–36)" />
              <input type="number" class="roulette-adv-input" id="rou-split-b" min="1" max="36" step="1" placeholder="n°" title="Second numéro adjacent" />
              <button type="button" class="bet-btn roulette-adv-btn" onclick="roulettePlaceSplit()">Miser cheval</button>
            </div>
            <div class="roulette-adv-hint">Voisins sur le tapis : même colonne (écart 3, ex. 5–8) ou même ligne entre colonnes (écart 1, ex. 8–9).</div>
            <div class="roulette-adv-row">
              <span class="roulette-adv-label">Carré · 4 cases (8:1)</span>
              <input type="number" class="roulette-adv-input" id="rou-corner-start" min="1" max="32" step="1" placeholder="coin" title="Numéro coin bas-gauche du carré (pas 3, 6, 9…)" />
              <button type="button" class="bet-btn roulette-adv-btn" onclick="roulettePlaceCorner()">Miser carré</button>
            </div>
            <div class="roulette-adv-hint">Indique le numéro en bas à gauche du bloc de 4 (ex. 1 → 1-2-4-5). Les cases 3, 6, 9… ne peuvent pas servir de coin.</div>
          </div>
        </div>
      </div>
      <div class="mini-bj-actions">
        <button class="bet-btn" onclick="rouletteUndo()">ANNULER JETON</button>
        <button class="bet-btn" onclick="rouletteClear()">EFFACER MISES</button>
        <button class="bet-btn" onclick="rouletteRebet()">REBET</button>
        <button class="bet-btn" onclick="clearGameHistory('roulette')">VIDER HISTORIQUE</button>
      </div>
      <div class="game-history" id="roulette-history"></div>
    </div>`,

    deposit_wheel: `<div class="deposit-wheel-wrap">
      <div style="font-family:'Rajdhani',sans-serif;font-size:20px;color:var(--gold);text-align:center;">LA ROUE DU DÉPÔT</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);text-align:center;">Selon le max : 0/5 · mult. 10 · ou …00/25/50/75 · case 1=min, 10=max.</div>
      <div style="display:flex;gap:8px;justify-content:center;align-items:center;flex-wrap:wrap;">
        <input type="number" class="bj-input" id="dep-min" value="0.20" min="0.01" step="0.01" style="width:110px;" placeholder="Min">
        <input type="number" class="bj-input" id="dep-max" value="2.00" min="0.02" step="0.01" style="width:110px;" placeholder="Max">
        <button class="bet-btn" onclick="depositWheelGenerate()">Générer 10 cases</button>
      </div>
      <div class="deposit-wheel-grid" id="deposit-wheel-grid">
        <div class="deposit-wheel-cell" id="dep-cell-1">—</div>
        <div class="deposit-wheel-cell" id="dep-cell-2">—</div>
        <div class="deposit-wheel-cell" id="dep-cell-3">—</div>
        <div class="deposit-wheel-cell" id="dep-cell-4">—</div>
        <div class="deposit-wheel-cell" id="dep-cell-5">—</div>
        <div class="deposit-wheel-cell" id="dep-cell-6">—</div>
        <div class="deposit-wheel-cell" id="dep-cell-7">—</div>
        <div class="deposit-wheel-cell" id="dep-cell-8">—</div>
        <div class="deposit-wheel-cell" id="dep-cell-9">—</div>
        <div class="deposit-wheel-cell" id="dep-cell-10">—</div>
      </div>
      <div class="deposit-roulette-stage deposit-roulette-stage--empty">
        <div class="deposit-roulette-hub">
          <div class="deposit-roulette-pointer" aria-hidden="true"></div>
          <div class="deposit-roulette-disc-wrap">
            <div class="deposit-roulette-glow" aria-hidden="true"></div>
            <div class="deposit-roulette-ring deposit-roulette-ring--outer" aria-hidden="true"></div>
            <div class="deposit-roulette-ring deposit-roulette-ring--inner" aria-hidden="true"></div>
            <div class="deposit-roulette-particles" aria-hidden="true">
              <span style="--sx: 64px; --sy: -52px;"></span>
              <span style="--sx: -60px; --sy: -48px;"></span>
              <span style="--sx: 72px; --sy: 28px;"></span>
              <span style="--sx: -68px; --sy: 36px;"></span>
              <span style="--sx: 8px; --sy: -78px;"></span>
              <span style="--sx: -12px; --sy: 74px;"></span>
              <span style="--sx: 52px; --sy: 56px;"></span>
              <span style="--sx: -44px; --sy: -62px;"></span>
            </div>
            <div class="deposit-roulette-disc"></div>
            <div class="deposit-roulette-center-cap">DÉPÔT</div>
          </div>
        </div>
      </div>
      <div style="display:flex;justify-content:center;gap:8px;flex-wrap:wrap;">
        <button class="bet-btn" onclick="depositWheelSpin()" style="border-color:var(--gold);color:var(--gold);">Lancer la roue</button>
        <a class="bet-btn" href="https://gamdom.com/fr-fr/?modal=wallet&amp;tab=deposit" target="_blank" rel="noopener noreferrer" style="border-color:var(--blue);color:var(--blue);">Go dépôt</a>
      </div>
      <div class="dep-result" style="font-family:'Rajdhani',sans-serif;font-size:18px;color:var(--text-dim);text-align:center;">Génère ta roue pour commencer.</div>
    </div>`,

    plinko: `<div style="text-align:center;width:100%;">
      <div class="plinko-container" id="plinko-container"></div>
      <div style="font-family:'Rajdhani',sans-serif;font-size:22px;color:var(--gold);margin-top:12px;" id="plinko-result">—</div>
    </div>`,

    pump: `<div style="text-align:center;"><div class="pump-balloon" id="pump-balloon">PUMP</div>
      <div class="pump-multiplier" id="pump-mult">×1.00</div>
      <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);margin-top:8px;" id="pump-status">Clique GONFLER pour commencer</div>
      <div style="display:flex;gap:10px;justify-content:center;margin-top:16px;">
        <button class="bet-btn" id="pump-inflate" onclick="pumpInflate()" style="border-color:var(--gold);color:var(--gold);">GONFLER +</button>
        <button class="bet-btn" id="pump-cashout" onclick="pumpCashout()" style="border-color:var(--green);color:var(--green);display:none;">ENCAISSER</button>
      </div></div>`,
  };

  body.innerHTML = `<div class="mini-game-shell mini-game-${id}">${UIs[id] || `<div style="color:var(--text-dim);font-family:'Share Tech Mono',monospace;">Jeu en développement</div>`}</div>`;

  // Init specific game states
  if (id === 'mines') initMines();
  if (id === 'keno') initKeno();
  if (id === 'chicken') initChicken();
  if (id === 'hilo') initHilo();
  if (id === 'dice') initDice();
  if (id === 'limbo') initLimbo();
  if (id === 'plinko') initPlinkoBoard();
  if (id === 'roulette') initRouletteBoard();
  if (id === 'crash') initCrash();
  if (id === 'roulette') {
    renderGameHistory('roulette');
  }
  if (id === 'pump') { window._pumpMult = 1; window._pumpBet = 0; window._pumpActive = false; }
  if (id === 'blackjack') document.getElementById('main-play-btn').textContent = 'Lancer une partie';
  if (id === 'hilo') document.getElementById('main-play-btn').textContent = 'Lancer une partie';
  if (id === 'mines') document.getElementById('main-play-btn').textContent = 'Lancer une partie';
  if (id === 'limbo') document.getElementById('main-play-btn').textContent = 'Lancer une partie';
  if (id === 'crash') { document.getElementById('main-play-btn').textContent = 'Miser & lancer'; }
  if (id === 'dice') document.getElementById('main-play-btn').textContent = 'Lancer une partie';
  if (id === 'flip') { initFlip(); document.getElementById('main-play-btn').textContent = 'Lancer une partie'; }
  if (id === 'blackjack') initBjDragChips();
  if (id === 'blackjack') renderGameHistory('blackjack');
  if (id === 'deposit_wheel') {
    // Lazy-load roue-depot.js si pas encore chargé (le script peut venir du lobby mini-jeux
    // avant que l'utilisateur ne soit jamais allé sur /roue-depot).
    const __doInitWheel = () => {
      if (typeof depositWheelRender === 'function') depositWheelRender();
      if (typeof depositWheelSyncRouletteVisual === 'function') depositWheelSyncRouletteVisual();
    };
    if (typeof loadLazyPageScript === 'function') {
      loadLazyPageScript('roue_depot').then(__doInitWheel).catch(__doInitWheel);
    } else {
      __doInitWheel();
    }
  }
}

// DICE
let diceRoundActive = false;
let diceStake = 0;
let diceCorrectStreak = 0;
let diceMultiplier = 1;
let diceCurrentValue = 1;
let dicePred = 'low';
let diceRolling = false;
function diceNextMultiplier(streak) {
  return +Math.pow(1.45, Math.max(0, Number(streak) || 0)).toFixed(4);
}
function diceRenderFace(value) {
  diceCurrentValue = Math.max(1, Math.min(6, Number(value) || 1));
  const cube = document.getElementById('dice-cube');
  if (!cube) return;
  cube.classList.remove('face-1', 'face-2', 'face-3', 'face-4', 'face-5', 'face-6');
  cube.classList.add(`face-${diceCurrentValue}`);
}
async function diceAnimateRoll(finalValue) {
  const face = document.getElementById('dice-face');
  if (!face) {
    diceRenderFace(finalValue);
    return;
  }
  diceRolling = true;
  casinoSfx('flip');
  face.classList.remove('rolling');
  void face.offsetWidth;
  face.classList.add('rolling');
  const spins = 8 + Math.floor(Math.random() * 4);
  for (let i = 0; i < spins; i++) {
    diceRenderFace(Math.floor(Math.random() * 6) + 1);
    await gameSleep(55 + Math.floor(Math.random() * 12));
  }
  diceRenderFace(finalValue);
  await gameSleep(140);
  face.classList.remove('rolling');
  diceRolling = false;
}
function setDiceChoiceEnabled(enabled) {
  const low = document.getElementById('dice-low');
  const high = document.getElementById('dice-high');
  [low, high].forEach((btn) => {
    if (!btn) return;
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.45';
    btn.style.pointerEvents = enabled ? '' : 'none';
  });
}
function updateDiceMultiplierUI() {
  const el = document.getElementById('dice-mult');
  if (!el) return;
  const nextMultiplier = diceNextMultiplier(diceCorrectStreak + 1);
  el.textContent = `Multiplicateur: ×${diceMultiplier.toFixed(2)} | Prochain si gain: ×${nextMultiplier.toFixed(2)}`;
}
function setDicePred(pred) {
  dicePred = pred === 'high' ? 'high' : 'low';
  const low = document.getElementById('dice-low');
  const high = document.getElementById('dice-high');
  if (low) {
    low.style.borderColor = dicePred === 'low' ? 'var(--blue)' : 'var(--border)';
    low.style.color = dicePred === 'low' ? 'var(--blue)' : 'var(--text-dim)';
  }
  if (high) {
    high.style.borderColor = dicePred === 'high' ? 'var(--gold)' : 'var(--border)';
    high.style.color = dicePred === 'high' ? 'var(--gold)' : 'var(--text-dim)';
  }
}
async function dicePlayChoice(pred) {
  if (diceRolling) return;
  setDicePred(pred);
  await diceResolveChoice();
}
function initDice() {
  diceRoundActive = false;
  diceStake = 0;
  diceCorrectStreak = 0;
  diceMultiplier = 1;
  setDicePred('low');
  setDiceChoiceEnabled(false);
  diceRenderFace(Math.floor(Math.random() * 6) + 1);
  updateDiceMultiplierUI();
  const res = document.getElementById('dice-result');
  if (res) { res.textContent = 'Clique sur Lancer une partie pour démarrer'; res.style.color = 'var(--text-dim)'; }
}
function startDiceRound() {
  const bet = getBet();
  const bal = getUserBalance();
  if (bet > bal) { showToast('Solde insuffisant', 'error'); return; }
  previewStakeDeduction('dice', bet);
  diceStake = bet;
  diceCorrectStreak = 0;
  diceMultiplier = 1;
  diceRoundActive = true;
  setDiceChoiceEnabled(true);
  diceRenderFace(Math.floor(Math.random() * 6) + 1);
  updateDiceMultiplierUI();
  const res = document.getElementById('dice-result');
  if (res) { res.textContent = 'Partie lancée : prédis BAS ou HAUT'; res.style.color = 'var(--gold)'; }
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'ENCAISSER';
}
async function diceResolveChoice() {
  if (!diceRoundActive || diceRolling) { if (!diceRoundActive) showToast('Lance une partie d’abord', 'info'); return; }
  setDiceChoiceEnabled(false);
  const roll = Math.floor(Math.random() * 6) + 1;
  await diceAnimateRoll(roll);
  const win = (dicePred === 'low' && roll <= 3) || (dicePred === 'high' && roll >= 4);
  const res = document.getElementById('dice-result');
  if (win) {
    diceCorrectStreak += 1;
    diceMultiplier = diceNextMultiplier(diceCorrectStreak);
    updateDiceMultiplierUI();
    if (res) { res.textContent = `${roll} — Bon choix !`; res.style.color = 'var(--green)'; }
    setDiceChoiceEnabled(true);
  } else {
    loseGame(diceStake);
    diceRoundActive = false;
    diceMultiplier = 0;
    updateDiceMultiplierUI();
    setDiceChoiceEnabled(false);
    if (res) { res.textContent = `✗ ${roll} — Mauvais choix. Partie terminée (gain 0)`; res.style.color = 'var(--red)'; }
    const main = document.getElementById('main-play-btn');
    if (main) main.textContent = 'NOUVELLE PARTIE';
  }
}
function cashoutDiceRound() {
  if (diceRolling) return;
  if (!diceRoundActive) return startDiceRound();
  if (diceMultiplier <= 1) { showToast('Fais au moins un bon choix avant encaissement', 'info'); return; }
  const payout = diceMultiplier;
  const gain = diceStake * payout;
  winGame(diceStake, payout);
  diceRoundActive = false;
  setDiceChoiceEnabled(false);
  const res = document.getElementById('dice-result');
  if (res) { res.textContent = `Encaissé à ×${payout.toFixed(2)} — Gain ${fmtVirtual(gain)}`; res.style.color = 'var(--green)'; }
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'NOUVELLE PARTIE';
}

// FLIP (streak exponentiel)
let flipRoundActive = false;
let flipStake = 0;
let flipStreak = 0;
let flipMultiplier = 1;
let flipPred = 'heads';
function setFlipPred(pred) {
  flipPred = pred === 'tails' ? 'tails' : 'heads';
  const headsBtn = document.getElementById('flip-heads');
  const tailsBtn = document.getElementById('flip-tails');
  if (headsBtn) headsBtn.classList.toggle('active', flipPred === 'heads');
  if (tailsBtn) tailsBtn.classList.toggle('active', flipPred === 'tails');
}
function flipNextMultiplier(streak) {
  return +Math.pow(1.8, Math.max(0, Number(streak) || 0)).toFixed(4);
}
function updateFlipMultiplierUI() {
  const el = document.getElementById('flip-mult');
  const coin = document.getElementById('flip-coin');
  if (!el) return;
  const next = flipRoundActive ? flipNextMultiplier(flipStreak + 1) : 1;
  el.textContent = `Multiplicateur: ×${flipMultiplier.toFixed(2)} | Prochain: ×${next.toFixed(2)}`;
  if (coin) coin.classList.toggle('hot', flipRoundActive && flipMultiplier >= 3);
}
function setFlipChoiceEnabled(enabled) {
  const headsBtn = document.getElementById('flip-heads');
  const tailsBtn = document.getElementById('flip-tails');
  if (headsBtn) headsBtn.disabled = !enabled;
  if (tailsBtn) tailsBtn.disabled = !enabled;
}
function initFlip() {
  flipRoundActive = false;
  flipStake = 0;
  flipStreak = 0;
  flipMultiplier = 1;
  flipPred = 'heads';
  setFlipPred('heads');
  setFlipChoiceEnabled(false);
  const coin = document.getElementById('flip-coin');
  if (coin) {
    coin.classList.remove('flipping', 'show-pile');
    coin.classList.add('show-face');
    coin.style.transform = 'rotateY(0deg)';
    coin.setAttribute('data-side', 'heads');
  }
  const res = document.getElementById('flip-result');
  if (res) { res.textContent = 'Clique sur Lancer une partie'; res.style.color = 'var(--text-dim)'; }
  updateFlipMultiplierUI();
}
function startFlipRound() {
  const bet = getBet();
  if (bet > getUserBalance()) { showToast('Solde insuffisant', 'error'); return; }
  previewStakeDeduction('flip', bet);
  flipRoundActive = true;
  flipStake = bet;
  flipStreak = 0;
  flipMultiplier = 1;
  setFlipPred('heads');
  setFlipChoiceEnabled(true);
  updateFlipMultiplierUI();
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'ENCAISSER';
  const res = document.getElementById('flip-result');
  if (res) { res.textContent = 'Choisis FACE ou PILE'; res.style.color = 'var(--gold)'; }
  const coin = document.getElementById('flip-coin');
  if (coin) {
    coin.style.transform = 'rotateY(0deg)';
    coin.setAttribute('data-side', 'heads');
  }
}
async function flipPlay(pred) {
  if (!flipRoundActive) return;
  setFlipPred(pred);
  setFlipChoiceEnabled(false);
  casinoSfx('flip');
  const coin = document.getElementById('flip-coin');
  if (coin) coin.classList.add('flipping');
  await gameSleep(900);
  const result = Math.random() < 0.5 ? 'heads' : 'tails';
  if (coin) {
    coin.classList.remove('flipping');
    coin.classList.toggle('show-face', result === 'heads');
    coin.classList.toggle('show-pile', result === 'tails');
    // On fixe la rotation au repos; la face affichée dépend uniquement de data-side.
    coin.style.transform = 'rotateY(0deg)';
    coin.setAttribute('data-side', result);
  }
  const res = document.getElementById('flip-result');
  const win = flipPred === result;
  if (!win) {
    loseGame(flipStake);
    flipRoundActive = false;
    flipMultiplier = 0;
    updateFlipMultiplierUI();
    if (res) { res.textContent = `✗ ${result === 'heads' ? 'Face' : 'Pile'} — Perdu (gain 0)`; res.style.color = 'var(--red)'; }
    const main = document.getElementById('main-play-btn');
    if (main) main.textContent = 'NOUVELLE PARTIE';
    return;
  }
  flipStreak += 1;
  flipMultiplier = flipNextMultiplier(flipStreak);
  updateFlipMultiplierUI();
  if (res) { res.textContent = `✓ ${result === 'heads' ? 'Face' : 'Pile'} — Série ${flipStreak}`; res.style.color = 'var(--green)'; }
  setFlipChoiceEnabled(true);
}
function cashoutFlipRound() {
  if (!flipRoundActive) return startFlipRound();
  if (flipMultiplier <= 1) { showToast('Fais au moins un bon choix avant encaissement', 'info'); return; }
  const payout = flipMultiplier;
  const gain = flipStake * payout;
  winGame(flipStake, payout);
  flipRoundActive = false;
  setFlipChoiceEnabled(false);
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'NOUVELLE PARTIE';
  const res = document.getElementById('flip-result');
  if (res) { res.textContent = `Encaissé à ×${payout.toFixed(2)} — Gain ${fmtVirtual(gain)}`; res.style.color = 'var(--green)'; }
}

function updateCrashGraphVisual(mult) {
  const line = document.getElementById('crash-line');
  const trail = document.getElementById('crash-trail');
  const rocket = document.getElementById('crash-rocket');
  const graph = document.getElementById('crash-graph');
  if (!line || !trail || !rocket || !graph) return;
  const clamped = Math.max(1, Math.min(mult, 12));
  const linearNorm = Math.max(0, (clamped - 1) / 11);
  // Boost visuel au démarrage: plus de mouvement sur petits multiplicateurs.
  const boostedNorm = Math.pow(linearNorm, 0.62);
  const p = Math.max(4, boostedNorm * 100);
  const maxH = (graph.clientHeight || 220) - 26;
  const heightPx = Math.min(maxH, Math.max(0, boostedNorm * maxH));
  const graphW = Math.max(1, graph.clientWidth || 560);
  const xPx = (p / 100) * graphW;
  const dist = Math.sqrt((xPx * xPx) + (heightPx * heightPx));
  // En CSS, angle positif = sens horaire (vers le bas). On inverse pour monter avec la fusée.
  const ang = -Math.atan2(heightPx, xPx) * (180 / Math.PI);
  const scaleY = 1 + (clamped - 1) * 0.2;
  const hue = Math.max(6, 156 - ((clamped - 1) * 9));
  const launchFade = Math.min(1, Math.max(0, (boostedNorm - 0.015) / 0.12));
  line.style.width = `${Math.max(8, dist)}px`;
  line.style.transform = `rotate(${ang}deg) scaleY(${scaleY})`;
  line.style.background = `linear-gradient(90deg, hsl(${hue} 94% 60%), hsl(${Math.max(0, hue - 24)} 96% 56%))`;
  line.style.boxShadow = `0 0 ${12 + (clamped * 1.6)}px hsla(${Math.max(0, hue - 20)}, 96%, 56%, 0.75)`;
  line.style.opacity = `${0.12 + (launchFade * 0.88)}`;
  trail.style.width = `${Math.max(8, dist * 0.92)}px`;
  trail.style.bottom = '0px';
  trail.style.opacity = `${(Math.min(0.9, 0.18 + (clamped * 0.06))) * launchFade}`;
  trail.style.transform = `rotate(${ang}deg) scaleY(${0.85 + ((clamped - 1) * 0.08)})`;
  rocket.style.left = `${p}%`;
  rocket.style.bottom = `${heightPx}px`;
  rocket.style.transform = `translate(-50%, 50%) rotate(${Math.max(-34, -12 - (clamped * 4.5))}deg) scale(${1 + Math.min(0.5, (clamped - 1) * 0.04)})`;
  rocket.style.filter = `drop-shadow(0 0 ${8 + clamped}px hsla(${Math.max(0, hue - 24)}, 90%, 55%, 0.72))`;
}
let crashActive = false;
let crashBet = 0;
let crashMult = 1;
let crashAt = 1;
let crashAnimId = null;
let crashStartTs = 0;
const CRASH_HISTORY = [];
function crashGrowthMultiplier(elapsedMs) {
  const t = Math.max(0, elapsedMs / 1000);
  return 1 + (0.23 * t) + (0.17 * t * t) + (0.06 * t * t * t);
}
function crashRandomPoint() {
  const r = Math.min(0.9997, Math.max(0.0001, Math.random()));
  return Math.max(1.01, Math.min(60, +(0.99 / (1 - r)).toFixed(2)));
}
function crashReadAutoCashout() {
  const input = document.getElementById('crash-auto');
  const v = Number(input?.value || 0);
  if (!Number.isFinite(v) || v < 1.01) return 0;
  return +v.toFixed(2);
}
function crashRenderHistory() {
  const el = document.getElementById('crash-history');
  if (!el) return;
  el.innerHTML = CRASH_HISTORY.map((v) => `<span class="crash-pill ${v >= 2 ? 'green' : 'red'}">×${v.toFixed(2)}</span>`).join('');
}
function crashPushHistory(v) {
  CRASH_HISTORY.unshift(Math.max(1, Number(v) || 1));
  if (CRASH_HISTORY.length > 12) CRASH_HISTORY.length = 12;
  crashRenderHistory();
}
function initCrash() {
  crashActive = false;
  if (crashAnimId) { cancelAnimationFrame(crashAnimId); crashAnimId = null; }
  crashMult = 1;
  crashAt = 1;
  const disp = document.getElementById('crash-mult');
  const status = document.getElementById('crash-status');
  if (disp) { disp.className = 'crash-multiplier'; disp.textContent = '1.00×'; }
  if (status) { status.textContent = 'Prêt. Lance une manche ou encaisse en auto.'; status.style.color = 'var(--text-dim)'; }
  updateCrashGraphVisual(1);
  crashRenderHistory();
}
function crashStopAnimation() {
  if (crashAnimId) { cancelAnimationFrame(crashAnimId); crashAnimId = null; }
}
function crashLoseRound() {
  crashStopAnimation();
  if (!crashActive) return;
  crashActive = false;
  crashPushHistory(crashAt);
  const disp = document.getElementById('crash-mult');
  const status = document.getElementById('crash-status');
  if (disp) { disp.className = 'crash-multiplier crashed'; disp.textContent = `${crashAt.toFixed(2)}× KO`; }
  if (status) { status.textContent = `CRASH à ×${crashAt.toFixed(2)} — Misé: ${fmt(crashBet)} — PERDU`; status.style.color = 'var(--red)'; }
  loseGame(crashBet, 'boom');
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'RELANCER';
  showToast(`Crash à ×${crashAt.toFixed(2)}`, 'error');
}
function crashCashoutRound(isAuto = false) {
  if (!crashActive) return false;
  crashStopAnimation();
  crashActive = false;
  const payout = Math.max(1, crashMult);
  winGame(crashBet, payout);
  crashPushHistory(payout);
  const disp = document.getElementById('crash-mult');
  const status = document.getElementById('crash-status');
  if (disp) { disp.className = 'crash-multiplier won'; disp.textContent = `${payout.toFixed(2)}× WIN`; }
  if (status) {
    status.textContent = `${isAuto ? 'Auto cashout' : 'Cashout'} à ×${payout.toFixed(2)} — Gain: ${fmt(crashBet * payout)}`;
    status.style.color = 'var(--green)';
  }
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'RELANCER';
  showToast(`Encaissé ×${payout.toFixed(2)} !`, 'success');
  return true;
}
function crashTick(ts) {
  if (!crashActive) return;
  const elapsed = ts - crashStartTs;
  crashMult = +crashGrowthMultiplier(elapsed).toFixed(2);
  const disp = document.getElementById('crash-mult');
  const status = document.getElementById('crash-status');
  if (disp) disp.textContent = `${Math.min(crashMult, crashAt).toFixed(2)}×`;
  updateCrashGraphVisual(Math.min(crashMult, crashAt));
  const auto = crashReadAutoCashout();
  if (auto > 0 && crashMult >= auto && crashMult < crashAt) {
    crashCashoutRound(true);
    return;
  }
  if (crashMult >= crashAt) {
    crashLoseRound();
    return;
  }
  if (status) status.textContent = `En vol... auto: ${auto > 0 ? `×${auto.toFixed(2)}` : 'off'}`;
  crashAnimId = requestAnimationFrame(crashTick);
}
function crashStartRound() {
  if (crashActive) return;
  const bet = getBet();
  if (bet > getUserBalance()) { showToast('Solde insuffisant', 'error'); return; }
  previewStakeDeduction('crash', bet);
  crashActive = true;
  crashBet = bet;
  crashMult = 1;
  crashAt = crashRandomPoint();
  crashStartTs = performance.now();
  const disp = document.getElementById('crash-mult');
  const status = document.getElementById('crash-status');
  if (disp) { disp.className = 'crash-multiplier'; disp.textContent = '1.00×'; }
  if (status) { status.textContent = 'Décollage...'; status.style.color = 'var(--gold)'; }
  casinoSfx('rocket');
  updateCrashGraphVisual(1);
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'CASHOUT';
  crashAnimId = requestAnimationFrame(crashTick);
}
function crashMainAction() {
  if (!crashActive) return crashStartRound();
  crashCashoutRound(false);
}

const PLINKO_MULTS = [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000];
let PLINKO_GEOMETRY = null;
function plinkoMultLabel(mult) {
  return mult >= 1000 ? '1k' : String(mult);
}
function plinkoSlotTierClass(mult) {
  if (mult >= 1000) return 'tier-max';
  if (mult >= 26) return 'tier-high';
  if (mult >= 2) return 'tier-mid';
  return 'tier-low';
}
function initPlinkoBoard() {
  const wrap = document.getElementById('plinko-container');
  if (!wrap) return;
  wrap.innerHTML = '';
  const w = Math.max(260, wrap.clientWidth || 300);
  const h = Math.max(300, wrap.clientHeight || 300);
  const rows = 16;
  const topPad = 54;
  const bottomPad = 92;
  const rowYs = [];
  for (let r = 0; r < rows; r++) {
    const count = 3 + r;
    const y = topPad + (r * ((h - topPad - bottomPad) / Math.max(1, rows - 1)));
    rowYs.push(y);
    const span = Math.min(w - 20, 34 * (count - 1));
    const start = (w - span) / 2;
    for (let c = 0; c < count; c++) {
      const p = document.createElement('div');
      p.className = 'plinko-pin';
      p.style.top = `${y}px`;
      p.style.left = `${start + (c * (span / Math.max(1, count - 1)))}px`;
      wrap.appendChild(p);
    }
  }
  const slots = document.createElement('div');
  slots.className = 'plinko-slots';
  PLINKO_MULTS.forEach((m) => {
    const el = document.createElement('div');
    el.className = `plinko-slot ${plinkoSlotTierClass(m)}`;
    el.textContent = plinkoMultLabel(m);
    slots.appendChild(el);
  });
  wrap.appendChild(slots);
  PLINKO_GEOMETRY = {
    w,
    h,
    rows,
    rowYs,
    slotLeft: 10,
    slotWidth: (w - 20) / PLINKO_MULTS.length,
    endY: h - 44
  };
}
function plinkoSimulateRun(rows) {
  let rightCount = 0;
  const decisions = [];
  for (let i = 0; i < rows; i++) {
    // Rebonds indépendants gauche/droite -> distribution en cloche (centre plus fréquent).
    const goRight = Math.random() < 0.5;
    decisions.push(goRight ? 1 : -1);
    if (goRight) rightCount += 1;
  }
  return { decisions, slotIdx: rightCount };
}
function plinkoBuildPath(decisions, targetIdx) {
  const g = PLINKO_GEOMETRY;
  if (!g) return [];
  const targetX = g.slotLeft + ((targetIdx + 0.5) * g.slotWidth);
  const points = [];
  let x = g.w / 2;
  const step = g.slotWidth * 0.5;
  g.rowYs.forEach((y, i) => {
    const dir = Number(decisions?.[i]) >= 0 ? 1 : -1;
    x += dir * step;
    // Léger bruit pour garder un rendu naturel sans casser la physique globale.
    x += (Math.random() - 0.5) * g.slotWidth * 0.09;
    x = Math.max(10, Math.min(g.w - 10, x));
    points.push({ x, y });
  });
  points.push({ x: targetX, y: g.endY });
  return points;
}
async function plinkoAnimateBall(ball, points) {
  if (!ball || !points?.length) return;
  let prev = { x: PLINKO_GEOMETRY?.w ? PLINKO_GEOMETRY.w / 2 : 150, y: 10 };
  for (let i = 0; i < points.length; i++) {
    const next = points[i];
    const segmentMs = i === points.length - 1 ? 170 : 96;
    if (i > 0 && i % 2 === 0) casinoSfx('tick', { pitch: 0.8 + (i / points.length) * 0.6 });
    const segStart = performance.now();
    await new Promise((resolve) => {
      const step = (now) => {
        const t = Math.max(0, Math.min(1, (now - segStart) / segmentMs));
        const arc = Math.sin(Math.PI * t) * (i === points.length - 1 ? 2 : 5);
        const x = prev.x + ((next.x - prev.x) * t);
        const y = prev.y + ((next.y - prev.y) * t) - arc;
        ball.style.left = `${x - 8}px`;
        ball.style.top = `${y}px`;
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
    prev = next;
  }
}

let plinkoLaunchHue = 0;
function plinkoShouldRebuildBoard(wrap) {
  if (!wrap) return false;
  if (!wrap.querySelector('.plinko-slots')) return true;
  const expectW = Math.max(260, wrap.clientWidth || 300);
  if (PLINKO_GEOMETRY && Math.abs(PLINKO_GEOMETRY.w - expectW) <= 2) return false;
  if (wrap.querySelector('.plinko-ball')) return false;
  return true;
}
async function plinkoExecuteRound(bet) {
  previewStakeDeduction('plinko', bet);
  const wrap = document.getElementById('plinko-container');
  if (plinkoShouldRebuildBoard(wrap)) initPlinkoBoard();
  const run = plinkoSimulateRun(PLINKO_GEOMETRY?.rows || 16);
  const targetIdx = Math.max(0, Math.min(PLINKO_MULTS.length - 1, run.slotIdx));
  const mult = PLINKO_MULTS[targetIdx];
  const res = document.getElementById('plinko-result');
  let reachedSlot = false;
  if (wrap && PLINKO_GEOMETRY) {
    const slotEls = [...wrap.querySelectorAll('.plinko-slot')];
    const g = PLINKO_GEOMETRY;
    const ball = document.createElement('div');
    ball.className = 'plinko-ball';
    plinkoLaunchHue = (plinkoLaunchHue + 47) % 360;
    ball.style.filter = `hue-rotate(${plinkoLaunchHue}deg)`;
    const jitter = (Math.random() - 0.5) * 6;
    ball.style.left = `${((g?.w || 300) / 2) - 8 + jitter}px`;
    ball.style.top = `10px`;
    wrap.appendChild(ball);
    const path = plinkoBuildPath(run.decisions, targetIdx);
    await plinkoAnimateBall(ball, path);
    reachedSlot = true;
    if (slotEls[targetIdx]) slotEls[targetIdx].classList.add('hot');
    await gameSleep(110);
    try { ball.remove(); } catch (_) {}
  }
  if (res) res.textContent = 'En chute...';
  if (!reachedSlot) await gameSleep(120);
  const toastBurst = !!plinkoAutoFire;
  if (mult > 0) {
    winGame(bet, mult);
    const net = bet * (mult - 1);
    if (res) {
      res.textContent = `×${mult} — ${net >= 0 ? '+' : ''}${fmt(net)}`;
      res.style.color = mult >= 1 ? 'var(--green)' : 'var(--red)';
    }
    if (!toastBurst) showToast(`Plinko ×${mult}`, mult >= 1 ? 'success' : 'error');
  } else {
    loseGame(bet);
    if (res) {
      res.textContent = `×${mult} — ${fmt(-bet)}`;
      res.style.color = 'var(--red)';
    }
    if (!toastBurst) showToast(`Plinko ×${mult}`, 'error');
  }
  return true;
}
let plinkoAutoFire = null;
let plinkoBlockSynthClickUntil = 0;
let plinkoLastFingerDown = 0;
function plinkoStopAutoFire() {
  if (plinkoAutoFire) {
    clearInterval(plinkoAutoFire);
    plinkoAutoFire = null;
  }
}
function plinkoPressStart(e) {
  if (!currentGame || currentGame.id !== 'plinko') return;
  if (e && e.type === 'mousedown' && e.button !== 0) return;
  const now = performance.now();
  if (now - plinkoLastFingerDown < 40) return;
  plinkoLastFingerDown = now;
  plinkoBlockSynthClickUntil = now + 950;
  if (plinkoAutoFire) return;
  playGame();
  plinkoAutoFire = setInterval(() => {
    if (!currentGame || currentGame.id !== 'plinko') {
      plinkoStopAutoFire();
      return;
    }
    playGame();
  }, 190);
}
function plinkoPressEnd() {
  plinkoStopAutoFire();
  plinkoBlockSynthClickUntil = performance.now() + 950;
}
function plinkoPressClick(e) {
  if (!currentGame || currentGame.id !== 'plinko') return;
  if (performance.now() < plinkoBlockSynthClickUntil) {
    if (e && e.preventDefault) e.preventDefault();
    if (e && e.stopPropagation) e.stopPropagation();
    return;
  }
  playGame();
}

let miniBjState = null;
let selectedBjChip = 0.5;
let bjBetHistory = [];
let bjBettingOpen = true;
const GAME_HISTORY = { blackjack: [], roulette: [], crash: [], keno: [], mines: [], plinko: [], flip: [], dice: [], hilo: [], chicken: [], pump: [], limbo: [] };
loadGameHistoryStore();
function loadGameHistoryStore() {
  try {
    const raw = JSON.parse(localStorage.getItem(GAME_HISTORY_KEY) || '{}');
    Object.keys(GAME_HISTORY).forEach((k) => {
      const arr = Array.isArray(raw[k]) ? raw[k] : [];
      GAME_HISTORY[k] = arr.slice(0, 20).map((x) => String(x));
    });
  } catch (_) {}
}
function saveGameHistoryStore() {
  try {
    const payload = {};
    Object.keys(GAME_HISTORY).forEach((k) => { payload[k] = (GAME_HISTORY[k] || []).slice(0, 20); });
    localStorage.setItem(GAME_HISTORY_KEY, JSON.stringify(payload));
  } catch (_) {}
}
function renderGameHistory(gameId) {
  const rows = (GAME_HISTORY[gameId] || []).map((x) => String(x));
  if (gameId === 'blackjack') {
    const el = document.getElementById('mini-bj-history');
    if (el) el.innerHTML = rows.map((x) => `<div>${x}</div>`).join('');
  }
  if (gameId === 'roulette') {
    const rEl = document.getElementById('roulette-history');
    if (rEl) rEl.innerHTML = rows.map((x) => `<div>${x}</div>`).join('');
  }
}
function clearGameHistory(gameId) {
  if (!GAME_HISTORY[gameId]) return;
  GAME_HISTORY[gameId] = [];
  saveGameHistoryStore();
  renderGameHistory(gameId);
  showToast(`Historique ${gameId} vidé`, 'info', 1300);
}
function playJackpotBoost(intensity = 1) {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!uiAudioCtx) uiAudioCtx = new AC();
    if (uiAudioCtx.state === 'suspended') uiAudioCtx.resume();
    const prefs = getUiPrefs();
    if (prefs.uiMuted) return;
    const uiVolume = Math.max(0, Math.min(1, (Number(prefs.uiVolume ?? 70) / 100)));
    const gameVolume = Math.max(0, Math.min(1, (Number(prefs.uiGameVolume ?? 85) / 100)));
    const vol = uiVolume * gameVolume * Math.max(0, Math.min(1.3, Number(intensity || 1)));
    if (vol <= 0) return;
    const now = uiAudioCtx.currentTime;
    const mk = (type, f0, f1, at, dur, gainPeak) => {
      const o = uiAudioCtx.createOscillator();
      const g = uiAudioCtx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(f0, now + at);
      o.frequency.exponentialRampToValueAtTime(f1, now + at + dur);
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(gainPeak * vol, now + at + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + dur);
      o.connect(g); g.connect(uiAudioCtx.destination);
      o.start(now + at); o.stop(now + at + dur + 0.02);
    };
    mk('triangle', 320, 980, 0, 0.24, 0.045);
    mk('sine', 220, 660, 0.06, 0.2, 0.03);
    mk('triangle', 420, 1200, 0.14, 0.28, 0.038);
  } catch (_) {}
}
function pushGameHistory(gameId, text) {
  if (!GAME_HISTORY[gameId]) GAME_HISTORY[gameId] = [];
  GAME_HISTORY[gameId].unshift(`[${new Date().toLocaleTimeString('fr-FR')}] ${text}`);
  GAME_HISTORY[gameId] = GAME_HISTORY[gameId].slice(0, 20);
  saveGameHistoryStore();
  renderGameHistory(gameId);
}

// playGameSfx → déplacé dans app.js pour être disponible sans dépendre du chargement de mini-jeux.js
function setDealerTalk(msg) {
  const el = document.getElementById('mini-bj-dealer-say');
  if (el) el.textContent = msg;
}
function selectBjChip(val, btn) {
  selectedBjChip = Number(val) || 0.5;
  document.querySelectorAll('.bj-chip').forEach(x => x.classList.remove('active'));
  if (btn) btn.classList.add('active');
  casinoSfx('chip');
  refreshBjSpots();
}
function placeBjMainChip() {
  const input = document.getElementById('bet-input');
  if (!input) return;
  input.value = (Math.max(0, parseFloat(input.value) || 0) + selectedBjChip).toFixed(2);
  setDealerTalk(`Jeton principal de ${selectedBjChip} place.`);
}
function placeBjSideChip(kind) {
  const id = kind === 'pairs' ? 'mini-bj-side-pairs' : 'mini-bj-side-21p3';
  const input = document.getElementById(id);
  if (!input) return;
  input.value = (Math.max(0, parseFloat(input.value) || 0) + selectedBjChip).toFixed(2);
  setDealerTalk(`Jeton side bet ${selectedBjChip} place.`);
}
function refreshBjSpots() {
  const main = parseFloat(document.getElementById('bet-input')?.value || 0) || 0;
  const pairs = parseFloat(document.getElementById('mini-bj-side-pairs')?.value || 0) || 0;
  const p213 = parseFloat(document.getElementById('mini-bj-side-21p3')?.value || 0) || 0;
  const sMain = document.getElementById('bj-spot-main');
  const sPairs = document.getElementById('bj-spot-pairs');
  const s213 = document.getElementById('bj-spot-21p3');
  if (sMain) sMain.textContent = main.toFixed(2);
  if (sPairs) sPairs.textContent = pairs.toFixed(2);
  if (s213) s213.textContent = p213.toFixed(2);
  renderBjSpotStack('main', main);
  renderBjSpotStack('pairs', pairs);
  renderBjSpotStack('21p3', p213);
  const undoBtn = document.getElementById('bj-undo-chip-btn');
  if (undoBtn) undoBtn.disabled = !bjBettingOpen || bjBetHistory.length === 0;
}
function addToBjBet(target, amount) {
  if (!bjBettingOpen) { setDealerTalk('Jeux fermes. Attends la prochaine main.'); return; }
  const val = Math.max(0, Number(amount) || 0);
  if (val <= 0) return;
  if (target === 'main') {
    const inp = document.getElementById('bet-input');
    if (inp) inp.value = ((parseFloat(inp.value || 0) || 0) + val).toFixed(2);
  } else if (target === 'pairs') {
    const inp = document.getElementById('mini-bj-side-pairs');
    if (inp) inp.value = ((parseFloat(inp.value || 0) || 0) + val).toFixed(2);
  } else if (target === '21p3') {
    const inp = document.getElementById('mini-bj-side-21p3');
    if (inp) inp.value = ((parseFloat(inp.value || 0) || 0) + val).toFixed(2);
  }
  bjBetHistory.push({ target, amount: val });
  refreshBjSpots();
}
function setBjBettingOpen(open) {
  bjBettingOpen = !!open;
  const phase = document.getElementById('bj-betting-phase');
  if (phase) phase.textContent = bjBettingOpen ? 'FAITES VOS JEUX' : 'JEUX FERMES';
  document.querySelectorAll('#bj-chip-rack .bj-chip').forEach(el => { el.draggable = bjBettingOpen; el.style.opacity = bjBettingOpen ? '1' : '0.45'; });
  document.querySelectorAll('.bj-bet-spot[data-bet-target]').forEach(el => {
    el.style.pointerEvents = bjBettingOpen ? '' : 'none';
    el.style.opacity = bjBettingOpen ? '1' : '0.62';
  });
  const undoBtn = document.getElementById('bj-undo-chip-btn');
  if (undoBtn) undoBtn.disabled = !bjBettingOpen || bjBetHistory.length === 0;
}
function undoLastBjChip() {
  if (!bjBettingOpen) return;
  const last = bjBetHistory.pop();
  if (!last) return;
  const key = last.target;
  const id = key === 'main' ? 'bet-input' : key === 'pairs' ? 'mini-bj-side-pairs' : 'mini-bj-side-21p3';
  const inp = document.getElementById(id);
  if (inp) {
    const cur = parseFloat(inp.value || 0) || 0;
    inp.value = Math.max(0, cur - last.amount).toFixed(2);
  }
  setDealerTalk(`Dernier jeton retire (${last.amount.toFixed(2)}).`);
  refreshBjSpots();
}
function renderBjSpotStack(target, amount) {
  const el = document.getElementById(`bj-stack-${target}`);
  if (!el) return;
  const count = Math.min(12, Math.floor((amount + 0.001) / Math.max(0.5, selectedBjChip)));
  const cls = selectedBjChip >= 25 ? 'v25' : selectedBjChip >= 10 ? 'v10' : selectedBjChip >= 5 ? 'v5' : selectedBjChip >= 1 ? 'v1' : 'v05';
  el.innerHTML = Array.from({ length: count }).map(() => `<span class="bj-stack-chip ${cls}"></span>`).join('');
}
function initBjDragChips() {
  const chips = Array.from(document.querySelectorAll('#bj-chip-rack .bj-chip'));
  const spots = Array.from(document.querySelectorAll('.bj-bet-spot[data-bet-target]'));
  chips.forEach(ch => {
    ch.addEventListener('dragstart', (e) => {
      const value = ch.getAttribute('data-chip') || '0';
      e.dataTransfer.setData('text/plain', value);
      selectBjChip(parseFloat(value), ch);
    });
  });
  spots.forEach(spot => {
    const target = spot.getAttribute('data-bet-target');
    spot.addEventListener('dragover', (e) => { e.preventDefault(); spot.classList.add('drag-over'); });
    spot.addEventListener('dragleave', () => spot.classList.remove('drag-over'));
    spot.addEventListener('drop', (e) => {
      e.preventDefault();
      spot.classList.remove('drag-over');
      const value = parseFloat(e.dataTransfer.getData('text/plain') || '0');
      addToBjBet(target, value);
      setDealerTalk(`Mise ${value.toFixed(2)} acceptee sur ${target.toUpperCase()}.`);
    });
    spot.addEventListener('click', () => addToBjBet(target, selectedBjChip));
  });
  ['bet-input', 'mini-bj-side-pairs', 'mini-bj-side-21p3'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', refreshBjSpots);
  });
  bjBetHistory = [];
  setBjBettingOpen(true);
  refreshBjSpots();
}

const MINI_BJ_RANKS = ['A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const MINI_BJ_SUITS = [
  { key: 'hearts', symbol: '♥', color: 'red' },
  { key: 'diamonds', symbol: '♦', color: 'red' },
  { key: 'spades', symbol: '♠', color: 'black' },
  { key: 'clubs', symbol: '♣', color: 'black' }
];
function miniBjDraw() {
  const rank = MINI_BJ_RANKS[Math.floor(Math.random() * MINI_BJ_RANKS.length)];
  const suit = MINI_BJ_SUITS[Math.floor(Math.random() * MINI_BJ_SUITS.length)];
  return { rank, suit: suit.key, suitSymbol: suit.symbol, color: suit.color };
}
const gameSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
function miniBjCardRank(c) { return typeof c === 'string' ? c : (c?.rank || ''); }
function miniBjCardValue(c) {
  const rank = miniBjCardRank(c);
  if (rank === 'A') return 11;
  if (['K','Q','J'].includes(rank)) return 10;
  return Number(rank);
}
function miniBjCardHtml(c) {
  const rank = miniBjCardRank(c) || '?';
  const suit = typeof c === 'object' ? (c?.suitSymbol || '') : '';
  const color = typeof c === 'object' ? (c?.color || 'black') : 'black';
  return `<div class="mini-bj-card ${color}"><span class="card-rank">${rank}</span><span class="card-suit">${suit}</span></div>`;
}
function miniBjTotal(cards) {
  let total = cards.reduce((s, c) => s + miniBjCardValue(c), 0);
  let aces = cards.filter(c => miniBjCardRank(c) === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}
function miniBjRender(revealDealer = false) {
  if (!miniBjState) return;
  const dealerCardsEl = document.getElementById('mini-bj-dealer-cards');
  const playerCardsEl = document.getElementById('mini-bj-player-cards');
  const dealerTotalEl = document.getElementById('mini-bj-dealer-total');
  const playerTotalEl = document.getElementById('mini-bj-player-total');
  if (!dealerCardsEl || !playerCardsEl) return;
  dealerCardsEl.innerHTML = miniBjState.dealer.map((c, i) => {
    if (!revealDealer && i === 1 && miniBjState.inRound) return `<div class="mini-bj-card back">?</div>`;
    return miniBjCardHtml(c);
  }).join('');
  playerCardsEl.innerHTML = miniBjState.player.map(c => miniBjCardHtml(c)).join('');
  const dealerVisibleTotal = (!revealDealer && miniBjState.inRound)
    ? miniBjCardValue(miniBjState.dealer[0])
    : miniBjTotal(miniBjState.dealer);
  dealerTotalEl.textContent = `Total: ${(!revealDealer && miniBjState.inRound) ? dealerVisibleTotal + '+' : dealerVisibleTotal}`;
  playerTotalEl.textContent = `Total: ${miniBjTotal(miniBjState.player)}`;
  const anthoD = document.getElementById('antho-dealer-score');
  const anthoP = document.getElementById('antho-player-score');
  if (anthoD) anthoD.textContent = String((!revealDealer && miniBjState.inRound) ? dealerVisibleTotal : miniBjTotal(miniBjState.dealer));
  if (anthoP) anthoP.textContent = String(miniBjTotal(miniBjState.player));
}
function miniBjAnimateLatest(target = 'player') {
  const dealerCardsEl = document.getElementById('mini-bj-dealer-cards');
  const playerCardsEl = document.getElementById('mini-bj-player-cards');
  if (target === 'dealer' && dealerCardsEl && dealerCardsEl.lastElementChild) {
    dealerCardsEl.lastElementChild.classList.add('deal', 'to-dealer');
  }
  if (target === 'player' && playerCardsEl && playerCardsEl.lastElementChild) {
    playerCardsEl.lastElementChild.classList.add('deal', 'to-player');
  }
}
/**
 * @param {boolean} playerTurnActive — true = le joueur peut tirer/rester ; false = entre deux mains
 * @param {{ dealing?: boolean }} [opts] — dealing true = distribution / settlement side bets en cours : garde « Lancer » désactivé
 */
function miniBjSetControls(playerTurnActive, opts = {}) {
  const dealing = !!opts.dealing;
  const hit = document.getElementById('mini-bj-hit');
  const stand = document.getElementById('mini-bj-stand');
  const sideHit = document.getElementById('bj-side-hit');
  const sideStand = document.getElementById('bj-side-stand');
  const main = document.getElementById('main-play-btn');
  if (hit) hit.disabled = !playerTurnActive;
  if (stand) stand.disabled = !playerTurnActive;
  if (sideHit) sideHit.disabled = !playerTurnActive;
  if (sideStand) sideStand.disabled = !playerTurnActive;
  if (main) {
    const busy = playerTurnActive || dealing;
    main.disabled = busy;
    main.textContent = busy ? 'En cours...' : 'Lancer une partie';
  }
}
let miniBjSideBadgeTimer = null;
function showMiniBjSideBadge(text, kind = 'win') {
  const el = document.getElementById('mini-bj-side-badge');
  if (!el) return;
  if (miniBjSideBadgeTimer) {
    clearTimeout(miniBjSideBadgeTimer);
    miniBjSideBadgeTimer = null;
  }
  el.classList.remove('win', 'lose', 'show');
  el.textContent = text || '';
  if (!text) return;
  if (kind === 'lose') el.classList.add('lose');
  else el.classList.add('win');
  el.classList.add('show');
  miniBjSideBadgeTimer = setTimeout(() => {
    el.classList.remove('show');
  }, 2300);
}
function miniBjEndRound(bet, text, color, payoutMultiplier) {
  const res = document.getElementById('mini-bj-result');
  if (res) {
    res.textContent = text;
    res.style.color = color;
    res.classList.remove('win', 'lose', 'neutral');
    if (payoutMultiplier > 1) res.classList.add('win');
    else if (payoutMultiplier <= 0) res.classList.add('lose');
    else res.classList.add('neutral');
  }
  showMiniBjSideBadge('');
  miniBjState.inRound = false;
  miniBjRender(true);
  miniBjSetControls(false);
  setBjBettingOpen(true);
  pushGameHistory('blackjack', `${text} | Mise ${fmt(bet)} | x${Number(payoutMultiplier || 0).toFixed(2)}`);
  if (payoutMultiplier >= 2) triggerCinematicWin();
  if (payoutMultiplier > 0) {
    winGame(bet, payoutMultiplier);
  } else {
    loseGame(bet);
  }
}
async function miniBjHit() {
  if (!miniBjState || !miniBjState.inRound) return;
  setDealerTalk('Carte pour le joueur.');
  casinoSfx('card');
  miniBjState.player.push(miniBjDraw());
  miniBjRender(false);
  miniBjAnimateLatest('player');
  await gameSleep(160);
  const total = miniBjTotal(miniBjState.player);
  if (total > 21) miniBjEndRound(miniBjState.bet, 'BUST ! Tu dépasses 21.', 'var(--red)', 0);
}
async function miniBjStand() {
  if (!miniBjState || !miniBjState.inRound) return;
  setDealerTalk('Le croupier joue sa main.');
  miniBjRender(true);
  await gameSleep(220);
  while (miniBjTotal(miniBjState.dealer) < 17) {
    casinoSfx('card');
    miniBjState.dealer.push(miniBjDraw());
    miniBjRender(true);
    miniBjAnimateLatest('dealer');
    await gameSleep(240);
  }
  const p = miniBjTotal(miniBjState.player);
  const d = miniBjTotal(miniBjState.dealer);
  if (d > 21 || p > d) miniBjEndRound(miniBjState.bet, `GAGNÉ ! ${p} vs ${d}`, 'var(--green)', 2);
  else if (p === d) miniBjEndRound(miniBjState.bet, `PUSH ${p}-${d} (remboursé)`, 'var(--text-dim)', 1);
  else miniBjEndRound(miniBjState.bet, `PERDU ${p} vs ${d}`, 'var(--red)', 0);
}

async function loadGamePlay(id) {
  const nonSpamGames = { blackjack: 1, keno: 1, roulette: 1 };
  window._gameRoundLocks = window._gameRoundLocks || Object.create(null);
  const lockKey = nonSpamGames[id] ? String(id) : '';
  if (lockKey && window._gameRoundLocks[lockKey]) {
    showToast('Patiente: manche déjà en cours', 'info', 1200);
    return;
  }
  if (lockKey) window._gameRoundLocks[lockKey] = true;
  try {
  const isContinuationAction =
    (id === 'hilo' && hiloRoundActive) ||
    (id === 'dice' && diceRoundActive) ||
    (id === 'mines' && minesActive) ||
    (id === 'flip' && flipRoundActive) ||
    (id === 'crash' && crashActive) ||
    (id === 'chicken' && chickenActive) ||
    (id === 'pump' && !!window._pumpActive);
  if (!isContinuationAction) {
    const gateOk = id === 'plinko' ? canStartCloudGameRoundForPlinko(true) : canStartCloudGameRound(true);
    if (!gateOk) return;
  }
  const bet = getBet();
  const bal = getUserBalance();
  const bypassBetValidation = (id === 'hilo' && hiloRoundActive) || (id === 'dice' && diceRoundActive) || (id === 'mines' && minesActive);
  if (!bypassBetValidation) {
    if (!Number.isFinite(bet) || bet <= 0) { showToast('Mise invalide', 'error'); return; }
    if (bet > bal) { showToast('Solde insuffisant', 'error'); return; }
  }

  if (id === 'blackjack') {
    const sidePairs = Math.max(0, parseFloat(document.getElementById('mini-bj-side-pairs')?.value || 0));
    const side21p3 = Math.max(0, parseFloat(document.getElementById('mini-bj-side-21p3')?.value || 0));
    const totalCover = bet + sidePairs + side21p3;
    if (!bypassBetValidation && totalCover > bal + 1e-9) {
      showToast('Solde insuffisant pour la mise principale et les side bets', 'error');
      return;
    }
    previewStakeDeduction('blackjack', bet);
    casinoSfx('card');
    showMiniBjSideBadge('');
    miniBjState = {
      bet,
      sidePairs,
      side21p3,
      inRound: true,
      dealer: [],
      player: []
    };
    const res = document.getElementById('mini-bj-result');
    if (res) { res.textContent = 'Distribution en cours...'; res.style.color = 'var(--gold)'; }
    setDealerTalk('Rien ne va plus... distribution.');
    setBjBettingOpen(false);
    miniBjSetControls(false, { dealing: true });
    miniBjRender(false);
    await gameSleep(120);
    miniBjState.player.push(miniBjDraw()); miniBjRender(false); miniBjAnimateLatest('player'); await gameSleep(190);
    miniBjState.dealer.push(miniBjDraw()); miniBjRender(false); miniBjAnimateLatest('dealer'); await gameSleep(190);
    miniBjState.player.push(miniBjDraw()); miniBjRender(false); miniBjAnimateLatest('player'); await gameSleep(190);
    miniBjState.dealer.push(miniBjDraw()); miniBjRender(false); miniBjAnimateLatest('dealer');
    // Side bets settled after initial deal
    const p1 = miniBjState.player[0], p2 = miniBjState.player[1];
    const d1 = miniBjState.dealer[0];
    const r1 = miniBjCardRank(p1);
    const r2 = miniBjCardRank(p2);
    const rd = miniBjCardRank(d1);
    let sideWin = 0;
    if (sidePairs > 0) {
      if (r1 && r1 === r2) sideWin += sidePairs * 12;
      else sideWin -= sidePairs;
    }
    if (side21p3 > 0) {
      const vals = [r1, r2, rd].map(c => (['J','Q','K'].includes(c) ? 10 : c === 'A' ? 1 : Number(c)));
      const sum = vals[0] + vals[1] + vals[2];
      if (sum === 21) sideWin += side21p3 * 9;
      else sideWin -= side21p3;
    }
    if (sideWin !== 0) {
      await applyNetDeltaForGame('blackjack_side', sideWin);
      pushGameHistory('blackjack', `Side bets: ${sideWin >= 0 ? '+' : ''}${fmt(sideWin)}`);
      showMiniBjSideBadge(`Side Bets ${sideWin > 0 ? '+' : ''}${fmt(sideWin)}`, sideWin > 0 ? 'win' : 'lose');
    } else if (sidePairs > 0 || side21p3 > 0) {
      showMiniBjSideBadge('Side Bets 0.00', 'lose');
    }
    miniBjRender(false);
    miniBjSetControls(true);
    setDealerTalk('A toi de decider : tirer ou rester ?');
    if (res) { res.textContent = 'À toi de jouer'; res.style.color = 'var(--gold)'; }
    const p = miniBjTotal(miniBjState.player);
    const d = miniBjTotal(miniBjState.dealer);
    if (p === 21 || d === 21) {
      if (p === 21 && d === 21) miniBjEndRound(bet, 'Double Blackjack: Push', 'var(--text-dim)', 1);
      else if (p === 21) miniBjEndRound(bet, 'Blackjack !', 'var(--green)', 2.5);
      else miniBjEndRound(bet, 'Dealer Blackjack', 'var(--red)', 0);
    }
    return;
  }

  if (id === 'hilo') {
    cashoutHiloRound();
    return;
  }

  if (id === 'mines') {
    minesMainAction();
    return;
  }

  if (id === 'keno') {
    if (kenoSelected.size < 1) { showToast('Sélectionne au moins 1 numéro', 'error'); return; }
    previewStakeDeduction('keno', bet);
    const drawn = new Set();
    while (drawn.size < 10) drawn.add(Math.floor(Math.random()*40)+1);
    const drawOrder = Array.from(drawn);
    let hits = 0;
    const nums = Array.from(document.querySelectorAll('.keno-num'));
    nums.forEach(el => el.classList.remove('drawn', 'hit'));
    for (const nDraw of drawOrder) {
      let isHit = false;
      nums.forEach(el => {
        const n = parseInt(el.textContent, 10);
        if (n === nDraw) {
          el.classList.remove('drawn', 'hit');
        el.classList.add('drawn');
          if (kenoSelected.has(n)) { el.classList.add('hit'); hits++; isHit = true; }
        }
      });
      casinoSfx(isHit ? 'coin' : 'tick');
      await gameSleep(90);
    }
    nums.forEach(el => {
      const n = parseInt(el.textContent, 10);
      if (drawn.has(n)) {
        el.classList.add('drawn');
        if (kenoSelected.has(n)) el.classList.add('hit');
      }
    });
    // Gain exponentiel basé sur le nombre de hits:
    // plus il y a de bons numéros, plus la croissance accélère.
    const mult = hits <= 0 ? 0 : +(Math.pow(1.9, hits) - 1).toFixed(2);
    const res = document.getElementById('keno-result');
    if (mult > 0) {
      winGame(bet, mult);
      res.textContent = `${hits} numéros ! ×${mult} = ${fmt(bet * mult)}`;
      res.style.color = 'var(--green)';
    } else {
      loseGame(bet);
      res.textContent = `${hits} numéros. Perdu.`;
      res.style.color = 'var(--red)';
    }
    kenoLastSelection = Array.from(kenoSelected);
    kenoSelected.clear();
    document.querySelectorAll('.keno-num.selected').forEach(el => el.classList.remove('selected'));
    // Recrée une grille propre pour enchaîner une nouvelle manche.
    setTimeout(() => {
      if (currentGame && currentGame.id === 'keno') initKeno();
    }, 700);
    return;
  }

  if (id === 'chicken') {
    chickenMainAction();
    return;
  }

  if (id === 'dice') {
    cashoutDiceRound();
    return;
  }

  if (id === 'flip') { cashoutFlipRound(); return; }

  if (id === 'limbo') {
    limboMainAction();
    return;
  }

  if (id === 'crash') {
    crashMainAction();
    return;
  }

  if (id === 'roulette') {
    const rouletteAnimMs = 4800;
    casinoSfx('spin');
    const totalStake = Object.values(rouletteBets).reduce((a,b) => a + b, 0);
    if (totalStake <= 0) { showToast('Place tes mises sur le plateau', 'error'); return; }
    previewStakeDeduction('roulette', totalStake);
    setRouletteOpen(false);
    setRouletteWinningVisual(null);
    updateRouletteUI();
    const wheel = document.getElementById('roulette-wheel');
    const ball = document.getElementById('roulette-ball');
    const result_el = document.getElementById('rou-result');
    const num = Math.floor(Math.random()*37);
    const idx = ROULETTE_EURO_ORDER.indexOf(num);
    const sector = idx >= 0 ? (ROULETTE_SECTOR_DEG * idx) : (num / 37) * 360;
    const sectorCenter = sector + (ROULETTE_SECTOR_DEG / 2);
    const currentMod = ((rouletteWheelDeg % 360) + 360) % 360;
    // La bille est en bas (180deg). On tourne la roue pour amener le centre de la case gagnante sous la bille.
    const targetWheelMod = (180 - sectorCenter + 360) % 360;
    const alignDelta = (targetWheelMod - currentMod + 360) % 360;
    rouletteWheelDeg += (360 * 6) + alignDelta;
    wheel.style.transform = `rotate(${rouletteWheelDeg}deg)`;
    if (ball) {
      ball.classList.remove('spin');
      ball.style.transform = 'rotate(180deg) translateY(-126px) rotate(-180deg)';
      void ball.offsetWidth;
      ball.classList.add('spin');
    }
    result_el.textContent = 'En cours...';
    // Tics de roue qui décélèrent pendant l'animation
    for (let i = 0; i < 26; i++) {
      const t = Math.pow(i / 26, 1.7) * (rouletteAnimMs - 400);
      setTimeout(() => casinoSfx('tick', { pitch: 1 - (i / 26) * 0.3 }), t);
    }
    setTimeout(() => casinoSfx('ball'), rouletteAnimMs - 350);
    await new Promise((resolve) => {
      let done = 0;
      const need = (wheel ? 1 : 0) + (ball ? 1 : 0);
      if (!need) { resolve(); return; }
      const finish = () => { done += 1; if (done >= need) resolve(); };
      if (wheel) {
        const onWheelEnd = (ev) => {
          if (ev.propertyName !== 'transform') return;
          finish();
        };
        wheel.addEventListener('transitionend', onWheelEnd, { once: true });
      }
      if (ball) {
        ball.addEventListener('animationend', finish, { once: true });
      }
      // Fallback de sécurité si un event ne remonte pas.
      setTimeout(resolve, rouletteAnimMs + 300);
    });
    let totalReturn = 0;
    Object.entries(rouletteBets).forEach(([key, stake]) => {
      const odds = rouletteWinForKey(key, num);
      if (odds >= 0) totalReturn += stake * (odds + 1);
    });
    const profit = totalReturn - totalStake;
    if (totalReturn > 0) winGame(totalStake, totalReturn / Math.max(0.0001, totalStake));
    else loseGame(totalStake);
    rouletteLastSnapshot = { ...rouletteBets };
    const color = num===0?'var(--green)':ROULETTE_RED.has(num)?'#c0392b':'#2c3e50';
    result_el.innerHTML = `<span class="roulette-result-chip" style="background:${color};">${num}</span> ${profit>=0?`<span style="color:var(--green)">+${fmt(profit)}</span>`:`<span style="color:var(--red)">${fmt(profit)}</span>`}`;
    if (result_el) {
      result_el.classList.remove('win', 'lose');
      result_el.classList.add(profit >= 0 ? 'win' : 'lose');
    }
    setRouletteWinningVisual(num);
    const flashRouletteNumCell = (n) => {
      const el = document.querySelector(`[data-rou-key="num:${n}"]`);
      if (!el) return;
      el.classList.remove('winflash');
      void el.offsetWidth;
      el.classList.add('winflash');
      setTimeout(() => el.classList.remove('winflash'), 1150);
    };
    flashRouletteNumCell(num);
    Object.entries(rouletteBets).forEach(([key, stake]) => {
      if ((Number(stake) || 0) <= 0) return;
      if (rouletteWinForKey(key, num) < 0) return;
      if (key.startsWith('split:')) {
        key.split(':')[1].split('-').map(Number).forEach(flashRouletteNumCell);
      } else if (key.startsWith('corner:')) {
        const s = Number(key.split(':')[1]);
        [s, s + 1, s + 3, s + 4].forEach(flashRouletteNumCell);
      }
    });
    if (profit >= 0) { showToast(`${num} — Gain ${fmt(profit)}`, 'success'); }
    else { showToast(`${num} — Perte ${fmt(Math.abs(profit))}`, 'error'); }
    pushGameHistory('roulette', `${num} | ${profit >= 0 ? '+' : ''}${fmt(profit)}`);
    if (profit > totalStake * 1.5) triggerCinematicWin();
    setRouletteOpen(true);
    updateRouletteUI();
    return;
  }

  if (id === 'plinko') {
    await plinkoExecuteRound(bet);
    return;
  }

  if (id === 'pump') {
    if (!window._pumpActive) {
      window._pumpBet = bet;
      previewStakeDeduction('pump', bet);
      window._pumpMult = 1;
      window._pumpActive = true;
      const balloon = document.getElementById('pump-balloon');
      if (balloon) {
        balloon.classList.remove('ko');
        balloon.classList.remove('shake');
        balloon.textContent = 'PUMP';
        balloon.style.width = '150px';
        balloon.style.height = '150px';
        balloon.style.transform = 'scale(1)';
        balloon.style.animationDuration = '';
      }
      const pumpMultEl = document.getElementById('pump-mult');
      if (pumpMultEl) { pumpMultEl.style.fontSize = ''; pumpMultEl.textContent = '×1.00'; }
      document.getElementById('pump-cashout').style.display = '';
      document.getElementById('main-play-btn').textContent = 'NOUVEAU ROUND';
      pumpRenderVisual();
      showToast("Ballon gonflé ! Encaisse avant qu'il explose.", 'info');
    }
    return;
  }
  } finally {
    if (lockKey) window._gameRoundLocks[lockKey] = false;
  }
}

// Pump inflate/cashout
function pumpRenderVisual() {
  const balloon = document.getElementById('pump-balloon');
  const multEl = document.getElementById('pump-mult');
  if (!balloon || !multEl) return;
  const mult = Math.max(1, Number(window._pumpMult) || 1);
  const scale = Math.min(2.8, Math.pow(mult, 0.72));
  const size = Math.round(150 * scale);
  balloon.style.width = `${size}px`;
  balloon.style.height = `${size}px`;
  balloon.textContent = 'PUMP';
  // Le texte grossit en même temps que le ballon.
  multEl.style.fontSize = `${Math.min(78, 34 + (mult * 8))}px`;
  multEl.textContent = `×${mult.toFixed(2)}`;
  // Plus on pompe, plus le ballon tremble.
  const intensity = Math.max(0, mult - 1.2);
  if (intensity > 0) {
    balloon.classList.add('shake');
    const dur = Math.max(46, 120 - Math.round(intensity * 8));
    balloon.style.animationDuration = `${dur}ms`;
  } else {
    balloon.classList.remove('shake');
    balloon.style.animationDuration = '';
  }
}
function pumpInflate() {
  if (!window._pumpActive) return;
  const crashChance = 0.13 + window._pumpMult * 0.085;
  const balloon = document.getElementById('pump-balloon');
  if (Math.random() < crashChance) {
    loseGame(window._pumpBet, 'boom');
    if (balloon) { balloon.textContent = 'KO'; balloon.classList.add('ko'); balloon.classList.remove('shake'); balloon.style.animationDuration = ''; }
    document.getElementById('pump-status').textContent = `Explosé à ×${window._pumpMult.toFixed(2)} !`;
    document.getElementById('pump-mult').textContent = '×0';
    document.getElementById('pump-cashout').style.display = 'none';
    window._pumpActive = false;
    showToast(`Ballon explosé à ×${window._pumpMult.toFixed(2)} — Perdu ${fmt(window._pumpBet)}`, 'error', 3000);
  } else {
    window._pumpMult = +(window._pumpMult * (1.17 + Math.random() * 0.06)).toFixed(2);
    casinoSfx('pop', { pitch: 0.7 + Math.min(1.4, window._pumpMult * 0.12) });
    if (balloon) {
      balloon.classList.remove('ko');
    }
    pumpRenderVisual();
    document.getElementById('pump-status').textContent = `Gain potentiel: ${fmt(window._pumpBet * window._pumpMult)}`;
  }
}

async function pumpCashout() {
  if (!window._pumpActive) return;
  const prize = window._pumpBet * window._pumpMult;
  winGame(window._pumpBet, window._pumpMult);
  document.getElementById('pump-status').textContent = `Encaissé ${fmt(prize)} !`;
  document.getElementById('pump-cashout').style.display = 'none';
  const balloon = document.getElementById('pump-balloon');
  if (balloon) {
    balloon.classList.remove('ko');
    balloon.classList.remove('shake');
    balloon.textContent = 'PUMP';
    balloon.style.width = '150px';
    balloon.style.height = '150px';
    balloon.style.transform = 'scale(1)';
    balloon.style.animationDuration = '';
  }
  const pumpMultEl = document.getElementById('pump-mult');
  if (pumpMultEl) pumpMultEl.style.fontSize = '';
  window._pumpActive = false;
  showToast(`Encaissé ×${window._pumpMult.toFixed(2)} = ${fmt(prize)}`, 'success');
}

// HiLo
const HILO_CARDS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const HILO_SUITS = [
  { symbol: '♥', color: 'red' },
  { symbol: '♦', color: 'red' },
  { symbol: '♠', color: 'black' },
  { symbol: '♣', color: 'black' }
];

/** Valeur Hi‑Lo : As = 1 (le plus bas), puis 2…10, J=11, Q=12, K=13. */
function hiloCardNumericValue(card) {
  if (!card || card.rank == null) return 0;
  const r = String(card.rank);
  if (r === 'A') return 1;
  if (r === 'J') return 11;
  if (r === 'Q') return 12;
  if (r === 'K') return 13;
  const n = parseInt(r, 10);
  return Number.isFinite(n) ? n : 0;
}

let hiloCurrentCard = { rankIdx: 0, rank: '2', suit: '♠', color: 'black' };
let hiloRoundActive = false;
let hiloStake = 0;
let hiloCorrectStreak = 0;
let hiloMultiplier = 1;
function hiloDrawCard() {
  const rankIdx = Math.floor(Math.random() * HILO_CARDS.length);
  const rank = HILO_CARDS[rankIdx];
  const suit = HILO_SUITS[Math.floor(Math.random() * HILO_SUITS.length)];
  return { rankIdx, rank, suit: suit.symbol, color: suit.color };
}
function hiloRenderCard(cardData, animate = false) {
  const card = document.getElementById('hilo-card');
  if (!card || !cardData) return;
  card.classList.remove('red', 'black', 'deal');
  card.classList.add(cardData.color || 'black');
  card.innerHTML = `
    <span class="hilo-rank-corner top">${cardData.rank}${cardData.suit}</span>
    <span class="hilo-center"><span class="hilo-center-rank">${cardData.rank}</span><span class="hilo-center-suit">${cardData.suit}</span></span>
    <span class="hilo-rank-corner bottom">${cardData.rank}${cardData.suit}</span>
  `;
  if (animate) {
    void card.offsetWidth;
    card.classList.add('deal');
  }
  const val = document.getElementById('hilo-val');
  if (val) val.textContent = `${cardData.rank}${cardData.suit}`;
}
function hiloNextMultiplier(streak) {
  return +Math.pow(1.45, Math.max(0, Number(streak) || 0)).toFixed(4);
}
function setHiloChoiceEnabled(enabled) {
  document.querySelectorAll('.hilo-btns .hilo-btn').forEach(btn => {
    btn.disabled = !enabled;
    btn.style.opacity = enabled ? '1' : '0.45';
    btn.style.pointerEvents = enabled ? '' : 'none';
  });
}
function updateHiloMultiplierUI() {
  const el = document.getElementById('hilo-mult');
  if (!el) return;
  const nextMultiplier = hiloNextMultiplier(hiloCorrectStreak + 1);
  el.textContent = `Multiplicateur: ×${hiloMultiplier.toFixed(2)} | Prochain si gain: ×${nextMultiplier.toFixed(2)}`;
}
function startHiloRound() {
  const bet = getBet();
  const bal = getUserBalance();
  if (bet > bal) { showToast('Solde insuffisant', 'error'); return; }
  previewStakeDeduction('hilo', bet);
  hiloStake = bet;
  hiloCorrectStreak = 0;
  hiloMultiplier = 1;
  hiloRoundActive = true;
  hiloCurrentCard = hiloDrawCard();
  hiloRenderCard(hiloCurrentCard, true);
  updateHiloMultiplierUI();
  const res = document.getElementById('hilo-result');
  if (res) { res.textContent = 'Partie lancée : choisis PLUS HAUT ou PLUS BAS'; res.style.color = 'var(--gold)'; }
  setHiloChoiceEnabled(true);
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'ENCAISSER';
}
function endHiloRoundLost(nextCard) {
  hiloRoundActive = false;
  setHiloChoiceEnabled(false);
  loseGame(hiloStake);
  hiloMultiplier = 0;
  updateHiloMultiplierUI();
  const res = document.getElementById('hilo-result');
  if (res) {
    res.textContent = `✗ ${nextCard.rank}${nextCard.suit} — Mauvais choix. Partie terminée (gain 0)`;
    res.style.color = 'var(--red)';
  }
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'NOUVELLE PARTIE';
}
function cashoutHiloRound() {
  if (!hiloRoundActive) return startHiloRound();
  if (hiloMultiplier <= 1) { showToast('Fais au moins un bon choix avant encaissement', 'info'); return; }
  const payout = hiloMultiplier;
  const gain = hiloStake * payout;
  winGame(hiloStake, payout);
  hiloRoundActive = false;
  setHiloChoiceEnabled(false);
  const res = document.getElementById('hilo-result');
  if (res) {
    res.textContent = `Encaissé à ×${payout.toFixed(2)} — Gain ${fmtVirtual(gain)}`;
    res.style.color = 'var(--green)';
  }
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'NOUVELLE PARTIE';
}
function initHilo() {
  hiloRoundActive = false;
  hiloStake = 0;
  hiloCorrectStreak = 0;
  hiloMultiplier = 1;
  hiloCurrentCard = hiloDrawCard();
  hiloRenderCard(hiloCurrentCard, false);
  setHiloChoiceEnabled(false);
  updateHiloMultiplierUI();
  const res = document.getElementById('hilo-result');
  if (res) { res.textContent = 'Clique sur Lancer une partie pour démarrer'; res.style.color = 'var(--text-dim)'; }
}
function hiloPlay(dir) {
  if (!hiloRoundActive) { showToast('Lance une partie d’abord', 'info'); return; }
  casinoSfx('card');
  const next = hiloDrawCard();
  hiloRenderCard(next, true);
  const curV = hiloCardNumericValue(hiloCurrentCard);
  const nextV = hiloCardNumericValue(next);
  const win = (dir === 'higher' && nextV > curV) || (dir === 'lower' && nextV < curV);
  const res = document.getElementById('hilo-result');
  if (win) {
    hiloCorrectStreak += 1;
    hiloMultiplier = hiloNextMultiplier(hiloCorrectStreak);
    updateHiloMultiplierUI();
    if (res) { res.textContent = `${next.rank}${next.suit} — Bon choix !`; res.style.color='var(--green)'; }
  } else if (nextV === curV) {
    if (res) { res.textContent = 'Égalité — multiplicateur inchangé'; res.style.color='var(--text-dim)'; }
  } else {
    endHiloRoundLost(next);
  }
  hiloCurrentCard = next;
}

// Limbo (mode classique + design)
let limboRolling = false;
const LIMBO_DEATH_MODES = ['thunder', 'plane', 'meteor', 'boom'];
function getLimboTarget() {
  return Math.max(1.01, Number(document.getElementById('limbo-target')?.value || 2) || 2);
}
function getLimboSpeedPreset() {
  return String(document.getElementById('limbo-speed')?.value || 'normal').toLowerCase();
}
function setLimboScene(state, deathMode = '') {
  const scene = document.getElementById('limbo-scene');
  if (!scene) return;
  scene.classList.remove('run', 'win', 'lose', 'death-thunder', 'death-plane', 'death-meteor', 'death-boom');
  if (state) scene.classList.add(state);
  if (deathMode) scene.classList.add(`death-${deathMode}`);
}
function setLimboProgress(mult, target) {
  const scene = document.getElementById('limbo-scene');
  if (!scene) return;
  const t = Math.max(0, Math.min(1, (Number(mult) || 1) / Math.max(1.01, Number(target) || 2)));
  const x = 14 + (t * 72);
  const y = 56 - (Math.sin(t * Math.PI * 1.1) * 6);
  scene.style.setProperty('--bird-x', String(x.toFixed(2)));
  scene.style.setProperty('--bird-y', String(y.toFixed(2)));
}
function initLimbo() {
  limboRolling = false;
  const disp = document.getElementById('limbo-val');
  if (disp) { disp.className = 'limbo-display'; disp.textContent = '1.00×'; }
  const res = document.getElementById('limbo-result');
  if (res) { res.textContent = 'Clique sur Lancer une partie'; res.style.color = 'var(--text-dim)'; }
  setLimboScene(null);
  setLimboProgress(1, getLimboTarget());
}
async function limboMainAction() {
  if (limboRolling) return;
  const bet = getBet();
  const bal = getUserBalance();
  if (bet > bal) { showToast('Solde insuffisant', 'error'); return; }
  previewStakeDeduction('limbo', bet);
  limboRolling = true;
  casinoSfx('rocket');
  const target = getLimboTarget();
  const disp = document.getElementById('limbo-val');
  const res = document.getElementById('limbo-result');
  const main = document.getElementById('main-play-btn');
  if (main) main.disabled = true;
  setLimboScene('run');
  setLimboProgress(1, target);
  const crashAt = (1 / Math.random()) * 0.97;
  if (disp) { disp.className = 'limbo-display'; disp.textContent = '1.00×'; }
  const speed = getLimboSpeedPreset();
  let growthPow = 2.2;
  let runMs = 3200;
  if (speed === 'fast') { growthPow = 1.8; runMs = 2100; }
  else if (speed === 'slow') { growthPow = 2.55; runMs = 4300; }
  const startTs = performance.now();
  while (true) {
    const t = Math.max(0, Math.min(1, (performance.now() - startTs) / runMs));
    const expo = Math.pow(t, growthPow);
    const cur = Math.exp(Math.log(Math.max(1.01, crashAt)) * expo);
    if (disp) disp.textContent = `${Math.min(cur, crashAt).toFixed(2)}×`;
    setLimboProgress(Math.min(cur, crashAt), target);
    if (t >= 1) break;
    await gameSleep(36);
  }
  const win = target <= crashAt;
  if (win) {
    winGame(bet, target);
    if (disp) { disp.className = 'limbo-display win'; disp.textContent = `${target.toFixed(2)}× WIN`; }
    if (res) { res.textContent = `Succès à ×${target.toFixed(2)} — +${fmtVirtual(bet * (target - 1))}`; res.style.color = 'var(--green)'; }
    setLimboScene('win');
    showToast(`GAGNÉ ×${target.toFixed(2)} !`, 'success');
  } else {
    loseGame(bet);
    if (disp) { disp.className = 'limbo-display lose'; disp.textContent = `${crashAt.toFixed(2)}× KO`; }
    if (res) { res.textContent = `Échec à ×${crashAt.toFixed(2)} — Perdu`; res.style.color = 'var(--red)'; }
    const deathMode = LIMBO_DEATH_MODES[Math.floor(Math.random() * LIMBO_DEATH_MODES.length)];
    setLimboScene('lose', deathMode);
    showToast('PERDU', 'error');
  }
  await gameSleep(680);
  if (main) main.disabled = false;
  limboRolling = false;
}

// Roulette bet selection
const ROULETTE_RED = new Set([1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36]);
const ROULETTE_EURO_ORDER = [0,32,15,19,4,21,2,25,17,34,6,27,13,36,11,30,8,23,10,5,24,16,33,1,20,14,31,9,22,18,29,7,28,12,35,3,26];
const ROULETTE_SECTOR_DEG = 360 / ROULETTE_EURO_ORDER.length;

/** Couleur de chaque secteur de la roue (identique au tapis : 0 vert, rouges, noirs). */
function rouletteWheelSectorColor(num) {
  if (num === 0) return '#159653';
  return ROULETTE_RED.has(num) ? '#c0392b' : '#2c3e50';
}

/** Dégradé conique aligné sur l’ordre européen réel — le 0 est bien sur le secteur vert. */
function buildRouletteWheelConicGradient() {
  const n = ROULETTE_EURO_ORDER.length;
  const sec = 360 / n;
  const stops = [];
  for (let i = 0; i < n; i++) {
    const num = ROULETTE_EURO_ORDER[i];
    const start = +(i * sec).toFixed(5);
    const end = +((i + 1) * sec).toFixed(5);
    stops.push(`${rouletteWheelSectorColor(num)} ${start}deg ${end}deg`);
  }
  return `conic-gradient(${stops.join(',')})`;
}
const ROULETTE_SECTORS = {
  neighbors: [22,18,29,7,28,12,35,3,26,0,32,15,19,4,21,2,25],
  tiers: [27,13,36,11,30,8,23,10,5,24,16,33],
  orphans: [1,20,14,31,9,17,34,6]
};
let rouletteChip = 1;
let rouletteBets = {};
let rouletteHistory = [];
let rouletteLastSnapshot = {};
let rouletteOpen = true;
let rouletteWinningNumber = null;
let rouletteWheelDeg = 0;
function syncRouletteChipFromBetInput() {
  const val = Math.max(0.01, Number(getBet()) || 0.01);
  rouletteChip = +val.toFixed(2);
}
function selectRouletteChip(v, el) {
  rouletteChip = v;
  document.querySelectorAll('.roulette-chip').forEach(x => x.classList.remove('active'));
  if (el) el.classList.add('active');
}
function initRouletteBoard() {
  rouletteBets = {};
  rouletteHistory = [];
  rouletteWheelDeg = 0;
  syncRouletteChipFromBetInput();
  const grid = document.getElementById('roulette-numbers');
  const wheelNums = document.getElementById('roulette-wheel-numbers');
  const wheel = document.getElementById('roulette-wheel');
  const ball = document.getElementById('roulette-ball');
  if (wheel) {
    wheel.style.transform = 'rotate(0deg)';
    wheel.style.background = buildRouletteWheelConicGradient();
  }
  if (ball) {
    ball.classList.remove('spin');
    ball.style.transform = 'rotate(180deg) translateY(-126px) rotate(-180deg)';
  }
  if (grid) {
    grid.innerHTML = '';
    // Ordre visuel type casino: 3..36 / 2..35 / 1..34 (12 colonnes).
    for (let row = 3; row >= 1; row--) {
      for (let col = 0; col < 12; col++) {
        const n = row + (col * 3);
        const cell = document.createElement('div');
        cell.className = `roulette-cell ${ROULETTE_RED.has(n) ? 'red' : 'black'}`;
        cell.textContent = String(n);
        cell.setAttribute('data-rou-key', `num:${n}`);
        grid.appendChild(cell);
      }
    }
  }
  if (wheelNums) {
    wheelNums.innerHTML = '';
    ROULETTE_EURO_ORDER.forEach((n, i) => {
      const span = document.createElement('span');
      span.className = 'roulette-wheel-num';
      span.textContent = String(n);
      span.setAttribute('data-rou-wheel-num', String(n));
      // Décale d'un demi-secteur pour placer le texte au centre visuel de chaque case.
      const angle = (ROULETTE_SECTOR_DEG * i) + (ROULETTE_SECTOR_DEG / 2);
      span.style.setProperty('--ang', `${angle}deg`);
      span.style.color = n === 0 ? '#00e676' : (ROULETTE_RED.has(n) ? '#ff8a8a' : '#ffffff');
      wheelNums.appendChild(span);
    });
  }
  document.querySelectorAll('[data-rou-key]').forEach(el => {
    el.onclick = () => roulettePlace(el.getAttribute('data-rou-key'));
    const key = el.getAttribute('data-rou-key');
    if (key?.startsWith('num:')) el.title = 'Plein (35:1)';
    else if (key?.startsWith('color:') || key?.startsWith('parity:') || key?.startsWith('range:')) el.title = 'Chance simple (1:1)';
    else if (key?.startsWith('dozen:') || key?.startsWith('column:')) el.title = 'Douzaine/Colonne (2:1)';
  });
  const firstChip = document.querySelector('.roulette-chip');
  if (firstChip) firstChip.classList.add('active');
  setRouletteWinningVisual(null);
  setRouletteOpen(true);
  updateRouletteUI();
}
function setRouletteWinningVisual(num) {
  rouletteWinningNumber = Number.isFinite(num) ? num : null;
  document.querySelectorAll('.roulette-wheel-num').forEach(el => {
    const wn = Number(el.getAttribute('data-rou-wheel-num'));
    el.classList.toggle('winner', rouletteWinningNumber !== null && wn === rouletteWinningNumber);
  });
}
function roulettePlace(key) {
  if (!rouletteOpen) return;
  syncRouletteChipFromBetInput();
  const chipAmount = Math.max(0.01, Number(rouletteChip) || 0.01);
  const cur = rouletteBets[key] || 0;
  rouletteBets[key] = +(cur + chipAmount).toFixed(2);
  rouletteHistory.push({ key, amount: chipAmount });
  casinoSfx('chip');
  updateRouletteUI();
}
function roulettePlaceSplit() {
  if (!rouletteOpen) return;
  const a = parseInt(document.getElementById('rou-split-a')?.value || '', 10);
  const b = parseInt(document.getElementById('rou-split-b')?.value || '', 10);
  if (!(a >= 1 && a <= 36 && b >= 1 && b <= 36)) return showToast('Split invalide', 'error');
  const horizontal = Math.abs(a - b) === 1 && Math.ceil(a / 3) === Math.ceil(b / 3);
  const vertical = Math.abs(a - b) === 3;
  if (!horizontal && !vertical) return showToast('Split non adjacent', 'error');
  const x = Math.min(a, b), y = Math.max(a, b);
  roulettePlace(`split:${x}-${y}`);
}
function roulettePlaceStreet() {
  if (!rouletteOpen) return;
  const r = parseInt(document.getElementById('rou-street-row')?.value || '', 10);
  if (!(r >= 1 && r <= 12)) return showToast('Street invalide', 'error');
  roulettePlace(`street:${r}`);
}
function roulettePlaceCorner() {
  if (!rouletteOpen) return;
  const n = parseInt(document.getElementById('rou-corner-start')?.value || '', 10);
  if (!(n >= 1 && n <= 32) || n % 3 === 0) return showToast('Corner invalide', 'error');
  roulettePlace(`corner:${n}`);
}
function roulettePlaceSector(kind) {
  if (!rouletteOpen) return;
  if (!ROULETTE_SECTORS[kind]) return;
  roulettePlace(`sector:${kind}`);
}
function setRouletteOpen(open) {
  rouletteOpen = !!open;
  const phase = document.getElementById('rou-phase');
  if (phase) phase.textContent = rouletteOpen ? 'FAITES VOS JEUX' : 'JEUX FERMES';
}
function rouletteUndo() {
  if (!rouletteOpen) return;
  const last = rouletteHistory.pop();
  if (!last) return;
  rouletteBets[last.key] = +Math.max(0, (rouletteBets[last.key] || 0) - last.amount).toFixed(2);
  if (rouletteBets[last.key] <= 0) delete rouletteBets[last.key];
  updateRouletteUI();
}
function rouletteClear() {
  if (!rouletteOpen) return;
  rouletteBets = {};
  rouletteHistory = [];
  updateRouletteUI();
}
function rouletteRebet() {
  if (!rouletteOpen) return;
  rouletteBets = { ...rouletteLastSnapshot };
  rouletteHistory = Object.entries(rouletteBets).flatMap(([k,v]) => [{ key:k, amount:v }]);
  updateRouletteUI();
}
function updateRouletteUI() {
  const playedCount = Object.values(rouletteBets).filter(v => (Number(v) || 0) > 0).length;
  const countEl = document.getElementById('roulette-played-count');
  if (countEl) countEl.textContent = String(playedCount);
  document.querySelectorAll('[data-rou-key]').forEach(el => {
    const key = el.getAttribute('data-rou-key');
    const amt = rouletteBets[key] || 0;
    el.classList.toggle('bet', amt > 0);
    const old = el.querySelector('.roulette-chip-mark');
    if (old) old.remove();
    if (amt > 0) {
      const m = document.createElement('div');
      m.className = 'roulette-chip-mark';
      m.textContent = amt.toFixed(2);
      el.appendChild(m);
    }
  });
  const dis = !rouletteOpen;
  document.querySelectorAll('[data-rou-key]').forEach(el => {
    el.style.pointerEvents = dis ? 'none' : '';
    el.style.opacity = dis ? '0.5' : '';
  });
  const adv = document.getElementById('roulette-advanced');
  if (adv) {
    adv.style.pointerEvents = dis ? 'none' : '';
    adv.style.opacity = dis ? '0.55' : '';
  }
}
function rouletteWinForKey(key, n) {
  if (key.startsWith('num:')) return n === Number(key.split(':')[1]) ? 35 : -1;
  if (key.startsWith('split:')) {
    const pair = key.split(':')[1].split('-').map(Number);
    return pair.includes(n) ? 17 : -1;
  }
  if (key.startsWith('street:')) {
    const r = Number(key.split(':')[1]);
    const nums = [3*r-2, 3*r-1, 3*r];
    return nums.includes(n) ? 11 : -1;
  }
  if (key.startsWith('corner:')) {
    const s = Number(key.split(':')[1]);
    const nums = [s, s+1, s+3, s+4];
    return nums.includes(n) ? 8 : -1;
  }
  if (key.startsWith('sector:')) {
    const kind = key.split(':')[1];
    const nums = ROULETTE_SECTORS[kind] || [];
    if (!nums.length) return -1;
    return nums.includes(n) ? (36 / nums.length) - 1 : -1;
  }
  if (key === 'color:red') return ROULETTE_RED.has(n) ? 1 : -1;
  if (key === 'color:black') return (n !== 0 && !ROULETTE_RED.has(n)) ? 1 : -1;
  if (key === 'parity:even') return (n !== 0 && n % 2 === 0) ? 1 : -1;
  if (key === 'parity:odd') return (n % 2 === 1) ? 1 : -1;
  if (key === 'range:low') return (n >= 1 && n <= 18) ? 1 : -1;
  if (key === 'range:high') return (n >= 19 && n <= 36) ? 1 : -1;
  if (key === 'dozen:1') return (n >= 1 && n <= 12) ? 2 : -1;
  if (key === 'dozen:2') return (n >= 13 && n <= 24) ? 2 : -1;
  if (key === 'dozen:3') return (n >= 25 && n <= 36) ? 2 : -1;
  if (key === 'column:1') return (n !== 0 && n % 3 === 1) ? 2 : -1;
  if (key === 'column:2') return (n !== 0 && n % 3 === 2) ? 2 : -1;
  if (key === 'column:3') return (n !== 0 && n % 3 === 0) ? 2 : -1;
  return -1;
}

// Mines
let minesField = [], minesRevealed = 0, minesMult = 1, minesActive = false, minesCount = 3, minesBet = 0;
function getMinesCountFromUI() {
  const raw = parseInt(String(document.getElementById('mines-count')?.value ?? minesCount), 10);
  return Math.max(1, Math.min(24, Number.isFinite(raw) ? raw : minesCount));
}
function initMines() {
  minesField = [];
  minesRevealed = 0;
  minesMult = 1;
  minesActive = false;
  minesBet = 0;
  const grid = document.getElementById('mines-grid');
  if (!grid) return;
  grid.innerHTML = '';
  for (let i = 0; i < 25; i++) {
    const cell = document.createElement('div');
    cell.className = 'mine-cell';
    cell.onclick = () => mineReveal(i);
    cell.dataset.idx = i;
    grid.appendChild(cell);
  }
  const cashoutBtn = document.getElementById('mines-cashout');
  if (cashoutBtn) cashoutBtn.style.display = 'none';
  const main = document.getElementById('main-play-btn');
  if (main && currentGame?.id === 'mines') main.textContent = 'Lancer une partie';
  const resultEl = document.getElementById('mines-result');
  if (resultEl) { resultEl.textContent = 'Clique sur Lancer une partie'; resultEl.style.color = 'var(--text-dim)'; }
  const mc = document.getElementById('mines-count');
  if (mc && !mc.oninput) {
    mc.oninput = () => {
      const v = getMinesCountFromUI();
      mc.value = String(v);
      if (!minesActive) updateMinesMultiplierUI();
    };
  }
  updateMinesMultiplierUI();
}
function minesMultiplierFor(revealed, count) {
  // Produit des odds réelles × edge, puis prime de risque : plus il y a de mines,
  // plus le multiplicateur global « décolle » (courbe exponentielle plus haute).
  const mineCount = Math.max(1, Math.min(24, Number(count) || 3));
  let mult = 1;
  for (let i = 0; i < revealed; i++) {
    const tilesRemaining = 25 - i;
    const safeRemaining = tilesRemaining - mineCount;
    if (safeRemaining <= 0) break;
    mult *= (tilesRemaining / safeRemaining) * 0.99;
  }
  const risk = (mineCount - 1) / 23;
  const riskPrime = 1 + Math.pow(risk, 1.28) * 1.35;
  mult *= riskPrime;
  return Math.max(1, mult);
}
function updateMinesMultiplierUI() {
  const multEl = document.getElementById('mines-mult');
  if (!multEl) return;
  const countUi = minesActive ? minesCount : getMinesCountFromUI();
  const rev = minesActive ? minesRevealed : 0;
  const curDisplay = minesActive ? minesMult : 1;
  const nextMult = minesMultiplierFor(rev + 1, countUi);
  multEl.textContent = `×${curDisplay.toFixed(2)} | Prochain si safe: ×${nextMult.toFixed(2)}`;
}
function loadGamePlay_mines_start() {
  const bet = getBet();
  const bal = getUserBalance();
  if (bet > bal) { showToast('Solde insuffisant', 'error'); return; }
  let count = parseInt(String(document.getElementById('mines-count')?.value || '3'), 10);
  if (!Number.isFinite(count)) count = 3;
  minesCount = Math.max(1, Math.min(24, count));
  const minesInput = document.getElementById('mines-count');
  if (minesInput) minesInput.value = String(minesCount);
  minesField = Array(25).fill('safe');
  let placed = 0;
  while (placed < minesCount) {
    const idx = Math.floor(Math.random()*25);
    if (minesField[idx] === 'safe') { minesField[idx] = 'mine'; placed++; }
  }
  minesRevealed = 0;
  minesMult = 1;
  minesActive = true;
  minesBet = bet;
  previewStakeDeduction('mines', bet);
  document.getElementById('mines-cashout').style.display = '';
  document.getElementById('main-play-btn').textContent = 'ENCAISSER';
  updateMinesMultiplierUI();
  const resultEl = document.getElementById('mines-result');
  if (resultEl) { resultEl.textContent = `Partie lancée (${minesCount} mines)`; resultEl.style.color = 'var(--gold)'; }
}
function mineReveal(idx) {
  if (!minesActive) return;
  const cell = document.querySelector(`[data-idx="${idx}"]`);
  if (!cell || cell.classList.contains('revealed')) return;
  cell.classList.add('revealed');
  if (minesField[idx] === 'mine') {
    loseGame(minesBet, 'boom');
    cell.classList.add('mine'); cell.innerHTML = `<img src="./assets/cell-bomb.svg" alt="bomb">`;
    minesActive = false;
    document.getElementById('mines-cashout').style.display = 'none';
    document.getElementById('main-play-btn').textContent = 'NOUVELLE PARTIE';
    minesMult = 0;
    updateMinesMultiplierUI();
    // Reveal all mines
    minesField.forEach((v,i) => { if(v==='mine') { const c=document.querySelector(`[data-idx="${i}"]`); if(c){c.classList.add('revealed','mine');c.innerHTML='<img src="./assets/cell-bomb.svg" alt="bomb">';} } });
    const resultEl = document.getElementById('mines-result');
    if (resultEl) { resultEl.textContent = 'Mine ! Partie terminée (gain 0)'; resultEl.style.color = 'var(--red)'; }
    showToast('Mine ! Partie terminée (gain 0).', 'error');
  } else {
    cell.classList.add('safe'); cell.innerHTML = `<img src="./assets/cell-safe.svg" alt="safe">`;
    minesRevealed++;
    casinoSfx('pop', { pitch: 1 + Math.min(1.2, minesRevealed * 0.07) });
    minesMult = minesMultiplierFor(minesRevealed, minesCount);
    updateMinesMultiplierUI();
    const resultEl = document.getElementById('mines-result');
    if (resultEl) { resultEl.textContent = `${minesRevealed} case(s) safe`; resultEl.style.color = 'var(--green)'; }
    showToast(`Sûr ! Multiplicateur ×${minesMult.toFixed(2)}`, 'success', 1500);
  }
}
async function minesCashout() {
  if (!minesActive) return;
  const prize = minesBet * minesMult;
  winGame(minesBet, minesMult);
  minesActive = false;
  document.getElementById('mines-cashout').style.display = 'none';
  document.getElementById('main-play-btn').textContent = 'NOUVELLE PARTIE';
  const resultEl = document.getElementById('mines-result');
  if (resultEl) { resultEl.textContent = `Encaissé ×${minesMult.toFixed(2)} (${fmt(prize)})`; resultEl.style.color = 'var(--green)'; }
  showToast(`Encaissé ${fmt(prize)} (×${minesMult.toFixed(2)})`, 'success');
}
function minesMainAction() {
  if (!minesActive) {
    initMines();
    loadGamePlay_mines_start();
    return;
  }
  minesCashout();
}

// Override loadGamePlay for mines start
// Keno
let kenoSelected = new Set();
let kenoLastSelection = [];
function initKeno() {
  const grid = document.getElementById('keno-grid');
  if (!grid) return;
  kenoSelected.clear();
  const result = document.getElementById('keno-result');
  if (result) { result.textContent = '—'; result.style.color = 'var(--gold)'; }
  grid.innerHTML = '';
  for (let i = 1; i <= 40; i++) {
    const num = document.createElement('div');
    num.className = 'keno-num';
    num.textContent = i;
    num.onclick = () => {
      if (num.classList.contains('selected')) { num.classList.remove('selected'); kenoSelected.delete(i); casinoSfx('tick'); }
      else if (kenoSelected.size < 10) { num.classList.add('selected'); kenoSelected.add(i); casinoSfx('chip'); }
    };
    grid.appendChild(num);
  }
}
function newRoundKeno() {
  if (!currentGame || currentGame.id !== 'keno') return;
  initKeno();
  setDealerTalk('Nouvelle manche Keno prête.');
}
function clearKenoBoard() {
  if (!currentGame || currentGame.id !== 'keno') return;
  initKeno();
  const result = document.getElementById('keno-result');
  if (result) { result.textContent = 'Tableau vidé'; result.style.color = 'var(--text-dim)'; }
}
function replayKenoSelection() {
  if (!currentGame || currentGame.id !== 'keno') return;
  if (!Array.isArray(kenoLastSelection) || kenoLastSelection.length === 0) {
    showToast('Aucune sélection précédente', 'info');
    return;
  }
  initKeno();
  kenoLastSelection.slice(0, 10).forEach((n) => {
    const cell = Array.from(document.querySelectorAll('.keno-num')).find((el) => Number(el.textContent) === Number(n));
    if (!cell) return;
    cell.classList.add('selected');
    kenoSelected.add(Number(n));
  });
  const result = document.getElementById('keno-result');
  if (result) { result.textContent = `${kenoSelected.size} numéro(s) rejoué(s)`; result.style.color = 'var(--gold)'; }
}

// Chicken (cross road)
let chickenActive = false;
let chickenAnimating = false;
let chickenLane = 0;
let chickenBet = 0;
let chickenMult = 1;
const CHICKEN_TOTAL_LANES = 8;
/** Multiplicateur si toute la route est traversée (croissance exponentielle entre les rangées). */
const CHICKEN_FINAL_MULT = 1000;
/** Probabilité cible de finir les 8 rangées : 0,01 % (exacte avec le modèle ci-dessous). */
const CHICKEN_FULL_ROUTE_PROB = 0.0001;
/**
 * Danger exponentiel par rangée k : survie = exp(-λ·k), crash = 1 - exp(-λ·k).
 * ∏_{k=1..8} exp(-λ·k) = exp(-λ·(1+2+…+8)) = exp(-36λ) = CHICKEN_FULL_ROUTE_PROB ⇒ λ = ln(1/p) / 36.
 */
const CHICKEN_LANE_INDEX_SUM = (CHICKEN_TOTAL_LANES * (CHICKEN_TOTAL_LANES + 1)) / 2;
const CHICKEN_EXP_LAMBDA = Math.log(1 / CHICKEN_FULL_ROUTE_PROB) / CHICKEN_LANE_INDEX_SUM;
const CHICKEN_LANE_Y = [];
const CHICKEN_LANE_ELS = [];
function chickenLaneY(idx) {
  const road = document.getElementById('chicken-road');
  if (!road) return 0;
  const h = road.clientHeight || 460;
  const laneH = h / (CHICKEN_TOTAL_LANES + 2);
  // idx=0: zone de départ (hors route), idx>=1: centres des voies.
  return h - ((idx + 0.5) * laneH);
}
/** Multiplicateur après k rangées franchies (exponentiel : ×1000 aux 8 rangées). */
function chickenMultiplierAtLane(lanesCrossed) {
  const k = Math.max(0, Math.min(CHICKEN_TOTAL_LANES, lanesCrossed));
  if (k === 0) return 1;
  return Math.pow(CHICKEN_FINAL_MULT, k / CHICKEN_TOTAL_LANES);
}
function chickenUpdateMultiplier() {
  const cur = chickenActive ? chickenMultiplierAtLane(chickenLane) : 1;
  chickenMult = cur;
  const nextK = Math.min(chickenLane + 1, CHICKEN_TOTAL_LANES);
  const next = chickenActive ? chickenMultiplierAtLane(nextK) : 1;
  const el = document.getElementById('chicken-mult');
  if (!el) return;
  el.textContent = `Multiplicateur: ×${cur.toFixed(2)} | Prochain palier: ×${next.toFixed(2)} (max ×${CHICKEN_FINAL_MULT})`;
}
function chickenSetStepEnabled(enabled) {
  const btn = document.getElementById('chicken-step-btn');
  if (!btn) return;
  btn.disabled = !enabled;
  btn.style.opacity = enabled ? '1' : '0.45';
}
function chickenSpawnExplosion() {
  const road = document.getElementById('chicken-road');
  const player = document.getElementById('chicken-player');
  if (!road || !player) return;
  const boom = document.createElement('div');
  boom.className = 'chicken-explosion';
  boom.style.left = player.style.left || '50%';
  boom.style.top = player.style.top || `${chickenLaneY(chickenLane)}px`;
  road.appendChild(boom);
  setTimeout(() => { try { boom.remove(); } catch (_) {} }, 520);
}
/** Probabilité de crash en entrant sur la rangée k (1…8), croissance exponentielle avec k. */
function chickenCrashChanceForLane(lane) {
  const k = Math.max(1, Math.min(CHICKEN_TOTAL_LANES, lane));
  return 1 - Math.exp(-CHICKEN_EXP_LAMBDA * k);
}
function chickenSpawnPassingCar(lane, hit = false) {
  const road = document.getElementById('chicken-road');
  if (!road) return 0;
  const laneIdx = Math.max(0, Math.min(CHICKEN_TOTAL_LANES - 1, lane - 1));
  const y = CHICKEN_LANE_Y[laneIdx] || chickenLaneY(lane);
  const w = road.clientWidth || 720;
  const playerX = w * 0.5;
  const fromLeft = hit ? (Math.random() < 0.5) : (Math.random() < 0.5);
  const carW = 64 + (Math.random() * 32);
  const el = document.createElement('div');
  el.className = 'chicken-car';
  el.style.width = `${carW}px`;
  el.style.top = `${y}px`;
  const startX = fromLeft ? -carW - 20 : w + 20;
  el.style.left = `${startX}px`;
  el.style.background = `linear-gradient(180deg, hsl(${Math.floor(Math.random() * 360)} 75% 62%), hsl(${Math.floor(Math.random() * 360)} 68% 44%))`;
  road.appendChild(el);
  void el.offsetWidth;
  if (hit) {
    // En mode collision, la voiture vise d'abord le poulet pour un impact lisible.
    const impactX = playerX - (carW * 0.5);
    el.style.zIndex = '8';
    el.style.transition = 'left 260ms linear';
    el.style.left = `${impactX}px`;
    setTimeout(() => {
      // Petite pause d'impact pour que la collision soit bien visible.
      setTimeout(() => {
        el.style.transition = 'left 240ms linear';
        el.style.left = fromLeft ? `${w + 32}px` : `${-carW - 32}px`;
      }, 120);
    }, 260);
    setTimeout(() => { try { el.remove(); } catch (_) {} }, 760);
    return 270;
  }
  el.style.transition = 'left 520ms linear';
  el.style.left = fromLeft ? `${w + 28}px` : `${-carW - 28}px`;
  setTimeout(() => { try { el.remove(); } catch (_) {} }, 760);
  return 0;
}
function initChicken() {
  const road = document.getElementById('chicken-road');
  if (!road) return;
  if (gameInterval) { clearInterval(gameInterval); gameInterval = null; }
  CHICKEN_LANE_Y.length = 0;
  CHICKEN_LANE_ELS.length = 0;
  road.innerHTML = '';
  const h = road.clientHeight || 460;
  const laneH = h / (CHICKEN_TOTAL_LANES + 2);
  for (let i = 0; i < CHICKEN_TOTAL_LANES; i++) {
    const laneY = h - ((i + 2) * laneH);
    const laneEl = document.createElement('div');
    laneEl.className = 'chicken-lane';
    laneEl.style.top = `${laneY}px`;
    laneEl.style.height = `${laneH}px`;
    road.appendChild(laneEl);
    CHICKEN_LANE_Y.push(laneY + (laneH * 0.5));
    CHICKEN_LANE_ELS.push(laneEl);
  }
  const player = document.createElement('img');
  player.id = 'chicken-player';
  player.className = 'chicken-player';
  player.src = './assets/icon-game-chicken.svg';
  player.alt = 'chicken';
  player.style.left = '50%';
  player.style.top = `${chickenLaneY(0)}px`;
  road.appendChild(player);
  chickenActive = false;
  chickenAnimating = false;
  chickenLane = 0;
  chickenBet = 0;
  chickenMult = 1;
  chickenSetStepEnabled(false);
  chickenUpdateMultiplier();
  const res = document.getElementById('chicken-result');
  if (res) { res.textContent = 'Route vide : avance pour prendre le risque'; res.style.color = 'var(--text-dim)'; }
}
function chickenStartRound() {
  const bet = getBet();
  const bal = getUserBalance();
  if (bet > bal) { showToast('Solde insuffisant', 'error'); return; }
  chickenActive = true;
  chickenAnimating = false;
  chickenLane = 0;
  chickenBet = bet;
  chickenMult = 1;
  CHICKEN_LANE_ELS.forEach((laneEl) => laneEl.classList.remove('passed'));
  previewStakeDeduction('chicken', bet);
  const player = document.getElementById('chicken-player');
  if (player) {
    player.classList.remove('hit');
    player.style.top = `${chickenLaneY(0)}px`;
  }
  chickenSetStepEnabled(true);
  chickenUpdateMultiplier();
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'ENCAISSER';
  const res = document.getElementById('chicken-result');
  if (res) { res.textContent = 'Traverse la route !'; res.style.color = 'var(--gold)'; }
}
function chickenLoseByCrash() {
  if (!chickenActive) return;
  loseGame(chickenBet, 'boom');
  chickenActive = false;
  chickenSetStepEnabled(false);
  const player = document.getElementById('chicken-player');
  chickenSpawnExplosion();
  if (player) player.classList.add('hit');
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'NOUVELLE PARTIE';
  const res = document.getElementById('chicken-result');
  if (res) { res.textContent = 'Écrasé ! Perdu.'; res.style.color = 'var(--red)'; }
  showToast('Crash ! Gain 0', 'error');
}
function chickenStep() {
  if (!chickenActive || chickenAnimating) return;
  if (chickenLane >= CHICKEN_TOTAL_LANES + 1) return;
  chickenAnimating = true;
  chickenLane += 1;
  casinoSfx('pop', { pitch: 1 + chickenLane * 0.06 });
  const player = document.getElementById('chicken-player');
  if (player) player.style.top = `${chickenLaneY(chickenLane)}px`;
  setTimeout(() => {
    chickenAnimating = false;
    if (!chickenActive) return;
    if (chickenLane <= CHICKEN_TOTAL_LANES) {
      const crashChance = chickenCrashChanceForLane(chickenLane);
      const crash = Math.random() < crashChance;
      if (crash) {
        const crashDelay = chickenSpawnPassingCar(chickenLane, true);
        setTimeout(() => chickenLoseByCrash(), crashDelay || 250);
        return;
      }
    }
    const passedIdx = chickenLane - 1;
    if (passedIdx >= 0 && passedIdx < CHICKEN_LANE_ELS.length) CHICKEN_LANE_ELS[passedIdx].classList.add('passed');
    chickenMult = chickenMultiplierAtLane(Math.min(chickenLane, CHICKEN_TOTAL_LANES));
    chickenUpdateMultiplier();
    const res = document.getElementById('chicken-result');
    if (res) {
      if (chickenLane <= CHICKEN_TOTAL_LANES) {
        const nk = chickenLane + 1;
        let line = `Safe ! Rangée ${Math.min(chickenLane, CHICKEN_TOTAL_LANES)}`;
        if (chickenLane < CHICKEN_TOTAL_LANES) {
          const np = (chickenCrashChanceForLane(nk) * 100).toFixed(1);
          line += ` — risque rangée ${nk}: ${np}%`;
        } else {
          line += ' — dernière ligne : plus qu’un pas pour ×1000';
        }
        line += ' · P(traversée 8/8)=0,01 %';
        res.textContent = line;
      } else {
        res.textContent = 'Traversée terminée !';
      }
      res.style.color = 'var(--green)';
    }
    if (chickenLane >= CHICKEN_TOTAL_LANES + 1) {
      // Traversée complète: cashout auto.
      chickenCashout();
    }
  }, 210);
}
async function chickenCashout() {
  if (!chickenActive) return chickenStartRound();
  const prize = chickenBet * chickenMult;
  winGame(chickenBet, chickenMult);
  chickenActive = false;
  chickenSetStepEnabled(false);
  const main = document.getElementById('main-play-btn');
  if (main) main.textContent = 'NOUVELLE PARTIE';
  const res = document.getElementById('chicken-result');
  if (res) { res.textContent = `Encaissé ×${chickenMult.toFixed(2)} (${fmt(prize)})`; res.style.color = 'var(--green)'; }
  showToast(`Encaissé ${fmt(prize)}`, 'success');
}
function chickenMainAction() {
  if (!chickenActive) return chickenStartRound();
  chickenCashout();
}