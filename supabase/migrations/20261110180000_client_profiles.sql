create table if not exists public.client_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  updated_at timestamptz not null default now()
);

alter table public.client_profiles enable row level security;

drop policy if exists client_profiles_select_own on public.client_profiles;
create policy client_profiles_select_own
  on public.client_profiles
  for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists client_profiles_insert_own on public.client_profiles;
create policy client_profiles_insert_own
  on public.client_profiles
  for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists client_profiles_update_own on public.client_profiles;
create policy client_profiles_update_own
  on public.client_profiles
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

revoke all on public.client_profiles from public, anon;
grant select, insert, update on public.client_profiles to authenticated;
grant all on public.client_profiles to service_role;

insert into public.client_profiles (user_id)
select id from auth.users
on conflict (user_id) do nothing;

create or replace function public.handle_new_client_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.client_profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_profile on auth.users;
create trigger on_auth_user_created_profile
  after insert on auth.users
  for each row execute function public.handle_new_client_profile();

notify pgrst, 'reload schema';
