import { useEffect, useRef, useState } from 'react';
import { Download, FileText, Search, Send } from 'lucide-react';
import { toast } from 'sonner';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import { SERVICES } from '@/data/services';
import { loadServiceCatalog, lookupServiceName } from '@/lib/serviceCatalog';
import { fetchBlobWithProgress, lightFileRef, loadOrderFile, orderFileLocation } from '@/lib/ecuFile';
import { downloadOrderCreditNote, downloadOrderInvoice } from '@/lib/accountingDocument';
import { readCreditNoteMark, readInvoiceMark } from '@/lib/orderInvoice';
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
  result_file_name?: string | null;
  invoice_number: string | null;
  invoice_url: string | null;
  credit_note_number: string | null;
  credit_note_url: string | null;
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

const STATUS_FILTERS = ['all', 'pending', 'processing', 'completed', 'cancelled'] as const;
type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_COLOR: Record<StatusFilter, string> = {
  all: '#00eaff',
  pending: '#facc15',
  processing: '#06b6d4',
  completed: '#22c55e',
  cancelled: '#ef4444',
};

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
  client_file_name?: string | null;
  client_file_path?: string | null;
  result_file_name?: string | null;
  result_file_path?: string | null;
};

const toClientOrder = (row: StoredClientOrder): ClientOrder => {
  const rawNote = String(row.note ?? '');
  const marked = readInvoiceMark(rawNote);
  const credit = readCreditNoteMark(rawNote);
  const note = marked.note;
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
    result_file_url: lightFileRef(row.result_file_path, row.result_file_name)
      ?? lightFileRef(row.result_file_url, row.result_file_url ? 'file' : null),
    result_file_name: row.result_file_name ?? null,
    invoice_number: row.invoice_number || marked.invoice_number || null,
    invoice_url: row.invoice_url || marked.invoice_url || null,
    credit_note_number: credit.credit_note_number,
    credit_note_url: credit.credit_note_url,
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
  return `tg://resolve?domain=${TELEGRAM_SUPPORT_USERNAME}&text=${encodeURIComponent(text)}`;
};

const money = (value: number | string | null) => {
  const amount = Number(value ?? 0);
  return `${amount.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
};

const matchesFocus = (order: ClientOrder, focus: string) => {
  const key = focus.trim().toLowerCase();
  if (!key) return false;
  const label = orderLabel(order).toLowerCase();
  const id = order.id.toLowerCase();
  return label === key || id === key || id.startsWith(key);
};

const ordersCache = new Map<string, ClientOrder[]>();

const MyOrders = ({ email, focusOrder = '' }: { email: string; focusOrder?: string }) => {
  const { t } = useLanguage();
  const cachedOrders = ordersCache.get(email);
  const [orders, setOrders] = useState<ClientOrder[]>(cachedOrders ?? []);
  const [loading, setLoading] = useState(cachedOrders === undefined);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [downloadProgress, setDownloadProgress] = useState<Record<string, number>>({});
  const busy = useRef(false);
  const focusedKey = useRef('');
  const rowRefs = useRef<Record<string, HTMLTableRowElement | null>>({});
  const downloadGen = useRef<Record<string, number>>({});
  const downloadLock = useRef(new Set<string>());
  const downloadResult = async (order: ClientOrder) => {
    if (downloadLock.current.has(order.id)) return;
    downloadLock.current.add(order.id);
    const generation = (downloadGen.current[order.id] ?? 0) + 1;
    downloadGen.current[order.id] = generation;
    const report = (percent: number) => {
      if (downloadGen.current[order.id] !== generation) return;
      setDownloadProgress((current) => ({ ...current, [order.id]: percent }));
    };
    setDownloadProgress((current) => ({ ...current, [order.id]: 0 }));
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 600000);
    try {
      const stored = await loadOrderFile(order.id, 'result', order.result_file_url);
      const located = stored ? orderFileLocation(stored) : null;
      const filename = order.result_file_name
        || (located && 'filename' in located ? located.filename : '')
        || `result-${orderLabel(order)}`;
      let href = located && 'href' in located ? located.href : '';
      if (!href && located && 'bucket' in located && located.bucket && located.path) {
        const signed = await supabase.storage.from(located.bucket).createSignedUrl(located.path, 180);
        href = signed.data?.signedUrl
          || supabase.storage.from(located.bucket).getPublicUrl(located.path).data.publicUrl;
      }
      if (!href) throw new Error('missing file');
      const blob = await fetchBlobWithProgress(href, report, controller.signal);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
    } catch (error) {
      console.error('Result download error:', error);
      toast.error(t('fileDownloadFailed'));
    } finally {
      window.clearTimeout(timer);
      downloadLock.current.delete(order.id);
      if (downloadGen.current[order.id] === generation) {
        setDownloadProgress((current) => {
          const next = { ...current };
          delete next[order.id];
          return next;
        });
      }
    }
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
        const listBase = 'id, user_id, created_at, vehicle_brand, vehicle_model, vehicle_year, engine, ecu, fuel, services, total_price, status, note';
        const [listed] = await Promise.all([
          supabase.from('orders').select(listBase).eq('user_id', user.id).order('created_at', { ascending: false }),
          loadServiceCatalog().catch(() => undefined),
        ]);
        if (!active) return;
        if (listed.error) {
          console.error('My orders load error:', listed.error);
          if (!ordersCache.has(email)) setOrders([]);
          setFailed(false);
          setLoading(false);
          return;
        }
        const own = ((listed.data ?? []) as StoredClientOrder[])
          .filter((order) => !order.user_id || order.user_id === user.id)
          .map((row) => toClientOrder({
            ...row,
            result_file_url: row.status === 'completed' ? 'stored' : null,
          }));
        ordersCache.set(email, own);
        setFailed(false);
        setOrders(own);
        setLoading(false);
      } finally {
        busy.current = false;
      }
    };
    if (!ordersCache.has(email)) setLoading(true);
    else {
      setOrders(ordersCache.get(email) ?? []);
      setLoading(false);
    }
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

  useEffect(() => {
    const key = focusOrder.trim();
    if (!key || loading || focusedKey.current === key) return;
    const match = orders.find((order) => matchesFocus(order, key));
    if (!match) return;
    focusedKey.current = key;
    setStatusFilter('all');
    setQuery(orderLabel(match));
    setSelectedId(match.id);
    window.requestAnimationFrame(() => {
      rowRefs.current[match.id]?.scrollIntoView({ block: 'center' });
    });
  }, [focusOrder, orders, loading]);

  const focusedOrder = orders.find((order) => order.id === selectedId && matchesFocus(order, focusOrder)) || null;

  return (
    <div className="flex max-h-[calc(100vh-12.5625rem)] min-h-0 flex-col overflow-hidden rounded-xl border border-primary/25 bg-black/45 shadow-[0_0_30px_hsl(185_100%_50%/0.08)] backdrop-blur-xl">
      <div className="flex shrink-0 flex-col gap-3 border-b border-primary/30 bg-[#0a192f] px-4 py-3 sm:flex-row sm:items-center sm:justify-end">
        <label className="relative block w-full min-w-0 max-w-md shrink-0 sm:w-[28rem]">
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
        <select
          value={statusFilter}
          aria-label={t('myOrdersStatus')}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          className="admin-filter-select h-[42px] w-44 shrink-0 !rounded-lg !border !border-primary !bg-primary/25 px-4 py-2 text-left !text-base font-semibold shadow-[0_0_18px_rgba(0,242,255,0.55)] transition-shadow hover:!border-primary hover:!bg-primary/35 hover:shadow-[0_0_22px_rgba(0,242,255,0.7)] focus:outline-none"
          style={{ color: FILTER_COLOR[statusFilter] }}
        >
          {STATUS_FILTERS.map((filter) => (
            <option key={filter} value={filter} style={{ color: FILTER_COLOR[filter], backgroundColor: '#050505', fontSize: '16px' }}>
              {filter === 'all' ? t('myOrdersFilterAll') : t(STATUS_KEY[filter])}
            </option>
          ))}
        </select>
      </div>
      {focusedOrder?.status === 'completed' && focusedOrder.result_file_url ? (
        <div className="flex shrink-0 flex-col gap-3 border-b border-primary/30 bg-[#071820] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="font-mono text-lg font-bold text-cyan-300">{orderLabel(focusedOrder)}</p>
          <button
            type="button"
            disabled={downloadProgress[focusedOrder.id] !== undefined}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={downloadProgress[focusedOrder.id]}
            onClick={() => void downloadResult(focusedOrder)}
            className={`relative inline-flex h-11 items-center justify-center gap-2 overflow-hidden rounded-md border border-primary bg-primary/20 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)] hover:bg-primary/30 ${downloadProgress[focusedOrder.id] !== undefined ? 'cursor-wait' : ''}`}
          >
            {downloadProgress[focusedOrder.id] !== undefined && (
              <span
                className="absolute inset-y-0 left-0 bg-primary/30 transition-[width] duration-150"
                style={{ width: `${downloadProgress[focusedOrder.id]}%` }}
              />
            )}
            <span className="relative inline-flex items-center gap-2 tabular-nums">
              {downloadProgress[focusedOrder.id] !== undefined ? `${downloadProgress[focusedOrder.id]}%` : (
                <>
                  <Download className="h-4 w-4" />
                  {t('downloadFile')}
                </>
              )}
            </span>
          </button>
        </div>
      ) : null}
      <div className="min-h-0 max-h-[calc(100vh-16.75rem)] flex-1 overflow-x-auto overflow-y-auto">
        <table className="w-full border-separate border-spacing-0 text-base">
          <thead>
            <tr className="border-b border-primary/30 bg-[#0a192f]">
              {[t('myOrdersDate'), t('myOrdersId'), t('myOrdersSpec'), t('myOrdersPrice'), t('myOrdersStatus'), t('myOrdersFile'), t('myOrdersInvoice')].map((label) => (
                <th key={label} className={`sticky top-0 z-20 whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-2.5 align-middle text-sm font-bold uppercase tracking-wide text-white ${label === t('myOrdersFile') || label === t('myOrdersInvoice') ? 'text-center' : 'text-left'}`}>
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">{t('myOrdersLoading')}</td>
              </tr>
            ) : failed ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-red-400">{t('myOrdersError')}</td>
              </tr>
            ) : orders.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">{t('myOrdersEmpty')}</td>
              </tr>
            ) : visibleOrders.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-12 text-center text-muted-foreground">{t('myOrdersNoMatch')}</td>
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
                  ref={(node) => {
                    rowRefs.current[order.id] = node;
                  }}
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
                    <div className="flex items-center justify-between gap-3">
                      <span className={`text-sm font-bold uppercase tracking-wide ${STATUS_CLASS[order.status] || 'text-white'}`}>
                        {STATUS_KEY[order.status] ? t(STATUS_KEY[order.status]) : order.status}
                      </span>
                      <a
                        href={telegramSupportUrl(order)}
                        onClick={(event) => event.stopPropagation()}
                        className={`${action} shrink-0 border border-primary/40 bg-primary/10 text-primary hover:border-primary/70 hover:bg-primary/20 hover:shadow-[0_0_12px_rgba(0,242,255,0.28)]`}
                      >
                        <Send className="h-4 w-4" />
                        {t('orderSupport')}
                      </a>
                    </div>
                  </td>
                  <td className={`${glow} text-center`}>
                    {order.status === 'completed' && order.result_file_url ? (
                      <button
                        type="button"
                        disabled={downloadProgress[order.id] !== undefined}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={downloadProgress[order.id]}
                        title={downloadProgress[order.id] !== undefined ? `${downloadProgress[order.id]} %` : order.result_file_name || t('downloadFile')}
                        onClick={(event) => {
                          event.stopPropagation();
                          void downloadResult(order);
                        }}
                        className={`${action} relative overflow-hidden border border-primary/40 bg-primary/10 text-primary hover:bg-primary/20 ${downloadProgress[order.id] !== undefined ? 'cursor-wait' : ''}`}
                      >
                        {downloadProgress[order.id] !== undefined && (
                          <span
                            className="absolute inset-y-0 left-0 bg-primary/30 transition-[width] duration-150"
                            style={{ width: `${downloadProgress[order.id]}%` }}
                          />
                        )}
                        <span className="relative inline-flex items-center gap-2 tabular-nums">
                          {downloadProgress[order.id] !== undefined ? `${downloadProgress[order.id]}%` : (
                            <>
                              <Download className="h-4 w-4" />
                              {t('downloadFile')}
                            </>
                          )}
                        </span>
                      </button>
                    ) : (
                      <span className="text-xs text-slate-500">
                        {order.status === 'completed' ? t('filePending') : '—'}
                      </span>
                    )}
                  </td>
                  <td className={`${glow} overflow-visible align-top text-center`}>
                    {order.invoice_number || order.invoice_url || order.credit_note_number ? (
                      <div className="flex flex-col items-center gap-1 overflow-visible py-1">
                        {order.invoice_url || order.invoice_number ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!order.invoice_url) {
                                toast.error(t('invoiceDownloadFailed'));
                                return;
                              }
                              void downloadOrderInvoice(order.id, { customerEmail: email }).catch(() => {
                                toast.error(t('invoiceDownloadFailed'));
                              });
                            }}
                            className="max-w-full truncate font-mono text-xs font-bold leading-tight text-primary underline hover:text-cyan-200"
                            title={order.invoice_number || t('downloadFile')}
                          >
                            {order.invoice_number || t('downloadFile')}
                          </button>
                        ) : null}
                        {order.credit_note_number ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              if (!order.credit_note_url) {
                                toast.error(t('invoiceDownloadFailed'));
                                return;
                              }
                              void downloadOrderCreditNote(order.id, { customerEmail: email }).catch(() => {
                                toast.error(t('invoiceDownloadFailed'));
                              });
                            }}
                            className="max-w-full truncate font-mono text-xs font-bold leading-tight text-red-400 underline hover:text-red-300"
                            title={order.credit_note_number}
                          >
                            {order.credit_note_number}
                          </button>
                        ) : null}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">—</span>
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
