/**
 * inject-page-html.mjs
 *
 * Extrait chaque <div class="page-panel" id="page-*"> de index.html,
 * les convertit en template literals JS dans un objet __PAGE_HTML,
 * les insère dans app.js juste avant LAZY_PAGE_SCRIPTS,
 * et remplace les blocs dans index.html par un simple <div id="page-mount">.
 */

import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const ROOT = join(dirname(decodeURIComponent(fileURLToPath(import.meta.url))), '..');
const HTML_FILE = join(ROOT, 'index.html');
const APP_FILE  = join(ROOT, 'app.js');

// ─── 1. Lire index.html ────────────────────────────────────────────────────
let html = readFileSync(HTML_FILE, 'utf8');
const lines = html.split('\n');

// Trouver les blocs <!-- PAGE: ... --> + <div class="page-panel" id="page-*">
// On cherche la ligne du premier bloc et la fin des panels.
// La stratégie : trouver toutes les balises ouvrantes, matcher la balise fermante
// correspondante en suivant la profondeur.

const PAGE_SECTION_COMMENT = '<!-- ─── PAGES SUPPLÉMENTAIRES ─── -->';
const PAGE_SECTION_START_IDX = lines.findIndex(l => l.trim() === '<!-- ─── PAGES SUPPLÉMENTAIRES ─── -->');

// Ligne de début de la zone à remplacer (le commentaire ou la première div panel)
// On cherche la première div page-panel
const firstPanelIdx = lines.findIndex(l => /class="page-panel"/.test(l));
// La ligne de commentaire juste avant (si présente)
const sectionStart = PAGE_SECTION_START_IDX >= 0 ? PAGE_SECTION_START_IDX : firstPanelIdx;

// Trouver la fin : dernière </div> qui ferme la dernière page-panel
// On cherche la dernière page-panel et on suit la profondeur
const panelStarts = [];
lines.forEach((l, i) => {
  if (/class="page-panel"/.test(l)) panelStarts.push(i);
});

if (panelStarts.length === 0) {
  console.error('❌ Aucune page-panel trouvée dans index.html');
  process.exit(1);
}

// Pour chaque panel, extraire le contenu complet en suivant la profondeur
const panels = {}; // id -> html string

for (const startLine of panelStarts) {
  // Récupérer l'ID
  const m = lines[startLine].match(/id="page-([^"]+)"/);
  if (!m) continue;
  const pageId = m[1];

  // Suivre la profondeur
  let depth = 0;
  let end = startLine;
  for (let i = startLine; i < lines.length; i++) {
    const l = lines[i];
    // Compter les balises ouvrantes et fermantes
    const opens = (l.match(/<div[^>]*>/g) || []).length;
    const closes = (l.match(/<\/div>/g) || []).length;
    depth += opens - closes;
    if (i === startLine && depth === 0) {
      // Panel en une ligne (peu probable mais possible)
      end = i;
      break;
    }
    if (i > startLine && depth <= 0) {
      end = i;
      break;
    }
  }

  const panelLines = lines.slice(startLine, end + 1);
  panels[pageId] = panelLines.join('\n');
}

console.log('📦 Panels trouvés :', Object.keys(panels).join(', '));

// ─── 2. Construire le bloc JS __PAGE_HTML ──────────────────────────────────

// Échapper les backticks et ${} dans le HTML
function escapeTemplate(s) {
  return s.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$\{/g, '\\${');
}

const entries = Object.entries(panels).map(([id, panelHtml]) => {
  const key = id; // e.g. "home", "admin", "blackjack"
  const escaped = escapeTemplate(panelHtml);
  return `  ${key}: \`\n${escaped}\n  \``;
});

const PAGE_HTML_BLOCK = `// ─── TEMPLATES HTML DES PAGES (injectés dynamiquement par switchPage) ───────
// Chaque page n'est dans le DOM que quand l'utilisateur la visite.
// Le HTML est injecté dans <div id="page-mount"> puis retiré lors de la navigation.
const __PAGE_HTML = {
${entries.join(',\n')}
};
`;

// ─── 3. Insérer dans app.js avant LAZY_PAGE_SCRIPTS ───────────────────────
let app = readFileSync(APP_FILE, 'utf8');

const ANCHOR = 'const LAZY_PAGE_SCRIPTS = Object.freeze({';
if (!app.includes(ANCHOR)) {
  console.error('❌ Ancre LAZY_PAGE_SCRIPTS introuvable dans app.js');
  process.exit(1);
}

// Éviter les doublons
if (app.includes('const __PAGE_HTML =')) {
  console.log('ℹ️  __PAGE_HTML déjà présent dans app.js, remplacement...');
  app = app.replace(/\/\/ ─── TEMPLATES HTML DES PAGES[\s\S]*?^};\n/m, '');
}

app = app.replace(ANCHOR, PAGE_HTML_BLOCK + '\n' + ANCHOR);
writeFileSync(APP_FILE, app, 'utf8');
console.log('✅ __PAGE_HTML inséré dans app.js');

// ─── 4. Remplacer les panels dans index.html par #page-mount ──────────────
const lastPanelEnd = (() => {
  // Trouver la ligne de fin du dernier panel
  let maxEnd = 0;
  for (const startLine of panelStarts) {
    let depth = 0;
    for (let i = startLine; i < lines.length; i++) {
      const l = lines[i];
      const opens = (l.match(/<div[^>]*>/g) || []).length;
      const closes = (l.match(/<\/div>/g) || []).length;
      depth += opens - closes;
      if (i === startLine && depth === 0) { maxEnd = Math.max(maxEnd, i); break; }
      if (i > startLine && depth <= 0) { maxEnd = Math.max(maxEnd, i); break; }
    }
  }
  return maxEnd;
})();

// Construire le nouveau index.html
const newLines = [
  ...lines.slice(0, sectionStart),
  '<!-- ─── PAGES SUPPLÉMENTAIRES (injectées dynamiquement) ─── -->',
  '<div id="page-mount"></div>',
  '',
  ...lines.slice(lastPanelEnd + 1),
];

writeFileSync(HTML_FILE, newLines.join('\n'), 'utf8');
console.log(`✅ index.html : panels supprimés (lignes ${sectionStart + 1}–${lastPanelEnd + 1}), #page-mount ajouté`);
console.log('   Nouvelles lignes :', newLines.length);
