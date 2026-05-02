import http from 'node:http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { client, login } from './discord/client.js';
import { registerInteractionHandlers } from './discord/commands.js';
import { startScheduler } from './jobs/scheduler.js';
import { ping as pingSupabase } from './supabase.js';

async function main() {
  logger.info('Démarrage du bot HugoTaSlot…');

  // Healthcheck HTTP (Railway / uptime monitors)
  const server = http.createServer((req, res) => {
    if (req.url === '/healthz' || req.url === '/') {
      const ready = client.isReady();
      const status = ready ? 200 : 503;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: ready ? 'ok' : 'starting', uptime: process.uptime() }));
      return;
    }
    res.writeHead(404).end();
  });
  server.listen(config.port, () => logger.info({ port: config.port }, 'Healthcheck HTTP en écoute'));

  // Vérification Supabase au démarrage (non bloquante en cas d'échec ponctuel)
  try {
    const ok = await pingSupabase();
    logger.info({ ok }, 'Ping Supabase');
  } catch (e) { logger.warn({ err: e }, 'Ping Supabase échoué (le bot continue)'); }

  // Handlers d'interactions, puis login Discord
  registerInteractionHandlers(client);
  await login();

  // Une fois prêt, on arme le scheduler
  if (client.isReady()) startScheduler();
  else client.once('ready', () => startScheduler());

  // Arrêt propre
  const shutdown = (sig) => () => {
    logger.info({ sig }, 'Signal reçu, arrêt');
    Promise.resolve()
      .then(() => server.close())
      .then(() => client.destroy())
      .finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown('SIGINT'));
  process.on('SIGTERM', shutdown('SIGTERM'));
}

main().catch((e) => {
  logger.error({ err: e }, 'Fatal au démarrage');
  process.exit(1);
});
