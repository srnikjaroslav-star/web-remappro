import { documentCalendarYear, nextDocumentSerial, serialOfDocument, type DocumentKind } from '@/lib/accountingNumbers';
import { supabase } from '@/lib/supabase';

const INVOICE_BUCKET = 'tunes';

export type InvoiceLink = {
  invoice_number: string | null;
  invoice_url: string | null;
};

export type InvoiceTarget = {
  id: string;
  order_number?: string | null;
  user_id?: string | null;
  customer_name?: string | null;
  customer_email?: string | null;
  total_price?: number | string | null;
  invoice_number?: string | null;
};

const crcTable = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
  crcTable[index] = value >>> 0;
}

const crc32 = (data: Uint8Array) => {
  let value = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    value = crcTable[(value ^ data[index]) & 0xff] ^ (value >>> 8);
  }
  return (value ^ 0xffffffff) >>> 0;
};

const concat = (parts: Uint8Array[]) => {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  parts.forEach((part) => {
    out.set(part, offset);
    offset += part.length;
  });
  return out;
};

const le16 = (value: number) => Uint8Array.of(value & 0xff, (value >> 8) & 0xff);
const le32 = (value: number) => Uint8Array.of(value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >> 24) & 0xff);

const zipStored = (files: { name: string; data: Uint8Array }[]) => {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  files.forEach((file) => {
    const name = new TextEncoder().encode(file.name);
    const checksum = crc32(file.data);
    const local = concat([
      le32(0x04034b50),
      le16(20),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(checksum),
      le32(file.data.length),
      le32(file.data.length),
      le16(name.length),
      le16(0),
      name,
      file.data,
    ]);
    locals.push(local);
    centrals.push(concat([
      le32(0x02014b50),
      le16(20),
      le16(20),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(checksum),
      le32(file.data.length),
      le32(file.data.length),
      le16(name.length),
      le16(0),
      le16(0),
      le16(0),
      le16(0),
      le32(0),
      le32(offset),
      name,
    ]));
    offset += local.length;
  });
  const central = concat(centrals);
  const end = concat([
    le32(0x06054b50),
    le16(0),
    le16(0),
    le16(files.length),
    le16(files.length),
    le32(central.length),
    le32(offset),
    le16(0),
  ]);
  return new Blob([concat(locals), central, end], { type: 'application/zip' });
};

export const saveBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
};

const bucketLocation = (stored: string) => {
  if (!stored.startsWith('bucket:')) return null;
  const [, bucket, ...pathParts] = stored.split(':');
  if (!bucket || pathParts.length === 0) return null;
  return { bucket, path: pathParts.join(':') };
};

const invoicePath = (stored: string) => bucketLocation(stored);

const MARK_INVOICE = '[[rp-invoice]]';
const MARK_CREDIT = '[[rp-credit]]';

const parseMarkValue = (raw: string) => {
  const parts = raw.split('||');
  let number = '';
  let date = '';
  let url = '';
  if (parts.length >= 3) {
    number = parts[0];
    date = parts[1];
    url = parts.slice(2).join('||');
  } else if (parts.length === 2) {
    number = parts[0];
    url = parts[1];
  } else {
    number = raw;
  }
  return {
    number: number || null,
    date: date || null,
    url: url || null,
  };
};

const markValue = (source: string, tag: string) => {
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return source.match(new RegExp(`${escaped}([^\\n]*)`))?.[1] ?? '';
};

const stripDocumentMarks = (source: string) =>
  source
    .replace(/\n?\[\[rp-invoice\]\][^\n]*/g, '')
    .replace(/\n?\[\[rp-credit\]\][^\n]*/g, '');

const composeDocumentNote = (
  note: string,
  patch?: { kind: 'invoice' | 'credit'; number: string; date: string; url: string },
) => {
  const source = String(note || '');
  const invoice = parseMarkValue(markValue(source, MARK_INVOICE));
  const credit = parseMarkValue(markValue(source, MARK_CREDIT));
  if (patch?.kind === 'invoice') {
    invoice.number = patch.number;
    invoice.date = patch.date;
    invoice.url = patch.url;
  }
  if (patch?.kind === 'credit') {
    credit.number = patch.number;
    credit.date = patch.date;
    credit.url = patch.url;
  }
  const clean = stripDocumentMarks(source).replace(/\s+$/g, '');
  const lines = [clean];
  if (invoice.number) lines.push(`${MARK_INVOICE}${invoice.number}||${invoice.date || ''}||${invoice.url || ''}`);
  if (credit.number) lines.push(`${MARK_CREDIT}${credit.number}||${credit.date || ''}||${credit.url || ''}`);
  return lines.filter(Boolean).join('\n');
};

export const readInvoiceMark = (note: string) => {
  const source = String(note || '');
  const parsed = parseMarkValue(markValue(source, MARK_INVOICE));
  return {
    invoice_number: parsed.number,
    invoice_date: parsed.date,
    invoice_url: parsed.url,
    note: stripDocumentMarks(source),
  };
};

export const readCreditNoteMark = (note: string) => {
  const source = String(note || '');
  const parsed = parseMarkValue(markValue(source, MARK_CREDIT));
  return {
    credit_note_number: parsed.number,
    credit_note_date: parsed.date,
    credit_note_url: parsed.url,
    note: stripDocumentMarks(source),
  };
};

type IssuedDocument = {
  id: string;
  invoice: string;
  credit: string;
};

export class DuplicateDocumentNumber extends Error {
  constructor(kind: DocumentKind) {
    super(kind === 'invoice' ? 'Toto číslo faktúry už je použité.' : 'Toto číslo dobropisu už je použité.');
    this.name = 'DuplicateDocumentNumber';
  }
}

const loadIssuedDocuments = async () => {
  const documents: IssuedDocument[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const rows = await supabase.from('orders').select('id, note').range(from, from + pageSize - 1);
    if (rows.error) throw new Error(rows.error.message || 'Číslo dokladu sa nepodarilo priradiť.');
    const batch = rows.data || [];
    for (const row of batch) {
      const note = String(row.note || '');
      documents.push({
        id: String(row.id || ''),
        invoice: readInvoiceMark(note).invoice_number?.trim() || '',
        credit: readCreditNoteMark(note).credit_note_number?.trim() || '',
      });
    }
    if (batch.length < pageSize) break;
  }
  return documents;
};

const numberTakenByOther = (documents: IssuedDocument[], kind: DocumentKind, number: string, orderId: string) =>
  documents.some((item) => item.id !== orderId && (kind === 'invoice' ? item.invoice : item.credit) === number);

const allocateFromDatabase = async (kind: DocumentKind, year: number) => {
  const reserved = await supabase.rpc('next_accounting_number', { p_kind: kind, p_year: year });
  if (reserved.error) {
    if (/NUMBER_EXHAUSTED/i.test(reserved.error.message || '')) {
      throw new Error('Číselný rad dokladov pre tento rok je vyčerpaný.');
    }
    console.error('[accounting-number] sequence rpc failed', reserved.error.message);
    return '';
  }
  const number = typeof reserved.data === 'string' ? reserved.data : '';
  return serialOfDocument(kind, year, number) > 0 ? number : '';
};

const allocateDocumentNumber = async (kind: DocumentKind, issued = new Date()) => {
  const year = documentCalendarYear(issued);
  const reserved = await allocateFromDatabase(kind, year);
  if (reserved) return reserved;
  const documents = await loadIssuedDocuments();
  const used = documents.map((item) => (kind === 'invoice' ? item.invoice : item.credit)).filter(Boolean);
  return nextDocumentSerial(used, kind, year);
};

let seriesQueue: Promise<void> = Promise.resolve();

export const withDocumentSeries = <T>(task: () => Promise<T>): Promise<T> => {
  const run = seriesQueue.then(task, task);
  seriesQueue = run.then(() => undefined, () => undefined);
  return run;
};

export const nextInvoiceNumber = async (issued = new Date()) => allocateDocumentNumber('invoice', issued);

export const nextCreditNoteNumber = async (issued = new Date()) => allocateDocumentNumber('credit', issued);

const writeInvoiceMark = (note: string, number: string, date: string, url: string) =>
  composeDocumentNote(note, { kind: 'invoice', number, date, url });

const writeCreditNoteMark = (note: string, number: string, date: string, url: string) =>
  composeDocumentNote(note, { kind: 'credit', number, date, url });

export const invoiceLinksFor = async (_orderIds: string[]) => new Map<string, InvoiceLink>();

export const mergeInvoice = <T extends { invoice_number?: string | null; invoice_url?: string | null }>(order: T, link?: InvoiceLink | null): T => ({
  ...order,
  invoice_number: order.invoice_number || link?.invoice_number || null,
  invoice_url: order.invoice_url || link?.invoice_url || null,
});

const readInvoiceBytes = async (stored: string) => {
  const located = invoicePath(stored);
  if (located) {
    const { data, error } = await supabase.storage.from(located.bucket).download(located.path);
    if (error || !data) throw error || new Error('Súbor faktúry sa nenašiel');
    return new Uint8Array(await data.arrayBuffer());
  }
  if (stored.startsWith('data:')) {
    const comma = stored.indexOf(',');
    const binary = atob(stored.slice(comma + 1));
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  if (stored.startsWith('http')) {
    const response = await fetch(stored);
    if (!response.ok) throw new Error('Súbor faktúry sa nepodarilo stiahnuť');
    return new Uint8Array(await response.arrayBuffer());
  }
  throw new Error('Súbor faktúry sa nenašiel');
};

export const downloadStoredInvoice = async (stored: string, filename: string) => {
  const bytes = await readInvoiceBytes(stored);
  saveBlob(new Blob([bytes], { type: 'application/pdf' }), filename.endsWith('.pdf') ? filename : `${filename}.pdf`);
};

const safePdfName = (name: string) => name.replace(/[^\w.\-]+/g, '_').replace(/\.pdf$/i, '') || 'faktura';

const readDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve(String(reader.result || ''));
  reader.onerror = () => reject(reader.error || new Error('PDF sa nepodarilo prečítať'));
  reader.readAsDataURL(file);
});

const storeInvoiceFile = async (orderId: string, file: File, path = `invoices/${orderId}.pdf`) => {
  const uploaded = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, {
    contentType: 'application/pdf',
    upsert: true,
  }).catch((error: unknown) => {
    console.error('[storeInvoiceFile] Storage upload failed:', error);
    return null;
  });
  if (uploaded?.error) console.error('[storeInvoiceFile] Storage upload failed:', uploaded.error);
  if (uploaded?.data?.path && !uploaded.error) return `bucket:${INVOICE_BUCKET}:${uploaded.data.path}`;
  const dataUrl = await readDataUrl(file);
  if (!dataUrl.startsWith('data:')) throw new Error('PDF sa nepodarilo uložiť');
  return dataUrl;
};

const writeOrderNote = async (orderId: string, note: string, failure: string) => {
  const saved = await supabase.from('orders').update({ note }).eq('id', orderId).select('id, note');
  if (saved.error) throw new Error(saved.error.message || failure);
  if (!saved.data?.length) throw new Error(failure);
  return String(saved.data[0].note || '');
};

export const saveOrderInvoice = async (order: InvoiceTarget, file: File) => {
  const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!pdf) throw new Error('Nahrajte súbor PDF.');
  if (file.size > 15 * 1024 * 1024) throw new Error('PDF môže mať najviac 15 MB.');

  const stored = await storeInvoiceFile(order.id, file);
  const current = await supabase.from('orders').select('note').eq('id', order.id).maybeSingle();
  if (current.error) throw new Error(current.error.message || 'Faktúru sa nepodarilo priradiť k objednávke');
  const existing = readInvoiceMark(String(current.data?.note || '')).invoice_number?.trim() || '';
  const number = existing || order.invoice_number?.trim() || await nextInvoiceNumber();
  if (!existing) {
    const issuedDocuments = await loadIssuedDocuments();
    if (numberTakenByOther(issuedDocuments, 'invoice', number, order.id)) {
      throw new DuplicateDocumentNumber('invoice');
    }
  }
  const issued = new Date().toISOString().slice(0, 10);
  const fresh = await supabase.from('orders').select('note').eq('id', order.id).maybeSingle();
  if (fresh.error) throw new Error(fresh.error.message || 'Faktúru sa nepodarilo priradiť k objednávke');
  const freshNote = String(fresh.data?.note || current.data?.note || '');
  const already = readInvoiceMark(freshNote).invoice_number?.trim() || '';
  const kept = already || number;
  if (already && already !== number) {
    return { invoice_number: already, invoice_url: readInvoiceMark(freshNote).invoice_url || stored };
  }

  await writeOrderNote(
    order.id,
    writeInvoiceMark(freshNote, kept, issued, stored),
    'Faktúru sa nepodarilo priradiť k objednávke',
  );

  return { invoice_number: kept, invoice_url: stored };
};

export const rememberCreditNote = async (orderId: string, number: string, date: string, url: string) => {
  const current = await supabase.from('orders').select('note').eq('id', orderId).maybeSingle();
  if (current.error) throw new Error(current.error.message || 'Dobropis sa nepodarilo priradiť k objednávke');
  const note = String(current.data?.note || '');
  const already = readCreditNoteMark(note).credit_note_number?.trim() || '';
  if (already && already !== number) return readCreditNoteMark(note);
  const kept = already || number;
  const written = await writeOrderNote(
    orderId,
    writeCreditNoteMark(note, kept, date, url),
    'Dobropis sa nepodarilo zapísať k objednávke.',
  );
  const saved = readCreditNoteMark(written);
  if (saved.credit_note_number !== kept) {
    throw new Error('Poznámka objednávky po uložení dobropis neobsahuje.');
  }
  return saved;
};

export const saveOrderCreditNote = async (order: InvoiceTarget, file: File, creditNoteNumber?: string) => {
  const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!pdf) throw new Error('Nahrajte súbor PDF.');
  if (file.size > 15 * 1024 * 1024) throw new Error('PDF môže mať najviac 15 MB.');
  const invoiceNumber = order.invoice_number?.trim() || '';
  if (!invoiceNumber) throw new Error('Dobropis vyžaduje pôvodnú faktúru.');

  const stored = await storeInvoiceFile(order.id, file, `invoices/${order.id}-dobropis.pdf`);
  const current = await supabase.from('orders').select('note').eq('id', order.id).maybeSingle();
  if (current.error) throw new Error(current.error.message || 'Dobropis sa nepodarilo priradiť k objednávke');
  const existing = readCreditNoteMark(String(current.data?.note || '')).credit_note_number?.trim() || '';
  const number = existing || creditNoteNumber?.trim() || await nextCreditNoteNumber();
  if (!existing) {
    const issuedDocuments = await loadIssuedDocuments();
    if (numberTakenByOther(issuedDocuments, 'credit', number, order.id)) {
      throw new DuplicateDocumentNumber('credit');
    }
  }
  const issued = new Date().toISOString().slice(0, 10);

  const saved = await rememberCreditNote(order.id, number, issued, stored);
  return {
    credit_note_number: saved.credit_note_number || number,
    credit_note_pdf: saved.credit_note_url || stored,
    credit_note_date: saved.credit_note_date || issued,
  };
};

const RESULT_MARK = '|||RESULT|||';

export const deleteOrderFilesAndRow = async (orderId: string) => {
  const current = await supabase.from('orders').select('file_url, note').eq('id', orderId).maybeSingle();
  if (current.error) throw new Error(current.error.message || 'Objednávku sa nepodarilo načítať.');
  if (!current.data) throw new Error('Objednávka sa nenašla.');

  const note = String(current.data.note || '');
  const invoice = readInvoiceMark(note);
  const credit = readCreditNoteMark(note);
  const storedFile = String(current.data.file_url || '');
  const splitAt = storedFile.indexOf(RESULT_MARK);
  const fileRefs = splitAt < 0
    ? [storedFile]
    : [storedFile.slice(0, splitAt), storedFile.slice(splitAt + RESULT_MARK.length)];
  const grouped = new Map<string, Set<string>>();
  for (const ref of [...fileRefs, invoice.invoice_url, credit.credit_note_url]) {
    const located = bucketLocation(String(ref || ''));
    if (!located) continue;
    const paths = grouped.get(located.bucket) ?? new Set<string>();
    paths.add(located.path);
    grouped.set(located.bucket, paths);
  }
  for (const [bucket, paths] of grouped) {
    const removed = await supabase.storage.from(bucket).remove([...paths]);
    if (removed.error) throw new Error(removed.error.message || 'Súbory objednávky sa nepodarilo zmazať.');
  }

  const deleted = await supabase.from('orders').delete().eq('id', orderId).select('id');
  if (deleted.error) throw new Error(deleted.error.message || 'Objednávku sa nepodarilo zmazať.');
  if (!deleted.data?.length) throw new Error('Objednávku sa nepodarilo zmazať.');
};

const inExportRange = (issued: string, fromYmd: string, toYmd: string) =>
  Boolean(issued) && issued >= fromYmd && issued <= toYmd;

type ExportDocument = {
  kind: 'invoice' | 'credit';
  number: string;
  url: string;
  id: string;
  orderNumber: string | null;
  userId: string;
  note: string;
  total: number | string | null;
  legalConsent: boolean | null;
  legalConsentAt: string | null;
  emissionOffroadConsent: boolean | null;
  emissionOffroadConsentAt: string | null;
};

type ExportRow = {
  id?: string | null;
  user_id?: string | null;
  note?: string | null;
  created_at?: string | null;
  status?: string | null;
  total_price?: number | string | null;
  legal_consent?: boolean | null;
  legal_consent_at?: string | null;
  emission_offroad_consent?: boolean | null;
  emission_offroad_consent_at?: string | null;
};

const documentsForExport = (rows: ExportRow[], fromYmd: string, toYmd: string) => {
  const documents: ExportDocument[] = [];
  for (const row of rows) {
    const note = String(row.note || '');
    const invoice = readInvoiceMark(note);
    const credit = readCreditNoteMark(note);
    const status = String(row.status || '').toLowerCase();
    const created = String(row.created_at || '').slice(0, 10);
    const invoiceDate = invoice.invoice_date || created;
    const hasInvoice = Boolean(invoice.invoice_number && invoice.invoice_url);
    const hasCredit = Boolean(credit.credit_note_number && credit.credit_note_url);
    const base = {
      id: String(row.id || ''),
      orderNumber: /^RP-/i.test(note.split('\n')[0]?.trim() || '') ? note.split('\n')[0].trim() : null,
      userId: String(row.user_id || ''),
      note,
      total: row.total_price ?? null,
      legalConsent: row.legal_consent ?? null,
      legalConsentAt: row.legal_consent_at ?? null,
      emissionOffroadConsent: row.emission_offroad_consent ?? null,
      emissionOffroadConsentAt: row.emission_offroad_consent_at ?? null,
    };

    if (status === 'completed' && hasInvoice && inExportRange(invoiceDate, fromYmd, toYmd)) {
      documents.push({ kind: 'invoice', number: invoice.invoice_number || '', url: invoice.invoice_url || '', ...base });
      continue;
    }

    if (status !== 'cancelled' || !hasInvoice || !hasCredit) continue;
    const creditDate = credit.credit_note_date || invoiceDate;
    if (!inExportRange(invoiceDate, fromYmd, toYmd) && !inExportRange(creditDate, fromYmd, toYmd)) continue;
    documents.push({ kind: 'invoice', number: invoice.invoice_number || '', url: invoice.invoice_url || '', ...base });
    documents.push({ kind: 'credit', number: credit.credit_note_number || '', url: credit.credit_note_url || '', ...base });
  }
  return documents;
};

const loadExportRows = async () => {
  const withConsent = 'id, user_id, note, created_at, status, total_price, legal_consent, legal_consent_at, emission_offroad_consent, emission_offroad_consent_at, consent_summary';
  const fromOrders = await supabase.from('orders').select(withConsent);
  if (fromOrders.error) throw new Error(fromOrders.error.message || 'Faktúry sa nepodarilo načítať');
  return (fromOrders.data || []) as ExportRow[];
};

export type InvoiceArchiveCounts = { invoices: number; credits: number; total: number };

export const previewInvoiceArchive = async (fromYmd: string, toYmd: string): Promise<InvoiceArchiveCounts> => {
  const documents = documentsForExport(await loadExportRows(), fromYmd, toYmd);
  const invoices = documents.filter((item) => item.kind === 'invoice').length;
  const credits = documents.filter((item) => item.kind === 'credit').length;
  return { invoices, credits, total: documents.length };
};

export const exportInvoiceArchive = async (fromYmd: string, toYmd: string) => {
  const files: { name: string; data: Uint8Array }[] = [];
  const used = new Set<string>();
  const pushFile = async (document: ExportDocument) => {
    let bytes: Uint8Array | null = null;
    try {
      const { materializeAccountingFile } = await import('@/lib/accountingDocument');
      const built = await materializeAccountingFile({
        id: document.id,
        orderNumber: document.orderNumber,
        userId: document.userId,
        note: document.note,
        total: document.total,
        legalConsent: document.legalConsent,
        legalConsentAt: document.legalConsentAt,
        emissionOffroadConsent: document.emissionOffroadConsent,
        emissionOffroadConsentAt: document.emissionOffroadConsentAt,
      }, document.kind);
      if (built) bytes = new Uint8Array(await built.file.arrayBuffer());
    } catch (error) {
      console.error('[exportInvoiceArchive] Nové PDF sa nepodarilo zostaviť, použije sa uložený súbor:', error);
    }
    if (!bytes) bytes = await readInvoiceBytes(document.url);
    const base = safePdfName(document.number || 'faktura');
    let name = `${base}.pdf`;
    let copy = 2;
    while (used.has(name)) {
      name = `${base}-${copy}.pdf`;
      copy += 1;
    }
    used.add(name);
    files.push({ name, data: bytes });
  };

  for (const document of documentsForExport(await loadExportRows(), fromYmd, toYmd)) {
    await pushFile(document);
  }

  if (files.length === 0) return 0;
  saveBlob(zipStored(files), `faktury-${fromYmd}-${toYmd}.zip`);
  return files.length;
};
