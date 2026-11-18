import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import regularFont from '../assets/fonts/Roboto-Regular.ttf';
import boldFont from '../assets/fonts/Roboto-Bold.ttf';
import { LOGO_BASE64 } from '@/lib/invoiceLogo';
import { loadInvoiceSettings } from '@/lib/invoiceSettings';

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
    buyer.vatId?.trim() ? `IČO: ${buyer.vatId.trim()}` : '',
    buyer.taxId?.trim() ? `DIČ: ${buyer.taxId.trim()}` : '',
  ].filter(Boolean).join(', ');
  return [buyer.name, buyer.contact, buyer.street, place, buyer.email, buyer.phone, tax]
    .map((line) => line?.trim() || '')
    .filter(Boolean);
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
};

const INK: [number, number, number] = [0, 0, 0];
const MUTED: [number, number, number] = [90, 90, 90];
const LINE: [number, number, number] = [176, 176, 176];

const grayscaleLogo = (src: string) => new Promise<string>((resolve) => {
  if (typeof document === 'undefined') {
    resolve(src);
    return;
  }
  const image = new Image();
  image.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || !canvas.width || !canvas.height) {
      resolve(src);
      return;
    }
    context.drawImage(image, 0, 0);
    const frame = context.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = frame.data;
    for (let index = 0; index < pixels.length; index += 4) {
      const gray = pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      pixels[index] = gray;
      pixels[index + 1] = gray;
      pixels[index + 2] = gray;
    }
    context.putImageData(frame, 0, 0);
    resolve(canvas.toDataURL('image/png'));
  };
  image.onerror = () => resolve(src);
  image.src = src;
});

const drawParty = (doc: jsPDF, title: string, lines: string[], x: number, y: number, width: number) => {
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(title, x, y);
  let cursor = y + 6;
  lines.forEach((line, index) => {
    doc.setFont('Roboto', index === 0 ? 'bold' : 'normal');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const wrapped = doc.splitTextToSize(line, width) as string[];
    doc.text(wrapped, x, cursor);
    cursor += wrapped.length * 4.6;
  });
  return cursor;
};

const drawFacts = (doc: jsPDF, rows: Array<[string, string]>, x: number, y: number, width: number) => {
  let cursor = y;
  rows.forEach(([label, value]) => {
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(label, x, cursor);
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    const wrapped = doc.splitTextToSize(value, width) as string[];
    doc.text(wrapped, x, cursor + 4.4);
    cursor += 4.4 + wrapped.length * 4.4 + 2.2;
  });
  return cursor;
};

export const generateInvoicePdf = async (input: InvoicePdfInput) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  await registerFonts(doc);
  const margin = 18;
  const right = 192;
  const issued = input.issuedAt ?? new Date();
  const invoiceSettings = await loadInvoiceSettings();

  doc.setProperties({
    title: `${input.invoiceNumber}`,
    creator: 'REMAPPRO B2B',
  });

  const logoWidth = 42;
  const logoHeight = logoWidth * (327 / 1024);
  const headerTop = 14;
  const logo = await grayscaleLogo(LOGO_BASE64);
  doc.addImage(logo, 'PNG', margin, headerTop, logoWidth, logoHeight);

  const titleX = margin + logoWidth + 8;
  const titleWidth = right - titleX;
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(...INK);
  const title = doc.splitTextToSize(`FAKTÚRA č. ${input.invoiceNumber}`, titleWidth) as string[];
  const titleY = headerTop + Math.max(6, (logoHeight - title.length * 7) / 2 + 5);
  doc.text(title, right, titleY, { align: 'right' });

  const ruleY = Math.max(headerTop + logoHeight, titleY + title.length * 7) + 4;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.25);
  doc.line(margin, ruleY, right, ruleY);

  const columnGap = 10;
  const columnWidth = (right - margin - columnGap) / 2;
  const partiesY = ruleY + 8;
  const supplierEnd = drawParty(doc, 'DODÁVATEĽ', [
    invoiceSettings.supplierName,
    invoiceSettings.supplierAddress,
    `IČO: ${invoiceSettings.supplierIco}, DIČ: ${invoiceSettings.supplierDic}`,
    invoiceSettings.supplierRegister,
  ], margin, partiesY, columnWidth);
  const buyerEnd = drawParty(
    doc,
    'ODBERATEĽ',
    buyerLines(input.buyer),
    margin + columnWidth + columnGap,
    partiesY,
    columnWidth,
  );

  const factsY = Math.max(supplierEnd, buyerEnd) + 7;
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.2);
  doc.line(margin, factsY - 3, right, factsY - 3);
  const due = addDays(issued, invoiceSettings.dueDays);
  const factsEnd = Math.max(
    drawFacts(doc, [
      ['IBAN', invoiceSettings.iban],
      ['SWIFT / BIC', invoiceSettings.swift],
      ['Variabilný symbol', input.invoiceNumber],
    ], margin, factsY + 2, columnWidth),
    drawFacts(doc, [
      ['Forma úhrady', 'Bankový prevod'],
      ['Dátum vystavenia', formatDate(issued)],
      ['Dátum splatnosti', formatDate(due)],
    ], margin + columnWidth + columnGap, factsY + 2, columnWidth),
  );

  const tableWidth = right - margin;
  autoTable(doc, {
    startY: factsEnd + 4,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['Položka', 'Cena']],
    body: [[invoiceSettings.itemName, money(input.price)]],
    styles: {
      font: 'Roboto',
      fontStyle: 'normal',
      fontSize: 10,
      textColor: INK,
      fillColor: [255, 255, 255],
      lineColor: LINE,
      lineWidth: 0.2,
      cellPadding: 3,
    },
    headStyles: {
      fontStyle: 'bold',
      fillColor: [255, 255, 255],
      textColor: INK,
      lineColor: [90, 90, 90],
      lineWidth: 0.3,
    },
    columnStyles: {
      0: { cellWidth: tableWidth - 42 },
      1: { cellWidth: 42, halign: 'right' },
    },
  });

  const tableEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? factsEnd + 24;
  const totalY = tableEnd + 12;
  doc.setDrawColor(...INK);
  doc.setLineWidth(0.35);
  doc.line(margin, totalY - 6, right, totalY - 6);
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...INK);
  doc.text('Celková suma na úhradu', margin, totalY);
  doc.text(money(input.price), right, totalY, { align: 'right' });
  doc.setFontSize(11);
  doc.text(invoiceSettings.vatNote, margin, totalY + 8);

  const blob = doc.output('blob');
  const filename = `${input.invoiceNumber.replace(/[^\w.\-]+/g, '_')}.pdf`;
  return new File([blob], filename, { type: 'application/pdf' });
};
