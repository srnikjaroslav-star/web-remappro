export type InvoiceSettings = {
  itemName: string;
  iban: string;
  swift: string;
  dueDays: number;
};

const CACHE_KEY = 'remappro-invoice-settings';

export const defaultInvoiceSettings = (): InvoiceSettings => ({
  itemName: 'Elektronická diagnostika a nastavenie systémov vozidla',
  iban: 'SK46 7500 0000 0040 2556 6439',
  swift: 'CEKOSKBX',
  dueDays: 14,
});

export const normalizeInvoiceSettings = (value: unknown): InvoiceSettings => {
  const fallback = defaultInvoiceSettings();
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const itemName = typeof record.itemName === 'string' ? record.itemName.trim() : '';
  const iban = typeof record.iban === 'string' ? record.iban.trim() : '';
  const swift = typeof record.swift === 'string' ? record.swift.trim() : '';
  const dueDays = Number(record.dueDays);
  return {
    itemName: itemName || fallback.itemName,
    iban: iban || fallback.iban,
    swift: swift || fallback.swift,
    dueDays: Number.isInteger(dueDays) && dueDays >= 1 && dueDays <= 365 ? dueDays : fallback.dueDays,
  };
};

type StoredInvoiceSettings = {
  settings: InvoiceSettings;
  savedAt: string;
};

const readCache = (): StoredInvoiceSettings | null => {
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed && typeof parsed.settings === 'object' && parsed.settings) {
      return {
        settings: normalizeInvoiceSettings(parsed.settings),
        savedAt: typeof parsed.savedAt === 'string' ? parsed.savedAt : '',
      };
    }
    return { settings: normalizeInvoiceSettings(parsed), savedAt: '' };
  } catch {
    return null;
  }
};

const writeCache = (settings: InvoiceSettings, savedAt: string): boolean => {
  try {
    const payload = JSON.stringify({ settings, savedAt } satisfies StoredInvoiceSettings);
    window.localStorage.setItem(CACHE_KEY, payload);
    return window.localStorage.getItem(CACHE_KEY) === payload;
  } catch {
    return false;
  }
};

export const peekInvoiceSettings = (): InvoiceSettings =>
  readCache()?.settings ?? defaultInvoiceSettings();

export const loadInvoiceSettings = async (): Promise<InvoiceSettings> => peekInvoiceSettings();

export const saveInvoiceSettings = async (settings: InvoiceSettings): Promise<boolean> => {
  const next = normalizeInvoiceSettings(settings);
  return writeCache(next, new Date().toISOString());
};
