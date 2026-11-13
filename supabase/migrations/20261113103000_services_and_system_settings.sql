-- Catalog and opening-hours settings for the new Supabase project.
-- The price list matches the services the portal already shows.

create table if not exists public.services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10, 2) not null check (price >= 0 and price <= 100000),
  category text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.service_details (
  service_id uuid primary key references public.services (id) on delete cascade,
  description text not null default '',
  updated_at timestamptz not null default now()
);

create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.services enable row level security;
alter table public.service_details enable row level security;
alter table public.system_settings enable row level security;

grant select on public.services to anon, authenticated;
grant select, insert, update, delete on public.services to service_role;
grant select on public.service_details to anon, authenticated;
grant select, insert, update, delete on public.service_details to service_role;
grant select on public.system_settings to anon, authenticated;
grant select, insert, update, delete on public.system_settings to service_role;

drop policy if exists services_read on public.services;
create policy services_read on public.services
  for select
  to anon, authenticated
  using (true);

drop policy if exists service_details_read on public.service_details;
create policy service_details_read on public.service_details
  for select
  to anon, authenticated
  using (true);

drop policy if exists system_settings_read on public.system_settings;
create policy system_settings_read on public.system_settings
  for select
  to anon, authenticated
  using (true);

drop policy if exists system_settings_admin_write on public.system_settings;
create policy system_settings_admin_write on public.system_settings
  for all
  to authenticated
  using (lower(coalesce(auth.jwt() ->> 'email', '')) = 'info@remappro.eu')
  with check (lower(coalesce(auth.jwt() ->> 'email', '')) = 'info@remappro.eu');

insert into public.services (id, name, price, category)
values
  ('7f9d3ec4-aecc-4395-9513-adac12310bfe', 'ADBlue - AGRI & CONSTRUCTION', 150.00, 'Emission Control'),
  ('2f522ba8-8fc8-47f8-869b-eb8a01b361d5', 'ADBlue/SCR - Personal Car', 25.00, 'Emission Control'),
  ('f67bfdb1-6ffc-443e-9a99-c23815755cc1', 'ADBlue/SCR - Truck Car', 50.00, 'Emission Control'),
  ('3861e524-ba7a-4916-8818-1932d28fa92a', 'AGS - Removal', 25.00, 'Emission Control'),
  ('9da75719-dda1-4efb-abb6-34272ba74e04', 'CVN Calibration', 15.00, 'Emission Control'),
  ('7a271054-d1e8-4331-a98a-b00def19cfdf', 'DPF - Removal', 25.00, 'Emission Control'),
  ('678a1573-5693-4c96-9006-6a08f6b73e22', 'EGR - Removal', 25.00, 'Emission Control'),
  ('9651b249-f38c-42fa-9db7-972f40fb9958', 'Emisná (Ek/STK)', 45.00, 'Emission Control'),
  ('0af05835-88d7-4dc6-b174-b52f62c63f54', 'Eolys OFF', 25.00, 'Emission Control'),
  ('0e7b3e07-df31-4177-947d-c66573fcd06a', 'GPF/OPF - Removal', 25.00, 'Emission Control'),
  ('a82e8df9-d2b1-4352-8008-ce8ea15a25ca', 'Lambda/O2 - Removal', 15.00, 'Emission Control'),
  ('5d7921c5-5bdf-4945-b24d-3447dfc04058', 'Readiness Calibration', 15.00, 'Emission Control'),
  ('9dacf0c3-65bb-4ac7-848c-300085ee9857', 'ACT- Disabling The Cylinders', 30.00, 'Engine Functions'),
  ('6d72be02-5ef2-4e12-b70b-cf4a86ab6b5c', 'Boost Sensor Calib 3.5Bar', 15.00, 'Engine Functions'),
  ('5ce62dfd-0836-4329-ae51-2804ea8084bc', 'Boost Sensor Calib 3Bar', 15.00, 'Engine Functions'),
  ('3d0d34a3-2a39-422a-81de-a456df70a62b', 'Boost Sensor Calib 4Bar', 15.00, 'Engine Functions'),
  ('5a660af7-0c4e-41cb-a972-91b5d3fa1174', 'Burbles Activation', 35.00, 'Engine Functions'),
  ('0e6d1660-f395-4410-a30b-d34ac7abc601', 'Cold Start Repair', 25.00, 'Engine Functions'),
  ('872e6c17-e29f-4079-bfca-e47b62c8d36a', 'DTC ECU - Removal', 15.00, 'Engine Functions'),
  ('9210eb89-c4ff-493d-9175-4aff8d06e33a', 'DTC TCU - Removal', 25.00, 'Engine Functions'),
  ('1879c429-4b23-4df7-baee-de8be1f53506', 'Exhaust Flap - Removal', 15.00, 'Engine Functions'),
  ('a633b2d1-e812-4b09-914b-7cb61b7e2f4b', 'Flaps/Swirl - Removal', 15.00, 'Engine Functions'),
  ('d9a732ea-b0f7-4f18-8942-9961985574da', 'Glow Plugs (Time)', 25.00, 'Engine Functions'),
  ('8d4740cc-4769-488d-94d2-902656387dcb', 'Hot Start Fix', 15.00, 'Engine Functions'),
  ('0a526c27-41b0-4029-aaf0-b4043f74549e', 'Idle Speed (Rpm)', 25.00, 'Engine Functions'),
  ('150e66de-59d0-4319-a4ea-5be8b53155eb', 'Kickdown Deactivation', 15.00, 'Engine Functions'),
  ('e28d3992-16fc-4c80-a938-698439dc4cf7', 'Launch Control', 25.00, 'Engine Functions'),
  ('9446f219-8ad6-4264-a05f-c5afb5dc84c8', 'MAF - Removal', 15.00, 'Engine Functions'),
  ('b5012bfb-6b6d-49e7-bdb1-881f25f74641', 'Oil Pressure Set (kPa)', 25.00, 'Engine Functions'),
  ('81c2380e-161b-450a-8d04-9cfd8849b0a2', 'SAP - Removal', 15.00, 'Engine Functions'),
  ('92fb1f54-41bd-4ac5-90b6-a92626dcea86', 'Soft Rev Limiter OFF', 25.00, 'Engine Functions'),
  ('73cca8a4-e00d-4e22-8711-bcf017b98f26', 'Speed Limiter VMax (km/h)', 15.00, 'Engine Functions'),
  ('f8d505f6-b2cc-4990-90ce-702929d58c18', 'Sport Displays Calib', 15.00, 'Engine Functions'),
  ('14b9d060-fcbe-4602-a799-245bec91c531', 'Start Stop Disable', 15.00, 'Engine Functions'),
  ('8dd7d05c-3b24-4327-ad57-b0062f20edb1', 'Torque (Errors) OFF', 15.00, 'Engine Functions'),
  ('05dc195a-0c02-4663-8773-8e77a9ffc256', 'Torque Monitoring Disable', 15.00, 'Engine Functions'),
  ('050edd66-7251-43fe-bebd-8535d27847df', 'TVA - Removal', 15.00, 'Engine Functions'),
  ('7e6b6879-8756-4270-8a14-03e50fa2c0fa', 'Stage 1 Diesel · 1995–2004', 30.00, 'Performance'),
  ('3be34513-256e-4841-9e19-11cb7b5cb754', 'Stage 1 Diesel · 2005–2008', 40.00, 'Performance'),
  ('56d79431-c1d8-4e2a-b5a3-9996cd2922f8', 'Stage 1 Diesel · 2009–2012', 45.00, 'Performance'),
  ('29e6addc-ce20-498e-a156-2382083c087f', 'Stage 1 Diesel · 2013–2016', 50.00, 'Performance'),
  ('aaa6599a-a62e-43f5-b236-4f6995a62fdc', 'Stage 1 Diesel · 2017–2026', 60.00, 'Performance'),
  ('3f273b90-1dc2-4bfc-928c-f71cb55b632d', 'Stage 1 Gasoline / Petrol · 1995–2004', 40.00, 'Performance'),
  ('c1dea0c7-602e-4cb6-813e-b4c7b47cc1ca', 'Stage 1 Gasoline / Petrol · 2005–2008', 50.00, 'Performance'),
  ('54b3f0c2-6c05-4e00-b69c-8e62981bfee6', 'Stage 1 Gasoline / Petrol · 2009–2012', 60.00, 'Performance'),
  ('2d61b889-58ec-4e95-9c58-41ce0c8a4516', 'Stage 1 Gasoline / Petrol · 2013–2016', 70.00, 'Performance'),
  ('62cdf6cc-1c62-460b-a37e-33a88377c4cf', 'Stage 1 Gasoline / Petrol · 2017–2026', 80.00, 'Performance'),
  ('977d7f7c-e426-4beb-92e5-2fe36bb69c7a', 'TCU Downshift RPM', 35.00, 'Performance'),
  ('9208a60e-426c-402e-b571-ffbd50fca56d', 'TCU Launch Control', 25.00, 'Performance'),
  ('6f1bb368-5c5f-415d-b951-90ab8e2256d5', 'TCU Torque Limiter (NM)', 25.00, 'Performance'),
  ('7d752964-2daf-417a-adb3-f2d8b710289a', 'TCU Trendimpex OFF', 35.00, 'Performance'),
  ('696d6760-5dbe-49a2-94c4-fee6020ff6b8', 'ECU Clone - Bosch (EDC17xx)', 25.00, 'Security'),
  ('93c8e338-177b-4ef7-a34c-f9f071083cf1', 'Immo OFF - Removal', 25.00, 'Security'),
  ('e61e9031-c087-4378-b7f3-aed4073c43f3', 'Immo OFF - Siemens (PCR2.1)', 35.00, 'Security')
on conflict (id) do update
set
  name = excluded.name,
  price = excluded.price,
  category = excluded.category;

insert into public.system_settings (key, value)
values (
  'system_status',
  '{
    "mode": "auto",
    "schedule": {
      "mon": {"open": true, "from": "08:00", "to": "20:00"},
      "tue": {"open": true, "from": "08:00", "to": "20:00"},
      "wed": {"open": true, "from": "08:00", "to": "20:00"},
      "thu": {"open": true, "from": "08:00", "to": "20:00"},
      "fri": {"open": true, "from": "08:00", "to": "20:00"},
      "sat": {"open": true, "from": "08:00", "to": "20:00"},
      "sun": {"open": true, "from": "08:00", "to": "20:00"}
    }
  }'::jsonb
)
on conflict (key) do nothing;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'services'
    ) then
      alter publication supabase_realtime add table public.services;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'service_details'
    ) then
      alter publication supabase_realtime add table public.service_details;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'system_settings'
    ) then
      alter publication supabase_realtime add table public.system_settings;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
