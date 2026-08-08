/**
 * Poster l’embed groupé des slots ajoutées aujourd’hui (Europe/Paris).
 * Usage : railway run node scripts/post-today-slots-digest.mjs
 *         node scripts/post-today-slots-digest.mjs
 */
import 'dotenv/config';
import { login, client } from '../src/discord/client.js';
import { supabase } from '../src/supabase.js';
import { sendSlotsDigest } from '../src/jobs/slot-watcher.js';
import { logger } from '../src/lib/logger.js';

function parisDayBounds(now = new Date()) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Paris',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const day = fmt.format(now); // YYYY-MM-DD
  // Minuit Paris → approx via offset : on prend [day 00:00, day+1 00:00) en ISO UTC
  // via calcul simple : Date en Paris
  const startLocal = new Date(`${day}T00:00:00`);
  // Corrige avec l’offset Paris au moment donné
  const parisOffsetMin = (() => {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris',
      timeZoneName: 'shortOffset',
    }).formatToParts(now);
    const tz = parts.find((p) => p.type === 'timeZoneName')?.value || 'GMT+2';
    const m = tz.match(/GMT([+-])(\d+)(?::?(\d+))?/i);
    if (!m) return 120;
    const sign = m[1] === '-' ? -1 : 1;
    return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || '0', 10));
  })();
  const startUtc = new Date(startLocal.getTime() - parisOffsetMin * 60_000);
  const endUtc = new Date(startUtc.getTime() + 24 * 60 * 60 * 1000);
  return { day, startIso: startUtc.toISOString(), endIso: endUtc.toISOString() };
}

async function main() {
  const { day, startIso, endIso } = parisDayBounds();
  logger.info({ day, startIso, endIso, channel: process.env.DISCORD_CHANNEL_SLOTS }, 'Digest slots du jour');

  await login();
  await new Promise((r) => (client.isReady() ? r() : client.once('ready', r)));

  const { data, error } = await supabase
    .from('slot_releases')
    .select('id,title,provider,url,source,created_at,published_at')
    .gte('created_at', startIso)
    .lt('created_at', endIso)
    .order('provider', { ascending: true })
    .order('title', { ascending: true });
  if (error) throw error;

  const rows = data || [];
  if (!rows.length) {
    console.log(JSON.stringify({ day, posted: 0, reason: 'aucune slot créée aujourd’hui' }, null, 2));
    client.destroy();
    process.exit(0);
  }

  const res = await sendSlotsDigest(rows, {
    title: `🎰 Nouvelles sorties · ${day}`,
  });
  console.log(JSON.stringify({ day, count: rows.length, ...res }, null, 2));
  client.destroy();
  process.exit(res.posted ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
