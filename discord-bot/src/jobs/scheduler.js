import cron from 'node-cron';
import { config } from '../config.js';
import { child } from '../lib/logger.js';
import { runYoutubeCheck } from './youtube-watcher.js';
import { runSlotsCheck, announceManualPending } from './slot-watcher.js';
import { runCasinoCheck } from './casino-watcher.js';

const log = child({ mod: 'scheduler' });

const CRON_CASINO = process.env.CRON_CASINO || '*/30 * * * *';

let _running = { youtube: false, slots: false, manual: false, casino: false };

async function safe(name, fn) {
  if (_running[name]) { log.debug({ name }, 'job already running, skip'); return; }
  _running[name] = true;
  const t = Date.now();
  try {
    const r = await fn();
    log.info({ name, ms: Date.now() - t, r }, 'job done');
  } catch (e) {
    log.error({ name, err: e }, 'job failed');
  } finally {
    _running[name] = false;
  }
}

export function startScheduler() {
  if (!cron.validate(config.cron.youtube)) throw new Error(`CRON_YOUTUBE invalide: ${config.cron.youtube}`);
  if (!cron.validate(config.cron.slots)) throw new Error(`CRON_SLOTS invalide: ${config.cron.slots}`);
  if (!cron.validate(CRON_CASINO)) throw new Error(`CRON_CASINO invalide: ${CRON_CASINO}`);

  cron.schedule(config.cron.youtube, () => safe('youtube', runYoutubeCheck));
  cron.schedule(config.cron.slots, () => safe('slots', runSlotsCheck));
  cron.schedule(CRON_CASINO, () => safe('casino', runCasinoCheck));
  // Annonces en attente (manuel + scrapers) : check fréquent (toutes les 2 minutes)
  cron.schedule('*/2 * * * *', () => safe('manual', announceManualPending));

  log.info(
    { youtube: config.cron.youtube, slots: config.cron.slots, casino: CRON_CASINO },
    'Scheduler armé'
  );

  // Premier passage retardé pour laisser Discord se logger
  setTimeout(() => {
    safe('youtube', runYoutubeCheck);
    safe('slots', runSlotsCheck);
    safe('casino', runCasinoCheck);
    safe('manual', announceManualPending);
  }, Math.max(2000, config.cron.initialDelayMs));
}
