-- Promouvoir l'utilisateur c86cbb06-7765-4216-ad83-7e8e8eb0c3a9 en admin.
-- Exécuter dans Supabase → SQL Editor.

update public.profiles
   set role = 'admin'::app_role,
       status = 'active'
 where id = 'c86cbb06-7765-4216-ad83-7e8e8eb0c3a9';

-- Vérification :
select id, username, role, status
  from public.profiles
 where id = 'c86cbb06-7765-4216-ad83-7e8e8eb0c3a9';
