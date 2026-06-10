-- Drop quotidien : garantir une ligne `profiles` avant balances (FK balances → profiles).
-- Évite l'échec du RPC pour comptes auth sans profil (trigger manquant, import, etc.).

create or replace function public.claim_daily_drop()
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
  v_award numeric;
  v_new_bal numeric(14,2);
begin
  if v_user is null then
    raise exception 'auth required';
  end if;

  insert into public.profiles (id, email, username, display_name)
  select u.id,
         u.email,
         nullif(
           lower(regexp_replace(coalesce(u.raw_user_meta_data->>'username', ''), '[^a-zA-Z0-9._-]', '', 'g')),
           ''
         ),
         coalesce(
           nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
           nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
           'Player'
         )
  from auth.users u
  where u.id = v_user
  on conflict (id) do nothing;

  select last_claim_day, daily_streak into v_last, v_streak
    from public.profiles
   where id = v_user
   for update;

  if v_last is not null and v_last = v_today then
    raise exception 'already_claimed';
  end if;

  if v_last is not null and v_last = v_today - 1 then
    v_streak := coalesce(v_streak, 0) + 1;
  else
    v_streak := 1;
  end if;

  v_bonus_pct := least(2.0, (v_streak - 1) * 0.05);
  v_award := round(v_base * (1.0 + v_bonus_pct), 2);

  update public.profiles
     set daily_streak = v_streak,
         last_claim_day = v_today,
         last_claim_at = now()
   where id = v_user;

  insert into public.balances (user_id, amount)
  values (v_user, 100)
  on conflict (user_id) do nothing;

  update public.balances
     set amount = round((amount + v_award)::numeric, 2),
         updated_at = now(),
         updated_by = v_user
   where user_id = v_user
   returning amount into v_new_bal;

  return query select v_award, v_new_bal, v_streak, v_today;
end;
$$;

grant execute on function public.claim_daily_drop() to authenticated;
