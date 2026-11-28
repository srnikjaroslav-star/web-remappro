import { loadBillingByUserId } from '@/lib/clientProfile';
import { PACKAGE_ITEM_DESCRIPTION, packageItemName } from '@/lib/creditPackages';
import { loadInvoiceSettings } from '@/lib/invoiceSettings';
import { supabase } from '@/lib/supabase';
import { generateInvoicePdf } from '@/utils/invoiceGenerator';

export type CreditPackageInvoice = {
  id: string;
  userId: string;
  invoiceNumber: string;
  issuedAt: string;
  credits: number;
  amount: number;
  company: string;
  accountName: string;
  accountEmail: string;
  topupRef: string;
  consentSummary: string;
};

const text = (value: unknown) => String(value ?? '').trim();

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const TEST_ACCOUNT_EMAIL = 'srnik.jaroslav@gmail.com';

export const CREDIT_INVOICES_REFRESH_KEY = 'remappro-credit-invoices-refresh';

export const isDeletableTestCreditInvoice = (row: CreditPackageInvoice) => {
  const email = row.accountEmail.trim().toLowerCase();
  const name = row.accountName.trim().toLowerCase();
  const company = row.company.trim().toLowerCase();
  const session = row.id.trim().toLowerCase();
  const consent = row.consentSummary.toLowerCase();
  const testFlag = session.startsWith('cs_admtest')
    || consent.includes('test100')
    || consent.includes('admin test');
  const testAccount = email === TEST_ACCOUNT_EMAIL || name === 'admin test' || company === 'admin test';
  return testFlag || (row.amount <= 0 && testAccount);
};

export const deleteTestCreditPackageInvoice = async (stripeSessionId: string) => {
  const { data, error } = await supabase.functions.invoke('delete-test-credit-invoice', {
    body: { stripeSessionId },
  });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean; code?: string } | null;
  if (!payload?.ok) throw new Error(payload?.code || 'DELETE_FAILED');
  try {
    localStorage.setItem(CREDIT_INVOICES_REFRESH_KEY, String(Date.now()));
  } catch {
    /* another open portal tab refreshes when storage is available */
  }
};

export const creditInvoiceIssuedDay = (issuedAt: string) => {
  const date = new Date(issuedAt);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((part) => part.type === 'year')?.value ?? '';
  const month = parts.find((part) => part.type === 'month')?.value ?? '';
  const day = parts.find((part) => part.type === 'day')?.value ?? '';
  if (!year || !month || !day) return '';
  return `${year}-${month}-${day}`;
};

export const creditPackageInvoicesInRange = async (fromYmd: string, toYmd: string) => {
  const rows = await loadCreditPackageInvoices();
  return rows.filter((row) => {
    const day = creditInvoiceIssuedDay(row.issuedAt);
    return Boolean(day) && day >= fromYmd && day <= toYmd;
  });
};

export const loadCreditPackageInvoices = async (): Promise<CreditPackageInvoice[]> => {
  const { data, error } = await supabase.functions.invoke('list-credit-package-invoices', { body: {} });
  if (error) throw new Error(error.message);
  const payload = data as { ok?: boolean; rows?: Record<string, unknown>[] } | null;
  if (!payload?.ok || !Array.isArray(payload.rows)) throw new Error('Doklady sa nepodarilo načítať.');
  return payload.rows
    .map((record) => {
      const invoiceNumber = text(record.invoice_number);
      if (!invoiceNumber) return null;
      return {
        id: text(record.stripe_session_id),
        userId: text(record.user_id),
        invoiceNumber,
        issuedAt: text(record.created_at) || text(record.invoice_sent_at),
        credits: num(record.credits),
        amount: num(record.amount),
        company: text(record.company),
        accountName: text(record.account_name),
        accountEmail: text(record.account_email),
        topupRef: text(record.topup_ref),
        consentSummary: text(record.consent_summary),
      } satisfies CreditPackageInvoice;
    })
    .filter((row): row is CreditPackageInvoice => row !== null);
};

export const creditPackageInvoiceFile = async (row: CreditPackageInvoice) => {
  const billing = row.userId ? await loadBillingByUserId(row.userId, row.accountEmail) : null;
  const settings = await loadInvoiceSettings();
  const issued = row.issuedAt ? new Date(row.issuedAt) : new Date();
  return generateInvoicePdf({
    invoiceNumber: row.invoiceNumber,
    issuedAt: Number.isNaN(issued.getTime()) ? new Date() : issued,
    buyer: {
      name: row.company || billing?.company || row.accountName || billing?.firstName || 'Zákazník',
      contact: row.company && (row.accountName || billing?.firstName)
        ? (row.accountName || [billing?.firstName, billing?.lastName].filter(Boolean).join(' '))
        : '',
      street: billing?.street || '',
      postalCode: billing?.postalCode || '',
      city: billing?.city || '',
      email: row.accountEmail || billing?.email || '',
      phone: billing?.phone || '',
      vatId: billing?.vatId || '',
      taxId: billing?.taxId || '',
    },
    price: row.amount,
    itemName: packageItemName(row.credits || 0),
    itemDescription: settings.itemDescription.trim() || PACKAGE_ITEM_DESCRIPTION,
    topupId: row.topupRef,
    noteExtra: row.consentSummary,
  });
};
