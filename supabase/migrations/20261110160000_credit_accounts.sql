-- Credit accounts for signed-in clients. Balances can be read by the owner.
-- Deduction and order creation run only through pay_with_credits, called by the service role.

create table if not exists public.credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  balance numeric(10, 2) not null default 0 check (balance >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(10, 2) not null,
  order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.credit_accounts enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists credit_accounts_select_own on public.credit_accounts;
create policy credit_accounts_select_own
  on public.credit_accounts
  for select
  to authenticated
  using (user_id = auth.uid());

revoke all on public.credit_accounts from public, anon, authenticated;
revoke all on public.credit_transactions from public, anon, authenticated;
grant select on public.credit_accounts to authenticated;
grant all on public.credit_accounts to service_role;
grant all on public.credit_transactions to service_role;

insert into public.credit_accounts (user_id, balance)
select id, 0
from auth.users
on conflict (user_id) do nothing;

create or replace function public.handle_new_credit_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.credit_accounts (user_id, balance)
  values (new.id, 0)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_credit on auth.users;
create trigger on_auth_user_created_credit
  after insert on auth.users
  for each row execute function public.handle_new_credit_account();

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
    'processing',
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

revoke all on function public.pay_with_credits(
  uuid, numeric, text, text, text, text, text, text, text, text, text, text, boolean
) from public, anon, authenticated;

grant execute on function public.pay_with_credits(
  uuid, numeric, text, text, text, text, text, text, text, text, text, text, boolean
) to service_role;

notify pgrst, 'reload schema';
