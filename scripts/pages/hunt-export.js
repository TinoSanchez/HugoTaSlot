'use strict';
/* globals activeHunt, showToast, escapeHtml, confirmRich, currentUser, fmt, getDisplayCurrency, getCasinoLabel, getCasinoKey, toEUR, bhWarn, document */
/* Export hunt JSON / PNG / PDF — lazy bundle hunt */

function exportActiveHunt() {
  const hunt = activeHunt();
  if (!hunt) { showToast('Sélectionne un hunt à exporter', 'error'); return; }
  const bonuses = Array.isArray(hunt.bonuses) ? hunt.bonuses : [];
  const seen = new Map();
  let duplicateCount = 0;
  let missingProvider = 0;
  let tinyStake = 0;
  let hugeStake = 0;
  bonuses.forEach((b) => {
    const key = String((b.slotName || '').trim().toLowerCase());
    seen.set(key, (seen.get(key) || 0) + 1);
    const stake = Number(b.stake || 0);
    if (!String(b.slotProvider || '').trim()) missingProvider++;
    if (Number.isFinite(stake) && stake > 0 && stake < 0.1) tinyStake++;
    if (Number.isFinite(stake) && stake > 1000) hugeStake++;
  });
  duplicateCount = [...seen.values()].filter((v) => v > 1).reduce((a, v) => a + (v - 1), 0);
  const bonusCount = (hunt.bonuses || []).length;
  const openedCount = (hunt.bonuses || []).filter((b) => b.win !== null).length;
  const qualityHtml = `
    <div style="font-family:'Share Tech Mono',monospace;font-size:10px;color:var(--text-dim);line-height:1.5;">
      Hunt: ${escapeHtml(hunt.name || 'Hunt')}<br>
      Bonus: ${bonusCount} · Ouverts: ${openedCount} · Casino: ${escapeHtml(hunt.casino || 'gamdom')}<br>
      Doublons slot: ${duplicateCount} · Providers manquants: ${missingProvider}<br>
      Mises très faibles (&lt;0.10): ${tinyStake} · Mises très élevées (&gt;1000): ${hugeStake}
    </div>
  `;
  confirmRich('Qualité des données avant export', qualityHtml, 'EXPORTER', 'ANNULER').then((ok) => {
    if (!ok) return;
    const payload = {
      format: 'hugotaslot-hunt-v3',
      schemaVersion: 3,
      exportedAt: Date.now(),
      exportedBy: currentUser?.username || 'local',
      metadata: {
        appVersion: '2.0',
        bonusCount,
        openedCount,
        casino: hunt.casino || 'gamdom',
        quality: { duplicateCount, missingProvider, tinyStake, hugeStake }
      },
      hunt
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safe = String(hunt.name || 'hunt').replace(/[^a-z0-9_-]+/gi, '_');
    a.download = `${safe}_${new Date().toISOString().slice(0,10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Hunt exporté', 'success');
  });
}

function getHuntExportSummary(hunt) {
  const bonuses = Array.isArray(hunt?.bonuses) ? hunt.bonuses : [];
  const currency = hunt?.currency || getDisplayCurrency();
  const startBalance = Number(hunt?.startBalance || 0);
  const totalStake = bonuses.reduce((s, b) => s + Number(b.stake || 0), 0);
  const openedBonuses = bonuses.filter((b) => b && b.win !== null && !Number.isNaN(Number(b.win)));
  const totalWin = openedBonuses.reduce((s, b) => s + Number(b.win || 0), 0);
  const profit = totalWin - startBalance;
  const beAvg = totalStake > 0 ? startBalance / totalStake : 0;
  const topBonuses = openedBonuses
    .map((b) => {
      const stake = Number(b.stake || 0);
      const win = Number(b.win || 0);
      return {
        name: String(b.slotName || 'Slot').trim() || 'Slot',
        provider: String(b.slotProvider || '').trim(),
        win,
        stake,
        mult: stake > 0 ? win / stake : 0,
      };
    })
    .sort((a, b) => b.win - a.win)
    .slice(0, 5);
  return {
    currency,
    startBalance,
    totalWin,
    profit,
    beAvg,
    bonusCount: bonuses.length,
    openedCount: openedBonuses.length,
    casinoLabel: getCasinoLabel(getCasinoKey(hunt?.casino || 'gamdom')),
    topBonuses,
  };
}

function loadExportImageAsset(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`asset_load_failed:${url}`));
    img.src = url;
  });
}

function canvasRoundRect(ctx, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rad, y);
  ctx.arcTo(x + w, y, x + w, y + h, rad);
  ctx.arcTo(x + w, y + h, x, y + h, rad);
  ctx.arcTo(x, y + h, x, y, rad);
  ctx.arcTo(x, y, x + w, y, rad);
  ctx.closePath();
}

function truncateCanvasText(ctx, text, maxWidth) {
  const raw = String(text || '');
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let out = raw;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out}…`;
}

async function renderHuntExportCanvas(hunt, summary) {
  await document.fonts.ready;
  const W = 1200;
  const H = 675;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas_unavailable');

  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, '#0B1210');
  bg.addColorStop(0.55, '#050806');
  bg.addColorStop(1, '#020403');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = 'rgba(0, 220, 110, 0.22)';
  ctx.lineWidth = 2;
  canvasRoundRect(ctx, 18, 18, W - 36, H - 36, 22);
  ctx.stroke();

  const glow = ctx.createRadialGradient(W * 0.82, H * 0.12, 10, W * 0.82, H * 0.12, 320);
  glow.addColorStop(0, 'rgba(0, 220, 110, 0.14)');
  glow.addColorStop(1, 'rgba(0, 220, 110, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  let logoHugo = null;
  let logo19 = null;
  try {
    [logoHugo, logo19] = await Promise.all([
      loadExportImageAsset('./assets/logo-hugotaslot.jpg'),
      loadExportImageAsset('./assets/19enplein-logo.png'),
    ]);
  } catch (_) {}

  const pad = 52;
  let y = 54;
  if (logoHugo && logo19) {
    const ls = 42;
    ctx.drawImage(logoHugo, pad, y - 8, ls, ls);
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '600 22px Rajdhani, sans-serif';
    ctx.fillText('×', pad + ls + 10, y + 24);
    ctx.drawImage(logo19, pad + ls + 34, y - 4, ls + 8, ls);
    y += 52;
  }

  ctx.fillStyle = '#00DC6E';
  ctx.font = '700 13px "Share Tech Mono", monospace';
  ctx.fillText('HUGOTASLOT × 19ENPLEIN · BONUS HUNT RECAP', pad, y);
  y += 34;

  ctx.fillStyle = '#FFC93C';
  ctx.font = '800 46px Rajdhani, sans-serif';
  const huntTitle = truncateCanvasText(ctx, hunt.name || 'Mon Hunt', W - pad * 2);
  ctx.fillText(huntTitle, pad, y);
  y += 24;

  ctx.fillStyle = 'rgba(237,238,242,0.55)';
  ctx.font = '500 16px Rajdhani, sans-serif';
  ctx.fillText(`${summary.bonusCount} bonus · ${summary.openedCount} ouverts · ${summary.casinoLabel}`, pad, y + 18);
  y += 52;

  const cur = summary.currency;
  const kpis = [
    { label: 'PROFIT', value: `${summary.profit >= 0 ? '+' : ''}${fmt(summary.profit, cur)}`, color: summary.profit >= 0 ? '#00DC6E' : '#E07A8C' },
    { label: 'SOLDE DÉPART', value: fmt(summary.startBalance, cur), color: '#FFC93C' },
    { label: 'GAINS TOTAUX', value: fmt(summary.totalWin, cur), color: '#EDEEF2' },
    { label: 'BE MOYEN', value: summary.beAvg > 0 ? `${summary.beAvg.toFixed(4).replace('.', ',')}×` : '—', color: '#FFC93C' },
  ];
  const gap = 14;
  const boxW = (W - pad * 2 - gap * 3) / 4;
  const boxH = 92;
  kpis.forEach((k, i) => {
    const x = pad + i * (boxW + gap);
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    canvasRoundRect(ctx, x, y, boxW, boxH, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.08)';
    ctx.lineWidth = 1;
    canvasRoundRect(ctx, x, y, boxW, boxH, 12);
    ctx.stroke();
    ctx.fillStyle = 'rgba(237,238,242,0.45)';
    ctx.font = '600 11px "Share Tech Mono", monospace';
    ctx.fillText(k.label, x + 14, y + 24);
    ctx.fillStyle = k.color;
    ctx.font = '800 28px Rajdhani, sans-serif';
    ctx.fillText(truncateCanvasText(ctx, k.value, boxW - 28), x + 14, y + 58);
  });
  y += boxH + 28;

  ctx.fillStyle = '#00DC6E';
  ctx.font = '700 13px "Share Tech Mono", monospace';
  ctx.fillText('TOP BONUS', pad, y);
  y += 22;

  const rowH = 46;
  const rows = summary.topBonuses.length ? summary.topBonuses : [{ name: 'Aucun bonus ouvert pour l’instant', provider: '', win: 0, mult: 0 }];
  rows.forEach((b, i) => {
    const ry = y + i * (rowH + 8);
    ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.015)';
    canvasRoundRect(ctx, pad, ry, W - pad * 2, rowH, 10);
    ctx.fill();
    ctx.fillStyle = '#EDEEF2';
    ctx.font = '700 20px Rajdhani, sans-serif';
    const slotLine = b.provider ? `${b.name} · ${b.provider}` : b.name;
    ctx.fillText(truncateCanvasText(ctx, slotLine, W - pad * 2 - 260), pad + 14, ry + 29);
    if (b.win > 0) {
      ctx.textAlign = 'right';
      ctx.fillStyle = '#00DC6E';
      ctx.font = '700 18px "Share Tech Mono", monospace';
      ctx.fillText(fmt(b.win, cur), W - pad - 14, ry + 22);
      ctx.fillStyle = 'rgba(237,238,242,0.45)';
      ctx.font = '500 12px "Share Tech Mono", monospace';
      ctx.fillText(`×${Number(b.mult || 0).toFixed(2)}`, W - pad - 14, ry + 38);
      ctx.textAlign = 'left';
    }
  });

  ctx.fillStyle = 'rgba(237,238,242,0.35)';
  ctx.font = '500 12px "Share Tech Mono", monospace';
  const dateStr = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  ctx.fillText(`hugotaslot.fr · ${dateStr}`, pad, H - 42);

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('png_export_failed'));
      else resolve(blob);
    }, 'image/png');
  });
}

async function exportActiveHuntImage(opts = {}) {
  const hunt = activeHunt();
  if (!hunt) {
    showToast('Sélectionne un hunt à exporter', 'error');
    return;
  }
  const summary = getHuntExportSummary(hunt);
  if (!summary.bonusCount) {
    showToast('Ajoute au moins un bonus avant l’export image', 'error');
    return;
  }
  try {
    showToast('Génération de l’image…', 'info', 1200);
    const blob = await renderHuntExportCanvas(hunt, summary);
    const safe = String(hunt.name || 'hunt').replace(/[^a-z0-9_-]+/gi, '_');
    const filename = `${safe}_recap_${new Date().toISOString().slice(0, 10)}.png`;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    if (opts.copyClipboard !== false && navigator.clipboard && window.ClipboardItem) {
      try {
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        showToast('Image téléchargée et copiée (presse-papiers)', 'success', 2800);
        return;
      } catch (_) {}
    }
    showToast('Image récap exportée', 'success', 2200);
  } catch (e) {
    bhWarn('exportActiveHuntImage', e);
    showToast('Export image impossible', 'error', 2600);
  }
}

function buildHuntExportPrintHtml(hunt, summary) {
  const cur = summary.currency;
  const bonuses = Array.isArray(hunt?.bonuses) ? hunt.bonuses : [];
  const dateStr = new Date(hunt?.createdAt || Date.now()).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' });
  const printDate = new Date().toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const profitColor = summary.profit >= 0 ? '#0a7a42' : '#b33a52';
  const rows = bonuses.map((b, i) => {
    const stake = Number(b.stake || 0);
    const winRaw = b?.win;
    const opened = winRaw !== null && winRaw !== undefined && !Number.isNaN(Number(winRaw));
    const win = opened ? Number(winRaw || 0) : null;
    const mult = opened && stake > 0 ? win / stake : null;
    const status = opened ? 'Ouvert' : 'À ouvrir';
    return `<tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(String(b.slotName || 'Slot').trim() || 'Slot')}</td>
      <td>${escapeHtml(String(b.slotProvider || '').trim() || '—')}</td>
      <td class="num">${fmt(stake, cur)}</td>
      <td class="num">${opened ? fmt(win, cur) : '—'}</td>
      <td class="num">${mult !== null ? `×${mult.toFixed(2)}` : '—'}</td>
      <td>${status}</td>
    </tr>`;
  }).join('');
  const topRows = (summary.topBonuses || []).map((b) => {
    const slotLine = b.provider ? `${b.name} · ${b.provider}` : b.name;
    return `<li><strong>${escapeHtml(slotLine)}</strong> — ${fmt(b.win, cur)}${b.mult > 0 ? ` (×${Number(b.mult).toFixed(2)})` : ''}</li>`;
  }).join('');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(hunt.name || 'Hunt')} — récap</title>
  <style>
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; }
    body { font-family: "Segoe UI", Arial, sans-serif; color: #111; margin: 0; padding: 0; font-size: 12px; }
    .wrap { max-width: 780px; margin: 0 auto; }
    h1 { margin: 0 0 4px; font-size: 26px; color: #0a7a42; }
    .sub { color: #555; margin-bottom: 18px; }
    .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin-bottom: 18px; }
    .kpi { border: 1px solid #ddd; border-radius: 8px; padding: 10px 12px; background: #fafafa; }
    .kpi label { display: block; font-size: 10px; letter-spacing: 0.4px; text-transform: uppercase; color: #666; margin-bottom: 4px; }
    .kpi strong { font-size: 18px; }
    .section { margin-top: 18px; }
    .section h2 { font-size: 14px; margin: 0 0 8px; color: #0a7a42; text-transform: uppercase; letter-spacing: 0.5px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { background: #f0f0f0; font-size: 10px; text-transform: uppercase; letter-spacing: 0.3px; }
    td.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
    ul { margin: 0; padding-left: 18px; }
    .foot { margin-top: 22px; padding-top: 10px; border-top: 1px solid #ddd; color: #666; font-size: 10px; }
    @media print {
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>${escapeHtml(hunt.name || 'Mon Hunt')}</h1>
    <div class="sub">HugoTaSlot × 19EnPlein · Bonus Hunt · créé le ${escapeHtml(dateStr)} · ${escapeHtml(summary.casinoLabel)} · ${summary.bonusCount} bonus (${summary.openedCount} ouverts)</div>
    <div class="kpis">
      <div class="kpi"><label>Profit</label><strong style="color:${profitColor}">${summary.profit >= 0 ? '+' : ''}${escapeHtml(fmt(summary.profit, cur))}</strong></div>
      <div class="kpi"><label>Solde départ</label><strong>${escapeHtml(fmt(summary.startBalance, cur))}</strong></div>
      <div class="kpi"><label>Gains totaux</label><strong>${escapeHtml(fmt(summary.totalWin, cur))}</strong></div>
      <div class="kpi"><label>BE moyen</label><strong>${summary.beAvg > 0 ? `${summary.beAvg.toFixed(4).replace('.', ',')}×` : '—'}</strong></div>
    </div>
    ${topRows ? `<div class="section"><h2>Top bonus</h2><ul>${topRows}</ul></div>` : ''}
    <div class="section">
      <h2>Détail des bonus</h2>
      <table>
        <thead><tr><th>#</th><th>Slot</th><th>Provider</th><th>Mise</th><th>Gain</th><th>Multi</th><th>Statut</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7">Aucun bonus</td></tr>'}</tbody>
      </table>
    </div>
    <div class="foot">hugotaslot.fr · exporté le ${escapeHtml(printDate)} · document d’archivage / impression</div>
  </div>
</body>
</html>`;
}

function exportActiveHuntPdf() {
  const hunt = activeHunt();
  if (!hunt) {
    showToast('Sélectionne un hunt à exporter', 'error');
    return;
  }
  const summary = getHuntExportSummary(hunt);
  if (!summary.bonusCount) {
    showToast('Ajoute au moins un bonus avant l’export PDF', 'error');
    return;
  }
  const html = buildHuntExportPrintHtml(hunt, summary);
  const iframe = document.createElement('iframe');
  iframe.setAttribute('aria-hidden', 'true');
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;opacity:0;pointer-events:none';
  document.body.appendChild(iframe);
  const doc = iframe.contentDocument || iframe.contentWindow?.document;
  if (!doc) {
    iframe.remove();
    showToast('Export PDF impossible', 'error');
    return;
  }
  doc.open();
  doc.write(html);
  doc.close();
  const runPrint = () => {
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      showToast('Dialogue d’impression ouvert — choisis « Enregistrer en PDF »', 'success', 3200);
    } catch (e) {
      bhWarn('exportActiveHuntPdf', e);
      showToast('Export PDF impossible', 'error');
    } finally {
      setTimeout(() => iframe.remove(), 1500);
    }
  };
  if (iframe.contentDocument?.readyState === 'complete') runPrint();
  else iframe.onload = runPrint;
}

function initHuntExportToolbar() {
  const bind = (id, fn) => { const el = document.getElementById(id); if (el && !el.dataset.huntBound) { el.dataset.huntBound = '1'; el.addEventListener('click', fn); } };
  bind('btn-export-hunt', exportActiveHunt);
  bind('btn-export-hunt-image', () => { exportActiveHuntImage().catch(() => {}); });
  bind('btn-export-hunt-pdf', () => { exportActiveHuntPdf(); });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initHuntExportToolbar);
else initHuntExportToolbar();

