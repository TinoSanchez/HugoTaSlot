/**
 * Applique discord-bot/sql/06_rumble_videos.sql sur Supabase Postgres.
 * Nécessite SUPABASE_DB_PASSWORD (Settings → Database → password).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRef = (process.env.SUPABASE_PROJECT_REF || 'kkqskgxjyurtplbububc').trim();
const password = process.env.SUPABASE_DB_PASSWORD;
if (!password) {
  console.error('SUPABASE_DB_PASSWORD manquant');
  process.exit(1);
}

const sqlPath = path.join(__dirname, '..', 'sql', '06_rumble_videos.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const connectionString =
  process.env.SUPABASE_DB_URL
  || `postgresql://postgres:${encodeURIComponent(password)}@db.${projectRef}.supabase.co:5432/postgres`;

const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log('OK — table public.rumble_videos prête');
} finally {
  await client.end();
}
