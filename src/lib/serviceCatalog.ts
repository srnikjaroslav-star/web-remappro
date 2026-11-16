import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { TranslationKey } from '@/i18n/translations';
import { supabase } from '@/lib/supabase';

const CATALOG_URL =
  import.meta.env.VITE_CATALOG_SUPABASE_URL || 'https://huswisewblkfcozdgvrq.supabase.co';
const CATALOG_KEY =
  import.meta.env.VITE_CATALOG_SUPABASE_ANON_KEY ||
  'sb_publishable_LM2MhZV7ROsdMSZQb9_wpA_9ZOXOIlZ';

export type CatalogService = {
  id: string;
  name: string;
  price: number;
  category: string;
  description: string;
};

const CATEGORY_ORDER = ['Emission Control', 'Engine Functions', 'Performance', 'Security'];

export const catalogCategories = [...CATEGORY_ORDER];

const CATEGORY_HINTS: Record<string, TranslationKey> = {
  'Emission Control': 'catEmissionHint',
  'Engine Functions': 'catEngineHint',
  Performance: 'catPerformanceHint',
  Security: 'catSecurityHint',
};

const namesById = new Map<string, string>();

let catalogClient: SupabaseClient | null = null;

const client = () => {
  if (!catalogClient) {
    catalogClient = createClient(CATALOG_URL, CATALOG_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return catalogClient;
};

const rememberNames = (services: CatalogService[]) => {
  namesById.clear();
  for (const service of services) namesById.set(service.id, service.name);
};

export const lookupServiceName = (id: string) => namesById.get(id);

export const categoryHint = (category: string) => CATEGORY_HINTS[category];

export const formatServicePrice = (price: number) =>
  Number.isInteger(price) ? String(price) : price.toFixed(2);

const normalize = (rows: unknown): CatalogService[] => {
  if (!Array.isArray(rows)) return [];
  const unique = new Map<string, CatalogService>();
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const record = row as { id?: unknown; name?: unknown; price?: unknown; category?: unknown };
    const id = typeof record.id === 'string' ? record.id : '';
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const category = typeof record.category === 'string' ? record.category.trim() : '';
    const price = typeof record.price === 'number' ? record.price : Number(record.price);
    if (!id || !name || !category || !Number.isFinite(price) || unique.has(id)) continue;
    unique.set(id, { id, name, price, category, description: '' });
  }
  return [...unique.values()];
};

const CATALOG_STAMP = 'remappro-service-catalog-stamp';

type LiveClient = SupabaseClient & { supabaseUrl: string; supabaseKey: string };

const freshSelect = async (source: SupabaseClient, table: string, select: string, order?: string[]) => {
  const live = source as LiveClient;
  const url = new URL(`${live.supabaseUrl.replace(/\/$/, '')}/rest/v1/${table}`);
  url.searchParams.set('select', select);
  for (const column of order ?? []) url.searchParams.append('order', column);
  const response = await fetch(url, {
    method: 'GET',
    cache: 'no-store',
    headers: {
      apikey: live.supabaseKey,
      Authorization: `Bearer ${live.supabaseKey}`,
      Accept: 'application/json',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json();
};

const loadDescriptions = async () => {
  const descriptions = new Map<string, string>();
  try {
    const data = await freshSelect(supabase, 'service_details', 'service_id,description');
    if (!Array.isArray(data)) return descriptions;
    for (const row of data) {
      if (!row || typeof row !== 'object') continue;
      const record = row as { service_id?: unknown; description?: unknown };
      const id = typeof record.service_id === 'string' ? record.service_id : '';
      if (id) descriptions.set(id, typeof record.description === 'string' ? record.description : '');
    }
  } catch {
    return descriptions;
  }
  return descriptions;
};

export const groupCatalog = (services: CatalogService[]) => {
  const grouped = new Map<string, CatalogService[]>();
  for (const service of services) {
    const items = grouped.get(service.category) ?? [];
    items.push(service);
    grouped.set(service.category, items);
  }

  const ordered = [
    ...CATEGORY_ORDER.filter((category) => grouped.has(category)),
    ...[...grouped.keys()].filter((category) => !CATEGORY_ORDER.includes(category)).sort(),
  ];

  return ordered.map((category) => ({
    category,
    items: grouped.get(category)!.slice().sort((a, b) => a.name.localeCompare(b.name, 'sk')),
  }));
};

const readServices = async () => {
  try {
    return await freshSelect(supabase, 'services', 'id,name,price,category', ['category.asc', 'name.asc']);
  } catch (primaryError) {
    try {
      return await freshSelect(client(), 'services', 'id,name,price,category', ['category.asc', 'name.asc']);
    } catch {
      throw primaryError;
    }
  }
};

export const notifyServiceCatalogChanged = () => {
  try {
    localStorage.setItem(CATALOG_STAMP, String(Date.now()));
  } catch {
    // Another open tab still receives realtime updates when storage is blocked.
  }
};

export const loadServiceCatalog = async (): Promise<CatalogService[]> => {
  const data = await readServices();
  const descriptions = await loadDescriptions();
  const services = normalize(data).map((service) => ({
    ...service,
    description: descriptions.get(service.id) ?? '',
  }));
  rememberNames(services);
  return services;
};

export const subscribeServiceCatalog = (onChange: () => void) => {
  const id = Math.random().toString(36).slice(2);
  const listen = (source: SupabaseClient, table: 'services' | 'service_details', name: string) =>
    source
      .channel(name)
      .on('postgres_changes', { event: '*', schema: 'public', table }, onChange)
      .subscribe();

  const services = listen(supabase, 'services', `services-${id}`);
  const details = listen(supabase, 'service_details', `service-details-${id}`);
  const primaryUrl = (supabase as LiveClient).supabaseUrl?.replace(/\/$/, '');
  const backup = primaryUrl && primaryUrl !== CATALOG_URL.replace(/\/$/, '')
    ? listen(client(), 'services', `services-backup-${id}`)
    : null;
  const onStorage = (event: StorageEvent) => {
    if (event.key === CATALOG_STAMP) onChange();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    window.removeEventListener('storage', onStorage);
    supabase.removeChannel(services);
    supabase.removeChannel(details);
    if (backup) client().removeChannel(backup);
  };
};
