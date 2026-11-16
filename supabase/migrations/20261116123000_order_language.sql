alter table public.orders add column if not exists language text;

notify pgrst, 'reload schema';
