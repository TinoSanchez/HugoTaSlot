/**
 * Tests smoke catalogue + build (node:test, sans réseau).
 *   npm test
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JEUX_PATH = resolve(ROOT, 'jeux.json');

const MIN_ENTRIES = 5000;

function loadCatalog() {
  assert.ok(existsSync(JEUX_PATH), 'jeux.json manquant');
  const raw = readFileSync(JEUX_PATH, 'utf8');
  const data = JSON.parse(raw);
  assert.ok(Array.isArray(data), 'jeux.json doit être un tableau');
  return data;
}

describe('jeux.json', () => {
  test('parse et taille minimale', () => {
    const entries = loadCatalog();
    assert.ok(
      entries.length >= MIN_ENTRIES,
      `catalogue trop petit: ${entries.length} < ${MIN_ENTRIES}`
    );
  });

  test('ids uniques et champs obligatoires', () => {
    const entries = loadCatalog();
    const seen = new Set();
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const id = String(e.id || '').trim();
      assert.ok(id, `entrée #${i}: id manquant`);
      assert.ok(!seen.has(id), `id dupliqué: ${id}`);
      seen.add(id);
      const nom = e.nom || e.name || e.title || '';
      assert.ok(String(nom).trim(), `entrée ${id}: nom manquant`);
      const prov = e.provider || e.Provider || '';
      assert.ok(String(prov).trim(), `entrée ${id}: provider manquant`);
      assert.equal(typeof e.image, 'string', `entrée ${id}: image doit être une chaîne`);
    }
  });

  test('entrées sr_* : format id et URL Gamdom si présente', () => {
    const entries = loadCatalog();
    for (const e of entries) {
      const id = String(e.id || '');
      if (!id.startsWith('sr_')) continue;
      assert.match(
        id,
        /^sr_[a-z0-9_-]+_[a-z0-9_-]+$/,
        `id sr_* invalide: ${id}`
      );
      const url = String(e.gamdomUrl || '');
      if (url && !url.includes('/slots/search')) {
        assert.ok(
          url.includes('gamdom.com'),
          `gamdomUrl invalide pour ${id}: ${url}`
        );
      }
    }
  });

  test('plafond placeholders (régression grossière)', () => {
    const entries = loadCatalog();
    let badPlaceholders = 0;
    let srEmptyImages = 0;
    for (const e of entries) {
      const u = String(e.image || '').toLowerCase();
      if (u.includes('placehold.co') || u.includes('via.placeholder')) {
        badPlaceholders++;
      }
      if (String(e.id).startsWith('sr_') && !u) srEmptyImages++;
    }
    const maxBad = parseInt(process.env.CATALOG_MAX_PLACEHOLDERS || '0', 10);
    const maxSrEmpty = parseInt(process.env.CATALOG_MAX_SR_EMPTY || '250', 10);
    assert.ok(
      badPlaceholders <= maxBad,
      `URLs placeholder interdites: ${badPlaceholders} (max ${maxBad})`
    );
    assert.ok(
      srEmptyImages <= maxSrEmpty,
      `sr_* sans vignette en attente enrich: ${srEmptyImages} (max ${maxSrEmpty}) — lancer enrich:stake-placeholders puis catalog:prune-orphans`
    );
  });
});

describe('fichiers site production', () => {
  test('index.html, styles.css, app.js présents', () => {
    for (const f of ['index.html', 'styles.css', 'app.js']) {
      const p = resolve(ROOT, f);
      assert.ok(existsSync(p), `${f} manquant à la racine`);
      assert.ok(statSync(p).size > 100, `${f} vide ou trop petit`);
    }
  });

  test('npm run build produit web/dist/index.html', () => {
    execSync('node scripts/build-original-site.mjs', {
      cwd: ROOT,
      stdio: 'pipe',
    });
    const distIndex = resolve(ROOT, 'web', 'dist', 'index.html');
    const distJeux = resolve(ROOT, 'web', 'dist', 'jeux.json');
    assert.ok(existsSync(distIndex), 'web/dist/index.html absent après build');
    const distHtml = readFileSync(distIndex, 'utf8');
    assert.ok(distHtml.includes('boot-bundle.js'), 'index dist doit référencer boot-bundle.js');
    assert.ok(
      existsSync(resolve(ROOT, 'web', 'dist', 'scripts', 'pages', 'boot-bundle.js')),
      'web/dist/scripts/pages/boot-bundle.js absent'
    );
    assert.ok(existsSync(distJeux), 'web/dist/jeux.json absent après build');
    assert.ok(existsSync(resolve(ROOT, 'web', 'dist', 'sw.js')), 'web/dist/sw.js absent');
    assert.ok(
      existsSync(resolve(ROOT, 'web', 'dist', 'manifest.webmanifest')),
      'web/dist/manifest.webmanifest absent'
    );
    const srcRaw = readFileSync(JEUX_PATH);
    const distRaw = readFileSync(distJeux);
    assert.ok(distRaw.length < srcRaw.length * 0.92, 'jeux.json dist devrait être plus léger que la source');
    const dist = JSON.parse(distRaw);
    assert.ok(!dist.some((e) => e && e.devise), 'devise retirée du jeux.json de prod');
  });
});
