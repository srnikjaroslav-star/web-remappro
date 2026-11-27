-- Yearly document numbers, without a leftover test offset.
-- Invoice:     YYYYNNNN.  2026 starts at 20260001, 2027 at 20270001.
-- Credit note: 9 + the last three digits of the year + NNNN.
--              2026 starts at 90260001, 2027 at 90270001.
-- The counter for each kind and year is the only sequence. Existing numbers are
-- skipped so a reset does not continue from 20260010 / 90260006, and two
-- concurrent calls cannot receive the same number.
-- Invoices are still issued only by claim_credit_package_invoice.

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

-- Test counters for the current Bratislava year go back to zero.
-- The following invoice is 20260001 and the following credit note is 90260001
-- unless that exact number is already stored on a document.
delete from public.accounting_number_counters
where kind in ('invoice', 'credit')
  and year = extract(year from (now() at time zone 'Europe/Bratislava'))::integer;

do $$
begin
  if to_regclass('public.invoice_number_seq') is not null then
    execute $comment$
      comment on sequence public.invoice_number_seq is
        'Retired. Yearly invoice and credit-note numbers are issued only by next_accounting_number.'
    $comment$;
  end if;
end $$;

notify pgrst, 'reload schema';
