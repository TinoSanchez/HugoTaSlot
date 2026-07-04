-- Colonnes manquantes pour le drop quotidien (erreur 42703 last_claim_day).
-- À exécuter dans Supabase → SQL Editor si le claim échoue avec cette erreur.

alter table public.profiles
  add column if not exists daily_streak integer not null default 0,
  add column if not exists last_claim_day integer,
  add column if not exists last_claim_at timestamptz;

notify pgrst, 'reload schema';
