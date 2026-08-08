-- Matchs en direct : liste + paris live autorisés
-- À exécuter dans Supabase SQL Editor si pas encore appliqué.

-- ─── Paris autorisés sur matchs live ───────────────────────────────────────
create or replace function public.place_sport_bet(
  p_event_id bigint,
  p_market_key text,
  p_bookmaker text,
  p_selection_name text,
  p_selection_label text,
  p_selection_details jsonb,
  p_stake numeric,
  p_odd numeric
) returns table (bet_id uuid, new_balance numeric, potential_payout numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_event public.sport_events%rowtype;
  v_market_outcomes jsonb;
  v_current_odd numeric;
  v_balance numeric(14,2);
  v_new_balance numeric(14,2);
  v_bet_id uuid;
  v_payout numeric(14,2);
  v_stake numeric(14,2);
  v_odd numeric(10,4);
begin
  if v_user is null then raise exception 'auth_required'; end if;

  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'profile_inactive';
  end if;

  select * into v_event from public.sport_events where id = p_event_id;
  if not found then raise exception 'event_not_found'; end if;
  if v_event.status not in ('upcoming', 'live') then raise exception 'event_not_open'; end if;
  if v_event.status = 'upcoming' and v_event.commence_at <= now() + interval '30 seconds' then
    raise exception 'event_starting_soon';
  end if;

  select outcomes into v_market_outcomes
    from public.sport_markets
   where event_id = p_event_id
     and market_key = p_market_key
     and bookmaker = p_bookmaker
   order by last_update desc
   limit 1;
  if v_market_outcomes is null then raise exception 'market_not_found'; end if;

  select (o->>'price')::numeric into v_current_odd
    from jsonb_array_elements(v_market_outcomes) o
   where o->>'name' = p_selection_name
   limit 1;
  if v_current_odd is null then raise exception 'selection_not_found'; end if;
  if abs(v_current_odd - p_odd) / v_current_odd > 0.05 then
    raise exception 'odd_changed' using detail = jsonb_build_object('current', v_current_odd, 'submitted', p_odd)::text;
  end if;

  v_stake := round(p_stake::numeric, 2);
  v_odd := round(p_odd::numeric, 4);
  if v_stake < 10 or v_stake > 500000 then raise exception 'stake_out_of_bounds'; end if;
  if v_odd < 1.01 or v_odd > 501 then raise exception 'odd_invalid'; end if;
  v_payout := round((v_stake * v_odd)::numeric, 2);

  insert into public.balances (user_id, amount)
    values (v_user, 100) on conflict (user_id) do nothing;

  select amount into v_balance
    from public.balances
   where user_id = v_user
   for update;

  if v_balance < v_stake then raise exception 'insufficient_balance' using detail = jsonb_build_object('balance', v_balance, 'stake', v_stake)::text; end if;

  update public.balances
     set amount = round((amount - v_stake)::numeric, 2),
         updated_at = now(),
         updated_by = v_user
   where user_id = v_user
   returning amount into v_new_balance;

  insert into public.sport_bets (
    user_id, event_id, market_key, bookmaker, selection_name, selection_label,
    selection_details, stake, odd, potential_payout, status, meta
  ) values (
    v_user, p_event_id, p_market_key, p_bookmaker, p_selection_name, p_selection_label,
    coalesce(p_selection_details, '{}'::jsonb), v_stake, v_odd, v_payout, 'pending',
    jsonb_build_object(
      'event', jsonb_build_object(
        'sport_key', v_event.sport_key,
        'sport_label', v_event.sport_label,
        'home_team', v_event.home_team,
        'away_team', v_event.away_team,
        'commence_at', v_event.commence_at,
        'status', v_event.status
      )
    )
  ) returning id into v_bet_id;

  insert into public.wallet_transactions (user_id, delta, reason, ref_type, ref_id, balance_after)
    values (v_user, -v_stake, 'bet_place', 'sport_bet', v_bet_id::text, v_new_balance);

  return query select v_bet_id, v_new_balance, v_payout;
end;
$$;

-- ─── Liste : upcoming + live (3 h de fenêtre pour les live) ─────────────────
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
  where e.status in ('upcoming', 'live')
    and e.commence_at <= now() + (p_hours_ahead || ' hours')::interval
    and e.commence_at >= now() - interval '3 hours'
    and (p_sport_key is null or e.sport_key = p_sport_key)
  order by case when e.status = 'live' then 0 else 1 end, e.commence_at asc
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
      row_number() over (
        partition by e.sport_key
        order by case when e.status = 'live' then 0 else 1 end, e.commence_at asc
      ) as rn
    from public.sport_events e
    where e.status in ('upcoming', 'live')
      and e.commence_at <= now() + (p_hours_ahead || ' hours')::interval
      and e.commence_at >= now() - interval '3 hours'
  )
  select
    r.id, r.external_id, r.sport_key, r.sport_label, r.home_team, r.away_team,
    r.commence_at, r.status, r.markets
  from ranked r
  where r.rn <= greatest(1, least(coalesce(p_per_sport, 80), 500))
  order by case when r.status = 'live' then 0 else 1 end, r.commence_at asc
  limit greatest(1, least(coalesce(p_max_total, 4000), 8000));
$$;

create or replace function public.list_upcoming_sport_keys(
  p_hours_ahead integer default 168
) returns table (sport_key text)
language sql
stable
as $$
  select distinct e.sport_key
  from public.sport_events e
  where e.status in ('upcoming', 'live')
    and e.commence_at <= now() + (p_hours_ahead || ' hours')::interval
    and e.commence_at >= now() - interval '3 hours'
  order by e.sport_key;
$$;
