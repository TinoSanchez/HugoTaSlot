-- Charge les matchs à venir de façon équilibrée : N max par sport_key
-- (évite qu'un sport — ex. tennis — monopolise toute la liste).
-- À exécuter dans Supabase SQL Editor.

create or replace function public.list_upcoming_events_balanced(
  p_per_sport integer default 80,
  p_hours_ahead integer default 168,
  p_max_total integer default 4000
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
  with ranked as (
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
      ) as markets,
      row_number() over (partition by e.sport_key order by e.commence_at asc) as rn
    from public.sport_events e
    where e.status = 'upcoming'
      and e.commence_at between now() and now() + (p_hours_ahead || ' hours')::interval
  )
  select
    r.id, r.external_id, r.sport_key, r.sport_label, r.home_team, r.away_team,
    r.commence_at, r.status, r.markets
  from ranked r
  where r.rn <= greatest(1, least(coalesce(p_per_sport, 80), 500))
  order by r.commence_at asc
  limit greatest(1, least(coalesce(p_max_total, 4000), 8000));
$$;

grant execute on function public.list_upcoming_events_balanced(integer, integer, integer) to anon, authenticated;

-- Clés sport distinctes avec matchs à venir (fallback frontend).
create or replace function public.list_upcoming_sport_keys(
  p_hours_ahead integer default 168
) returns table (sport_key text)
language sql
stable
as $$
  select distinct e.sport_key
  from public.sport_events e
  where e.status = 'upcoming'
    and e.commence_at between now() and now() + (p_hours_ahead || ' hours')::interval
  order by e.sport_key;
$$;

grant execute on function public.list_upcoming_sport_keys(integer) to anon, authenticated;
