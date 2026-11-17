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

const invoicePath = (stored: string) => {
  if (!stored.startsWith('bucket:')) return null;
  const [, bucket, ...pathParts] = stored.split(':');
  if (!bucket || pathParts.length === 0) return null;
  return { bucket, path: pathParts.join(':') };
};

export const readInvoiceMark = (note: string) => {
  const source = String(note || '');
  const raw = source.match(/\[\[rp-invoice\]\]([^\n]*)/)?.[1] ?? '';
  const parts = raw.split('||');
  let invoice_number = '';
  let invoice_date = '';
  let invoice_url = '';
  if (parts.length >= 3) {
    invoice_number = parts[0];
    invoice_date = parts[1];
    invoice_url = parts.slice(2).join('||');
  } else if (parts.length === 2) {
    invoice_number = parts[0];
    invoice_url = parts[1];
  } else {
    invoice_number = raw;
  }
  return {
    invoice_number: invoice_number || null,
    invoice_date: invoice_date || null,
    invoice_url: invoice_url || null,
    note: source.replace(/\n?\[\[rp-invoice\]\][^\n]*/g, ''),
  };
};

const writeInvoiceMark = (note: string, number: string, date: string, url: string) => {
  const clean = readInvoiceMark(note).note.replace(/\s+$/g, '');
  return [clean, `[[rp-invoice]]${number}||${date}||${url}`].filter(Boolean).join('\n');
};

const columnMissing = (error: { code?: string; message?: string } | null) =>
  error?.code === '42703'
  || error?.code === 'PGRST204'
  || error?.code === 'PGRST205'
  || /column .* does not exist|schema cache|could not find the table/i.test(error?.message ?? '');

export const invoiceLinksFor = async (orderIds: string[]) => {
  const ids = [...new Set(orderIds.filter(Boolean))];
  const links = new Map<string, InvoiceLink>();
  if (ids.length === 0) return links;
  const { data, error } = await supabase
    .from('invoices')
    .select('order_id, invoice_number, invoice_url')
    .in('order_id', ids);
  if (error || !data) return links;
  data.forEach((row) => {
    const orderId = String(row.order_id || '');
    if (!orderId) return;
    const next = {
      invoice_number: row.invoice_number ? String(row.invoice_number) : null,
      invoice_url: row.invoice_url ? String(row.invoice_url) : null,
    };
    const current = links.get(orderId);
    if (!current || (!current.invoice_url && next.invoice_url)) links.set(orderId, next);
  });
  return links;
};

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

const storeInvoiceFile = async (orderId: string, file: File) => {
  const path = `invoices/${orderId}.pdf`;
  const uploaded = await supabase.storage.from(INVOICE_BUCKET).upload(path, file, {
    contentType: 'application/pdf',
    upsert: true,
  }).catch(() => null);
  if (uploaded?.data?.path && !uploaded.error) return `bucket:${INVOICE_BUCKET}:${uploaded.data.path}`;
  const dataUrl = await readDataUrl(file);
  if (!dataUrl.startsWith('data:')) throw new Error('PDF sa nepodarilo uložiť');
  return dataUrl;
};

export const saveOrderInvoice = async (order: InvoiceTarget, file: File) => {
  const pdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!pdf) throw new Error('Nahrajte súbor PDF.');
  if (file.size > 15 * 1024 * 1024) throw new Error('PDF môže mať najviac 15 MB.');

  const stored = await storeInvoiceFile(order.id, file);
  const number = order.invoice_number?.trim()
    || `INV-${String(order.order_number || order.id.slice(0, 8)).replace(/^INV-/i, '').toUpperCase()}`;
  const issued = new Date().toISOString().slice(0, 10);

  const orderUpdate = await supabase
    .from('orders')
    .update({ invoice_number: number, invoice_url: stored })
    .eq('id', order.id);
  if (orderUpdate.error && !columnMissing(orderUpdate.error)) {
    throw new Error(orderUpdate.error.message || 'Faktúru sa nepodarilo priradiť k objednávke');
  }
  if (orderUpdate.error) {
    const current = await supabase.from('orders').select('note').eq('id', order.id).maybeSingle();
    if (current.error) throw new Error(current.error.message || 'Faktúru sa nepodarilo priradiť k objednávke');
    const saved = await supabase
      .from('orders')
      .update({ note: writeInvoiceMark(String(current.data?.note || ''), number, issued, stored) })
      .eq('id', order.id);
    if (saved.error) throw new Error(saved.error.message || 'Faktúru sa nepodarilo priradiť k objednávke');
  }

  const existing = await supabase.from('invoices').select('id').eq('order_id', order.id).maybeSingle();
  if (!existing.error && existing.data?.id) {
    await supabase.from('invoices').update({ invoice_number: number, invoice_url: stored, invoice_date: issued }).eq('id', existing.data.id);
  } else if (!existing.error) {
    await supabase.from('invoices').insert({
      invoice_number: number,
      order_id: order.id,
      order_number: order.order_number || null,
      user_id: order.user_id || null,
      customer_name: order.customer_name || 'Zákazník',
      customer_email: order.customer_email || 'info@remappro.eu',
      amount: Math.abs(Number(order.total_price) || 0),
      invoice_url: stored,
      invoice_date: issued,
      items: [],
      payment_method: 'credits',
      currency: 'EUR',
      status: 'paid',
    });
  }

  return { invoice_number: number, invoice_url: stored };
};

const dayStart = (ymd: string) => {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(year, month - 1, day, 0, 0, 0, 0).toISOString();
};

const dayEnd = (ymd: string) => {
  const [year, month, day] = ymd.split('-').map(Number);
  return new Date(year, month - 1, day, 23, 59, 59, 999).toISOString();
};

export const exportInvoiceArchive = async (fromYmd: string, toYmd: string) => {
  const files: { name: string; data: Uint8Array }[] = [];
  const used = new Set<string>();
  const pushFile = async (number: string, url: string) => {
    const bytes = await readInvoiceBytes(url);
    const base = safePdfName(number || 'faktura');
    let name = `${base}.pdf`;
    let copy = 2;
    while (used.has(name)) {
      name = `${base}-${copy}.pdf`;
      copy += 1;
    }
    used.add(name);
    files.push({ name, data: bytes });
  };

  const fromTable = await supabase
    .from('invoices')
    .select('invoice_number, invoice_url, order_number, invoice_date')
    .gte('invoice_date', dayStart(fromYmd))
    .lte('invoice_date', dayEnd(toYmd));
  if (!fromTable.error) {
    for (const row of fromTable.data || []) {
      if (!row.invoice_url) continue;
      await pushFile(String(row.invoice_number || row.order_number || 'faktura'), String(row.invoice_url));
    }
  }

  let fromOrders = await supabase.from('orders').select('note, created_at, order_number');
  if (fromOrders.error) fromOrders = await supabase.from('orders').select('note, created_at');
  if (fromOrders.error) throw new Error(fromOrders.error.message || 'Faktúry sa nepodarilo načítať');
  for (const row of fromOrders.data || []) {
    const marked = readInvoiceMark(String(row.note || ''));
    if (!marked.invoice_url || !marked.invoice_number || used.has(`${safePdfName(marked.invoice_number)}.pdf`)) continue;
    const issued = marked.invoice_date || String(row.created_at || '').slice(0, 10);
    if (!issued || issued < fromYmd || issued > toYmd) continue;
    await pushFile(marked.invoice_number, marked.invoice_url);
  }

  if (files.length === 0) return 0;
  saveBlob(zipStored(files), `faktury-${fromYmd}-${toYmd}.zip`);
  return files.length;
};
