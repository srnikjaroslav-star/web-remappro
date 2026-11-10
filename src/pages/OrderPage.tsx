import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
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
import { redirectToCheckout, generateOrderId } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import {
  AlertTriangle,
  Calendar,
  Car,
  Check,
  CheckCircle2,
  Coins,
  Cpu,
  CreditCard,
  File,
  Fuel,
  Gauge,
  Loader2,
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
  const [isSubmitting, setIsSubmitting] = useState<'card' | 'credits' | null>(null);
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

  const uploadAndPayByCard = async () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error(t('toastCheckFields'));
      return;
    }
    if (!selectedFile) return;

    setIsSubmitting('card');
    try {
      toast.loading(t('toastUploading'), { id: 'upload' });
      const fileName = `${Date.now()}-${selectedFile.name}`;
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('tunes')
        .upload(fileName, selectedFile);

      if (uploadError || !uploadData?.path) {
        toast.dismiss('upload');
        toast.error(`${t('toastUploadFailed')}: ${uploadError?.message || t('toastUploadSaved')}`);
        setIsSubmitting(null);
        return;
      }

      const uploadedFileName = uploadData.path;
      toast.dismiss('upload');
      toast.success(t('toastUploaded'));

      const orderId = generateOrderId();
      const vehiclePayload = {
        brand: vehicle.brand,
        model: vehicle.model,
        fuelType: vehicle.fuelType,
        year: vehicle.year,
        ecuType: vehicle.ecuType,
        engineDisplacement: vehicle.engine,
        enginePower: '',
      };

      sessionStorage.setItem(
        'pendingOrder',
        JSON.stringify({
          orderId,
          customer,
          vehicle: vehiclePayload,
          services,
          fileUrl: uploadedFileName,
          customerNote: composedNote,
          totalPrice,
          legalConsent: legalConsentAgreed,
        }),
      );

      await redirectToCheckout({
        items: selectedItems.map((service) => ({ name: service.name, price: service.price })),
        orderId,
        customerEmail: customer.email,
        customerName: customer.name,
        customerNote: composedNote,
        vehicle: vehiclePayload,
        fileUrl: uploadedFileName,
        services,
        legalConsent: legalConsentAgreed,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : t('toastPayFailed');
      toast.error(message);
      setIsSubmitting(null);
    }
  };

  const payWithCredits = () => {
    const nextErrors = validate();
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) {
      toast.error(t('toastCheckFields'));
      return;
    }
    toast.error(t('toastCredits'));
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
        <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-sm">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3 px-4 py-3 lg:px-8">
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
            <div className="flex items-center justify-end gap-3">
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
              <Link to="/track" className="btn-secondary flex items-center gap-2 px-4 py-2 text-sm">
                <Search className="h-4 w-4" />
                <span className="hidden sm:inline">{t('trackOrder')}</span>
              </Link>
            </div>
          </div>
        </header>

        <div className="mx-auto w-full max-w-[1600px] flex-grow px-4 pb-6 pt-2 lg:px-8">
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
                                <span className="min-w-0 flex-1 truncate text-sm font-medium">{service.name}</span>
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

                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={payWithCredits}
                      disabled={isSubmitting !== null}
                      aria-label={t('payCreditsAria')}
                      className="btn-secondary flex min-h-[52px] flex-col items-center justify-center gap-0.5 !px-2 !py-2 text-center text-primary disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
                        <Coins className="h-3.5 w-3.5" />
                        {t('pay')}
                      </span>
                      <span className="text-sm font-bold leading-none">{t('payCredits')}</span>
                    </button>
                    <button
                      type="button"
                      onClick={uploadAndPayByCard}
                      disabled={isSubmitting !== null}
                      aria-label={t('payCardAria')}
                      className="btn-primary flex min-h-[52px] flex-col items-center justify-center gap-0.5 !px-2 !py-2 text-center disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isSubmitting === 'card' ? (
                        <Loader2 className="h-5 w-5 animate-spin" />
                      ) : (
                        <>
                          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide">
                            <CreditCard className="h-3.5 w-3.5" />
                            {t('payCard')}
                          </span>
                          <span className="text-sm font-bold leading-none">{t('stripe')}</span>
                        </>
                      )}
                    </button>
                  </div>
                  <p className="text-center text-[10px] text-muted-foreground">
                    {t('promoHint')}
                  </p>
                </div>
              </div>
            </aside>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OrderPage;
