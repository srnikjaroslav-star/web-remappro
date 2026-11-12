-- A credit payment writes the order, the credit ledger, and the invoice in one transaction.
-- The supplier is always REMAPPRO. The buyer is the signed-in client's profile.

alter table public.invoices
  add column if not exists user_id uuid references auth.users(id) on delete set null,
  add column if not exists payment_method text not null default 'credits',
  add column if not exists currency text not null default 'EUR',
  add column if not exists status text not null default 'paid',
  add column if not exists supplier_name text not null default 'REMAPPRO',
  add column if not exists supplier_ico text not null default '41281471',
  add column if not exists supplier_dic text not null default '1041196607',
  add column if not exists supplier_address text not null default 'Janka Kráľa 29, 990 01 Veľký Krtíš, Slovakia',
  add column if not exists customer_first_name text not null default '',
  add column if not exists customer_last_name text not null default '',
  add column if not exists customer_company text not null default '',
  add column if not exists customer_phone text not null default '',
  add column if not exists customer_street text not null default '',
  add column if not exists customer_city text not null default '',
  add column if not exists customer_postal_code text not null default '',
  add column if not exists customer_vat_id text not null default '',
  add column if not exists customer_tax_id text not null default '';

create sequence if not exists public.invoice_number_seq
  as bigint
  start with 20260001
  increment by 1
  minvalue 20260001
  no cycle;

create or replace function public.pay_with_credits(
  p_user_id uuid,
  p_amount numeric,
  p_customer_name text,
  p_customer_email text,
  p_car_brand text,
  p_car_model text,
  p_fuel_type text,
  p_year text,
  p_ecu_type text,
  p_service_type text,
  p_file_url text,
  p_customer_note text,
  p_legal_consent boolean
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(10, 2);
  next_balance numeric(10, 2);
  new_order_id uuid;
  new_order_number text;
  new_invoice_number text;
  profile public.client_profiles%rowtype;
  buyer_name text;
  buyer_email text;
  service_items jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_amount is null or p_amount <= 0 then
    raise exception 'INVALID_AMOUNT';
  end if;

  select balance
    into current_balance
  from public.credit_accounts
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'NO_ACCOUNT';
  end if;

  if current_balance < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  next_balance := current_balance - p_amount;

  update public.credit_accounts
  set balance = next_balance,
      updated_at = now()
  where user_id = p_user_id;

  new_order_number := 'RP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));

  insert into public.orders (
    order_number,
    customer_name,
    customer_email,
    car_brand,
    car_model,
    fuel_type,
    year,
    ecu_type,
    service_type,
    total_price,
    status,
    file_url,
    legal_consent,
    customer_note
  ) values (
    new_order_number,
    nullif(btrim(p_customer_name), ''),
    nullif(lower(btrim(p_customer_email)), ''),
    nullif(btrim(p_car_brand), ''),
    nullif(btrim(p_car_model), ''),
    nullif(btrim(p_fuel_type), ''),
    nullif(btrim(p_year), ''),
    nullif(btrim(p_ecu_type), ''),
    nullif(btrim(p_service_type), ''),
    p_amount,
    'pending',
    nullif(btrim(p_file_url), ''),
    coalesce(p_legal_consent, false),
    nullif(p_customer_note, '')
  )
  returning id into new_order_id;

  insert into public.credit_transactions (user_id, amount, order_id)
  values (p_user_id, -p_amount, new_order_id);

  select *
    into profile
  from public.client_profiles
  where user_id = p_user_id;

  buyer_name := nullif(btrim(coalesce(profile.company_name, '')), '');
  if buyer_name is null then
    buyer_name := nullif(btrim(concat_ws(' ', profile.first_name, profile.last_name)), '');
  end if;
  if buyer_name is null then
    buyer_name := nullif(btrim(coalesce(p_customer_name, '')), '');
  end if;

  buyer_email := nullif(lower(btrim(coalesce(profile.email, ''))), '');
  if buyer_email is null then
    buyer_email := nullif(lower(btrim(coalesce(p_customer_email, ''))), '');
  end if;
  if buyer_email is null then
    raise exception 'MISSING_CUSTOMER';
  end if;

  if left(btrim(coalesce(p_service_type, '')), 1) = '[' then
    service_items := p_service_type::jsonb;
  else
    service_items := '[]'::jsonb;
  end if;

  new_invoice_number := 'INV-' || nextval('public.invoice_number_seq')::text;

  insert into public.invoices (
    invoice_number,
    order_id,
    order_number,
    user_id,
    customer_name,
    customer_email,
    customer_first_name,
    customer_last_name,
    customer_company,
    customer_phone,
    customer_street,
    customer_city,
    customer_postal_code,
    customer_vat_id,
    customer_tax_id,
    amount,
    currency,
    payment_method,
    status,
    supplier_name,
    supplier_ico,
    supplier_dic,
    supplier_address,
    items,
    invoice_date
  ) values (
    new_invoice_number,
    new_order_id,
    new_order_number,
    p_user_id,
    buyer_name,
    buyer_email,
    btrim(coalesce(profile.first_name, '')),
    btrim(coalesce(profile.last_name, '')),
    btrim(coalesce(profile.company_name, '')),
    btrim(coalesce(profile.phone, '')),
    btrim(coalesce(profile.street, '')),
    btrim(coalesce(profile.city, '')),
    btrim(coalesce(profile.postal_code, '')),
    btrim(coalesce(profile.vat_id, '')),
    btrim(coalesce(profile.tax_id, '')),
    p_amount,
    'EUR',
    'credits',
    'paid',
    'REMAPPRO',
    '41281471',
    '1041196607',
    'Janka Kráľa 29, 990 01 Veľký Krtíš, Slovakia',
    service_items,
    now()
  );

  return jsonb_build_object(
    'balance', next_balance,
    'order_id', new_order_id,
    'order_number', new_order_number,
    'invoice_number', new_invoice_number
  );
end;
$$;

revoke all on function public.pay_with_credits(
  uuid, numeric, text, text, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.pay_with_credits(
  uuid, numeric, text, text, text, text, text, text, text, text, text, text, boolean
) to service_role;

notify pgrst, 'reload schema';
