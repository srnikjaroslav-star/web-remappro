alter table public.credit_transactions
  add column if not exists note text;

create or replace function public.adjust_client_credits(
  p_user_id uuid,
  p_delta numeric,
  p_note text
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

  next_balance := current_balance + p_delta;

  update public.credit_accounts
  set balance = next_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_transactions (user_id, amount, note)
  values (p_user_id, p_delta, nullif(btrim(coalesce(p_note, '')), ''));

  return jsonb_build_object('balance', next_balance);
end;
$$;

revoke all on function public.adjust_client_credits(uuid, numeric, text) from public, anon, authenticated;
grant execute on function public.adjust_client_credits(uuid, numeric, text) to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'credit_accounts'
  ) then
    alter publication supabase_realtime add table public.credit_accounts;
  end if;
end $$;

notify pgrst, 'reload schema';
