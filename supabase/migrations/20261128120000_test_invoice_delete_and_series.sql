-- Next invoice and credit-note numbers follow the highest document that still
-- exists for that year. After every test invoice for 2026 is removed, the
-- next invoice is 20260001. A remaining 20260004 makes the next one 20260005.
-- The stored counter is only a record of the last issued serial. It is not
-- allowed to keep a deleted number reserved.
--
-- delete_test_credit_package_invoice removes a credit-top-up document only
-- when it is a zero-amount test top-up: Admin Test, srnik.jaroslav@gmail.com,
-- a cs_admtest session, or a TEST100 / admin-test consent. A paid Stripe
-- top-up stays in place so a webhook replay cannot credit the account again.

create or replace function public.highest_accounting_serial(p_kind text, p_year integer)
returns integer
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  prefix text;
  pattern text;
  mark text;
  serial integer := 0;
  value integer;
begin
  if p_kind = 'invoice' then
    prefix := p_year::text;
  elsif p_kind = 'credit' then
    prefix := '9' || substr(p_year::text, 2, 3);
  else
    return 0;
  end if;

  pattern := '^' || prefix || '[0-9]{4}$';
  if p_kind = 'invoice' then
    mark := '\[\[rp-invoice\]\](' || prefix || '[0-9]{4})';
  else
    mark := '\[\[rp-credit\]\](' || prefix || '[0-9]{4})';
  end if;

  if p_kind = 'invoice'
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'credit_topups'
         and column_name = 'invoice_number'
     ) then
    execute
      'select coalesce(max((right(invoice_number, 4))::integer), 0)
       from public.credit_topups
       where invoice_number ~ $1'
      into value
      using pattern;
    if coalesce(value, 0) > serial then
      serial := value;
    end if;
  end if;

  if p_kind = 'invoice'
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'orders'
         and column_name = 'invoice_number'
     ) then
    execute
      'select coalesce(max((right(invoice_number, 4))::integer), 0)
       from public.orders
       where invoice_number ~ $1'
      into value
      using pattern;
    if coalesce(value, 0) > serial then
      serial := value;
    end if;
  end if;

  if p_kind = 'credit'
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'orders'
         and column_name = 'credit_note_number'
     ) then
    execute
      'select coalesce(max((right(credit_note_number, 4))::integer), 0)
       from public.orders
       where credit_note_number ~ $1'
      into value
      using pattern;
    if coalesce(value, 0) > serial then
      serial := value;
    end if;
  end if;

  if p_kind = 'invoice'
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'invoices'
         and column_name = 'invoice_number'
     ) then
    execute
      'select coalesce(max((right(invoice_number, 4))::integer), 0)
       from public.invoices
       where invoice_number ~ $1'
      into value
      using pattern;
    if coalesce(value, 0) > serial then
      serial := value;
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'orders'
      and column_name = 'note'
  ) then
    execute
      'select coalesce(max((right((regexp_match(coalesce(note, ''''), $1))[1], 4))::integer), 0)
       from public.orders
       where coalesce(note, '''') ~ $1'
      into value
      using mark;
    if coalesce(value, 0) > serial then
      serial := value;
    end if;
  end if;

  return serial;
end;
$$;

revoke all on function public.highest_accounting_serial(text, integer) from public, anon, authenticated;
grant execute on function public.highest_accounting_serial(text, integer) to service_role;

create or replace function public.next_accounting_number(p_kind text, p_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  next_serial integer := 1;
  prefix text;
  candidate text;
begin
  if p_kind not in ('invoice', 'credit') then
    raise exception 'INVALID_KIND';
  end if;

  if p_year is null or p_year < 2000 or p_year > 9999 then
    raise exception 'INVALID_YEAR';
  end if;

  if coalesce(auth.role(), '') <> 'service_role' then
    if auth.uid() is null then
      raise exception 'FORBIDDEN';
    end if;
    if lower(coalesce(auth.jwt() ->> 'email', '')) not in ('info@remappro.eu', 'srnik.jaroslav@gmail.com')
       and lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', auth.jwt() -> 'user_metadata' ->> 'role', '')) <> 'admin' then
      raise exception 'FORBIDDEN';
    end if;
  end if;

  if p_kind = 'invoice' then
    prefix := p_year::text;
  else
    prefix := '9' || substr(p_year::text, 2, 3);
  end if;

  perform pg_advisory_xact_lock(hashtext('remappro-document-' || p_kind || '-' || p_year::text)::bigint);

  insert into public.accounting_number_counters (kind, year, last_serial)
  values (p_kind, p_year, 0)
  on conflict (kind, year) do nothing;

  perform 1
  from public.accounting_number_counters
  where kind = p_kind
    and year = p_year
  for update;

  next_serial := public.highest_accounting_serial(p_kind, p_year) + 1;

  loop
    if next_serial > 9999 then
      raise exception 'NUMBER_EXHAUSTED';
    end if;

    candidate := prefix || lpad(next_serial::text, 4, '0');
    exit when not public.accounting_number_taken(p_kind, candidate);
    next_serial := next_serial + 1;
  end loop;

  update public.accounting_number_counters
  set last_serial = next_serial
  where kind = p_kind
    and year = p_year;

  return candidate;
end;
$$;

create or replace function public.delete_test_credit_package_invoice(p_stripe_session_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  topup public.credit_topups%rowtype;
  test_flag boolean := false;
  test_account boolean := false;
  current_balance numeric(10, 2);
  reversed numeric(10, 2) := 0;
  next_balance numeric(10, 2);
  invoice_year integer;
  remaining integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  if p_stripe_session_id is null or btrim(p_stripe_session_id) = '' then
    raise exception 'INVALID_SESSION';
  end if;

  select *
    into topup
  from public.credit_topups
  where stripe_session_id = p_stripe_session_id
  for update;

  if not found then
    return jsonb_build_object('deleted', false, 'reason', 'missing');
  end if;

  test_flag := left(coalesce(topup.stripe_session_id, ''), 10) = 'cs_admtest'
    or coalesce(topup.consent_summary, '') ilike '%TEST100%'
    or coalesce(topup.consent_summary, '') ilike '%admin test%';
  test_account := lower(btrim(coalesce(topup.account_email, ''))) = 'srnik.jaroslav@gmail.com'
    or lower(btrim(coalesce(topup.account_name, ''))) = 'admin test'
    or lower(btrim(coalesce(topup.company, ''))) = 'admin test';

  if not (test_flag or (coalesce(topup.amount, 0) = 0 and test_account)) then
    raise exception 'NOT_TEST_DOCUMENT';
  end if;

  if coalesce(topup.amount, 0) = 0
     and coalesce(topup.credits, 0) > 0
     and topup.user_id is not null then
    select balance
      into current_balance
    from public.credit_accounts
    where user_id = topup.user_id
    for update;

    if found then
      reversed := least(round(coalesce(topup.credits, 0), 2), round(coalesce(current_balance, 0), 2));
      if reversed > 0 then
        next_balance := round(current_balance - reversed, 2);
        update public.credit_accounts
        set balance = next_balance,
            updated_at = now()
        where user_id = topup.user_id;

        insert into public.credit_transactions (user_id, amount, note)
        values (
          topup.user_id,
          -reversed,
          'Zmazanie testovacieho dokladu ' || coalesce(nullif(btrim(topup.invoice_number), ''), topup.stripe_session_id)
        );
      end if;
    end if;
  end if;

  delete from public.credit_topups
  where stripe_session_id = p_stripe_session_id;

  if topup.invoice_number ~ '^[0-9]{4}[0-9]{4}$' then
    invoice_year := left(topup.invoice_number, 4)::integer;
    perform pg_advisory_xact_lock(hashtext('remappro-document-invoice-' || invoice_year::text)::bigint);
    remaining := public.highest_accounting_serial('invoice', invoice_year);
    insert into public.accounting_number_counters (kind, year, last_serial)
    values ('invoice', invoice_year, remaining)
    on conflict (kind, year) do update
      set last_serial = excluded.last_serial;
  end if;

  return jsonb_build_object(
    'deleted', true,
    'invoice_number', topup.invoice_number,
    'credits_reversed', reversed
  );
end;
$$;

revoke all on function public.delete_test_credit_package_invoice(text) from public, anon, authenticated;
grant execute on function public.delete_test_credit_package_invoice(text) to service_role;

notify pgrst, 'reload schema';
