export type DocumentKind = 'invoice' | 'credit';

const SERIES_WIDTH = 4;
const SERIES_LIMIT = 9999;

export const documentCalendarYear = (issued = new Date()) => {
  const year = Number(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bratislava',
    year: 'numeric',
  }).format(issued));
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error('Číslo dokladu sa nepodarilo priradiť.');
  }
  return year;
};

export const documentPrefix = (kind: DocumentKind, year: number) => {
  const full = String(year);
  if (!/^\d{4}$/.test(full)) throw new Error('Číslo dokladu sa nepodarilo priradiť.');
  // Invoice YYYYNNNN. Credit note: 9 + the last three digits of the year + NNNN.
  return kind === 'invoice' ? full : `9${full.slice(1)}`;
};

export const formatDocumentNumber = (kind: DocumentKind, year: number, serial: number) => {
  if (!Number.isInteger(serial) || serial < 1 || serial > SERIES_LIMIT) {
    throw new Error('Číselný rad dokladov pre tento rok je vyčerpaný.');
  }
  return `${documentPrefix(kind, year)}${String(serial).padStart(SERIES_WIDTH, '0')}`;
};

export const serialOfDocument = (kind: DocumentKind, year: number, value: string) => {
  const prefix = documentPrefix(kind, year);
  const number = value.trim();
  if (number.length !== prefix.length + SERIES_WIDTH || !number.startsWith(prefix)) return 0;
  const tail = number.slice(prefix.length);
  return /^\d{4}$/.test(tail) ? Number(tail) : 0;
};

export const nextDocumentSerial = (used: string[], kind: DocumentKind, year: number) => {
  const taken = new Set<number>();
  for (const value of used) {
    const serial = serialOfDocument(kind, year, value);
    if (serial > 0) taken.add(serial);
  }
  for (let serial = 1; serial <= SERIES_LIMIT; serial += 1) {
    if (!taken.has(serial)) return formatDocumentNumber(kind, year, serial);
  }
  throw new Error('Číselný rad dokladov pre tento rok je vyčerpaný.');
};
