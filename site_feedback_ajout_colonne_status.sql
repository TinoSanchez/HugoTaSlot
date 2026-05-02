-- Corrige : column site_feedback.status does not exist
-- Supabase → SQL Editor → coller tout → Run

alter table public.site_feedback add column if not exists status text default 'nouveau';

update public.site_feedback set status = 'nouveau' where status is null or trim(coalesce(status, '')) = '';

update public.site_feedback set status = 'nouveau' where status not in ('nouveau', 'a_faire', 'valide', 'fait');

alter table public.site_feedback alter column status set default 'nouveau';

alter table public.site_feedback alter column status set not null;

alter table public.site_feedback drop constraint if exists site_feedback_status_check;

alter table public.site_feedback add constraint site_feedback_status_check
  check (status in ('nouveau', 'a_faire', 'valide', 'fait'));

create index if not exists site_feedback_status_idx on public.site_feedback (status);

-- S’assurer que les politiques admin (statut + suppression) sont en place
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
