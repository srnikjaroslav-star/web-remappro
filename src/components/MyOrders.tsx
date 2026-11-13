import { useEffect, useRef, useState } from 'react';
import { Download, Search, Send } from 'lucide-react';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { SERVICES } from '@/data/services';
import { loadServiceCatalog, lookupServiceName } from '@/lib/serviceCatalog';
import { orderFileLocation, RESULT_FILE_MARK, unpackOrderFile } from '@/lib/ecuFile';
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

type StoredClientOrder = ClientOrder & {
  user_id?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: string | number | null;
  engine?: string | null;
  ecu?: string | null;
  fuel?: string | null;
  services?: string[] | string | null;
  note?: string | null;
};

const toClientOrder = (row: StoredClientOrder): ClientOrder => {
  const note = String(row.note ?? '');
  const lines = note.split('\n');
  const tagged = lines[0]?.startsWith('RP-') ? lines[0].trim() : '';
  const engine = String(row.engine ?? '').trim();
  const model = String(row.car_model || row.vehicle_model || '').trim();
  const services = row.service_type ?? row.services ?? null;
  return {
    id: row.id,
    order_number: row.order_number || tagged || null,
    created_at: row.created_at,
    car_brand: row.car_brand || row.vehicle_brand || null,
    car_model: engine && !model.includes(engine) ? [model, engine].filter(Boolean).join(' ') : model || null,
    fuel_type: row.fuel_type || row.fuel || null,
    year: row.year || row.vehicle_year || null,
    ecu_type: row.ecu_type || row.ecu || null,
    service_type: services,
    total_price: row.total_price ?? null,
    status: row.status || 'pending',
    result_file_url: row.result_file_url ?? null,
    customer_note: row.customer_note || (tagged ? lines.slice(1).join('\n').trim() : note.trim()) || null,
    customer_email: row.customer_email ?? null,
  };
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const busy = useRef(false);
  const downloadResult = async (order: ClientOrder) => {
    let stored = order.result_file_url || '';
    if (!stored || stored === 'stored') {
      const { data } = await supabase.from('orders').select('file_url').eq('id', order.id).maybeSingle();
      stored = unpackOrderFile(data?.file_url || '').resultFile;
    } else {
      stored = unpackOrderFile(stored).resultFile || stored;
    }
    const located = orderFileLocation(stored);
    const href = located && 'href' in located
      ? located.href
      : located
        ? supabase.storage.from(located.bucket).getPublicUrl(located.path).data.publicUrl
        : '';
    if (!href) return;
    const response = await fetch(href);
    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = located && 'filename' in located ? located.filename : `result-${orderLabel(order)}`;
    document.body.appendChild(link);
    link.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(link);
  };

  const visibleOrders = orders.filter((order) =>
    (statusFilter === 'all' || order.status === statusFilter) && matchesQuery(order, query),
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (busy.current) return;
      busy.current = true;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const user = session?.user;
        if (!active) return;
        if (!user) {
          setOrders([]);
          setFailed(false);
          setLoading(false);
          return;
        }
        const catalogReady = loadServiceCatalog().catch(() => undefined);
        const columns = 'id, user_id, created_at, vehicle_brand, vehicle_model, vehicle_year, engine, ecu, fuel, services, total_price, status, note, result_file_url';
        let result = await supabase
          .from('orders')
          .select(columns)
          .eq('user_id', user.id)
          .order('created_at', { ascending: false });
        if (result.error) {
          result = await supabase
            .from('orders')
            .select('id, user_id, created_at, vehicle_brand, vehicle_model, vehicle_year, engine, ecu, fuel, services, total_price, status, note')
            .eq('user_id', user.id)
            .order('created_at', { ascending: false });
        }
        const { data, error } = result;
        await catalogReady;
        if (!active) return;
        if (error) {
          console.error('My orders load error:', error);
          setOrders([]);
          setFailed(false);
          setLoading(false);
          return;
        }
        const ready = await supabase
          .from('orders')
          .select('id')
          .eq('user_id', user.id)
          .like('file_url', `%${RESULT_FILE_MARK}%`);
        const withResult = new Set((ready.data || []).map((row) => row.id));
        const own = ((data ?? []) as StoredClientOrder[])
          .filter((order) => !order.user_id || order.user_id === user.id)
          .map((row) => toClientOrder({
            ...row,
            result_file_url: row.result_file_url || (withResult.has(row.id) ? 'stored' : null),
          }));
        setFailed(false);
        setOrders(own);
        setLoading(false);
      } finally {
        busy.current = false;
      }
    };
    setLoading(true);
    load();
    const timer = window.setInterval(load, 5000);
    const channel = supabase
      .channel(`my-orders-${email || 'session'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        load();
      })
      .subscribe();
    return () => {
      active = false;
      window.clearInterval(timer);
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
              const selected = selectedId === order.id;
              const picked = selected ? 'border-primary/45 bg-[#0b2430] shadow-[inset_0_0_18px_rgba(0,242,255,0.16)]' : '';
              const glow = `px-4 py-1.5 align-middle transition-[background-color,box-shadow,border-color] duration-200 ${picked}`;
              const cell = `border-r border-slate-800/60 ${glow}`;
              const action = 'inline-flex h-10 items-center gap-2 rounded-md px-3 text-sm font-bold uppercase tracking-wide transition-colors';
              return (
                <tr
                  key={order.id}
                  onClick={() => setSelectedId(order.id)}
                  aria-selected={selected}
                  className={`cursor-pointer border-b border-slate-800/60 align-middle ${selected ? 'border-primary/50' : ''}`}
                >
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
                        onClick={(event) => event.stopPropagation()}
                        className={`${action} border border-primary/40 bg-primary/10 text-primary hover:border-primary/70 hover:bg-primary/20 hover:shadow-[0_0_12px_rgba(0,242,255,0.28)]`}
                      >
                        <Send className="h-4 w-4" />
                        {t('orderSupport')}
                      </a>
                    </span>
                  </td>
                  <td className={`${glow} text-center`}>
                    {order.status === 'completed' && order.result_file_url ? (
                      <a
                        href={order.result_file_url.startsWith('http') || order.result_file_url.startsWith('data:') ? order.result_file_url : '#'}
                        download
                        onClick={(event) => {
                          if (order.result_file_url?.startsWith('http') || order.result_file_url?.startsWith('data:')) return;
                          event.preventDefault();
                          void downloadResult(order);
                        }}
                        className={`${action} border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20`}
                      >
                        <Download className="h-4 w-4" />
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
