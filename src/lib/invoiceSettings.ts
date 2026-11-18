import { supabase } from '@/lib/supabase';

export type InvoiceSettings = {
  itemName: string;
  iban: string;
  swift: string;
  dueDays: number;
};

const SETTINGS_KEY = 'invoice';
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

const withTimeout = async <T>(promise: PromiseLike<T>, ms = 8000): Promise<T> => {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error('timeout')), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
};

type StoredInvoiceSettings = {
  settings: InvoiceSettings;
  savedAt: string;
};

const savedAtMs = (value: string) => {
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : 0;
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

export const loadInvoiceSettings = async (): Promise<InvoiceSettings> => {
  const cached = readCache();
  try {
    const { data, error } = await withTimeout(supabase
      .from('system_settings')
      .select('value, updated_at')
      .eq('key', SETTINGS_KEY)
      .maybeSingle());
    if (!error && data?.value) {
      const remoteUpdated = typeof data.updated_at === 'string' ? data.updated_at : '';
      if (cached && savedAtMs(cached.savedAt) > savedAtMs(remoteUpdated)) {
        return cached.settings;
      }
      const settings = normalizeInvoiceSettings(data.value);
      writeCache(settings, remoteUpdated || new Date().toISOString());
      return settings;
    }
  } catch {
    // Use the last saved copy when the settings table cannot be read.
  }
  return cached?.settings ?? defaultInvoiceSettings();
};

export const saveInvoiceSettings = async (settings: InvoiceSettings): Promise<boolean> => {
  const next = normalizeInvoiceSettings(settings);
  const savedAt = new Date().toISOString();
  let remoteOk = false;
  try {
    const { error } = await withTimeout(supabase
      .from('system_settings')
      .upsert({
        key: SETTINGS_KEY,
        value: next,
        updated_at: savedAt,
      }, { onConflict: 'key' }));
    remoteOk = !error;
  } catch {
    remoteOk = false;
  }
  const localOk = writeCache(next, savedAt);
  return remoteOk || localOk;
};
