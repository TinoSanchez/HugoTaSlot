// Blackjack strategy table + renderBJTable
// Chargé lazily par scripts/pages/blackjack.js via LAZY_PAGE_SCRIPTS dans app.js
'use strict';
/* globals fmt, showToast, getUserBalance, setUserBalance, activeHunt, state, save, bhWarn, getAuthClient, currentUser, isCloudUser, isCurrentUserAdmin, recordGameSession, queueCloudGameSession */

// ─── BLACKJACK STRATEGY ───
const BJ_HARD = {
  // Hard totals: [2,3,4,5,6,7,8,9,10,A]
  4:  ['H','H','H','H','H','H','H','H','H','H'],
  5:  ['H','H','H','H','H','H','H','H','H','H'],
  6:  ['H','H','H','H','H','H','H','H','H','H'],
  7:  ['H','H','H','H','H','H','H','H','H','H'],
  8:  ['H','H','H','H','H','H','H','H','H','H'],
  9:  ['H','D','D','D','D','H','H','H','H','H'],
  10: ['D','D','D','D','D','D','D','D','H','H'],
  11: ['D','D','D','D','D','D','D','D','D','H'],
  12: ['H','H','S','S','S','H','H','H','H','H'],
  13: ['S','S','S','S','S','H','H','H','H','H'],
  14: ['S','S','S','S','S','H','H','H','H','H'],
  15: ['S','S','S','S','S','H','H','H','H','H'],
  16: ['S','S','S','S','S','H','H','H','H','H'],
  17: ['S','S','S','S','S','S','S','S','S','S'],
  18: ['S','S','S','S','S','S','S','S','S','S'],
  19: ['S','S','S','S','S','S','S','S','S','S'],
  20: ['S','S','S','S','S','S','S','S','S','S'],
  21: ['S','S','S','S','S','S','S','S','S','S'],
};
const BJ_SOFT = {
  // Soft totals (as in Ace + X): player total
  13: ['H','H','H','D','D','H','H','H','H','H'],
  14: ['H','H','H','D','D','H','H','H','H','H'],
  15: ['H','H','D','D','D','H','H','H','H','H'],
  16: ['H','H','D','D','D','H','H','H','H','H'],
  17: ['H','D','D','D','D','H','H','H','H','H'],
  18: ['Ds','Ds','D','D','D','S','S','H','H','H'],
  19: ['S','S','S','S','Ds','S','S','S','S','S'],
  20: ['S','S','S','S','S','S','S','S','S','S'],
  21: ['S','S','S','S','S','S','S','S','S','S'],
};
const BJ_PAIR = {
  // Pairs: [2,3,4,5,6,7,8,9,10,A]
  'A,A': ['P','P','P','P','P','P','P','P','P','P'],
  '2,2': ['P','P','P','P','P','P','H','H','H','H'],
  '3,3': ['P','P','P','P','P','P','H','H','H','H'],
  '4,4': ['H','H','H','P','P','H','H','H','H','H'],
  '5,5': ['D','D','D','D','D','D','D','D','H','H'],
  '6,6': ['P','P','P','P','P','H','H','H','H','H'],
  '7,7': ['P','P','P','P','P','P','H','H','H','H'],
  '8,8': ['P','P','P','P','P','P','P','P','P','P'],
  '9,9': ['P','P','P','P','P','S','P','P','S','S'],
  '10,10':['S','S','S','S','S','S','S','S','S','S'],
};
const BJ_DEALER = [2,3,4,5,6,7,8,9,10,'A'];
const BJ_LABELS = {H:'Tirer',S:'Rester',D:'Doubler',P:'Séparer',Ds:'Doubler ou Rester'};
const BJ_CLASSES = {H:'bj-cell-H',S:'bj-cell-S',D:'bj-cell-D',P:'bj-cell-P',Ds:'bj-cell-Ds'};

function bjGetAdvice() {
  const player = parseInt(document.getElementById('bj-player').value);
  const dealer = parseInt(document.getElementById('bj-dealer').value);
  const isSoft = document.getElementById('bj-soft').value === '1';
  const isPair = document.getElementById('bj-pair').value === '1';
  const dealerIdx = dealer === 1 ? 9 : dealer - 2;
  let table = isSoft ? BJ_SOFT : BJ_HARD;
  let action, key = Math.min(Math.max(player, 4), 21);
  if (isSoft) key = Math.min(Math.max(player, 13), 21);
  const row = table[key];
  action = row ? row[Math.min(dealerIdx, 9)] : 'S';
  const recEl = document.getElementById('bj-rec');
  const actionName = BJ_LABELS[action] || action;
  const emojis = {H:'HIT',S:'STAND',D:'DOUBLE',P:'SPLIT',Ds:'DOUBLE'};
  recEl.innerHTML = `<strong>CONSEIL STRATÉGIQUE</strong>
    <img src="./assets/virtual-token.svg" class="sidebar-tab-icon-logo" alt="act"> <span style="color:var(--gold);font-size:16px;font-family:'Rajdhani',sans-serif;font-weight:700;">${actionName.toUpperCase()}</span>
    — Main ${isSoft?'soft ':''}${player} contre dealer ${dealer}
    ${action==='H'?'<br>→ Tu dois tirer une carte de plus.':
      action==='S'?'<br>→ Tu dois rester sur ta main actuelle.':
      action==='D'?'<br>→ Double ta mise et prends une dernière carte.':
      action==='P'?'<br>→ Sépare ta paire en deux mains distinctes.':
      '<br>→ Double si possible, sinon reste.'}`;
}

function renderBJTable() {
  const table = document.getElementById('bj-strategy-table');
  if (!table || table.querySelector('th')) return;
  let html = '<thead><tr><th>MAIN \ DEALER</th>';
  BJ_DEALER.forEach(d => html += `<th>${d}</th>`);
  html += '</tr></thead><tbody>';
  Object.entries(BJ_HARD).forEach(([total, row]) => {
    html += `<tr><td>${total}</td>`;
    row.forEach(cell => html += `<td class="${BJ_CLASSES[cell]||''}">${cell}</td>`);
    html += '</tr>';
  });
  html += '<tr><td colspan="11" style="background:rgba(0,220,110,0.05);color:var(--gold-dim);font-size:9px;letter-spacing:2px;">SOFT (avec As)</td></tr>';
  Object.entries(BJ_SOFT).forEach(([total, row]) => {
    html += `<tr><td>A+${parseInt(total)-11}</td>`;
    row.forEach(cell => html += `<td class="${BJ_CLASSES[cell]||''}">${cell}</td>`);
    html += '</tr>';
  });
  html += '</tbody>';
  table.innerHTML = html;
}