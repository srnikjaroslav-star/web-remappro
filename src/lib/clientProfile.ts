import type { User } from '@supabase/supabase-js';
import { companyFromMetadata, joinProfileName, metadataProfileName, realProfileLabel, splitProfileName } from '@/lib/profileName';
import { supabase } from '@/lib/supabase';

export type ClientBilling = {
  firstName: string;
  lastName: string;
  company: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  vatId: string;
  taxId: string;
};

const PROFILE_COLUMNS =
  'first_name, last_name, company_name, phone, street, city, postal_code, vat_id, tax_id, email';

export const emptyBilling = (): ClientBilling => ({
  firstName: '',
  lastName: '',
  company: '',
  email: '',
  phone: '',
  street: '',
  city: '',
  postalCode: '',
  vatId: '',
  taxId: '',
});

export const orderDisplayName = (billing: ClientBilling) => {
  const company = billing.company.trim();
  if (company) return company;
  return joinProfileName(billing.firstName, billing.lastName);
};

export const billingToRow = (billing: ClientBilling) => ({
  first_name: billing.firstName.trim(),
  last_name: billing.lastName.trim(),
  company_name: billing.company.trim(),
  phone: billing.phone.trim(),
  street: billing.street.trim(),
  city: billing.city.trim(),
  postal_code: billing.postalCode.trim(),
  vat_id: billing.vatId.trim(),
  tax_id: billing.taxId.trim(),
  email: billing.email.trim(),
});

const text = (value: unknown) => String(value ?? '').trim();

const contactFilled = (billing: ClientBilling) =>
  [
    billing.firstName,
    billing.lastName,
    billing.company,
    billing.phone,
    billing.street,
    billing.city,
    billing.postalCode,
    billing.vatId,
    billing.taxId,
  ].some((value) => value.trim().length > 0);

const rowToBilling = (row: Record<string, unknown> | null, fallbackEmail: string): ClientBilling => ({
  firstName: realProfileLabel(text(row?.first_name)),
  lastName: realProfileLabel(text(row?.last_name)),
  company: realProfileLabel(text(row?.company_name)),
  email: text(row?.email) || fallbackEmail,
  phone: text(row?.phone),
  street: text(row?.street),
  city: text(row?.city),
  postalCode: text(row?.postal_code),
  vatId: text(row?.vat_id),
  taxId: text(row?.tax_id),
});

export const saveClientBilling = async (
  userId: string,
  billing: ClientBilling,
  options?: { preserveExisting?: boolean },
) => {
  if (options?.preserveExisting && !contactFilled(billing)) {
    const existing = await supabase
      .from('client_profiles')
      .select(PROFILE_COLUMNS)
      .eq('user_id', userId)
      .maybeSingle();
    if (!existing.error && contactFilled(rowToBilling(existing.data as Record<string, unknown> | null, ''))) {
      return { ok: true as const };
    }
  }
  const row = {
    user_id: userId,
    ...billingToRow(billing),
    updated_at: new Date().toISOString(),
  };
  const full = await supabase
    .from('client_profiles')
    .upsert(row, { onConflict: 'user_id' })
    .select(PROFILE_COLUMNS)
    .single();
  if (!full.error) {
    const saved = billingToRow(billing);
    const written = full.data as Record<string, unknown>;
    const matches = (Object.keys(saved) as (keyof typeof saved)[]).every(
      (key) => text(written[key]) === saved[key],
    );
    if (matches) return { ok: true as const };
  }
  const basic = await supabase.from('client_profiles').upsert({
    user_id: userId,
    first_name: row.first_name,
    last_name: row.last_name,
    updated_at: row.updated_at,
  });
  if (!basic.error) return { ok: false as const, degraded: true as const };
  return { ok: false as const, degraded: false as const };
};

export const loadClientBilling = async (user: User): Promise<ClientBilling | null> => {
  const full = await supabase
    .from('client_profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', user.id)
    .maybeSingle();
  if (full.error) {
    console.warn('[profile] load failed', full.error.message);
    return null;
  }
  const row = full.data as Record<string, unknown> | null;
  const billing = rowToBilling(row, user.email || '');
  if (billing.firstName || billing.lastName || billing.company) return billing;

  let name = realProfileLabel(metadataProfileName(user.user_metadata));
  const company = realProfileLabel(companyFromMetadata(user.user_metadata));
  if (!name && user.email) {
    const { data: order } = await supabase
      .from('orders')
      .select('customer_name')
      .eq('customer_email', user.email.toLowerCase())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    name = realProfileLabel(order?.customer_name);
  }
  if (!name && !company) return billing;

  const parts = splitProfileName(name);
  const filled = {
    ...billing,
    firstName: parts.first_name,
    lastName: parts.last_name,
    company,
  };
  await supabase.from('client_profiles').upsert({
    user_id: user.id,
    ...billingToRow(filled),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  return filled;
};
