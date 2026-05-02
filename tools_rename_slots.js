const fs = require("fs");

const filePath = "C:/Users/mathi/Desktop/site BH 1.02/jeux.json";
const raw = fs.readFileSync(filePath, "utf8");
const data = JSON.parse(raw);

function cleanNameConservative(name, provider) {
  let cleaned = String(name || "");
  cleaned = cleaned
    .replace(/\brtp\s*boosted\b/gi, " ")
    .replace(/\bboosted\b/gi, " ")
    .replace(/\brtp\b/gi, " ")
    .replace(/\b\d{1,3}(?:[.,]\d+)?\s*%\b/g, " ")
    .replace(/\bgame\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

  if (provider) {
    const esc = String(provider).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned
      .replace(new RegExp(`\\b${esc}\\b`, "gi"), " ")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return cleaned || String(name || "Slot").trim() || "Slot";
}

let changed = 0;
const updated = data.map((slot) => {
  const nextName = cleanNameConservative(slot.nom, slot.provider);
  if (nextName !== slot.nom) {
    changed++;
    return { ...slot, nom: nextName };
  }
  return slot;
});

fs.writeFileSync(filePath, JSON.stringify(updated, null, 2), "utf8");
console.log(`Renamed ${changed} / ${updated.length} slots`);
