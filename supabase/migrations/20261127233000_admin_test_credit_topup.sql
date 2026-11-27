-- Admin test code TEST100 credits a package at 0.00 EUR.
-- Only the service role can call this. The Edge function must already
-- have verified the caller as an admin in Auth before it uses it.

do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint as con
    join pg_class as rel on rel.oid = con.conrelid
    join pg_namespace as nsp on nsp.oid = rel.relnamespace
    where nsp.nspname = 'public'
      and rel.relname = 'credit_topups'
      and con.contype = 'c'
      and pg_get_constraintdef(con.oid) ilike '%amount%>%0%'
  loop
    execute format('alter table public.credit_topups drop constraint %I', constraint_name);
  end loop;
end $$;

alter table public.credit_topups
  drop constraint if exists credit_topups_amount_nonnegative;

alter table public.credit_topups
  add constraint credit_topups_amount_nonnegative check (amount >= 0 and amount <= 100000);

create or replace function public.apply_admin_test_credit_topup(
  p_user_id uuid,
  p_credits numeric,
  p_session_id text,
  p_company text default null,
  p_account_name text default null,
  p_account_email text default null,
  p_terms_consent boolean default false,
  p_declaration_consent boolean default false,
  p_consented_at timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_balance numeric(10, 2);
  next_balance numeric(10, 2);
  credits_to_add numeric(10, 2);
  topup_ref text;
  consented timestamptz;
  company_value text;
  name_value text;
  email_value text;
  summary text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'FORBIDDEN';
  end if;

  if p_user_id is null then
    raise exception 'NOT_AUTHENTICATED';
  end if;

  if p_session_id is null or left(p_session_id, 10) <> 'cs_admtest' then
    raise exception 'INVALID_SESSION';
  end if;

  credits_to_add := round(coalesce(p_credits, 0), 2);
  if credits_to_add not in (25.00, 50.00, 100.00, 300.00, 500.00, 1000.00) then
    raise exception 'INVALID_AMOUNT';
  end if;

  if p_terms_consent is not true or p_declaration_consent is not true then
    raise exception 'CONSENT_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtext('remappro-credit-topup-' || p_session_id));

  if exists (
    select 1
    from public.credit_topups
    where stripe_session_id = p_session_id
  ) then
    select balance
      into current_balance
    from public.credit_accounts
    where user_id = p_user_id;

    return jsonb_build_object(
      'balance', current_balance,
      'credited', false,
      'user_id', p_user_id,
      'amount', 0,
      'credits', credits_to_add
    );
  end if;

  topup_ref := 'DB-' || upper(right(regexp_replace(p_session_id, '[^A-Za-z0-9]', '', 'g'), 12));
  consented := coalesce(p_consented_at, now());
  company_value := nullif(btrim(coalesce(p_company, '')), '');
  name_value := nullif(btrim(coalesce(p_account_name, '')), '');
  email_value := nullif(lower(btrim(coalesce(p_account_email, ''))), '');
  summary := format(
    'Súhlas a vyhlásenie odberateľa (dobitie %s, admin test TEST100, platba 0,00 €): účet %s, firma %s, potvrdené dňa %s. Odberateľ elektronicky potvrdil obchodné podmienky a vyhlásenie o použití úpravy výhradne na off-road, motorsport alebo export.',
    topup_ref,
    coalesce(email_value, name_value, '—'),
    coalesce(company_value, '—'),
    to_char(consented at time zone 'Europe/Bratislava', 'DD.MM.YYYY HH24:MI')
  );

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

  next_balance := round(current_balance + credits_to_add, 2);

  update public.credit_accounts
  set balance = next_balance,
      updated_at = now()
  where user_id = p_user_id;

  insert into public.credit_transactions (user_id, amount, note, entry_type)
  values (
    p_user_id,
    credits_to_add,
    'Dobitie balíka ' || trim(to_char(credits_to_add, 'FM999999')) || ' kreditov',
    'topup'
  );

  insert into public.credit_topups (
    stripe_session_id,
    payment_intent_id,
    user_id,
    amount,
    credits,
    company,
    account_name,
    account_email,
    terms_consent,
    declaration_consent,
    consented_at,
    topup_ref,
    consent_summary
  ) values (
    p_session_id,
    null,
    p_user_id,
    0,
    credits_to_add,
    company_value,
    name_value,
    email_value,
    true,
    true,
    consented,
    topup_ref,
    summary
  );

  return jsonb_build_object(
    'balance', next_balance,
    'credited', true,
    'user_id', p_user_id,
    'amount', 0,
    'credits', credits_to_add,
    'topup_ref', topup_ref
  );
end;
$$;

revoke all on function public.apply_admin_test_credit_topup(uuid, numeric, text, text, text, text, boolean, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.apply_admin_test_credit_topup(uuid, numeric, text, text, text, text, boolean, boolean, timestamptz)
  to service_role;
