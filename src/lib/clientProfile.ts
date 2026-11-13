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
const COMPACT_COLUMNS = 'id, company_name, ico, dic, address';
const PACKED_ADDRESS = 'rp1:';

type PackedProfile = {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  postalCode?: string;
  creditBalance?: number;
};

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

const packAddress = (billing: ClientBilling, creditBalance?: number) => {
  const packed: PackedProfile = {
    firstName: billing.firstName.trim(),
    lastName: billing.lastName.trim(),
    email: billing.email.trim(),
    phone: billing.phone.trim(),
    street: billing.street.trim(),
    city: billing.city.trim(),
    postalCode: billing.postalCode.trim(),
  };
  if (creditBalance !== undefined && Number.isFinite(creditBalance)) packed.creditBalance = creditBalance;
  return PACKED_ADDRESS + JSON.stringify(packed);
};

const readPackedCredit = async (userId: string) => {
  const profile = await supabase.from('client_profiles').select('address').eq('id', userId).maybeSingle();
  if (profile.error || !profile.data) return undefined;
  const packed = unpackAddress(text((profile.data as { address?: unknown }).address));
  const value = Number(packed?.creditBalance);
  return Number.isFinite(value) ? value : undefined;
};

const relationMissing = (error: { code?: string; message?: string } | null) =>
  error?.code === 'PGRST205'
  || error?.code === '42P01'
  || /could not find the table/i.test(error?.message ?? '');

const unpackAddress = (value: string): PackedProfile | null => {
  if (!value.startsWith(PACKED_ADDRESS)) return null;
  try {
    const parsed = JSON.parse(value.slice(PACKED_ADDRESS.length)) as PackedProfile;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
};

const compactToBilling = (row: Record<string, unknown> | null, fallbackEmail: string): ClientBilling => {
  const packed = unpackAddress(text(row?.address));
  return {
    firstName: realProfileLabel(packed?.firstName),
    lastName: realProfileLabel(packed?.lastName),
    company: realProfileLabel(text(row?.company_name)),
    email: text(packed?.email) || fallbackEmail,
    phone: text(packed?.phone),
    street: text(packed?.street),
    city: text(packed?.city),
    postalCode: text(packed?.postalCode),
    vatId: text(row?.ico),
    taxId: text(row?.dic),
  };
};

const columnMissing = (error: { code?: string; message?: string } | null) =>
  error?.code === '42703'
  || error?.code === 'PGRST204'
  || /column .* does not exist/i.test(error?.message ?? '');

const currentUserId = async (fallback: string) => {
  const { data } = await supabase.auth.getUser();
  return data.user?.id || fallback;
};

const readStoredBilling = async (userId: string, fallbackEmail: string) => {
  const full = await supabase
    .from('client_profiles')
    .select(PROFILE_COLUMNS)
    .eq('user_id', userId)
    .maybeSingle();
  if (!full.error && full.data) {
    return rowToBilling(full.data as Record<string, unknown>, fallbackEmail);
  }

  const compact = await supabase
    .from('client_profiles')
    .select(COMPACT_COLUMNS)
    .eq('id', userId)
    .maybeSingle();
  if (compact.error || !compact.data) return null;
  return compactToBilling(compact.data as Record<string, unknown>, fallbackEmail);
};

export const saveClientBilling = async (
  userId: string,
  billing: ClientBilling,
  options?: { preserveExisting?: boolean },
) => {
  const id = await currentUserId(userId);
  if (!id) return { ok: false as const };

  if (options?.preserveExisting && !contactFilled(billing)) {
    const existing = await readStoredBilling(id, '');
    if (existing && contactFilled(existing)) return { ok: true as const };
  }

  const full = await supabase.from('client_profiles').upsert({
    user_id: id,
    ...billingToRow(billing),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (!full.error) return { ok: true as const };
  if (!columnMissing(full.error) && full.error.code !== '42501' && full.error.code !== 'PGRST204') {
    const basic = await supabase.from('client_profiles').upsert({
      user_id: id,
      first_name: billing.firstName.trim(),
      last_name: billing.lastName.trim(),
      updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (!basic.error) return { ok: true as const };
  }

  const compact = await supabase.from('client_profiles').upsert({
    id,
    company_name: billing.company.trim(),
    ico: billing.vatId.trim(),
    dic: billing.taxId.trim(),
    address: packAddress(billing, await readPackedCredit(id)),
  }, { onConflict: 'id' });
  if (!compact.error) return { ok: true as const };
  return { ok: false as const };
};

export const readCreditBalance = async (userId: string) => {
  const id = await currentUserId(userId);
  const account = await supabase
    .from('credit_accounts')
    .select('balance')
    .eq('user_id', id)
    .maybeSingle();
  if (!account.error && account.data) {
    const balance = Number(account.data.balance);
    if (Number.isFinite(balance)) return balance;
  }
  return (await readPackedCredit(id)) ?? 0;
};

export const saveCreditBalance = async (userId: string, balance: number) => {
  const id = await currentUserId(userId);
  if (!id || !Number.isFinite(balance) || balance < 0) return false;
  const next = Math.round(balance * 100) / 100;

  const existing = await supabase
    .from('credit_accounts')
    .select('user_id')
    .eq('user_id', id)
    .maybeSingle();
  if (!existing.error) {
    const write = existing.data
      ? await supabase.from('credit_accounts').update({ balance: next, updated_at: new Date().toISOString() }).eq('user_id', id)
      : await supabase.from('credit_accounts').insert({ user_id: id, balance: next });
    if (write.error) {
      const upserted = await supabase
        .from('credit_accounts')
        .upsert({ user_id: id, balance: next }, { onConflict: 'user_id' });
      if (!upserted.error) return true;
    } else {
      return true;
    }
  } else if (!relationMissing(existing.error)) {
    const upserted = await supabase
      .from('credit_accounts')
      .upsert({ user_id: id, balance: next }, { onConflict: 'user_id' });
    if (!upserted.error) return true;
  }

  const profile = await supabase.from('client_profiles').select(COMPACT_COLUMNS).eq('id', id).maybeSingle();
  const row = (profile.data ?? null) as Record<string, unknown> | null;
  const billing = row ? compactToBilling(row, '') : emptyBilling();
  const saved = await supabase.from('client_profiles').upsert({
    id,
    company_name: text(row?.company_name),
    ico: text(row?.ico),
    dic: text(row?.dic),
    address: packAddress(billing, next),
  }, { onConflict: 'id' });
  return !saved.error;
};

export const loadClientBilling = async (user: User): Promise<ClientBilling | null> => {
  const stored = await readStoredBilling(user.id, user.email || '');
  const billing = stored ?? emptyBilling();
  if (!billing.email) billing.email = user.email || '';
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
    company: billing.company || company,
  };
  await saveClientBilling(user.id, filled);
  return filled;
};
