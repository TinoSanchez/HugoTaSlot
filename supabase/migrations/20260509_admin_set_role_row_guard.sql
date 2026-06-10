-- Évite un succès silencieux si p_user_id ne correspond à aucun profil.

create or replace function public.admin_set_role(p_user_id uuid, p_role public.app_role, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;
  update public.profiles set role = p_role where id = p_user_id;
  if not found then
    raise exception 'profile_not_found';
  end if;
  perform public.admin_log('set_role', p_user_id, 'profiles', p_user_id::text, jsonb_build_object('role', p_role, 'reason', p_reason));
end;
$$;
