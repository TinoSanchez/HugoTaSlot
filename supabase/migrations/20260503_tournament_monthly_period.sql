-- Tournoi mensuel : chaque entrée est rattachée au mois calendaire (Europe/Paris).
-- Le leaderboard affiche uniquement le mois en cours ; le podium conserve le top 3 du mois précédent.

alter table public.tournament_entries
  add column if not exists period_month text;

update public.tournament_entries
set period_month = coalesce(
  period_month,
  to_char((created_at at time zone 'Europe/Paris'), 'YYYY-MM'),
  '1970-01'
)
where period_month is null;

alter table public.tournament_entries
  alter column period_month set not null;

comment on column public.tournament_entries.period_month is
  'Mois de compétition (Europe/Paris), format YYYY-MM — défini uniquement côté serveur à l''insertion.';

-- Valeur toujours alignée sur le mois civil à Paris (pas modifiable par le client).
create or replace function public.tournament_entries_set_period_month()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.period_month := to_char((now() at time zone 'Europe/Paris')::date, 'YYYY-MM');
  return new;
end;
$$;

drop trigger if exists tournament_entries_set_period_month on public.tournament_entries;
create trigger tournament_entries_set_period_month
  before insert on public.tournament_entries
  for each row
  execute function public.tournament_entries_set_period_month();

create index if not exists tournament_entries_period_month_multiplier_idx
  on public.tournament_entries (period_month, multiplier desc);
