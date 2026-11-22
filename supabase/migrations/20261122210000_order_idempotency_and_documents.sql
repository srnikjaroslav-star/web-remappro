-- One paid Stripe session can create only one order.
-- A credit payment does not issue an accounting document.
-- Replacing a finished file cannot deduct the completion charge twice.

alter table public.orders
  add column if not exists stripe_session_id text;

with ranked as (
  select
    id,
    row_number() over (
      partition by stripe_session_id
      order by created_at asc nulls last, id asc
    ) as n
  from public.orders
  where stripe_session_id is not null
    and btrim(stripe_session_id) <> ''
)
update public.orders as target
set stripe_session_id = null
from ranked
where target.id = ranked.id
  and ranked.n > 1;

create unique index if not exists orders_stripe_session_id_key
  on public.orders (stripe_session_id)
  where stripe_session_id is not null
    and btrim(stripe_session_id) <> '';

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
      coalesce(p_legal_consent, false),
      nullif(p_customer_note, '')
    )
    returning id into new_order_id;
  end if;

  insert into public.credit_transactions (user_id, amount, order_id)
  values (p_user_id, -p_amount, new_order_id);

  return jsonb_build_object(
    'balance', next_balance,
    'order_id', new_order_id,
    'order_number', new_order_number
  );
end;
$$;

revoke all on function public.pay_with_credits(
  uuid, numeric, text, text, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.pay_with_credits(
  uuid, numeric, text, text, text, text, text, text, text, text, text, text, boolean
) to service_role;

create or replace function public.charge_completion_once(
  p_user_id uuid,
  p_amount numeric,
  p_order_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  open_charge numeric(10, 2);
  current_balance numeric(10, 2);
  next_balance numeric(10, 2);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id is null or p_order_id is null then
    raise exception 'INVALID_ORDER';
  end if;

  if p_amount is null or p_amount <= 0 or p_amount > 100000 then
    raise exception 'INVALID_AMOUNT';
  end if;

  perform pg_advisory_xact_lock(hashtext('remappro-completion-charge-' || p_order_id::text));

  select coalesce(sum(amount), 0)
    into open_charge
  from public.credit_transactions
  where order_id = p_order_id
    and note in ('Strhnutie pri dokončení', 'Vrátenie po neúspešnom dokončení');

  if open_charge < 0 then
    select balance
      into current_balance
    from public.credit_accounts
    where user_id = p_user_id;
    return jsonb_build_object(
      'balance', current_balance,
      'charged', false,
      'user_id', p_user_id
    );
  end if;

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

  if current_balance < p_amount then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  next_balance := round(current_balance - p_amount, 2);

  update public.credit_accounts
  set balance = next_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_transactions (user_id, amount, note, order_id)
  values (p_user_id, -p_amount, 'Strhnutie pri dokončení', p_order_id);

  return jsonb_build_object(
    'balance', next_balance,
    'charged', true,
    'user_id', p_user_id
  );
end;
$$;

revoke all on function public.charge_completion_once(uuid, numeric, uuid) from public, anon, authenticated;
grant execute on function public.charge_completion_once(uuid, numeric, uuid) to service_role;

notify pgrst, 'reload schema';
