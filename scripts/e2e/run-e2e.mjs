/**
 * Lance serve.js + smoke E2E Playwright (local / CI).
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = Number(process.env.PORT) || 8765;
const BASE = `http://127.0.0.1:${PORT}`;

function waitForServer(url, ms = 30_000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(2000) });
        if (r.ok || r.status === 404) return resolve();
      } catch (_) { /* retry */ }
      if (Date.now() - t0 > ms) return reject(new Error(`Serveur indisponible: ${url}`));
      setTimeout(tick, 300);
    };
    tick();
  });
}

const server = spawn(process.execPath, ['serve.js'], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT) },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverOut = '';
server.stdout?.on('data', (d) => { serverOut += d; });
server.stderr?.on('data', (d) => { serverOut += d; });

try {
  await waitForServer(`${BASE}/`);
  const e2e = spawn(process.execPath, ['scripts/e2e/site-smoke.mjs'], {
    cwd: ROOT,
    env: { ...process.env, E2E_BASE_URL: BASE },
    stdio: 'inherit',
  });
  const code = await new Promise((res) => e2e.on('close', res));
  if (code !== 0) process.exit(code || 1);
} catch (e) {
  console.error(e.message || e);
  if (serverOut) console.error(serverOut.slice(-2000));
  process.exit(1);
} finally {
  server.kill('SIGTERM');
}
