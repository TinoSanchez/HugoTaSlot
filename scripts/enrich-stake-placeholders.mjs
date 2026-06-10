/**
 * Enrichit les vignettes manquantes (sr_* sans image) en croisant avec
 * le catalogue Stake (slugKuratorGroup).
 *
 *   node scripts/enrich-stake-placeholders.mjs
 *   node scripts/enrich-stake-placeholders.mjs --dry-run
 *   node scripts/enrich-stake-placeholders.mjs --slug=new-releases
 *   node scripts/enrich-stake-placeholders.mjs --from-file=supabase/migrations/stake-export-1.json
 *
 * Bypass blocage France :
 *   - Si Stake est bloqué (FAI / Cloudflare), utiliser --from-file=<export.json>
 *   - L'export se fait dans Chrome : DevTools → Network → /_api/graphql → Response → copier dans un .json
 *   - Formats acceptés : tableau brut, { data: { slugKuratorGroup: ... } }, { data: { casinoGames: ... } }, ...
 *
 * Env utiles :
 *   STAKE_PROXY          — proxy HTTP(S) (optionnel)
 *   STAKE_SKIP_BROWSER=1 — n'utilise jamais Playwright (CI)
 *   PLAYWRIGHT_HEADLESS=1
 *
 * Ce script ne touche pas aux entrées qui ont déjà une image.
 * Il préfixe simplement `image` avec l'URL CDN Stake quand un match est trouvé.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fetchStakeGroupGames } from './lib/stake-graphql.mjs';
import { buildStakeMatchIndex, findStakeNodeForCatalog } from './lib/stake-match.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JEUX_PATH = resolve(ROOT, 'jeux.json');

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    dryRun: false,
    slugs: [],
    sorts: [],
    onlySr: true,
    skipBrowser: process.env.STAKE_SKIP_BROWSER === '1',
    files: [],
  };
  for (const a of args) {
    if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--all-placeholders') opts.onlySr = false;
    else if (a === '--skip-browser') opts.skipBrowser = true;
    else if (a.startsWith('--slug=')) opts.slugs.push(a.slice(7));
    else if (a.startsWith('--sort=')) opts.sorts.push(a.slice(7));
    else if (a.startsWith('--from-file=')) opts.files.push(a.slice(12));
    else if (a === '--help' || a === '-h') {
      console.log(`enrich-stake-placeholders.mjs

  --dry-run                ne modifie pas jeux.json
  --slug=<slug>            catégorie Stake (par défaut: slots, new-releases)
                           — répétable: --slug=slots --slug=new-releases
  --from-file=<path>       export local au lieu d'un appel réseau (bypass CF/France)
                           — répétable: --from-file=a.json --from-file=b.json
  --all-placeholders       inclut aussi les ids non sr_*
  --skip-browser           ne tente pas Playwright (utile en CI)

Bypass France : exporte depuis Chrome (DevTools → Network → /_api/graphql → Response → copier
en .json), puis --from-file=<chemin>. Aucun appel réseau si --from-file est fourni.
`);
      process.exit(0);
    }
  }
  if (!opts.slugs.length) opts.slugs = ['slots', 'new-releases'];
  // Multi-sort agressif : chaque sort = une fenêtre offset 0-4000 différente,
  // donc l'union couvre la quasi-totalité du catalogue Stake (~6000 jeux).
  if (!opts.sorts.length) {
    opts.sorts = ['popular7d', 'popular30d', 'newest', 'name_asc', 'name_desc', 'rtp_desc'];
  }
  return opts;
}

function resolveLocalPath(p) {
  return isAbsolute(p) ? p : resolve(process.cwd(), p);
}

/**
 * Accepte tous les formats d'export Stake :
 *   - tableau brut [{ id, name, slug, thumbnailUrl, groupGames }, ...]
 *   - { data: { slugKuratorGroup: { groupGamesList: [{ game: ... }] } } }
 *   - { data: { casinoGames: { edges: [{ node: ... }] } } }
 *   - { groupGamesList: [...] } / { edges: [...] }
 *   - tableau d'éléments { game: ... } ou { node: ... }
 */
function extractGamesFromAny(parsed) {
  const out = [];
  const push = (g) => {
    if (g && typeof g === 'object' && (g.slug || g.name)) out.push(g);
  };

  function walk(node) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    if (typeof node !== 'object') return;
    if (node.game && typeof node.game === 'object' && (node.game.slug || node.game.name)) {
      push(node.game);
      return;
    }
    if (node.node && typeof node.node === 'object' && (node.node.slug || node.node.name)) {
      push(node.node);
      return;
    }
    if ((node.slug || node.name) && (node.thumbnailUrl || node.thumb || node.groupGames)) {
      push(node);
      return;
    }
    for (const v of Object.values(node)) walk(v);
  }
  walk(parsed);
  return out;
}

/** Convertit un game brut Stake vers le format attendu par buildStakeMatchIndex. */
function flattenRawGame(g) {
  const groupGames = Array.isArray(g.groupGames) ? g.groupGames : [];
  const providerEntry = groupGames.find((e) => e?.group?.type === 'provider');
  return {
    id: String(g.id || ''),
    name: String(g.name || '').trim(),
    slug: String(g.slug || '').trim(),
    thumbnailUrl: String(g.thumbnailUrl || g.thumb || '').trim(),
    provider: String(providerEntry?.group?.slug || g.provider?.slug || g.provider || '').trim(),
    providerName: String(
      providerEntry?.group?.translation || g.provider?.name || g.providerName || ''
    ).trim(),
  };
}

function loadStakeNodesFromFile(path) {
  const abs = resolveLocalPath(path);
  if (!existsSync(abs)) {
    throw new Error(`Fichier introuvable: ${abs}`);
  }
  const raw = readFileSync(abs, 'utf8');
  const parsed = JSON.parse(raw);
  const games = extractGamesFromAny(parsed);
  if (!games.length) {
    throw new Error(`Aucun jeu Stake trouvé dans ${abs}`);
  }
  return games.map(flattenRawGame).filter((g) => g.name);
}

function loadJeux() {
  const raw = readFileSync(JEUX_PATH, 'utf8');
  const parsed = JSON.parse(raw);
  const arr = Array.isArray(parsed) ? parsed : parsed.slots || parsed.games || [];
  if (!Array.isArray(arr) || !arr.length) {
    throw new Error('jeux.json : tableau introuvable.');
  }
  return arr;
}

function isPlaceholderEntry(entry, onlySr) {
  if (!entry || typeof entry !== 'object') return false;
  const img = String(entry.image || '').trim().toLowerCase();
  const isPh = !img || img.includes('placehold.co') || img.includes('via.placeholder');
  if (!isPh) return false;
  if (!onlySr) return true;
  return String(entry.id || '').toLowerCase().startsWith('sr_');
}

async function main() {
  const opts = parseArgs();
  console.log(`Lecture ${JEUX_PATH}…`);
  const entries = loadJeux();
  const placeholders = entries.filter((e) => isPlaceholderEntry(e, opts.onlySr));
  console.log(`Placeholders ciblés : ${placeholders.length} sur ${entries.length} entrées`);
  if (!placeholders.length) {
    console.log('Rien à enrichir.');
    return;
  }

  const seenIds = new Set();
  const allStakeNodes = [];
  const pushUnique = (n) => {
    if (!n) return;
    const key = n.id || n.slug || n.name;
    if (!key || seenIds.has(key)) return;
    seenIds.add(key);
    allStakeNodes.push(n);
  };

  if (opts.files.length) {
    for (const f of opts.files) {
      try {
        const nodes = loadStakeNodesFromFile(f);
        console.log(`Fichier "${f}" — ${nodes.length} jeux Stake chargés (pas de réseau).`);
        nodes.forEach(pushUnique);
      } catch (e) {
        console.error(`Fichier "${f}" — échec : ${e.message}`);
      }
    }
  } else {
    for (const slug of opts.slugs) {
      for (const sort of opts.sorts) {
        const before = allStakeNodes.length;
        console.log(`Stake — slugKuratorGroup(slug="${slug}", sort="${sort}")…`);
        try {
          const { nodes, total } = await fetchStakeGroupGames({
            slug,
            sort,
            pageSize: 39,
            skipBrowser: opts.skipBrowser,
            onProgress: ({ fetched, total: t, page }) => {
              if (page % 10 === 0 || (t && fetched >= t)) {
                console.log(`  page ${page} — ${fetched}${t ? '/' + t : ''} jeux`);
              }
            },
          });
          nodes.forEach(pushUnique);
          const added = allStakeNodes.length - before;
          console.log(
            `  reçu ${nodes.length} jeux Stake (gameCount=${total ?? '?'}), +${added} nouveaux.`
          );
        } catch (e) {
          console.error(`Stake "${slug}/${sort}" — échec : ${e.message}`);
          if (/fetch failed|ENOTFOUND|EAI_AGAIN|CERT_|certificate/i.test(e.message)) {
            console.error(
              '  ↳ Stake injoignable. Bypass DoH actif par défaut (STAKE_USE_DOH=0 pour désactiver).'
                + '\n     Alternative : node scripts/enrich-stake-placeholders.mjs --from-file=<export.json>'
            );
          }
        }
      }
    }
  }

  if (!allStakeNodes.length) {
    console.error('Aucun jeu Stake récupéré — abandon.');
    process.exit(2);
  }
  console.log(`Catalogue Stake en mémoire : ${allStakeNodes.length} jeux uniques.`);

  const index = buildStakeMatchIndex(allStakeNodes);

  let matched = 0;
  let byNameProv = 0;
  let byName = 0;
  let bySlug = 0;
  const sample = [];
  for (const e of placeholders) {
    const hit = findStakeNodeForCatalog(e, index);
    if (!hit) continue;
    matched += 1;
    if (hit.via === 'name+provider') byNameProv += 1;
    else if (hit.via === 'srSlug') bySlug += 1;
    else byName += 1;
    e.image = hit.node.thumbnailUrl;
    if (!e.gamdomUrl || /\/slots\/search\?/.test(String(e.gamdomUrl))) {
      e.gamdomUrl = `https://stake.com/casino/games/${encodeURIComponent(hit.node.slug)}`;
    }
    if (sample.length < 8) {
      sample.push(`  • ${e.nom} (${e.provider || '—'}) → ${hit.via}`);
    }
  }

  console.log('\n— Résultat enrichissement Stake —');
  console.log(`  matched      : ${matched}/${placeholders.length}`);
  console.log(`  name+provider: ${byNameProv}`);
  console.log(`  name-only    : ${byName}`);
  console.log(`  srSlug       : ${bySlug}`);
  if (sample.length) {
    console.log('Échantillon :');
    sample.forEach((l) => console.log(l));
  }

  if (matched === 0) {
    console.log('Aucun match — jeux.json inchangé.');
    return;
  }
  if (opts.dryRun) {
    console.log('--dry-run : jeux.json non modifié.');
    return;
  }
  writeFileSync(JEUX_PATH, `${JSON.stringify(entries)}\n`, 'utf8');
  console.log(`jeux.json mis à jour (${matched} vignette(s) ajoutée(s)).`);
}

main().catch((e) => {
  console.error('Erreur fatale :', e.message);
  process.exit(1);
});
