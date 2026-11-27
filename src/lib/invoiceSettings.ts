import { PACKAGE_ITEM_DESCRIPTION } from '@/lib/creditPackages';
import { supabase } from '@/integrations/supabase/client';

export type InvoiceSettings = {
  supplierName: string;
  supplierAddress: string;
  supplierIco: string;
  supplierDic: string;
  supplierRegister: string;
  vatNote: string;
  itemName: string;
  itemDescription: string;
  iban: string;
  swift: string;
  dueDays: number;
};

const CACHE_KEY = 'remappro-invoice-settings';
const INVOICE_SETTINGS_KEY = 'invoice';

export const defaultInvoiceSettings = (): InvoiceSettings => ({
  supplierName: 'REMAPPRO',
  supplierAddress: 'J.Kráľa 2683/29, 990 01 Veľký Krtíš',
  supplierIco: '41281471',
  supplierDic: '1041196607',
  supplierRegister: 'Živnostenský register Okresného úradu Veľký Krtíš, č. ŽR: 660-5049',
  vatNote: 'Dodávateľ nie je platiteľom DPH.',
  itemName: 'Elektronická diagnostika a nastavenie systémov vozidla',
  itemDescription: PACKAGE_ITEM_DESCRIPTION,
  iban: 'SK46 7500 0000 0040 2556 6439',
  swift: 'CEKOSKBX',
  dueDays: 0,
});

export const normalizeInvoiceSettings = (value: unknown): InvoiceSettings => {
  const fallback = defaultInvoiceSettings();
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const text = (key: string, fallbackValue: string) => {
    const value = typeof record[key] === 'string' ? record[key].trim() : '';
    return value || fallbackValue;
  };
  return {
    supplierName: text('supplierName', fallback.supplierName),
    supplierAddress: text('supplierAddress', fallback.supplierAddress),
    supplierIco: text('supplierIco', fallback.supplierIco),
    supplierDic: text('supplierDic', fallback.supplierDic),
    supplierRegister: text('supplierRegister', fallback.supplierRegister),
    vatNote: text('vatNote', fallback.vatNote),
    itemName: text('itemName', fallback.itemName),
    itemDescription: text('itemDescription', fallback.itemDescription),
    iban: text('iban', fallback.iban),
    swift: text('swift', fallback.swift),
    dueDays: 0,
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

const invoiceRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const readStoredItemDescription = async (): Promise<string> => {
  const { data, error } = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', INVOICE_SETTINGS_KEY)
    .maybeSingle();
  if (error) return '';
  const description = invoiceRecord(data?.value).itemDescription;
  return typeof description === 'string' ? description.trim() : '';
};

const persistItemDescription = async (itemDescription: string): Promise<boolean> => {
  const existing = await supabase
    .from('system_settings')
    .select('value')
    .eq('key', INVOICE_SETTINGS_KEY)
    .maybeSingle();
  if (existing.error) return false;
  const { error } = await supabase.from('system_settings').upsert({
    key: INVOICE_SETTINGS_KEY,
    value: { ...invoiceRecord(existing.data?.value), itemDescription },
    updated_at: new Date().toISOString(),
  }, { onConflict: 'key' });
  return !error;
};

export const loadInvoiceSettings = async (): Promise<InvoiceSettings> => {
  const local = peekInvoiceSettings();
  try {
    const itemDescription = await readStoredItemDescription();
    if (!itemDescription) return local;
    const next = normalizeInvoiceSettings({ ...local, itemDescription });
    writeCache(next, new Date().toISOString());
    return next;
  } catch {
    return local;
  }
};

export const saveInvoiceSettings = async (settings: InvoiceSettings): Promise<boolean> => {
  const next = normalizeInvoiceSettings(settings);
  if (!writeCache(next, new Date().toISOString())) return false;
  try {
    return await persistItemDescription(next.itemDescription);
  } catch {
    return false;
  }
};
