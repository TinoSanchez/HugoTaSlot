import cron from 'node-cron';

import { config } from '../config.js';

import { child } from '../lib/logger.js';

import { runYoutubeCheck } from './youtube-watcher.js';

import { runRumbleCheck } from './rumble-watcher.js';

import { runRumbleLiveCheck } from './rumble-live-watcher.js';

import { runSlotsCheck, announceManualPending } from './slot-watcher.js';

import { runCasinoCheck } from './casino-watcher.js';

import { runSportsOddsSync } from './sports-odds-sync.js';

import { runSportsScoresSync } from './sports-scores-sync.js';

import { runSportsEspnScoresSync } from './sports-espn-scores-sync.js';

import { runSportsBetsSettle } from './sports-bets-settle.js';



const log = child({ mod: 'scheduler' });



const CRON_CASINO = process.env.CRON_CASINO || '*/30 * * * *';



let _running = { youtube: false, rumble: false, rumbleLive: false, slots: false, manual: false, casino: false, sportsOdds: false, sportsScores: false, sportsEspnScores: false, sportsSettle: false };

let _scoresFastTimer = null;

let _espnFastTimer = null;



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



function armFastScoreLoops() {

  if (_scoresFastTimer) clearInterval(_scoresFastTimer);

  if (_espnFastTimer) clearInterval(_espnFastTimer);



  _scoresFastTimer = setInterval(

    () => safe('sportsScores', runSportsScoresSync),

    config.propline.scoresIntervalMs,

  );

  _espnFastTimer = setInterval(

    () => safe('sportsEspnScores', runSportsEspnScoresSync),

    config.propline.espnScoresIntervalMs,

  );



  log.info(

    {

      proplineScoresMs: config.propline.scoresIntervalMs,

      espnScoresMs: config.propline.espnScoresIntervalMs,

    },

    'Fast score loops armés',

  );

}



export function startScheduler() {

  if (!cron.validate(config.cron.youtube)) {

    throw new Error(`CRON_YOUTUBE invalide: ${JSON.stringify(config.cron.youtube)}`);

  }

  if (!cron.validate(config.cron.rumble)) {

    throw new Error(`CRON_RUMBLE invalide: ${JSON.stringify(config.cron.rumble)}`);

  }

  if (!cron.validate(config.cron.rumbleLive)) {

    throw new Error(`CRON_RUMBLE_LIVE invalide: ${JSON.stringify(config.cron.rumbleLive)}`);

  }

  if (!cron.validate(config.cron.slots)) {

    throw new Error(`CRON_SLOTS invalide: ${JSON.stringify(config.cron.slots)}`);

  }

  if (!cron.validate(CRON_CASINO)) {

    throw new Error(`CRON_CASINO invalide: ${JSON.stringify(CRON_CASINO)}`);

  }

  if (!cron.validate(config.cron.sportsOdds)) {

    throw new Error(`CRON_SPORTS_ODDS invalide: ${JSON.stringify(config.cron.sportsOdds)}`);

  }

  if (!cron.validate(config.cron.sportsScores)) {

    throw new Error(`CRON_SPORTS_SCORES invalide: ${JSON.stringify(config.cron.sportsScores)}`);

  }

  if (!cron.validate(config.cron.sportsSettle)) {

    throw new Error(`CRON_SPORTS_SETTLE invalide: ${JSON.stringify(config.cron.sportsSettle)}`);

  }



  cron.schedule(config.cron.youtube, () => safe('youtube', runYoutubeCheck));

  cron.schedule(config.cron.rumble, () => safe('rumble', runRumbleCheck));

  cron.schedule(config.cron.rumbleLive, () => safe('rumbleLive', runRumbleLiveCheck));

  cron.schedule(config.cron.slots, () => safe('slots', runSlotsCheck));

  cron.schedule(CRON_CASINO, () => safe('casino', runCasinoCheck));

  cron.schedule(config.cron.sportsOdds, () => safe('sportsOdds', runSportsOddsSync));

  cron.schedule(config.cron.sportsScores, () => safe('sportsScores', runSportsScoresSync));

  cron.schedule(config.cron.sportsSettle, () => safe('sportsSettle', runSportsBetsSettle));

  cron.schedule('*/2 * * * *', () => safe('manual', announceManualPending));



  armFastScoreLoops();



  log.info(

    {

      youtube: config.cron.youtube, rumble: config.cron.rumble, rumbleLive: config.cron.rumbleLive,

      slots: config.cron.slots, casino: CRON_CASINO,

      sportsOdds: config.cron.sportsOdds, sportsScores: config.cron.sportsScores,

      sportsSettle: config.cron.sportsSettle,

      oddsScope: config.propline.oddsScope,

    },

    'Scheduler armé',

  );



  setTimeout(() => {

    safe('youtube', runYoutubeCheck);

    safe('rumble', runRumbleCheck);

    safe('rumbleLive', runRumbleLiveCheck);

    safe('slots', runSlotsCheck);

    safe('casino', runCasinoCheck);

    safe('manual', announceManualPending);

    safe('sportsOdds', runSportsOddsSync);

    safe('sportsScores', runSportsScoresSync);

    safe('sportsEspnScores', runSportsEspnScoresSync);

    safe('sportsSettle', runSportsBetsSettle);

  }, Math.max(2000, config.cron.initialDelayMs));

}


