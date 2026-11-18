-- List queries must not read the file payload. These columns keep only the
-- file name and, when the bytes live in Storage, the short bucket path.

alter table public.orders
  add column if not exists client_file_name text,
  add column if not exists client_file_path text,
  add column if not exists result_file_name text,
  add column if not exists result_file_path text;

create or replace function public.ecu_file_name(part text)
returns text
language plpgsql
immutable
as $$
declare
  value text := btrim(coalesce(part, ''));
  name text;
begin
  if value = '' or value = 'stored' then
    return null;
  end if;
  if left(value, 7) = 'inline:' then
    name := split_part(substring(value from 8 for 240), ':', 1);
    return nullif(replace(name, '%20', ' '), '');
  end if;
  if left(value, 5) = 'data:' then
    return null;
  end if;
  if length(value) > 2000 and left(value, 7) <> 'bucket:' and left(value, 4) <> 'http' then
    return null;
  end if;
  name := regexp_replace(left(value, 2000), '^.*/', '');
  name := split_part(name, '?', 1);
  return nullif(name, '');
end;
$$;

create or replace function public.ecu_file_path(part text)
returns text
language plpgsql
immutable
as $$
declare
  value text := btrim(coalesce(part, ''));
begin
  if value = '' or value = 'stored' or left(value, 7) = 'inline:' or left(value, 5) = 'data:' then
    return null;
  end if;
  if length(value) > 2000 then
    return null;
  end if;
  return value;
end;
$$;

create or replace function public.ecu_file_meta(file_url text, result_file_url text)
returns table (
  client_file_name text,
  client_file_path text,
  result_file_name text,
  result_file_path text
)
language plpgsql
immutable
as $$
declare
  raw text := coalesce(file_url, '');
  mark constant text := '|||RESULT|||';
  pos int := position(mark in raw);
  client_part text;
  result_part text;
  column_result text := btrim(coalesce(result_file_url, ''));
begin
  if pos > 0 then
    client_part := substring(raw from 1 for pos - 1);
    result_part := substring(raw from pos + char_length(mark));
  else
    client_part := raw;
    result_part := '';
  end if;
  if column_result <> '' and column_result <> 'stored' and public.ecu_file_path(column_result) is not null then
    result_part := column_result;
  elsif column_result <> '' and column_result <> 'stored' and result_part = '' then
    result_part := column_result;
  end if;
  client_file_name := public.ecu_file_name(client_part);
  client_file_path := public.ecu_file_path(client_part);
  result_file_name := public.ecu_file_name(result_part);
  result_file_path := public.ecu_file_path(result_part);
  return next;
end;
$$;

create or replace function public.orders_apply_file_meta()
returns trigger
language plpgsql
as $$
declare
  meta record;
  result_column text := null;
begin
  begin
    result_column := new.result_file_url;
  exception
    when undefined_column then
      result_column := null;
  end;
  select * into meta from public.ecu_file_meta(new.file_url, result_column);
  new.client_file_name := meta.client_file_name;
  new.client_file_path := meta.client_file_path;
  new.result_file_name := meta.result_file_name;
  new.result_file_path := meta.result_file_path;
  return new;
end;
$$;

drop trigger if exists orders_apply_file_meta on public.orders;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'orders' and column_name = 'result_file_url'
  ) then
    create trigger orders_apply_file_meta
      before insert or update of file_url, result_file_url
      on public.orders
      for each row
      execute function public.orders_apply_file_meta();

    update public.orders as orders
    set
      client_file_name = meta.client_file_name,
      client_file_path = meta.client_file_path,
      result_file_name = meta.result_file_name,
      result_file_path = meta.result_file_path
    from lateral public.ecu_file_meta(orders.file_url, orders.result_file_url) as meta;
  else
    create trigger orders_apply_file_meta
      before insert or update of file_url
      on public.orders
      for each row
      execute function public.orders_apply_file_meta();

    update public.orders as orders
    set
      client_file_name = meta.client_file_name,
      client_file_path = meta.client_file_path,
      result_file_name = meta.result_file_name,
      result_file_path = meta.result_file_path
    from lateral public.ecu_file_meta(orders.file_url, null) as meta;
  end if;
end $$;

grant execute on function public.ecu_file_name(text) to authenticated;
grant execute on function public.ecu_file_path(text) to authenticated;
grant execute on function public.ecu_file_meta(text, text) to authenticated;
