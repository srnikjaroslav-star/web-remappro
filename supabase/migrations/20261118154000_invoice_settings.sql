insert into public.system_settings (key, value)
values (
  'invoice',
  '{
    "itemName": "Elektronická diagnostika a nastavenie systémov vozidla",
    "iban": "SK46 7500 0000 0040 2556 6439",
    "swift": "CEKOSKBX",
    "dueDays": 14
  }'::jsonb
)
on conflict (key) do nothing;

notify pgrst, 'reload schema';
