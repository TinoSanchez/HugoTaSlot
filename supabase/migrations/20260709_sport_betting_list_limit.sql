-- Augmente le plafond de list_upcoming_events (200 → 500 par appel).
-- À exécuter dans Supabase SQL Editor si besoin de plus de matchs par compétition.

create or replace function public.list_upcoming_events(
  p_sport_key text default null,
  p_limit integer default 60,
  p_hours_ahead integer default 168
) returns table (
  id bigint,
  external_id text,
  sport_key text,
  sport_label text,
  home_team text,
  away_team text,
  commence_at timestamptz,
  status text,
  markets jsonb
)
language sql
stable
as $$
  select
    e.id, e.external_id, e.sport_key, e.sport_label, e.home_team, e.away_team,
    e.commence_at, e.status,
    coalesce(
      (
        select jsonb_object_agg(m.market_key, m_data)
        from (
          select market_key,
                 jsonb_build_object(
                   'bookmaker', bookmaker,
                   'outcomes', outcomes,
                   'last_update', last_update
                 ) as m_data
          from public.sport_markets sm
          where sm.event_id = e.id
          order by last_update desc
        ) m
      ),
      '{}'::jsonb
    ) as markets
  from public.sport_events e
  where e.status = 'upcoming'
    and e.commence_at between now() and now() + (p_hours_ahead || ' hours')::interval
    and (p_sport_key is null or e.sport_key = p_sport_key)
  order by e.commence_at asc
  limit greatest(1, least(coalesce(p_limit, 60), 500));
$$;

grant execute on function public.list_upcoming_events(text, integer, integer) to anon, authenticated;
