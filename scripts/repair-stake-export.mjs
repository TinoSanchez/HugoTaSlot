import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/repair-stake-export.mjs <path-json>");
  process.exit(1);
}

const filePath = resolve(process.cwd(), input);
const s = readFileSync(filePath, "utf8");

const out = [];
let idx = 0;
while (true) {
  const k = s.indexOf('"game": {', idx);
  if (k === -1) break;
  const start = s.indexOf("{", k);
  if (start === -1) break;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let j = start; j < s.length; j += 1) {
    const ch = s[j];
    if (inStr) {
      if (esc) {
        esc = false;
        continue;
      }
      if (ch === "\\") {
        esc = true;
        continue;
      }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') {
      inStr = true;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        end = j;
        break;
      }
    }
  }
  if (end === -1) break;
  const raw = s.slice(start, end + 1);
  try {
    const g = JSON.parse(raw);
    if (g && (g.slug || g.name)) out.push(g);
  } catch {
    // ignore malformed fragments
  }
  idx = end + 1;
}

const bySlug = new Map();
for (const g of out) {
  const key = String(g.slug || g.name || "").toLowerCase();
  if (!key) continue;
  if (!bySlug.has(key)) bySlug.set(key, g);
}
const cleaned = [...bySlug.values()];

if (!cleaned.length) {
  console.error("Aucun bloc game exploitable trouvé.");
  process.exit(2);
}

writeFileSync(filePath, JSON.stringify(cleaned, null, 2), "utf8");
console.log(`Export réparé: ${cleaned.length} jeux extraits -> ${filePath}`);
