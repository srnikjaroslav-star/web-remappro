-- claim_credit_package_invoice assigns the yearly invoice number and marks the
-- package top-up as invoiced. create-credit-checkout calls it after TEST100
-- credits the account. The signature matches the Edge RPC argument
-- p_stripe_session_id. next_accounting_number must exist in the same database:
-- invoice numbers are YYYYNNNN, starting at 20260001 for 2026.

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

create table if not exists public.accounting_number_counters (
  kind text not null check (kind in ('invoice', 'credit')),
  year integer not null check (year between 2000 and 9999),
  last_serial integer not null check (last_serial between 0 and 9999),
  primary key (kind, year)
);

alter table public.accounting_number_counters enable row level security;
revoke all on table public.accounting_number_counters from public, anon, authenticated;

create or replace function public.accounting_number_taken(p_kind text, p_number text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  found boolean := false;
  mark text;
begin
  if p_kind = 'invoice' then
    mark := '\[\[rp-invoice\]\]' || p_number || '(\||$)';
  elsif p_kind = 'credit' then
    mark := '\[\[rp-credit\]\]' || p_number || '(\||$)';
  else
    return true;
  end if;

  if p_kind = 'invoice'
     and exists (
       select 1
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'credit_topups'
         and column_name = 'invoice_number'
     ) then
    execute 'select exists (select 1 from public.credit_topups where invoice_number = $1)'
      into found
      using p_number;
    if found then
      return true;
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
    execute 'select exists (select 1 from public.orders where invoice_number = $1)'
      into found
      using p_number;
    if found then
      return true;
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
    execute 'select exists (select 1 from public.orders where credit_note_number = $1)'
      into found
      using p_number;
    if found then
      return true;
    end if;
  end if;

  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'invoices'
      and column_name = 'invoice_number'
  ) and p_kind = 'invoice' then
    execute 'select exists (select 1 from public.invoices where invoice_number = $1)'
      into found
      using p_number;
    if found then
      return true;
    end if;
  end if;

  execute
    'select exists (select 1 from public.orders where coalesce(note, '''') ~ $1)'
    into found
    using mark;
  return coalesce(found, false);
end;
$$;

create or replace function public.next_accounting_number(p_kind text, p_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  stored integer := 0;
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

  select last_serial
    into stored
  from public.accounting_number_counters
  where kind = p_kind
    and year = p_year
  for update;

  next_serial := coalesce(stored, 0) + 1;

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

revoke all on function public.accounting_number_taken(text, text) from public, anon, authenticated;
revoke all on function public.next_accounting_number(text, integer) from public, anon;
grant execute on function public.next_accounting_number(text, integer) to authenticated, service_role;

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
