const fs = require("fs");
const path = require("path");
const { createWorker } = require("tesseract.js");

const ROOT = "C:/Users/mathi/Desktop/site BH 1.02";
const JSON_PATH = path.join(ROOT, "jeux.json");
const CACHE_PATH = path.join(ROOT, "ocr-cache.json");

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const startArg = args.find((a) => a.startsWith("--start="));
const dryRun = args.includes("--dry-run");
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;
const start = startArg ? Number(startArg.split("=")[1]) : 0;

const BAD_WORDS = [
  "rtp",
  "boosted",
  "rtp boosted",
  "provider",
  "slot",
  "game",
];

function loadJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

function saveJson(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}

function cleanSpaces(v) {
  return String(v || "")
    .replace(/\s{2,}/g, " ")
    .replace(/\n+/g, " ")
    .trim();
}

function removeProvider(text, provider) {
  if (!provider) return text;
  const esc = provider.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return text.replace(new RegExp(`\\b${esc}\\b`, "ig"), " ");
}

function scoreLine(line, provider) {
  const raw = cleanSpaces(line);
  if (!raw) return -999;
  const low = raw.toLowerCase();
  if (BAD_WORDS.some((w) => low.includes(w))) return -200;
  if (provider && low.includes(provider.toLowerCase())) return -150;
  if (/^\d+$/.test(raw)) return -120;
  if (raw.length < 3) return -80;
  const alphaCount = (raw.match(/[a-zA-Z]/g) || []).length;
  if (alphaCount < 2) return -60;
  // Favor short-medium title-like strings
  let score = alphaCount;
  if (raw.length > 50) score -= 20;
  if (/[|/\\]/.test(raw)) score -= 10;
  return score;
}

function pickBestName(ocrText, provider, fallbackName) {
  const lines = ocrText
    .split(/\r?\n/)
    .map((l) => cleanSpaces(removeProvider(l, provider)))
    .filter(Boolean);

  if (!lines.length) return fallbackName;

  const sorted = lines
    .map((line) => ({ line, score: scoreLine(line, provider) }))
    .sort((a, b) => b.score - a.score);

  const best = sorted[0];
  if (!best || best.score < 2) return fallbackName;

  return cleanSpaces(
    best.line
      .replace(/\brtp\s*boosted\b/gi, "")
      .replace(/\bboosted\b/gi, "")
      .replace(/\brtp\b/gi, "")
      .replace(/\s{2,}/g, " ")
  );
}

async function run() {
  const slots = loadJson(JSON_PATH, []);
  const cache = loadJson(CACHE_PATH, {});

  const worker = await createWorker("eng");
  let processed = 0;
  let changed = 0;

  for (let i = start; i < slots.length && processed < limit; i++) {
    const slot = slots[i];
    const imageUrl = slot.image;
    const provider = slot.provider || "";
    const oldName = slot.nom || "";

    if (!imageUrl || typeof imageUrl !== "string") continue;

    let newName = oldName;

    if (cache[imageUrl] && cache[imageUrl].name) {
      newName = cache[imageUrl].name;
    } else {
      try {
        const result = await worker.recognize(imageUrl);
        const ocrText = result?.data?.text || "";
        const confidence = Number(result?.data?.confidence || 0);

        const picked = pickBestName(ocrText, provider, oldName);
        const finalName = cleanSpaces(removeProvider(picked, provider)) || oldName;

        cache[imageUrl] = {
          name: finalName,
          confidence,
          sample: cleanSpaces(ocrText).slice(0, 180),
        };
        newName = finalName;
      } catch (err) {
        cache[imageUrl] = {
          name: oldName,
          confidence: 0,
          sample: "",
          error: String(err.message || err),
        };
      }
    }

    // Final guardrails requested by user
    let guarded = cleanSpaces(newName)
      .replace(/\brtp\s*boosted\b/gi, "")
      .replace(/\bboosted\b/gi, "")
      .replace(/\brtp\b/gi, "")
      .trim();
    guarded = cleanSpaces(removeProvider(guarded, provider));
    if (!guarded) guarded = oldName;

    if (guarded !== oldName) {
      slots[i].nom = guarded;
      changed++;
    }

    processed++;
    if (processed % 20 === 0) {
      saveJson(CACHE_PATH, cache);
      if (!dryRun) saveJson(JSON_PATH, slots);
      console.log(`Processed ${processed} | Changed ${changed} | index ${i}`);
    }
  }

  await worker.terminate();
  saveJson(CACHE_PATH, cache);
  if (!dryRun) saveJson(JSON_PATH, slots);
  console.log(`DONE | Processed ${processed} | Changed ${changed}`);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
