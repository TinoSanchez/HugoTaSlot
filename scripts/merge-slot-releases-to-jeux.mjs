/**
 * Fusionne les slot_releases récentes (slug slotreport-*) dans jeux.json
 * pour que /machine et /calls les trouvent via le catalogue.
 */
import 'dotenv/config';
import { readFileSync, writeFileSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { config as loadEnv } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const JEUX = resolve(ROOT, 'jeux.json');
const WEB = resolve(ROOT, 'web/public/jeux.json');

// Charge le .env du bot si les vars manquent à la racine
if (!process.env.SUPABASE_URL) {
  loadEnv({ path: resolve(ROOT, 'discord-bot/.env') });
}

function norm(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[''′`´]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function key(nom, prov) {
  return `${norm(nom)}|${norm(prov)}`;
}

const url = process.env.SUPABASE_URL;
const keySr = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !keySr) {
  console.error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants');
  process.exit(1);
}

const sb = createClient(url, keySr);
const since = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString();
const { data, error } = await sb
  .from('slot_releases')
  .select('title,provider,url,image,slug,published_at')
  .gte('created_at', since)
  .like('slug', 'slotreport-%');
if (error) {
  console.error(error);
  process.exit(1);
}

const raw = JSON.parse(readFileSync(JEUX, 'utf8'));
const arr = Array.isArray(raw) ? raw : (raw.slots || raw.games || []);
const before = arr.length;
const existing = new Set(arr.map((g) => key(g.nom || g.name || g.title, g.provider || g.Provider || '')));
const addedNames = [];

for (const r of data || []) {
  const nom = String(r.title || '').trim();
  const provider = String(r.provider || '').trim();
  if (!nom) continue;
  const k = key(nom, provider);
  if (existing.has(k)) continue;
  existing.add(k);
  const idBase = String(r.slug || '').replace(/^slotreport-/, '').slice(0, 80);
  arr.push({
    id: `sr_${idBase || Date.now()}`,
    nom,
    name: nom,
    provider,
    Provider: provider,
    image: r.image || '',
    gamdomUrl: '',
    url: r.url || '',
    source: 'slot.report',
  });
  addedNames.push(`${nom} · ${provider}`);
}

writeFileSync(JEUX, JSON.stringify(arr));
if (existsSync(dirname(WEB))) {
  try { copyFileSync(JEUX, WEB); } catch (_) {}
}

console.log(JSON.stringify({
  before,
  after: arr.length,
  added: addedNames.length,
  addedNames,
}, null, 2));
