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

const loadDescriptions = async () => {
  const { data, error } = await supabase.from('service_details').select('service_id, description');
  const descriptions = new Map<string, string>();
  if (error || !Array.isArray(data)) return descriptions;
  for (const row of data) {
    const id = typeof row.service_id === 'string' ? row.service_id : '';
    if (id) descriptions.set(id, typeof row.description === 'string' ? row.description : '');
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
  const query = (source: SupabaseClient) =>
    source
      .from('services')
      .select('id,name,price,category')
      .order('category', { ascending: true })
      .order('name', { ascending: true });

  const primary = await query(supabase);
  if (!primary.error) return primary.data;
  const backup = await query(client());
  if (backup.error) throw backup.error;
  return backup.data;
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
  const channel = client()
    .channel('client-service-catalog')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'services' }, onChange)
    .subscribe();
  const details = supabase
    .channel('service-details-catalog')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'service_details' }, onChange)
    .subscribe();

  return () => {
    client().removeChannel(channel);
    supabase.removeChannel(details);
  };
};
