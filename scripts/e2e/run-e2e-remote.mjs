/**
 * E2E Playwright contre une URL distante (prod / preview).
 * Usage : E2E_BASE_URL=https://hugotaslot.fr node scripts/e2e/run-e2e-remote.mjs
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASE = (process.env.E2E_BASE_URL || 'https://hugotaslot.fr').replace(/\/$/, '');

function waitForServer(url, ms = 60_000) {
  const t0 = Date.now();
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (r.ok || r.status === 404) return resolve();
      } catch (_) { /* retry */ }
      if (Date.now() - t0 > ms) return reject(new Error(`Site indisponible: ${url}`));
      setTimeout(tick, 500);
    };
    tick();
  });
}

const scripts = ['auth-smoke.mjs', 'site-smoke.mjs'];

try {
  console.log(`E2E remote → ${BASE}\n`);
  await waitForServer(`${BASE}/`);
  for (const name of scripts) {
    console.log(`\n▶ ${name}\n`);
    const e2e = spawn(process.execPath, [`scripts/e2e/${name}`], {
      cwd: ROOT,
      env: { ...process.env, E2E_BASE_URL: BASE },
      stdio: 'inherit',
    });
    const code = await new Promise((res) => e2e.on('close', res));
    if (code !== 0) process.exit(code || 1);
  }
  console.log(`\nE2E remote OK — ${BASE}`);
} catch (e) {
  console.error(e.message || e);
  process.exit(1);
}
