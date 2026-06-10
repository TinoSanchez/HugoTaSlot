import http from 'node:http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { client, login } from './discord/client.js';
import { registerInteractionHandlers } from './discord/commands.js';
import { startScheduler } from './jobs/scheduler.js';
import { ping as pingSupabase } from './supabase.js';

/** Obligatoire sur Railway/Docker : sinon rien n’est joignable depuis l’extérieur du conteneur (healthcheck = 503). */
const LISTEN_HOST = process.env.HOST || '0.0.0.0';

function healthPath(reqUrl) {
  const path = String(reqUrl || '').split('?')[0] || '/';
  return path.replace(/\/+$/, '') || '/';
}

async function main() {
  logger.info({ port: config.port, envPort: process.env.PORT ?? '(unset)' }, 'Démarrage du bot HugoTaSlot…');

  // Healthcheck HTTP (Railway / uptime monitors)
  const server = http.createServer((req, res) => {
    // Toujours HTTP 200 pour Railway : un 503 pendant la connexion Discord faisait échouer le healthcheck réseau.
    const p = healthPath(req.url);
    if (p === '/healthz' || p === '/') {
      const discordReady = client.isReady();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        status: 'ok',
        discord: discordReady ? 'ready' : 'starting',
        uptime: process.uptime(),
      }));
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise((resolve, reject) => {
    server.listen(config.port, LISTEN_HOST, () => {
      logger.info({ port: config.port, host: LISTEN_HOST }, 'Healthcheck HTTP en écoute');
      resolve();
    });
    server.once('error', reject);
  });

  // Vérification Supabase au démarrage (non bloquante en cas d'échec ponctuel)
  try {
    const ok = await pingSupabase();
    logger.info({ ok }, 'Ping Supabase');
  } catch (e) { logger.warn({ err: e }, 'Ping Supabase échoué (le bot continue)'); }

  // Handlers d'interactions, puis login Discord
  registerInteractionHandlers(client);
  await login();

  // Une fois prêt, on arme le scheduler (ne doit pas faire crasher le process : sinon bot hors ligne)
  const armScheduler = () => {
    try {
      startScheduler();
    } catch (e) {
      logger.error({ err: e }, 'Scheduler impossible — vérifie CRON_YOUTUBE / CRON_SLOTS / CRON_CASINO sur Railway');
    }
  };
  if (client.isReady()) armScheduler();
  else client.once('ready', armScheduler);

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
