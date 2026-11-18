-- Authenticated users only had SELECT. Upsert from the admin portal needs
-- INSERT and UPDATE as well; row level security still limits writes to the admin.
grant insert, update, delete on table public.system_settings to authenticated;

drop policy if exists system_settings_admin_write on public.system_settings;
create policy system_settings_admin_write on public.system_settings
  for all
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'info@remappro.eu')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'info@remappro.eu');
