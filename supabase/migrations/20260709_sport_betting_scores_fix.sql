-- Expose result_details (period live) dans les listes de matchs
drop function if exists public.list_upcoming_events(text, integer, integer);
drop function if exists public.list_upcoming_events_balanced(integer, integer, integer);

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
  home_score integer,
  away_score integer,
  result_details jsonb,
  markets jsonb
)
language sql
stable
as $$
  select
    e.id, e.external_id, e.sport_key, e.sport_label, e.home_team, e.away_team,
    e.commence_at, e.status, e.home_score, e.away_score, e.result_details,
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
  where (
      (e.status in ('upcoming', 'live')
        and e.commence_at <= now() + (p_hours_ahead || ' hours')::interval
        and e.commence_at >= now() - interval '3 hours')
      or
      (e.status = 'finished' and e.commence_at >= now() - interval '12 hours')
    )
    and (p_sport_key is null or e.sport_key = p_sport_key)
  order by
    case when e.status = 'live' then 0 when e.status = 'upcoming' then 1 else 2 end,
    e.commence_at asc
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;

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
  home_score integer,
  away_score integer,
  result_details jsonb,
  markets jsonb
)
language sql
stable
as $$
  with ranked as (
    select
      e.id, e.external_id, e.sport_key, e.sport_label, e.home_team, e.away_team,
      e.commence_at, e.status, e.home_score, e.away_score, e.result_details,
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
      row_number() over (
        partition by e.sport_key
        order by
          case when e.status = 'live' then 0 when e.status = 'upcoming' then 1 else 2 end,
          e.commence_at asc
      ) as rn
    from public.sport_events e
    where (
        (e.status in ('upcoming', 'live')
          and e.commence_at <= now() + (p_hours_ahead || ' hours')::interval
          and e.commence_at >= now() - interval '3 hours')
        or
        (e.status = 'finished' and e.commence_at >= now() - interval '12 hours')
      )
  )
  select
    r.id, r.external_id, r.sport_key, r.sport_label, r.home_team, r.away_team,
    r.commence_at, r.status, r.home_score, r.away_score, r.result_details, r.markets
  from ranked r
  where r.rn <= greatest(1, least(coalesce(p_per_sport, 80), 500))
  order by
    case when r.status = 'live' then 0 when r.status = 'upcoming' then 1 else 2 end,
    r.commence_at asc
  limit greatest(1, least(coalesce(p_max_total, 4000), 8000));
$$;

grant execute on function public.list_upcoming_events(text, integer, integer) to anon, authenticated;
grant execute on function public.list_upcoming_events_balanced(integer, integer, integer) to anon, authenticated;
