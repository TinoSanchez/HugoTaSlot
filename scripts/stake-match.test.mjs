/**
 * Tests unitaires (hors réseau) pour scripts/lib/stake-match.mjs.
 *   node --test scripts/stake-match.test.mjs
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildStakeMatchIndex,
  findStakeNodeForCatalog,
  normalizeProvider,
  normalizeStr,
} from './lib/stake-match.mjs';

const SAMPLE_STAKE = [
  {
    id: 'g1',
    name: 'Sweet Bonanza 1000',
    slug: 'sweet-bonanza-1000',
    thumbnailUrl: 'https://cdn.example.com/sb1000.png',
    provider: 'pragmatic-play',
    providerName: 'Pragmatic Play',
  },
  {
    id: 'g2',
    name: "Reactoonz Blitzways",
    slug: 'reactoonz-blitzways',
    thumbnailUrl: 'https://cdn.example.com/reactoonz-blitz.png',
    provider: 'play-n-go',
    providerName: "Play'n GO",
  },
  {
    id: 'g3',
    name: 'Mental 2',
    slug: 'mental-2',
    thumbnailUrl: 'https://cdn.example.com/mental2.png',
    provider: 'nolimit-city',
    providerName: 'Nolimit City',
  },
];

describe('stake-match — utilities', () => {
  test('normalizeStr enlève accents, ponctuation, casse', () => {
    assert.equal(normalizeStr("L'Œuf  d'Or — 2"), 'l oeuf d or 2');
  });
  test('normalizeProvider alias Playn GO / Play\'n GO / Pragmatic Play', () => {
    assert.equal(normalizeProvider("Play'n GO"), 'play-n-go');
    assert.equal(normalizeProvider('Playn GO'), 'play-n-go');
    assert.equal(normalizeProvider('Pragmatic Play'), 'pragmatic-play');
    assert.equal(normalizeProvider('NoLimit City'), 'nolimit-city');
  });
});

describe('stake-match — matching catalogue', () => {
  const index = buildStakeMatchIndex(SAMPLE_STAKE);

  test('match exact nom + provider', () => {
    const hit = findStakeNodeForCatalog(
      { id: 'sr_x_y', nom: 'Sweet Bonanza 1000', provider: 'Pragmatic Play' },
      index
    );
    assert.ok(hit, 'doit matcher');
    assert.equal(hit.via, 'name+provider');
    assert.equal(hit.node.thumbnailUrl, 'https://cdn.example.com/sb1000.png');
  });

  test('match via srSlug si nom diffère', () => {
    const hit = findStakeNodeForCatalog(
      {
        id: 'sr_nolimit_city_mental-2',
        nom: 'Mental II',
        provider: 'Nolimit City',
        srSlug: 'mental-2',
      },
      index
    );
    assert.ok(hit);
    assert.equal(hit.node.id, 'g3');
  });

  test('match name-only en dernier recours', () => {
    const hit = findStakeNodeForCatalog(
      { id: 'sr_other', nom: 'Reactoonz Blitzways', provider: 'Inconnu' },
      index
    );
    assert.ok(hit);
    assert.equal(hit.via, 'name-only');
  });

  test('aucun match → null', () => {
    const hit = findStakeNodeForCatalog(
      { id: 'sr_zzz', nom: 'Slot Inconnu XYZ', provider: 'NowayInc' },
      index
    );
    assert.equal(hit, null);
  });

  test('node sans thumbnail est ignoré', () => {
    const idx = buildStakeMatchIndex([
      { id: 'g4', name: 'NoImage', slug: 'no-img', thumbnailUrl: '', provider: 'x' },
    ]);
    const hit = findStakeNodeForCatalog({ id: 'sr_a', nom: 'NoImage', provider: 'x' }, idx);
    assert.equal(hit, null);
  });
});
