import { jsPDF } from "npm:jspdf@2.5.1";
import { LOGO_BASE64 } from "./invoiceLogo.ts";
import { ROBOTO_BOLD } from "./fonts/bold.ts";
import { ROBOTO_REGULAR } from "./fonts/regular.ts";
import {
  INVOICE_FOOTER,
  INVOICE_SUBTITLE,
  PACKAGE_ITEM_DESCRIPTION,
  SUPPLIER_VAT_NOTE,
  packageItemName,
} from "./creditPackages.ts";

export type PackageInvoiceInput = {
  invoiceNumber: string;
  issuedAt?: Date;
  credits: number;
  price: number;
  topupId: string;
  buyerName: string;
  buyerContact?: string;
  buyerStreet?: string;
  buyerPostal?: string;
  buyerCity?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  buyerIco?: string;
  buyerDic?: string;
  consentSummary?: string;
  itemDescription?: string;
};

const BLUE: [number, number, number] = [14, 99, 196];
const INK: [number, number, number] = [15, 23, 42];
const MUTED: [number, number, number] = [71, 85, 105];
const LINE: [number, number, number] = [191, 219, 254];
const WASH: [number, number, number] = [239, 246, 255];

const money = (value: number) => {
  const amount = Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
  const [whole, fraction] = Math.abs(amount).toFixed(2).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${fraction} €`;
};

const formatDate = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Bratislava",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("day")}. ${pick("month")}. ${pick("year")}`;
};

const filled = (value?: string) => value?.trim() || "";

export const renderPackageInvoice = (input: PackageInvoiceInput) => {
  const doc = new jsPDF({ unit: "mm", format: "a4", compress: false });
  doc.addFileToVFS("Roboto-Regular.ttf", ROBOTO_REGULAR);
  doc.addFileToVFS("Roboto-Bold.ttf", ROBOTO_BOLD);
  doc.addFont("Roboto-Regular.ttf", "Roboto", "normal");
  doc.addFont("Roboto-Bold.ttf", "Roboto", "bold");
  doc.setFont("Roboto", "normal");

  const margin = 16;
  const right = 194;
  const width = right - margin;
  const mid = margin + width / 2;
  const issued = input.issuedAt ?? new Date();
  const issuedLabel = formatDate(issued);

  doc.setProperties({
    title: input.invoiceNumber,
    creator: "REMAPPRO B2B",
  });

  const logoWidth = 48;
  const logoHeight = logoWidth * (327 / 1024);
  doc.addImage(LOGO_BASE64, "PNG", margin, 12, logoWidth, logoHeight);
  doc.setFont("Roboto", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...BLUE);
  doc.text(INVOICE_SUBTITLE, margin, 12 + logoHeight + 4.2);

  doc.setFont("Roboto", "bold");
  doc.setFontSize(8);
  doc.text("FAKTÚRA", right, 16, { align: "right" });
  doc.setFontSize(14);
  doc.setTextColor(...INK);
  doc.text(input.invoiceNumber, right, 23, { align: "right" });
  doc.setFont("Roboto", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(`Vystavené ${issuedLabel}`, right, 28.5, { align: "right" });

  const ruleY = 12 + logoHeight + 7.5;
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.8);
  doc.line(margin, ruleY, right, ruleY);

  const buyerRows = [
    filled(input.buyerName) || "Zákazník",
    filled(input.buyerContact),
    filled(input.buyerStreet),
    [input.buyerPostal, input.buyerCity].map((part) => part?.trim()).filter(Boolean).join(" "),
    filled(input.buyerPhone) ? `Tel.: ${filled(input.buyerPhone)}` : "",
    filled(input.buyerEmail) ? `E-mail: ${filled(input.buyerEmail)}` : "",
    filled(input.buyerIco) ? `IČO: ${filled(input.buyerIco)}` : "",
    filled(input.buyerDic) ? `DIČ: ${filled(input.buyerDic)}` : "",
  ].filter(Boolean);

  const supplierRows = [
    "REMAPPRO",
    "Janka Kráľa 29",
    "990 01 Veľký Krtíš, Slovakia",
    "IČO: 41281471",
    "DIČ: 1041196607",
    SUPPLIER_VAT_NOTE,
    "info@remappro.eu",
  ];

  const partiesY = ruleY + 6;
  const lineStep = 4.6;
  const partiesHeight = 12 + Math.max(supplierRows.length, buyerRows.length) * lineStep;
  doc.setFillColor(...WASH);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.3);
  doc.roundedRect(margin, partiesY, width, partiesHeight, 2, 2, "FD");
  doc.line(mid, partiesY + 2, mid, partiesY + partiesHeight - 2);

  const paintColumn = (title: string, rows: string[], x: number) => {
    doc.setFont("Roboto", "bold");
    doc.setFontSize(7.5);
    doc.setTextColor(...BLUE);
    doc.text(title, x, partiesY + 6);
    let cursor = partiesY + 12;
    rows.forEach((row, index) => {
      doc.setFont("Roboto", index === 0 ? "bold" : "normal");
      doc.setFontSize(index === 0 ? 10 : 8.5);
      doc.setTextColor(...INK);
      doc.text(row, x, cursor);
      cursor += lineStep;
    });
  };
  paintColumn("DODÁVATEĽ", supplierRows, margin + 4);
  paintColumn("ODBERATEĽ", buyerRows, mid + 4);

  const factsY = partiesY + partiesHeight + 5;
  const factsHeight = 22;
  doc.setFillColor(255, 255, 255);
  doc.roundedRect(margin, factsY, width, factsHeight, 2, 2, "FD");
  const fact = (label: string, value: string, x: number) => {
    doc.setFont("Roboto", "bold");
    doc.setFontSize(7);
    doc.setTextColor(...BLUE);
    doc.text(label, x, factsY + 6);
    doc.setFont("Roboto", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...INK);
    doc.text(value, x, factsY + 12);
  };
  fact("VARIABILNÝ SYMBOL", input.invoiceNumber, margin + 4);
  fact("FORMA ÚHRADY", "Uhradené kartou", margin + width * 0.36);
  fact("DÁTUM VYSTAVENIA", issuedLabel, margin + width * 0.68);

  const tableY = factsY + factsHeight + 6;
  const columns = [14, width - 14 - 24 - 34, 24, 34];
  doc.setFillColor(...WASH);
  doc.rect(margin, tableY, width, 8, "FD");
  doc.setFont("Roboto", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...BLUE);
  const heads = ["P.Č.", "NÁZOV POLOŽKY / SLUŽBY", "MNOŽSTVO", "CENA SPOLU"];
  let headX = margin + 2;
  heads.forEach((label, index) => {
    const align = index >= 2 ? "right" : "left";
    const textX = index >= 2 ? headX + columns[index] - 4 : headX;
    doc.text(label, textX, tableY + 5.2, { align });
    headX += columns[index];
  });

  const itemName = packageItemName(input.credits);
  doc.setFont("Roboto", "normal");
  doc.setFontSize(8);
  const descriptionWidth = columns[1] - 4;
  const descriptionText = filled(input.itemDescription) || PACKAGE_ITEM_DESCRIPTION;
  const description = doc.splitTextToSize(descriptionText, descriptionWidth) as string[];
  const rowHeight = 12 + description.length * 3.6;
  doc.setDrawColor(...LINE);
  doc.rect(margin, tableY + 8, width, rowHeight);
  doc.setFont("Roboto", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text("1.", margin + 4, tableY + 14);
  doc.text(itemName, margin + columns[0] + 2, tableY + 14);
  doc.setFont("Roboto", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...BLUE);
  doc.text(description, margin + columns[0] + 2, tableY + 19);
  doc.setFont("Roboto", "normal");
  doc.setFontSize(9);
  doc.setTextColor(...INK);
  doc.text("1 ks", margin + columns[0] + columns[1] + columns[2] - 2, tableY + 14, { align: "right" });
  doc.setFont("Roboto", "bold");
  doc.text(money(input.price), right - 2, tableY + 14, { align: "right" });

  const summaryY = tableY + 8 + rowHeight + 6;
  const summaryWidth = 78;
  doc.setFillColor(...WASH);
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.4);
  doc.roundedRect(right - summaryWidth, summaryY, summaryWidth, 16, 2, 2, "FD");
  doc.setFont("Roboto", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BLUE);
  doc.text("Celková suma na úhradu", right - summaryWidth + 3, summaryY + 6);
  doc.setFontSize(12);
  doc.setTextColor(...INK);
  doc.text(money(input.price), right - 3, summaryY + 12, { align: "right" });

  const note = [
    SUPPLIER_VAT_NOTE,
    `ID dobitia: ${input.topupId}`,
    filled(input.consentSummary),
  ].filter(Boolean).join(" ");
  doc.setFont("Roboto", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...BLUE);
  doc.text("Poznámka", margin, summaryY + 5);
  doc.setFont("Roboto", "normal");
  doc.setFontSize(8);
  doc.setTextColor(...INK);
  const noteLines = doc.splitTextToSize(note, width - summaryWidth - 6) as string[];
  doc.text(noteLines.slice(0, 8), margin, summaryY + 10);

  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 12;
  doc.setDrawColor(...BLUE);
  doc.setLineWidth(0.4);
  doc.line(margin, footerY - 4, right, footerY - 4);
  doc.setFont("Roboto", "normal");
  doc.setTextColor(...MUTED);
  let footerSize = 7.2;
  doc.setFontSize(footerSize);
  while (footerSize > 5.4 && doc.getTextWidth(INVOICE_FOOTER) > width) {
    footerSize -= 0.2;
    doc.setFontSize(footerSize);
  }
  doc.text(INVOICE_FOOTER, (margin + right) / 2, footerY, { align: "center" });

  const dataUri = doc.output("datauristring");
  const content = dataUri.includes(",") ? dataUri.split(",")[1] : "";
  const safeNumber = input.invoiceNumber.replace(/[^\w.-]+/g, "_");
  return { content, filename: `${safeNumber}.pdf` };
};
