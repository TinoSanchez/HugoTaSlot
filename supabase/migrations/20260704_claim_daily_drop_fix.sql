-- Correctifs claim_daily_drop (post-migration p_factor)
-- 0) Colonnes streak sur profiles (migration P0 parfois non appliquée)
-- 1) Ne plus lire auth.users (droits / username unique)
-- 2) Upsert balance atomique (évite new_balance NULL)
-- 3) Recharge le cache PostgREST après CREATE OR REPLACE

alter table public.profiles
  add column if not exists daily_streak integer not null default 0,
  add column if not exists last_claim_day integer,
  add column if not exists last_claim_at timestamptz;

create or replace function public.claim_daily_drop(p_factor numeric default 1.0)
returns table (
  awarded numeric,
  new_balance numeric,
  streak integer,
  next_claim_day integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_today integer := floor(extract(epoch from now()) / 86400)::integer;
  v_last  integer;
  v_streak integer := 0;
  v_base numeric := 25;
  v_bonus_pct numeric := 0;
  v_factor numeric := least(4.0, greatest(0.5, coalesce(p_factor, 1.0)));
  v_award numeric;
  v_new_bal numeric(14,2);
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  -- Profil minimal sans auth.users (évite conflit username unique + droits auth).
  insert into public.profiles (id, display_name)
  values (v_user, 'Player')
  on conflict (id) do nothing;

  select last_claim_day, daily_streak into v_last, v_streak
    from public.profiles
   where id = v_user
   for update;

  if not found then
    raise exception 'profile_not_found';
  end if;

  if v_last is not null and v_last = v_today then
    raise exception 'already_claimed';
  end if;

  if v_last is not null and v_last = v_today - 1 then
    v_streak := coalesce(v_streak, 0) + 1;
  else
    v_streak := 1;
  end if;

  v_bonus_pct := least(2.0, (v_streak - 1) * 0.05);
  v_award := round(v_base * (1.0 + v_bonus_pct) * v_factor, 2);

  update public.profiles
     set daily_streak = v_streak,
         last_claim_day = v_today,
         last_claim_at = now()
   where id = v_user;

  -- Upsert : garantit toujours un new_balance renvoyé au client.
  insert into public.balances (user_id, amount, updated_at, updated_by)
  values (v_user, round((100 + v_award)::numeric, 2), now(), v_user)
  on conflict (user_id) do update
     set amount = round((public.balances.amount + v_award)::numeric, 2),
         updated_at = now(),
         updated_by = v_user
  returning amount into v_new_bal;

  if v_new_bal is null then
    raise exception 'balance_update_failed';
  end if;

  return query select v_award, v_new_bal, v_streak, v_today;
end;
$$;

grant execute on function public.claim_daily_drop(numeric) to authenticated;

notify pgrst, 'reload schema';
