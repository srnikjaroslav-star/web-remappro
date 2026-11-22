-- Card top-ups credit the client ledger once per Stripe session.
-- They do not create invoices or credit notes.

create table if not exists public.credit_topups (
  stripe_session_id text primary key,
  payment_intent_id text,
  user_id uuid not null references auth.users(id) on delete cascade,
  amount numeric(10, 2) not null check (amount > 0),
  created_at timestamptz not null default now()
);

create unique index if not exists credit_topups_payment_intent_uidx
  on public.credit_topups (payment_intent_id)
  where payment_intent_id is not null and payment_intent_id <> '';

alter table public.credit_topups enable row level security;
revoke all on table public.credit_topups from public, anon, authenticated;

create or replace function public.apply_credit_topup(
  p_user_id uuid,
  p_amount numeric,
  p_stripe_session_id text,
  p_payment_intent_id text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(10, 2);
  next_balance numeric(10, 2);
  amount numeric(10, 2);
  intent text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  amount := round(coalesce(p_amount, 0), 2);
  intent := nullif(btrim(coalesce(p_payment_intent_id, '')), '');

  if p_user_id is null or amount <= 0 or amount > 100000 then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_stripe_session_id is null or left(p_stripe_session_id, 3) <> 'cs_' then
    raise exception 'INVALID_SESSION';
  end if;

  perform pg_advisory_xact_lock(hashtext('remappro-credit-topup-' || p_stripe_session_id));

  if exists (
    select 1
    from public.credit_topups
    where stripe_session_id = p_stripe_session_id
       or (intent is not null and payment_intent_id = intent)
  ) then
    select balance
      into current_balance
    from public.credit_accounts
    where user_id = p_user_id;

    return jsonb_build_object(
      'balance', current_balance,
      'credited', false,
      'user_id', p_user_id,
      'amount', amount
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

  next_balance := round(current_balance + amount, 2);

  update public.credit_accounts
  set balance = next_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_transactions (user_id, amount, note)
  values (p_user_id, amount, 'Dobitie kartou');

  insert into public.credit_topups (stripe_session_id, payment_intent_id, user_id, amount)
  values (p_stripe_session_id, intent, p_user_id, amount);

  return jsonb_build_object(
    'balance', next_balance,
    'credited', true,
    'user_id', p_user_id,
    'amount', amount
  );
end;
$$;

revoke all on function public.apply_credit_topup(uuid, numeric, text, text) from public, anon, authenticated;
grant execute on function public.apply_credit_topup(uuid, numeric, text, text) to service_role;

notify pgrst, 'reload schema';
