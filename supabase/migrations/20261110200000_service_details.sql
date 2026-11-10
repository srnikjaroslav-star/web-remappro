create table if not exists public.service_details (
  service_id uuid primary key,
  description text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.service_details enable row level security;

drop policy if exists service_details_read on public.service_details;
create policy service_details_read on public.service_details
  for select
  to anon, authenticated
  using (true);

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'service_details'
  ) then
    alter publication supabase_realtime add table public.service_details;
  end if;
end $$;

notify pgrst, 'reload schema';
