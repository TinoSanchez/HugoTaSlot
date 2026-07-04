/**
 * Audit complet du site après refactoring Passe 2.
 * Usage : node scripts/audit-site.mjs
 */
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = decodeURIComponent(path.resolve(new URL('..', import.meta.url).pathname.slice(1).replace(/^([A-Za-z]:)/, '$1')));
const read = (f) => readFileSync(path.join(ROOT, f), 'utf8');

let errors = 0;
let warnings = 0;
function err(msg) { console.error('  ❌ ' + msg); errors++; }
function warn(msg) { console.warn('  ⚠️  ' + msg); warnings++; }
function ok(msg) { console.log('  ✓  ' + msg); }

// ─── Sources ───
const app = read('app.js');
const html = read('index.html');
const css = read('styles.css');
const sw = read('sw.js');
const buildScript = read('scripts/build-original-site.mjs');
const pageFiles = {
  blackjack: read('scripts/pages/blackjack.js'),
  mise: read('scripts/pages/mise.js'),
  tournoi: read('scripts/pages/tournoi.js'),
  'roue-depot': read('scripts/pages/roue-depot.js'),
  'mini-jeux': read('scripts/pages/mini-jeux.js'),
  'hub-features': read('scripts/pages/hub-features.js'),
  stats: read('scripts/pages/stats.js'),
};
const allJS = app + '\n' + Object.values(pageFiles).join('\n');

// ─── 1. Syntaxe ───
console.log('\n── 1. Fichiers supprimés / fantômes ──');
const missingFiles = ['accounts.js','games.js','hunts.js','slots.js','jeux-data.js'];
missingFiles.forEach(f => {
  if (!existsSync(path.join(ROOT, f))) {
    if (buildScript.includes('"' + f + '"')) warn(`build-original-site.mjs copie "${f}" mais ce fichier n'existe pas`);
  }
});
const phantomAssets = ['assets/pharaoh-symbols','assets/pharaoh-reels-pattern.svg'];
phantomAssets.forEach(f => {
  if (existsSync(path.join(ROOT, f))) err(`"${f}" devrait être supprimé mais existe encore`);
  else ok(`"${f}" absent ✓`);
});
if (!existsSync(path.join(ROOT, 'scripts/pages/pharaon.js'))) ok('scripts/pages/pharaon.js absent (jeu retiré) ✓');
else err('scripts/pages/pharaon.js existe encore — Le Pharaon a été retiré du produit');

// ─── 2. Résidus pharaon ───
console.log('\n── 2. Résidus pharaon ──');
[['index.html', html], ['app.js', app], ['styles.css', css], ['sw.js', sw]].forEach(([name, src]) => {
  const found = (src.match(/pharaoh_slot|initPharaohSlot|pharaohSpin|pharaohReset|pharaohToggleRules/g) || []);
  if (found.length > 0) err(`${name} contient des résidus pharaon: ${[...new Set(found)].join(', ')}`);
  else ok(`${name} — aucun résidu pharaon fonctionnel`);
});

// ─── 3. Fonctions render appelées dans switchPage ───
console.log('\n── 3. Fonctions render appelées par switchPage (typeof guard) ──');
const lazyCases = ['renderBJTable','calcMise','renderTournoiLeaderboard','initDepositWheel','renderGamesLobby'];
lazyCases.forEach(fn => {
  const inPages = Object.values(pageFiles).some(src => src.includes('function ' + fn));
  const hasGuard = app.includes('typeof ' + fn + " === 'function'");
  if (!inPages) err(`${fn} n'est pas défini dans scripts/pages/*.js`);
  else if (!hasGuard) warn(`${fn} : guard typeof manquant dans switchPage`);
  else ok(`${fn} : défini dans page script + guard typeof ✓`);
});

// Fonctions encore dans app.js (non extraites)
const appFns = ['renderStatsPage','renderAdminPanel','renderHomeHubMetrics','renderUpdatesPage','renderReviewPage','renderNewsPage','runSupabaseHealthCheck','flushFeedbackQueue'];
appFns.forEach(fn => {
  if (fn === 'renderStatsPage') {
    if (pageFiles.stats.includes('function renderStatsPage')) ok('renderStatsPage extrait dans stats.js ✓');
    else err('renderStatsPage absent de stats.js');
    return;
  }
  if (!app.includes('function ' + fn)) err(`${fn} absent de app.js mais attendu`);
  else ok(`${fn} présent dans app.js ✓`);
});

// ─── 4. Globals critiques dans app.js ───
console.log('\n── 4. Globals critiques présents dans app.js ──');
const critGlobals = ['getUserBalance','setUserBalance','isCloudUser','isCurrentUserAdmin','showToast','bhWarn','fmt','activeHunt','save','load','state','currentUser','recordGameSession','queueCloudGameSession','updateLobbyBalance','loadLazyPageScript','ensureSlotsLoaded','trackPlayerGameStats','PLAYER_STATS_KEY','uiAudioCtx','gameSleep','getUiPrefs','saveSession','GUEST_USER','getGuestProfile','getSafeGuestBalance'];
critGlobals.forEach(fn => {
  const present = app.includes(fn);
  if (!present) err(`Global "${fn}" absent de app.js`);
});
ok(`${critGlobals.filter(fn => app.includes(fn)).length}/${critGlobals.length} globals présents`);

// ─── 5. LAZY_PAGE_SCRIPTS vs scripts/pages/ ───
console.log('\n── 5. LAZY_PAGE_SCRIPTS cohérence ──');
const lazyMatch = app.match(/const LAZY_PAGE_SCRIPTS = Object\.freeze\(\{([\s\S]*?)\}\)/);
if (lazyMatch) {
  const entries = [...lazyMatch[1].matchAll(/(\w+):\s*'([^']+)'/g)];
  entries.forEach(([, page, scriptPath]) => {
    const absPath = path.join(ROOT, scriptPath);
    if (!existsSync(absPath)) err(`LAZY_PAGE_SCRIPTS["${page}"] → "${scriptPath}" MANQUANT`);
    else ok(`LAZY_PAGE_SCRIPTS["${page}"] → "${scriptPath}" ✓`);
  });
}

// ─── 6. Cohérence index.html ───
console.log('\n── 6. Cohérence index.html ──');
// Onglets sidebar vs pages déclarées
const sidebarTabs = [...html.matchAll(/data-page="([^"]+)"/g)].map(m => m[1]);
const pagePanels = [...html.matchAll(/id="page-([^"]+)"/g)].map(m => m[1]);
const pageToSlugMatch = app.match(/PAGE_TO_SLUG\s*=\s*Object\.freeze\(\{([\s\S]*?)\}\)/);
const appRoutes = pageToSlugMatch ? [...pageToSlugMatch[1].matchAll(/(\w+):\s*['"][^'"]*['"]/g)].map(m => m[1]) : [];
// 'hunt' utilise le workspace principal (#content/#hunt-workspace) plutôt qu'un page-panel
const NO_PANEL_PAGES = new Set(['hunt']);
sidebarTabs.forEach(tab => {
  if (!NO_PANEL_PAGES.has(tab) && !pagePanels.includes(tab)) err(`Onglet sidebar data-page="${tab}" sans panneau id="page-${tab}"`);
});
pagePanels.forEach(panel => {
  if (!sidebarTabs.some(t => t === panel) && !['admin'].includes(panel)) {
    warn(`Panneau id="page-${panel}" sans onglet sidebar visible (normal si caché)`);
  }
});
ok(`${sidebarTabs.length} onglets, ${pagePanels.length} panneaux`);

// ─── 7. sw.js PRECACHE ───
console.log('\n── 7. sw.js PRECACHE ──');
const precacheMatch = sw.match(/PRECACHE\s*=\s*\[([\s\S]*?)\]/);
if (precacheMatch) {
  const files = [...precacheMatch[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
  files.forEach(f => {
    const p = path.join(ROOT, f.replace(/^\.\//, ''));
    if (!existsSync(p)) err(`sw.js PRECACHE "${f}" → fichier MANQUANT`);
    else ok(`PRECACHE "${f}" ✓`);
  });
}

// ─── 8. Build - fichiers fantômes ───
console.log('\n── 8. Build script ──');
const phantomBuild = ['accounts.js','games.js','hunts.js','slots.js','jeux-data.js'];
phantomBuild.forEach(f => {
  if (buildScript.includes('"' + f + '"')) warn(`build copie "${f}" qui n'existe pas (ignoré silencieusement par existsSync)`);
});

// ─── Résumé ───
console.log('\n══════════════════════════════════════════════');
if (errors === 0 && warnings === 0) {
  console.log('✅ Audit OK — aucune erreur, aucun avertissement.');
} else {
  if (errors > 0) console.error(`❌ ${errors} erreur(s)`);
  if (warnings > 0) console.warn(`⚠️  ${warnings} avertissement(s)`);
}
console.log('══════════════════════════════════════════════\n');
if (errors > 0) process.exit(1);
