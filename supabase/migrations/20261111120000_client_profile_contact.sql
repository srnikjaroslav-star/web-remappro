alter table public.client_profiles
  add column if not exists company_name text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists street text not null default '',
  add column if not exists city text not null default '',
  add column if not exists postal_code text not null default '',
  add column if not exists vat_id text not null default '',
  add column if not exists tax_id text not null default '',
  add column if not exists email text not null default '';

update public.client_profiles as profile
set email = users.email
from auth.users as users
where profile.user_id = users.id
  and profile.email = ''
  and coalesce(users.email, '') <> '';

create or replace function public.handle_new_client_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  fn text := btrim(coalesce(meta->>'first_name', ''));
  ln text := btrim(coalesce(meta->>'last_name', ''));
  combined text := btrim(coalesce(meta->>'full_name', meta->>'name', ''));
begin
  if fn = '' and ln = '' and combined <> '' then
    fn := split_part(combined, ' ', 1);
    ln := btrim(substr(combined, length(fn) + 1));
  end if;

  insert into public.client_profiles (user_id, first_name, last_name, email)
  values (new.id, fn, ln, coalesce(new.email, ''))
  on conflict (user_id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        email = case
          when public.client_profiles.email = '' then excluded.email
          else public.client_profiles.email
        end,
        updated_at = now()
    where public.client_profiles.first_name = ''
      and public.client_profiles.last_name = '';

  return new;
end;
$$;

notify pgrst, 'reload schema';
