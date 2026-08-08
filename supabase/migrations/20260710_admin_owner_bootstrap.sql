-- Propriétaires du site : accès admin Supabase (RPC admin_list_users, hunts, soldes…)
-- Doit correspondre à FORCED_ADMIN_IDS dans scripts/pages/auth-cloud.js

create or replace function public.is_admin(uid uuid default auth.uid())
returns boolean
language sql
stable
set search_path = public
as $$
  select uid is not null and (
    uid in (
      '02b7e350-b802-4ddf-937f-a5172080c8fa'::uuid,
      'c86cbb06-7765-4216-ad83-7e8e8eb0c3a9'::uuid,
      'b0cfa138-c7e6-42e7-ab15-724d2e1f4844'::uuid
    )
    or exists (
      select 1 from public.profiles p
      where p.id = uid and p.role = 'admin' and p.status = 'active'
    )
  );
$$;

-- Profil propriétaire principal
update public.profiles
set
  role = 'admin',
  username = '19ep_raitro12',
  display_name = '19EP_Raitro12',
  status = 'active'
where id = 'b0cfa138-c7e6-42e7-ab15-724d2e1f4844';

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'username', '19EP_Raitro12',
    'display_name', '19EP_Raitro12'
  )
where id = 'b0cfa138-c7e6-42e7-ab15-724d2e1f4844';
