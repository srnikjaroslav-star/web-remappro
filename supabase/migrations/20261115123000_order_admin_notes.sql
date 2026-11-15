alter table public.orders
  add column if not exists checksum_crc text,
  add column if not exists important_note text;

notify pgrst, 'reload schema';
