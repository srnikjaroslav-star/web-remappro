-- New credit orders wait in Čakajúce until an admin downloads the client file.
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

  return jsonb_build_object(
    'balance', next_balance,
    'order_id', new_order_id,
    'order_number', new_order_number
  );
end;
$$;

notify pgrst, 'reload schema';
