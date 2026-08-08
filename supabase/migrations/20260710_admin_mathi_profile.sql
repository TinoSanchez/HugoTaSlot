-- Compte propriétaire : admin + pseudo affiché exact
-- ID : b0cfa138-c7e6-42e7-ab15-724d2e1f4844
-- username = identifiant connexion (minuscules, unique)
-- display_name = pseudo visible (casse conservée)

update public.profiles
set
  role = 'admin',
  username = '19ep_raitro12',
  display_name = '19EP_Raitro12'
where id = 'b0cfa138-c7e6-42e7-ab15-724d2e1f4844';

update auth.users
set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb)
  || jsonb_build_object(
    'username', '19EP_Raitro12',
    'display_name', '19EP_Raitro12'
  )
where id = 'b0cfa138-c7e6-42e7-ab15-724d2e1f4844';
