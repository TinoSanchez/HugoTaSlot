/**
 * Bundle discord-activity/main.js → web/dist/discord-activity/main.js
 */
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'esbuild';

const root = process.cwd();
const srcDir = resolve(root, 'discord-activity');
const outDir = resolve(root, 'web', 'dist', 'discord-activity');
const assetsSrc = resolve(root, 'discord-bot', 'assets', 'rich-presence');

if (!existsSync(srcDir)) {
  console.log('discord-activity: skip (dossier absent)');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(srcDir, 'main.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  outfile: resolve(outDir, 'main.js'),
  logLevel: 'warning',
});

for (const f of ['index.html', 'style.css']) {
  cpSync(resolve(srcDir, f), resolve(outDir, f));
}

mkdirSync(resolve(outDir, 'assets'), { recursive: true });
for (const img of ['image_19.png', 'gamdom.png']) {
  const from = resolve(assetsSrc, img);
  if (existsSync(from)) cpSync(from, resolve(outDir, 'assets', img));
}

const clientId = process.env.DISCORD_CLIENT_ID || process.env.VITE_DISCORD_CLIENT_ID || '1523009433771315411';
writeFileSync(resolve(outDir, 'config.json'), JSON.stringify({
  clientId,
  siteUrl: process.env.SITE_URL || 'https://hugotaslot.fr',
}, null, 2));

console.log(`discord-activity → ${outDir}${clientId ? '' : ' (DISCORD_CLIENT_ID non défini au build)'}`);
