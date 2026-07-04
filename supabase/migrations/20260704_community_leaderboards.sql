-- Classements communautaires (wager mini-jeux, streak drop) + lecture publique via RPC security definer.

create or replace function public.get_leaderboard_wager(p_limit int default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(t))
    from (
      select
        coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.username), ''), 'Joueur') as player_name,
        round(sum(gs.stake)::numeric, 2) as wager,
        count(*)::int as rounds
      from public.game_sessions gs
      join public.profiles p on p.id = gs.user_id
      where p.status = 'active'
      group by gs.user_id, p.display_name, p.username
      having sum(gs.stake) > 0
      order by sum(gs.stake) desc
      limit greatest(1, least(coalesce(p_limit, 5), 25))
    ) t
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_leaderboard_streak(p_limit int default 5)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return coalesce((
    select jsonb_agg(row_to_json(t))
    from (
      select
        coalesce(nullif(trim(p.display_name), ''), nullif(trim(p.username), ''), 'Joueur') as player_name,
        greatest(0, coalesce(p.daily_streak, 0))::int as streak,
        p.last_claim_at
      from public.profiles p
      where p.status = 'active'
        and coalesce(p.daily_streak, 0) > 0
      order by coalesce(p.daily_streak, 0) desc, p.last_claim_at desc nulls last
      limit greatest(1, least(coalesce(p_limit, 5), 25))
    ) t
  ), '[]'::jsonb);
end;
$$;

grant execute on function public.get_leaderboard_wager(int) to anon, authenticated;
grant execute on function public.get_leaderboard_streak(int) to anon, authenticated;
