-- Yearly invoice and credit-note series.
-- Invoice:  YYYYNNNN, first number of the year is YYYY0001.
-- Credit:   90YYNNNN, first number of 2027 is 90270001.
-- Existing order notes are only read. This function never rewrites them.

create table if not exists public.accounting_number_counters (
  kind text not null check (kind in ('invoice', 'credit')),
  year integer not null check (year between 2000 and 9999),
  last_serial integer not null check (last_serial between 0 and 9999),
  primary key (kind, year)
);

alter table public.accounting_number_counters enable row level security;
revoke all on table public.accounting_number_counters from public, anon, authenticated;

create or replace function public.next_accounting_number(p_kind text, p_year integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  note_max integer := 0;
  column_max integer := 0;
  stored integer := 0;
  next_serial integer := 0;
  prefix text;
  pattern text;
  stored_column text;
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
    pattern := '\[\[rp-invoice\]\](' || p_year::text || '[0-9]{4})';
    stored_column := 'invoice_number';
  else
    prefix := '90' || substr(p_year::text, 3, 2);
    pattern := '\[\[rp-credit\]\](' || prefix || '[0-9]{4})';
    stored_column := 'credit_note_number';
  end if;

  perform pg_advisory_xact_lock(hashtext('remappro-document-' || p_kind || '-' || p_year::text)::bigint);

  execute format(
    $sql$
      select coalesce(max(right(match[1], 4)::integer), 0)
      from public.orders
      cross join lateral regexp_matches(coalesce(note, ''), %L, 'g') as match
    $sql$,
    pattern
  ) into note_max;

  if exists (
    select 1
    from information_schema.columns as columns
    where columns.table_schema = 'public'
      and columns.table_name = 'orders'
      and columns.column_name = stored_column
  ) then
    execute format(
      'select coalesce(max(right(%I, 4)::integer), 0) from public.orders where %I ~ %L',
      stored_column,
      stored_column,
      '^' || prefix || '[0-9]{4}$'
    ) into column_max;
  end if;

  insert into public.accounting_number_counters (kind, year, last_serial)
  values (p_kind, p_year, 0)
  on conflict (kind, year) do nothing;

  select last_serial
    into stored
  from public.accounting_number_counters
  where kind = p_kind
    and year = p_year
  for update;

  next_serial := greatest(coalesce(note_max, 0), coalesce(column_max, 0), coalesce(stored, 0)) + 1;
  if next_serial > 9999 then
    raise exception 'NUMBER_EXHAUSTED';
  end if;

  update public.accounting_number_counters
  set last_serial = next_serial
  where kind = p_kind
    and year = p_year;

  return prefix || lpad(next_serial::text, 4, '0');
end;
$$;

revoke all on function public.next_accounting_number(text, integer) from public, anon;
grant execute on function public.next_accounting_number(text, integer) to authenticated, service_role;

notify pgrst, 'reload schema';
