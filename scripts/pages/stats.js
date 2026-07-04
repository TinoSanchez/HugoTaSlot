'use strict';
/* globals escapeHtml, fmtVirtual, ensurePlayerStatsReady, createEmptyPlayerStats, computeRankFromWagered, getAllRankDropFactors, STATS_GAMES, __activePage */

let statsWindowDays = 30;

function renderStatsPage() {
  const root = document.getElementById('stats-root');
  if (!root) return;
  const stats = ensurePlayerStatsReady() || createEmptyPlayerStats();
  const rank = computeRankFromWagered(stats.wagered);
  const games = STATS_GAMES.map((g) => ({ id: g, ...(stats.games[g] || { played: 0, wagered: 0, payout: 0, net: 0 }) }));
  const playedTotal = Math.max(1, games.reduce((a, g) => a + Number(g.played || 0), 0));
  const topPlayed = games.slice().sort((a, b) => b.played - a.played).slice(0, 6);
  const maxAbsNet = Math.max(1, ...games.map((g) => Math.abs(Number(g.net || 0))));
  const winRate = ((games.filter((g) => Number(g.net || 0) > 0).length / games.length) * 100);
  const allDailyEntries = Object.entries(stats.daily || {}).sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  const cutoffMs = statsWindowDays > 0 ? (Date.now() - (statsWindowDays * 24 * 60 * 60 * 1000)) : 0;
  const dailyEntries = allDailyEntries
    .filter(([day]) => {
      if (statsWindowDays <= 0) return true;
      const t = Date.parse(`${day}T00:00:00`);
      return Number.isFinite(t) && t >= cutoffMs;
    })
    .slice(-12);
  const maxDailyAbs = Math.max(1, ...dailyEntries.map(([, v]) => Math.abs(Number(v?.net || 0))));
  const hourEntriesRaw = Array(24).fill(0);
  if (statsWindowDays > 0) {
    dailyEntries.forEach(([day]) => {
      const src = stats.daily?.[day];
      if (!src || !Array.isArray(src.sessionsByHour)) return;
      for (let h = 0; h < 24; h++) hourEntriesRaw[h] += Number(src.sessionsByHour[h] || 0);
    });
  } else {
    (stats.sessionsByHour || Array(24).fill(0)).forEach((v, h) => { hourEntriesRaw[h] = Number(v || 0); });
  }
  const hourEntries = hourEntriesRaw.map((v, h) => ({ h, v }));
  const maxHour = Math.max(1, ...hourEntries.map((x) => x.v));
  const rankDropTable = getAllRankDropFactors();
  root.innerHTML = `
    <div class="stats-rank-box">
      <div class="stats-rank-title">${rank.label}</div>
      <div class="stats-rank-meta">Points misés: ${fmtVirtual(stats.wagered)} | Prochain rang à ${fmtVirtual(rank.nextReq)}</div>
      <div class="stats-rank-progress"><div class="stats-rank-fill" style="width:${(rank.progress * 100).toFixed(1)}%"></div></div>
    </div>
    <div class="stats-grid">
      <div class="stat-card"><div class="stat-label">MANCHES</div><div class="stat-value">${stats.rounds}</div></div>
      <div class="stat-card"><div class="stat-label">TOTAL MISÉ</div><div class="stat-value">${fmtVirtual(stats.wagered)}</div></div>
      <div class="stat-card"><div class="stat-label">TOTAL PAYOUT</div><div class="stat-value">${fmtVirtual(stats.payout)}</div></div>
      <div class="stat-card"><div class="stat-label">NET</div><div class="stat-value" style="color:${stats.net >= 0 ? 'var(--green)' : 'var(--red)'}">${stats.net >= 0 ? '+' : ''}${fmtVirtual(stats.net)}</div></div>
    </div>
    <div class="stats-grid" style="grid-template-columns:repeat(2,minmax(160px,1fr));">
      <div class="stat-card"><div class="stat-label">JEUX DIFFÉRENTS JOUÉS</div><div class="stat-value">${games.filter((g) => g.played > 0).length}</div></div>
      <div class="stat-card"><div class="stat-label">TAUX JEUX GAGNANTS</div><div class="stat-value">${winRate.toFixed(1)}%</div></div>
    </div>
    <div class="stats-chart-wrap" style="margin-bottom:12px;">
      <div class="mise-section-title" style="margin-bottom:8px;">JEUX LES PLUS JOUÉS</div>
      ${topPlayed.map((g) => {
        const pct = ((Number(g.played || 0) / playedTotal) * 100);
        return `<div class="stats-chart-row">
          <div class="stats-chart-label">${escapeHtml(g.id.toUpperCase())}</div>
          <div class="stats-chart-bar"><div class="stats-chart-fill pos" style="width:${pct.toFixed(2)}%"></div></div>
          <div class="stats-chart-val">${Number(g.played || 0)} manches</div>
        </div>`;
      }).join('')}
    </div>
    <div class="stats-chart-wrap">
      <div class="mise-section-title" style="margin-bottom:8px;">GAINS / PERTES PAR JEU</div>
      ${games.map((g) => {
        const net = Number(g.net || 0);
        const w = (Math.abs(net) / maxAbsNet) * 100;
        const cls = net >= 0 ? 'pos' : 'neg';
        return `<div class="stats-chart-row">
          <div class="stats-chart-label">${escapeHtml(g.id.toUpperCase())}</div>
          <div class="stats-chart-bar"><div class="stats-chart-fill ${cls}" style="width:${w.toFixed(2)}%"></div></div>
          <div class="stats-chart-val" style="color:${net >= 0 ? 'var(--green)' : 'var(--red)'}">${net >= 0 ? '+' : ''}${fmtVirtual(net)}</div>
        </div>`;
      }).join('')}
    </div>
    <div class="stats-chart-wrap" style="margin-top:12px;">
      <div class="admin-toolbar" style="margin-bottom:8px;">
        <button class="profile-mini-btn ${statsWindowDays === 7 ? 'primary' : ''}" onclick="setStatsWindow(7)">7j</button>
        <button class="profile-mini-btn ${statsWindowDays === 30 ? 'primary' : ''}" onclick="setStatsWindow(30)">30j</button>
        <button class="profile-mini-btn ${statsWindowDays === 0 ? 'primary' : ''}" onclick="setStatsWindow(0)">All</button>
      </div>
      <div class="mise-section-title" style="margin-bottom:8px;">COURBE JOURNALIÈRE (NET)</div>
      ${dailyEntries.length ? dailyEntries.map(([day, v]) => {
        const n = Number(v?.net || 0);
        const w = (Math.abs(n) / maxDailyAbs) * 100;
        const cls = n >= 0 ? 'pos' : 'neg';
        return `<div class="stats-chart-row">
          <div class="stats-chart-label">${escapeHtml(day)}</div>
          <div class="stats-chart-bar"><div class="stats-chart-fill ${cls}" style="width:${w.toFixed(2)}%"></div></div>
          <div class="stats-chart-val" style="color:${n >= 0 ? 'var(--green)' : 'var(--red)'}">${n >= 0 ? '+' : ''}${fmtVirtual(n)}</div>
        </div>`;
      }).join('') : `<div class="bj-rec">Pas encore assez de sessions pour afficher une courbe.</div>`}
    </div>
    <div class="stats-chart-wrap" style="margin-top:12px;">
      <div class="mise-section-title" style="margin-bottom:8px;">HISTOGRAMME DES SESSIONS (HEURES)</div>
      ${hourEntries.filter((x) => x.v > 0).map((x) => {
        const w = (x.v / maxHour) * 100;
        return `<div class="stats-chart-row">
          <div class="stats-chart-label">${String(x.h).padStart(2, '0')}h</div>
          <div class="stats-chart-bar"><div class="stats-chart-fill pos" style="width:${w.toFixed(2)}%"></div></div>
          <div class="stats-chart-val">${x.v} session(s)</div>
        </div>`;
      }).join('') || `<div class="bj-rec">Aucune session enregistrée pour l’histogramme.</div>`}
    </div>
    <div class="stats-chart-wrap" style="margin-top:12px;">
      <div class="mise-section-title" style="margin-bottom:8px;">TABLEAU MULTIPLICATEURS DAILY (PAR RANG)</div>
      <div class="table-wrap">
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding:8px;">Rang</th>
              <th style="text-align:left;padding:8px;">Multiplicateur daily</th>
              <th style="text-align:left;padding:8px;">Wager requis</th>
            </tr>
          </thead>
          <tbody>
            ${rankDropTable.map((r) => `
              <tr>
                <td style="padding:8px;border-top:1px solid var(--border);">${escapeHtml(r.rank)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">x${r.factor.toFixed(2)}</td>
                <td style="padding:8px;border-top:1px solid var(--border);">${fmtVirtual(r.wagerRequired)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    </div>
  `;
}

function setStatsWindow(days) {
  const d = Number(days || 0);
  statsWindowDays = d <= 0 ? 0 : (d <= 7 ? 7 : 30);
  renderStatsPage();
}
