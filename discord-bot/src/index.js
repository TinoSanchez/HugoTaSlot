import http from 'node:http';
import { config } from './config.js';
import { logger } from './lib/logger.js';
import { client, login } from './discord/client.js';
import { registerInteractionHandlers } from './discord/commands.js';
import { refreshGuildCommands } from './discord/commands-refresh.js';
import { refreshOpenEmbedIfNeeded } from './discord/prono.js';
import { getBotState } from './supabase.js';
import { startScheduler } from './jobs/scheduler.js';
import { ping as pingSupabase } from './supabase.js';
import { runCasinoCheck } from './jobs/casino-watcher.js';
import { announceManualPending, runSlotsCheck } from './jobs/slot-watcher.js';

/** Obligatoire sur Railway/Docker : sinon rien n’est joignable depuis l’extérieur du conteneur (healthcheck = 503). */
const LISTEN_HOST = process.env.HOST || '0.0.0.0';

function healthPath(reqUrl) {
  const path = String(reqUrl || '').split('?')[0] || '/';
  return path.replace(/\/+$/, '') || '/';
}

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function authorizeInternal(req) {
  const expected = (process.env.INTERNAL_JOB_SECRET || '').trim();
  if (!expected) return false;
  const auth = String(req.headers.authorization || '');
  if (auth === `Bearer ${expected}`) return true;
  const url = new URL(req.url || '/', 'http://local');
  return url.searchParams.get('secret') === expected;
}

let _casinoPassRunning = false;

async function main() {
  logger.info({ port: config.port, envPort: process.env.PORT ?? '(unset)' }, 'Démarrage du bot HugoTaSlot…');

  // Healthcheck HTTP (Railway / uptime monitors) + jobs internes
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
    if (p === '/internal/casino-pass' && (req.method === 'POST' || req.method === 'GET')) {
      if (!authorizeInternal(req)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (_casinoPassRunning) {
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'already_running' }));
        return;
      }
      _casinoPassRunning = true;
      res.writeHead(202, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'started' }));
      (async () => {
        try {
          logger.info('Passe casino manuelle (HTTP) — début');
          const bigwin = await runSlotsCheck().catch((e) => ({ error: e.message }));
          const casino = await runCasinoCheck().catch((e) => ({ error: e.message }));
          const announce = await announceManualPending().catch((e) => ({ error: e.message }));
          logger.info({ bigwin, casino, announce }, 'Passe casino manuelle (HTTP) — fin');
        } catch (e) {
          logger.error({ err: e }, 'Passe casino manuelle échouée');
        } finally {
          _casinoPassRunning = false;
        }
      })();
      return;
    }
    readBody(req).catch(() => '');
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

  // Toujours re-push les slash commands au boot (nouvelles commandes + état dynamique prono).
  try {
    const active = await getBotState('active_prono_match');
    const matchOk = !!(active?.matchId && active?.teamA && active?.teamB);
    await refreshGuildCommands({ activeMatch: matchOk ? active : null });
    if (matchOk) {
      await refreshOpenEmbedIfNeeded(client, active);
      logger.info({ teamA: active.teamA, teamB: active.teamB }, 'Prono actif détecté → embed d’ouverture resynchronisé');
    }
  } catch (e) { logger.warn({ err: e }, 'Re-sync commandes/prono au boot échoué'); }

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
