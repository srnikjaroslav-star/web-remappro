import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import ClientProfile from '@/components/ClientProfile';
import CreditTopUpModal from '@/components/CreditTopUpModal';
import NavLogo from '@/components/NavLogo';
import MyOrders from '@/components/MyOrders';
import CreditPackageInvoices from '@/components/CreditPackageInvoices';
import ConnectionDot from '@/components/ConnectionDot';
import SystemStatus, { fetchSystemSettings, isSystemOnline, useSystemOnline } from '@/components/SystemStatus';
import { useLanguage } from '@/i18n/LanguageContext';
import { saveProfileLanguage, syncAccountLanguage } from '@/lib/clientLanguage';
import type { TranslationKey } from '@/i18n/translations';
import { formatCreditUnits } from '@/lib/creditUnits';
import {
  groupCatalog,
  loadServiceCatalog,
  peekServiceCatalog,
  subscribeServiceCatalog,
  type CatalogService,
} from '@/lib/serviceCatalog';
import { emptyBilling, loadClientBilling, orderDisplayName, readCreditBalance, releasePortalVisit, saveClientBilling, trackPortalAuth, type ClientBilling } from '@/lib/clientProfile';
import { uploadOrderFile } from '@/lib/ecuFile';
import {
  isLegacyStage1,
  isStageDropdownService,
  stageGroupSelection,
  stageGroupsFromCatalog,
} from '@/lib/stageOptions';
import {
  accountDisplayName,
  companyFromMetadata,
  joinProfileName,
} from '@/lib/profileName';
import { useClientPresence } from '@/lib/clientPresence';
import { isPortalAdmin } from '@/lib/portalAdmin';
import { authRemembered, setAuthRemember, supabase } from '@/lib/supabase';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  ChevronDown,
  Coins,
  Cpu,
  Eye,
  EyeOff,
  File,
  FileText,
  Fuel,
  Gauge,
  List,
  Loader2,
  LogOut,
  Upload,
  UserRound,
  X,
} from 'lucide-react';

const ACCEPTED_EXTENSIONS = ['.bin', '.ori', '.mod', '.ecu'];

const HEX_DUMP = Array.from({ length: 90 }, (_, row) => {
  const address = (row * 16).toString(16).padStart(8, '0').toUpperCase();
  const bytes = Array.from({ length: 16 }, (_, index) =>
    ((row * 31 + index * 17 + 0x4d) & 0xff).toString(16).padStart(2, '0').toUpperCase(),
  );
  const ascii = bytes
    .map((hex) => {
      const code = parseInt(hex, 16);
      return code >= 33 && code <= 126 ? String.fromCharCode(code) : '.';
    })
    .join('');
  return `${address}  ${bytes.slice(0, 8).join(' ')}  ${bytes.slice(8).join(' ')}   ${ascii}`;
}).join('\n');

interface VehicleData {
  brand: string;
  model: string;
  engine: string;
  fuelType: string;
  year: number;
  ecuType: string;
}

interface FieldErrors {
  brand?: TranslationKey;
  model?: TranslationKey;
  engine?: TranslationKey;
  ecuType?: TranslationKey;
  year?: TranslationKey;
  fuelType?: TranslationKey;
  file?: TranslationKey;
  services?: TranslationKey;
  name?: TranslationKey;
  email?: TranslationKey;
  consent?: TranslationKey;
  emission?: TranslationKey;
}

const isFilled = (value: string | number | undefined) => {
  if (typeof value === 'number') return value > 0;
  return Boolean(value && value.trim().length > 0);
};

const orderField =
  'input-field w-full !rounded-lg !border !border-primary/60 !bg-secondary !px-3 !py-2 text-sm text-foreground shadow-[0_0_14px_rgba(0,242,255,0.28)] transition-shadow placeholder:text-muted-foreground hover:!border-primary hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] focus:!border focus:!border-primary focus:!bg-primary/10 focus:shadow-[0_0_18px_rgba(0,242,255,0.5)] focus:outline-none';

const fieldClass = (_filled: boolean, hasError: boolean) => {
  if (hasError) {
    return 'input-field w-full !rounded-lg !border !border-red-500 !bg-secondary !px-3 !py-2 text-sm text-foreground shadow-[0_0_14px_rgba(239,68,68,0.28)] focus:!border focus:!border-red-500 focus:outline-none';
  }
  return orderField;
};

const categoryLabelKey = (category: string): TranslationKey | null => {
  if (category === 'Emission Control') return 'catEmission';
  if (category === 'Engine Functions') return 'catEngine';
  if (category === 'Performance') return 'catPerformance';
  if (category === 'Security') return 'catSecurity';
  return null;
};

const categoryTone = (category: string) => {
  if (category === 'Emission Control') return 'cat-emission';
  if (category === 'Engine Functions') return 'cat-engine';
  if (category === 'Performance') return 'cat-performance';
  if (category === 'Security') return 'cat-security';
  return 'cat-other';
};

const isTcuService = (service: { name: string; category: string }) =>
  service.category === 'Performance' && /\bTCU\b/i.test(service.name) && !isStageDropdownService(service) && !isLegacyStage1(service);

const headerControl =
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-primary/50 bg-secondary px-3 text-sm font-medium text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)] transition-colors hover:border-primary hover:bg-primary/20 hover:shadow-[0_0_16px_rgba(0,242,255,0.5)]';

const headerControlActive =
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-primary bg-primary/20 px-3 text-sm font-medium text-primary shadow-[0_0_18px_rgba(0,242,255,0.5)] transition-colors';

type PortalView = 'new' | 'orders' | 'profile' | 'invoices';

const portalPath = (view: PortalView) =>
  view === 'orders' ? '/objednavky' : view === 'profile' ? '/profil' : view === 'invoices' ? '/faktury' : '/';

const portalFromPath = (pathname: string): PortalView =>
  pathname === '/objednavky' ? 'orders' : pathname === '/profil' ? 'profile' : pathname === '/faktury' ? 'invoices' : 'new';

const orderRefFromSearch = (search: string) => {
  const query = search.includes('?') ? search.slice(search.indexOf('?')) : '';
  if (!query) return '';
  const params = new URLSearchParams(query);
  return (params.get('orderId') || params.get('order') || '').trim();
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const EMPTY_VEHICLE: VehicleData = {
  brand: '',
  model: '',
  engine: '',
  fuelType: '',
  year: 0,
  ecuType: '',
};

const ORDER_DRAFT_KEY = 'remappro-order-draft';

interface OrderDraftFile {
  name: string;
  size: number;
}

interface OrderDraft {
  vehicle: VehicleData;
  services: string[];
  customerNote: string;
  file: OrderDraftFile | null;
}

const vehicleFromDraft = (value: unknown): VehicleData => {
  if (!value || typeof value !== 'object') return { ...EMPTY_VEHICLE };
  const source = value as Record<string, unknown>;
  const year = typeof source.year === 'number' && Number.isFinite(source.year) ? source.year : 0;
  return {
    brand: typeof source.brand === 'string' ? source.brand : '',
    model: typeof source.model === 'string' ? source.model : '',
    engine: typeof source.engine === 'string' ? source.engine : '',
    fuelType: typeof source.fuelType === 'string' ? source.fuelType : '',
    year,
    ecuType: typeof source.ecuType === 'string' ? source.ecuType : '',
  };
};

const fileFromDraft = (value: unknown): OrderDraftFile | null => {
  if (!value || typeof value !== 'object') return null;
  const source = value as Record<string, unknown>;
  if (typeof source.name !== 'string' || !source.name.trim()) return null;
  if (typeof source.size !== 'number' || !Number.isFinite(source.size) || source.size < 0) return null;
  return { name: source.name.slice(0, 260), size: source.size };
};

const readOrderDraft = (): OrderDraft | null => {
  try {
    const raw = sessionStorage.getItem(ORDER_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const source = parsed as Record<string, unknown>;
    const services = Array.isArray(source.services)
      ? source.services.filter((id): id is string => typeof id === 'string' && id.trim().length > 0).slice(0, 100)
      : [];
    return {
      vehicle: vehicleFromDraft(source.vehicle),
      services,
      customerNote: typeof source.customerNote === 'string' ? source.customerNote.slice(0, 500) : '',
      file: fileFromDraft(source.file),
    };
  } catch {
    return null;
  }
};

const writeOrderDraft = (draft: OrderDraft) => {
  try {
    sessionStorage.setItem(ORDER_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // Storage can be blocked; the form still works for this visit.
  }
};

const clearOrderDraft = () => {
  try {
    sessionStorage.removeItem(ORDER_DRAFT_KEY);
  } catch {
    // Storage can be blocked; nothing else depends on the delete.
  }
};

const isBlankDraft = (draft: OrderDraft) => {
  const { vehicle } = draft;
  return (
    !vehicle.brand.trim() &&
    !vehicle.model.trim() &&
    !vehicle.engine.trim() &&
    !vehicle.ecuType.trim() &&
    !vehicle.fuelType.trim() &&
    !(vehicle.year > 0) &&
    draft.services.length === 0 &&
    !draft.customerNote.trim() &&
    !draft.file
  );
};

const OrderPage = () => {
  const { language, setLanguage, t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const languageSyncUser = useRef('');
  const activeVisitUser = useRef('');
  const visitSessionOpen = useRef(false);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [operationClosed, setOperationClosed] = useState(false);
  const { online: operationOnline, ready: operationReady } = useSystemOnline();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const connected = useClientPresence(authUser?.id ?? null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [billing, setBilling] = useState<ClientBilling>(emptyBilling);
  const [profileReady, setProfileReady] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const portalView: PortalView = portalFromPath(location.pathname);
  const linkedOrder = orderRefFromSearch(location.search) || orderRefFromSearch(window.location.search);
  const showOrders = portalView === 'orders' || Boolean(linkedOrder);
  const [authReady, setAuthReady] = useState(false);
  const orderLinkPrompted = useRef(false);
  const creditTopUpInflight = useRef<string | null>(null);
  const setPortalView = (view: PortalView) => {
    const next = portalPath(view);
    if (location.pathname !== next || (view !== 'orders' && location.search)) navigate(next);
  };

  useEffect(() => {
    const fromRoute = orderRefFromSearch(location.search);
    const fromPage = orderRefFromSearch(window.location.search);
    const id = fromRoute || fromPage;
    if (!id) return;
    if (location.pathname === '/objednavky' && fromRoute === id) return;
    if (fromPage && window.location.search) {
      const hash = `#/objednavky?order=${encodeURIComponent(id)}`;
      window.history.replaceState(null, '', `${window.location.pathname}${hash}`);
    }
    navigate({ pathname: '/objednavky', search: `?order=${encodeURIComponent(id)}` }, { replace: true });
  }, [location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!linkedOrder || !authReady || authUser || orderLinkPrompted.current) return;
    orderLinkPrompted.current = true;
    setAuthMode('sign-in');
    setLoginError('');
    setLoginOpen(true);
  }, [linkedOrder, authReady, authUser]);
  const [topUpOpen, setTopUpOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up' | 'reset'>('sign-in');
  const [loginFirstName, setLoginFirstName] = useState('');
  const [loginLastName, setLoginLastName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(() => authRemembered());
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [legalConsentAgreed, setLegalConsentAgreed] = useState(false);
  const [emissionAck, setEmissionAck] = useState(false);
  const [confirmGate, setConfirmGate] = useState<null | { consent: boolean; emission: boolean }>(null);
  const [serviceNotice, setServiceNotice] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [vehicle, setVehicle] = useState<VehicleData>(() => readOrderDraft()?.vehicle ?? { ...EMPTY_VEHICLE });
  const [services, setServices] = useState<string[]>(() => readOrderDraft()?.services ?? []);
  const knownCatalog = peekServiceCatalog();
  const [catalog, setCatalog] = useState<CatalogService[]>(knownCatalog ?? []);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>(knownCatalog ? 'ready' : 'loading');
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [panelMax, setPanelMax] = useState<number | null>(null);
  const checkoutRef = useRef<HTMLDivElement>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [pendingFile, setPendingFile] = useState<OrderDraftFile | null>(() => readOrderDraft()?.file ?? null);
  const [customerNote, setCustomerNote] = useState(() => readOrderDraft()?.customerNote ?? '');

  const dragDepth = useRef(0);
  const profileRequest = useRef(0);

  useEffect(() => {
    const file = selectedFile ? { name: selectedFile.name, size: selectedFile.size } : pendingFile;
    const draft: OrderDraft = { vehicle, services, customerNote, file };
    if (isBlankDraft(draft)) clearOrderDraft();
    else writeOrderDraft(draft);
  }, [vehicle, services, customerNote, selectedFile, pendingFile]);

  useEffect(() => {
    if (portalView !== 'new') return;
    let active = true;
    let timer = 0;
    let running = false;
    let again = false;
    const refresh = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!active) return;
        if (running) {
          again = true;
          return;
        }
        running = true;
        loadServiceCatalog()
          .then((next) => {
            if (!active) return;
            setCatalog(next);
            setCatalogStatus('ready');
            setServices((current) => current.filter((id) => {
              const service = next.find((item) => item.id === id);
              return Boolean(service) && !isLegacyStage1(service!);
            }));
          })
          .catch(() => {
            if (!active) return;
            setCatalogStatus((current) => (current === 'ready' ? current : 'error'));
          })
          .finally(() => {
            running = false;
            if (again && active) {
              again = false;
              refresh();
            }
          });
      }, 40);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    const unsubscribe = subscribeServiceCatalog(refresh);
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      active = false;
      window.clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [portalView]);

  useEffect(() => {
    let active = true;
    const applyAccount = (user: User | null) => {
      if (!user) {
        setProfileReady(false);
        setBilling(emptyBilling());
        return;
      }
      setBilling((current) => {
        if (current.email || !user.email) return current;
        return { ...current, email: user.email };
      });
    };
    const applyLanguage = (user: User | null) => {
      if (!user) {
        languageSyncUser.current = '';
        return;
      }
      if (languageSyncUser.current === user.id) return;
      languageSyncUser.current = user.id;
      void syncAccountLanguage(user, setLanguage);
    };
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const user = data.session?.user ?? null;
      setAuthUser(user);
      applyAccount(user);
      applyLanguage(user);
      setAuthReady(true);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      const user = session?.user ?? null;
      setAuthUser(user);
      applyAccount(user);
      applyLanguage(user);
      setAuthReady(true);
      if (event === 'SIGNED_OUT') {
        visitSessionOpen.current = false;
        releasePortalVisit(activeVisitUser.current);
        activeVisitUser.current = '';
        return;
      }
      const email = user?.email?.trim();
      if (event === 'INITIAL_SESSION') {
        visitSessionOpen.current = Boolean(user && email);
        if (!user || !email) return;
        activeVisitUser.current = user.id;
        trackPortalAuth('INITIAL_SESSION', user.id, email);
        return;
      }
      if (event !== 'SIGNED_IN' || !user || !email) return;
      const newLogin = !visitSessionOpen.current;
      visitSessionOpen.current = true;
      activeVisitUser.current = user.id;
      if (!newLogin) return;
      releasePortalVisit(user.id);
      trackPortalAuth('SIGNED_IN', user.id, email);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const user = authUser;
    const request = ++profileRequest.current;
    let active = true;
    const loadProfile = async () => {
      let next = await loadClientBilling(user);
      if (!next && active) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        if (!active || profileRequest.current !== request) return;
        next = await loadClientBilling(user);
      }
      if (!active || profileRequest.current !== request || !next) return;
      setBilling(next);
      setProfileReady(true);
    };
    void loadProfile();
    return () => {
      active = false;
    };
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser || portalView !== 'profile') return;
    const user = authUser;
    const request = ++profileRequest.current;
    let active = true;
    const loadProfile = async () => {
      const next = await loadClientBilling(user);
      if (!active || profileRequest.current !== request || !next) return;
      setBilling(next);
      setProfileReady(true);
    };
    void loadProfile();
    return () => {
      active = false;
    };
  }, [authUser?.id, portalView]);

  useEffect(() => {
    if (!authUser || !profileReady) return;
    const userId = authUser.id;
    const snapshot = billing;
    const handle = window.setTimeout(() => {
      void saveClientBilling(userId, snapshot, { preserveExisting: true });
    }, 700);
    return () => window.clearTimeout(handle);
  }, [authUser?.id, billing, profileReady]);

  useEffect(() => {
    if (!authReady || !authUser) return;
    const params = new URLSearchParams(location.search);
    const sessionId = (params.get('credit_session') || '').trim();
    if (!sessionId.startsWith('cs_')) return;
    if (creditTopUpInflight.current === sessionId) return;
    creditTopUpInflight.current = sessionId;
    let active = true;
    void (async () => {
      try {
        const invoked = await supabase.functions.invoke('confirm-credit-topup', {
          body: { sessionId },
        });
        let data = invoked.data as { ok?: boolean; balance?: number; code?: string } | null;
        if (invoked.error && !data) {
          try {
            data = await (invoked.error as { context?: Response }).context?.json();
          } catch {
            data = null;
          }
        }
        if (!active) return;
        if (data?.ok && Number.isFinite(Number(data.balance))) {
          setCreditBalance(Number(data.balance));
          toast.success(t('topUpSuccess'));
        } else {
          toast.error(t('topUpFailed'));
        }
      } catch {
        if (active) toast.error(t('topUpFailed'));
      } finally {
        if (!active) return;
        const next = new URLSearchParams(location.search);
        next.delete('credit_session');
        const search = next.toString();
        navigate({ pathname: location.pathname, search: search ? `?${search}` : '' }, { replace: true });
      }
    })();
    return () => {
      active = false;
      if (creditTopUpInflight.current === sessionId) creditTopUpInflight.current = null;
    };
  }, [authReady, authUser?.id, location.pathname, location.search, navigate]);

  useEffect(() => {
    if (!authUser) {
      setCreditBalance(null);
      return;
    }
    let active = true;
    readCreditBalance(authUser.id).then((balance) => {
      if (!active) return;
      setCreditBalance(Number.isFinite(balance) ? balance : 0);
    });
    return () => {
      active = false;
    };
  }, [authUser]);

  useEffect(() => {
    if (!authUser) return;
    const channel = supabase
      .channel(`credit-account-${authUser.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'credit_accounts', filter: `user_id=eq.${authUser.id}` },
        (payload) => {
          const next = Number((payload.new as { balance?: number }).balance);
          if (Number.isFinite(next)) setCreditBalance(next);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [authUser]);

  useEffect(() => {
    if (!loginOpen) {
      setShowPassword(false);
      return;
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLoginOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginOpen]);

  useEffect(() => {
    if (!languageOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!languageMenuRef.current?.contains(event.target as Node)) setLanguageOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLanguageOpen(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [languageOpen]);

  const accountLabel = accountDisplayName({
    name: joinProfileName(billing.firstName, billing.lastName),
    email: authUser?.email || billing.email,
    company: billing.company || companyFromMetadata(authUser?.user_metadata),
  });

  const updateBilling = (next: ClientBilling) => {
    setBilling(next);
    setErrors((current) => {
      if (!current.name && !current.email) return current;
      const cleared = { ...current };
      delete cleared.name;
      delete cleared.email;
      return cleared;
    });
  };

  const saveProfile = async () => {
    if (!authUser) return false;
    const email = billing.email.trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      toast.error(t('profileEmailInvalid'));
      return false;
    }
    setProfileSaving(true);
    const saved = await saveClientBilling(authUser.id, billing);
    if (!saved.ok) {
      setProfileSaving(false);
      toast.error(t('profileSaveFailed'));
      return false;
    }
    const currentEmail = (authUser.email ?? '').trim().toLowerCase();
    const emailChanged = Boolean(email) && email.toLowerCase() !== currentEmail;
    const { error: accountError } = await supabase.auth.updateUser({
      ...(emailChanged ? { email } : {}),
      data: {
        first_name: billing.firstName.trim(),
        last_name: billing.lastName.trim(),
        full_name: joinProfileName(billing.firstName, billing.lastName),
        company: billing.company.trim(),
      },
    });
    setProfileSaving(false);
    setProfileReady(true);
    if (accountError && emailChanged) {
      toast.error(t('profileEmailFailed'));
      return true;
    }
    toast.success(emailChanged ? t('profileEmailConfirm') : t('profileSaved'));
    return true;
  };

  const showCreditBalance = () => {
    document.getElementById('order-credit-balance')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const openCreditTopUp = () => {
    if (!authUser) {
      setLoginError('');
      setAuthMode('sign-in');
      setLoginOpen(true);
      return;
    }
    if (operationReady && !operationOnline && !isPortalAdmin(authUser)) {
      setOperationClosed(true);
      return;
    }
    setTopUpOpen(true);
  };

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');
    setLoginBusy(true);
    const previousRemember = authRemembered();
    setAuthRemember(rememberMe);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
    if (error) setAuthRemember(previousRemember);
    setLoginBusy(false);
    if (error) {
      setLoginError(t('signInFailed'));
      return;
    }
    setLoginPassword('');
    setLoginOpen(false);
    toast.success(t('signInSuccess'));
  };

  const signUp = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');
    const first = loginFirstName.trim();
    const last = loginLastName.trim();
    if (!first || !last) {
      setLoginError(t('signUpNameRequired'));
      return;
    }
    setLoginBusy(true);
    const email = loginEmail.trim();
    const fullName = joinProfileName(first, last);
    const { data, error } = await supabase.auth.signUp({
      email,
      password: loginPassword,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          first_name: first,
          last_name: last,
          full_name: fullName,
        },
      },
    });
    const alreadyExists = Boolean(data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0)
      || /already registered|already exists/i.test(error?.message ?? '');
    if (error || alreadyExists) {
      setLoginBusy(false);
      setLoginError(alreadyExists ? t('signUpExists') : t('signUpFailed'));
      return;
    }
    if (data.session && data.user) {
      const nextBilling = {
        ...emptyBilling(),
        firstName: first,
        lastName: last,
        email,
      };
      await saveClientBilling(data.user.id, nextBilling);
      setBilling(nextBilling);
      setLoginPassword('');
      setLoginOpen(false);
      setLoginBusy(false);
      toast.success(t('signUpSuccess'));
      return;
    }
    setLoginBusy(false);
    setLoginPassword('');
    setAuthMode('sign-in');
    toast.success(t('signUpConfirm'));
  };

  const sendReset = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');
    const email = loginEmail.trim();
    if (!email) {
      setLoginError(t('forgotPasswordFailed'));
      return;
    }
    setLoginBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/`,
    });
    setLoginBusy(false);
    if (error) {
      setLoginError(t('forgotPasswordFailed'));
      return;
    }
    setAuthMode('sign-in');
    toast.success(t('forgotPasswordSent'));
  };

  const signOut = async () => {
    await supabase.auth.signOut();
    setCreditBalance(null);
    setBilling(emptyBilling());
    setPortalView('new');
  };

  const catalogGroups = useMemo(() => groupCatalog(catalog), [catalog]);
  const stageGroups = useMemo(() => stageGroupsFromCatalog(catalog), [catalog]);
  const checkoutRolls = useMemo(() => {
    const rolls: Array<{
      id: string;
      tone: string;
      labelKey: TranslationKey | null;
      stageId?: string;
      items?: CatalogService[];
    }> = [];
    for (const group of catalogGroups) {
      if (group.category !== 'Performance') {
        rolls.push({
          id: group.category,
          tone: categoryTone(group.category),
          labelKey: categoryLabelKey(group.category),
          items: group.items,
        });
        continue;
      }
      for (const stage of stageGroups) {
        const petrol = stage.id === 'stage1-petrol';
        rolls.push({
          id: stage.id,
          tone: petrol ? 'cat-stage-petrol' : 'cat-stage-diesel',
          labelKey: petrol ? 'catStagePetrol' : 'catStageDiesel',
          stageId: stage.id,
        });
      }
      const tcuItems = group.items.filter(isTcuService);
      if (tcuItems.length > 0) {
        rolls.push({ id: 'tcu', tone: 'cat-tcu', labelKey: 'catTcu', items: tcuItems });
      }
      const rest = group.items.filter(
        (service) => !isLegacyStage1(service) && !isStageDropdownService(service) && !isTcuService(service),
      );
      if (rest.length > 0) {
        rolls.push({
          id: group.category,
          tone: 'cat-performance',
          labelKey: 'catPerformance',
          items: rest,
        });
      }
    }
    return rolls;
  }, [catalogGroups, stageGroups]);

  useEffect(() => {
    const dieselIds = new Set(
      stageGroups.find((group) => group.id === 'stage1-diesel')?.options.map((option) => option.id) ?? [],
    );
    const petrolIds = new Set(
      stageGroups.find((group) => group.id === 'stage1-petrol')?.options.map((option) => option.id) ?? [],
    );
    if (dieselIds.size === 0 || petrolIds.size === 0) return;
    setServices((current) => {
      let lastDiesel = -1;
      let lastPetrol = -1;
      current.forEach((id, index) => {
        if (dieselIds.has(id)) lastDiesel = index;
        if (petrolIds.has(id)) lastPetrol = index;
      });
      if (lastDiesel < 0 || lastPetrol < 0) return current;
      const drop = lastDiesel > lastPetrol ? petrolIds : dieselIds;
      return current.filter((id) => !drop.has(id));
    });
  }, [stageGroups]);

  useLayoutEffect(() => {
    if (!openCategory) {
      setPanelMax(null);
      return;
    }
    const measure = () => {
      const card = checkoutRef.current;
      const head = card?.querySelector<HTMLElement>('.order-roletka.is-open .order-roletka-head');
      if (!card || !head) return;
      const next = Math.max(0, Math.floor(card.getBoundingClientRect().bottom - head.getBoundingClientRect().bottom));
      setPanelMax((current) => (current === next ? current : next));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [openCategory]);

  const selectedItems = useMemo(
    () =>
      services
        .map((id) => catalog.find((service) => service.id === id))
        .filter((service): service is CatalogService => Boolean(service) && !isLegacyStage1(service)),
    [services, catalog],
  );

  const totalPrice = selectedItems.reduce((total, service) => total + service.price, 0);
  const needsTopUp = creditBalance !== null && (creditBalance <= 0 || creditBalance < totalPrice);
  const emissionSelected = selectedItems.some((service) => service.category === 'Emission Control');

  useEffect(() => {
    if (emissionSelected) return;
    setEmissionAck(false);
    setConfirmGate((current) => {
      if (!current?.emission) return current;
      const next = { ...current, emission: false };
      return next.consent ? next : null;
    });
  }, [emissionSelected]);

  const setVehicleField = (field: keyof VehicleData, value: string | number) => {
    setVehicle((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const clearServiceError = () => {
    setErrors((current) => {
      if (!current.services) return current;
      const next = { ...current };
      delete next.services;
      return next;
    });
  };

  const toggleService = (serviceId: string) => {
    setServices((current) =>
      current.includes(serviceId) ? current.filter((id) => id !== serviceId) : [...current, serviceId],
    );
    clearServiceError();
  };

  const selectStage = (groupId: string, optionId: string) => {
    const group = stageGroups.find((item) => item.id === groupId);
    if (!group) return;
    const memberIds = new Set(group.options.map((option) => option.id));
    if (optionId && (groupId === 'stage1-diesel' || groupId === 'stage1-petrol')) {
      const otherId = groupId === 'stage1-diesel' ? 'stage1-petrol' : 'stage1-diesel';
      stageGroups.find((item) => item.id === otherId)?.options.forEach((option) => memberIds.add(option.id));
    }
    setServices((current) => {
      const next = current.filter((id) => !memberIds.has(id));
      if (optionId) next.push(optionId);
      return next;
    });
    clearServiceError();
  };

  const clearFileError = () => {
    setErrors((current) => {
      if (!current.file) return current;
      const next = { ...current };
      delete next.file;
      return next;
    });
  };

  const acceptFile = (file: File | undefined) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    const allowed = ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
    if (!allowed) {
      setSelectedFile(null);
      setPendingFile(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      setErrors((current) => ({ ...current, file: 'errorFileType' }));
      toast.error(t('toastBadFile'));
      return;
    }
    setSelectedFile(file);
    setPendingFile(null);
    clearFileError();
  };

  const orderEmail = (source: ClientBilling) => {
    const profileEmail = source.email.trim();
    const accountEmail = (authUser?.email ?? '').trim();
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileEmail)) return profileEmail;
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) return accountEmail;
    return profileEmail || accountEmail;
  };

  const validate = (source: ClientBilling = billing): FieldErrors => {
    const next: FieldErrors = {};
    if (!vehicle.brand.trim()) next.brand = 'errorBrand';
    if (!vehicle.model.trim()) next.model = 'errorModel';
    if (!vehicle.engine.trim()) next.engine = 'errorEngine';
    if (!vehicle.ecuType.trim()) next.ecuType = 'errorEcu';
    if (!vehicle.year || vehicle.year < 1900 || vehicle.year > 2100) next.year = 'errorYear';
    if (vehicle.fuelType !== 'Diesel' && vehicle.fuelType !== 'Petrol') next.fuelType = 'errorFuel';
    if (!selectedFile) next.file = 'errorFile';
    if (services.length === 0) next.services = 'errorServices';
    if (authUser) {
      if (!orderDisplayName(source)) next.name = 'errorName';
      const email = orderEmail(source);
      if (!email) next.email = 'errorEmail';
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = 'errorEmailInvalid';
    }
    if (!legalConsentAgreed) next.consent = 'errorConsent';
    if (emissionSelected && !emissionAck) next.emission = 'errorEmissionAck';
    return next;
  };

  const composedNote = [vehicle.engine.trim() ? `Motor: ${vehicle.engine.trim()}` : '', customerNote.trim()]
    .filter(Boolean)
    .join('\n');

  const resetOrderDraft = () => {
    clearOrderDraft();
    setVehicle({ ...EMPTY_VEHICLE });
    setServices([]);
    setSelectedFile(null);
    setPendingFile(null);
    setCustomerNote('');
    setErrors({});
    setLegalConsentAgreed(false);
    setEmissionAck(false);
    setConfirmGate(null);
    setIsDragging(false);
    dragDepth.current = 0;
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const queueTelegramNotice = (orderId?: string | null, orderNumber?: string | null) => {
    void (async () => {
      try {
        let id = String(orderId ?? '').trim();
        if (!/^[0-9a-f-]{36}$/i.test(id) && orderNumber) {
          const found = await supabase.from('orders').select('id').eq('order_number', orderNumber).maybeSingle();
          id = String(found.data?.id ?? '').trim();
        }
        if (!/^[0-9a-f-]{36}$/i.test(id)) return;
        await supabase.functions.invoke('notify-order', { body: { orderId: id } });
      } catch {
        // The order and the credit charge are already stored.
      }
    })();
  };

  const requestCheckout = () => {
    if (operationReady && !operationOnline && !isPortalAdmin(authUser)) {
      setOperationClosed(true);
      return;
    }
    if (needsTopUp) {
      openCreditTopUp();
      return;
    }
    if (services.length === 0) {
      setErrors((current) => {
        if (!current.services) return current;
        const next = { ...current };
        delete next.services;
        return next;
      });
      setServiceNotice(true);
      return;
    }
    const emissionOffroadConsent = Boolean(emissionSelected && emissionAck);
    const needConsent = !legalConsentAgreed;
    const needEmission = emissionSelected && !emissionOffroadConsent;
    if (needConsent || needEmission) {
      setConfirmGate({ consent: needConsent, emission: needEmission });
      return;
    }
    void payWithCredits(emissionOffroadConsent);
  };

  const payWithCredits = async (emissionOffroadConsent: boolean) => {
    const freshStatus = await fetchSystemSettings();
    const operationOpen = freshStatus
      ? isSystemOnline(freshStatus.mode, freshStatus.schedule)
      : operationOnline;
    if (!operationOpen && !isPortalAdmin(authUser)) {
      setOperationClosed(true);
      return;
    }
    let source = billing;
    if (authUser && !profileReady) {
      const loaded = await loadClientBilling(authUser);
      if (loaded) {
        source = loaded;
        setBilling(loaded);
        setProfileReady(true);
      }
    }
    const nextErrors = validate(source);
    const missingService = Boolean(nextErrors.services);
    if (missingService) delete nextErrors.services;
    setErrors(nextErrors);
    if (missingService) setServiceNotice(true);
    if (missingService || Object.keys(nextErrors).length > 0) {
      const profileMissing = Boolean(nextErrors.name || nextErrors.email);
      const formInvalid = Object.keys(nextErrors).some((key) => key !== 'name' && key !== 'email');
      if (profileMissing) toast.error(t('profileOrderRequired'));
      if (formInvalid) toast.error(t('toastCheckFields'));
      return;
    }
    if (!authUser) {
      toast.error(t('creditAuthRequired'));
      return;
    }
    const available = await readCreditBalance(authUser.id);
    setCreditBalance(Number.isFinite(available) ? available : 0);
    if (!Number.isFinite(available) || available < totalPrice) {
      openCreditTopUp();
      return;
    }
    if (!selectedFile) return;

    setIsSubmitting(true);
    try {
      toast.loading(t('toastUploading'), { id: 'upload' });
      let storedFile = '';
      try {
        storedFile = await uploadOrderFile(selectedFile, authUser.id);
      } catch (uploadError) {
        toast.dismiss('upload');
        const message = uploadError instanceof Error ? uploadError.message : '';
        toast.error(`${t('toastUploadFailed')}: ${message || t('toastUploadSaved')}`);
        setIsSubmitting(false);
        return;
      }
      if (!storedFile) {
        toast.dismiss('upload');
        toast.error(`${t('toastUploadFailed')}: ${t('toastUploadSaved')}`);
        setIsSubmitting(false);
        return;
      }
      toast.dismiss('upload');

      const profileForOrder = { ...source, email: orderEmail(source) };
      const savedProfile = await saveClientBilling(authUser.id, profileForOrder);
      if (!savedProfile.ok) {
        toast.error(t('creditPayFailed'));
        setIsSubmitting(false);
        return;
      }
      await supabase.auth.updateUser({
        data: {
          first_name: source.firstName.trim(),
          last_name: source.lastName.trim(),
          full_name: joinProfileName(source.firstName, source.lastName),
          company: source.company.trim(),
        },
      }).catch(() => undefined);

      const termsText = `${t('consentLead')} ${t('consentTerms')}, ${t('consentPrivacy')} ${t('consentAnd')} ${t('consentRefunds')}${t('consentTail')}`;
      const consentScope = emissionOffroadConsent
        ? (language === 'en'
          ? 'Confirmed: terms and the emission off-road/motorsport/export declaration.'
          : 'Potvrdené: VOP a emisné off-road/motorsport/export vyhlásenie.')
        : (language === 'en'
          ? 'Confirmed: terms only.'
          : 'Potvrdené: len VOP.');
      const emissionText = emissionOffroadConsent
        ? `${t('emissionNoticeTitle')}. ${t('offroadDisclaimer')} ${t('emissionNoticeConfirm')}`
        : '';
      const consentSummary = [consentScope, termsText, emissionText].filter(Boolean).join('\n');

      const invoked = await supabase.functions.invoke('pay-with-credits', {
        body: {
          serviceIds: services,
          customerName: orderDisplayName(source),
          customerEmail: profileForOrder.email,
          brand: vehicle.brand,
          model: vehicle.model,
          fuelType: vehicle.fuelType,
          year: vehicle.year,
          ecuType: vehicle.ecuType,
          fileUrl: storedFile,
          customerNote: composedNote,
          legalConsent: legalConsentAgreed,
          legal_consent: legalConsentAgreed,
          emissionOffroadConsent,
          emission_offroad_consent: emissionOffroadConsent,
          emissionAck: emissionOffroadConsent,
          consentSummary,
          consent_summary: consentSummary,
          consent: {
            legalConsent: legalConsentAgreed,
            emissionOffroadConsent,
            consentSummary,
          },
          language: language === 'en' ? 'EN' : 'SK',
        },
      });

      let data = invoked.data as {
        ok?: boolean;
        code?: string;
        balance?: number;
        orderNumber?: string;
        orderId?: string;
        telegramScheduled?: boolean;
      } | null;
      if (invoked.error && !data) {
        try {
          data = await (invoked.error as { context?: Response }).context?.json();
        } catch {
          data = null;
        }
      }
      const error = invoked.error;
      const code = data?.code;
      if (error || !data?.ok) {
        if (code === 'INSUFFICIENT_CREDITS') {
          openCreditTopUp();
          setIsSubmitting(false);
          return;
        }
        if (code === 'CONSENT_REQUIRED') {
          toast.error(t('errorConsent'));
          setIsSubmitting(false);
          return;
        }
        if (code === 'NOT_AUTHENTICATED') {
          toast.error(t('creditAuthRequired'));
          setIsSubmitting(false);
          return;
        }
        if (code === 'OFFLINE') {
          setOperationClosed(true);
          setIsSubmitting(false);
          return;
        }
        toast.error(t('creditPayFailed'));
        setIsSubmitting(false);
        return;
      }

      if (!data.telegramScheduled) queueTelegramNotice(data.orderId, data.orderNumber);
      setCreditBalance(Number(data.balance));
      resetOrderDraft();
      toast.success(t('creditPaid', { order: data.orderNumber }));
      setIsSubmitting(false);
    } catch {
      toast.dismiss('upload');
      toast.error(t('creditPayFailed'));
      setIsSubmitting(false);
    }
  };

  const newOrderFit = !showOrders && portalView === 'new';
  const invoicesFit = portalView === 'invoices' && Boolean(authUser);

  return (
    <div className={`relative flex w-full min-w-0 flex-col overflow-x-clip bg-background ${invoicesFit ? 'h-full min-h-0 flex-1 overflow-hidden' : 'flex-grow'} ${newOrderFit ? 'lg:h-[calc(100dvh-4.25rem)] lg:max-h-[calc(100dvh-4.25rem)] lg:overflow-hidden' : ''}`}>
      <div className="order-hex-layer" aria-hidden="true">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <pre className="w-1/2">{HEX_DUMP}</pre>
          <pre className="w-1/2">{HEX_DUMP}</pre>
        </div>
      </div>

      <div className={`relative z-10 flex w-full min-h-0 flex-col ${invoicesFit ? 'h-full flex-1 overflow-hidden' : 'flex-grow'} ${newOrderFit ? 'lg:min-h-0 lg:overflow-hidden' : ''}`}>
        <header className="sticky top-0 z-40 w-full border-b border-primary/25">
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-background/80 backdrop-blur-sm" />
          <div className="relative mx-auto flex w-full max-w-[1600px] flex-nowrap items-center gap-2 px-4 py-3 sm:gap-3 lg:px-8">
            <div className="flex shrink-0 items-center gap-2 sm:gap-6 max-sm:[&_a>span:last-child]:hidden">
              <NavLogo />
              <SystemStatus />
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-center px-1">
              {operationReady && !operationOnline && isPortalAdmin(authUser) && (
                <p
                  className="inline-flex h-8 max-w-full min-w-0 items-center rounded-full border border-orange-400/60 bg-black/50 px-4 text-[11px] font-medium leading-none text-orange-200"
                  title={t('offlineAdminAccess')}
                >
                  <span className="truncate">{t('offlineAdminAccess')}</span>
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
              <div ref={languageMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={languageOpen}
                  aria-label={t('language')}
                  onClick={() => setLanguageOpen((open) => !open)}
                  className={languageOpen ? headerControlActive : headerControl}
                >
                  <span className="w-6 uppercase tracking-wide">{language}</span>
                  <span className="hidden whitespace-nowrap sm:inline">{language === 'en' ? 'English' : 'Slovenčina'}</span>
                  <ChevronDown className={`h-4 w-4 transition-transform ${languageOpen ? 'rotate-180' : ''}`} />
                </button>
                {languageOpen && (
                  <div
                    role="listbox"
                    aria-label={t('language')}
                    className="absolute right-0 top-[calc(100%+0.375rem)] z-50 min-w-full overflow-hidden rounded-lg border border-primary/50 bg-secondary py-1 shadow-[0_0_16px_rgba(0,242,255,0.35)]"
                  >
                    {([
                      ['sk', 'Slovenčina'],
                      ['en', 'English'],
                    ] as const).map(([code, label]) => {
                      const selected = language === code;
                      return (
                        <button
                          key={code}
                          type="button"
                          role="option"
                          aria-selected={selected}
                          onClick={() => {
                            setLanguage(code);
                            setLanguageOpen(false);
                            if (authUser) void saveProfileLanguage(authUser.id, code === 'en' ? 'EN' : 'SK');
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors ${
                            selected
                              ? 'bg-primary/20 text-primary'
                              : 'text-primary/80 hover:bg-primary/15 hover:text-primary'
                          }`}
                        >
                          <span className="w-6 uppercase tracking-wide">{code}</span>
                          <span className="whitespace-nowrap">{label}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {authUser ? (
                <div className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-primary/50 bg-secondary px-2 py-0.5 text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)]">
                  <ConnectionDot
                    online={connected}
                    label={connected ? t('connectionOnline') : t('connectionOffline')}
                  />
                  <button
                    type="button"
                    onClick={() => setPortalView('profile')}
                    className="max-w-[9rem] truncate text-sm font-medium leading-none text-primary transition-colors hover:text-foreground"
                    title={t('myProfile')}
                  >
                    {accountLabel || '—'}
                  </button>
                  <span className="h-4 w-px shrink-0 bg-primary/50" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={showCreditBalance}
                    className="shrink-0 whitespace-nowrap text-sm font-black leading-none tabular-nums neon-text sm:text-base"
                    aria-label={t('creditBalance')}
                  >
                    {creditBalance === null ? '—' : formatCreditUnits(creditBalance, language)}
                  </button>
                  <button
                    type="button"
                    onClick={signOut}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-primary/50 bg-secondary px-2.5 text-xs font-medium text-primary shadow-[0_0_12px_rgba(0,242,255,0.28)] transition-colors hover:border-primary hover:bg-primary/20"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    {t('signOut')}
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setLoginError('');
                    setAuthMode('sign-in');
                    setLoginOpen(true);
                  }}
                  className="inline-flex h-8 items-center gap-2 rounded-lg border border-primary/50 bg-secondary px-2.5 text-xs font-medium text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)] transition-colors hover:border-primary hover:bg-primary/20"
                >
                  <ConnectionDot online={false} label={t('connectionOffline')} />
                  {t('signIn')}
                </button>
              )}
              {authUser && (
                <button
                  type="button"
                  onClick={() => setPortalView('profile')}
                  aria-pressed={portalView === 'profile'}
                  className={portalView === 'profile' ? headerControlActive : headerControl}
                >
                  <UserRound className="h-4 w-4" />
                  {t('myProfile')}
                </button>
              )}
              {authUser && (
                <button
                  type="button"
                  onClick={() => setPortalView('orders')}
                  aria-pressed={portalView === 'orders'}
                  className={portalView === 'orders' ? headerControlActive : headerControl}
                >
                  <List className="h-4 w-4" />
                  {t('myOrders')}
                </button>
              )}
              {authUser && (
                <button
                  type="button"
                  onClick={() => setPortalView('invoices')}
                  aria-pressed={portalView === 'invoices'}
                  className={portalView === 'invoices' ? headerControlActive : headerControl}
                >
                  <FileText className="h-4 w-4" />
                  {t('myInvoices')}
                </button>
              )}
            </div>
          </div>
        </header>

        <div className={`mx-auto w-full max-w-[1600px] px-4 pt-2 lg:px-8 ${invoicesFit ? 'flex min-h-0 flex-1 flex-col overflow-hidden pb-2' : `flex-grow pb-6 ${newOrderFit ? 'lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden lg:pb-2' : ''}`}`}>
          {showOrders ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('myOrders')}</h1>
                {authUser ? (
                  <button
                    type="button"
                    onClick={() => setPortalView('new')}
                    className="inline-flex h-10 w-auto shrink-0 items-center justify-center gap-1.5 self-end rounded-lg border border-primary/70 bg-primary/15 px-3 text-sm font-bold text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)] transition-colors hover:bg-primary/25 sm:self-start"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    {t('backToNewOrder')}
                  </button>
                ) : null}
              </div>
              {authUser ? (
                <MyOrders email={authUser.email || billing.email} focusOrder={linkedOrder} />
              ) : authReady ? (
                <div className="rounded-xl border border-primary/40 bg-black/50 px-6 py-10 text-center shadow-[0_0_24px_rgba(0,242,255,0.16)]">
                  <p className="text-base text-foreground">{t('orderLinkSignIn')}</p>
                  <button
                    type="button"
                    onClick={() => {
                      setLoginError('');
                      setAuthMode('sign-in');
                      setLoginOpen(true);
                    }}
                    className="mt-5 inline-flex h-11 items-center rounded-lg border border-primary/70 bg-primary/15 px-5 text-sm font-bold text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)] hover:bg-primary/25"
                  >
                    {t('signIn')}
                  </button>
                </div>
              ) : null}
            </div>
          ) : portalView === 'invoices' && authUser ? (
            <div className="flex min-h-0 w-full flex-1 flex-col">
              <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('myInvoices')}</h1>
                <button
                  type="button"
                  onClick={() => setPortalView('new')}
                  className="inline-flex h-10 w-auto shrink-0 items-center justify-center gap-1.5 self-end rounded-lg border border-primary/70 bg-primary/15 px-3 text-sm font-bold text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)] transition-colors hover:bg-primary/25 sm:self-start"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('backToNewOrder')}
                </button>
              </div>
              <CreditPackageInvoices scope="client" />
            </div>
          ) : portalView === 'profile' && (authUser || !authReady) ? (
            authUser ? (
            <ClientProfile
              billing={billing}
              onBilling={updateBilling}
              onSave={saveProfile}
              saving={profileSaving}
              creditBalance={creditBalance}
              authEmail={authUser.email ?? billing.email}
              onBack={() => setPortalView('new')}
            />
            ) : null
          ) : (
          <>
          <div className="mb-2 flex shrink-0 flex-row flex-wrap items-baseline gap-x-4">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('newOrder')}</h1>
            <p className="text-sm text-muted-foreground">{t('newOrderSubtitle')}</p>
          </div>

          <div className="flex flex-col gap-5 lg:grid lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1.55fr)_minmax(18rem,1fr)] lg:gap-3 lg:overflow-hidden">
            <div className="min-w-0 space-y-4 lg:flex lg:min-h-0 lg:flex-col lg:gap-3 lg:space-y-0 lg:overflow-hidden">
              <section className="order-card-vehicle shrink-0 rounded-xl p-3 md:p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Car className="h-4 w-4 text-primary" />
                  <h2 className="text-base font-semibold uppercase leading-5 tracking-[0.16em] text-primary">{t('vehicleSpec')}</h2>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <Car className="h-3.5 w-3.5" /> {t('brand')}
                    </span>
                    <input
                      type="text"
                      value={vehicle.brand}
                      onChange={(event) => setVehicleField('brand', event.target.value)}
                      placeholder="Audi, BMW"
                      className={fieldClass(isFilled(vehicle.brand), Boolean(errors.brand))}
                    />
                    {errors.brand && <p className="mt-1 text-xs text-red-400">{t(errors.brand)}</p>}
                  </label>

                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('model')}</span>
                    <input
                      type="text"
                      value={vehicle.model}
                      onChange={(event) => setVehicleField('model', event.target.value)}
                      placeholder="A4, 320d"
                      className={fieldClass(isFilled(vehicle.model), Boolean(errors.model))}
                    />
                    {errors.model && <p className="mt-1 text-xs text-red-400">{t(errors.model)}</p>}
                  </label>

                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <Gauge className="h-3.5 w-3.5" /> {t('engine')}
                    </span>
                    <input
                      type="text"
                      value={vehicle.engine}
                      onChange={(event) => setVehicleField('engine', event.target.value)}
                      placeholder="2.0 TDI 110 kW"
                      className={fieldClass(isFilled(vehicle.engine), Boolean(errors.engine))}
                    />
                    {errors.engine && <p className="mt-1 text-xs text-red-400">{t(errors.engine)}</p>}
                  </label>

                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <Cpu className="h-3.5 w-3.5" /> {t('ecu')}
                    </span>
                    <input
                      type="text"
                      value={vehicle.ecuType}
                      onChange={(event) => setVehicleField('ecuType', event.target.value)}
                      placeholder="Bosch EDC17"
                      className={fieldClass(isFilled(vehicle.ecuType), Boolean(errors.ecuType))}
                    />
                    {errors.ecuType && <p className="mt-1 text-xs text-red-400">{t(errors.ecuType)}</p>}
                  </label>

                  <label className="block">
                    <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <Calendar className="h-3.5 w-3.5" /> {t('year')}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={1900}
                      max={2100}
                      value={vehicle.year || ''}
                      onChange={(event) => {
                        const raw = event.target.value;
                        if (raw === '') {
                          setVehicleField('year', 0);
                          return;
                        }
                        const parsed = parseInt(raw, 10);
                        if (!Number.isNaN(parsed)) setVehicleField('year', parsed);
                      }}
                      placeholder="2019"
                      className={`${fieldClass(isFilled(vehicle.year), Boolean(errors.year))} [appearance:textfield] [&::-webkit-outer-spin-button]:m-0 [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:m-0 [&::-webkit-inner-spin-button]:appearance-none`}
                    />
                    {errors.year && <p className="mt-1 text-xs text-red-400">{t(errors.year)}</p>}
                  </label>

                  <div>
                    <span className="mb-1.5 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      <Fuel className="h-3.5 w-3.5" /> {t('fuel')}
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      {([
                        ['Diesel', 'fuelDiesel'],
                        ['Petrol', 'fuelPetrol'],
                      ] as const).map(([value, labelKey]) => {
                        const active = vehicle.fuelType === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setVehicleField('fuelType', value)}
                            className={`h-[38px] rounded-lg border text-sm font-medium transition-colors ${
                              active
                                ? value === 'Diesel'
                                  ? 'border-[#38bdf8] bg-[linear-gradient(180deg,rgba(3,105,161,0.62),rgba(8,29,46,0.95))] text-white shadow-[0_0_22px_rgba(56,189,248,0.45),inset_0_0_12px_rgba(125,211,252,0.22)]'
                                  : 'border-[#facc15] bg-[linear-gradient(180deg,rgba(161,98,7,0.62),rgba(28,20,4,0.95))] text-[#fefce8] shadow-[0_0_22px_rgba(250,204,21,0.45),inset_0_0_12px_rgba(254,240,138,0.22)]'
                                : value === 'Diesel'
                                  ? 'border-[rgba(34,211,238,0.34)] bg-[linear-gradient(180deg,rgba(14,116,144,0.20),rgba(6,24,38,0.85))] text-[#bae6fd] shadow-[0_0_8px_rgba(34,211,238,0.10)] hover:border-[rgba(56,189,248,0.68)] hover:bg-[linear-gradient(180deg,rgba(2,132,199,0.36),rgba(7,33,52,0.90))] hover:text-[#e0f2fe] hover:shadow-[0_0_16px_rgba(56,189,248,0.28)]'
                                  : 'border-[rgba(234,179,8,0.34)] bg-[linear-gradient(180deg,rgba(161,98,7,0.20),rgba(24,18,5,0.85))] text-[#fef08a] shadow-[0_0_8px_rgba(234,179,8,0.10)] hover:border-[rgba(250,204,21,0.68)] hover:bg-[linear-gradient(180deg,rgba(202,138,4,0.36),rgba(34,24,6,0.90))] hover:text-[#fef9c3] hover:shadow-[0_0_16px_rgba(250,204,21,0.28)]'
                            } ${errors.fuelType ? '!border-red-500' : ''}`}
                          >
                            {t(labelKey)}
                          </button>
                        );
                      })}
                    </div>
                    {errors.fuelType && <p className="mt-1 text-xs text-red-400">{t(errors.fuelType)}</p>}
                  </div>
                </div>
              </section>

              <section className="order-card-file flex min-h-0 flex-col rounded-xl p-3 md:p-4 lg:flex-1 lg:overflow-hidden">
                <div className="mb-3 flex shrink-0 items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4 text-emerald-300" />
                    <h2 className="text-base font-semibold uppercase leading-5 tracking-[0.16em] text-emerald-300">{t('ecuFile')}</h2>
                  </div>
                  <div className="flex gap-1.5">
                    {['.BIN', '.ORI', '.MOD'].map((extension) => (
                      <span key={extension} className="order-ext-badge rounded-[5px] px-[7px] py-0.5 text-[11px] font-bold tracking-wide">
                        {extension}
                      </span>
                    ))}
                  </div>
                </div>

                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => fileInputRef.current?.click()}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    dragDepth.current += 1;
                    setIsDragging(true);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'copy';
                  }}
                  onDragLeave={(event) => {
                    event.preventDefault();
                    dragDepth.current = Math.max(0, dragDepth.current - 1);
                    if (dragDepth.current === 0) setIsDragging(false);
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    dragDepth.current = 0;
                    setIsDragging(false);
                    acceptFile(event.dataTransfer.files?.[0]);
                  }}
                  className={`order-file-drop group flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-lg border px-6 py-10 text-center transition-all lg:min-h-0 lg:flex-1 lg:py-4 ${
                    selectedFile || isDragging
                      ? 'border-solid border-[rgba(16,185,129,0.65)] bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.18),rgba(5,36,28,0.76))] shadow-[0_0_20px_rgba(16,185,129,0.2),inset_0_0_24px_rgba(16,185,129,0.15)] hover:border-[#10b981] hover:bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.28),rgba(5,46,36,0.82))] hover:shadow-[0_0_28px_rgba(16,185,129,0.36),inset_0_0_30px_rgba(16,185,129,0.22)]'
                      : errors.file
                        ? 'border-solid border-[rgba(239,68,68,0.65)] bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.18),rgba(45,10,14,0.76))] shadow-[0_0_20px_rgba(239,68,68,0.2),inset_0_0_24px_rgba(239,68,68,0.15)] hover:border-[#ef4444] hover:bg-[radial-gradient(circle_at_center,rgba(239,68,68,0.28),rgba(62,12,18,0.82))] hover:shadow-[0_0_28px_rgba(239,68,68,0.36),inset_0_0_30px_rgba(239,68,68,0.22)]'
                        : 'border-dashed border-[rgba(0,229,255,0.55)] bg-[radial-gradient(circle_at_center,rgba(0,229,255,0.15),rgba(4,20,34,0.76))] shadow-[0_0_18px_rgba(0,229,255,0.18),inset_0_0_20px_rgba(0,229,255,0.11)] hover:border-solid hover:border-[#00e5ff] hover:bg-[radial-gradient(circle_at_center,rgba(0,229,255,0.24),rgba(5,28,46,0.82))] hover:shadow-[0_0_26px_rgba(0,229,255,0.34),inset_0_0_28px_rgba(0,229,255,0.18)]'
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".bin,.ori,.mod,.ecu"
                    className="hidden"
                    onChange={(event) => {
                      acceptFile(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />

                  {selectedFile ? (
                    <>
                      <CheckCircle2 className="mb-3 h-12 w-12 text-emerald-400" />
                      <p className="text-base font-semibold text-emerald-300">{t('fileReady')}</p>
                      <div className="mt-3 flex max-w-full items-center gap-2 rounded-full border border-emerald-400/30 bg-black/40 px-3 py-1.5 text-sm text-foreground">
                        <File className="h-4 w-4 shrink-0 text-emerald-300" />
                        <span className="truncate">{selectedFile.name}</span>
                        <span className="shrink-0 text-muted-foreground">{formatSize(selectedFile.size)}</span>
                      </div>
                      <p className="mt-3 text-xs text-muted-foreground">{t('fileReplace')}</p>
                    </>
                  ) : (
                    <>
                      <div className={`order-file-mark mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border transition-all ${
                        isDragging
                          ? 'border-[rgba(16,185,129,0.55)] bg-[rgba(16,185,129,0.18)] shadow-[0_0_14px_rgba(16,185,129,0.25)] group-hover:border-[#10b981] group-hover:bg-[rgba(16,185,129,0.28)] group-hover:shadow-[0_0_22px_rgba(16,185,129,0.48)]'
                          : errors.file
                            ? 'border-[rgba(239,68,68,0.55)] bg-[rgba(239,68,68,0.18)] shadow-[0_0_14px_rgba(239,68,68,0.25)] group-hover:border-[#ef4444] group-hover:bg-[rgba(239,68,68,0.28)] group-hover:shadow-[0_0_22px_rgba(239,68,68,0.48)]'
                            : 'border-[rgba(0,229,255,0.5)] bg-[rgba(0,229,255,0.14)] shadow-[0_0_14px_rgba(0,229,255,0.22)] group-hover:border-[#00e5ff] group-hover:bg-[rgba(0,229,255,0.24)] group-hover:shadow-[0_0_20px_rgba(0,229,255,0.45)]'
                      }`}>
                        <Upload className={`h-8 w-8 ${
                          isDragging
                            ? 'text-[#a7f3d0] group-hover:text-[#d1fae5]'
                            : errors.file
                              ? 'text-[#fecaca] group-hover:text-[#fee2e2]'
                              : 'text-[#67e8f9] group-hover:text-[#e0f2fe]'
                        }`} />
                      </div>
                      <p className={`text-lg font-semibold ${
                        isDragging ? 'text-[#d1fae5]' : errors.file ? 'text-[#fee2e2]' : ''
                      }`}>{t('fileDrop')}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t('fileBrowse')}</p>
                    </>
                  )}
                </div>
                {!selectedFile && pendingFile && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {t('draftFileAgain', { name: pendingFile.name, size: formatSize(pendingFile.size) })}
                  </p>
                )}
                {errors.file && <p className="mt-2 text-xs text-red-400">{t(errors.file)}</p>}
                {selectedFile && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedFile(null);
                      setPendingFile(null);
                      clearFileError();
                      if (fileInputRef.current) fileInputRef.current.value = '';
                    }}
                    className="mt-3 inline-flex w-fit items-center gap-1.5 self-start rounded-md border border-[rgba(239,68,68,0.35)] bg-[rgba(239,68,68,0.12)] px-3 py-1.5 text-xs font-medium normal-case text-[#f87171] shadow-[0_0_10px_rgba(239,68,68,0.18)] hover:border-[rgba(239,68,68,0.65)] hover:bg-[rgba(239,68,68,0.22)] hover:shadow-[0_0_14px_rgba(239,68,68,0.35)]"
                  >
                    {t('fileRemove')}
                  </button>
                )}
              </section>

              <section className="order-card-note shrink-0 rounded-xl p-3 md:p-4">
                <label className="block">
                  <span className="mb-2 block text-base font-semibold leading-5 text-[#facc15]">{t('note')}</span>
                  <textarea
                    value={customerNote}
                    onChange={(event) => setCustomerNote(event.target.value)}
                    maxLength={500}
                    rows={4}
                    placeholder={t('notePlaceholder')}
                    className="input-field order-note-field w-full !rounded-lg !border !px-3 !py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none min-h-[120px] resize-y overflow-y-auto lg:min-h-[4.75rem] lg:max-h-[5.75rem]"
                  />
                  <span className="mt-1.5 block text-right text-[11px] text-muted-foreground">{customerNote.length}/500</span>
                </label>
              </section>

              <section
                className={`order-emission-notice shrink-0 rounded-xl px-3 py-2.5 md:px-4 ${confirmGate?.emission || errors.emission ? 'is-attention' : ''}`}
              >
                <h2 className="text-sm font-semibold leading-5 text-[#f0b4b4]">{t('emissionNoticeTitle')}</h2>
                <p className="mt-1.5 text-xs leading-relaxed text-[#f3e6c8]">{t('offroadDisclaimer')}</p>
                {emissionSelected && (
                  <label className="mt-2.5 flex cursor-pointer items-start gap-2.5 text-xs leading-relaxed text-[#f8f1dc]">
                    <input
                      type="checkbox"
                      checked={emissionAck}
                      onChange={(event) => {
                        const checked = event.target.checked;
                        setEmissionAck(checked);
                        if (!checked) return;
                        setErrors((current) => {
                          if (!current.emission) return current;
                          const next = { ...current };
                          delete next.emission;
                          return next;
                        });
                        setConfirmGate((current) => {
                          if (!current?.emission) return current;
                          const next = { ...current, emission: false };
                          return next.consent ? next : null;
                        });
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-amber-400"
                    />
                    <span>{t('emissionNoticeConfirm')}</span>
                  </label>
                )}
              </section>
            </div>

            <aside className="sticky top-16 z-20 flex max-h-[calc(100dvh-8.25rem)] min-h-0 min-w-0 flex-col self-start lg:static lg:z-auto lg:h-full lg:max-h-none lg:overflow-hidden lg:self-stretch">
              <div ref={checkoutRef} className="order-card-checkout flex min-h-0 w-full flex-1 flex-col rounded-xl">
                <div className="flex shrink-0 items-center justify-between gap-3 border-b border-cyan-400/20 px-4 py-3">
                  <h2 className="text-lg font-semibold uppercase leading-tight tracking-[0.12em] text-primary">{t('servicesCheckout')}</h2>
                  <p className="shrink-0 whitespace-nowrap text-xl font-bold leading-none tabular-nums text-emerald-300">{formatCreditUnits(totalPrice, language)}</p>
                </div>

                <div className="order-counters shrink-0 px-3 pt-3">
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-emerald-400 bg-[linear-gradient(145deg,rgba(16,185,129,0.34),rgba(4,32,24,0.9))] px-3.5 py-3 shadow-[0_0_24px_rgba(16,185,129,0.42),inset_0_0_18px_rgba(52,211,153,0.18)]">
                    <p className="min-w-0 text-base font-semibold leading-tight text-emerald-100 [text-shadow:0_0_12px_rgba(16,185,129,0.65)]">{t('selected')}</p>
                    <p className="shrink-0 text-4xl font-bold leading-none tabular-nums text-emerald-300 [text-shadow:0_0_14px_rgba(16,185,129,0.7)]">{selectedItems.length}</p>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-cyan-400 bg-[linear-gradient(145deg,rgba(34,211,238,0.3),rgba(6,24,44,0.9))] px-3.5 py-3 shadow-[0_0_24px_rgba(34,211,238,0.42),inset_0_0_18px_rgba(34,211,238,0.16)]">
                    <p className="min-w-0 text-base font-semibold leading-tight text-cyan-100 [text-shadow:0_0_12px_rgba(34,211,238,0.65)]">{t('available')}</p>
                    <p className="shrink-0 text-4xl font-bold leading-none tabular-nums text-cyan-300 [text-shadow:0_0_14px_rgba(34,211,238,0.7)]">
                      {catalogStatus === 'ready' ? catalog.filter((service) => !isLegacyStage1(service)).length : '—'}
                    </p>
                  </div>
                </div>

                <div className="order-services-scroll flex min-h-0 max-h-[50vh] flex-1 flex-col px-3 py-3 lg:max-h-none">
                  {catalogStatus === 'loading' && (
                    <p className="shrink-0 px-1 text-sm text-muted-foreground">{t('catalogLoading')}</p>
                  )}
                  {catalogStatus === 'error' && (
                    <p className="shrink-0 px-1 text-sm text-red-400">{t('catalogError')}</p>
                  )}
                  <div className="order-roletky-list">
                  {checkoutRolls.map((roll) => {
                      const stageGroup = roll.stageId ? stageGroups.find((group) => group.id === roll.stageId) : undefined;
                      const open = openCategory === roll.id;
                      const picked = stageGroup
                        ? (stageGroupSelection(stageGroup, services) ? 1 : 0)
                        : (roll.items ?? []).filter((service) => services.includes(service.id)).length;
                      const total = stageGroup ? stageGroup.options.length : (roll.items ?? []).length;
                      return (
                      <div key={roll.id} className={`order-roletka ${roll.tone}${open ? ' is-open' : ''}`}>
                        <button
                          type="button"
                          className="order-roletka-head"
                          aria-expanded={open}
                          onClick={() => setOpenCategory(open ? null : roll.id)}
                        >
                          <span className="order-roletka-title">
                            <span className="order-roletka-label">{roll.labelKey ? t(roll.labelKey) : roll.id}</span>
                            <span className="order-roletka-pill">
                              <span className="order-roletka-pill-word">{t('categoryPicked')}</span>
                              <span className="order-roletka-figures">
                                <span className="order-roletka-count">{picked}</span>
                                <span className="order-roletka-of" aria-hidden="true">/</span>
                                <span className="order-roletka-total">{total}</span>
                              </span>
                            </span>
                          </span>
                          <svg className="order-roletka-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                            <path d="M5 7.5L10 12.5L15 7.5" stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        </button>
                        {open && (
                        <div className="order-roletka-panel" style={panelMax !== null ? { maxHeight: panelMax } : undefined}>
                        <div className="order-roletka-body">
                          <div className="order-roletka-items">
                          {stageGroup && (
                              <div className="contents" role="radiogroup" aria-label={roll.labelKey ? t(roll.labelKey) : stageGroup.label}>
                              {stageGroup.options.map((option) => {
                                const selected = services.includes(option.id);
                                return (
                                  <button
                                    key={option.id}
                                    type="button"
                                    role="radio"
                                    aria-checked={selected}
                                    className={`order-srv-line${selected ? ' is-selected' : ''}`}
                                    onClick={() => selectStage(stageGroup.id, selected ? '' : option.id)}
                                  >
                                    <span className={`order-srv-check${selected ? ' is-on' : ''}`}>
                                      {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                    </span>
                                    <span className="min-w-0 flex-1">
                                      <span className="order-srv-name">{option.years}</span>
                                    </span>
                                    <span className="order-srv-credits">
                                      {formatCreditUnits(option.price, language)}
                                    </span>
                                  </button>
                                );
                              })}
                              </div>
                          )}
                          {(roll.items ?? []).map((service) => {
                            const selected = services.includes(service.id);
                            return (
                              <button
                                key={service.id}
                                type="button"
                                role="checkbox"
                                aria-checked={selected}
                                title={service.name}
                                onClick={() => toggleService(service.id)}
                                className={`order-srv-line${selected ? ' is-selected' : ''}`}
                              >
                                <span className={`order-srv-check${selected ? ' is-on' : ''}`}>
                                  {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="order-srv-name">{service.name}</span>
                                  {service.description && (
                                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">{service.description}</span>
                                  )}
                                </span>
                                <span className="order-srv-credits">
                                  {formatCreditUnits(service.price, language)}
                                </span>
                              </button>
                            );
                          })}
                          </div>
                        </div>
                        </div>
                        )}
                      </div>
                      );
                  })}
                  </div>
                </div>

                <div className="order-checkout-foot shrink-0 space-y-3 border-t border-primary/20 p-4">
                  <label
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed ${
                      legalConsentAgreed
                        ? 'border-primary bg-primary/10 text-foreground'
                        : errors.consent
                          ? 'border-red-500 bg-red-500/10 text-muted-foreground'
                          : 'border-primary/20 text-muted-foreground hover:border-primary/40'
                    } ${confirmGate?.consent ? 'order-consent-attention' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={legalConsentAgreed}
                      onChange={(event) => {
                        setLegalConsentAgreed(event.target.checked);
                        if (!event.target.checked) return;
                        setErrors((current) => {
                          if (!current.consent) return current;
                          const next = { ...current };
                          delete next.consent;
                          return next;
                        });
                        setConfirmGate((current) => {
                          if (!current?.consent) return current;
                          const next = { ...current, consent: false };
                          return next.emission ? next : null;
                        });
                      }}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-400"
                    />
                    <span>
                      {t('consentLead')}{' '}
                      <a href="/#/terms" target="_blank" className="text-primary underline" onClick={(event) => event.stopPropagation()}>
                        {t('consentTerms')}
                      </a>
                      ,{' '}
                      <a href="/#/privacy" target="_blank" className="text-primary underline" onClick={(event) => event.stopPropagation()}>
                        {t('consentPrivacy')}
                      </a>{' '}
                      {t('consentAnd')}{' '}
                      <a href="/#/refunds" target="_blank" className="text-primary underline" onClick={(event) => event.stopPropagation()}>
                        {t('consentRefunds')}
                      </a>
                      {t('consentTail')}
                    </span>
                  </label>
                  {errors.consent && <p className="-mt-1 text-xs text-red-400">{t(errors.consent)}</p>}

                  <div className="flex items-end justify-between gap-3 rounded-[10px] border border-cyan-400/30 bg-[linear-gradient(90deg,rgba(14,165,233,0.12),rgba(16,185,129,0.12))] px-3 py-2.5">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('totalPrice')}</p>
                      <p className="whitespace-nowrap text-2xl font-bold tabular-nums leading-none neon-text">{formatCreditUnits(totalPrice, language)}</p>
                    </div>
                    <p className="mb-1 flex items-center gap-1 text-[11px] text-amber-200/90">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t('digitalGoods')}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={requestCheckout}
                    disabled={isSubmitting && !needsTopUp}
                    aria-busy={isSubmitting && !needsTopUp}
                    aria-label={needsTopUp ? t('topUpCreditsAria') : t('payCreditsAria')}
                    className="btn-primary order-pay-btn flex min-h-[52px] w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting && !needsTopUp ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin" />
                        <span className="text-sm font-bold uppercase tracking-wide">{t('payCreditsLoading')}</span>
                      </>
                    ) : (
                      <>
                        <Coins className="h-4 w-4" />
                        <span className="text-sm font-bold uppercase tracking-wide">
                          {needsTopUp ? t('topUpCredits') : t('pay')}
                        </span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </aside>
          </div>
          </>
          )}
        </div>
      </div>
      {confirmGate && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center overflow-hidden bg-black/55 p-4"
          onClick={() => setConfirmGate(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-gate-title"
            className="order-confirm-gate w-full max-w-md rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="confirm-gate-title" className="text-base font-bold leading-snug text-[#f6d98a]">
              {t('confirmGateTitle')}
            </h2>
            <div className="mt-3 space-y-2 text-sm leading-relaxed text-[#f8f1dc]">
              <p>{t('confirmGateBody')}</p>
              {confirmGate.emission && <p>{t('confirmGateEmission')}</p>}
            </div>
            <button
              type="button"
              onClick={() => setConfirmGate(null)}
              className="order-confirm-gate-ack mt-5 min-h-[44px] w-full rounded-lg text-sm font-semibold"
            >
              {t('confirmGateAck')}
            </button>
          </div>
        </div>
      )}
      {serviceNotice && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center overflow-hidden bg-black/55 p-4"
          onClick={() => setServiceNotice(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="service-required-title"
            className="order-confirm-gate w-full max-w-md rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="service-required-title" className="text-base font-bold leading-snug text-[#f6d98a]">
              {t('serviceRequiredTitle')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#f8f1dc]">{t('serviceRequiredBody')}</p>
            <button
              type="button"
              onClick={() => setServiceNotice(false)}
              className="order-confirm-gate-ack mt-5 min-h-[44px] w-full rounded-lg text-sm font-semibold"
            >
              {t('serviceRequiredAck')}
            </button>
          </div>
        </div>
      )}
      {operationClosed && (
        <div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 p-4"
          onClick={() => setOperationClosed(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="operation-closed-title"
            className="order-confirm-gate w-full max-w-md rounded-xl p-5"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="operation-closed-title" className="text-base font-bold leading-snug text-[#f6d98a]">
              {t('operationClosedTitle')}
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[#f8f1dc]">
              {t('operationClosedBody')}
            </p>
            <button
              type="button"
              onClick={() => setOperationClosed(false)}
              className="order-confirm-gate-ack mt-5 min-h-[44px] w-full rounded-lg text-sm font-semibold"
            >
              {t('operationClosedAck')}
            </button>
          </div>
        </div>
      )}
      {topUpOpen && (
          <CreditTopUpModal
            onClose={() => setTopUpOpen(false)}
            onCredited={(balance) => setCreditBalance(balance)}
            onOffline={() => {
              setTopUpOpen(false);
              setOperationClosed(true);
            }}
            orderTotal={totalPrice}
            creditBalance={creditBalance}
          />
      )}
      {loginOpen && (
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onClick={() => setLoginOpen(false)}
        >
          <form
            onSubmit={authMode === 'sign-up' ? signUp : authMode === 'reset' ? sendReset : signIn}
            onClick={(event) => event.stopPropagation()}
            className="order-panel w-full max-w-sm p-5"
          >
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">
                {authMode === 'sign-up' ? t('signUpTitle') : authMode === 'reset' ? t('forgotPasswordTitle') : t('signInTitle')}
              </h2>
              <button
                type="button"
                onClick={() => setLoginOpen(false)}
                aria-label={t('close')}
                className="text-muted-foreground hover:text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {authMode === 'sign-up' && (
              <div className="mb-3 grid grid-cols-2 gap-2">
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('signUpFirstName')}</span>
                  <input
                    type="text"
                    value={loginFirstName}
                    onChange={(event) => setLoginFirstName(event.target.value)}
                    autoComplete="given-name"
                    required
                    autoFocus
                    disabled={loginBusy}
                    className="input-field w-full !px-3 !py-2 text-sm"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('signUpLastName')}</span>
                  <input
                    type="text"
                    value={loginLastName}
                    onChange={(event) => setLoginLastName(event.target.value)}
                    autoComplete="family-name"
                    required
                    disabled={loginBusy}
                    className="input-field w-full !px-3 !py-2 text-sm"
                  />
                </label>
              </div>
            )}
            <label className="mb-3 block">
              <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('email')}</span>
              <input
                type="email"
                value={loginEmail}
                onChange={(event) => setLoginEmail(event.target.value)}
                autoComplete="email"
                required
                autoFocus={authMode === 'sign-in'}
                disabled={loginBusy}
                className="input-field w-full !px-3 !py-2 text-sm"
              />
            </label>
            {authMode !== 'reset' && (
              <label className="mb-4 block">
                <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('signInPassword')}</span>
                <span className="relative block">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={loginPassword}
                    onChange={(event) => setLoginPassword(event.target.value)}
                    autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'}
                    required
                    minLength={6}
                    disabled={loginBusy}
                    className="input-field w-full !py-2 !pl-3 !pr-10 text-sm"
                  />
                  <button
                    type="button"
                    aria-label={showPassword ? t('hidePassword') : t('showPassword')}
                    aria-pressed={showPassword}
                    disabled={loginBusy}
                    onClick={() => setShowPassword((current) => !current)}
                    className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-primary/50 transition-colors hover:text-primary disabled:opacity-50"
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </span>
              </label>
            )}
            {authMode === 'sign-in' && (
              <label className="relative mb-4 flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(event) => setRememberMe(event.target.checked)}
                  disabled={loginBusy}
                  className="peer sr-only"
                />
                <span
                  aria-hidden="true"
                  className="pointer-events-none flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-primary/70 bg-[#070d16] shadow-[0_0_10px_rgba(0,242,255,0.28)] peer-checked:border-primary peer-checked:shadow-[0_0_12px_rgba(0,242,255,0.7)] peer-focus-visible:outline peer-focus-visible:outline-1 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary peer-disabled:opacity-60"
                >
                  <span className={`h-2 w-2 rounded-[2px] ${rememberMe ? 'bg-primary shadow-[0_0_8px_rgba(0,242,255,0.95)]' : 'bg-transparent'}`} />
                </span>
                <span className="text-xs font-semibold tracking-wide text-primary">{t('rememberMe')}</span>
              </label>
            )}
            {loginError && <p className="mb-3 text-xs text-red-400">{loginError}</p>}
            <button
              type="submit"
              disabled={loginBusy}
              className="btn-primary flex min-h-[44px] w-full items-center justify-center gap-2 rounded-none border border-primary/80 bg-primary/10 text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)] hover:translate-y-0 hover:bg-primary/16 hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {loginBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : authMode === 'sign-up' ? t('signUp') : authMode === 'reset' ? t('forgotPasswordSend') : t('signIn')}
            </button>
            {authMode === 'sign-in' && (
              <button
                type="button"
                onClick={() => {
                  setLoginError('');
                  setAuthMode('reset');
                }}
                className="mt-3 w-full text-center text-xs font-semibold text-primary/80 transition-colors hover:text-primary"
              >
                {t('forgotPassword')}
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                setLoginError('');
                setAuthMode(authMode === 'sign-in' ? 'sign-up' : 'sign-in');
              }}
              className="mt-3 w-full text-center text-xs text-muted-foreground transition-colors hover:text-primary"
            >
              {authMode === 'sign-in' ? t('signUpSwitch') : authMode === 'reset' ? t('backToSignIn') : t('signInSwitch')}
            </button>
          </form>
        </div>
      )}
    </div>
  );
};

export default OrderPage;
