'use strict';
/* globals showToast, escapeHtml, mapAuthError, getAuthClient, cloudCall, cloudCall, actionGuardAcquire, currentUser, pushRuntimeLog, invalidateCache, FEEDBACK_QUEUE_KEY */
/* Page Review / feedback site — lazy via LAZY_PAGE_SCRIPTS */

const FEEDBACK_QUEUE_KEY = 'hm_feedback_queue_v1';
function getFeedbackQueue() {
  try {
    const raw = JSON.parse(localStorage.getItem(FEEDBACK_QUEUE_KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}
function saveFeedbackQueue(items) {
  try {
    localStorage.setItem(FEEDBACK_QUEUE_KEY, JSON.stringify(items.slice(0, 50)));
  } catch (_) {}
}
async function flushFeedbackQueue() {
  const c = getAuthClient();
  if (!c) return;
  let q = getFeedbackQueue();
  if (!q.length) return;
  const remain = [];
  for (const item of q) {
    const row = {
      category: item.category,
      message: item.message,
      contact: item.contact || null,
      user_id: item.user_id || null,
      client_meta: item.client_meta || {}
    };
    try {
      const { error } = await cloudCall('sync', () => c.from('site_feedback').insert([row]), {
        retries: 1,
        timeoutMs: 14000,
        delayMs: 500,
        quiet: true
      });
      if (error) throw error;
    } catch (_) {
      remain.push(item);
    }
  }
  saveFeedbackQueue(remain);
  renderReviewPage();
}
function renderReviewPage() {
  const st = document.getElementById('review-status');
  if (!st) return;
  const pending = getFeedbackQueue().length;
  if (pending) {
    st.innerHTML = `${pending} message(s) en attente d’envoi (reconnexion / serveur). Ils partiront automatiquement.`;
    st.style.color = '#ffd38a';
  } else {
    st.textContent = '';
    st.style.color = '';
  }
}
async function submitSiteFeedback() {
  const catEl = document.getElementById('review-category');
  const msgEl = document.getElementById('review-message');
  const contactEl = document.getElementById('review-contact');
  const category = String(catEl?.value || 'autre').toLowerCase();
  const message = String(msgEl?.value || '').trim();
  const contact = String(contactEl?.value || '').trim().slice(0, 240);
  if (!['bug', 'idee', 'autre'].includes(category)) {
    showToast('Type de retour invalide', 'error');
    return;
  }
  if (message.length < 3) {
    showToast('Message trop court (3 caractères min.)', 'error');
    return;
  }
  const g = actionGuardAcquire('site:feedback', { limit: 5, windowMs: 120000, blockMs: 180000 });
  if (g.blocked) {
    showToast(`Trop d’envois récents. Réessaie dans ${g.waitSec}s.`, 'error');
    return;
  }
  const userId = (currentUser && !currentUser.isGuest && currentUser.id) ? currentUser.id : null;
  const row = {
    category,
    message: message.slice(0, 4000),
    contact: contact || null,
    user_id: userId,
    client_meta: {
      ua: String(navigator.userAgent || '').slice(0, 280),
      path: String(location.pathname || '') || '/'
    }
  };
  const c = getAuthClient();
  if (!c) {
    const q = getFeedbackQueue();
    q.push({ ...row, queuedAt: Date.now() });
    saveFeedbackQueue(q);
    if (msgEl) msgEl.value = '';
    renderReviewPage();
    showToast('Hors ligne : retour mis en file, envoi automatique plus tard.', 'info', 3200);
    return;
  }
  try {
    const { error } = await cloudCall('sync', () => c.from('site_feedback').insert([row]), {
      retries: 1,
      timeoutMs: 14000,
      delayMs: 500,
      quiet: true
    });
    if (error) throw error;
    if (msgEl) msgEl.value = '';
    if (contactEl) contactEl.value = '';
    renderReviewPage();
    showToast('Merci ! Ton retour a bien été envoyé.', 'success');
    invalidateCache('admin', 'feedback');
  } catch (e) {
    const q = getFeedbackQueue();
    q.push({ ...row, queuedAt: Date.now() });
    saveFeedbackQueue(q);
    renderReviewPage();
    const msg = String(e?.message || e?.details || e || '').toLowerCase();
    const code = String(e?.code || e?.hint || '').toLowerCase();
    const missingTable =
      code === '42p01'
      || msg.includes('pgrst205')
      || (msg.includes('site_feedback') && (
        msg.includes('relation') || msg.includes('schema cache') || msg.includes('does not exist')
        || msg.includes('could not find') || msg.includes('not found')
      ));
    const rlsDenied = msg.includes('permission denied') || msg.includes('row-level security') || msg.includes('rls');
    pushRuntimeLog('warn', `site_feedback insert failed: ${String(e?.message || e).slice(0, 200)}`);
    let toastText = 'Connexion Supabase impossible : retour mis en file (réessaie plus tard).';
    let toastType = 'info';
    if (missingTable) {
      toastText = 'Table site_feedback absente : ouvre Supabase → SQL Editor, exécute site_feedback.sql, puis réessaie.';
      toastType = 'error';
    } else if (rlsDenied) {
      toastText = 'Insertion bloquée (RLS) : vérifie les politiques sur site_feedback dans Supabase.';
      toastType = 'error';
    }
    showToast(toastText, toastType, missingTable || rlsDenied ? 5500 : 4000);
  }
}
