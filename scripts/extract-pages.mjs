/**
 * Passe 2 — Extraction des pages lazy depuis app.js
 *
 * Usage : node scripts/extract-pages.mjs
 *
 * Ce script :
 * 1. Lit app.js en tableau de lignes (1-indexed).
 * 2. Coupe chaque bloc défini dans EXTRACTIONS et l'écrit dans scripts/pages/*.js.
 * 3. Reconstruit app.js en remplaçant les blocs par une ligne de commentaire.
 * 4. Vérifie la syntaxe de chaque fichier généré.
 *
 * IMPORTANT : les numéros de lignes correspondent à la version Passe 1 d'app.js.
 * Relancer après toute modification manuelle du fichier les rendra obsolètes.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';

const ROOT = decodeURIComponent(new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1'));
const APP_JS = path.join(ROOT, 'app.js');
const PAGES_DIR = path.join(ROOT, 'scripts', 'pages');

mkdirSync(PAGES_DIR, { recursive: true });

const rawLines = readFileSync(APP_JS, 'utf8').split('\n');
// Garde les numéros 1-indexed en mémoire (index tableau = ligne-1)

/**
 * Blocs à extraire.
 * Chaque entrée : { file, label, ranges: [[start, end], ...] }
 * start / end sont 1-indexed, inclusifs.
 * Les blocs d'un même fichier seront concaténés dans l'ordre (pour mini-jeux.js).
 *
 * Les lignes sont repérées via les commentaires de section / première ligne unique.
 * Recalculées dynamiquement via indexOf pour être robustes aux décalages mineurs.
 */

// ─── Repères dynamiques (cherche la première occurrence unique) ───
function findLine(pattern, after = 0) {
  const re = typeof pattern === 'string' ? null : pattern;
  for (let i = after; i < rawLines.length; i++) {
    if (re ? re.test(rawLines[i]) : rawLines[i].includes(pattern)) return i + 1; // 1-indexed
  }
  throw new Error(`Pattern introuvable: ${pattern}`);
}

const L = {
  BJ_START:    findLine('// ─── BLACKJACK STRATEGY ───'),
  BJ_END:      findLine('// ─── CALCUL MISE OPTIMALE ───') - 2,

  MISE_START:  findLine('// ─── CALCUL MISE OPTIMALE ───'),
  MISE_END:    findLine('// ─── TOURNOI (Supabase)') - 2,

  TOURNOI_START: findLine('// ─── TOURNOI (Supabase)'),
  TOURNOI_END:   findLine('// ─── MINI JEUX ───') - 2,

  JEUX_P1_START: findLine('// ─── MINI JEUX ───'),
  JEUX_P1_END:   findLine('// ROUE DU DEPOT') - 2,

  ROUE_START:  findLine('// ROUE DU DEPOT'),
  ROUE_END:    findLine('// DICE') - 2,

  JEUX_P2_START: findLine('// DICE'),
  // Le bloc stats commence après : on cherche la ligne qui définit RANK_FAMILIES
  JEUX_P2_END:   findLine(/^const RANK_FAMILIES/) - 2,

  STATS_START: findLine(/^const RANK_FAMILIES/),
  // Les jeux reprennent après setStatsWindow
  STATS_END:   findLine(/^function playGameSfx/) - 2,

  JEUX_P3_START: findLine(/^function playGameSfx/),
  // Fin : juste avant initV101
  JEUX_P3_END:   findLine('// ─── INIT v1.01 ───') - 2,
};

console.log('Repères trouvés :');
Object.entries(L).forEach(([k, v]) => console.log(`  ${k.padEnd(20)} = ${v}`));

// ─── Définition des extractions ───
const EXTRACTIONS = [
  {
    file: 'blackjack.js',
    label: 'Blackjack strategy table + renderBJTable',
    ranges: [[L.BJ_START, L.BJ_END]],
    placeholder: '// [blackjack] — extrait dans scripts/pages/blackjack.js (LAZY_PAGE_SCRIPTS)',
  },
  {
    file: 'mise.js',
    label: 'Calcul mise optimale',
    ranges: [[L.MISE_START, L.MISE_END]],
    placeholder: '// [mise] — extrait dans scripts/pages/mise.js (LAZY_PAGE_SCRIPTS)',
  },
  {
    file: 'tournoi.js',
    label: 'Tournoi (Supabase)',
    ranges: [[L.TOURNOI_START, L.TOURNOI_END]],
    placeholder: '// [tournoi] — extrait dans scripts/pages/tournoi.js (LAZY_PAGE_SCRIPTS)',
  },
  {
    file: 'roue-depot.js',
    label: 'Roue du Dépôt',
    ranges: [[L.ROUE_START, L.ROUE_END]],
    placeholder: '// [roue_depot] — extrait dans scripts/pages/roue-depot.js (LAZY_PAGE_SCRIPTS)',
  },
  {
    file: 'mini-jeux.js',
    label: 'Mini Jeux (lobby + engine + 12 jeux)',
    ranges: [
      [L.JEUX_P1_START, L.JEUX_P1_END],
      [L.JEUX_P2_START, L.JEUX_P2_END],
      [L.JEUX_P3_START, L.JEUX_P3_END],
    ],
    placeholder: '// [jeux] — extrait dans scripts/pages/mini-jeux.js (LAZY_PAGE_SCRIPTS)',
    multiPlaceholder: true, // remplace chaque bloc séparément
  },
];

// ─── Extraction ───
let removedRanges = []; // [[start, end], ...] 1-indexed, à retirer de app.js

for (const ex of EXTRACTIONS) {
  const chunks = ex.ranges.map(([s, e]) => rawLines.slice(s - 1, e).join('\n'));
  const content = `// ${ex.label}\n// Chargé lazily par scripts/pages/${ex.file} via LAZY_PAGE_SCRIPTS dans app.js\n'use strict';\n/* globals fmt, showToast, getUserBalance, setUserBalance, activeHunt, state, save, bhWarn, getAuthClient, currentUser, isCloudUser, isCurrentUserAdmin, recordGameSession, queueCloudGameSession */\n\n` + chunks.join('\n\n');
  const dest = path.join(PAGES_DIR, ex.file);
  writeFileSync(dest, content, 'utf8');
  const lines = content.split('\n').length;
  console.log(`\n✓ ${ex.file} (${lines} lignes) → ${dest}`);
  // Vérification syntaxe
  try {
    execSync(`node --check "${dest}"`, { stdio: 'pipe' });
    console.log(`  Syntaxe OK`);
  } catch (e) {
    console.error(`  ERREUR SYNTAXE :\n${e.stderr?.toString() || e.message}`);
    process.exit(1);
  }
  for (const [s, e] of ex.ranges) removedRanges.push([s, e]);
}

// ─── Reconstruction de app.js (supprime les blocs extraits) ───
// On marque les lignes à supprimer dans un Set, puis on reconstruit.
const removedLines = new Set();
for (const [s, e] of removedRanges) {
  for (let i = s; i <= e; i++) removedLines.add(i);
}

// Collecte les placeholders (1er placeholder par extraction)
const placeholderMap = new Map(); // numéro de ligne de début → texte
for (const ex of EXTRACTIONS) {
  if (ex.multiPlaceholder) {
    for (const [s] of ex.ranges) {
      placeholderMap.set(s, ex.placeholder);
    }
  } else {
    placeholderMap.set(ex.ranges[0][0], ex.placeholder);
  }
}

const newLines = [];
for (let i = 1; i <= rawLines.length; i++) {
  if (removedLines.has(i)) {
    if (placeholderMap.has(i)) {
      newLines.push(placeholderMap.get(i));
    }
    // sinon on saute la ligne
  } else {
    newLines.push(rawLines[i - 1]);
  }
}

const newAppJs = newLines.join('\n');
writeFileSync(APP_JS, newAppJs, 'utf8');
console.log(`\n✓ app.js reconstruit (${newLines.length} lignes, était ${rawLines.length})`);

// Vérification syntaxe app.js
try {
  execSync(`node --check "${APP_JS}"`, { stdio: 'pipe' });
  console.log('  Syntaxe app.js OK');
} catch (e) {
  console.error(`  ERREUR SYNTAXE app.js :\n${e.stderr?.toString() || e.message}`);
  process.exit(1);
}

console.log('\n✅ Extraction Passe 2 terminée. Mets à jour LAZY_PAGE_SCRIPTS dans app.js.');
