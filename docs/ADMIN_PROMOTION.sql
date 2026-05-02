-- Remplacer par l'ID du compte à promouvoir admin
update public.profiles
set role = 'admin'
where id = '00000000-0000-0000-0000-000000000000';

-- Vérification
select id, email, username, display_name, role
from public.profiles
where id = '00000000-0000-0000-0000-000000000000';
