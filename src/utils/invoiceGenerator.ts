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

export type InvoiceConsent = {
  orderRef: string;
  termsConfirmed: boolean;
  termsConfirmedAt?: string | null;
  emissionConfirmed: boolean;
  emissionConfirmedAt?: string | null;
};

export type InvoiceConsentOrder = {
  id?: string | null;
  order_number?: string | null;
  note?: string | null;
  legal_consent?: boolean | null;
  legal_consent_known?: boolean | null;
  legal_consent_at?: string | null;
  emission_offroad_consent?: boolean | null;
  emission_offroad_consent_at?: string | null;
};

export type InvoicePdfInput = {
  invoiceNumber: string;
  issuedAt?: Date;
  buyer: InvoiceBuyer;
  price: number;
  consent?: InvoiceConsent | null;
};

export type CreditNotePdfInput = {
  creditNoteNumber: string;
  invoiceNumber: string;
  issuedAt?: Date;
  buyer: InvoiceBuyer;
  price: number;
};

type AccountingPdfInput = {
  documentNumber: string;
  invoiceNumber: string;
  title: string;
  originalInvoice?: string;
  issuedAt?: Date;
  buyer: InvoiceBuyer;
  price: number;
  consent?: InvoiceConsent | null;
};

const formatConsentWhen = (value?: string | null) => {
  const raw = value?.trim();
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const invoiceConsentFromOrder = (order: InvoiceConsentOrder): InvoiceConsent | null => {
  const tagged = String(order.note || '').split('\n')[0]?.trim() || '';
  const orderRef = String(order.order_number || '').trim()
    || (tagged.startsWith('RP-') ? tagged : '')
    || (order.id ? order.id.slice(0, 8).toUpperCase() : '');
  const termsAt = order.legal_consent_at?.trim() || null;
  const emissionAt = order.emission_offroad_consent_at?.trim() || null;
  const termsConfirmed = Boolean(termsAt) || (
    order.legal_consent_known === true
      ? order.legal_consent === true
      : order.legal_consent_known == null && order.legal_consent === true
  );
  const emissionConfirmed = order.emission_offroad_consent === true || Boolean(emissionAt);
  if (!orderRef || (!termsConfirmed && !emissionConfirmed)) return null;
  return {
    orderRef,
    termsConfirmed,
    termsConfirmedAt: termsAt,
    emissionConfirmed,
    emissionConfirmedAt: emissionAt,
  };
};

const consentNoteText = (consent?: InvoiceConsent | null) => {
  const ref = consent?.orderRef.trim() || '';
  if (!consent || !ref) return '';
  if (consent.emissionConfirmed) {
    const when = formatConsentWhen(consent.emissionConfirmedAt) || formatConsentWhen(consent.termsConfirmedAt);
    const dated = when ? ` (dňa ${when})` : '';
    return `Súhlas a vyhlásenie odberateľa (obj. ${ref}): Odberateľ elektronicky potvrdil obchodné podmienky a vyhlásenie o použití úpravy výhradne na off-road, motorsport alebo exportné účely${dated}.`;
  }
  if (!consent.termsConfirmed) return '';
  const when = formatConsentWhen(consent.termsConfirmedAt);
  const dated = when ? ` (dňa ${when})` : '';
  return `Potvrdenie obchodných podmienok (obj. ${ref}): Odberateľ elektronicky potvrdil obchodné podmienky${dated}.`;
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
  const negative = amount < 0;
  const [whole, fraction] = Math.abs(amount).toFixed(2).split('.');
  return `${negative ? '-' : ''}${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction} €`;
};

const formatDate = (date: Date) => {
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}. ${month}. ${date.getFullYear()}`;
};

const filled = (value?: string) => value?.trim() || '';

const addDays = (date: Date, days: number) => {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
};

const INK: [number, number, number] = [0, 0, 0];
const MUTED: [number, number, number] = [90, 90, 90];

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

const SOFT: [number, number, number] = [214, 219, 226];
const LABEL: [number, number, number] = [120, 128, 138];

const card = (doc: jsPDF, x: number, y: number, width: number, height: number) => {
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.35);
  doc.roundedRect(x, y, width, height, 2.2, 2.2);
};

const fitText = (doc: jsPDF, text: string, width: number, size: number, bold = false) => {
  doc.setFont('Roboto', bold ? 'bold' : 'normal');
  let next = size;
  doc.setFontSize(next);
  while (next > 7 && doc.getTextWidth(text) > width) {
    next -= 0.4;
    doc.setFontSize(next);
  }
  return next;
};

const pdfFilename = (documentNumber: string) => `${documentNumber.replace(/[^\w.-]+/g, '_')}.pdf`;

const renderAccountingPdf = async (input: AccountingPdfInput) => {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  await registerFonts(doc);
  const margin = 18;
  const right = 192;
  const issued = input.issuedAt ?? new Date();
  const invoiceSettings = await loadInvoiceSettings();

  doc.setProperties({
    title: `${input.documentNumber}`,
    creator: 'REMAPPRO B2B',
  });

  const logoWidth = 42;
  const logoHeight = logoWidth * (327 / 1024);
  const headerTop = 14;
  const logo = await grayscaleLogo(LOGO_BASE64);
  doc.addImage(logo, 'PNG', margin, headerTop, logoWidth, logoHeight);

  const kind = input.originalInvoice ? 'DOBROPIS — DAŇOVÝ DOKLAD' : 'FAKTÚRA — DAŇOVÝ DOKLAD';
  doc.setFont('Roboto', 'bold');
  const kindSize = fitText(doc, kind, 78, 7);
  doc.setFontSize(kindSize);
  doc.setTextColor(...LABEL);
  const kindWidth = doc.getTextWidth(kind) + 6;
  doc.setDrawColor(...SOFT);
  doc.roundedRect(right - kindWidth, headerTop - 1.2, kindWidth, 5.4, 1.3, 1.3);
  doc.text(kind, right - 3, headerTop + 2.4, { align: 'right' });
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(15);
  doc.setTextColor(...INK);
  doc.text(input.title, right, headerTop + 11, { align: 'right' });

  const contentWidth = right - margin;
  const mid = margin + contentWidth / 2;
  const pad = 4;
  const columnText = contentWidth / 2 - pad * 2;
  const partiesY = Math.max(headerTop + logoHeight, headerTop + 16) + 6;
  const lineStep = 4.5;
  const supplierLines = 8;
  const buyer = input.buyer;
  const buyerRows = [
    filled(buyer.name) || 'Zákazník',
    filled(buyer.contact),
    filled(buyer.street),
    [buyer.postalCode, buyer.city].map((part) => part?.trim()).filter(Boolean).join(' '),
    filled(buyer.phone) ? `Tel.: ${filled(buyer.phone)}` : '',
    filled(buyer.email) ? `E-mail: ${filled(buyer.email)}` : '',
    filled(buyer.vatId) ? `IČO: ${filled(buyer.vatId)}` : '',
    filled(buyer.taxId) ? `DIČ: ${filled(buyer.taxId)}` : '',
  ].filter(Boolean);
  const partiesHeight = 8 + Math.max(supplierLines, buyerRows.length) * lineStep + 5;
  card(doc, margin, partiesY, contentWidth, partiesHeight);
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.3);
  doc.line(mid, partiesY + 2.2, mid, partiesY + partiesHeight - 2.2);

  const heading = (text: string, role: string, x: number, columnRight: number) => {
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...LABEL);
    doc.text(text, x, partiesY + 6);
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(7.5);
    doc.text(role, columnRight - pad, partiesY + 6, { align: 'right' });
  };
  heading('DODÁVATEĽ', 'Vyhotovil', margin + pad, mid);
  heading('ODBERATEĽ', 'Klient B2B', mid + pad, right);
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.3);
  const partiesRuleY = partiesY + 8.3;
  doc.line(margin + pad, partiesRuleY, mid - pad, partiesRuleY);
  doc.line(mid + pad, partiesRuleY, right - pad, partiesRuleY);

  let cursor = partiesY + 12;
  const supplierBody = [
    { text: invoiceSettings.supplierName || 'REMAPPRO', bold: true, size: 11 },
    { text: 'Janka Kráľa 29', bold: false, size: 9 },
    { text: '990 01 Veľký Krtíš, Slovakia', bold: false, size: 9 },
  ];
  supplierBody.forEach((line) => {
    const size = fitText(doc, line.text, columnText, line.size, line.bold);
    doc.setFont('Roboto', line.bold ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    doc.text(line.text, margin + pad, cursor);
    cursor += lineStep;
  });
  const idValue = (label: string, value: string) => {
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(label, margin + pad, cursor);
    doc.text(value, margin + pad + 14, cursor);
    cursor += lineStep;
  };
  idValue('IČO:', invoiceSettings.supplierIco);
  idValue('DIČ:', invoiceSettings.supplierDic);
  [
    'Nie je platiteľom DPH',
    'Živnostenský register Okresného úradu Veľký Krtíš',
    'Číslo živnostenského registra: 660-5049',
  ].forEach((line) => {
    const size = fitText(doc, line, columnText, 8.5);
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    doc.text(line, margin + pad, cursor);
    cursor += lineStep;
  });

  let buyerCursor = partiesY + 12;
  buyerRows.forEach((line, index) => {
    const size = fitText(doc, line, columnText, index === 0 ? 11 : 9, index === 0);
    doc.setFont('Roboto', index === 0 ? 'bold' : 'normal');
    doc.setFontSize(size);
    doc.setTextColor(...INK);
    doc.text(line, mid + pad, buyerCursor);
    buyerCursor += lineStep;
  });

  const due = addDays(issued, invoiceSettings.dueDays);
  const factsY = partiesY + partiesHeight + 4;
  const factsHeight = input.originalInvoice ? 34 : 30;
  card(doc, margin, factsY, contentWidth, factsHeight);
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.3);
  doc.line(mid, factsY + 2.2, mid, factsY + factsHeight - 2.2);
  const factsRuleY = factsY + 8.3;
  doc.line(margin + pad, factsRuleY, mid - pad, factsRuleY);
  doc.line(mid + pad, factsRuleY, right - pad, factsRuleY);
  const labelAt = (text: string, x: number, y: number) => {
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(...LABEL);
    doc.text(text, x, y);
  };
  const valueAt = (text: string, x: number, y: number, width: number, size = 9) => {
    const fitted = fitText(doc, text, width, size, true);
    doc.setFont('Roboto', 'bold');
    doc.setFontSize(fitted);
    doc.setTextColor(...INK);
    doc.text(text, x, y);
  };
  labelAt('PLATOBNÉ ÚDAJE', margin + pad, factsY + 6);
  labelAt('IBAN', margin + pad, factsY + 12);
  valueAt(invoiceSettings.iban, margin + pad, factsY + 16.5, columnText, 9);
  labelAt('SWIFT / BIC', margin + pad, factsY + 22);
  labelAt('FORMA ÚHRADY', margin + contentWidth / 4, factsY + 22);
  valueAt(invoiceSettings.swift, margin + pad, factsY + 26.2, columnText / 2 - 2, 9);
  valueAt('Bankový prevod', margin + contentWidth / 4, factsY + 26.2, columnText / 2 - 2, 9);

  labelAt('IDENTIFIKÁCIA A DÁTUMY', mid + pad, factsY + 6);
  labelAt('VARIABILNÝ SYMBOL', mid + pad, factsY + 12);
  labelAt('ČÍSLO FAKTÚRY', mid + contentWidth / 4, factsY + 12);
  valueAt(input.documentNumber, mid + pad, factsY + 16.5, columnText / 2 - 2, 8.5);
  valueAt(input.invoiceNumber, mid + contentWidth / 4, factsY + 16.5, columnText / 2 - 2, 8.5);
  if (input.originalInvoice) {
    doc.setFont('Roboto', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(...INK);
    doc.text(`K faktúre č. ${input.originalInvoice}`, mid + contentWidth / 4, factsY + 20);
  }
  const dateY = input.originalInvoice ? factsY + 25 : factsY + 22;
  labelAt('DÁTUM VYSTAVENIA', mid + pad, dateY);
  labelAt('DÁTUM SPLATNOSTI', mid + contentWidth / 4, dateY);
  valueAt(formatDate(issued), mid + pad, dateY + 4.2, columnText / 2 - 2, 9);
  valueAt(formatDate(due), mid + contentWidth / 4, dateY + 4.2, columnText / 2 - 2, 9);

  const tableWidth = contentWidth;
  autoTable(doc, {
    startY: factsY + factsHeight + 4,
    margin: { left: margin, right: margin },
    theme: 'grid',
    head: [['P.Č.', 'NÁZOV POLOŽKY / SLUŽBY', 'MNOŽSTVO', 'CENA SPOLU']],
    body: [['1.', invoiceSettings.itemName, '1 ks', money(input.price)]],
    styles: {
      font: 'Roboto',
      fontStyle: 'normal',
      fontSize: 9,
      textColor: INK,
      fillColor: [255, 255, 255],
      lineColor: SOFT,
      lineWidth: 0.2,
      cellPadding: { top: 2.2, right: 2, bottom: 5.2, left: 2 },
      valign: 'top',
    },
    headStyles: {
      fontStyle: 'bold',
      fontSize: 7.5,
      fillColor: [255, 255, 255],
      textColor: LABEL,
      lineColor: SOFT,
      lineWidth: 0.2,
      cellPadding: 2.2,
    },
    columnStyles: {
      0: { cellWidth: 14, halign: 'center' },
      1: { cellWidth: tableWidth - 14 - 28 - 34 },
      2: { cellWidth: 28, halign: 'center' },
      3: { cellWidth: 34, halign: 'right', fontStyle: 'bold' },
    },
    didDrawCell: (data) => {
      if (data.section !== 'body' || data.column.index !== 1) return;
      doc.setFont('Roboto', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(...LABEL);
      doc.text('Digitálna služba B2B portálu REMAPPRO', data.cell.x + 2, data.cell.y + data.cell.height - 2);
    },
  });

  const tableEnd = (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? factsY + factsHeight + 24;
  const summaryY = tableEnd + 6;
  const summaryWidth = 92;
  card(doc, right - summaryWidth, summaryY, summaryWidth, 18);
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(7);
  doc.setTextColor(...LABEL);
  doc.text('REKAPITULÁCIA', right - summaryWidth + 4, summaryY + 5.5);
  doc.text('EUR', right - 4, summaryY + 5.5, { align: 'right' });
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text('Celková suma na úhradu:', right - summaryWidth + 4, summaryY + 12.5);
  doc.setFontSize(12);
  doc.text(money(input.price), right - 4, summaryY + 12.5, { align: 'right' });
  doc.setFont('Roboto', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...LABEL);
  doc.text('Poznámka:', margin, summaryY + 5);
  doc.setFont('Roboto', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  doc.text(invoiceSettings.vatNote, margin, summaryY + 9.2);
  const consentLine = consentNoteText(input.consent);
  if (consentLine) {
    const noteWidth = Math.max(48, right - summaryWidth - margin - 5);
    const noteTop = summaryY + 13.6;
    const noteBottom = doc.internal.pageSize.getHeight() - 22;
    doc.setFont('Roboto', 'normal');
    doc.setTextColor(...INK);
    let size = 8;
    doc.setFontSize(size);
    let lines = doc.splitTextToSize(consentLine, noteWidth);
    let lineHeight = doc.getLineHeightFactor() * size / doc.internal.scaleFactor;
    while (noteTop + lines.length * lineHeight > noteBottom && size > 6.5) {
      size = Math.round((size - 0.3) * 10) / 10;
      doc.setFontSize(size);
      lines = doc.splitTextToSize(consentLine, noteWidth);
      lineHeight = doc.getLineHeightFactor() * size / doc.internal.scaleFactor;
    }
    const maxLines = Math.max(1, Math.floor((noteBottom - noteTop) / lineHeight));
    doc.text(lines.slice(0, maxLines), margin, noteTop);
  }

  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 12;
  doc.setDrawColor(...SOFT);
  doc.setLineWidth(0.25);
  doc.line(margin, footerY - 6, right, footerY - 6);
  doc.setFont('Roboto', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text('REMAPPRO  |  Janka Kráľa 29, 990 01 Veľký Krtíš, Slovakia', (margin + right) / 2, footerY - 1.5, { align: 'center' });
  doc.text(
    `IČO: ${invoiceSettings.supplierIco}  |  DIČ: ${invoiceSettings.supplierDic}  |  info@remappro.eu`,
    (margin + right) / 2,
    footerY + 3,
    { align: 'center' },
  );

  const blob = doc.output('blob');
  return new File([blob], pdfFilename(input.documentNumber), { type: 'application/pdf' });
};

export const generateInvoicePdf = (input: InvoicePdfInput) => renderAccountingPdf({
  documentNumber: input.invoiceNumber,
  invoiceNumber: input.invoiceNumber,
  title: `FAKTÚRA Č. ${input.invoiceNumber}`,
  issuedAt: input.issuedAt,
  buyer: input.buyer,
  price: input.price,
  consent: input.consent,
});

export const generateCreditNotePdf = (input: CreditNotePdfInput) => {
  const amount = Math.abs(Number(input.price) || 0);
  return renderAccountingPdf({
    documentNumber: input.creditNoteNumber,
    invoiceNumber: input.invoiceNumber,
    title: `DOBROPIS Č. ${input.creditNoteNumber}`,
    originalInvoice: input.invoiceNumber,
    issuedAt: input.issuedAt,
    buyer: input.buyer,
    price: amount === 0 ? 0 : -amount,
  });
};
