import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const outDir = resolve(root, "web", "dist");

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

const copyTargets = [
  "index.html",
  "mini-opener.html",
  "jeux.json",
  "assets",
  "styles.css",
  "app.js",
  "accounts.js",
  "games.js",
  "hunts.js",
  "slots.js",
  "jeux-data.js",
  "jeux-embed.js",
];

for (const target of copyTargets) {
  const src = resolve(root, target);
  if (!existsSync(src)) continue;
  const dest = resolve(outDir, target);
  cpSync(src, dest, { recursive: true });
}

console.log("Build original site complete:", outDir);
