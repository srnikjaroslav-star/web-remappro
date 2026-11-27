import { loadBillingByUserId } from '@/lib/clientProfile';
import { supabase } from '@/lib/supabase';
import { generateCreditNotePdf, type InvoiceBuyer } from '@/utils/invoiceGenerator';
import { downloadStoredInvoice, readCreditNoteMark, readInvoiceMark, saveBlob } from '@/lib/orderInvoice';

export type AccountingSource = {
  id?: string | null;
  orderNumber?: string | null;
  userId?: string | null;
  note?: string | null;
  total?: number | string | null;
  customerName?: string;
  customerEmail?: string;
  legalConsent?: boolean | null;
  legalConsentAt?: string | null;
  emissionOffroadConsent?: boolean | null;
  emissionOffroadConsentAt?: string | null;
  consentSummary?: string | null;
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

type AccountingHints = {
  customerName?: string;
  customerEmail?: string;
  orderRef?: string;
};

const orderRefFromNote = (note?: string | null) => {
  const first = String(note || '').split('\n')[0]?.trim() || '';
  return /^RP-/i.test(first) ? first : '';
};

const loadSource = async (orderId: string, hints?: AccountingHints): Promise<AccountingSource> => {
  const row = await supabase
    .from('orders')
    .select('id, user_id, note, total_price, legal_consent, legal_consent_at, emission_offroad_consent, emission_offroad_consent_at, consent_summary')
    .eq('id', orderId)
    .maybeSingle();
  if (row.error || !row.data) throw new Error(row.error?.message || 'Doklad sa nepodarilo načítať');
  const data = row.data as {
    id?: string | null;
    user_id?: string | null;
    note?: string | null;
    total_price?: number | string | null;
    legal_consent?: boolean | null;
    legal_consent_at?: string | null;
    emission_offroad_consent?: boolean | null;
    emission_offroad_consent_at?: string | null;
    consent_summary?: string | null;
  };
  return {
    id: data.id || orderId,
    orderNumber: hints?.orderRef?.trim() || orderRefFromNote(data.note) || null,
    userId: data.user_id,
    note: data.note,
    total: data.total_price,
    customerName: hints?.customerName,
    customerEmail: hints?.customerEmail,
    legalConsent: data.legal_consent,
    legalConsentAt: data.legal_consent_at,
    emissionOffroadConsent: data.emission_offroad_consent,
    emissionOffroadConsentAt: data.emission_offroad_consent_at,
    consentSummary: data.consent_summary,
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
  if (uploaded.error) throw new Error(uploaded.error.message || 'Uložené PDF sa nepodarilo prepísať.');
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
  return null;
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

export const downloadOrderInvoice = async (orderId: string, hints?: AccountingHints) => {
  const source = await loadSource(orderId, hints);
  const invoice = readInvoiceMark(String(source.note || ''));
  const stored = invoice.invoice_url?.trim() || '';
  const number = invoice.invoice_number?.trim() || '';
  if (!stored || !number) throw new Error('K tejto objednávke nie je vystavená faktúra.');
  await downloadStoredInvoice(stored, number);
};

export const downloadOrderCreditNote = async (orderId: string, hints?: AccountingHints) => {
  await downloadBuilt(await loadSource(orderId, hints), 'credit');
};
