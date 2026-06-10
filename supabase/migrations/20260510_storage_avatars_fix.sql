-- Avatar storage : types MIME réels des navigateurs + politique UPDATE avec WITH CHECK (upsert).

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'avatars',
  'avatars',
  true,
  2 * 1024 * 1024,
  array[
    'image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg',
    'image/webp', 'image/gif'
  ]
)
on conflict (id) do update
  set public = true,
      file_size_limit = 2 * 1024 * 1024,
      allowed_mime_types = array[
        'image/png', 'image/jpeg', 'image/jpg', 'image/pjpeg',
        'image/webp', 'image/gif'
      ];

drop policy if exists "Avatars publicly readable" on storage.objects;
create policy "Avatars publicly readable" on storage.objects
for select using (bucket_id = 'avatars');

drop policy if exists "Avatars upload self" on storage.objects;
create policy "Avatars upload self" on storage.objects
for insert
with check (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "Avatars update self" on storage.objects;
create policy "Avatars update self" on storage.objects
for update
using (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
)
with check (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
);

drop policy if exists "Avatars delete self" on storage.objects;
create policy "Avatars delete self" on storage.objects
for delete using (
  bucket_id = 'avatars'
  and auth.uid() is not null
  and split_part(name, '/', 1) = auth.uid()::text
);
