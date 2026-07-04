#!/usr/bin/env node
/**
 * Vérifie que les migrations Supabase critiques sont appliquées en prod.
 *
 * Usage :
 *   node scripts/verify-supabase-migrations.mjs
 *   SUPABASE_URL=... SUPABASE_ANON_KEY=... node scripts/verify-supabase-migrations.mjs
 *
 * Sans get_schema_health déployé, sonde les RPC une par une (moins fiable).
 */

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://kkqskgxjyurtplbububc.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.SUPABASE_ANON
  || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtrcXNrZ3hqeXVydHBsYnVidWJjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzczMTA0MjcsImV4cCI6MjA5Mjg4NjQyN30.7f8Rub_5lO-yfZSbIUvtaUVZew_1XABwIvvU2yXmG5c';

const REQUIRED_HEALTH = {
  claim_daily_drop: true,
  claim_daily_drop_factor: true,
  profiles_daily_streak: true,
  profiles_last_claim_day: true,
  get_site_maintenance: true,
  get_leaderboard_wager: true,
  get_leaderboard_streak: true,
};

async function rpcCall(name, body = {}) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, text };
}

function rpcExistsFromProbe(status, text) {
  const t = String(text || '').toLowerCase();
  if (status === 404) return false;
  if (t.includes('could not find the function') || t.includes('pgrst202')) return false;
  return true;
}

async function probeRpc(name, body = {}) {
  const { status, text } = await rpcCall(name, body);
  return rpcExistsFromProbe(status, text);
}

async function main() {
  console.log(`\nSupabase migrations check — ${SUPABASE_URL}\n`);

  let health = null;
  const schemaRes = await rpcCall('get_schema_health');
  if (schemaRes.status === 200 && schemaRes.data && typeof schemaRes.data === 'object') {
    health = schemaRes.data;
    console.log('✓ get_schema_health disponible\n');
  } else {
    console.log('⚠ get_schema_health absent — sonde RPC individuelle (appliquer 20260704_site_maintenance.sql)\n');
  }

  let errors = 0;
  const report = (key, ok, detail = '') => {
    const icon = ok ? '✓' : '✗';
    console.log(`  ${icon}  ${key}${detail ? ` — ${detail}` : ''}`);
    if (!ok) errors++;
  };

  if (health) {
    Object.entries(REQUIRED_HEALTH).forEach(([k, required]) => {
      if (!required) return;
      report(k, !!health[k], health[k] ? 'OK' : 'MANQUANT');
    });
    if (health.public_hunt_shares === false) {
      console.log('  ⚠  public_hunt_shares — optionnel (migration 20260704_public_hunt_shares.sql)');
    }
  } else {
    report('claim_daily_drop', await probeRpc('claim_daily_drop', { p_factor: 1 }));
    report('get_leaderboard_wager', await probeRpc('get_leaderboard_wager'));
    report('get_leaderboard_streak', await probeRpc('get_leaderboard_streak'));
    report('get_site_maintenance', await probeRpc('get_site_maintenance'));
  }

  const maint = await rpcCall('get_site_maintenance');
  if (maint.status === 200) {
    const cfg = typeof maint.data === 'object' ? maint.data : {};
    console.log(`\n  Maintenance serveur : ${cfg.enabled ? 'ACTIVE' : 'OFF'}`);
    if (cfg.message) console.log(`  Message : ${cfg.message}`);
  }

  console.log('\nMigrations SQL à appliquer manuellement si des ✗ :\n');
  console.log('  supabase/migrations/20260704_add_profiles_daily_streak.sql');
  console.log('  supabase/migrations/20260704_claim_daily_drop_fix.sql');
  console.log('  supabase/migrations/20260629_claim_daily_drop_atomic_factor.sql');
  console.log('  supabase/migrations/20260704_community_leaderboards.sql');
  console.log('  supabase/migrations/20260704_site_maintenance.sql');
  console.log('  supabase/migrations/20260704_admin_dashboard.sql');
  console.log('  supabase/migrations/20260704_public_hunt_shares.sql (optionnel)\n');

  if (errors > 0) {
    console.error(`❌ ${errors} vérification(s) en échec.\n`);
    process.exit(1);
  }
  console.log('✅ Schéma prod conforme aux migrations requises.\n');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
