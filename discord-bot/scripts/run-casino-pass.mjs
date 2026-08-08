/**
 * Passe manuelle : scrape toutes les sources casino + annonce Discord des nouveautés.
 * Usage local :  node scripts/run-casino-pass.mjs
 * Usage Railway (recommandé hors FR / ANJ) :
 *   railway run node scripts/run-casino-pass.mjs
 */
import 'dotenv/config';

if (!process.env.CASINO_SOURCES?.trim()) {
  process.env.CASINO_SOURCES = 'slotcatalog,slotreport,stake,gamdom,shuffle,celsius';
}

const { login, client } = await import('../src/discord/client.js');
const { runCasinoCheck } = await import('../src/jobs/casino-watcher.js');
const { announceManualPending } = await import('../src/jobs/slot-watcher.js');
const { logger } = await import('../src/lib/logger.js');

async function main() {
  const sources = process.env.CASINO_SOURCES;
  logger.info({ sources, slotsChannel: process.env.DISCORD_CHANNEL_SLOTS || '(unset)' }, 'Passe casino — début');

  await login();
  await new Promise((resolve) => {
    if (client.isReady()) return resolve();
    client.once('ready', resolve);
  });

  const check = await runCasinoCheck();
  logger.info({ check }, 'Passe casino — fetch/insert terminé');

  const ann = await announceManualPending();
  logger.info({ ann }, 'Passe casino — annonces Discord terminées');

  const results = check?.results || [];
  const fetched = results.reduce((s, r) => s + (r.fetched || 0), 0);
  const inserted = results.reduce((s, r) => s + (r.inserted || 0), 0);
  console.log(JSON.stringify({
    sources,
    results,
    fetched,
    inserted,
    announced: ann?.posted ?? 0,
    announceError: ann?.error || null,
  }, null, 2));

  client.destroy();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
