import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import regularFont from '../assets/fonts/Roboto-Regular.ttf';
import boldFont from '../assets/fonts/Roboto-Bold.ttf';
import { LOGO_BASE64 } from '@/lib/invoiceLogo';

export type InvoiceBuyer = {
  name: string;
  contact?: string;
  street?: string;
  postalCode?: string;
  city?: string;
  email?: string;
  phone?: string;
  vatId?: string;
  taxId?: string;
};

export type InvoicePdfInput = {
  invoiceNumber: string;
  issuedAt?: Date;
  buyer: InvoiceBuyer;
  brand: string;
  model: string;
  service: string;
  price: number;
};

const fontCache = new Map<string, Promise<string>>();

const fontBase64 = (url: string) => {
  const cached = fontCache.get(url);
  if (cached) return cached;
  const pending = fetch(url)
    .then((response) => {
      if (!response.ok) throw new Error('Font faktúry sa nepodarilo načítať');
      return response.arrayBuffer();
    })
    .then((buffer) => {
      const bytes = new Uint8Array(buffer);
      let binary = '';
      const step = 0x8000;
      for (let offset = 0; offset < bytes.length; offset += step) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + step));
      }
      return btoa(binary);
    });
  fontCache.set(url, pending);
  return pending;
};

const registerFonts = async (doc: jsPDF) => {
  const [regular, bold] = await Promise.all([fontBase64(regularFont), fontBase64(boldFont)]);
  doc.addFileToVFS('Roboto-Regular.ttf', regular);
  doc.addFileToVFS('Roboto-Bold.ttf', bold);
  doc.addFont('Roboto-Regular.ttf', 'Roboto', 'normal');
  doc.addFont('Roboto-Bold.ttf', 'Roboto', 'bold');
  doc.setFont('Roboto', 'normal');
};

const money = (value: number) => {
  const amount = Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  const [whole, fraction] = amount.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction} €`;
};

const formatDate = (date: Date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}. ${month}. ${date.getFullYear()}`;
};

const buyerLines = (buyer: InvoiceBuyer) => {
  const place = [buyer.postalCode, buyer.city].map((part) => part?.trim()).filter(Boolean).join(' ');
  const tax = [
    buyer.vatId?.trim() ? `IČ DPH: ${buyer.vatId.trim()}` : '',
    buyer.taxId?.trim() ? `DIČ: ${buyer.taxId.trim()}` : '',
  ].filter(Boolean).join(', ');
  return [buyer.name, buyer.contact, buyer.street, place, buyer.email, buyer.phone, tax]
    .map((line) => line?.trim() || '')
    .filter(Boolean);
};

const itemLabel = (input: InvoicePdfInput) => {
  const vehicle = [input.brand, input.model].map((part) => part.trim()).filter(Boolean).join(' ');
  const service = input.service.trim();
  return [vehicle, service].filter(Boolean).join('\n') || 'ECU tuning';
};

const BRAND: [number, number, number] = [0, 191, 255];

const drawParty = (doc: jsPDF, title: string, lines: string[], x: number, y: number, width: number) => {
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...BRAND);
  doc.text(title, x, y);
  doc.setFont('Roboto', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(20);
  let cursor = y + 6;
  lines.forEach((line) => {
    const wrapped = doc.splitTextToSize(line, width) as string[];
    doc.text(wrapped, x, cursor);
    cursor += wrapped.length * 5;
  });
  return cursor;
};

export const generateInvoicePdf = async (input: InvoicePdfInput) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  await registerFonts(doc);
  const margin = 18;
  const right = 192;
  const issued = input.issuedAt ?? new Date();

  doc.setProperties({
    title: `${input.invoiceNumber}`,
    creator: 'REMAPPRO B2B',
  });

  const logoWidth = 35;
  const logoHeight = logoWidth * (327 / 1024);
  const headerTop = 14;
  doc.addImage(LOGO_BASE64, 'PNG', margin, headerTop, logoWidth, logoHeight);

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(14);
  doc.setTextColor(0);
  doc.text('FAKTÚRA / INVOICE', right, headerTop + 5, { align: 'right' });
  doc.setFont('Roboto', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(`č. ${input.invoiceNumber}`, right, headerTop + 12, { align: 'right' });
  doc.setFontSize(10);
  doc.setTextColor(70);
  doc.text(`Dátum / Date: ${formatDate(issued)}`, right, headerTop + 18, { align: 'right' });

  const ruleY = Math.max(headerTop + logoHeight, headerTop + 20) + 4;
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(1.2);
  doc.line(margin, ruleY, right, ruleY);

  const columnGap = 8;
  const columnWidth = (right - margin - columnGap) / 2;
  const partiesY = ruleY + 8;
  const supplierEnd = drawParty(doc, 'DODÁVATEĽ / SUPPLIER', [
    'REMAPPRO',
    'Janka Kráľa 29, 990 01 Veľký Krtíš, Slovakia',
    'IČO: 41281471, DIČ: 1041196607',
  ], margin, partiesY, columnWidth);
  const buyerEnd = drawParty(
    doc,
    'ODBERATEĽ / CUSTOMER',
    buyerLines(input.buyer),
    margin + columnWidth + columnGap,
    partiesY,
    columnWidth,
  );

  autoTable(doc, {
    startY: Math.max(supplierEnd, buyerEnd) + 8,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['Položka / Item', 'Cena / Price']],
    body: [[itemLabel(input), money(input.price)]],
    styles: {
      font: 'Roboto',
      fontStyle: 'normal',
      fontSize: 10,
      textColor: [20, 20, 20],
      fillColor: [255, 255, 255],
      lineColor: BRAND,
      lineWidth: 0.15,
      cellPadding: 3,
    },
    headStyles: {
      fontStyle: 'bold',
      fillColor: BRAND,
      textColor: [255, 255, 255],
      lineColor: BRAND,
    },
    columnStyles: {
      0: { cellWidth: 132 },
      1: { cellWidth: 42, halign: 'right' },
    },
  });

  const tableEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? partiesY + 40;
  const totalY = tableEnd + 10;
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...BRAND);
  doc.text('Spolu / Total', margin, totalY);
  doc.text(money(input.price), right, totalY, { align: 'right' });

  const footerY = Math.min(Math.max(totalY + 16, 255), 282);
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.3);
  doc.line(margin, footerY - 6, right, footerY - 6);
  doc.setFont('Roboto', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(60);
  doc.text('Nie som platcom DPH. / Not subject to VAT.', margin, footerY);
  doc.text('Vygenerované automaticky systémom REMAPPRO B2B.', margin, footerY + 5);

  const blob = doc.output('blob');
  const filename = `${input.invoiceNumber.replace(/[^\w.\-]+/g, '_')}.pdf`;
  return new File([blob], filename, { type: 'application/pdf' });
};
