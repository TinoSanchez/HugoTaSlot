-- Table : public.rumble_videos
-- Vidéos détectées sur Rumble (scraping page chaîne) — dédup + annonces Discord.

create table if not exists public.rumble_videos (
  id                    uuid primary key default gen_random_uuid(),
  video_id              text not null unique,              -- permalink_id Rumble (ex: v7c6jnu)
  channel_slug          text not null,
  channel_label         text,
  title                 text not null,
  url                   text not null,
  thumbnail             text,
  description           text,
  published_at          timestamptz not null,
  posted_to_discord_at  timestamptz,
  discord_message_id    text,
  created_at            timestamptz not null default now()
);

create index if not exists rumble_videos_published_idx
  on public.rumble_videos (published_at desc);
create index if not exists rumble_videos_channel_idx
  on public.rumble_videos (channel_slug);

alter table public.rumble_videos enable row level security;

drop policy if exists "rumble_videos_read_all" on public.rumble_videos;
create policy "rumble_videos_read_all" on public.rumble_videos
  for select to anon, authenticated using (true);
