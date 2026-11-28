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
