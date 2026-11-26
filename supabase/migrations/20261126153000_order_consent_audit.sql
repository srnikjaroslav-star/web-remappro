-- Audit trail for the terms consent and the emission off-road declaration
-- captured when an order is paid with credits.
-- Existing rows keep their current legal_consent value when that column
-- is already present. New columns default to "not recorded".

alter table public.orders
  add column if not exists legal_consent boolean default false,
  add column if not exists legal_consent_at timestamptz,
  add column if not exists emission_offroad_consent boolean default false,
  add column if not exists emission_offroad_consent_at timestamptz,
  add column if not exists consent_summary text;

comment on column public.orders.legal_consent is
  'Customer confirmed the terms, privacy policy and refund policy.';
comment on column public.orders.legal_consent_at is
  'UTC time when the terms consent was recorded.';
comment on column public.orders.emission_offroad_consent is
  'Customer confirmed the emission off-road, motorsport or export declaration.';
comment on column public.orders.emission_offroad_consent_at is
  'UTC time when the emission off-road declaration was recorded.';
comment on column public.orders.consent_summary is
  'Exact consent wording shown to the customer, in the language of the order.';

notify pgrst, 'reload schema';
