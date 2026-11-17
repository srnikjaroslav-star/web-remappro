import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import regularFont from '../assets/fonts/Roboto-Regular.ttf';
import boldFont from '../assets/fonts/Roboto-Bold.ttf';

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

  doc.setTextColor(0);
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(18);
  doc.text('REMAPPRO', margin, 22);
  doc.setFontSize(13);
  doc.text('FAKTÚRA / INVOICE', right, 20, { align: 'right' });

  doc.setFont('Roboto', 'normal');
  doc.setFontSize(11);
  doc.setTextColor(20);
  doc.text(`č. ${input.invoiceNumber}`, right, 27, { align: 'right' });
  doc.setFontSize(10);
  doc.setTextColor(70);
  doc.text(`Dátum / Date: ${formatDate(issued)}`, right, 34, { align: 'right' });

  doc.setTextColor(30);
  doc.setFontSize(10);
  const supplier = [
    'Janka Kráľa 29, 990 01 Veľký Krtíš, Slovakia',
    'IČO: 41281471, DIČ: 1041196607',
  ];
  supplier.forEach((line, index) => doc.text(line, margin, 32 + index * 5));

  doc.setDrawColor(210);
  doc.setLineWidth(0.3);
  doc.line(margin, 46, right, 46);

  doc.setFont('Roboto', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(110);
  doc.text('ODBERATEĽ / CUSTOMER', margin, 54);

  doc.setFont('Roboto', 'normal');
  doc.setFontSize(10);
  doc.setTextColor(20);
  let cursor = 61;
  buyerLines(input.buyer).forEach((line) => {
    const wrapped = doc.splitTextToSize(line, 110) as string[];
    doc.text(wrapped, margin, cursor);
    cursor += wrapped.length * 5;
  });

  autoTable(doc, {
    startY: cursor + 6,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['Položka / Item', 'Cena / Price']],
    body: [[itemLabel(input), money(input.price)]],
    foot: [['Spolu / Total', money(input.price)]],
    styles: {
      font: 'Roboto',
      fontStyle: 'normal',
      fontSize: 10,
      textColor: [20, 20, 20],
      lineColor: [210, 210, 210],
      lineWidth: 0.2,
      cellPadding: 3,
    },
    headStyles: {
      fontStyle: 'bold',
      fillColor: [245, 245, 245],
      textColor: [20, 20, 20],
    },
    footStyles: {
      fontStyle: 'bold',
      fillColor: [245, 245, 245],
      textColor: [20, 20, 20],
    },
    columnStyles: {
      0: { cellWidth: 132 },
      1: { cellWidth: 42, halign: 'right' },
    },
  });

  const tableEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursor + 30;
  const footerY = Math.min(Math.max(tableEnd + 18, 255), 282);
  doc.setDrawColor(210);
  doc.setLineWidth(0.2);
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
