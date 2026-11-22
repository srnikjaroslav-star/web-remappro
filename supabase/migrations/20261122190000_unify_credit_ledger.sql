-- Every credit movement updates credit_accounts and credit_transactions together.
-- Manual credit changes and order refunds do not create invoices.

drop function if exists public.adjust_client_credits(uuid, numeric, text);

create or replace function public.adjust_client_credits(
  p_user_id uuid,
  p_delta numeric,
  p_note text,
  p_order_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(10, 2);
  next_balance numeric(10, 2);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id is null or p_delta is null or p_delta = 0 then
    raise exception 'INVALID_AMOUNT';
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

  if current_balance + p_delta < 0 then
    raise exception 'INSUFFICIENT_CREDITS';
  end if;

  next_balance := round(current_balance + p_delta, 2);

  update public.credit_accounts
  set balance = next_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_transactions (user_id, amount, note, order_id)
  values (
    p_user_id,
    p_delta,
    nullif(btrim(coalesce(p_note, '')), ''),
    p_order_id
  );

  return jsonb_build_object('balance', next_balance, 'user_id', p_user_id);
end;
$$;

create or replace function public.refund_order_credits(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  net numeric(10, 2) := 0;
  refund_user uuid;
  invoice_user uuid;
  invoice_total numeric(10, 2) := 0;
  refunded numeric(10, 2) := 0;
  current_balance numeric(10, 2);
  next_balance numeric(10, 2);
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  if p_order_id is null then
    raise exception 'INVALID_ORDER';
  end if;

  perform pg_advisory_xact_lock(hashtext('remappro-credit-order-' || p_order_id::text));

  select coalesce(sum(amount), 0)
    into net
  from public.credit_transactions
  where order_id = p_order_id;

  select user_id
    into refund_user
  from public.credit_transactions
  where order_id = p_order_id
    and amount < 0
  order by created_at
  limit 1;

  if refund_user is null and net >= 0 and not exists (
    select 1
    from public.credit_transactions
    where order_id = p_order_id
  ) then
    select invoices.user_id, coalesce(sum(invoices.amount), 0)
      into invoice_user, invoice_total
    from public.invoices
    where invoices.order_id = p_order_id
      and invoices.payment_method = 'credits'
      and invoices.user_id is not null
    group by invoices.user_id
    order by coalesce(sum(invoices.amount), 0) desc
    limit 1;

    if invoice_user is not null and invoice_total > 0 then
      net := -invoice_total;
      refund_user := invoice_user;
    end if;
  end if;

  if refund_user is null or net >= 0 then
    return jsonb_build_object('balance', null, 'refunded', 0, 'user_id', refund_user);
  end if;

  refunded := round(-net, 2);

  insert into public.credit_accounts (user_id, balance)
  values (refund_user, 0)
  on conflict (user_id) do nothing;

  select balance
    into current_balance
  from public.credit_accounts
  where user_id = refund_user
  for update;

  if not found then
    raise exception 'NO_ACCOUNT';
  end if;

  next_balance := round(current_balance + refunded, 2);

  update public.credit_accounts
  set balance = next_balance,
      updated_at = now()
  where user_id = refund_user;

  insert into public.credit_transactions (user_id, amount, order_id, note)
  values (refund_user, refunded, p_order_id, 'Vrátenie za zrušenú objednávku');

  return jsonb_build_object('balance', next_balance, 'refunded', refunded, 'user_id', refund_user);
end;
$$;

revoke all on function public.adjust_client_credits(uuid, numeric, text, uuid) from public, anon, authenticated;
grant execute on function public.adjust_client_credits(uuid, numeric, text, uuid) to service_role;

revoke all on function public.refund_order_credits(uuid) from public, anon, authenticated;
grant execute on function public.refund_order_credits(uuid) to service_role;

notify pgrst, 'reload schema';
