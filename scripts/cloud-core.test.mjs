/**
 * Tests cloud : solde, drop, refresh session, soumission tournoi, maintenance.
 *   npm test
 */

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDailyDropAward,
  parseDailyDropRpcRow,
  assertValidCloudBalance,
  mergeSessionAfterClaim,
  normalizeMaintenanceConfig,
  validateTournoiSubmission,
} from './lib/cloud-core.mjs';

describe('drop quotidien', () => {
  test('streak 1 sans bonus', () => {
    assert.equal(computeDailyDropAward(1, 1), 25);
  });

  test('streak 3 +5 % par jour', () => {
    assert.equal(computeDailyDropAward(3, 1), 27.5);
  });

  test('plafond bonus streak 200 %', () => {
    assert.equal(computeDailyDropAward(100, 1), 75);
  });

  test('facteur rang clampé', () => {
    assert.equal(computeDailyDropAward(1, 0.1), 12.5);
    assert.equal(computeDailyDropAward(1, 10), 100);
  });

  test('parse RPC avec new_balance', () => {
    const p = parseDailyDropRpcRow([{ awarded: 27.5, new_balance: 127.5, streak: 3, next_claim_day: 20300 }], 20300);
    assert.equal(p.newBalance, 127.5);
    assert.equal(p.streak, 3);
  });

  test('parse RPC rejete ligne vide', () => {
    assert.equal(parseDailyDropRpcRow(null), null);
    assert.equal(parseDailyDropRpcRow([{}]), null);
  });
});

describe('solde cloud', () => {
  test('balance valide arrondie', () => {
    assert.equal(assertValidCloudBalance(99.999), 100);
  });

  test('balance négative ou NaN rejetée', () => {
    assert.throws(() => assertValidCloudBalance(-1), /invalid_cloud_balance/);
    assert.throws(() => assertValidCloudBalance('x'), /invalid_cloud_balance/);
  });
});

describe('refresh après claim', () => {
  test('merge session conserve le solde serveur', () => {
    const next = mergeSessionAfterClaim(
      { id: 'u1', balance: 100, streak: 1, lastClaimDay: null },
      { newBalance: 127.5, streak: 3, claimDay: 20300 }
    );
    assert.equal(next.balance, 127.5);
    assert.equal(next.streak, 3);
    assert.equal(next.lastClaimDay, 20300);
    assert.ok(next.lastClaimAt);
  });
});

describe('maintenance serveur', () => {
  test('normalise config JSON', () => {
    const m = normalizeMaintenanceConfig({ enabled: true, message: 'Pause technique' });
    assert.equal(m.enabled, true);
    assert.equal(m.message, 'Pause technique');
  });

  test('message tronqué à 220 caractères', () => {
    const m = normalizeMaintenanceConfig({ message: 'x'.repeat(300) });
    assert.equal(m.message.length, 220);
  });
});

describe('soumission tournoi', () => {
  test('payload valide', () => {
    const r = validateTournoiSubmission({ name: 'Hunt test', gain: 500, mise: 100, replay: 'https://twitch.tv/v/1' });
    assert.equal(r.ok, true);
    assert.equal(r.payload.hunt_name, 'Hunt test');
    assert.equal(r.payload.replay_url, 'https://twitch.tv/v/1');
  });

  test('mise nulle rejetée', () => {
    const r = validateTournoiSubmission({ name: 'H', gain: 10, mise: 0 });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid_mise');
  });

  test('replay non-http rejeté', () => {
    const r = validateTournoiSubmission({ name: 'H', gain: 10, mise: 5, replay: 'ftp://x' });
    assert.equal(r.ok, false);
    assert.equal(r.error, 'invalid_replay_url');
  });
});
