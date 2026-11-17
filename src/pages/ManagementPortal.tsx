import { useState, useEffect, useRef } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { 
  Download, Upload, Eye, CheckCircle, CalendarDays, ChevronLeft, ChevronRight,
  Search, Power, Save, Trash2, LogOut, FileText, X
} from 'lucide-react';
import { DayPicker } from 'react-day-picker';
import { sk } from 'date-fns/locale';
import SystemStatus, { fetchSystemStatusFromDB, setSystemStatusInDB, isSystemOnline, SystemStatusMode } from '@/components/SystemStatus';
import NavLogo from '@/components/NavLogo';
import SmartTooltip from '@/components/SmartTooltip';
import InternalNoteModal from '@/components/InternalNoteModal';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useOnlineClients } from '@/lib/clientPresence';
import { orderFileLocation, packOrderFile, RESULT_FILE_MARK, unpackOrderFile, uploadOrderFile } from '@/lib/ecuFile';
import { downloadStoredInvoice, exportInvoiceArchive, invoiceLinksFor, mergeInvoice, readInvoiceMark, saveOrderInvoice } from '@/lib/orderInvoice';
import { supabase } from '@/lib/supabase';
import { statusAfterResultDelivery } from '@/lib/orderStatus';
import { Order, ActivityLog, SUPABASE_ANON_KEY, SUPABASE_URL } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { SERVICES } from '@/data/services';
import { mailLanguageForClient } from '@/lib/clientLanguage';
import { loadBillingByUserId, loadClientBilling, orderDisplayName, readCreditBalance, restoreClientCredits, saveCreditBalance, settleClientCredits } from '@/lib/clientProfile';
import { generateInvoicePdf } from '@/utils/invoiceGenerator';
import { loadServiceCatalog, lookupServiceName } from '@/lib/serviceCatalog';
import ClientCredits from '@/components/ClientCredits';
import AdminServices from '@/components/AdminServices';
import OpeningHours from '@/components/OpeningHours';

type RevenueOrder = { status?: string; total_price?: number | string | null; created_at?: string | null };

const pricedAmount = (order: RevenueOrder) => {
  if (order.status === 'cancelled') return 0;
  const rawPrice = typeof order.total_price === 'string'
    ? parseFloat(order.total_price)
    : Number(order.total_price || 0);
  if (!Number.isFinite(rawPrice) || rawPrice === 0) return 0;
  return Math.abs(rawPrice);
};

const orderRevenue = (rows: RevenueOrder[]) => rows.reduce((sum, order) => sum + pricedAmount(order), 0);

const isCreatedToday = (createdAt?: string | null, now = new Date()) => {
  if (!createdAt) return false;
  const created = new Date(createdAt);
  if (Number.isNaN(created.getTime())) return false;
  return created.getFullYear() === now.getFullYear()
    && created.getMonth() === now.getMonth()
    && created.getDate() === now.getDate();
};

const todayOrderRevenue = (rows: RevenueOrder[], now = new Date()) => (
  rows.reduce((sum, order) => sum + (isCreatedToday(order.created_at, now) ? pricedAmount(order) : 0), 0)
);

type BillableOrder = {
  user_id?: string | null;
  total_price?: number | string | null;
  invoice_number?: string | null;
  result_file_url?: string | null;
  file_url?: string | null;
};

const repeatWorkCompletion = (order: BillableOrder, storedFileUrl?: string) => {
  const source = storedFileUrl ?? (order.file_url && order.file_url !== 'stored' ? order.file_url : '');
  if (unpackOrderFile(source).resultFile) return true;
  if (storedFileUrl !== undefined) return false;
  return order.result_file_url === 'stored' || Boolean(order.result_file_url && order.result_file_url !== 'stored');
};

const clientIdOf = (order: object | null | undefined) => {
  if (!order || !('user_id' in order)) return '';
  const id = String((order as { user_id?: string | null }).user_id || '').trim();
  return /^[0-9a-f-]{36}$/i.test(id) ? id : '';
};

const chargeRepeatCompletion = async (order: BillableOrder) => {
  const price = Math.round(Math.abs(Number(order.total_price) || 0) * 100) / 100;
  if (price <= 0) return { ok: true, charged: false, price: 0 };
  const settled = await settleClientCredits(clientIdOf(order), price);
  if (settled.ok) return { ok: true, charged: true, price };
  toast.error(
    settled.code === 'insufficient'
      ? 'Na kredite klienta nie je dosť prostriedkov. Dokončenie bolo zastavené.'
      : 'Kredity sa nepodarilo strhnúť. Dokončenie bolo zastavené.',
  );
  return { ok: false, charged: false, price };
};

type StoredOrderRow = Partial<Order> & {
  id: string;
  user_id?: string | null;
  vehicle_brand?: string | null;
  vehicle_model?: string | null;
  vehicle_year?: number | string | null;
  engine?: string | null;
  ecu?: string | null;
  fuel?: string | null;
  services?: string[] | string | null;
  note?: string | null;
};

const serviceList = (value: StoredOrderRow['services'] | Order['service_type'] | undefined) => {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
  } catch {
    return [value];
  }
  return [value];
};

const CRC_MARK = '[[rp-crc]]';
const IMPORTANT_MARK = '[[rp-important]]';

const splitAdminNote = (raw: string) => {
  const marked = readInvoiceMark(raw);
  const source = marked.note;
  const crc = source.match(/\[\[rp-crc\]\]([^\n]*)/)?.[1]?.trim() ?? '';
  const important = source.match(/\[\[rp-important\]\]([\s\S]*)$/)?.[1]?.trim() ?? '';
  const visible = source
    .replace(/\n?\[\[rp-crc\]\][^\n]*/g, '')
    .replace(/\n?\[\[rp-important\]\][\s\S]*$/g, '')
    .trim();
  return {
    visible,
    crc,
    important,
    invoiceNumber: marked.invoice_number || '',
    invoiceUrl: marked.invoice_url || '',
    invoiceDate: marked.invoice_date || '',
  };
};

const packAdminNote = (
  raw: string,
  field: 'checksum_crc' | 'important_note',
  value: string | null,
) => {
  const current = splitAdminNote(raw);
  const crc = field === 'checksum_crc' ? (value ?? '') : current.crc;
  const important = field === 'important_note' ? (value ?? '') : current.important;
  const invoice = current.invoiceNumber
    ? `[[rp-invoice]]${current.invoiceNumber}||${current.invoiceDate || ''}||${current.invoiceUrl || ''}`
    : '';
  return [current.visible, crc ? `${CRC_MARK}${crc}` : '', important ? `${IMPORTANT_MARK}${important}` : '', invoice]
    .filter(Boolean)
    .join('\n');
};

const columnMissing = (error: { code?: string; message?: string } | null) =>
  error?.code === '42703'
  || error?.code === 'PGRST204'
  || /column .* does not exist|schema cache/i.test(error?.message ?? '');

const normalizeOrder = (row: StoredOrderRow, owner?: { name: string; email: string }): Order => {
  const packed = splitAdminNote(String(row.note ?? ''));
  const note = packed.visible;
  const lines = note.split('\n');
  const taggedNumber = lines[0]?.startsWith('RP-') ? lines[0].trim() : '';
  const engine = String(row.engine ?? '').trim();
  const model = String(row.car_model || row.vehicle_model || '').trim();
  const services = serviceList(row.service_type?.length ? row.service_type : row.services);
  return {
    ...(row as Order),
    id: row.id,
    order_number: row.order_number || taggedNumber || null,
    customer_name: row.customer_name || owner?.name || '',
    customer_email: row.customer_email || owner?.email || '',
    car_brand: row.car_brand || row.vehicle_brand || '',
    car_model: engine && !model.includes(engine) ? [model, engine].filter(Boolean).join(' ') : model,
    fuel_type: row.fuel_type || row.fuel || '',
    year: Number(row.year || row.vehicle_year || 0),
    ecu_type: row.ecu_type || row.ecu || '',
    service_type: services,
    total_price: Number(row.total_price || 0),
    status: row.status || 'pending',
    file_url: row.file_url ?? null,
    customer_note: row.customer_note || (taggedNumber ? lines.slice(1).join('\n').trim() : note.trim()) || null,
    checksum_crc: row.checksum_crc || packed.crc || null,
    important_note: row.important_note || packed.important || null,
    invoice_number: row.invoice_number || packed.invoiceNumber || null,
    invoice_url: row.invoice_url || packed.invoiceUrl || null,
    created_at: row.created_at || new Date().toISOString(),
    legal_consent: row.legal_consent ?? true,
  };
};

const blobFromDataUrl = (dataUrl: string) => {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const mime = /data:([^;,]+)/.exec(dataUrl.slice(0, comma))?.[1] || 'application/octet-stream';
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return new Blob([bytes], { type: mime });
};

const saveBlob = (blob: Blob, filename: string) => {
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'ecu.bin';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => window.URL.revokeObjectURL(url), 60000);
};

const inlineDownload = (stored: string, fallbackName: string) => {
  if (stored.startsWith('data:')) return { href: stored, filename: fallbackName };
  if (!stored.startsWith('inline:')) return null;
  const rest = stored.slice('inline:'.length);
  const split = rest.indexOf(':');
  const filename = split >= 0 ? decodeURIComponent(rest.slice(0, split)) : fallbackName;
  const href = split >= 0 ? rest.slice(split + 1) : '';
  return href.startsWith('data:') ? { href, filename: filename || fallbackName } : null;
};

const downloadOrderPart = async (orderId: string, part: 'client' | 'result', hint: string, fallbackName: string) => {
  let packed = hint && hint !== 'stored' ? hint : '';
  const hintIsFile = packed.startsWith('inline:') || packed.startsWith('data:') || packed.startsWith('http') || packed.includes(RESULT_FILE_MARK);
  if (!hintIsFile) {
    const { data, error } = await supabase.from('orders').select('file_url').eq('id', orderId).maybeSingle();
    if (error) throw error;
    packed = data?.file_url || '';
  }
  const unpacked = unpackOrderFile(packed);
  const stored = part === 'result' ? unpacked.resultFile : unpacked.clientFile;
  if (!stored) {
    toast.error(part === 'result' ? 'Hotový súbor nie je k dispozícii' : 'Nepodarilo sa vytvoriť URL pre sťahovanie');
    return;
  }
  const inline = inlineDownload(stored, fallbackName);
  if (inline) {
    const blob = blobFromDataUrl(inline.href);
    if (!blob) throw new Error('Súbor sa nepodarilo prečítať');
    saveBlob(blob, inline.filename);
    return;
  }
  const located = orderFileLocation(stored);
  if (located && 'href' in located) {
    const blob = blobFromDataUrl(located.href);
    if (!blob) throw new Error('Súbor sa nepodarilo prečítať');
    saveBlob(blob, located.filename || fallbackName);
    return;
  }
  if (!located?.bucket || !located.path) {
    toast.error('Nepodarilo sa vytvoriť URL pre sťahovanie');
    return;
  }
  const filename = located.path.split('/').pop() || fallbackName;
  const candidates: string[] = [];
  const signed = await supabase.storage.from(located.bucket).createSignedUrl(located.path, 180);
  if (signed.data?.signedUrl) candidates.push(signed.data.signedUrl);
  const pub = supabase.storage.from(located.bucket).getPublicUrl(located.path).data.publicUrl;
  if (pub) candidates.push(pub);
  if (stored.startsWith('http://') || stored.startsWith('https://')) candidates.unshift(stored);
  let lastError = null;
  for (const href of candidates) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(href, { signal: controller.signal });
      if (!response.ok) throw new Error('Súbor sa nepodarilo stiahnuť');
      saveBlob(await response.blob(), filename);
      return;
    } catch (error) {
      lastError = error;
    } finally {
      window.clearTimeout(timer);
    }
  }
  throw lastError || new Error('Súbor sa nepodarilo stiahnuť');
};

const STATUS_NOTIFY_EMAIL = 'srnik.jaroslav@gmail.com';
const ADMIN_SECTION_KEY = 'remappro-admin-section';
type AdminSection = 'orders' | 'clients' | 'services' | 'hours';

const parseAdminSection = (value: string | null): AdminSection | null =>
  value === 'orders' || value === 'clients' || value === 'services' || value === 'hours' ? value : null;

const readAdminSection = (): AdminSection => {
  const query = window.location.hash.split('?')[1] || '';
  return parseAdminSection(new URLSearchParams(query).get('tab'))
    || parseAdminSection(window.localStorage.getItem(ADMIN_SECTION_KEY))
    || 'orders';
};

const issueCompletionInvoice = async (order: Order) => {
  const billing = await loadBillingByUserId(clientIdOf(order), order.customer_email || '');
  const person = [billing.firstName, billing.lastName].map((part) => part.trim()).filter(Boolean).join(' ');
  const services = serviceList(order.service_type)
    .map((id) => lookupServiceName(id) || SERVICES.find((item) => item.id === id)?.name || id)
    .filter(Boolean)
    .join(', ');
  const invoiceNumber = order.invoice_number?.trim()
    || `INV-${String(order.order_number || order.id.slice(0, 8)).replace(/^INV-/i, '').toUpperCase()}`;
  const file = await generateInvoicePdf({
    invoiceNumber,
    issuedAt: new Date(),
    buyer: {
      name: billing.company.trim() || person || order.customer_name || 'Zákazník',
      contact: billing.company.trim() && person ? person : '',
      street: billing.street,
      postalCode: billing.postalCode,
      city: billing.city,
      email: billing.email || order.customer_email || '',
      phone: billing.phone,
      vatId: billing.vatId,
      taxId: billing.taxId,
    },
    brand: order.car_brand || '',
    model: order.car_model || '',
    service: services || 'ECU tuning',
    price: Math.abs(Number(order.total_price) || 0),
  });
  return saveOrderInvoice({
    id: order.id,
    order_number: order.order_number,
    user_id: clientIdOf(order),
    customer_name: order.customer_name,
    customer_email: order.customer_email,
    total_price: order.total_price,
    invoice_number: invoiceNumber,
  }, file);
};

const ManagementPortal = () => {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [accountingOpen, setAccountingOpen] = useState(false);
  const [exportFrom, setExportFrom] = useState('');
  const [exportTo, setExportTo] = useState('');
  const [exportPreset, setExportPreset] = useState<'month' | 'last' | 'year' | null>('month');
  const [exportCalendar, setExportCalendar] = useState<'from' | 'to' | null>(null);
  const [exportBusy, setExportBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingUploadId = useRef<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [activeRowId, setActiveRowId] = useState<string | null>(null);
  const [editingFields, setEditingFields] = useState<Record<string, { checksum_crc: string; internal_note: string; important_note: string }>>({});
  const [importantNote, setImportantNote] = useState<string>('');
  const [savingImportantNote, setSavingImportantNote] = useState<string | null>(null);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [statusMode, setStatusMode] = useState<SystemStatusMode>('auto');
  const [statusLoading, setStatusLoading] = useState(false);
  const [noteModalOrder, setNoteModalOrder] = useState<Order | null>(null);
  const [detailOrder, setDetailOrder] = useState<Order | null>(null);
  const [isCheckingAuth, setIsCheckingAuth] = useState(true);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [financialStats, setFinancialStats] = useState<{ grossRevenue: number; todayRevenue: number } | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [section, setSectionState] = useState<AdminSection>(readAdminSection);
  const setSection = (next: AdminSection) => {
    setSectionState(next);
    window.localStorage.setItem(ADMIN_SECTION_KEY, next);
    const params = new URLSearchParams(searchParams);
    if (next === 'orders') params.delete('tab');
    else params.set('tab', next);
    setSearchParams(params, { replace: true });
  };

  useEffect(() => {
    const fromUrl = parseAdminSection(searchParams.get('tab'));
    if (fromUrl) setSectionState(fromUrl);
  }, [searchParams]);
  const onlineIds = useOnlineClients(!isCheckingAuth);
  const [cancelConfirmOrder, setCancelConfirmOrder] = useState<Order | null>(null);
  const [cancellingOrder, setCancellingOrder] = useState(false);
  const orderOwnerRef = useRef<{ id: string; name: string; email: string }>({ id: '', name: '', email: '' });
  const ordersBusy = useRef(false);
  const ordersSeen = useRef(false);

  // Check authentication on mount - only allow specific email
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      
      if (!session) {
        navigate('/login');
        return;
      }

      // Check if user email matches allowed email
      const allowedEmail = import.meta.env.VITE_ADMIN_EMAIL || 'info@remappro.eu';
      const userEmail = session.user?.email?.toLowerCase();
      
      if (userEmail !== allowedEmail.toLowerCase()) {
        toast.error('Nemáte oprávnenie na prístup k tomuto portálu');
        await supabase.auth.signOut();
        navigate('/login');
        return;
      }

      setIsCheckingAuth(false);
    };

    checkAuth();

    // Listen for auth state changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (!session) {
        navigate('/login');
        return;
      }

      // Re-check email on auth state change
      const allowedEmail = import.meta.env.VITE_ADMIN_EMAIL || 'info@remappro.eu';
      const userEmail = session.user?.email?.toLowerCase();
      
      if (userEmail !== allowedEmail.toLowerCase()) {
        toast.error('Nemáte oprávnenie na prístup k tomuto portálu');
        await supabase.auth.signOut();
        navigate('/login');
      }
    });

    return () => {
      subscription.unsubscribe();
    };
  }, [navigate]);

  // Load initial status from DB
  useEffect(() => {
    if (isCheckingAuth) return;
    
    const loadStatus = async () => {
      const mode = await fetchSystemStatusFromDB();
      setStatusMode(mode);
    };
    loadStatus();
  }, [isCheckingAuth]);

  useEffect(() => {
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      const mode = typeof detail === 'string'
        ? detail
        : detail && typeof detail === 'object' && 'mode' in detail
          ? (detail as { mode?: string }).mode
          : null;
      if (mode === 'auto' || mode === 'online' || mode === 'offline') {
        setStatusMode((current) => (current === mode ? current : mode));
      }
    };
    window.addEventListener('systemStatusChange', handleChange);
    return () => window.removeEventListener('systemStatusChange', handleChange);
  }, []);

  const cycleStatusMode = async () => {
    // Cycle: auto -> online -> offline -> auto
    const nextMode: Record<SystemStatusMode, SystemStatusMode> = {
      'auto': 'online',
      'online': 'offline',
      'offline': 'auto'
    };
    const newMode = nextMode[statusMode];
    
    setStatusLoading(true);
    const success = await setSystemStatusInDB(newMode);
    setStatusLoading(false);
    
    if (success) {
      setStatusMode(newMode);
      const messages: Record<SystemStatusMode, string> = {
        'auto': 'System status set to AUTO (follows schedule 08:00-20:00)',
        'online': 'System forced ONLINE (visible to customers)',
        'offline': 'System forced OFFLINE (visible to customers)'
      };
      toast.success(messages[newMode]);
    } else {
      toast.error('Failed to update system status. Check RLS policies.');
    }
  };

  const fetchOrders = async (silent = false) => {
    if (silent && ordersBusy.current) return;
    ordersBusy.current = true;
    const showSpinner = !silent && !ordersSeen.current;
    if (showSpinner) setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user ?? null;
      if (!user) return;
      const billing = await loadClientBilling(user);
      const owner = {
        id: user?.id || '',
        name: billing ? orderDisplayName(billing) : '',
        email: billing?.email?.trim() || user?.email || '',
      };
      orderOwnerRef.current = owner;

      const columns = 'id, user_id, created_at, vehicle_brand, vehicle_model, vehicle_year, engine, ecu, fuel, services, total_price, status, note, checksum_crc, important_note';
      let request = supabase.from('orders').select(columns).order('created_at', { ascending: false });
      if (owner.id) request = request.eq('user_id', owner.id);
      let result = await request;
      if (result.error) {
        let fallback = supabase.from('orders').select('id, user_id, created_at, vehicle_brand, vehicle_model, vehicle_year, engine, ecu, fuel, services, total_price, status, note').order('created_at', { ascending: false });
        if (owner.id) fallback = fallback.eq('user_id', owner.id);
        result = await fallback;
      }
      const { data, error } = result;

      if (error) throw error;
      let fileRequest = supabase.from('orders').select('id').not('file_url', 'is', null);
      if (owner.id) fileRequest = fileRequest.eq('user_id', owner.id);
      const files = await fileRequest;
      const withFile = new Set((files.data || []).map((row) => row.id));
      let resultRequest = supabase.from('orders').select('id').like('file_url', `%${RESULT_FILE_MARK}%`);
      if (owner.id) resultRequest = resultRequest.eq('user_id', owner.id);
      const results = await resultRequest;
      const withResult = new Set((results.data || []).map((row) => row.id));
      const links = await invoiceLinksFor(((data || []) as StoredOrderRow[]).map((row) => row.id));
      ordersSeen.current = true;
      setOrders(((data || []) as StoredOrderRow[]).map((row) => normalizeOrder(mergeInvoice({
        ...row,
        file_url: row.file_url || (withFile.has(row.id) ? 'stored' : null),
        result_file_url: row.result_file_url || (withResult.has(row.id) ? 'stored' : null),
      }, links.get(row.id)), owner)));
    } catch (error) {
      console.error('Fetch error:', error);
      if (!silent) toast.error('Failed to fetch orders');
    } finally {
      ordersBusy.current = false;
      if (showSpinner) setLoading(false);
    }
  };

  useEffect(() => {
    if (isCheckingAuth) return;

    fetchOrders();
    calculateFinancialStats();

    const refresh = () => {
      fetchOrders(true);
    };
    const timer = window.setInterval(refresh, 8000);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);

    const channel = supabase
      .channel('orders-realtime')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'orders'
        },
        (payload) => {
          const row = payload.new as StoredOrderRow | undefined;
          if (payload.eventType === 'INSERT' && (!row?.user_id || row.user_id === orderOwnerRef.current.id)) {
            toast.info('New order received!');
          }
          refresh();
        }
      )
      .subscribe();

    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
      supabase.removeChannel(channel);
    };
  }, [isCheckingAuth]);

  useEffect(() => {
    setFinancialStats({
      grossRevenue: orderRevenue(orders),
      todayRevenue: todayOrderRevenue(orders),
    });
  }, [orders]);

  // Sync detailOrder with orders array when invoice_number or important_note changes
  useEffect(() => {
    if (detailOrder) {
      const updatedOrder = orders.find(o => o.id === detailOrder.id);
      if (updatedOrder && (
        updatedOrder.invoice_number !== detailOrder.invoice_number ||
        updatedOrder.invoice_url !== detailOrder.invoice_url ||
        updatedOrder.credit_note_number !== detailOrder.credit_note_number ||
        updatedOrder.credit_note_pdf !== detailOrder.credit_note_pdf ||
        updatedOrder.status !== detailOrder.status ||
        updatedOrder.result_file_url !== detailOrder.result_file_url ||
        updatedOrder.important_note !== detailOrder.important_note
      )) {
        setDetailOrder(updatedOrder);
        // Sync important_note from updated order to textarea
        if (updatedOrder.important_note !== detailOrder.important_note) {
          setImportantNote(updatedOrder.important_note || '');
        }
        
        // Fetch activity logs when detail order is set
        if (updatedOrder.id) {
          fetchActivityLogs(updatedOrder.id);
        }
      }
    }
  }, [orders, detailOrder]);

  // Initialize important_note when detailOrder changes (on open or refresh)
  useEffect(() => {
    if (detailOrder) {
      // Always sync with detailOrder.important_note to ensure persistence
      // This ensures the textarea shows the value from database
      setImportantNote(detailOrder.important_note || '');
      // Reset saved state when switching orders
      setSavedImportantNote(null);
    } else {
      // Clear when no detail order is selected
      setImportantNote('');
      setSavedImportantNote(null);
    }
  }, [detailOrder?.id, detailOrder?.important_note]);

  const handleLogout = async () => {
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        toast.error('Chyba pri odhlasovaní');
        return;
      }
      toast.success('Úspešne odhlásený');
      navigate('/login');
    } catch (error: any) {
      toast.error('Chyba pri odhlasovaní');
    }
  };

  const sendStatusEmail = async (order: Order, status: string) => {
    const orderId = order.order_number || order.id.slice(0, 8).toUpperCase();
    const clientUserId = clientIdOf(order);
    let language = await mailLanguageForClient(order.id, clientUserId);
    const session = await supabase.auth.getSession();
    if (clientUserId && session.data.session?.user?.id === clientUserId) {
      try {
        const stored = localStorage.getItem('remappro-language');
        if (stored === 'en' || stored === 'sk') language = stored;
      } catch {
        /* private mode */
      }
    }
    const payload = {
      orderId: order.id,
      orderNumber: orderId,
      customerEmail: STATUS_NOTIFY_EMAIL,
      customerName: order.customer_name || '',
      carBrand: order.car_brand || '',
      carModel: order.car_model || '',
      year: order.year || 0,
      status,
      ...(clientUserId ? { clientUserId } : {}),
      ...(language ? { language, lang: language } : {}),
    };
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/status-email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
          apikey: SUPABASE_ANON_KEY,
          ...(language ? { 'x-client-language': language } : {}),
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const responseData = await response.json().catch(() => ({}));
      if (!response.ok || responseData.success === false) {
        throw new Error(responseData.error || responseData.message || `HTTP ${response.status}`);
      }
      return responseData;
    } catch (error: any) {
      const message = error?.name === 'AbortError' ? 'Email request timed out' : (error?.message || 'Failed to fetch');
      console.error('[sendStatusEmail]', message);
      throw new Error(message);
    } finally {
      window.clearTimeout(timer);
    }
  };

  const notifyStatusChange = (order: Order, status: string) => {
    window.setTimeout(() => {
      void sendStatusEmail(order, status)
        .then(() => {
          toast.success('Email o zmene stavu bol odoslaný');
        })
        .catch((emailError: any) => {
          console.error('[notifyStatusChange] Email sending failed:', emailError);
          const errorMsg = emailError?.message || 'Neznáma chyba';
          if (errorMsg.includes('RESEND_API_KEY') || errorMsg.includes('API key')) {
            toast.error('Chyba: RESEND_API_KEY nie je nastavený alebo je neplatný');
          } else if (errorMsg.includes('domain') || errorMsg.includes('verified')) {
            toast.error('Chyba: Emailová doména nie je overená v Resend');
          } else {
            toast.error(`Chyba pri odosielaní emailu: ${errorMsg}`);
          }
        });
    }, 0);
  };

  // Log activity function
  const logActivity = async (orderId: string, action: string, details: Record<string, any>, adminId?: string) => {
    try {
      const { error } = await supabase
        .from('activity_logs')
        .insert({
          order_id: orderId,
          action,
          details,
          admin_id: adminId || 'system',
        });
      
      if (error) {
        console.error('[logActivity] Failed to log activity:', error);
      } else {
        console.log('[logActivity] Activity logged:', { orderId, action, details });
      }
    } catch (err) {
      console.error('[logActivity] Error logging activity:', err);
    }
  };

  // Fetch activity logs for an order
  const fetchActivityLogs = async (orderId: string) => {
    try {
      const { data, error } = await supabase
        .from('activity_logs')
        .select('*')
        .eq('order_id', orderId)
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      setActivityLogs((data || []) as ActivityLog[]);
    } catch (error) {
      console.error('[fetchActivityLogs] Error fetching activity logs:', error);
      setActivityLogs([]);
    }
  };

  // Calculate financial statistics
  const calculateFinancialStats = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const user = session?.user;
      if (!user) return;
      let request = supabase.from('orders').select('total_price, status, created_at');
      if (user?.id) request = request.eq('user_id', user.id);
      const result = await request;
      const ordersData = result.data || [];
      const error = result.error;

      if (error) throw error;

      setFinancialStats({
        grossRevenue: orderRevenue(ordersData),
        todayRevenue: todayOrderRevenue(ordersData),
      });
    } catch (error) {
      console.error('[calculateFinancialStats] Error calculating stats:', error);
    }
  };

  const handleStatusChange = async (orderId: string, newStatus: string) => {
    console.log('Updating order status:', { orderId, newStatus });
    
    if (newStatus === 'cancelled') return;
    
    // For other statuses, proceed normally
    await executeStatusChange(orderId, newStatus);
  };

  const executeStatusChange = async (orderId: string, newStatus: string) => {
    console.log('Executing status change:', { orderId, newStatus });
    
    // Find the order before update
    const order = orders.find(o => o.id === orderId);
    const previousStatus = order?.status;
    const rebill = newStatus === 'completed'
      && previousStatus !== 'completed'
      && Boolean(order && repeatWorkCompletion(order));
    let chargedPrice = 0;
    if (rebill && order) {
      const charge = await chargeRepeatCompletion(order);
      if (!charge.ok) return;
      chargedPrice = charge.charged ? charge.price : 0;
    }
    
    // Optimistic UI update
    setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: newStatus } : o)));

    try {
      const updateData: { status: string } = { status: newStatus };

      const { data, error } = await Promise.race([
        supabase.from('orders').update(updateData).eq('id', orderId).select('id'),
        new Promise<never>((_, reject) => {
          window.setTimeout(() => reject(new Error('Časový limit aktualizácie stavu')), 12000);
        }),
      ]);

      console.log('Update response:', { data, error });

      if (error) {
        console.error('Supabase update error:', error);
        throw error;
      }

      // DISCONNECTED: If cancelled, COMPLETELY STOP - NO automatic emails
      // Email is sent ONLY through Refund Wizard (openRefundModal -> issueCreditNote)
      if (newStatus === 'cancelled') {
        console.log('[executeStatusChange] Status is CANCELLED - NO automatic emails. Use Refund Wizard instead.');
        // Just update status, no emails
        return;
      }
      
      const statusLabels: Record<string, string> = {
        pending: 'Čakajúce',
        processing: 'V Procese',
        completed: 'Dokončené',
        paid: 'Zaplatené',
        cancelled: 'Zrušené',
      };
      toast.success(
        chargedPrice > 0
          ? `Stav zmenený na: ${statusLabels[newStatus] || newStatus}. Z kreditu bolo strhnutých ${chargedPrice.toFixed(2)} €.`
          : `Stav zmenený na: ${statusLabels[newStatus] || newStatus}`,
      );
      if (newStatus !== previousStatus && order && (newStatus === 'processing' || newStatus === 'completed')) {
        notifyStatusChange(order, newStatus);
      }

      void fetchOrders(true);
    } catch (error: any) {
      console.error('Update error:', error);
      if (chargedPrice > 0 && clientIdOf(order)) {
        const restored = await restoreClientCredits(clientIdOf(order), chargedPrice);
        if (!restored) toast.error('Stav sa nepodarilo uložiť a strhnuté kredity sa nepodarilo vrátiť.');
      }
      toast.error(`Chyba pri aktualizácii statusu: ${error.message || 'Neznáma chyba'}`);
      // Revert optimistic update
      if (order) {
        setOrders((prev) => prev.map((o) => (o.id === orderId ? { ...o, status: previousStatus || 'pending' } : o)));
      }
      await fetchOrders();
    }
  };

  const markOrderCancelled = (orderId: string) => {
    setOrders((prev) => prev.map((item) => (item.id === orderId ? { ...item, status: 'cancelled' } : item)));
    setDetailOrder((current) => (current?.id === orderId ? { ...current, status: 'cancelled' } : current));
  };

  const cancelOrderDirectly = async (order: Order) => {
    if (order.status === 'cancelled') {
      toast.info('Objednávka je už zrušená.');
      setCancelConfirmOrder(null);
      return;
    }

    const current = await supabase.from('orders').select('user_id,total_price,status').eq('id', order.id).maybeSingle();
    if (current.error || !current.data) {
      toast.error(current.error?.message || 'Objednávku sa nepodarilo načítať.');
      return;
    }
    if (current.data.status === 'cancelled') {
      toast.info('Objednávka je už zrušená.');
      setCancelConfirmOrder(null);
      return;
    }
    const price = Math.round(Math.abs(Number(current.data.total_price) || 0) * 100) / 100;
    const userId = String(current.data.user_id || '');
    const shouldRefund = price > 0 && /^[0-9a-f-]{36}$/i.test(userId);

    const { data: updated, error: updateError } = await supabase
      .from('orders')
      .update({ status: 'cancelled' })
      .eq('id', order.id)
      .select('id');
    if (updateError || !updated?.length) {
      toast.error(updateError?.message || 'Stav objednávky sa nepodarilo zmeniť.');
      return;
    }

    let refunded = !shouldRefund;
    if (shouldRefund) {
      const balance = await readCreditBalance(userId);
      const next = Math.round((balance + price) * 100) / 100;
      refunded = await saveCreditBalance(userId, next);
    }

    markOrderCancelled(order.id);
    setCancelConfirmOrder(null);
    void fetchOrders(true);
    if (shouldRefund && !refunded) {
      toast.error('Objednávka je zrušená, ale kredity sa nepodarilo vrátiť.');
      return;
    }
    toast.success(
      shouldRefund
        ? 'Objednávka bola zrušená a kredity boli vrátené klientovi.'
        : 'Objednávka bola zrušená.',
    );
    notifyStatusChange(order, 'cancelled');
  };

  const confirmCancelOrder = async () => {
    const order = cancelConfirmOrder;
    if (!order || cancellingOrder) return;
    setCancellingOrder(true);
    try {
      await cancelOrderDirectly(order);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Objednávku sa nepodarilo zrušiť.');
    } finally {
      setCancellingOrder(false);
    }
  };

  const handleFieldChange = (orderId: string, field: 'checksum_crc' | 'internal_note', value: string) => {
    setEditingFields(prev => ({
      ...prev,
      [orderId]: {
        checksum_crc: prev[orderId]?.checksum_crc ?? orders.find(o => o.id === orderId)?.checksum_crc ?? '',
        internal_note: prev[orderId]?.internal_note ?? orders.find(o => o.id === orderId)?.internal_note ?? '',
        [field]: value
      }
    }));
  };

  const handleFieldBlur = async (orderId: string, field: 'checksum_crc' | 'internal_note') => {
    const order = orders.find(o => o.id === orderId);
    const editedValue = editingFields[orderId]?.[field];
    const originalValue = order?.[field] ?? '';
    
    // Only save if value actually changed
    if (editedValue === undefined || editedValue === originalValue) return;
    
    setSavingId(orderId);
    try {
      const { error } = await supabase
        .from('orders')
        .update({ [field]: editedValue || null })
        .eq('id', orderId);

      if (error) throw error;
      toast.success(`${field === 'checksum_crc' ? 'Checksum CRC' : 'Internal Note'} saved`);
      await fetchOrders();
      // Clear the editing state for this order
      setEditingFields(prev => {
        const newState = { ...prev };
        delete newState[orderId];
        return newState;
      });
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Failed to save field');
    } finally {
      setSavingId(null);
    }
  };

  const persistOrderField = async (
    orderId: string,
    field: 'checksum_crc' | 'important_note',
    value: string | null,
  ) => {
    const columnUpdate = await supabase.from('orders').update({ [field]: value }).eq('id', orderId).select('id');
    if (!columnUpdate.error) return;
    if (!columnMissing(columnUpdate.error)) throw columnUpdate.error;

    const existing = await supabase.from('orders').select('note').eq('id', orderId).maybeSingle();
    if (existing.error) throw existing.error;
    const note = packAdminNote(String(existing.data?.note ?? ''), field, value);
    const noteUpdate = await supabase.from('orders').update({ note }).eq('id', orderId).select('id');
    if (noteUpdate.error) throw noteUpdate.error;
  };

  const handleSaveFields = async (orderId: string) => {
    const order = orders.find((item) => item.id === orderId);
    const crc = (editingFields[orderId]?.checksum_crc ?? order?.checksum_crc ?? '').trim();

    setSavingId(orderId);
    try {
      const stored = crc || null;
      await persistOrderField(orderId, 'checksum_crc', stored);
      setOrders((prev) => prev.map((item) => (item.id === orderId ? { ...item, checksum_crc: stored } : item)));
      setDetailOrder((current) => (current?.id === orderId ? { ...current, checksum_crc: stored } : current));
      toast.success('CRC uložené');
      setEditingFields((prev) => {
        const next = { ...prev };
        delete next[orderId];
        return next;
      });
      await fetchOrders(true);
    } catch (error) {
      console.error('Save error:', error);
      toast.error('Failed to save fields');
    } finally {
      setSavingId(null);
    }
  };

  const getEditableValue = (order: Order, field: 'checksum_crc' | 'internal_note') => {
    if (editingFields[order.id]?.[field] !== undefined) {
      return editingFields[order.id][field];
    }
    return order[field] || '';
  };

  // Sanitize text input - remove potentially harmful HTML/JS
  const sanitizeText = (text: string): string => {
    return text
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // Remove script tags
      .replace(/<[^>]+>/g, '') // Remove all HTML tags
      .replace(/javascript:/gi, '') // Remove javascript: protocol
      .replace(/on\w+\s*=/gi, '') // Remove event handlers
      .trim();
  };

  const [savedImportantNote, setSavedImportantNote] = useState<string | null>(null);

  const handleSaveImportantNote = async (orderId: string) => {
    setSavingImportantNote(orderId);
    try {
      const sanitizedNote = importantNote.trim() ? sanitizeText(importantNote) : null;
      await persistOrderField(orderId, 'important_note', sanitizedNote);
      setOrders((prev) => prev.map((item) => (item.id === orderId ? { ...item, important_note: sanitizedNote } : item)));
      
      toast.success('Poznámka uložená');
      
      // Refresh orders to get latest data
      await fetchOrders();
      
      // Update detailOrder if it's currently open - keep the saved value
      if (detailOrder?.id === orderId) {
        setDetailOrder(prev => prev ? { ...prev, important_note: sanitizedNote } : null);
        // Keep the text in textarea (don't clear it)
        // The textarea will show the saved value
        setSavedImportantNote(sanitizedNote);
        // Reset saved state after 2 seconds to show normal state again
        setTimeout(() => {
          setSavedImportantNote(null);
        }, 2000);
      }
    } catch (error) {
      console.error('Save important note error:', error);
      toast.error('Failed to save important message');
    } finally {
      setSavingImportantNote(null);
    }
  };

  const handleResultUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const orderId = pendingUploadId.current || selectedOrderId;
    if (!file || !orderId) return;
    
    // Strict Upload Lock: Check if invoice already exists
    const order = orders.find(o => o.id === orderId);
    const canSendFile = order?.status === 'pending' || order?.status === 'processing';
    if (order?.invoice_number && !canSendFile) {
      console.warn('[handleResultUpload] Invoice already sent for order:', orderId, 'Invoice:', order.invoice_number);
      toast.warning('Faktúra už bola odoslaná pre túto objednávku');
      if (e.target) {
        e.target.value = '';
      }
      return;
    }
    
    // Prevent multiple uploads - set uploading state immediately
    if (uploadingId === orderId) {
      console.warn('[handleResultUpload] Upload already in progress for order:', orderId);
      return;
    }
    
    setUploadingId(orderId);
    let chargedUpload: { userId: string; price: number } | null = null;
    
    // Reset file input to allow same file selection again
    if (e.target) {
      e.target.value = '';
    }
    
    try {
      const currentOrder = orders.find(o => o.id === orderId);
      if (currentOrder?.status === 'cancelled') {
        console.warn('[handleResultUpload] Order is CANCELLED - aborting invoice generation');
        toast.error('Cannot upload result file for cancelled order');
        setUploadingId(null);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      const storedResult = await uploadOrderFile(file, session?.user?.id || 'admin');
      const existing = await supabase.from('orders').select('file_url, user_id, total_price').eq('id', orderId).maybeSingle();
      if (existing.error) throw existing.error;
      const storedFileUrl = existing.data?.file_url || '';
      const billable: BillableOrder = {
        user_id: existing.data?.user_id || clientIdOf(currentOrder),
        total_price: existing.data?.total_price ?? currentOrder?.total_price,
        invoice_number: currentOrder?.invoice_number,
        result_file_url: currentOrder?.result_file_url,
        file_url: storedFileUrl,
      };
      const rebill = repeatWorkCompletion(billable, storedFileUrl);
      const charge = rebill ? await chargeRepeatCompletion(billable) : { ok: true, charged: false, price: 0 };
      if (charge.charged) chargedUpload = { userId: clientIdOf(billable), price: charge.price };
      if (!charge.ok) {
        setUploadingId(null);
        pendingUploadId.current = null;
        setSelectedOrderId(null);
        return;
      }
      const packedFile = packOrderFile(unpackOrderFile(storedFileUrl).clientFile, storedResult);
      const nextStatus = statusAfterResultDelivery(currentOrder?.status ?? 'pending');

      const { error: updateError } = await supabase
        .from('orders')
        .update({
          file_url: packedFile,
          status: nextStatus,
        })
        .eq('id', orderId);

      if (updateError) throw updateError;

      setOrders(prev => prev.map(o => o.id === orderId ? { ...o, status: nextStatus, result_file_url: 'stored' } : o));
      setDetailOrder(current => current?.id === orderId ? { ...current, status: nextStatus, result_file_url: 'stored' } : current);
      toast.success(
        charge.charged
          ? `Stav zmenený na: Dokončené. Z kreditu bolo strhnutých ${charge.price.toFixed(2)} €.`
          : 'Stav zmenený na: Dokončené',
      );
      if (currentOrder && nextStatus === 'completed') notifyStatusChange(currentOrder, 'completed');

      if (currentOrder && nextStatus === 'completed' && !currentOrder.invoice_url) {
        try {
          const saved = await issueCompletionInvoice(currentOrder);
          setOrders((prev) => prev.map((item) => (item.id === currentOrder.id ? { ...item, ...saved } : item)));
          setDetailOrder((current) => (current?.id === currentOrder.id ? { ...current, ...saved } : current));
        } catch (invoiceError) {
          console.error('[handleResultUpload] Invoice generation error (non-fatal):', invoiceError);
          toast.warning('Objednávka je dokončená. Faktúru sa nepodarilo vygenerovať.');
        }
      }

      setUploadingId(null);
      pendingUploadId.current = null;
      setSelectedOrderId(null);
      void fetchOrders(true);
    } catch (error) {
      console.error('[handleResultUpload] Upload error:', error);
      if (chargedUpload?.userId) {
        const restored = await restoreClientCredits(chargedUpload.userId, chargedUpload.price);
        if (!restored) toast.error('Súbor sa nepodarilo uložiť a strhnuté kredity sa nepodarilo vrátiť.');
      }
      toast.error('Hotový súbor sa nepodarilo uložiť');
      setUploadingId(null);
      pendingUploadId.current = null;
      setSelectedOrderId(null);
    }
  };

  const handleResultDownload = async (order: Order) => {
    try {
      await downloadOrderPart(
        order.id,
        'result',
        order.result_file_url || '',
        `result-${order.order_number || order.id.slice(0, 8)}`,
      );
    } catch (error) {
      console.error('Result download error:', error);
      toast.error('Hotový súbor sa nepodarilo stiahnuť');
    }
  };

  const handleClientFileDownload = async (order: Order) => {
    if (order.status === 'pending') {
      void executeStatusChange(order.id, 'processing');
    }
    try {
      await downloadOrderPart(
        order.id,
        'client',
        order.file_url || '',
        `client-${order.order_number || order.id.slice(0, 8)}`,
      );
    } catch (error) {
      console.error('Client download error:', error);
      toast.error('Chyba pri sťahovaní súboru');
    }
  };

  const triggerUpload = (orderId: string) => {
    pendingUploadId.current = orderId;
    setSelectedOrderId(orderId);
    fileInputRef.current?.click();
  };

  const openInvoice = async (order: Order) => {
    if (!order.invoice_url) {
      toast.warning('K tejto faktúre ešte nie je nahraté PDF.');
      return;
    }
    try {
      await downloadStoredInvoice(order.invoice_url, `${order.invoice_number || 'faktura'}.pdf`);
    } catch (error) {
      console.error('Invoice download error:', error);
      toast.error('Faktúru sa nepodarilo stiahnuť');
    }
  };

  const isoDate = (date: Date) => {
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${date.getFullYear()}-${month}-${day}`;
  };

  const applyExportPreset = (preset: 'month' | 'last' | 'year') => {
    const now = new Date();
    if (preset === 'month') {
      setExportFrom(isoDate(new Date(now.getFullYear(), now.getMonth(), 1)));
      setExportTo(isoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0)));
    } else if (preset === 'last') {
      setExportFrom(isoDate(new Date(now.getFullYear(), now.getMonth() - 1, 1)));
      setExportTo(isoDate(new Date(now.getFullYear(), now.getMonth(), 0)));
    } else {
      setExportFrom(isoDate(new Date(now.getFullYear(), 0, 1)));
      setExportTo(isoDate(new Date(now.getFullYear(), 11, 31)));
    }
    setExportPreset(preset);
  };

  const openAccounting = () => {
    applyExportPreset('month');
    setExportCalendar(null);
    setAccountingOpen(true);
  };

  const closeAccounting = () => {
    setExportCalendar(null);
    setAccountingOpen(false);
  };

  useEffect(() => {
    if (!exportCalendar) return;
    const onPointer = (event: PointerEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-accounting-date]')) return;
      setExportCalendar(null);
    };
    window.addEventListener('pointerdown', onPointer);
    return () => window.removeEventListener('pointerdown', onPointer);
  }, [exportCalendar]);

  const downloadAccountingZip = async () => {
    if (!exportFrom || !exportTo || exportFrom > exportTo) {
      toast.error('Vyberte platný dátum od a do.');
      return;
    }
    setExportBusy(true);
    try {
      const count = await exportInvoiceArchive(exportFrom, exportTo);
      if (!count) toast.warning('V tomto období nie je žiadna PDF faktúra.');
      else toast.success(`Záloha obsahuje ${count} ${count === 1 ? 'faktúru' : 'faktúr'}.`);
    } catch (error) {
      console.error('Invoice archive error:', error);
      toast.error(error instanceof Error ? error.message : 'Zálohu sa nepodarilo vytvoriť');
    } finally {
      setExportBusy(false);
    }
  };

  const filteredOrders = orders.filter((order) => {
    const searchLower = searchTerm.toLowerCase();
    const matchesSearch = 
      (order.order_number || '').toLowerCase().includes(searchLower) ||
      (order.customer_name || '').toLowerCase().includes(searchLower) ||
      (order.customer_email || '').toLowerCase().includes(searchLower) ||
      (order.car_brand || '').toLowerCase().includes(searchLower) ||
      (order.car_model || '').toLowerCase().includes(searchLower);
    
    const matchesStatus = statusFilter === 'all' || order.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  const STATUS_TEXT_COLOR: Record<string, string> = {
    all: '#00eaff',
    pending: '#facc15',
    processing: '#06b6d4',
    completed: '#22c55e',
    cancelled: '#ef4444',
  };

  const FILTER_FACE: Record<string, string> = {
    all: '!border-primary/70 !bg-[#000000] shadow-[0_0_18px_rgba(0,242,255,0.28)] hover:!border-primary hover:!bg-[#000000] hover:shadow-[0_0_22px_rgba(0,242,255,0.38)]',
    pending: '!border-yellow-400/80 !bg-yellow-500/25 shadow-[0_0_18px_rgba(250,204,21,0.55)] hover:!border-yellow-400 hover:!bg-yellow-500/35 hover:shadow-[0_0_22px_rgba(250,204,21,0.7)]',
    processing: '!border-cyan-300/80 !bg-cyan-500/25 shadow-[0_0_18px_rgba(34,211,238,0.55)] hover:!border-cyan-300 hover:!bg-cyan-500/35 hover:shadow-[0_0_22px_rgba(34,211,238,0.7)]',
    completed: '!border-green-400/80 !bg-green-500/25 shadow-[0_0_18px_rgba(74,222,128,0.55)] hover:!border-green-400 hover:!bg-green-500/35 hover:shadow-[0_0_22px_rgba(74,222,128,0.7)]',
    cancelled: '!border-red-400/70 !bg-red-500/25 shadow-[0_0_18px_rgba(248,113,113,0.55)] hover:!border-red-400 hover:!bg-red-500/35 hover:shadow-[0_0_22px_rgba(248,113,113,0.7)]',
  };

  const ordersRow = 'grid w-full min-w-[640px] grid-cols-[minmax(0,0.7fr)_minmax(0,1.15fr)_minmax(0,1.7fr)_minmax(0,1.1fr)_minmax(0,1.7fr)_8.5rem_9.5rem_312px]';

  const STATUS_CELL_CLASS: Record<string, string> = {
    pending: 'border-yellow-400/80 bg-yellow-500/10 text-yellow-400 shadow-[0_0_12px_rgba(250,204,21,0.28)]',
    processing: 'border-cyan-300/80 bg-cyan-500/10 text-cyan-300 shadow-[0_0_12px_rgba(34,211,238,0.28)]',
    completed: 'border-green-400/80 bg-green-500/10 text-green-400 shadow-[0_0_12px_rgba(74,222,128,0.28)]',
    paid: 'border-green-400/80 bg-green-500/10 text-green-400 shadow-[0_0_12px_rgba(74,222,128,0.28)]',
    cancelled: 'border-red-400/70 bg-red-500/10 text-red-400 shadow-[0_0_12px_rgba(248,113,113,0.28)]',
  };

  const getStatusClass = (status: string) => {
    switch (status) {
      case 'paid':
        return 'status-paid';
      case 'pending':
        return 'status-pending';
      case 'processing':
        return 'status-processing';
      case 'completed':
        return 'status-completed';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-pending';
    }
  };

  const getDisplayAmount = (order: Order) => {
    const amount = parseFloat(order.total_price?.toString() || '0');
    return Math.abs(amount);
  };

  useEffect(() => {
    loadServiceCatalog()
      .then(() => setOrders((current) => [...current]))
      .catch(() => undefined);
  }, []);

const getServiceNames = (serviceIds: string[] | string | null) => {
    if (!serviceIds) return '';
    const label = (id: string) => lookupServiceName(id) || SERVICES.find((s) => s.id === id)?.name || id;
    if (Array.isArray(serviceIds)) {
      return serviceIds.map((id: string) => label(id)).filter(Boolean).join(', ');
    }
    // Try to parse as JSON, otherwise treat as plain text
    try {
      const ids = JSON.parse(serviceIds);
      return ids.map((id: string) => label(id)).filter(Boolean).join(', ');
    } catch {
      // Already a plain text service name(s), return as-is
      return serviceIds;
    }
  };

  const formatLocalDateTime = (utcDateString: string) => {
    const date = new Date(utcDateString);
    return date.toLocaleString('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Fetch activity logs when detail order changes
  useEffect(() => {
    if (detailOrder?.id) {
      fetchActivityLogs(detailOrder.id);
    } else {
      setActivityLogs([]);
    }
  }, [detailOrder?.id]);

  // Show loading while checking auth
  if (isCheckingAuth) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Kontrola prístupu...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={handleResultUpload}
        accept=".bin,.ori,.mod,.ecu"
      />

      <div className="max-w-[1600px] mx-auto w-full min-w-0 px-4 flex flex-col min-h-screen">
      {/* Header */}
      <header className="sticky top-0 z-50 w-full border-b border-primary/25">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-background/80 backdrop-blur-sm" />
        <div className="relative py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-6 shrink-0">
            <NavLogo />
            <SystemStatus showModeLabel />
          </div>
          <div className="flex flex-nowrap items-center justify-end gap-3">
            <button
              onClick={cycleStatusMode}
              disabled={statusLoading}
              className={`flex items-center gap-2 rounded-lg border px-4 py-2 transition-all disabled:opacity-50 ${
                statusMode === 'online'
                  ? 'border-green-400 bg-green-500/25 text-green-300 shadow-[0_0_16px_rgba(74,222,128,0.55)] hover:bg-green-500/35 hover:shadow-[0_0_20px_rgba(74,222,128,0.7)]'
                  : statusMode === 'offline'
                    ? 'border-red-400 bg-red-500/25 text-red-300 shadow-[0_0_16px_rgba(248,113,113,0.55)] hover:bg-red-500/35 hover:shadow-[0_0_20px_rgba(248,113,113,0.7)]'
                    : 'border-primary/50 bg-primary/20 text-primary hover:bg-primary/30'
              }`}
            >
              <Power className={`w-4 h-4 ${statusLoading ? 'animate-spin' : ''}`} />
              {statusLoading ? 'Updating...' : statusMode === 'online' ? 'Force ONLINE' : statusMode === 'offline' ? 'Force OFFLINE' : 'Auto (Schedule)'}
            </button>
            <button
              onClick={handleLogout}
              className="flex h-[42px] items-center gap-2 rounded-lg border border-primary/50 bg-primary/20 px-4 text-base text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)] transition-colors hover:border-primary hover:bg-primary/30 hover:shadow-[0_0_16px_rgba(0,242,255,0.5)]"
            >
              <LogOut className="w-4 h-4" />
              Odhlásiť sa
            </button>
          </div>
        </div>
      </header>

      <div className="w-full flex-grow pt-3">
        <div className="mb-3 inline-flex flex-wrap items-end rounded-lg border border-transparent bg-transparent p-0.5 text-base font-semibold">
          <button
            type="button"
            onClick={() => setSection('orders')}
            className={`inline-flex h-9 items-center border border-transparent px-[11px] transition-colors ${section === 'orders' ? 'relative z-10 rounded-t-md rounded-b-none border-b-2 border-b-[#00d4ff] bg-[#00d4ff]/10 text-[#00d4ff] shadow-[0_12px_22px_rgba(0,212,255,0.28)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-gradient-to-b after:from-[rgba(0,212,255,0.35)] after:to-transparent' : 'rounded-md text-[#00d4ff]/75 hover:bg-[#00d4ff]/10 hover:text-[#00d4ff]'}`}
          >
            Objednávky
          </button>
          <button
            type="button"
            onClick={() => setSection('clients')}
            className={`inline-flex h-9 items-center border border-transparent px-[11px] transition-colors ${section === 'clients' ? 'relative z-10 rounded-t-md rounded-b-none border-b-2 border-b-[#22c55e] bg-[#22c55e]/10 text-[#22c55e] shadow-[0_12px_22px_rgba(34,197,94,0.28)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-gradient-to-b after:from-[rgba(34,197,94,0.35)] after:to-transparent' : 'rounded-md text-[#22c55e]/75 hover:bg-[#22c55e]/10 hover:text-[#22c55e]'}`}
          >
            Klienti
          </button>
          <button
            type="button"
            onClick={() => setSection('services')}
            className={`inline-flex h-9 items-center border border-transparent px-[11px] transition-colors ${section === 'services' ? 'relative z-10 rounded-t-md rounded-b-none border-b-2 border-b-[#f59e0b] bg-[#f59e0b]/10 text-[#f59e0b] shadow-[0_12px_22px_rgba(245,158,11,0.28)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-gradient-to-b after:from-[rgba(245,158,11,0.35)] after:to-transparent' : 'rounded-md text-[#f59e0b]/75 hover:bg-[#f59e0b]/10 hover:text-[#f59e0b]'}`}
          >
            Služby
          </button>
          <button
            type="button"
            onClick={() => setSection('hours')}
            className={`inline-flex h-9 items-center border border-transparent px-[11px] transition-colors ${section === 'hours' ? 'relative z-10 rounded-t-md rounded-b-none border-b-2 border-b-[#8B5CF6] bg-[#8B5CF6]/10 text-[#8B5CF6] shadow-[0_12px_22px_rgba(139,92,246,0.28)] after:pointer-events-none after:absolute after:inset-x-0 after:top-full after:h-3 after:bg-gradient-to-b after:from-[rgba(139,92,246,0.35)] after:to-transparent' : 'rounded-md text-[#8B5CF6]/75 hover:bg-[#8B5CF6]/10 hover:text-[#8B5CF6]'}`}
          >
            Otváracie hodiny
          </button>
        </div>
        {section === 'clients' ? <ClientCredits onlineIds={onlineIds} /> : section === 'services' ? <AdminServices /> : section === 'hours' ? <OpeningHours /> : (
        <>
        <div className="mb-3 grid w-full grid-cols-6 gap-2">
          <div className="min-w-0 rounded-none border-t-4 border-t-white bg-[#0f172a] px-2.5 py-2 shadow-[inset_0_0_28px_rgba(255,255,255,0.2)]">
            <p className="truncate text-xs font-extrabold uppercase tracking-wide text-white">Celkové tržby</p>
            <p className="mt-1 truncate text-2xl font-black leading-none text-cyan-400">
              {(financialStats?.grossRevenue ?? 0).toFixed(2)} €
            </p>
          </div>
          <div className="min-w-0 rounded-none border-t-4 border-t-[#8B5CF6] bg-[#0f172a] px-2.5 py-2 shadow-[inset_0_0_28px_rgba(139,92,246,0.2)]">
            <p className="truncate text-xs font-extrabold uppercase tracking-wide text-white">Dnešné tržby</p>
            <p className="mt-1 truncate text-2xl font-black leading-none text-sky-400">
              {(financialStats?.todayRevenue ?? 0).toFixed(2)} €
            </p>
          </div>
          <div className="min-w-0 rounded-none border-t-4 border-t-[#eab308] bg-[#0f172a] px-2.5 py-2 shadow-[inset_0_0_28px_rgba(234,179,8,0.16)]">
            <p className="truncate text-xs font-extrabold uppercase tracking-wide text-white">Čakajúce</p>
            <p className="mt-1 truncate text-2xl font-black leading-none text-[#facc15]">
              {orders.filter((order) => order.status === 'pending').length}
            </p>
          </div>
          <div className="min-w-0 rounded-none border-t-4 border-t-[#06b6d4] bg-[#0f172a] px-2.5 py-2 shadow-[inset_0_0_28px_rgba(6,182,212,0.16)]">
            <p className="truncate text-xs font-extrabold uppercase tracking-wide text-white">V procese</p>
            <p className="mt-1 truncate text-2xl font-black leading-none text-[#06b6d4]">
              {orders.filter((order) => order.status === 'processing').length}
            </p>
          </div>
          <div className="min-w-0 rounded-none border-t-4 border-t-[#22c55e] bg-[#0f172a] px-2.5 py-2 shadow-[inset_0_0_28px_rgba(34,197,94,0.16)]">
            <p className="truncate text-xs font-extrabold uppercase tracking-wide text-white">Dokončené</p>
            <p className="mt-1 truncate text-2xl font-black leading-none text-green-400">
              {orders.filter((order) => order.status === 'completed').length}
            </p>
          </div>
          <div className="min-w-0 rounded-none border-t-4 border-t-[#ef4444] bg-[#0f172a] px-2.5 py-2 shadow-[inset_0_0_28px_rgba(239,68,68,0.14)]">
            <p className="truncate text-xs font-extrabold uppercase tracking-wide text-white">Zrušené</p>
            <p className="mt-1 truncate text-2xl font-black leading-none text-[#ef4444]">
              {orders.filter((order) => order.status === 'cancelled').length}
            </p>
          </div>
        </div>

        {/* Orders Table */}
        <div className="h-fit w-full min-w-0 shrink-0 rounded-xl bg-background/40 backdrop-blur-xl border border-primary/20 shadow-[0_0_30px_rgba(59,130,246,0.15)]">
          <div className="flex items-center justify-end gap-3 border-b border-primary/30 bg-[#0a192f] py-2.5 pl-4 pr-4">
            <div className="relative w-72 shrink-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Hľadať objednávky..."
                className="h-[42px] w-full rounded-lg border border-primary/60 bg-transparent py-2 pl-9 pr-4 text-base leading-6 text-foreground shadow-[0_0_14px_rgba(0,242,255,0.28)] placeholder:text-muted-foreground transition-shadow hover:border-primary hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] focus:border-primary focus:outline-none focus:shadow-[0_0_18px_rgba(0,242,255,0.5)]"
              />
            </div>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className={`admin-filter-select orders-status-filter h-[42px] w-40 shrink-0 !rounded-lg !border bg-[length:0.8rem] bg-[position:right_0.4rem_center] bg-no-repeat px-4 py-2 text-left !text-base font-semibold transition-shadow focus:outline-none ${FILTER_FACE[statusFilter] || FILTER_FACE.all}`}
              style={{
                color: STATUS_TEXT_COLOR[statusFilter] || STATUS_TEXT_COLOR.all,
                colorScheme: 'dark',
                backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(STATUS_TEXT_COLOR[statusFilter] || STATUS_TEXT_COLOR.all)}' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              }}
            >
              <option value="all" style={{ color: '#E5E7EB', backgroundColor: '#000000', fontSize: '16px' }}>Všetky</option>
              <option value="pending" style={{ color: STATUS_TEXT_COLOR.pending, backgroundColor: '#000000', fontSize: '16px' }}>Čakajúce</option>
              <option value="processing" style={{ color: STATUS_TEXT_COLOR.processing, backgroundColor: '#000000', fontSize: '16px' }}>V Procese</option>
              <option value="completed" style={{ color: STATUS_TEXT_COLOR.completed, backgroundColor: '#000000', fontSize: '16px' }}>Dokončené</option>
              <option value="cancelled" style={{ color: STATUS_TEXT_COLOR.cancelled, backgroundColor: '#000000', fontSize: '16px' }}>Zrušené</option>
            </select>
            <button
              type="button"
              onClick={openAccounting}
              className="inline-flex h-[42px] shrink-0 items-center gap-2 rounded-lg border border-primary/70 bg-[#000000] px-3 text-sm font-semibold text-[#00eaff] shadow-[0_0_18px_rgba(0,242,255,0.28)] transition-shadow hover:border-primary hover:shadow-[0_0_22px_rgba(0,242,255,0.38)]"
            >
              <FileText className="h-4 w-4" />
              Účtovníctvo / Export
            </button>
          </div>
          <div className="overflow-x-auto">
            <div role="table" className="w-full min-w-0 text-base">
              <div role="rowgroup" className="sticky top-0 z-50">
                <div role="row" className={`${ordersRow} border-b border-primary/30 bg-[#0a192f] shadow-md`}>
                  <div role="columnheader" className="min-w-0 overflow-hidden border-r border-slate-500 p-2.5 text-left text-sm font-bold uppercase tracking-wide text-white">Faktúra</div>
                  <div role="columnheader" className="min-w-0 overflow-hidden border-r border-slate-500 p-2.5 text-left text-sm font-bold uppercase tracking-wide text-white">ID</div>
                  <div role="columnheader" className="min-w-0 overflow-hidden border-r border-slate-500 p-2.5 text-left text-sm font-bold uppercase tracking-wide text-white">Vozidlo</div>
                  <div role="columnheader" className="min-w-0 overflow-hidden border-r border-slate-500 p-2.5 text-left text-sm font-bold uppercase tracking-wide text-white">Dátum</div>
                  <div role="columnheader" className="min-w-0 overflow-hidden border-r border-slate-500 p-2.5 text-left text-sm font-bold uppercase tracking-wide text-white">Zákazník</div>
                  <div role="columnheader" className="sticky right-[calc(312px+9.5rem)] z-30 border-r border-slate-500 bg-[#0a192f] p-4 text-center text-sm font-bold uppercase tracking-wide text-white">Cena</div>
                  <div role="columnheader" className="sticky right-[312px] z-30 border-r border-slate-500 bg-[#0a192f] p-2.5 text-center text-sm font-bold uppercase tracking-wide text-white">Stav</div>
                  <div role="columnheader" className="sticky right-0 z-30 border-r border-slate-500 bg-[#0a192f] p-2.5 text-center text-sm font-bold uppercase tracking-wide text-white">Akcie</div>
                </div>
              </div>
              <div role="rowgroup">
                {loading ? (
                <div role="row" className={ordersRow}>
                      <div role="cell" className="col-span-8 py-12 text-center text-muted-foreground">
                        Načítavam objednávky...
                      </div>
                    </div>
                  ) : filteredOrders.length === 0 ? (
                    <div role="row" className={ordersRow}>
                      <div role="cell" className="col-span-8 py-12 text-center text-muted-foreground">
                        Žiadne objednávky
                      </div>
                    </div>
                ) : (
                  filteredOrders.map((order) => {
                    const active = activeRowId === order.id;
                    const picked = active ? 'bg-[#0b2430] shadow-[inset_0_0_18px_rgba(0,242,255,0.16)]' : '';
                    const flexCell = `min-w-0 overflow-hidden border-r border-slate-800/60 px-4 py-1 ${picked}`;
                    const pinBg = active ? 'bg-[#0b2430] shadow-[inset_0_0_18px_rgba(0,242,255,0.16)]' : 'bg-[#070d16]';
                    const actionCell = 'inline-flex h-full min-h-8 flex-1 basis-0 items-center justify-center rounded-none border border-current shadow-[0_0_12px_color-mix(in_srgb,currentColor_32%,transparent)] transition-colors duration-200 hover:shadow-[0_0_14px_color-mix(in_srgb,currentColor_45%,transparent)]';
                    const vehicle = [order.car_brand, order.car_model].map((part) => String(part ?? '').trim()).filter(Boolean).join(' ');
                    const documents: { number: string; href: string; title: string }[] = [];
                    if (order.invoice_number) {
                      documents.push({ number: order.invoice_number, href: order.invoice_url || '', title: order.invoice_url ? 'Stiahnuť faktúru' : 'PDF ešte nie je nahraté' });
                    }
                    if (order.credit_note_number) {
                      documents.push({ number: order.credit_note_number, href: order.credit_note_pdf || '#', title: 'Stiahnuť dobropis' });
                    }
                    return (
                    <div
                      role="row"
                      key={order.id}
                      onClick={() => setActiveRowId(order.id)}
                      className={`${ordersRow} cursor-pointer border-b border-slate-800/60`}
                    >
                      <div role="cell" className={flexCell}>
                        {documents.length === 0 ? (
                          <span className="text-base text-slate-500">—</span>
                        ) : (
                          <div className="flex min-w-0 flex-col items-start gap-0.5">
                            {documents.map((doc) => (
                              doc.title === 'Stiahnuť dobropis' ? (
                                <a
                                  key={doc.number}
                                  href={doc.href || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(event) => event.stopPropagation()}
                                  className="block max-w-full truncate font-mono text-base font-bold text-red-500 hover:text-red-400"
                                  title={doc.title}
                                >
                                  {doc.number}
                                </a>
                              ) : (
                                <button
                                  key={doc.number}
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation();
                                    void openInvoice(order);
                                  }}
                                  className="block max-w-full truncate text-left font-mono text-base font-bold text-red-500 hover:text-red-400"
                                  title={doc.title}
                                >
                                  {doc.number}
                                </button>
                              )
                            ))}
                          </div>
                        )}
                      </div>
                      <div role="cell" className={flexCell}>
                        <span className="block truncate font-mono text-lg font-bold leading-none text-cyan-300">
                          {order.order_number || order.id.slice(0, 6).toUpperCase()}
                        </span>
                      </div>
                      <div role="cell" className={flexCell}>
                        <p className="truncate text-base font-bold leading-none text-cyan-400" title={vehicle || '—'}>{vehicle || '—'}</p>
                      </div>
                      <div role="cell" className={flexCell}>
                        <p className="truncate text-base font-medium leading-none text-white">
                          {formatLocalDateTime(order.created_at)}
                        </p>
                      </div>
                      <div role="cell" className={flexCell}>
                        <div className="flex min-w-0 items-baseline gap-x-2">
                          <p className="min-w-0 truncate whitespace-nowrap text-lg font-bold leading-none text-cyan-400" title={order.customer_name}>{order.customer_name}</p>
                          <p className="min-w-0 truncate whitespace-nowrap text-xs leading-none text-white" title={order.customer_email}>{order.customer_email}</p>
                        </div>
                      </div>
                      <div role="cell" className={`sticky right-[calc(312px+9.5rem)] z-20 border-r border-slate-800/60 px-4 py-1 text-center ${pinBg}`}>
                        <p className={`flex items-center justify-center text-xl font-bold leading-none ${
                          order.status === 'cancelled' 
                            ? 'text-red-500' 
                            : 'text-primary'
                        }`}>
                          {getDisplayAmount(order).toFixed(2)}€
                        </p>
                      </div>
                      <div role="cell" className={`sticky right-[312px] z-20 min-h-8 border-r border-slate-800/60 p-0 text-center ${pinBg}`}>
                        <select
                          value={order.status}
                          onMouseDown={(event) => event.stopPropagation()}
                          onChange={(e) => handleStatusChange(order.id, e.target.value)}
                          className={`status-cell-select block h-full min-h-8 w-full cursor-pointer appearance-none rounded-none border bg-[length:0.8rem] bg-[position:right_0.4rem_center] bg-no-repeat px-4 text-center font-bold outline-none ${STATUS_CELL_CLASS[order.status] || STATUS_CELL_CLASS.pending}`}
                          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='${encodeURIComponent(STATUS_TEXT_COLOR[order.status] || STATUS_TEXT_COLOR.pending)}' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")` }}
                        >
                          {order.status === 'cancelled' && (
                            <option value="cancelled" disabled hidden>Zrušené</option>
                          )}
                          <option value="pending" style={{ color: STATUS_TEXT_COLOR.pending, backgroundColor: '#050505' }}>Čakajúce</option>
                          <option value="processing" style={{ color: STATUS_TEXT_COLOR.processing, backgroundColor: '#050505' }}>V Procese</option>
                          <option value="completed" style={{ color: STATUS_TEXT_COLOR.completed, backgroundColor: '#050505' }}>Dokončené</option>
                        </select>
                      </div>
                      <div role="cell" className="sticky right-0 z-30 h-full min-h-8 border-r border-slate-800/60 bg-[#070d16] p-0">
                        <div className="flex h-full w-full flex-nowrap items-stretch gap-0 p-0">
                          {order.file_url ? (
                            <button
                              onClick={() => void handleClientFileDownload(order)}
                              className={`${actionCell} bg-yellow-400/10 text-yellow-400 hover:bg-yellow-400/20`}
                              title="Stiahnuť súbor zákazníka"
                            >
                              <Download className="h-5 w-5" />
                            </button>
                          ) : (
                            <span className={`${actionCell} cursor-not-allowed bg-slate-800/40 text-slate-500`} title="Súbor nie je k dispozícii">
                              <Download className="h-5 w-5" />
                            </span>
                          )}
                          {order.status === 'completed' ? (
                            <span className={`${actionCell} bg-emerald-400/10 text-emerald-400`} title="Hotový súbor je nahraný">
                              <CheckCircle className="h-5 w-5" />
                            </span>
                          ) : (
                            <button
                              onClick={() => triggerUpload(order.id)}
                              disabled={uploadingId === order.id || (order.status !== 'pending' && order.status !== 'processing')}
                              className={`${actionCell} ${
                                uploadingId === order.id || (order.status !== 'pending' && order.status !== 'processing')
                                  ? 'cursor-not-allowed bg-slate-800/40 text-slate-500'
                                  : 'bg-emerald-400/10 text-emerald-400 hover:bg-emerald-400/20'
                              }`}
                              title={
                                uploadingId === order.id
                                  ? 'Odosielam...'
                                  : order.status === 'pending' || order.status === 'processing'
                                    ? 'Nahrať hotový súbor'
                                    : 'Súbor sa dá odoslať vo stave Čakajúce alebo V procese'
                              }
                            >
                              <Upload className={`h-5 w-5 ${uploadingId === order.id ? 'animate-pulse' : ''}`} />
                            </button>
                          )}
                          <button
                            onClick={() => setDetailOrder(order)}
                            className={`${actionCell} bg-cyan-400/10 text-cyan-400 hover:bg-cyan-400/20`}
                            title="Zobraziť detail objednávky"
                          >
                            <FileText className="h-5 w-5" />
                          </button>
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              setCancelConfirmOrder(order);
                            }}
                            className={`${actionCell} bg-red-500/10 text-red-400 hover:bg-red-500/20`}
                            title="Zmazať objednávku"
                          >
                            <Trash2 className="h-5 w-5" />
                          </button>
                        </div>
                      </div>
                    </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
        </>
        )}

        {accountingOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
            <div className="w-full max-w-lg rounded-xl border border-[rgba(0,242,255,0.4)] bg-[#070b10] p-5 shadow-[0_0_28px_rgba(0,242,255,0.16)]">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
                  <FileText className="h-6 w-6 text-primary" />
                  Účtovníctvo / Export
                </h2>
                <button
                  type="button"
                  onClick={closeAccounting}
                  className="shrink-0 rounded-none border border-red-400/70 bg-red-500/10 p-2 text-red-400 shadow-[0_0_12px_rgba(248,113,113,0.32)] transition-colors duration-200 hover:bg-red-500/16 hover:shadow-[0_0_16px_rgba(248,113,113,0.42)]"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {([
                  ['from', 'Dátum od', exportFrom, 'left-0'],
                  ['to', 'Dátum do', exportTo, 'right-0'],
                ] as const).map(([key, label, value, align]) => (
                  <div key={key} className="relative" data-accounting-date>
                    <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
                    <button
                      type="button"
                      onClick={() => setExportCalendar((current) => (current === key ? null : key))}
                      className="flex h-[42px] w-full items-center justify-between rounded-lg border border-primary/60 bg-transparent px-3 text-base text-foreground shadow-[0_0_14px_rgba(0,242,255,0.28)] focus:border-primary focus:outline-none"
                    >
                      <span>{value ? `${value.slice(8, 10)}. ${value.slice(5, 7)}. ${value.slice(0, 4)}` : 'Vyberte dátum'}</span>
                      <CalendarDays className="h-4 w-4 text-[#00eaff]" />
                    </button>
                    {exportCalendar === key && (
                      <div className={`absolute top-[calc(100%+6px)] z-30 ${align}`}>
                        <DayPicker
                          mode="single"
                          locale={sk}
                          weekStartsOn={1}
                          selected={value ? new Date(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) : undefined}
                          onSelect={(day) => {
                            if (!day) return;
                            const next = isoDate(day);
                            if (key === 'from') setExportFrom(next);
                            else setExportTo(next);
                            setExportPreset(null);
                            setExportCalendar(null);
                          }}
                          className="accounting-calendar rounded-lg border border-primary/40 bg-[#070b10] text-white shadow-[0_0_24px_rgba(0,242,255,0.18)]"
                          classNames={{
                            months: 'flex flex-col',
                            month: 'space-y-3',
                            caption: 'relative flex items-center justify-center pt-1',
                            caption_label: 'accounting-caption text-sm font-semibold',
                            nav: 'flex items-center',
                            nav_button: 'accounting-nav inline-flex h-8 w-8 items-center justify-center rounded-md border bg-transparent',
                            nav_button_previous: 'absolute left-1',
                            nav_button_next: 'absolute right-1',
                            table: 'w-full border-collapse',
                            head_row: 'flex',
                            head_cell: 'accounting-head w-9 text-[0.8rem] font-medium',
                            row: 'mt-1 flex w-full',
                            cell: 'relative h-9 w-9 p-0 text-center text-sm',
                            day: 'accounting-day inline-flex h-9 w-9 items-center justify-center rounded-md text-sm',
                            day_selected: 'accounting-day-selected',
                            day_today: 'accounting-day-today',
                            day_outside: 'accounting-day-outside',
                            day_disabled: 'accounting-day-disabled',
                            day_hidden: 'invisible',
                          }}
                          components={{
                            IconLeft: () => <ChevronLeft className="h-4 w-4" />,
                            IconRight: () => <ChevronRight className="h-4 w-4" />,
                          }}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {([
                  ['month', 'Tento mesiac'],
                  ['last', 'Minulý mesiac'],
                  ['year', 'Celý rok'],
                ] as const).map(([preset, label]) => (
                  <button
                    key={preset}
                    type="button"
                    onClick={() => applyExportPreset(preset)}
                    className={`inline-flex h-10 items-center rounded-lg border px-3 text-sm font-semibold transition-colors ${
                      exportPreset === preset
                        ? 'border-primary bg-primary/20 text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)]'
                        : 'border-primary/40 bg-black text-foreground hover:border-primary hover:text-primary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="mt-5 flex items-center gap-4">
                <button
                  type="button"
                  onClick={closeAccounting}
                  className="inline-flex h-12 shrink-0 items-center justify-center rounded-lg border border-white/20 bg-transparent px-5 text-sm font-semibold text-slate-400 transition-colors hover:border-red-400/80 hover:text-red-300"
                >
                  Zrušiť
                </button>
                <button
                  type="button"
                  onClick={() => void downloadAccountingZip()}
                  disabled={exportBusy}
                  className="inline-flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-lg border border-primary bg-primary/20 text-base font-bold uppercase tracking-wide text-primary shadow-[0_0_18px_rgba(0,242,255,0.45)] transition-colors hover:bg-primary/30 disabled:cursor-wait disabled:opacity-60"
                >
                  <Download className="h-5 w-5" />
                  {exportBusy ? 'Pripravujem zálohu...' : 'Stiahnuť zálohu (ZIP)'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Order Detail Modal */}
        {detailOrder && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <div className="max-w-5xl w-full max-h-[90vh] overflow-y-auto overflow-x-hidden rounded-xl border border-[rgba(0,242,255,0.4)] bg-[#070b10] shadow-[0_0_28px_rgba(0,242,255,0.16)]">
              <div className="p-2">
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-xl font-bold text-foreground">
                    <FileText className="w-6 h-6 text-primary" />
                    Detail objednávky
                  </h2>
                  <button
                    onClick={() => setDetailOrder(null)}
                    className="shrink-0 rounded-none border border-red-400/70 bg-red-500/10 p-2 text-red-400 shadow-[0_0_12px_rgba(248,113,113,0.32)] transition-colors duration-200 hover:bg-red-500/16 hover:text-red-400 hover:shadow-[0_0_16px_rgba(248,113,113,0.42)]"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="grid min-w-0 grid-cols-1 items-start gap-2 lg:grid-cols-2">
                  <div className="flex min-w-0 flex-col gap-1">
                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                        Základné informácie
                      </h3>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div>
                          <p className="text-sm text-muted-foreground">ID objednávky</p>
                          <p className="break-all font-mono font-semibold text-primary">{detailOrder.order_number || detailOrder.id.slice(0, 8).toUpperCase()}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Dátum vytvorenia</p>
                          <p className="break-words text-foreground">{formatLocalDateTime(detailOrder.created_at)}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Stav</p>
                          <span className={`inline-flex items-center rounded-full px-3 py-1.5 text-sm font-semibold ${getStatusClass(detailOrder.status)}`}>
                            {detailOrder.status === 'pending' ? 'Čakajúce' : detailOrder.status === 'processing' ? 'V Procese' : detailOrder.status === 'completed' ? 'Dokončené' : detailOrder.status === 'cancelled' ? 'Zrušené' : detailOrder.status === 'paid' ? 'Zaplatené' : detailOrder.status}
                          </span>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Celková cena</p>
                          <p className={`text-xl font-bold ${
                            detailOrder.status === 'cancelled'
                              ? 'text-red-500'
                              : 'text-primary'
                          }`}>
                            {getDisplayAmount(detailOrder).toFixed(2)}€
                          </p>
                        </div>
                        <div className="col-span-2">
                          <p className="text-sm font-semibold text-primary">Číslo Faktúry</p>
                          {!detailOrder.invoice_number && !detailOrder.credit_note_number ? (
                            <p className="text-foreground">—</p>
                          ) : (
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                              {detailOrder.invoice_number && (
                                <button
                                  type="button"
                                  onClick={() => void openInvoice(detailOrder)}
                                  className="inline-flex items-center gap-2 text-green-400 underline hover:text-green-300"
                                >
                                  <FileText className="w-4 h-4" />
                                  <span className="break-all font-mono">{detailOrder.invoice_number}</span>
                                </button>
                              )}
                              {detailOrder.credit_note_number && (
                                <a
                                  href={detailOrder.credit_note_pdf || '#'}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-2 text-red-500 hover:text-red-400 underline"
                                >
                                  <FileText className="w-4 h-4" />
                                  <span className="break-all font-mono">{detailOrder.credit_note_number}</span>
                                </a>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    </section>

                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-primary">
                        Vozidlo
                      </h3>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div>
                          <p className="text-sm text-muted-foreground">Značka / Model</p>
                          <p className="break-words font-medium text-foreground">{detailOrder.car_brand || 'Nezadané'} {detailOrder.car_model || ''}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Palivo</p>
                          <p className="break-words text-foreground">{detailOrder.fuel_type || '—'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Rok výroby</p>
                          <p className="break-words text-foreground">{detailOrder.year ? detailOrder.year.toString() : '—'}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">Typ ECU</p>
                          <p className="break-words text-foreground">{detailOrder.ecu_type || '—'}</p>
                        </div>
                      </div>
                    </section>

                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-primary">
                        Poznámka zákazníka
                      </h3>
                      <p className="break-words whitespace-pre-wrap text-foreground">{detailOrder.customer_note || '—'}</p>
                    </section>
                  </div>

                  <div className="flex min-w-0 flex-col gap-1">
                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-primary">
                        Zákazník
                      </h3>
                      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        <div>
                          <p className="text-sm text-muted-foreground">Meno</p>
                          <p className="break-words font-medium text-foreground">{detailOrder.customer_name}</p>
                        </div>
                        <div>
                          <p className="text-sm text-muted-foreground">E-mail</p>
                          <p className="break-all text-foreground">{detailOrder.customer_email}</p>
                        </div>
                      </div>
                    </section>

                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-primary">
                        Služby
                      </h3>
                      <p className="break-words text-foreground">{getServiceNames(detailOrder.service_type) || '—'}</p>
                    </section>

                    <section className="min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                      <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-primary">
                        CRC
                      </h3>
                      <div className="flex flex-wrap items-center gap-3">
                        <input
                          type="text"
                          value={getEditableValue(detailOrder, 'checksum_crc')}
                          onChange={(e) => {
                            handleFieldChange(detailOrder.id, 'checksum_crc', e.target.value);
                            if (!editingFields[detailOrder.id]) {
                              setEditingFields(prev => ({
                                ...prev,
                                [detailOrder.id]: { ...prev[detailOrder.id], checksum_crc: e.target.value }
                              }));
                            }
                          }}
                          placeholder="CRC..."
                          maxLength={6}
                          className="h-9 w-[120px] max-w-full rounded border border-gray-600 bg-secondary/50 px-3 py-2 font-mono text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-1 focus:ring-primary/50"
                        />
                        <button
                          type="button"
                          onClick={() => setDetailOrder(null)}
                          className="rounded-none border border-red-400/70 bg-red-500/10 px-4 py-2 text-red-400 shadow-[0_0_14px_rgba(248,113,113,0.32)] transition-colors hover:border-red-400 hover:bg-red-500/16 hover:shadow-[0_0_16px_rgba(248,113,113,0.42)]"
                        >
                          Zrušiť
                        </button>
                        <button
                          onClick={() => handleSaveFields(detailOrder.id)}
                          disabled={savingId === detailOrder.id}
                          className="flex items-center gap-2 rounded-none border border-primary/80 bg-primary/10 px-4 py-2 text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)] transition-colors hover:border-primary hover:bg-primary/16 hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] disabled:cursor-not-allowed disabled:opacity-50"
                          title="Uložiť CRC"
                        >
                          <Save className={`w-4 h-4 ${savingId === detailOrder.id ? 'animate-pulse' : ''}`} />
                          Uložiť
                        </button>
                      </div>
                    </section>
                  </div>
                </div>

                {/* Interná poznámka */}
                {detailOrder.internal_note && (
                  <section className="mt-2 min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                    <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                      Interná poznámka
                    </h3>
                    <p className="break-words whitespace-pre-wrap text-foreground">{detailOrder.internal_note}</p>
                  </section>
                )}

                {/* Activity Log */}
                {activityLogs.length > 0 && (
                  <section className="mt-2 min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                    <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                      Časová os aktivít
                    </h3>
                    <div className="space-y-1.5">
                      {activityLogs.map((log, index) => {
                        const actionLabels: Record<string, string> = {
                          'INVOICE_GENERATED': 'Faktúra vystavená',
                          'CN_GENERATED': 'Dobropis vystavený',
                          'STATUS_CHANGED': 'Zmena statusu',
                          'FILE_UPLOADED': 'Súbor nahraný',
                        };
                        
                        const actionColors: Record<string, string> = {
                          'INVOICE_GENERATED': 'text-green-400',
                          'CN_GENERATED': 'text-red-400',
                          'STATUS_CHANGED': 'text-blue-400',
                          'FILE_UPLOADED': 'text-yellow-400',
                        };
                        
                        return (
                          <div key={log.id} className="flex items-start gap-3 pb-3 border-b border-primary/10 last:border-0">
                            <div className="flex-shrink-0 w-2 h-2 rounded-full bg-primary mt-2" />
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                <span className={`break-words font-medium ${actionColors[log.action] || 'text-foreground'}`}>
                                  {actionLabels[log.action] || log.action}
                                </span>
                                <span className="shrink-0 text-xs text-muted-foreground">
                                  {new Date(log.created_at).toLocaleString('sk-SK')}
                                </span>
                              </div>
                              {log.details && Object.keys(log.details).length > 0 && (
                                <div className="mt-1 break-words text-sm text-muted-foreground">
                                  {log.action === 'INVOICE_GENERATED' && log.details.invoice_number && (
                                    <span>Faktúra: {log.details.invoice_number}</span>
                                  )}
                                  {log.action === 'CN_GENERATED' && log.details.credit_note_number && (
                                    <span>Dobropis: {log.details.credit_note_number}</span>
                                  )}
                                  {log.action === 'STATUS_CHANGED' && (
                                    <span>{log.details.from} → {log.details.to}</span>
                                  )}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                <section className="mt-1 w-full min-w-0 rounded-lg border border-[rgba(0,242,255,0.25)] bg-[#070b10] p-2.5">
                  <h3 className="mb-1.5 border-b border-primary/20 pb-1 text-sm font-semibold text-foreground">
                    *IMPORTANT*
                  </h3>
                  <div className="space-y-1.5">
                    <textarea
                      value={importantNote}
                      onChange={(e) => {
                        setImportantNote(e.target.value);
                        // Reset saved state when user starts typing again
                        if (savedImportantNote !== null && e.target.value !== savedImportantNote) {
                          setSavedImportantNote(null);
                        }
                      }}
                      placeholder="Enter important message for customer email..."
                      rows={2}
                      maxLength={500}
                      className="h-8 w-full resize-none rounded-lg border border-gray-600 bg-secondary/50 px-3 py-1 text-sm text-white placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/50"
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="min-w-0 flex-1 break-words text-xs text-muted-foreground">
                        This message will appear in the customer email after file completion notification.
                      </p>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDetailOrder(null)}
                          className="rounded-none border border-red-400/70 bg-red-500/10 px-4 py-2 text-red-400 shadow-[0_0_14px_rgba(248,113,113,0.32)] transition-colors hover:border-red-400 hover:bg-red-500/16 hover:shadow-[0_0_16px_rgba(248,113,113,0.42)]"
                        >
                          Zrušiť
                        </button>
                        <button
                        onClick={() => handleSaveImportantNote(detailOrder.id)}
                        disabled={savingImportantNote === detailOrder.id || (savedImportantNote !== null && importantNote === savedImportantNote)}
                        className={`inline-flex items-center gap-2 rounded-none border px-4 py-2 shadow-[0_0_14px_rgba(0,242,255,0.32)] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                          savedImportantNote !== null && importantNote === savedImportantNote
                            ? 'border-emerald-400/70 bg-emerald-500/10 text-emerald-400 shadow-[0_0_14px_rgba(52,211,153,0.32)]'
                            : 'border-primary/80 bg-primary/10 text-primary hover:border-primary hover:bg-primary/16 hover:shadow-[0_0_16px_rgba(0,242,255,0.42)]'
                        }`}
                        title={savedImportantNote !== null && importantNote === savedImportantNote ? 'Uložené!' : 'Uložiť dôležitú správu'}
                      >
                        {savedImportantNote !== null && importantNote === savedImportantNote ? (
                          <>
                            <CheckCircle className="w-4 h-4" />
                            Uložené!
                          </>
                        ) : savingImportantNote === detailOrder.id ? (
                          <>
                            <Save className="w-4 h-4 animate-pulse" />
                            Ukladám...
                          </>
                        ) : (
                          <>
                            <Save className="w-4 h-4" />
                            Uložiť poznámku
                          </>
                        )}
                        </button>
                      </div>
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        )}

        {/* Internal Note Modal */}
        <InternalNoteModal
          isOpen={!!noteModalOrder}
          onClose={() => setNoteModalOrder(null)}
          orderId={noteModalOrder?.id || ''}
          orderNumber={noteModalOrder?.order_number || noteModalOrder?.id.slice(0, 8).toUpperCase() || ''}
          initialNote={noteModalOrder ? getEditableValue(noteModalOrder, 'internal_note') : ''}
          onSave={async (note) => {
            if (!noteModalOrder) return;
            handleFieldChange(noteModalOrder.id, 'internal_note', note);
            await handleSaveFields(noteModalOrder.id);
            setNoteModalOrder(null);
          }}
          isSaving={savingId === noteModalOrder?.id}
        />
      </div>

      <footer className="mt-8 w-full py-4 text-center text-xs text-gray-500">
        <p>REMAPPRO, IČO: 41281471, DIČ: 1041196607, Janka Kráľa 29, 990 01 Veľký Krtíš, Slovakia</p>
        <p className="mt-1">Copyright © 2026 REMAPPRO Digital Solutions. All rights reserved.</p>
      </footer>
      </div>

      <AlertDialog
        open={cancelConfirmOrder !== null}
        onOpenChange={(open) => {
          if (!open && !cancellingOrder) setCancelConfirmOrder(null);
        }}
      >
        <AlertDialogContent className="border border-red-500/80 bg-[#1a0b0b] shadow-[0_0_32px_rgba(239,68,68,0.45)] sm:max-w-[560px]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-xl font-black tracking-wide text-red-400">UPOZORNENIE</AlertDialogTitle>
            <AlertDialogDescription className="text-base leading-6 text-white">
              Naozaj chcete zrušiť túto objednávku? Ak už bola zaplatená, kredity budú automaticky vrátené na účet klienta.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={cancellingOrder}
              className="rounded-none border-slate-400/70 bg-white/5 text-white shadow-[0_0_12px_rgba(148,163,184,0.28)] hover:bg-white/10 hover:text-white hover:shadow-[0_0_16px_rgba(148,163,184,0.36)]"
            >
              Nie
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={cancellingOrder}
              onClick={(event) => {
                event.preventDefault();
                void confirmCancelOrder();
              }}
              className="rounded-none border border-red-500/80 bg-red-500/10 text-red-400 shadow-[0_0_14px_rgba(239,68,68,0.32)] hover:border-red-400 hover:bg-red-500/16 hover:text-red-400 hover:shadow-[0_0_16px_rgba(239,68,68,0.42)]"
            >
              Áno, zrušiť
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

    </>
  );
};

export default ManagementPortal;
