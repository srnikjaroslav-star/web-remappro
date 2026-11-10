import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import MyOrders from '@/components/MyOrders';
import SystemStatus from '@/components/SystemStatus';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import {
  categoryHint,
  formatServicePrice,
  groupCatalog,
  loadServiceCatalog,
  subscribeServiceCatalog,
  type CatalogService,
} from '@/lib/serviceCatalog';
import {
  accountDisplayName,
  companyFromMetadata,
  joinProfileName,
  metadataProfileName,
  splitProfileName,
} from '@/lib/profileName';
import { supabase } from '@/lib/supabase';
import {
  AlertTriangle,
  ArrowLeft,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  Coins,
  Cpu,
  File,
  Fuel,
  Gauge,
  List,
  Loader2,
  LogOut,
  Search,
  Upload,
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
}

const isFilled = (value: string | number | undefined) => {
  if (typeof value === 'number') return value > 0;
  return Boolean(value && value.trim().length > 0);
};

const fieldClass = (filled: boolean, hasError: boolean) => {
  if (hasError) return 'input-field w-full !px-3 !py-2 text-sm !border-red-500';
  if (filled) return 'input-field-active w-full !px-3 !py-2 text-sm';
  return 'input-field w-full !px-3 !py-2 text-sm';
};

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const OrderPage = () => {
  const { language, setLanguage, t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [profileName, setProfileName] = useState('');
  const [portalView, setPortalView] = useState<'new' | 'orders'>('new');
  const [loginOpen, setLoginOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up' | 'reset'>('sign-in');
  const [loginFirstName, setLoginFirstName] = useState('');
  const [loginLastName, setLoginLastName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [loginBusy, setLoginBusy] = useState(false);
  const [legalConsentAgreed, setLegalConsentAgreed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [vehicle, setVehicle] = useState<VehicleData>({
    brand: '',
    model: '',
    engine: '',
    fuelType: '',
    year: 0,
    ecuType: '',
  });
  const [services, setServices] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<CatalogService[]>([]);
  const [catalogStatus, setCatalogStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customerNote, setCustomerNote] = useState('');
  const [customer, setCustomer] = useState({ name: '', email: '' });

  const dragDepth = useRef(0);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      loadServiceCatalog()
        .then((next) => {
          if (!active) return;
          setCatalog(next);
          setCatalogStatus('ready');
          setServices((current) => current.filter((id) => next.some((service) => service.id === id)));
        })
        .catch(() => {
          if (!active) return;
          setCatalogStatus((current) => (current === 'ready' ? current : 'error'));
        });
    };
    refresh();
    const unsubscribe = subscribeServiceCatalog(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    let active = true;
    const applyAccount = (user: User | null) => {
      if (!user) {
        setProfileName('');
        setCustomer({ name: '', email: '' });
        setPortalView('new');
        return;
      }
      setCustomer((current) => ({
        name: current.name,
        email: user.email || current.email,
      }));
    };
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      const user = data.session?.user ?? null;
      setAuthUser(user);
      applyAccount(user);
    });
    const { data: subscription } = supabase.auth.onAuthStateChange((_event, session) => {
      const user = session?.user ?? null;
      setAuthUser(user);
      applyAccount(user);
    });
    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!authUser) return;
    const user = authUser;
    let active = true;
    const loadProfile = async () => {
      const { data } = await supabase
        .from('client_profiles')
        .select('first_name, last_name')
        .eq('user_id', user.id)
        .maybeSingle();
      const stored = joinProfileName(data?.first_name, data?.last_name);
      let name = stored || metadataProfileName(user.user_metadata);
      if (!name && user.email) {
        const { data: order } = await supabase
          .from('orders')
          .select('customer_name')
          .eq('customer_email', user.email.toLowerCase())
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        name = String(order?.customer_name ?? '').trim();
      }
      if (name && name !== stored) {
        const parts = splitProfileName(name);
        await supabase.from('client_profiles').upsert({
          user_id: user.id,
          first_name: parts.first_name,
          last_name: parts.last_name,
          updated_at: new Date().toISOString(),
        });
      }
      if (!active) return;
      setProfileName(name);
      setCustomer((current) => ({
        name: name || current.name,
        email: user.email || current.email,
      }));
    };
    loadProfile();
    return () => {
      active = false;
    };
  }, [authUser?.id]);

  useEffect(() => {
    if (!authUser || !customer.name.trim()) return;
    const parts = splitProfileName(customer.name);
    const nextName = joinProfileName(parts.first_name, parts.last_name);
    const handle = window.setTimeout(() => {
      supabase
        .from('client_profiles')
        .upsert({
          user_id: authUser.id,
          first_name: parts.first_name,
          last_name: parts.last_name,
          updated_at: new Date().toISOString(),
        })
        .then(({ error }) => {
          if (!error) setProfileName(nextName);
        });
    }, 400);
    return () => window.clearTimeout(handle);
  }, [authUser, customer.name]);

  useEffect(() => {
    if (!authUser) {
      setCreditBalance(null);
      return;
    }
    let active = true;
    supabase
      .from('credit_accounts')
      .select('balance')
      .eq('user_id', authUser.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!active) return;
        if (error || !data) {
          setCreditBalance(0);
          return;
        }
        setCreditBalance(Number(data.balance));
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
    if (!loginOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setLoginOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [loginOpen]);

  const accountLabel = accountDisplayName({
    name: profileName,
    email: authUser?.email,
    company: companyFromMetadata(authUser?.user_metadata),
  });

  const showCreditBalance = () => {
    document.getElementById('order-credit-balance')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const signIn = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoginError('');
    setLoginBusy(true);
    const { error } = await supabase.auth.signInWithPassword({
      email: loginEmail.trim(),
      password: loginPassword,
    });
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
      await supabase.from('client_profiles').upsert({
        user_id: data.user.id,
        first_name: first,
        last_name: last,
        updated_at: new Date().toISOString(),
      });
      setProfileName(fullName);
      setCustomer((current) => ({
        name: fullName,
        email: email || current.email,
      }));
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
    setProfileName('');
  };

  const catalogGroups = useMemo(() => groupCatalog(catalog), [catalog]);

  const selectedItems = useMemo(
    () =>
      services
        .map((id) => catalog.find((service) => service.id === id))
        .filter((service): service is CatalogService => Boolean(service)),
    [services, catalog],
  );

  const totalPrice = selectedItems.reduce((total, service) => total + service.price, 0);

  const setVehicleField = (field: keyof VehicleData, value: string | number) => {
    setVehicle((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const toggleService = (serviceId: string) => {
    setServices((current) =>
      current.includes(serviceId) ? current.filter((id) => id !== serviceId) : [...current, serviceId],
    );
    setErrors((current) => {
      if (!current.services) return current;
      const next = { ...current };
      delete next.services;
      return next;
    });
  };

  const acceptFile = (file: File | undefined) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    const allowed = ACCEPTED_EXTENSIONS.some((extension) => name.endsWith(extension));
    if (!allowed) {
      setErrors((current) => ({ ...current, file: 'errorFileType' }));
      toast.error(t('toastBadFile'));
      return;
    }
    setSelectedFile(file);
    setErrors((current) => {
      if (!current.file) return current;
      const next = { ...current };
      delete next.file;
      return next;
    });
  };

  const validate = (): FieldErrors => {
    const next: FieldErrors = {};
    if (!vehicle.brand.trim()) next.brand = 'errorBrand';
    if (!vehicle.model.trim()) next.model = 'errorModel';
    if (!vehicle.engine.trim()) next.engine = 'errorEngine';
    if (!vehicle.ecuType.trim()) next.ecuType = 'errorEcu';
    if (!vehicle.year || vehicle.year < 1900 || vehicle.year > 2100) next.year = 'errorYear';
    if (vehicle.fuelType !== 'Diesel' && vehicle.fuelType !== 'Petrol') next.fuelType = 'errorFuel';
    if (!selectedFile) next.file = 'errorFile';
    if (services.length === 0) next.services = 'errorServices';
    if (!customer.name.trim()) next.name = 'errorName';
    if (!customer.email.trim()) next.email = 'errorEmail';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) next.email = 'errorEmailInvalid';
    if (!legalConsentAgreed) next.consent = 'errorConsent';
    return next;
  };

  const composedNote = [vehicle.engine.trim() ? `Motor: ${vehicle.engine.trim()}` : '', customerNote.trim()]
    .filter(Boolean)
    .join('\n');

  const payWithCredits = async () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error(t('toastCheckFields'));
      return;
    }
    if (!authUser) {
      toast.error(t('creditAuthRequired'));
      return;
    }
    if (creditBalance !== null && creditBalance < totalPrice) {
      toast.error(t('creditInsufficient'));
      return;
    }
    if (!selectedFile) return;

    setIsSubmitting(true);
    try {
      toast.loading(t('toastUploading'), { id: 'upload' });
      const fileName = `${Date.now()}-${selectedFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('tunes')
        .upload(fileName, selectedFile);

      if (uploadError || !uploadData?.path) {
        toast.dismiss('upload');
        toast.error(`${t('toastUploadFailed')}: ${uploadError?.message || t('toastUploadSaved')}`);
        setIsSubmitting(false);
        return;
      }
      toast.dismiss('upload');

      if (customer.name.trim()) {
        await supabase.auth.updateUser({ data: { full_name: customer.name.trim() } }).catch(() => undefined);
      }

      const invoked = await supabase.functions.invoke('pay-with-credits', {
        body: {
          serviceIds: services,
          customerName: customer.name,
          customerEmail: customer.email,
          brand: vehicle.brand,
          model: vehicle.model,
          fuelType: vehicle.fuelType,
          year: vehicle.year,
          ecuType: vehicle.ecuType,
          fileUrl: uploadData.path,
          customerNote: composedNote,
          legalConsent: legalConsentAgreed,
        },
      });

      let data = invoked.data as { ok?: boolean; code?: string; balance?: number; orderNumber?: string } | null;
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
        if (code === 'INSUFFICIENT_CREDITS') toast.error(t('creditInsufficient'));
        else if (code === 'NO_ACCOUNT') toast.error(t('creditNoAccount'));
        else if (code === 'NOT_AUTHENTICATED') toast.error(t('creditAuthRequired'));
        else toast.error(t('creditPayFailed'));
        setIsSubmitting(false);
        return;
      }

      setCreditBalance(Number(data.balance));
      setServices([]);
      toast.success(t('creditPaid', { order: data.orderNumber }));
      setIsSubmitting(false);
    } catch {
      toast.dismiss('upload');
      toast.error(t('creditPayFailed'));
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative flex w-full flex-grow flex-col bg-background">
      <div className="order-hex-layer" aria-hidden="true">
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <pre className="w-1/2">{HEX_DUMP}</pre>
          <pre className="w-1/2">{HEX_DUMP}</pre>
        </div>
      </div>

      <div className="relative z-10 flex w-full flex-grow flex-col">
        <header className="sticky top-0 z-50 w-full border-b border-primary/25 bg-background/80 backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between lg:px-8">
            <div className="flex shrink-0 items-center gap-6">
              <Link to="/" aria-label="REMAPPRO" className="inline-flex shrink-0 items-center gap-2 no-underline antialiased leading-none">
                <span className="inline-flex h-9 items-center justify-center rounded-full border border-cyan-400/60 bg-transparent px-3 shadow-[0_0_15px_rgba(6,182,212,0.4)]">
                  <span className="text-2xl font-black leading-none tracking-tight text-cyan-400">R</span>
                  <span className="text-2xl font-black leading-none tracking-tight text-white">P</span>
                </span>
                <span className="text-2xl font-semibold leading-none tracking-normal text-cyan-400">REMAPPRO</span>
              </Link>
              <SystemStatus />
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <div
                role="group"
                aria-label={t('language')}
                className="inline-flex items-center rounded-lg border border-border/60 bg-black/40 p-0.5 text-xs font-semibold"
              >
                {(['sk', 'en'] as const).map((code) => {
                  const active = language === code;
                  return (
                    <button
                      key={code}
                      type="button"
                      onClick={() => setLanguage(code)}
                      aria-pressed={active}
                      className={`rounded-md px-2.5 py-1.5 uppercase tracking-wide transition-colors ${
                        active
                          ? 'bg-primary/15 text-primary shadow-[0_0_12px_rgba(0,242,255,0.35)]'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
              {authUser ? (
                <div className="inline-flex shrink-0 items-center gap-2 rounded-lg border border-primary/40 bg-black/50 px-2 py-0.5">
                  <span className="max-w-[9rem] truncate text-sm font-semibold leading-none text-foreground" title={accountLabel || undefined}>
                    {accountLabel || '—'}
                  </span>
                  <span className="h-4 w-px shrink-0 bg-primary/35" aria-hidden="true" />
                  <button
                    type="button"
                    onClick={showCreditBalance}
                    className="shrink-0 text-lg font-black leading-none tabular-nums neon-text"
                    aria-label={t('creditBalance')}
                  >
                    {creditBalance === null ? '—' : `${formatServicePrice(creditBalance)}€`}
                  </button>
                  <button
                    type="button"
                    onClick={signOut}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-primary/50 bg-primary/10 px-2.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
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
                  className="inline-flex h-8 items-center rounded-lg border border-border/60 bg-black/40 px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-primary"
                >
                  {t('signIn')}
                </button>
              )}
              {authUser && (
                <button
                  type="button"
                  onClick={() => setPortalView('orders')}
                  aria-pressed={portalView === 'orders'}
                  className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-sm font-bold transition-colors ${
                    portalView === 'orders'
                      ? 'border-primary bg-primary/25 text-primary shadow-[0_0_18px_rgba(0,242,255,0.55)]'
                      : 'border-primary/70 bg-primary/15 text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)] hover:bg-primary/25'
                  }`}
                >
                  <List className="h-4 w-4" />
                  {t('myOrders')}
                </button>
              )}
              <Link to="/track" className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm">
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">{t('trackOrder')}</span>
              </Link>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1600px] flex-grow px-4 pb-6 pt-2 lg:px-8">
          {portalView === 'orders' && authUser ? (
            <div className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('myOrders')}</h1>
                <button
                  type="button"
                  onClick={() => setPortalView('new')}
                  className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-lg border border-primary/70 bg-primary/15 px-4 text-sm font-bold text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)] transition-colors hover:bg-primary/25"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('backToNewOrder')}
                </button>
              </div>
              <MyOrders email={authUser.email ?? ''} />
            </div>
          ) : (
          <>
          <div className="mb-3 flex flex-row flex-wrap items-baseline gap-x-4">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('newOrder')}</h1>
            <p className="text-sm text-muted-foreground">{t('newOrderSubtitle')}</p>
          </div>

          <div className="flex flex-col gap-8 lg:grid lg:grid-cols-12">
            <div className="min-w-0 space-y-5 lg:col-span-8">
              <section className="order-panel p-4 md:p-5">
                <div className="mb-4 flex items-center gap-2">
                  <Car className="h-4 w-4 text-primary" />
                  <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{t('vehicleSpec')}</h2>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
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
                            className={`h-[38px] rounded-xl text-sm font-medium transition-all ${
                              active
                                ? 'interactive-active text-foreground'
                                : 'interactive-idle text-muted-foreground hover:text-foreground'
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

              <section className="order-panel p-4 md:p-5">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Upload className="h-4 w-4 text-primary" />
                    <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{t('ecuFile')}</h2>
                  </div>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">.bin · .ori · .mod · .ecu</span>
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
                  className={`flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-10 text-center transition-all ${
                    selectedFile
                      ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_24px_rgba(16,185,129,0.25)]'
                      : isDragging
                        ? 'border-primary bg-primary/15 shadow-[0_0_28px_rgba(0,242,255,0.35)]'
                        : errors.file
                          ? 'border-red-500 bg-red-500/5'
                          : 'border-primary/40 bg-black/30 hover:border-primary hover:bg-primary/5'
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
                      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/40 bg-primary/10 shadow-[0_0_24px_rgba(0,242,255,0.25)]">
                        <Upload className="h-8 w-8 text-primary" />
                      </div>
                      <p className="text-lg font-semibold">{t('fileDrop')}</p>
                      <p className="mt-1 text-sm text-muted-foreground">{t('fileBrowse')}</p>
                    </>
                  )}
                </div>
                {errors.file && <p className="mt-2 text-xs text-red-400">{t(errors.file)}</p>}
                {selectedFile && (
                  <button
                    type="button"
                    onClick={() => setSelectedFile(null)}
                    className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" /> {t('fileRemove')}
                  </button>
                )}
              </section>

              <section className="order-panel p-4 md:p-5">
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold uppercase tracking-[0.16em] text-primary">{t('note')}</span>
                  <textarea
                    value={customerNote}
                    onChange={(event) => setCustomerNote(event.target.value)}
                    maxLength={500}
                    rows={4}
                    placeholder={t('notePlaceholder')}
                    className="input-field min-h-[120px] w-full resize-y !px-3 !py-2.5 text-sm"
                  />
                  <span className="mt-1.5 block text-right text-[11px] text-muted-foreground">{customerNote.length}/500</span>
                </label>
              </section>
            </div>

            <aside className="sticky top-16 z-20 min-w-0 self-start lg:col-span-4">
              <div className="order-panel flex flex-col border-t-2 border-t-primary">
                <div className="flex items-center justify-between border-b border-primary/15 px-4 py-3">
                  <h2 className="text-sm font-semibold uppercase tracking-[0.16em] text-primary">{t('servicesCheckout')}</h2>
                  <p className="shrink-0 text-3xl font-bold leading-none tabular-nums neon-text">{totalPrice}€</p>
                </div>

                <div className="order-counters px-3 pt-3">
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-primary/45 bg-black/50 px-3 py-2.5 shadow-[0_0_18px_rgba(0,242,255,0.14),inset_0_1px_0_rgba(0,242,255,0.18)]">
                    <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">{t('selected')}</p>
                    <p className="text-2xl font-bold leading-none tabular-nums neon-text">{selectedItems.length}</p>
                  </div>
                  <div className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-primary/45 bg-black/50 px-3 py-2.5 shadow-[0_0_18px_rgba(0,242,255,0.14),inset_0_1px_0_rgba(0,242,255,0.18)]">
                    <p className="truncate text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">{t('available')}</p>
                    <p className="text-2xl font-bold leading-none tabular-nums neon-text">
                      {catalogStatus === 'ready' ? catalog.length : '—'}
                    </p>
                  </div>
                </div>

                <div className="order-services-scroll max-h-[50vh] space-y-4 overflow-y-auto px-3 py-3">
                  {catalogStatus === 'loading' && (
                    <p className="px-1 text-sm text-muted-foreground">{t('catalogLoading')}</p>
                  )}
                  {catalogStatus === 'error' && (
                    <p className="px-1 text-sm text-red-400">{t('catalogError')}</p>
                  )}
                  {catalogGroups.map((group) => {
                    const hint = categoryHint(group.category);
                    return (
                      <div key={group.category}>
                        <div className="mb-2 flex items-baseline justify-between gap-3 border-b border-primary/35 px-1 pb-1">
                          <h3 className="border-l-2 border-primary pl-2 text-xs font-bold uppercase tracking-[0.16em] neon-text">{group.category}</h3>
                          <span className="shrink-0 text-[11px] text-muted-foreground">
                            {hint ? t(hint) : group.items.length}
                          </span>
                        </div>
                        <div className="space-y-1.5">
                          {group.items.map((service) => {
                            const selected = services.includes(service.id);
                            return (
                              <button
                                key={service.id}
                                type="button"
                                role="checkbox"
                                aria-checked={selected}
                                title={service.name}
                                onClick={() => toggleService(service.id)}
                                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all ${
                                  selected
                                    ? 'border border-primary bg-primary/10 shadow-[0_0_16px_rgba(0,242,255,0.28)]'
                                    : 'border border-primary/20 bg-black/35 hover:border-primary/55'
                                }`}
                              >
                                <span
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-[4px] border-2 transition-all ${
                                    selected
                                      ? 'border-primary bg-primary text-primary-foreground shadow-[0_0_12px_rgba(0,242,255,0.65)]'
                                      : 'border-primary/60 bg-transparent'
                                  }`}
                                >
                                  {selected && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block truncate text-sm font-medium">{service.name}</span>
                                  {service.description && (
                                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">{service.description}</span>
                                  )}
                                </span>
                                <span className="shrink-0 text-sm font-semibold tabular-nums text-primary">
                                  {formatServicePrice(service.price)}€
                                </span>
                              </button>
                            );
                          })}
                        </div>
                        {group.category === 'Emission Control' && (
                          <p className="mt-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-100">
                            {t('offroadDisclaimer')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                  {errors.services && <p className="px-1 text-xs text-red-400">{t(errors.services)}</p>}
                </div>

                <div className="shrink-0 space-y-3 border-t border-primary/20 bg-black/45 p-4">
                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('name')}</span>
                      <input
                        type="text"
                        value={customer.name}
                        onChange={(event) => {
                          setCustomer((current) => ({ ...current, name: event.target.value }));
                          setErrors((current) => {
                            if (!current.name) return current;
                            const next = { ...current };
                            delete next.name;
                            return next;
                          });
                        }}
                        placeholder={t('namePlaceholder')}
                        className={fieldClass(isFilled(customer.name), Boolean(errors.name))}
                      />
                      {errors.name && <p className="mt-1 text-xs text-red-400">{t(errors.name)}</p>}
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{t('email')}</span>
                      <input
                        type="email"
                        value={customer.email}
                        onChange={(event) => {
                          setCustomer((current) => ({ ...current, email: event.target.value }));
                          setErrors((current) => {
                            if (!current.email) return current;
                            const next = { ...current };
                            delete next.email;
                            return next;
                          });
                        }}
                        placeholder={t('emailPlaceholder')}
                        className={fieldClass(isFilled(customer.email), Boolean(errors.email))}
                      />
                      {errors.email && <p className="mt-1 text-xs text-red-400">{t(errors.email)}</p>}
                    </label>
                  </div>

                  <label
                    className={`flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed ${
                      legalConsentAgreed
                        ? 'border-primary bg-primary/10 text-foreground'
                        : errors.consent
                          ? 'border-red-500 bg-red-500/10 text-muted-foreground'
                          : 'border-primary/20 text-muted-foreground hover:border-primary/40'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={legalConsentAgreed}
                      onChange={(event) => {
                        setLegalConsentAgreed(event.target.checked);
                        if (event.target.checked) {
                          setErrors((current) => {
                            if (!current.consent) return current;
                            const next = { ...current };
                            delete next.consent;
                            return next;
                          });
                        }
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

                  <div className="flex items-end justify-between gap-3">
                    <div>
                      <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">{t('totalPrice')}</p>
                      <p className="text-3xl font-bold tabular-nums leading-none neon-text">{totalPrice}€</p>
                    </div>
                    <p className="mb-1 flex items-center gap-1 text-[11px] text-amber-200/90">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      {t('digitalGoods')}
                    </p>
                  </div>

                  <div id="order-credit-balance" className="flex items-center justify-between gap-3 rounded-xl border border-primary/35 bg-black/40 px-3 py-2">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-primary/80">{t('creditBalance')}</span>
                    <span className={`text-lg font-bold leading-none tabular-nums ${creditBalance !== null && creditBalance < totalPrice ? 'text-amber-300' : 'neon-text'}`}>
                      {creditBalance === null ? '—' : `${formatServicePrice(creditBalance)}€`}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={payWithCredits}
                    disabled={isSubmitting}
                    aria-label={t('payCreditsAria')}
                    className="btn-primary flex min-h-[52px] w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSubmitting ? (
                      <Loader2 className="h-5 w-5 animate-spin" />
                    ) : (
                      <>
                        <Coins className="h-4 w-4" />
                        <span className="text-sm font-bold uppercase tracking-wide">{t('payCreditsAria')}</span>
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
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(event) => setLoginPassword(event.target.value)}
                  autoComplete={authMode === 'sign-up' ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                  disabled={loginBusy}
                  className="input-field w-full !px-3 !py-2 text-sm"
                />
              </label>
            )}
            {loginError && <p className="mb-3 text-xs text-red-400">{loginError}</p>}
            <button
              type="submit"
              disabled={loginBusy}
              className="btn-primary flex min-h-[44px] w-full items-center justify-center gap-2 disabled:cursor-not-allowed disabled:opacity-60"
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
