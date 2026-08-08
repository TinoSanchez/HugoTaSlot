import { runSportsEspnScoresSync } from '../src/jobs/sports-espn-scores-sync.js';

const r = await runSportsEspnScoresSync();
console.log(JSON.stringify(r));
