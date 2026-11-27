export type CreditPackage = {
  credits: number;
  price: number;
  discountPercent: number;
};

export const CREDIT_PACKAGES: readonly CreditPackage[] = [
  { credits: 25, price: 25, discountPercent: 0 },
  { credits: 50, price: 50, discountPercent: 0 },
  { credits: 100, price: 100, discountPercent: 0 },
  { credits: 300, price: 285, discountPercent: 5 },
  { credits: 500, price: 450, discountPercent: 10 },
  { credits: 1000, price: 850, discountPercent: 15 },
];

export const PACKAGE_ITEM_DESCRIPTION =
  "Predplatené kredity na čerpanie digitálnych služieb v B2B portáli REMAPPRO";

export const SUPPLIER_VAT_NOTE = "Dodávateľ nie je platiteľom DPH.";

export const INVOICE_SUBTITLE = "Automotive Electronics & Software Calibration";

export const INVOICE_FOOTER =
  "REMAPPRO | Janka Kráľa 29, 990 01 Veľký Krtíš, Slovakia | IČO: 41281471 | DIČ: 1041196607 | info@remappro.eu";

const groupedCredits = (credits: number) =>
  String(Math.round(credits)).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export const packageItemName = (credits: number) =>
  `Balík ${groupedCredits(credits)} kreditov REMAPPRO`;

export const creditPackageByCredits = (credits: number) =>
  CREDIT_PACKAGES.find((item) => item.credits === credits) ?? null;

export const creditPackageByPrice = (price: number) => {
  const cents = Math.round(price * 100);
  return CREDIT_PACKAGES.find((item) => Math.round(item.price * 100) === cents) ?? null;
};
