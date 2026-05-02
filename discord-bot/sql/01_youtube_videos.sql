-- ────────────────────────────────────────────────────────────────────────────
-- Table : public.youtube_videos
-- Stocke chaque vidéo détectée par le bot (RSS YouTube) pour ne rien dupliquer
-- et alimenter la page "Actualités" du site.
-- ────────────────────────────────────────────────────────────────────────────

create table if not exists public.youtube_videos (
  id            uuid primary key default gen_random_uuid(),
  video_id      text not null unique,                   -- id YouTube (ex: dQw4w9WgXcQ)
  channel_id    text not null,
  channel_label text,
  title         text not null,
  url           text not null,
  thumbnail     text,
  description   text,
  published_at  timestamptz not null,
  posted_to_discord_at timestamptz,
  discord_message_id   text,
  created_at    timestamptz not null default now()
);

create index if not exists youtube_videos_published_idx
  on public.youtube_videos (published_at desc);
create index if not exists youtube_videos_channel_idx
  on public.youtube_videos (channel_id);

-- RLS : lecture publique (pour la page Actualités), écriture réservée au bot via service_role.
alter table public.youtube_videos enable row level security;

drop policy if exists "youtube_videos_read_all" on public.youtube_videos;
create policy "youtube_videos_read_all" on public.youtube_videos
  for select to anon, authenticated using (true);

-- L'INSERT/UPDATE/DELETE n'a aucune policy => bloqué pour anon/authenticated.
-- Le bot utilise SUPABASE_SERVICE_ROLE_KEY qui bypasse RLS.
