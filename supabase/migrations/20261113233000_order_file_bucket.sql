insert into storage.buckets (id, name, public, file_size_limit)
values ('tunes', 'tunes', false, 52428800)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

drop policy if exists tunes_select on storage.objects;
create policy tunes_select on storage.objects
for select to authenticated
using (bucket_id = 'tunes');

drop policy if exists tunes_insert on storage.objects;
create policy tunes_insert on storage.objects
for insert to authenticated
with check (bucket_id = 'tunes');

drop policy if exists tunes_update on storage.objects;
create policy tunes_update on storage.objects
for update to authenticated
using (bucket_id = 'tunes')
with check (bucket_id = 'tunes');
