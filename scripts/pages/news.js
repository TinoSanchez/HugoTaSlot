'use strict';
/* globals escapeHtml, bhWarn, mapAuthError, getAuthClient, cloudCall, pickSlotOfTheWeek, addNewsSlotWeekToHunt, isSafeUrl */
/* Page Actualités (YouTube + slots) — lazy via LAZY_PAGE_SCRIPTS */

const NEWS_CACHE = { videos: null, slots: null, ts: 0 };
const NEWS_TTL_MS = 60_000;


function renderNewsSlotWeekBanner(slots) {
  const wrap = document.getElementById('news-slot-week');
  if (!wrap) return;
  const pick = typeof pickSlotOfTheWeek === 'function' ? pickSlotOfTheWeek(slots) : (slots?.[0] || null);
  if (!pick) { wrap.classList.add('hidden'); wrap.innerHTML = ''; return; }
  window.__newsSlotWeekPick = pick;
  wrap.classList.remove('hidden');
  const title = escapeHtml(pick.title || 'Slot');
  const provider = escapeHtml(pick.provider || '');
  const img = pick.image && isSafeUrl(pick.image) ? escapeHtml(pick.image) : '';
  wrap.innerHTML = `
    <div class="news-slot-week-inner">
      ${img ? `<img class="news-slot-week-img" src="${img}" alt="${title}" loading="lazy" referrerpolicy="no-referrer">` : ''}
      <div class="news-slot-week-body">
        <div class="news-slot-week-kicker">SLOT DE LA SEMAINE</div>
        <div class="news-slot-week-title">${title}</div>
        <div class="news-slot-week-meta">${provider || 'Nouveauté communautaire'}</div>
        <div class="news-slot-week-actions">
          <button type="button" class="profile-mini-btn primary" onclick="addNewsSlotWeekToHunt()">Ajouter au hunt</button>
          ${pick.url ? `<a class="profile-mini-btn" href="${escapeHtml(pick.url)}" target="_blank" rel="noopener noreferrer">En savoir plus</a>` : ''}
        </div>
      </div>
    </div>`;
}


async function fetchNewsVideos() {
  const c = getAuthClient();
  if (!c) throw new Error('Supabase indisponible');
  const { data, error } = await cloudCall('news', () => c
    .from('youtube_videos')
    .select('id,video_id,title,url,thumbnail,description,published_at,channel_label')
    .order('published_at', { ascending: false })
    .limit(12), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

async function fetchNewsSlots() {
  const c = getAuthClient();
  if (!c) throw new Error('Supabase indisponible');
  const { data, error } = await cloudCall('news', () => c
    .from('slot_releases')
    .select('id,source,title,provider,image,summary,url,published_at')
    .order('published_at', { ascending: false })
    .limit(18), { retries: 1, timeoutMs: 12000, delayMs: 500, quiet: true });
  if (error) throw error;
  return Array.isArray(data) ? data : [];
}

function formatNewsDate(iso) {
  if (!iso) return '—';
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return 'à l’instant';
    if (min < 60) return `il y a ${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `il y a ${h} h`;
    const days = Math.floor(h / 24);
    if (days < 7) return `il y a ${days} j`;
    return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
  } catch (_) { return '—'; }
}

function renderNewsVideoCard(v) {
  const url = v.url || (v.video_id ? `https://www.youtube.com/watch?v=${encodeURIComponent(v.video_id)}` : '#');
  const thumb = v.thumbnail || (v.video_id ? `https://i.ytimg.com/vi/${encodeURIComponent(v.video_id)}/hqdefault.jpg` : '');
  const title = escapeHtml(String(v.title || 'Vidéo HugoTaSlot'));
  const channel = escapeHtml(String(v.channel_label || 'HugoTaSlot'));
  const when = escapeHtml(formatNewsDate(v.published_at));
  return `
    <article class="news-card">
      <a class="news-card-thumb" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
        ${thumb ? `<img src="${escapeHtml(thumb)}" alt="${title}" referrerpolicy="no-referrer" loading="lazy">` : ''}
        <span class="news-badge video">YouTube</span>
      </a>
      <div class="news-card-body">
        <div class="news-card-title">${title}</div>
        <div class="news-card-meta"><span>${channel}</span><span>${when}</span></div>
        <div class="news-card-actions">
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">Regarder</a>
        </div>
      </div>
    </article>
  `;
}

function renderNewsSlotCard(s) {
  const src = String(s.source || 'manual').toLowerCase();
  const badgeMap = {
    bigwinboard: { cls: 'bigwinboard', lbl: 'BigWinBoard' },
    slotcatalog: { cls: 'bigwinboard', lbl: 'SlotCatalog' },
    stake: { cls: 'manual', lbl: 'Stake' },
    gamdom: { cls: 'manual', lbl: 'Gamdom' },
    shuffle: { cls: 'manual', lbl: 'Shuffle' },
    celsius: { cls: 'manual', lbl: 'Celsius' },
    manual: { cls: 'manual', lbl: 'Maison' },
  };
  const badge = badgeMap[src] || badgeMap.manual;
  const badgeCls = badge.cls;
  const badgeLbl = badge.lbl;
  const title = escapeHtml(String(s.title || 'Nouvelle slot'));
  const provider = escapeHtml(String(s.provider || ''));
  const summary = String(s.summary || '').replace(/\s+/g, ' ').trim();
  const summaryShort = summary.length > 180 ? `${escapeHtml(summary.slice(0, 180))}…` : escapeHtml(summary);
  const url = s.url || '';
  const img = s.image || '';
  const when = escapeHtml(formatNewsDate(s.published_at));
  return `
    <article class="news-card">
      <div class="news-card-thumb">
        ${img ? `<img src="${escapeHtml(img)}" alt="${title}" referrerpolicy="no-referrer" loading="lazy">` : ''}
        <span class="news-badge ${badgeCls}">${badgeLbl}</span>
      </div>
      <div class="news-card-body">
        <div class="news-card-title">${title}</div>
        <div class="news-card-meta"><span>${provider || '—'}</span><span>${when}</span></div>
        ${summaryShort ? `<div class="news-card-summary">${summaryShort}</div>` : ''}
        ${url ? `<div class="news-card-actions"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">En savoir plus</a></div>` : ''}
      </div>
    </article>
  `;
}

async function renderNewsPage(force = false) {
  const vGrid = document.getElementById('news-videos-grid');
  const sGrid = document.getElementById('news-slots-grid');
  if (!vGrid || !sGrid) return;
  const fresh = !force && NEWS_CACHE.videos && NEWS_CACHE.slots && (Date.now() - NEWS_CACHE.ts) < NEWS_TTL_MS;
  if (fresh) {
    vGrid.innerHTML = NEWS_CACHE.videos.length ? NEWS_CACHE.videos.map(renderNewsVideoCard).join('') : `<div class="bj-rec">Aucune vidéo pour l’instant.</div>`;
    sGrid.innerHTML = NEWS_CACHE.slots.length ? NEWS_CACHE.slots.map(renderNewsSlotCard).join('') : `<div class="bj-rec">Aucune sortie publiée pour l’instant.</div>`;
    renderNewsSlotWeekBanner(NEWS_CACHE.slots);
    return;
  }
  vGrid.innerHTML = `<div class="bj-rec">Chargement…</div>`;
  sGrid.innerHTML = `<div class="bj-rec">Chargement…</div>`;
  try {
    const [videos, slots] = await Promise.all([
      fetchNewsVideos().catch((e) => { bhWarn('[news] videos', e); return []; }),
      fetchNewsSlots().catch((e) => { bhWarn('[news] slots', e); return []; })
    ]);
    NEWS_CACHE.videos = videos;
    NEWS_CACHE.slots = slots;
    NEWS_CACHE.ts = Date.now();
    vGrid.innerHTML = videos.length ? videos.map(renderNewsVideoCard).join('') : `<div class="bj-rec">Aucune vidéo pour l’instant. Le bot Discord les publiera dès qu’une nouvelle vidéo HugoTaSlot sortira.</div>`;
    sGrid.innerHTML = slots.length ? slots.map(renderNewsSlotCard).join('') : `<div class="bj-rec">Aucune sortie publiée. Les admins peuvent en ajouter manuellement depuis le panel admin.</div>`;
    renderNewsSlotWeekBanner(slots);
  } catch (e) {
    vGrid.innerHTML = `<div class="bj-rec" style="color:#ff9fb1;">Impossible de charger les vidéos. ${escapeHtml(mapAuthError(e))}</div>`;
    sGrid.innerHTML = `<div class="bj-rec" style="color:#ff9fb1;">Impossible de charger les sorties. ${escapeHtml(mapAuthError(e))}</div>`;
  }
}

function invalidateNewsCache() { NEWS_CACHE.ts = 0; }

