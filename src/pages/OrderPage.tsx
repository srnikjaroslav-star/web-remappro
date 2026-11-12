import { useEffect, useMemo, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { toast } from 'sonner';
import ClientProfile from '@/components/ClientProfile';
import NavLogo from '@/components/NavLogo';
import MyOrders from '@/components/MyOrders';
import StageYearSelect from '@/components/StageYearSelect';
import ConnectionDot from '@/components/ConnectionDot';
import SystemStatus from '@/components/SystemStatus';
import { useLanguage } from '@/i18n/LanguageContext';
import type { TranslationKey } from '@/i18n/translations';
import {
  formatServicePrice,
  groupCatalog,
  loadServiceCatalog,
  subscribeServiceCatalog,
  type CatalogService,
} from '@/lib/serviceCatalog';
import { emptyBilling, loadClientBilling, orderDisplayName, saveClientBilling, type ClientBilling } from '@/lib/clientProfile';
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
  File,
  Fuel,
  Gauge,
  Languages,
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

const orderPanelGlow =
  'order-panel !rounded-lg !border-primary/60 shadow-[0_0_24px_rgba(0,242,255,0.22),inset_0_0_0_1px_rgba(0,242,255,0.14)]';

const headerControl =
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-primary/50 bg-secondary px-3 text-sm font-medium text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)] transition-colors hover:border-primary hover:bg-primary/20 hover:shadow-[0_0_16px_rgba(0,242,255,0.5)]';

const headerControlActive =
  'inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-primary bg-primary/20 px-3 text-sm font-medium text-primary shadow-[0_0_18px_rgba(0,242,255,0.5)] transition-colors';

const formatSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const OrderPage = () => {
  const { language, setLanguage, t } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const languageMenuRef = useRef<HTMLDivElement>(null);
  const [languageOpen, setLanguageOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [authUser, setAuthUser] = useState<User | null>(null);
  const connected = useClientPresence(authUser?.id ?? null);
  const [creditBalance, setCreditBalance] = useState<number | null>(null);
  const [billing, setBilling] = useState<ClientBilling>(emptyBilling);
  const [profileReady, setProfileReady] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [portalView, setPortalView] = useState<'new' | 'orders' | 'profile'>('new');
  const [loginOpen, setLoginOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'sign-in' | 'sign-up' | 'reset'>('sign-in');
  const [loginFirstName, setLoginFirstName] = useState('');
  const [loginLastName, setLoginLastName] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(() => authRemembered());
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

  const dragDepth = useRef(0);
  const profileRequest = useRef(0);

  useEffect(() => {
    let active = true;
    const refresh = () => {
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
        setProfileReady(false);
        setBilling(emptyBilling());
        setPortalView('new');
        return;
      }
      setBilling((current) => {
        if (current.email || !user.email) return current;
        return { ...current, email: user.email };
      });
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
  };

  const catalogGroups = useMemo(() => groupCatalog(catalog), [catalog]);
  const stageGroups = useMemo(() => stageGroupsFromCatalog(catalog), [catalog]);

  const selectedItems = useMemo(
    () =>
      services
        .map((id) => catalog.find((service) => service.id === id))
        .filter((service): service is CatalogService => Boolean(service) && !isLegacyStage1(service)),
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
    setServices((current) => {
      const next = current.filter((id) => !memberIds.has(id));
      if (optionId) next.push(optionId);
      return next;
    });
    clearServiceError();
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
    return next;
  };

  const composedNote = [vehicle.engine.trim() ? `Motor: ${vehicle.engine.trim()}` : '', customerNote.trim()]
    .filter(Boolean)
    .join('\n');

  const payWithCredits = async () => {
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
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
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

      const profileForOrder = { ...source, email: orderEmail(source) };
      await saveClientBilling(authUser.id, profileForOrder);
      await supabase.auth.updateUser({
        data: {
          first_name: source.firstName.trim(),
          last_name: source.lastName.trim(),
          full_name: joinProfileName(source.firstName, source.lastName),
          company: source.company.trim(),
        },
      }).catch(() => undefined);

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
              <NavLogo />
              <SystemStatus />
            </div>
            <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto">
              <div ref={languageMenuRef} className="relative shrink-0">
                <button
                  type="button"
                  aria-haspopup="listbox"
                  aria-expanded={languageOpen}
                  aria-label={t('language')}
                  onClick={() => setLanguageOpen((open) => !open)}
                  className={`${languageOpen ? headerControlActive : headerControl} uppercase tracking-wide`}
                >
                  <Languages className="h-4 w-4" />
                  {language}
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
                          }}
                          className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium transition-colors ${
                            selected
                              ? 'bg-primary/20 text-primary'
                              : 'text-primary/80 hover:bg-primary/15 hover:text-primary'
                          }`}
                        >
                          <span className="w-6 uppercase tracking-wide">{code}</span>
                          <span className="whitespace-nowrap">{label}</span>
                          {selected && <Check className="ml-auto h-3.5 w-3.5" strokeWidth={3} />}
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
                    className="shrink-0 text-lg font-black leading-none tabular-nums neon-text"
                    aria-label={t('creditBalance')}
                  >
                    {creditBalance === null ? '—' : `${formatServicePrice(creditBalance)}€`}
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
                  className="inline-flex h-10 w-auto shrink-0 items-center justify-center gap-1.5 self-end rounded-lg border border-primary/70 bg-primary/15 px-3 text-sm font-bold text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)] transition-colors hover:bg-primary/25 sm:self-start"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {t('backToNewOrder')}
                </button>
              </div>
              <MyOrders email={authUser.email || billing.email} />
            </div>
          ) : portalView === 'profile' && authUser ? (
            <ClientProfile
              billing={billing}
              onBilling={updateBilling}
              onSave={saveProfile}
              saving={profileSaving}
              creditBalance={creditBalance}
              authEmail={authUser.email ?? billing.email}
              onBack={() => setPortalView('new')}
            />
          ) : (
          <>
          <div className="mb-3 flex flex-row flex-wrap items-baseline gap-x-4">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">{t('newOrder')}</h1>
            <p className="text-sm text-muted-foreground">{t('newOrderSubtitle')}</p>
          </div>

          <div className="flex flex-col gap-8 lg:grid lg:grid-cols-12">
            <div className="min-w-0 space-y-5 lg:col-span-8">
              <section className={`${orderPanelGlow} p-4 md:p-5`}>
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
                            className={`h-[38px] rounded-lg border text-sm font-medium transition-colors ${
                              active
                                ? 'border-primary bg-primary/20 text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)]'
                                : 'border-primary/60 bg-secondary text-muted-foreground shadow-[0_0_14px_rgba(0,242,255,0.28)] hover:border-primary hover:text-foreground hover:shadow-[0_0_16px_rgba(0,242,255,0.42)]'
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

              <section className={`${orderPanelGlow} p-4 md:p-5`}>
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
                  className={`flex min-h-[240px] cursor-pointer flex-col items-center justify-center rounded-lg border px-6 py-10 text-center transition-all ${
                    selectedFile
                      ? 'border-emerald-400 bg-emerald-500/10 shadow-[0_0_24px_rgba(16,185,129,0.25)]'
                      : isDragging
                        ? 'border-primary bg-primary/15 shadow-[0_0_28px_rgba(0,242,255,0.45)]'
                        : errors.file
                          ? 'border-red-500 bg-red-500/5 shadow-[0_0_16px_rgba(239,68,68,0.28)]'
                          : 'border-primary/60 bg-secondary shadow-[0_0_18px_rgba(0,242,255,0.28)] hover:border-primary hover:bg-primary/10 hover:shadow-[0_0_22px_rgba(0,242,255,0.45)]'
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
                      <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-primary/60 bg-primary/10 shadow-[0_0_18px_rgba(0,242,255,0.35)]">
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

              <section className={`${orderPanelGlow} p-4 md:p-5`}>
                <label className="block">
                  <span className="mb-2 block text-sm font-semibold uppercase tracking-[0.16em] text-primary">{t('note')}</span>
                  <textarea
                    value={customerNote}
                    onChange={(event) => setCustomerNote(event.target.value)}
                    maxLength={500}
                    rows={4}
                    placeholder={t('notePlaceholder')}
                    className={`${orderField} min-h-[120px] resize-y`}
                  />
                  <span className="mt-1.5 block text-right text-[11px] text-muted-foreground">{customerNote.length}/500</span>
                </label>
              </section>
            </div>

            <aside className="sticky top-16 z-20 min-w-0 self-start lg:col-span-4">
              <div className="order-panel flex flex-col border-t-2 border-t-primary">
                <div className="flex items-center justify-between border-b border-primary/15 px-4 py-3">
                  <h2 className="text-xl font-semibold uppercase tracking-[0.16em] text-primary">{t('servicesCheckout')}</h2>
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
                      {catalogStatus === 'ready' ? catalog.filter((service) => !isLegacyStage1(service)).length : '—'}
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
                  {catalogGroups.map((group) => (
                      <div key={group.category}>
                        <div className="mb-2 flex h-[22px] items-center rounded-xl border border-primary/70 bg-primary/15 px-3 shadow-[0_0_16px_rgba(0,242,255,0.4)]">
                          <h3 className="truncate text-sm font-bold uppercase leading-4 tracking-[0.16em] text-primary [text-shadow:0_0_8px_rgba(0,242,255,0.95),0_0_18px_rgba(0,242,255,0.55)]">{group.category}</h3>
                        </div>
                        <div className="space-y-1.5">
                          {group.category === 'Performance' && stageGroups.map((stageGroup) => (
                            <div key={stageGroup.id} className="min-w-0 rounded-xl border border-primary/20 bg-black/35 px-2.5 py-1">
                              <span className="block truncate text-[11px] font-semibold uppercase tracking-wide text-foreground">{stageGroup.label}</span>
                              <div className="mt-0.5">
                                <StageYearSelect
                                  label={stageGroup.label}
                                  value={stageGroupSelection(stageGroup, services)}
                                  options={stageGroup.options}
                                  onChange={(optionId) => selectStage(stageGroup.id, optionId)}
                                />
                              </div>
                            </div>
                          ))}
                          {group.items.filter((service) => !isLegacyStage1(service) && !isStageDropdownService(service)).map((service) => {
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
                  ))}
                  {errors.services && <p className="px-1 text-xs text-red-400">{t(errors.services)}</p>}
                </div>

                <div className="shrink-0 space-y-3 border-t border-primary/20 bg-black/45 p-4">
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
