-- Logged-in clients can read their own issued package invoices.
-- Portal admins can read every issued package invoice.
-- The PDF is rebuilt in the portal from these columns.

grant select on table public.credit_topups to authenticated;

drop policy if exists credit_topups_select_issued on public.credit_topups;
create policy credit_topups_select_issued
  on public.credit_topups
  for select
  to authenticated
  using (
    nullif(btrim(coalesce(invoice_number, '')), '') is not null
    and (
      user_id = auth.uid()
      or lower(coalesce(auth.jwt() ->> 'email', '')) in ('info@remappro.eu', 'srnik.jaroslav@gmail.com')
      or lower(coalesce(auth.jwt() -> 'app_metadata' ->> 'role', '')) = 'admin'
    )
  );

notify pgrst, 'reload schema';
