-- Paris sportifs PRO : scores live en liste + combinés + résultats récents
-- À exécuter dans Supabase SQL Editor.

-- PostgreSQL n'autorise pas CREATE OR REPLACE si le type de retour change → DROP d'abord.
drop function if exists public.list_upcoming_events(text, integer, integer);
drop function if exists public.list_upcoming_events_balanced(integer, integer, integer);
drop function if exists public.list_upcoming_sport_keys(integer);
drop function if exists public.place_sport_combo_bet(jsonb, numeric);

-- ─── Liste avec scores ───────────────────────────────────────────────────────
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
  markets jsonb
)
language sql
stable
as $$
  select
    e.id, e.external_id, e.sport_key, e.sport_label, e.home_team, e.away_team,
    e.commence_at, e.status, e.home_score, e.away_score,
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
  markets jsonb
)
language sql
stable
as $$
  with ranked as (
    select
      e.id, e.external_id, e.sport_key, e.sport_label, e.home_team, e.away_team,
      e.commence_at, e.status, e.home_score, e.away_score,
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
    r.commence_at, r.status, r.home_score, r.away_score, r.markets
  from ranked r
  where r.rn <= greatest(1, least(coalesce(p_per_sport, 80), 500))
  order by
    case when r.status = 'live' then 0 when r.status = 'upcoming' then 1 else 2 end,
    r.commence_at asc
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
  where (
      (e.status in ('upcoming', 'live')
        and e.commence_at <= now() + (p_hours_ahead || ' hours')::interval
        and e.commence_at >= now() - interval '3 hours')
      or
      (e.status = 'finished' and e.commence_at >= now() - interval '12 hours')
    )
  order by e.sport_key;
$$;

-- ─── Pari combiné (2 à 8 sélections, cote produit) ───────────────────────────
create or replace function public.place_sport_combo_bet(
  p_legs jsonb,
  p_stake numeric
) returns table (bet_id uuid, new_balance numeric, potential_payout numeric, combined_odd numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_leg jsonb;
  v_event public.sport_events%rowtype;
  v_market_outcomes jsonb;
  v_current_odd numeric;
  v_balance numeric(14,2);
  v_new_balance numeric(14,2);
  v_bet_id uuid;
  v_payout numeric(14,2);
  v_stake numeric(14,2);
  v_combined numeric(10,4) := 1;
  v_first_event_id bigint;
  v_legs jsonb := '[]'::jsonb;
  v_labels text := '';
begin
  if v_user is null then raise exception 'auth_required'; end if;
  if jsonb_array_length(coalesce(p_legs, '[]'::jsonb)) < 2 then raise exception 'combo_min_legs'; end if;
  if jsonb_array_length(p_legs) > 8 then raise exception 'combo_max_legs'; end if;

  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'profile_inactive';
  end if;

  for v_leg in select * from jsonb_array_elements(p_legs) loop
    select * into v_event from public.sport_events where id = (v_leg->>'event_id')::bigint;
    if not found then raise exception 'event_not_found'; end if;
    if v_event.status not in ('upcoming', 'live') then raise exception 'event_not_open'; end if;

    select outcomes into v_market_outcomes
      from public.sport_markets
     where event_id = v_event.id
       and market_key = v_leg->>'market_key'
       and bookmaker = v_leg->>'bookmaker'
     order by last_update desc limit 1;
    if v_market_outcomes is null then raise exception 'market_not_found'; end if;

    select (o->>'price')::numeric into v_current_odd
      from jsonb_array_elements(v_market_outcomes) o
     where o->>'name' = v_leg->>'selection_name' limit 1;
    if v_current_odd is null then raise exception 'selection_not_found'; end if;
    if abs(v_current_odd - (v_leg->>'odd')::numeric) / v_current_odd > 0.05 then
      raise exception 'odd_changed';
    end if;

    v_combined := round((v_combined * v_current_odd)::numeric, 4);
    if v_first_event_id is null then v_first_event_id := v_event.id; end if;
    v_legs := v_legs || jsonb_build_array(v_leg);
    v_labels := v_labels || case when v_labels <> '' then ' + ' else '' end
      || coalesce(v_leg->>'selection_label', v_leg->>'selection_name');
  end loop;

  v_stake := round(p_stake::numeric, 2);
  if v_stake < 10 or v_stake > 500000 then raise exception 'stake_out_of_bounds'; end if;
  if v_combined < 1.01 or v_combined > 500000 then raise exception 'odd_invalid'; end if;
  v_payout := round((v_stake * v_combined)::numeric, 2);

  insert into public.balances (user_id, amount) values (v_user, 100)
    on conflict (user_id) do nothing;

  select amount into v_balance from public.balances where user_id = v_user for update;
  if v_balance < v_stake then raise exception 'insufficient_balance'; end if;

  update public.balances
     set amount = round((amount - v_stake)::numeric, 2), updated_at = now(), updated_by = v_user
   where user_id = v_user returning amount into v_new_balance;

  insert into public.sport_bets (
    user_id, event_id, market_key, bookmaker, selection_name, selection_label,
    selection_details, stake, odd, potential_payout, status, meta
  ) values (
    v_user, v_first_event_id, 'combo', 'hugotaslot', 'combo',
    left(v_labels, 500),
    jsonb_build_object('legs', v_legs),
    v_stake, v_combined, v_payout, 'pending',
    jsonb_build_object('legs', v_legs, 'type', 'combo')
  ) returning id into v_bet_id;

  insert into public.wallet_transactions (user_id, delta, reason, ref_type, ref_id, balance_after)
    values (v_user, -v_stake, 'bet_place', 'sport_bet', v_bet_id::text, v_new_balance);

  return query select v_bet_id, v_new_balance, v_payout, v_combined;
end;
$$;

grant execute on function public.place_sport_combo_bet(jsonb, numeric) to authenticated;

grant execute on function public.list_upcoming_events(text, integer, integer) to anon, authenticated;
grant execute on function public.list_upcoming_events_balanced(integer, integer, integer) to anon, authenticated;
grant execute on function public.list_upcoming_sport_keys(integer) to anon, authenticated;
