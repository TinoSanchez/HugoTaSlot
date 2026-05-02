-- ────────────────────────────────────────────────────────────────────────────
-- Table : public.slot_releases
-- Stocke les sorties de slots (auto via BigWinBoard RSS + ajouts manuels admin).
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.slot_releases (
  id           uuid primary key default gen_random_uuid(),
  source       text not null check (source in ('bigwinboard', 'manual')),
  external_id  text,                       -- guid RSS pour bigwinboard, NULL pour manual
  slug         text not null unique,       -- généré (provider + nom + source) pour anti-doublon
  title        text not null,
  provider     text,
  image        text,
  summary      text,
  url          text,                       -- lien vers la review BigWinBoard ou page custom
  published_at timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null,  -- pour ajouts manuels
  posted_to_discord_at timestamptz,
  discord_message_id   text,
  created_at   timestamptz not null default now()
);

create index if not exists slot_releases_published_idx
  on public.slot_releases (published_at desc);
create index if not exists slot_releases_source_idx
  on public.slot_releases (source);

alter table public.slot_releases enable row level security;

-- Lecture publique
drop policy if exists "slot_releases_read_all" on public.slot_releases;
create policy "slot_releases_read_all" on public.slot_releases
  for select to anon, authenticated using (true);

-- Insertion manuelle réservée aux admins (via le site)
drop policy if exists "slot_releases_insert_admin" on public.slot_releases;
create policy "slot_releases_insert_admin" on public.slot_releases
  for insert to authenticated
  with check (
    source = 'manual'
    and exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(trim(p.role::text)) = 'admin'
        and lower(trim(coalesce(p.status::text, 'active'))) = 'active'
    )
  );

-- Update / delete : admins seulement
drop policy if exists "slot_releases_update_admin" on public.slot_releases;
create policy "slot_releases_update_admin" on public.slot_releases
  for update to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and lower(trim(p.role::text)) = 'admin'
              and lower(trim(coalesce(p.status::text, 'active'))) = 'active')
  )
  with check (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and lower(trim(p.role::text)) = 'admin'
              and lower(trim(coalesce(p.status::text, 'active'))) = 'active')
  );

drop policy if exists "slot_releases_delete_admin" on public.slot_releases;
create policy "slot_releases_delete_admin" on public.slot_releases
  for delete to authenticated
  using (
    exists (select 1 from public.profiles p
            where p.id = auth.uid()
              and lower(trim(p.role::text)) = 'admin'
              and lower(trim(coalesce(p.status::text, 'active'))) = 'active')
  );
-- Le bot (service_role) bypasse toutes ces RLS pour insérer en source='bigwinboard'.
