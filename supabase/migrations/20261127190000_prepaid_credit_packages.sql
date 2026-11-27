-- Prepaid credit packages.
-- A card payment credits the package size (not the discounted euro price),
-- stores the buyer's consent, and does not itself create an order.
-- Spending credits on an order writes a separate ledger row and does not issue an invoice.

alter table public.credit_transactions
  add column if not exists entry_type text;

alter table public.credit_topups
  add column if not exists credits numeric(10, 2),
  add column if not exists company text,
  add column if not exists account_name text,
  add column if not exists account_email text,
  add column if not exists terms_consent boolean not null default false,
  add column if not exists declaration_consent boolean not null default false,
  add column if not exists consented_at timestamptz,
  add column if not exists topup_ref text,
  add column if not exists consent_summary text,
  add column if not exists invoice_number text,
  add column if not exists invoice_sent_at timestamptz,
  add column if not exists notified_at timestamptz;

create unique index if not exists credit_topups_topup_ref_uidx
  on public.credit_topups (topup_ref)
  where topup_ref is not null and topup_ref <> '';

drop function if exists public.apply_credit_topup(uuid, numeric, text, text);

create or replace function public.apply_credit_topup(
  p_user_id uuid,
  p_amount numeric,
  p_stripe_session_id text,
  p_payment_intent_id text default null,
  p_credits numeric default null,
  p_company text default null,
  p_account_name text default null,
  p_account_email text default null,
  p_terms_consent boolean default false,
  p_declaration_consent boolean default false,
  p_consented_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(10, 2);
  next_balance numeric(10, 2);
  amount numeric(10, 2);
  credits_to_add numeric(10, 2);
  intent text;
  topup_ref text;
  consented timestamptz;
  company_value text;
  name_value text;
  email_value text;
  summary text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  amount := round(coalesce(p_amount, 0), 2);
  intent := nullif(btrim(coalesce(p_payment_intent_id, '')), '');

  if p_user_id is null or amount <= 0 or amount > 100000 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_stripe_session_id is null or left(p_stripe_session_id, 3) <> 'cs_' then
    raise exception 'INVALID_SESSION';
  end if;

  perform pg_advisory_xact_lock(hashtext('remappro-credit-topup-' || p_stripe_session_id));

  if exists (
    select 1
    from public.credit_topups
    where stripe_session_id = p_stripe_session_id
       or (intent is not null and payment_intent_id = intent)
  ) then
    select balance
      into current_balance
    from public.credit_accounts
    where user_id = p_user_id;

    return jsonb_build_object(
      'balance', current_balance,
      'credited', false,
      'user_id', p_user_id,
      'amount', amount
    );
  end if;

  select pack.credits
    into credits_to_add
  from (
    values
      (25.00::numeric, 25.00::numeric),
      (50.00, 50.00),
      (100.00, 100.00),
      (285.00, 300.00),
      (450.00, 500.00),
      (850.00, 1000.00)
  ) as pack(price, credits)
  where pack.price = amount;

  if credits_to_add is null then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_credits is not null and round(p_credits, 2) <> credits_to_add then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_terms_consent is not true or p_declaration_consent is not true then
    raise exception 'CONSENT_REQUIRED';
  end if;

  topup_ref := 'DB-' || upper(right(regexp_replace(p_stripe_session_id, '[^A-Za-z0-9]', '', 'g'), 12));
  consented := coalesce(p_consented_at, now());
  company_value := nullif(btrim(coalesce(p_company, '')), '');
  name_value := nullif(btrim(coalesce(p_account_name, '')), '');
  email_value := nullif(lower(btrim(coalesce(p_account_email, ''))), '');
  summary := format(
    'Súhlas a vyhlásenie odberateľa (dobitie %s): účet %s, firma %s, potvrdené dňa %s. Odberateľ elektronicky potvrdil obchodné podmienky a vyhlásenie o použití úpravy výhradne na off-road, motorsport alebo export.',
    topup_ref,
    coalesce(email_value, name_value, '—'),
    coalesce(company_value, '—'),
    to_char(consented at time zone 'Europe/Bratislava', 'DD.MM.YYYY HH24:MI')
  );

  insert into public.credit_accounts (user_id, balance)
  values (p_user_id, 0)
  on conflict (user_id) do nothing;

  select balance
    into current_balance
  from public.credit_accounts
  where user_id = p_user_id
  for update;

  if not found then
    raise exception 'NO_ACCOUNT';
  end if;

  next_balance := round(current_balance + credits_to_add, 2);

  update public.credit_accounts
  set balance = next_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_transactions (user_id, amount, note, entry_type)
  values (
    p_user_id,
    credits_to_add,
    'Dobitie balíka ' || trim(to_char(credits_to_add, 'FM999999')) || ' kreditov',
    'topup'
  );

  insert into public.credit_topups (
    stripe_session_id,
    payment_intent_id,
    user_id,
    amount,
    credits,
    company,
    account_name,
    account_email,
    terms_consent,
    declaration_consent,
    consented_at,
    topup_ref,
    consent_summary
  ) values (
    p_stripe_session_id,
    intent,
    p_user_id,
    amount,
    credits_to_add,
    company_value,
    name_value,
    email_value,
    true,
    true,
    consented,
    topup_ref,
    summary
  );

  return jsonb_build_object(
    'balance', next_balance,
    'credited', true,
    'user_id', p_user_id,
    'amount', amount,
    'credits', credits_to_add,
    'topup_ref', topup_ref
  );
end;
$$;

revoke all on function public.apply_credit_topup(uuid, numeric, text, text, numeric, text, text, text, boolean, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_credit_topup(uuid, numeric, text, text, numeric, text, text, text, boolean, boolean, timestamptz)
  to service_role;

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
  engine_value text;
  stored_note text;
  note_line text;
  service_json jsonb;
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

  if p_legal_consent is not true then
    raise exception 'CONSENT_REQUIRED';
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

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'vehicle_brand'
  ) then
    engine_value := null;
    stored_note := '';
    if nullif(p_customer_note, '') is not null then
      for note_line in
        select btrim(item)
        from unnest(string_to_array(p_customer_note, E'\n')) as item
      loop
        if engine_value is null and note_line ~* '^Motor:\s*\S' then
          engine_value := nullif(btrim(regexp_replace(note_line, '^Motor:\s*', '', 'i')), '');
        elsif note_line <> '' and note_line !~* '^RP-[A-Z0-9]+$' then
          stored_note := case
            when stored_note = '' then note_line
            else stored_note || E'\n' || note_line
          end;
        end if;
      end loop;
    end if;
    stored_note := new_order_number || case when stored_note = '' then '' else E'\n' || stored_note end;

    if left(btrim(coalesce(p_service_type, '')), 1) = '[' then
      service_json := p_service_type::jsonb;
    else
      service_json := '[]'::jsonb;
    end if;

    insert into public.orders (
      user_id,
      vehicle_brand,
      vehicle_model,
      vehicle_year,
      engine,
      ecu,
      fuel,
      services,
      total_price,
      status,
      file_url,
      note
    ) values (
      p_user_id,
      nullif(btrim(p_car_brand), ''),
      nullif(btrim(p_car_model), ''),
      nullif(btrim(p_year), ''),
      engine_value,
      nullif(btrim(p_ecu_type), ''),
      nullif(btrim(p_fuel_type), ''),
      service_json::json,
      p_amount,
      'pending',
      nullif(btrim(p_file_url), ''),
      stored_note
    )
    returning id into new_order_id;
  else
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
      true,
      nullif(p_customer_note, '')
    )
    returning id into new_order_id;
  end if;

  insert into public.credit_transactions (user_id, amount, order_id, note, entry_type)
  values (p_user_id, -p_amount, new_order_id, 'Čerpanie kreditov', 'spend');

  return jsonb_build_object(
    'balance', next_balance,
    'order_id', new_order_id,
    'order_number', new_order_number
  );
end;
$$;

create or replace function public.claim_credit_package_invoice(p_stripe_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  topup public.credit_topups%rowtype;
  invoice_year integer;
  number text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  if p_stripe_session_id is null or left(p_stripe_session_id, 3) <> 'cs_' then
    raise exception 'INVALID_SESSION';
  end if;

  select *
    into topup
  from public.credit_topups
  where stripe_session_id = p_stripe_session_id
  for update;

  if not found then
    return jsonb_build_object('claimed', false, 'reason', 'missing');
  end if;

  if topup.invoice_sent_at is not null then
    return jsonb_build_object('claimed', false, 'reason', 'sent', 'invoice_number', topup.invoice_number);
  end if;

  number := nullif(btrim(coalesce(topup.invoice_number, '')), '');
  if number is null then
    invoice_year := extract(year from (now() at time zone 'Europe/Bratislava'))::integer;
    number := public.next_accounting_number('invoice', invoice_year);
  end if;

  update public.credit_topups
  set invoice_number = number,
      invoice_sent_at = now()
  where stripe_session_id = p_stripe_session_id;

  return jsonb_build_object(
    'claimed', true,
    'invoice_number', number,
    'user_id', topup.user_id,
    'amount', topup.amount,
    'credits', topup.credits,
    'company', topup.company,
    'account_name', topup.account_name,
    'account_email', topup.account_email,
    'consented_at', topup.consented_at,
    'topup_ref', topup.topup_ref,
    'consent_summary', topup.consent_summary,
    'notified_at', topup.notified_at
  );
end;
$$;

create or replace function public.release_credit_package_invoice(p_stripe_session_id text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  update public.credit_topups
  set invoice_sent_at = null
  where stripe_session_id = p_stripe_session_id;
end;
$$;

revoke all on function public.claim_credit_package_invoice(text) from public, anon, authenticated;
grant execute on function public.claim_credit_package_invoice(text) to service_role;

revoke all on function public.release_credit_package_invoice(text) from public, anon, authenticated;
grant execute on function public.release_credit_package_invoice(text) to service_role;

notify pgrst, 'reload schema';
