-- ────────────────────────────────────────────────────────────────────────────
-- Table : public.bot_state
-- Mémoire du bot : derniers GUID/IDs traités par chaque watcher, etc.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.bot_state (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bot_state enable row level security;

-- Aucune policy => personne sauf le service_role n'y accède (le bot uniquement).
