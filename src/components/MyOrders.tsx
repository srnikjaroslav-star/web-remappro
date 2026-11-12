import { useEffect, useState } from 'react';
import { Download, Search, Send } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { SERVICES } from '@/data/services';
import { loadServiceCatalog, lookupServiceName } from '@/lib/serviceCatalog';
import { supabase } from '@/lib/supabase';

type ClientOrder = {
  id: string;
  order_number: string | null;
  created_at: string;
  car_brand: string | null;
  car_model: string | null;
  fuel_type: string | null;
  year: string | number | null;
  ecu_type: string | null;
  service_type: string | string[] | null;
  total_price: number | string | null;
  status: string;
  result_file_url: string | null;
  customer_note: string | null;
  customer_email: string | null;
};

const STATUS_KEY: Record<string, TranslationKey> = {
  pending: 'statusPending',
  processing: 'statusProcessing',
  completed: 'statusDone',
  cancelled: 'statusCancelled',
  paid: 'statusPaid',
};

const STATUS_CLASS: Record<string, string> = {
  pending: 'text-amber-300',
  processing: 'text-primary',
  completed: 'text-emerald-400',
  cancelled: 'text-red-400',
  paid: 'text-cyan-300',
};

const STATUS_FILTERS = ['all', 'pending', 'processing', 'completed'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const fold = (value: string) =>
  value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const orderLabel = (order: ClientOrder) => order.order_number || order.id.slice(0, 8).toUpperCase();

const matchesQuery = (order: ClientOrder, query: string) => {
  const needle = fold(query.trim().replace(/^#/, ''));
  if (!needle) return true;
  const brand = order.car_brand?.trim() ?? '';
  const model = order.car_model?.trim() ?? '';
  const haystack = fold([orderLabel(order), order.id, brand, model, `${brand} ${model}`].join(' '));
  return haystack.includes(needle);
};

const serviceLabel = (id: string) =>
  lookupServiceName(id) || SERVICES.find((service) => service.id === id)?.name || id;

const serviceNames = (value: ClientOrder['service_type']) => {
  if (!value) return '';
  if (Array.isArray(value)) return value.map(serviceLabel).filter(Boolean).join(', ');
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map((id) => serviceLabel(String(id))).filter(Boolean).join(', ');
  } catch {
    return value;
  }
  return value;
};

const engineLine = (note: string | null) => {
  const line = String(note ?? '').split('\n').map((part) => part.trim()).find(Boolean) ?? '';
  return line.startsWith('Motor:') ? line : '';
};

// Administrátor: prepíš TVOJE_TELEGRAM_USERNAME na svoje reálne Telegram meno, bez znaku @.
const TELEGRAM_SUPPORT_USERNAME = 'RemapproSupport';

const telegramSupportUrl = (order: ClientOrder) => {
  const label = order.order_number || order.id.slice(0, 8).toUpperCase();
  const brand = order.car_brand?.trim() ?? '';
  const model = order.car_model?.trim() ?? '';
  const vehicle = brand && model ? ` (${brand} ${model})` : '';
  const text = `Ahoj, mám otázku k objednávke #${label}${vehicle}`;
  return `https://t.me/${TELEGRAM_SUPPORT_USERNAME}?text=${encodeURIComponent(text)}`;
};

const money = (value: number | string | null) => {
  const amount = Number(value ?? 0);
  return `${amount.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
};

const MyOrders = ({ email }: { email: string }) => {
  const { t } = useLanguage();
  const [orders, setOrders] = useState<ClientOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const visibleOrders = orders.filter((order) =>
    (statusFilter === 'all' || order.status === statusFilter) && matchesQuery(order, query),
  );

  useEffect(() => {
    const address = email.trim();
    if (!address) {
      setOrders([]);
      setLoading(false);
      return;
    }
    let active = true;
    const load = async () => {
      setFailed(false);
      await loadServiceCatalog().catch(() => undefined);
      const { data, error } = await supabase
        .from('orders')
        .select('id, order_number, created_at, car_brand, car_model, fuel_type, year, ecu_type, service_type, total_price, status, result_file_url, customer_note, customer_email')
        .ilike('customer_email', address.replace(/[%_]/g, (char) => `\\${char}`))
        .order('created_at', { ascending: false });
      if (!active) return;
      if (error) {
        setFailed(true);
        setLoading(false);
        return;
      }
      const own = ((data ?? []) as ClientOrder[]).filter(
        (order) => String(order.customer_email ?? '').toLowerCase() === address.toLowerCase(),
      );
      setOrders(own);
      setLoading(false);
    };
    setLoading(true);
    load();
    const channel = supabase
      .channel(`my-orders-${address}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        load();
      })
      .subscribe();
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [email]);

  return (
    <div className="overflow-hidden rounded-xl border border-primary/25 bg-black/45 shadow-[0_0_30px_hsl(185_100%_50%/0.08)] backdrop-blur-xl">
      <div className="flex flex-col gap-3 border-b border-primary/30 bg-[#0a192f] px-4 py-3 lg:flex-row lg:items-center">
        <label className="relative block min-w-0 flex-1">
          <span className="sr-only">{t('myOrdersSearch')}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary/70" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('myOrdersSearch')}
            className="h-[42px] w-full rounded-md border border-primary/70 bg-transparent py-2 pl-9 pr-4 text-base leading-6 text-foreground shadow-[0_0_16px_rgba(0,242,255,0.28)] placeholder:text-muted-foreground transition-shadow hover:border-primary hover:shadow-[0_0_16px_rgba(0,242,255,0.45)] focus:border-primary focus:outline-none focus:shadow-[0_0_16px_rgba(0,242,255,0.45)]"
          />
        </label>
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('myOrdersStatus')}>
          {STATUS_FILTERS.map((filter) => {
            const active = statusFilter === filter;
            return (
              <button
                key={filter}
                type="button"
                aria-pressed={active}
                onClick={() => setStatusFilter(filter)}
                className={`inline-flex h-[42px] items-center rounded-md border px-3 text-sm font-bold uppercase tracking-wide transition-colors ${
                  active
                    ? 'border-primary bg-primary/20 text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)]'
                    : 'border-primary/35 bg-transparent text-slate-300 hover:border-primary/70 hover:text-primary'
                }`}
              >
                {filter === 'all' ? t('myOrdersFilterAll') : t(STATUS_KEY[filter])}
              </button>
            );
          })}
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-base">
          <thead>
            <tr className="border-b border-primary/30 bg-[#0a192f]">
              {[t('myOrdersDate'), t('myOrdersId'), t('myOrdersSpec'), t('myOrdersPrice'), t('myOrdersStatus'), t('myOrdersFile')].map((label) => (
                <th key={label} className="whitespace-nowrap border-r border-slate-500 p-2.5 text-left align-middle text-sm font-bold uppercase tracking-wide text-white last:text-center">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted-foreground">{t('myOrdersLoading')}</td>
              </tr>
            ) : failed ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-red-400">{t('myOrdersError')}</td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted-foreground">{t('myOrdersEmpty')}</td>
              </tr>
            ) : visibleOrders.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-muted-foreground">{t('myOrdersNoMatch')}</td>
              </tr>
            ) : visibleOrders.map((order) => {
              const vehicle = [order.car_brand, order.car_model].filter(Boolean).join(' ');
              const details = [order.year, order.fuel_type, order.ecu_type].filter(Boolean).join(' · ');
              const motor = engineLine(order.customer_note);
              const services = serviceNames(order.service_type);
              const cell = 'border-r border-slate-800/60 px-4 py-3 align-middle';
              return (
                <tr key={order.id} className="border-b border-slate-800/60 align-middle">
                  <td className={`${cell} whitespace-nowrap text-sm text-white`}>
                    {new Date(order.created_at).toLocaleString('sk-SK', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </td>
                  <td className={`${cell} whitespace-nowrap font-mono text-lg font-bold leading-none text-cyan-300`}>
                    {order.order_number || order.id.slice(0, 8).toUpperCase()}
                  </td>
                  <td className={`${cell} min-w-[18rem]`}>
                    <p className="text-base font-bold leading-none text-cyan-400">{vehicle || '—'}</p>
                    {(details || motor) && (
                      <p className="mt-1 text-xs leading-none text-white/80">{[details, motor].filter(Boolean).join(' · ')}</p>
                    )}
                    {services && <p className="mt-1.5 text-xs leading-snug text-primary/80">{services}</p>}
                  </td>
                  <td className={`${cell} whitespace-nowrap text-center`}>
                    <p className="text-xl font-bold leading-none text-primary">{money(order.total_price)}</p>
                  </td>
                  <td className={`${cell} whitespace-nowrap`}>
                    <span className="inline-flex items-center gap-3">
                      <span className={`text-sm font-bold uppercase tracking-wide ${STATUS_CLASS[order.status] || 'text-white'}`}>
                        {STATUS_KEY[order.status] ? t(STATUS_KEY[order.status]) : order.status}
                      </span>
                      <a
                        href={telegramSupportUrl(order)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-7 items-center gap-1.5 rounded-md border border-white/15 bg-transparent px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-300 transition-colors hover:border-[#2AABEE] hover:text-[#2AABEE] hover:shadow-[0_0_12px_rgba(42,171,238,0.35)]"
                      >
                        <Send className="h-3.5 w-3.5" />
                        {t('orderSupport')}
                      </a>
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center align-middle">
                    {order.status === 'completed' && order.result_file_url ? (
                      <a
                        href={order.result_file_url}
                        download
                        className="inline-flex h-9 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 text-xs font-bold uppercase tracking-wide text-primary transition-colors hover:bg-primary/20"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {t('downloadFile')}
                      </a>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {order.status === 'completed' ? t('filePending') : '—'}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

export default MyOrders;
