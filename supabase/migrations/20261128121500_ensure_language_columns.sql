alter table public.orders
  add column if not exists language text;

alter table public.client_profiles
  add column if not exists language text;

notify pgrst, 'reload schema';
