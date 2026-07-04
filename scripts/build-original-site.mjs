import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";
import { optimizeCatalogArray } from "./lib/optimize-catalog-json.mjs";

const root = process.cwd();

execSync("node scripts/build-boot-bundle.mjs", { cwd: root, stdio: "inherit" });
execSync("node scripts/build-discord-activity.mjs", { cwd: root, stdio: "inherit" });
const outDir = resolve(root, "web", "dist");

// Version de cache service worker : calculée une fois pour le build
const now = new Date();
const buildStamp = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}-${String(now.getHours()).padStart(2,'0')}${String(now.getMinutes()).padStart(2,'0')}`;

if (existsSync(outDir)) {
  rmSync(outDir, { recursive: true, force: true });
}
mkdirSync(outDir, { recursive: true });

// index.html + styles.css + app.js : site principal (voir scripts/split-index-html.mjs)
const copyTargets = [
  "index.html",
  "trailer.html",
  "roue-multi-tirages.html",
  "roue-tournoi-equipes.html",
  "mini-opener.html",
  "hunt-live.html",
  "streamer-hud.html",
  "assets",
  "styles.css",
  "styles-blackjack.css",
  "styles-hub.css",
  "app.js",
  "product-changelog.json",
  "jeux-embed.js", // secours hors-ligne ; non chargé par défaut
  "manifest.webmanifest",
  "sw.js",
];

for (const target of copyTargets) {
  const src = resolve(root, target);
  if (!existsSync(src)) continue;
  const dest = resolve(outDir, target);
  if (target === "sw.js") {
    // Bumper la version de cache à chaque build pour invalider automatiquement chez les clients
    const swContent = readFileSync(src, "utf8")
      .replace(/const CACHE = 'hugotaslot-shell-[^']*';/, `const CACHE = 'hugotaslot-shell-${buildStamp}';`);
    writeFileSync(dest, swContent, "utf8");
  } else {
    cpSync(src, dest, { recursive: true });
  }
}

// Lazy page scripts (chargés à la demande selon LAZY_PAGE_SCRIPTS dans app.js)
const pagesSrc = resolve(root, "scripts", "pages");
if (existsSync(pagesSrc)) {
  cpSync(pagesSrc, resolve(outDir, "scripts", "pages"), { recursive: true });
}

const jeuxSrc = resolve(root, "jeux.json");
if (existsSync(jeuxSrc)) {
  const raw = JSON.parse(readFileSync(jeuxSrc, "utf8"));
  const optimized = optimizeCatalogArray(raw);
  writeFileSync(resolve(outDir, "jeux.json"), JSON.stringify(optimized));
  const before = Buffer.byteLength(readFileSync(jeuxSrc));
  const after = Buffer.byteLength(JSON.stringify(optimized));
  console.log(`jeux.json optimisé pour dist: ${(before / 1024).toFixed(0)} KiB → ${(after / 1024).toFixed(0)} KiB`);
}

console.log("Build original site complete:", outDir);
