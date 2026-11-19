import { loadBillingByUserId } from '@/lib/clientProfile';
import { supabase } from '@/lib/supabase';
import { generateCreditNotePdf, generateInvoicePdf, type InvoiceBuyer } from '@/utils/invoiceGenerator';
import { readCreditNoteMark, readInvoiceMark, saveBlob } from '@/lib/orderInvoice';

export type AccountingSource = {
  userId?: string | null;
  note?: string | null;
  total?: number | string | null;
  customerName?: string;
  customerEmail?: string;
};

const clientId = (value?: string | null) => {
  const id = String(value || '').trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : '';
};

const issuedOn = (value?: string | null) => {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return undefined;
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
};

const buyerFor = async (source: AccountingSource): Promise<InvoiceBuyer> => {
  const billing = await loadBillingByUserId(clientId(source.userId), source.customerEmail || '');
  const person = [billing.firstName, billing.lastName].map((part) => part.trim()).filter(Boolean).join(' ');
  return {
    name: billing.company.trim() || person || source.customerName || 'Zákazník',
    contact: billing.company.trim() && person ? person : '',
    street: billing.street,
    postalCode: billing.postalCode,
    city: billing.city,
    email: billing.email || source.customerEmail || '',
    phone: billing.phone,
    vatId: billing.vatId,
    taxId: billing.taxId,
  };
};

const loadSource = async (orderId: string, hints?: { customerName?: string; customerEmail?: string }): Promise<AccountingSource> => {
  const row = await supabase.from('orders').select('user_id, note, total_price').eq('id', orderId).maybeSingle();
  if (row.error || !row.data) throw new Error(row.error?.message || 'Doklad sa nepodarilo načítať');
  return {
    userId: row.data.user_id,
    note: row.data.note,
    total: row.data.total_price,
    customerName: hints?.customerName,
    customerEmail: hints?.customerEmail,
  };
};

const replaceStoredPdf = async (stored: string, file: File) => {
  if (!stored.startsWith('bucket:')) return;
  const [, bucket, ...pathParts] = stored.split(':');
  if (!bucket || pathParts.length === 0) return;
  const uploaded = await supabase.storage.from(bucket).upload(pathParts.join(':'), file, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (uploaded.error) console.error('[replaceStoredPdf]', uploaded.error);
};

export const buildAccountingFile = async (source: AccountingSource, kind: 'invoice' | 'credit') => {
  const note = String(source.note || '');
  const invoice = readInvoiceMark(note);
  const credit = readCreditNoteMark(note);
  const buyer = await buyerFor(source);
  const price = Math.abs(Number(source.total) || 0);
  if (kind === 'credit') {
    const number = credit.credit_note_number?.trim() || '';
    const invoiceNumber = invoice.invoice_number?.trim() || '';
    if (!number || !invoiceNumber) return null;
    return {
      number,
      stored: credit.credit_note_url || '',
      file: await generateCreditNotePdf({
        creditNoteNumber: number,
        invoiceNumber,
        issuedAt: issuedOn(credit.credit_note_date || invoice.invoice_date),
        buyer,
        price,
      }),
    };
  }
  const number = invoice.invoice_number?.trim() || '';
  if (!number) return null;
  return {
    number,
    stored: invoice.invoice_url || '',
    file: await generateInvoicePdf({
      invoiceNumber: number,
      issuedAt: issuedOn(invoice.invoice_date),
      buyer,
      price,
    }),
  };
};

export const materializeAccountingFile = async (source: AccountingSource, kind: 'invoice' | 'credit') => {
  const built = await buildAccountingFile(source, kind);
  if (!built) return null;
  if (built.stored) await replaceStoredPdf(built.stored, built.file);
  return built;
};

const downloadBuilt = async (source: AccountingSource, kind: 'invoice' | 'credit') => {
  const built = await materializeAccountingFile(source, kind);
  if (!built?.stored) throw new Error(kind === 'credit' ? 'K tomuto dobropisu ešte nie je nahraté PDF.' : 'K tejto faktúre ešte nie je nahraté PDF.');
  saveBlob(built.file, `${built.number}.pdf`);
};

export const downloadOrderInvoice = async (orderId: string, hints?: { customerName?: string; customerEmail?: string }) => {
  await downloadBuilt(await loadSource(orderId, hints), 'invoice');
};

export const downloadOrderCreditNote = async (orderId: string, hints?: { customerName?: string; customerEmail?: string }) => {
  await downloadBuilt(await loadSource(orderId, hints), 'credit');
};
