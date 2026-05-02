-- ────────────────────────────────────────────────────────────────────────────
-- Migration : élargir la contrainte CHECK de slot_releases.source pour
-- accepter les sources scrapées (stake, gamdom, shuffle, celsius) en plus
-- de bigwinboard et manual.
--
-- À exécuter une seule fois dans Supabase SQL Editor.
-- ────────────────────────────────────────────────────────────────────────────

alter table public.slot_releases
  drop constraint if exists slot_releases_source_check;

alter table public.slot_releases
  add constraint slot_releases_source_check
  check (source in ('bigwinboard', 'manual', 'stake', 'gamdom', 'shuffle', 'celsius', 'slotcatalog'));

-- Index utile pour les requêtes "annonces par source"
create index if not exists slot_releases_source_pending_idx
  on public.slot_releases (source, posted_to_discord_at);
