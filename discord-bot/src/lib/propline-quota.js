/**
 * Suivi quota PropLine (headers x-requests-remaining) + garde-fou.
 */
import { child } from './logger.js';

const log = child({ mod: 'propline-quota' });

const DAILY_BUDGET = Math.max(1000, parseInt(process.env.PROPLINE_DAILY_BUDGET || '24000', 10) || 24000);
const RESERVE = Math.max(100, parseInt(process.env.PROPLINE_QUOTA_RESERVE || '800', 10) || 800);

let _state = {
  remain: null,
  used: null,
  updatedAt: 0,
  pausedUntil: 0,
};

export function ingestProplineHeaders(headers) {
  if (!headers) return;
  const remain = headers['x-requests-remaining'] ?? headers['X-Requests-Remaining'];
  const used = headers['x-requests-used'] ?? headers['X-Requests-Used'];
  if (remain != null) _state.remain = Number(remain);
  if (used != null) _state.used = Number(used);
  _state.updatedAt = Date.now();

  if (_state.remain != null && _state.remain <= RESERVE) {
    _state.pausedUntil = Date.now() + 15 * 60 * 1000;
    log.warn({ remain: _state.remain, reserve: RESERVE }, 'PropLine quota bas — pause 15 min');
  }
}

export function markQuotaExceeded() {
  _state.pausedUntil = Date.now() + 30 * 60 * 1000;
  _state.remain = 0;
  log.warn('PropLine daily limit — pause sync 30 min');
}

export function canUsePropline(requestCount = 1) {
  if (Date.now() < _state.pausedUntil) return false;
  if (_state.remain == null) return true;
  return _state.remain >= requestCount + RESERVE;
}

export function getProplineQuotaState() {
  return { ..._state, dailyBudget: DAILY_BUDGET, reserve: RESERVE };
}
