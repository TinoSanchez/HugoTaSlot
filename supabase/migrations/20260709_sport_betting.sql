-- ═══════════════════════════════════════════════════════════════════════════
--  Paris sportifs virtuels — HugoTaSlot
--
--  Utilise la table `balances` existante (monnaie virtuelle HugoCoins).
--  Aucune monnaie réelle, aucun retrait — 100 % légal (pas d'agrément ANJ requis).
--
--  Tables :
--    - sport_events            : matchs (sync auto depuis PropLine)
--    - sport_markets           : cotes par marché (h2h, totals, correct_score, BTTS, spreads)
--    - sport_bets              : paris utilisateurs
--    - wallet_transactions     : audit ledger de toutes les mouvements HugoCoins
--    - daily_bonus_claims      : bonus quotidien anti-double-claim
--
--  RPC :
--    - place_sport_bet         : placer un pari (atomique, vérifie balance, débite)
--    - settle_sport_bet        : régler un pari (service_role uniquement)
--    - claim_daily_bet_bonus   : bonus quotidien +100 (streak)
--    - list_upcoming_events    : matchs à venir (avec cotes agrégées)
--    - my_sport_bets           : historique perso
--    - sport_bets_leaderboard  : top mensuel des parieurs (profit net)
--
--  À exécuter dans Supabase SQL Editor après les migrations précédentes.
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── Tables ─────────────────────────────────────────────────────────────────

create table if not exists public.sport_events (
  id bigint generated always as identity primary key,
  external_id text unique not null,       -- PropLine event_id
  sport_key text not null,                -- soccer_ligue_1, basketball_nba, ...
  sport_label text,                       -- "Ligue 1", "NBA", ...
  home_team text not null,
  away_team text not null,
  commence_at timestamptz not null,
  status text not null default 'upcoming' check (status in ('upcoming','live','finished','cancelled')),
  home_score integer,
  away_score integer,
  result_details jsonb,                   -- corners, cartons, buteurs, etc.
  refreshed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sport_events_commence_idx on public.sport_events (commence_at);
create index if not exists sport_events_sport_idx on public.sport_events (sport_key, commence_at);
create index if not exists sport_events_status_idx on public.sport_events (status);

create table if not exists public.sport_markets (
  id bigint generated always as identity primary key,
  event_id bigint not null references public.sport_events(id) on delete cascade,
  market_key text not null,               -- h2h, totals, correct_score, btts, spreads, anytime_goal_scorer
  bookmaker text not null,                -- pinnacle, draftkings, bovada, ...
  outcomes jsonb not null,                -- [{"name":"home","price":2.10},{"name":"draw","price":3.40},{"name":"away","price":3.20}]
  last_update timestamptz not null default now(),
  unique (event_id, market_key, bookmaker)
);
create index if not exists sport_markets_event_idx on public.sport_markets (event_id);

create table if not exists public.sport_bets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_id bigint not null references public.sport_events(id) on delete restrict,
  market_key text not null,
  bookmaker text,
  selection_name text not null,           -- "home", "draw", "away", "over_2.5", "1-0", "yes", ...
  selection_label text,                   -- version humaine ("Victoire PSG", "+2.5 buts", ...)
  selection_details jsonb,                -- payload libre
  stake numeric(14,2) not null check (stake >= 10 and stake <= 500000),
  odd numeric(10,4) not null check (odd >= 1.01),
  potential_payout numeric(14,2) not null,
  status text not null default 'pending' check (status in ('pending','won','lost','void','refunded','cashout')),
  payout numeric(14,2),
  placed_at timestamptz not null default now(),
  settled_at timestamptz,
  meta jsonb                              -- snapshot event/market pour histo
);
create index if not exists sport_bets_user_idx on public.sport_bets (user_id, placed_at desc);
create index if not exists sport_bets_event_idx on public.sport_bets (event_id);
create index if not exists sport_bets_pending_idx on public.sport_bets (event_id) where status = 'pending';

create table if not exists public.wallet_transactions (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles(id) on delete cascade,
  delta numeric(14,2) not null,
  reason text not null,                   -- bet_place | bet_win | bet_refund | daily_bonus | admin_adjust
  ref_type text,                          -- "sport_bet" | "daily_bonus_claim" | ...
  ref_id text,
  balance_after numeric(14,2),
  created_at timestamptz not null default now()
);
create index if not exists wallet_transactions_user_idx on public.wallet_transactions (user_id, created_at desc);
create index if not exists wallet_transactions_reason_idx on public.wallet_transactions (reason, created_at desc);

create table if not exists public.daily_bonus_claims (
  user_id uuid not null references public.profiles(id) on delete cascade,
  claim_day integer not null,             -- floor(epoch/86400)
  amount numeric(14,2) not null,
  streak integer not null default 1,
  created_at timestamptz not null default now(),
  primary key (user_id, claim_day)
);

-- Trigger updated_at
drop trigger if exists trg_sport_events_updated_at on public.sport_events;
create trigger trg_sport_events_updated_at before update on public.sport_events
for each row execute function public.touch_updated_at();

-- ─── RLS ────────────────────────────────────────────────────────────────────

alter table public.sport_events enable row level security;
alter table public.sport_markets enable row level security;
alter table public.sport_bets enable row level security;
alter table public.wallet_transactions enable row level security;
alter table public.daily_bonus_claims enable row level security;

-- sport_events : lecture publique (les matchs sont infos publiques)
drop policy if exists sport_events_read_all on public.sport_events;
create policy sport_events_read_all on public.sport_events for select using (true);
-- mutations : service_role uniquement (bot Discord) → RLS refuse tout, seul service_role bypass

-- sport_markets : lecture publique
drop policy if exists sport_markets_read_all on public.sport_markets;
create policy sport_markets_read_all on public.sport_markets for select using (true);

-- sport_bets : chacun voit ses paris, admin voit tout
drop policy if exists sport_bets_read_self_or_admin on public.sport_bets;
create policy sport_bets_read_self_or_admin on public.sport_bets
for select using (user_id = auth.uid() or public.is_admin());
-- INSERT/UPDATE via RPC seulement (place_sport_bet + settle_sport_bet)

-- wallet_transactions : self ou admin
drop policy if exists wallet_tx_read_self_or_admin on public.wallet_transactions;
create policy wallet_tx_read_self_or_admin on public.wallet_transactions
for select using (user_id = auth.uid() or public.is_admin());

-- daily_bonus_claims : self
drop policy if exists daily_bonus_read_self on public.daily_bonus_claims;
create policy daily_bonus_read_self on public.daily_bonus_claims
for select using (user_id = auth.uid() or public.is_admin());

-- ─── RPC : placer un pari ──────────────────────────────────────────────────

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

  -- Vérifie profil actif
  if not exists (select 1 from public.profiles where id = v_user and status = 'active') then
    raise exception 'profile_inactive';
  end if;

  -- Récupère et verrouille l'event
  select * into v_event from public.sport_events where id = p_event_id;
  if not found then raise exception 'event_not_found'; end if;
  if v_event.status <> 'upcoming' then raise exception 'event_not_open'; end if;
  if v_event.commence_at <= now() + interval '30 seconds' then raise exception 'event_starting_soon'; end if;

  -- Vérifie qu'un marché existe pour ce bookmaker
  select outcomes into v_market_outcomes
    from public.sport_markets
   where event_id = p_event_id
     and market_key = p_market_key
     and bookmaker = p_bookmaker
   order by last_update desc
   limit 1;
  if v_market_outcomes is null then raise exception 'market_not_found'; end if;

  -- Anti-triche : vérifier que la cote proposée existe dans les outcomes actuels
  -- (tolérance ±5 % pour absorber les variations pendant la soumission)
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
  if v_odd < 1.01 then raise exception 'odd_invalid'; end if;
  v_payout := round((v_stake * v_odd)::numeric, 2);

  -- Verrouille la balance
  insert into public.balances (user_id, amount)
    values (v_user, 100) on conflict (user_id) do nothing;

  select amount into v_balance
    from public.balances
   where user_id = v_user
   for update;

  if v_balance < v_stake then raise exception 'insufficient_balance' using detail = jsonb_build_object('balance', v_balance, 'stake', v_stake)::text; end if;

  -- Débite
  update public.balances
     set amount = round((amount - v_stake)::numeric, 2),
         updated_at = now(),
         updated_by = v_user
   where user_id = v_user
   returning amount into v_new_balance;

  -- Insert bet
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
        'commence_at', v_event.commence_at
      )
    )
  ) returning id into v_bet_id;

  -- Ledger
  insert into public.wallet_transactions (user_id, delta, reason, ref_type, ref_id, balance_after)
    values (v_user, -v_stake, 'bet_place', 'sport_bet', v_bet_id::text, v_new_balance);

  return query select v_bet_id, v_new_balance, v_payout;
end;
$$;
grant execute on function public.place_sport_bet(bigint, text, text, text, text, jsonb, numeric, numeric) to authenticated;

-- ─── RPC : régler un pari (service_role uniquement — appelé par le bot) ────

create or replace function public.settle_sport_bet(
  p_bet_id uuid,
  p_status text,       -- 'won' | 'lost' | 'void'
  p_payout numeric     -- 0 si lost | stake si void | stake*odd si won
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bet public.sport_bets%rowtype;
  v_new_balance numeric(14,2);
  v_credit numeric(14,2);
begin
  -- Autorisation : service_role bypasse RLS mais on garde une garde souple.
  -- (Admin humain autorisé aussi pour cas exceptionnels.)
  if auth.jwt() ->> 'role' <> 'service_role' and not public.is_admin(auth.uid()) then
    raise exception 'forbidden';
  end if;

  select * into v_bet from public.sport_bets where id = p_bet_id for update;
  if not found then raise exception 'bet_not_found'; end if;
  if v_bet.status <> 'pending' then raise exception 'already_settled' using detail = v_bet.status; end if;
  if p_status not in ('won','lost','void') then raise exception 'invalid_status'; end if;

  v_credit := coalesce(round(p_payout::numeric, 2), 0);

  update public.sport_bets
     set status = p_status,
         payout = case when p_status = 'won' then v_credit
                       when p_status = 'void' then v_bet.stake
                       else 0 end,
         settled_at = now()
   where id = p_bet_id;

  if p_status = 'won' then
    update public.balances
       set amount = round((amount + v_credit)::numeric, 2),
           updated_at = now()
     where user_id = v_bet.user_id
     returning amount into v_new_balance;
    insert into public.wallet_transactions (user_id, delta, reason, ref_type, ref_id, balance_after)
      values (v_bet.user_id, v_credit, 'bet_win', 'sport_bet', v_bet.id::text, v_new_balance);
  elsif p_status = 'void' then
    update public.balances
       set amount = round((amount + v_bet.stake)::numeric, 2),
           updated_at = now()
     where user_id = v_bet.user_id
     returning amount into v_new_balance;
    insert into public.wallet_transactions (user_id, delta, reason, ref_type, ref_id, balance_after)
      values (v_bet.user_id, v_bet.stake, 'bet_refund', 'sport_bet', v_bet.id::text, v_new_balance);
  else
    insert into public.wallet_transactions (user_id, delta, reason, ref_type, ref_id, balance_after)
      values (v_bet.user_id, 0, 'bet_lost', 'sport_bet', v_bet.id::text,
              (select amount from public.balances where user_id = v_bet.user_id));
  end if;
end;
$$;
grant execute on function public.settle_sport_bet(uuid, text, numeric) to authenticated, service_role;

-- ─── RPC : bonus quotidien (+100 base, +10 par jour de streak, max +300) ──

create or replace function public.claim_daily_bet_bonus()
returns table (awarded numeric, new_balance numeric, streak integer, next_claim_day integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today integer := floor(extract(epoch from now()) / 86400)::integer;
  v_last_day integer;
  v_streak integer;
  v_award numeric;
  v_new_bal numeric(14,2);
begin
  if v_user is null then raise exception 'auth_required'; end if;

  if exists (select 1 from public.daily_bonus_claims where user_id = v_user and claim_day = v_today) then
    raise exception 'already_claimed';
  end if;

  select max(claim_day) into v_last_day from public.daily_bonus_claims where user_id = v_user;
  if v_last_day is not null and v_last_day = v_today - 1 then
    select coalesce(streak, 1) into v_streak
      from public.daily_bonus_claims where user_id = v_user and claim_day = v_last_day;
    v_streak := coalesce(v_streak, 0) + 1;
  else
    v_streak := 1;
  end if;

  -- Base 100 + 10 par jour de streak, plafonné à 300
  v_award := least(300, 100 + (v_streak - 1) * 10);

  insert into public.daily_bonus_claims (user_id, claim_day, amount, streak)
    values (v_user, v_today, v_award, v_streak);

  insert into public.balances (user_id, amount)
    values (v_user, 100) on conflict (user_id) do nothing;

  update public.balances
     set amount = round((amount + v_award)::numeric, 2),
         updated_at = now()
   where user_id = v_user
   returning amount into v_new_bal;

  insert into public.wallet_transactions (user_id, delta, reason, ref_type, ref_id, balance_after)
    values (v_user, v_award, 'daily_bonus', 'daily_bonus_claim', v_today::text, v_new_bal);

  return query select v_award, v_new_bal, v_streak, v_today + 1;
end;
$$;
grant execute on function public.claim_daily_bet_bonus() to authenticated;

-- ─── RPC : liste des matchs à venir (avec cotes agrégées) ─────────────────

create or replace function public.list_upcoming_events(
  p_sport_key text default null,
  p_limit integer default 60,
  p_hours_ahead integer default 168        -- 7 jours par défaut
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
  limit greatest(1, least(coalesce(p_limit, 60), 200));
$$;
grant execute on function public.list_upcoming_events(text, integer, integer) to anon, authenticated;

-- ─── RPC : historique perso des paris ─────────────────────────────────────

create or replace function public.my_sport_bets(
  p_status text default null,
  p_limit integer default 50
) returns table (
  id uuid,
  event_id bigint,
  event_snapshot jsonb,
  market_key text,
  bookmaker text,
  selection_name text,
  selection_label text,
  stake numeric,
  odd numeric,
  potential_payout numeric,
  status text,
  payout numeric,
  placed_at timestamptz,
  settled_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id, b.event_id, b.meta->'event' as event_snapshot,
    b.market_key, b.bookmaker, b.selection_name, b.selection_label,
    b.stake, b.odd, b.potential_payout, b.status, b.payout,
    b.placed_at, b.settled_at
  from public.sport_bets b
  where b.user_id = auth.uid()
    and (p_status is null or b.status = p_status)
  order by b.placed_at desc
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$$;
grant execute on function public.my_sport_bets(text, integer) to authenticated;

-- ─── RPC : leaderboard mensuel (profit net des paris réglés) ──────────────

create or replace function public.sport_bets_leaderboard(
  p_year integer default null,
  p_month integer default null,
  p_limit integer default 20
) returns table (
  user_id uuid,
  display_name text,
  avatar_url text,
  bets_count integer,
  won_count integer,
  total_stake numeric,
  total_payout numeric,
  net_profit numeric,
  hit_rate numeric
)
language sql
stable
as $$
  with target as (
    select
      coalesce(p_year, extract(year from now())::integer) as y,
      coalesce(p_month, extract(month from now())::integer) as m
  ),
  agg as (
    select
      b.user_id,
      count(*)::integer as bets_count,
      count(*) filter (where b.status = 'won')::integer as won_count,
      sum(b.stake)::numeric as total_stake,
      sum(coalesce(b.payout, 0))::numeric as total_payout
    from public.sport_bets b, target t
    where b.status in ('won', 'lost', 'void', 'refunded')
      and extract(year from b.settled_at) = t.y
      and extract(month from b.settled_at) = t.m
    group by b.user_id
  )
  select
    a.user_id,
    p.display_name,
    p.avatar_url,
    a.bets_count,
    a.won_count,
    a.total_stake,
    a.total_payout,
    round((a.total_payout - a.total_stake)::numeric, 2) as net_profit,
    case when a.bets_count > 0
         then round((a.won_count::numeric / a.bets_count::numeric) * 100, 1)
         else 0 end as hit_rate
  from agg a
  join public.profiles p on p.id = a.user_id
  order by net_profit desc, won_count desc
  limit greatest(1, least(coalesce(p_limit, 20), 100));
$$;
grant execute on function public.sport_bets_leaderboard(integer, integer, integer) to anon, authenticated;

-- ─── RPC : dernières transactions du wallet ────────────────────────────────

create or replace function public.my_wallet_transactions(p_limit integer default 30)
returns table (
  id bigint,
  delta numeric,
  reason text,
  ref_type text,
  ref_id text,
  balance_after numeric,
  created_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select id, delta, reason, ref_type, ref_id, balance_after, created_at
  from public.wallet_transactions
  where user_id = auth.uid()
  order by created_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 200));
$$;
grant execute on function public.my_wallet_transactions(integer) to authenticated;
