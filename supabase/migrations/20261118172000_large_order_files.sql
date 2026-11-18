-- Finished ECU binaries are stored in the tunes bucket. The previous 50 MB
-- cap rejected larger .bin dumps, and the admin portal then tried to send the
-- whole file through the orders API.
insert into storage.buckets (id, name, public, file_size_limit)
values ('tunes', 'tunes', false, 524288000)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

create or replace function public.attach_order_result(
  p_order_id uuid,
  p_result text,
  p_status text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  current_url text;
  client_part text;
begin
  if p_result is null or length(btrim(p_result)) = 0 or length(p_result) > 4000 then
    raise exception 'invalid result reference';
  end if;
  if p_status not in ('pending', 'processing', 'completed', 'paid', 'cancelled') then
    raise exception 'invalid status';
  end if;

  select file_url into current_url
  from public.orders
  where id = p_order_id;
  if not found then
    raise exception 'order not found';
  end if;

  client_part := split_part(coalesce(current_url, ''), '|||RESULT|||', 1);
  update public.orders
  set file_url = client_part || '|||RESULT|||' || p_result,
      status = p_status
  where id = p_order_id;
end;
$$;

grant execute on function public.attach_order_result(uuid, text, text) to authenticated;
