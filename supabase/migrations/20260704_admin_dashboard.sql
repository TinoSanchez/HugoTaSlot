-- Dashboard admin + modération tournoi en lot

create or replace function public.get_admin_dashboard_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_month text := to_char(timezone('Europe/Paris', now()), 'YYYY-MM');
  v_cutoff timestamptz := now() - interval '7 days';
  v_pending int;
  v_verified_month int;
  v_submitted_month int;
  v_hunts_total int;
  v_hunts_7d int;
  v_active_7d int;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  select count(*)::int into v_pending
    from public.tournament_entries where verified = false;

  select count(*)::int into v_verified_month
    from public.tournament_entries
   where verified = true and period_month = v_month;

  select count(*)::int into v_submitted_month
    from public.tournament_entries
   where period_month = v_month;

  select count(*)::int into v_hunts_total
    from public.hunts where coalesce(archived, false) = false;

  select count(*)::int into v_hunts_7d
    from public.hunts
   where created_at >= v_cutoff and coalesce(archived, false) = false;

  select count(*)::int into v_active_7d
    from (
      select distinct gs.user_id as uid
        from public.game_sessions gs
       where gs.created_at >= v_cutoff
      union
      select p.id
        from public.profiles p
       where p.last_claim_at >= v_cutoff
          or p.updated_at >= v_cutoff
    ) active_users;

  return jsonb_build_object(
    'period_month', v_month,
    'tournoi_pending', coalesce(v_pending, 0),
    'tournoi_verified_month', coalesce(v_verified_month, 0),
    'tournoi_submitted_month', coalesce(v_submitted_month, 0),
    'hunts_cloud_total', coalesce(v_hunts_total, 0),
    'hunts_created_7d', coalesce(v_hunts_7d, 0),
    'active_players_7d', coalesce(v_active_7d, 0)
  );
end;
$$;

create or replace function public.admin_moderate_tournament_entries(
  p_entry_ids uuid[],
  p_action text default 'verify'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := lower(trim(coalesce(p_action, 'verify')));
  v_count int := 0;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'admin only';
  end if;

  if p_entry_ids is null or array_length(p_entry_ids, 1) is null then
    return jsonb_build_object('ok', true, 'count', 0, 'action', v_action);
  end if;

  if v_action = 'reject' then
    with d as (
      delete from public.tournament_entries
       where id = any(p_entry_ids) and verified = false
      returning id
    )
    select count(*)::int into v_count from d;
    if v_count > 0 then
      perform public.admin_log(
        'reject_tournament_batch',
        null,
        'tournament_entries',
        array_length(p_entry_ids, 1)::text,
        jsonb_build_object('count', v_count)
      );
    end if;
  elsif v_action = 'verify' then
    with u as (
      update public.tournament_entries
         set verified = true
       where id = any(p_entry_ids) and verified = false
      returning id
    )
    select count(*)::int into v_count from u;
    if v_count > 0 then
      perform public.admin_log(
        'verify_tournament_batch',
        null,
        'tournament_entries',
        array_length(p_entry_ids, 1)::text,
        jsonb_build_object('count', v_count)
      );
    end if;
  else
    raise exception 'invalid action: use verify or reject';
  end if;

  return jsonb_build_object('ok', true, 'count', v_count, 'action', v_action);
end;
$$;

grant execute on function public.get_admin_dashboard_stats() to authenticated;
grant execute on function public.admin_moderate_tournament_entries(uuid[], text) to authenticated;

notify pgrst, 'reload schema';
