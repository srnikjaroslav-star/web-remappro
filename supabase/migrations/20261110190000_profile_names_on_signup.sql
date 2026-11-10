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

  insert into public.client_profiles (user_id, first_name, last_name)
  values (new.id, fn, ln)
  on conflict (user_id) do update
    set first_name = excluded.first_name,
        last_name = excluded.last_name,
        updated_at = now()
    where public.client_profiles.first_name = ''
      and public.client_profiles.last_name = '';

  return new;
end;
$$;

update public.client_profiles as profile
set
  first_name = source.first_name,
  last_name = source.last_name,
  updated_at = now()
from (
  select
    users.id,
    case
      when btrim(coalesce(users.raw_user_meta_data->>'first_name', '')) <> ''
        then btrim(users.raw_user_meta_data->>'first_name')
      when btrim(coalesce(users.raw_user_meta_data->>'full_name', users.raw_user_meta_data->>'name', '')) <> ''
        then split_part(btrim(coalesce(users.raw_user_meta_data->>'full_name', users.raw_user_meta_data->>'name')), ' ', 1)
      else ''
    end as first_name,
    case
      when btrim(coalesce(users.raw_user_meta_data->>'last_name', '')) <> ''
        then btrim(users.raw_user_meta_data->>'last_name')
      when btrim(coalesce(users.raw_user_meta_data->>'first_name', '')) = ''
        and btrim(coalesce(users.raw_user_meta_data->>'full_name', users.raw_user_meta_data->>'name', '')) <> ''
        then btrim(substr(
          btrim(coalesce(users.raw_user_meta_data->>'full_name', users.raw_user_meta_data->>'name')),
          length(split_part(btrim(coalesce(users.raw_user_meta_data->>'full_name', users.raw_user_meta_data->>'name')), ' ', 1)) + 1
        ))
      else ''
    end as last_name
  from auth.users as users
) as source
where profile.user_id = source.id
  and profile.first_name = ''
  and profile.last_name = ''
  and (source.first_name <> '' or source.last_name <> '');

notify pgrst, 'reload schema';
