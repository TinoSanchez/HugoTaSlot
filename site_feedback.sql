-- Exécuter ce script dans Supabase → SQL Editor.
-- Table des retours testeurs (page REVIEW du site).
--
-- Si la table existait déjà sans colonne status (erreur « column site_feedback.status does not exist »),
-- exécute plutôt ou en complément : site_feedback_ajout_colonne_status.sql

create table if not exists public.site_feedback (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  category text not null check (category in ('bug', 'idee', 'autre')),
  message text not null check (char_length(message) between 1 and 4000),
  contact text check (contact is null or char_length(contact) <= 240),
  user_id uuid references auth.users (id) on delete set null,
  client_meta jsonb default '{}'::jsonb,
  status text not null default 'nouveau'
);

-- Bases créées avant la colonne status ou sans contrainte :
alter table public.site_feedback add column if not exists status text default 'nouveau';
update public.site_feedback set status = 'nouveau' where status is null or trim(status) = '';
update public.site_feedback set status = 'nouveau' where status not in ('nouveau', 'a_faire', 'valide', 'fait');
alter table public.site_feedback alter column status set default 'nouveau';
alter table public.site_feedback alter column status set not null;
alter table public.site_feedback drop constraint if exists site_feedback_status_check;
alter table public.site_feedback add constraint site_feedback_status_check
  check (status in ('nouveau', 'a_faire', 'valide', 'fait'));

create index if not exists site_feedback_created_at_idx on public.site_feedback (created_at desc);
create index if not exists site_feedback_status_idx on public.site_feedback (status);

alter table public.site_feedback enable row level security;

drop policy if exists "site_feedback_insert_public" on public.site_feedback;
create policy "site_feedback_insert_public"
  on public.site_feedback for insert
  to anon, authenticated
  with check (status = 'nouveau');

drop policy if exists "site_feedback_select_admin" on public.site_feedback;
create policy "site_feedback_select_admin"
  on public.site_feedback for select
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(trim(p.role::text)) = 'admin'
        and lower(trim(coalesce(p.status::text, 'active'))) = 'active'
    )
  );

drop policy if exists "site_feedback_update_admin" on public.site_feedback;
create policy "site_feedback_update_admin"
  on public.site_feedback for update
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(trim(p.role::text)) = 'admin'
        and lower(trim(coalesce(p.status::text, 'active'))) = 'active'
    )
  )
  with check (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(trim(p.role::text)) = 'admin'
        and lower(trim(coalesce(p.status::text, 'active'))) = 'active'
    )
  );

drop policy if exists "site_feedback_delete_admin" on public.site_feedback;
create policy "site_feedback_delete_admin"
  on public.site_feedback for delete
  to authenticated
  using (
    exists (
      select 1 from public.profiles p
      where p.id = auth.uid()
        and lower(trim(p.role::text)) = 'admin'
        and lower(trim(coalesce(p.status::text, 'active'))) = 'active'
    )
  );
