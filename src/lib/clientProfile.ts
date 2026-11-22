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
  portalVisits?: number;
  lastPortalVisit?: string;
};

export type PortalActivity = {
  visits: number;
  lastVisit: string | null;
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

const packAddress = (billing: ClientBilling, creditBalance?: number, previous?: PackedProfile | null) => {
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
  const visits = Number(previous?.portalVisits);
  if (Number.isFinite(visits) && visits > 0) packed.portalVisits = visits;
  if (previous?.lastPortalVisit) packed.lastPortalVisit = previous.lastPortalVisit;
  return PACKED_ADDRESS + JSON.stringify(packed);
};

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

const currentUserId = async (fallback: string) => {
  const { data } = await supabase.auth.getUser();
  return data.user?.id || fallback;
};

const readStoredBilling = async (userId: string, fallbackEmail: string) => {
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

  const storedProfile = await supabase.from('client_profiles').select(COMPACT_COLUMNS).eq('id', id).maybeSingle();
  if (storedProfile.error) return { ok: false as const };
  const storedRow = (storedProfile.data ?? null) as Record<string, unknown> | null;
  const previousProfile = unpackAddress(text(storedRow?.address));
  const storedCredit = Number(previousProfile?.creditBalance);
  const compact = await supabase.from('client_profiles').upsert({
    id,
    company_name: billing.company.trim(),
    ico: billing.vatId.trim(),
    dic: billing.taxId.trim(),
    address: packAddress(billing, Number.isFinite(storedCredit) ? storedCredit : undefined, previousProfile),
  }, { onConflict: 'id' });
  if (!compact.error) return { ok: true as const };
  return { ok: false as const };
};

const USER_ID = /^[0-9a-f-]{36}$/i;

type CreditLedgerResult = {
  ok?: boolean;
  code?: string;
  balance?: number | null;
  refunded?: number;
  charged?: boolean;
  userId?: string | null;
  clients?: Array<{
    id?: string;
    email?: string;
    name?: string;
    company?: string;
    balance?: number;
  }>;
};

const creditWrites = new Map<string, Promise<unknown>>();

const enqueueCreditWrite = <T>(id: string, job: () => Promise<T>) => {
  const previous = creditWrites.get(id) ?? Promise.resolve();
  const run = previous.then(job, job);
  creditWrites.set(id, run.then(() => undefined, () => undefined));
  return run;
};

const moneyAmount = (amount: number) => {
  const value = Math.round(Number(amount) * 100) / 100;
  return Number.isFinite(value) ? value : null;
};

const invokeCreditLedger = async (body: Record<string, unknown>) => {
  const invoked = await supabase.functions.invoke('manage-clients', { body });
  let data = invoked.data as CreditLedgerResult | null;
  if (invoked.error && !data) {
    try {
      data = await (invoked.error as { context?: Response }).context?.json();
    } catch {
      data = null;
    }
  }
  if (!data?.ok) return { ok: false as const, code: data?.code || 'SERVER' };
  return { ok: true as const, data };
};

export type CreditClientAccount = {
  id: string;
  email: string;
  name: string;
  company: string;
  balance: number;
};

export const loadCreditClients = async () => {
  const result = await invokeCreditLedger({ action: 'list' });
  if (!result.ok) return { ok: false as const, code: result.code, clients: [] as CreditClientAccount[] };
  const clients = (result.data.clients || []).flatMap((client) => {
    const id = text(client.id);
    if (!USER_ID.test(id)) return [];
    const balance = Number(client.balance);
    return [{
      id,
      email: text(client.email),
      name: text(client.name),
      company: text(client.company),
      balance: Number.isFinite(balance) ? balance : 0,
    }];
  });
  return { ok: true as const, clients };
};

export const readCreditBalance = async (userId: string) => {
  const id = userId.trim();
  if (!USER_ID.test(id)) return 0;
  const row = await supabase.from('credit_accounts').select('balance').eq('user_id', id).maybeSingle();
  if (row.error || !row.data) return 0;
  const balance = Number(row.data.balance);
  return Number.isFinite(balance) ? balance : 0;
};

export const adjustClientCredits = async (
  userId: string,
  direction: 'add' | 'subtract',
  amount: number,
) => {
  const id = userId.trim();
  const value = moneyAmount(amount);
  if (!USER_ID.test(id) || value === null || value <= 0) {
    return { ok: false as const, code: 'INVALID_AMOUNT' as const };
  }
  const result = await invokeCreditLedger({
    action: 'adjust',
    userId: id,
    direction,
    amount: value,
  });
  if (!result.ok) return { ok: false as const, code: result.code };
  const balance = Number(result.data.balance);
  return { ok: true as const, balance: Number.isFinite(balance) ? balance : 0 };
};

export const settleClientCredits = (userId: string, amount: number, orderId = '') => {
  const id = userId.trim();
  const price = moneyAmount(amount);
  const order = orderId.trim();
  if (!USER_ID.test(id) || price === null || price <= 0 || !USER_ID.test(order)) {
    return Promise.resolve({ ok: false as const, code: 'missing' as const });
  }
  return enqueueCreditWrite(id, async () => {
    const result = await invokeCreditLedger({
      action: 'charge',
      userId: id,
      amount: price,
      orderId: order,
    });
    if (!result.ok) {
      return {
        ok: false as const,
        code: result.code === 'INSUFFICIENT_CREDITS' ? 'insufficient' as const : 'failed' as const,
      };
    }
    const balance = Number(result.data.balance);
    return {
      ok: true as const,
      charged: result.data.charged !== false,
      balance: Number.isFinite(balance) ? balance : 0,
    };
  });
};

export const restoreClientCredits = (userId: string, amount: number, orderId = '') => {
  const id = userId.trim();
  const price = moneyAmount(amount);
  const order = orderId.trim();
  if (!USER_ID.test(id) || price === null || price <= 0 || !USER_ID.test(order)) return Promise.resolve(false);
  return enqueueCreditWrite(id, async () => {
    const result = await invokeCreditLedger({
      action: 'restore',
      userId: id,
      amount: price,
      orderId: order,
    });
    return result.ok;
  });
};

export const refundOrderCredits = async (orderId: string) => {
  const order = orderId.trim();
  if (!USER_ID.test(order)) return { ok: false as const, code: 'INVALID_ORDER' as const, refunded: 0 };
  const result = await invokeCreditLedger({ action: 'refund-order', orderId: order });
  if (!result.ok) return { ok: false as const, code: result.code, refunded: 0 };
  const refunded = Number(result.data.refunded);
  return {
    ok: true as const,
    refunded: Number.isFinite(refunded) ? refunded : 0,
    userId: text(result.data.userId),
  };
};

const activityFromPacked = (packed: PackedProfile | null): PortalActivity => ({
  visits: Number(packed?.portalVisits) || 0,
  lastVisit: packed?.lastPortalVisit || null,
});

let portalVisitChain: Promise<void> = Promise.resolve();
const countedPortalUsers = new Set<string>();
const visitStorageKey = (userId: string) => `rp-portal-visit:${userId}`;

const visitAlreadyCounted = (userId: string) => {
  try {
    return window.sessionStorage.getItem(visitStorageKey(userId)) === '1';
  } catch {
    return false;
  }
};

const rememberVisitCounted = (userId: string) => {
  try {
    window.sessionStorage.setItem(visitStorageKey(userId), '1');
  } catch {
    /* sessionStorage can be blocked */
  }
};

export const releasePortalVisit = (userId = '') => {
  if (userId) countedPortalUsers.delete(userId);
  else countedPortalUsers.clear();
  try {
    const prefix = 'rp-portal-visit:';
    const keys: string[] = [];
    for (let index = 0; index < window.sessionStorage.length; index += 1) {
      const key = window.sessionStorage.key(index);
      if (!key?.startsWith(prefix)) continue;
      if (!userId || key === visitStorageKey(userId)) keys.push(key);
    }
    keys.forEach((key) => window.sessionStorage.removeItem(key));
  } catch {
    /* sessionStorage can be blocked */
  }
};

// A fresh SIGNED_IN with no stored flag is a new login. A flag left from the
// current browser session means the session was only restored, so the count stays.
export const trackPortalAuth = (
  event: 'SIGNED_IN' | 'INITIAL_SESSION',
  userId: string,
  email: string,
) => {
  const freshLogin = event === 'SIGNED_IN';
  const alreadyCounted = visitAlreadyCounted(userId);
  if (freshLogin && alreadyCounted) return;
  if (!alreadyCounted) countedPortalUsers.delete(userId);
  if (alreadyCounted) {
    void recordPortalVisit(userId, email, false);
    return;
  }
  rememberVisitCounted(userId);
  void recordPortalVisit(userId, email, true);
};

const writePortalVisit = async (userId: string, email: string, countVisit: boolean) => {
  const id = await currentUserId(userId);
  const emailKey = email.trim().toLowerCase();
  if (!id || !emailKey) return;
  const now = new Date().toISOString();

  const profile = await supabase.from('client_profiles').select(COMPACT_COLUMNS).eq('id', id).maybeSingle();
  if (profile.error) return;
  const row = (profile.data ?? null) as Record<string, unknown> | null;
  const rawAddress = text(row?.address);
  const packed = rawAddress ? unpackAddress(rawAddress) : {};
  if (rawAddress && !packed) return;
  const visits = (Number(packed.portalVisits) || 0) + (countVisit ? 1 : 0);
  const nextPacked: PackedProfile = {
    ...packed,
    email: text(packed.email) || email.trim(),
    portalVisits: visits,
    lastPortalVisit: now,
  };
  await supabase.from('client_profiles').upsert({
    id,
    company_name: text(row?.company_name),
    ico: text(row?.ico),
    dic: text(row?.dic),
    address: PACKED_ADDRESS + JSON.stringify(nextPacked),
  }, { onConflict: 'id' });
};

export const recordPortalVisit = (userId: string, email: string, countVisit: boolean) => {
  let increment = countVisit;
  if (increment) {
    if (countedPortalUsers.has(userId)) increment = false;
    else countedPortalUsers.add(userId);
  }
  const job = portalVisitChain.then(() => writePortalVisit(userId, email, increment));
  portalVisitChain = job.then(() => undefined, () => undefined);
  return job;
};

export const loadPortalActivityByClient = async (clients: Array<{ id: string; email: string }>) => {
  const byEmail = new Map<string, PortalActivity>();
  const byId = new Map<string, PortalActivity>();

  const profiles = await supabase.from('client_profiles').select('id, address');
  if (!profiles.error && Array.isArray(profiles.data)) {
    for (const row of profiles.data as Array<{ id?: string; address?: string }>) {
      const packed = unpackAddress(text(row.address));
      if (!packed?.portalVisits && !packed?.lastPortalVisit) continue;
      const activity = activityFromPacked(packed);
      if (row.id) byId.set(row.id, activity);
      const email = text(packed.email).toLowerCase();
      if (email && !byEmail.has(email)) byEmail.set(email, activity);
    }
  }

  const result = new Map<string, PortalActivity>();
  for (const client of clients) {
    const email = client.email.trim().toLowerCase();
    result.set(client.id, (email && byEmail.get(email)) || byId.get(client.id) || { visits: 0, lastVisit: null });
  }
  return result;
};

export const loadBillingByUserId = async (userId: string, fallbackEmail = '') => {
  const stored = userId ? await readStoredBilling(userId, fallbackEmail) : null;
  const billing = stored ?? emptyBilling();
  if (!billing.email) billing.email = fallbackEmail;
  return billing;
};

export const loadClientBilling = async (user: User): Promise<ClientBilling | null> => {
  const stored = await readStoredBilling(user.id, user.email || '');
  const billing = stored ?? emptyBilling();
  if (!billing.email) billing.email = user.email || '';
  if (billing.firstName || billing.lastName || billing.company) return billing;

  const name = realProfileLabel(metadataProfileName(user.user_metadata));
  const company = realProfileLabel(companyFromMetadata(user.user_metadata));
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

if (typeof window !== 'undefined') {
  const marker = window as Window & { __rpPortalVisitLogout?: boolean };
  if (!marker.__rpPortalVisitLogout) {
    marker.__rpPortalVisitLogout = true;
    supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') releasePortalVisit();
    });
  }
}
