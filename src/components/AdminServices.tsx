import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ChevronDown, Pencil, Plus, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { catalogCategories, loadServiceCatalog, notifyServiceCatalogChanged, peekServiceCatalog, subscribeServiceCatalog, type CatalogService } from '@/lib/serviceCatalog';
import { formatCreditUnits } from '@/lib/creditUnits';
import { useLanguage } from '@/i18n/LanguageContext';
import { supabase } from '@/lib/supabase';

type Draft = {
  id: string;
  name: string;
  description: string;
  category: string;
  price: string;
};

const emptyDraft = (): Draft => ({
  id: '',
  name: '',
  description: '',
  category: catalogCategories[0],
  price: '',
});

const categoryTone: Record<string, { text: string; color: string }> = {
  'Emission Control': { text: 'text-cyan-400', color: '#22d3ee' },
  'Engine Functions': { text: 'text-lime-400', color: '#a3e635' },
  Performance: { text: 'text-amber-400', color: '#fbbf24' },
  Security: { text: 'text-fuchsia-400', color: '#e879f9' },
};

const categoryTextClass = (category: string) => categoryTone[category]?.text ?? 'text-white';

const CATEGORY_FILTER_OPTIONS = [
  { value: '', label: 'Všetky kategórie' },
  ...catalogCategories.map((category) => ({ value: category, label: category })),
];

const readPrice = (value: string) => {
  const price = Math.round(Number(value.trim().replace(',', '.')) * 100) / 100;
  if (!Number.isFinite(price) || price < 0 || price > 100000) return null;
  return price;
};

const fieldClass = 'h-11 w-full rounded-md border border-primary/70 bg-[#0a192f] px-3 text-sm text-foreground shadow-[0_0_16px_rgba(0,242,255,0.28)] focus:border-primary focus:outline-none focus:shadow-[0_0_16px_rgba(0,242,255,0.45)]';

const AdminServices = () => {
  const { language } = useLanguage();
  const knownCatalog = peekServiceCatalog();
  const [services, setServices] = useState<CatalogService[]>(knownCatalog ?? []);
  const [loading, setLoading] = useState(!knownCatalog);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const [categoryHighlight, setCategoryHighlight] = useState('');
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const categoryFilterButtonRef = useRef<HTMLButtonElement>(null);
  const categoryMenuOpenRef = useRef(false);
  const categoryHighlightRef = useRef('');
  categoryMenuOpenRef.current = categoryMenuOpen;
  categoryHighlightRef.current = categoryHighlight;
  const moveCategoryHighlight = (direction: 1 | -1) => {
    const values = CATEGORY_FILTER_OPTIONS.map((option) => option.value);
    const base = categoryMenuOpenRef.current ? categoryHighlightRef.current : categoryFilter;
    const index = Math.max(0, values.indexOf(base));
    const next = values[(index + direction + values.length) % values.length];
    categoryHighlightRef.current = next;
    categoryMenuOpenRef.current = true;
    setCategoryHighlight(next);
    setCategoryMenuOpen(true);
  };
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<CatalogService | null>(null);

  const reload = async () => {
    try {
      setServices(await loadServiceCatalog(true));
    } catch {
      toast.error('Služby sa nepodarilo načítať.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    reload();
    return subscribeServiceCatalog(() => {
      reload();
    });
  }, []);

  useEffect(() => {
    if (!categoryMenuOpen) return;
    const mark = categoryHighlight || 'all';
    categoryMenuRef.current?.querySelector<HTMLElement>(`[data-category="${CSS.escape(mark)}"]`)?.focus({ preventScroll: true });
    const close = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Node && categoryMenuRef.current?.contains(target)) return;
      setCategoryMenuOpen(false);
    };
    document.addEventListener('mousedown', close, true);
    return () => document.removeEventListener('mousedown', close, true);
  }, [categoryMenuOpen, categoryHighlight]);

  const categories = useMemo(() => {
    const extra = services
      .map((service) => service.category)
      .filter((category) => !catalogCategories.includes(category));
    return [...catalogCategories, ...new Set(extra)];
  }, [services]);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const rank = (category: string) => {
      const index = catalogCategories.indexOf(category);
      return index === -1 ? catalogCategories.length : index;
    };
    return services
      .filter((service) => !categoryFilter || service.category === categoryFilter)
      .filter((service) => !needle || [service.name, service.category, service.description].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name, 'sk'));
  }, [categoryFilter, query, services]);

  const beginEdit = (service: CatalogService) => {
    setPendingDelete(null);
    setEditingId(service.id);
    setEditDraft({
      id: service.id,
      name: service.name,
      description: service.description,
      category: service.category,
      price: service.price.toFixed(2).replace('.', ','),
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditDraft(emptyDraft());
  };

  const closeCreate = () => {
    setCreating(false);
    setDraft(emptyDraft());
  };

  const save = async (current: Draft) => {
    const price = readPrice(current.price);
    if (!current.name.trim() || !current.category.trim() || price === null) {
      toast.error('Vyplňte názov, kategóriu a cenu.');
      return;
    }
    setBusy(true);
    const payload = {
      name: current.name.trim(),
      category: current.category.trim(),
      price,
    };
    const saved = current.id
      ? await supabase.from('services').update(payload).eq('id', current.id).select('id').maybeSingle()
      : await supabase.from('services').insert(payload).select('id').maybeSingle();
    const serviceId = saved.data?.id;
    if (saved.error || !serviceId) {
      setBusy(false);
      toast.error(saved.error?.code === '42501' ? 'Na úpravu služieb nemáte oprávnenie.' : 'Službu sa nepodarilo uložiť.');
      return;
    }
    setBusy(false);
    toast.success(current.id ? 'Služba bola upravená.' : 'Služba bola pridaná.');
    if (current.id) cancelEdit();
    else closeCreate();
    notifyServiceCatalogChanged();
    reload();
  };

  const closeDelete = () => {
    if (busy) return;
    setPendingDelete(null);
  };

  const confirmRemove = async () => {
    const service = pendingDelete;
    if (!service) return;
    setBusy(true);
    const removed = await supabase.from('services').delete().eq('id', service.id).select('id').maybeSingle();
    setBusy(false);
    setPendingDelete(null);
    if (removed.error || !removed.data?.id) {
      toast.error('Službu sa nepodarilo zmazať.');
      return;
    }
    if (editingId === service.id) cancelEdit();
    if (selectedId === service.id) setSelectedId(null);
    toast.success('Služba bola zmazaná.');
    notifyServiceCatalogChanged();
    reload();
  };

  return (
    <div className="space-y-3">
      {creating && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onClick={closeCreate}
          onKeyDown={(event) => { if (event.key === 'Escape') closeCreate(); }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-service-title"
            className="w-full max-w-md rounded-xl border border-primary/40 bg-[#070d16] p-4 shadow-[0_0_30px_rgba(0,242,255,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="new-service-title" className="text-2xl font-black uppercase leading-none tracking-[0.16em] text-primary">Nová služba</h2>
              <button type="button" onClick={closeCreate} aria-label="Zavrieť" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-none border border-red-400/70 bg-red-500/10 text-xl leading-none text-red-400 shadow-[0_0_12px_rgba(248,113,113,0.32)] transition-colors hover:border-red-400 hover:bg-red-500/15 hover:shadow-[0_0_16px_rgba(248,113,113,0.45)]">
                ×
              </button>
            </div>
            <div className="grid gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Názov</span>
                <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className={fieldClass} maxLength={120} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kategória</span>
                <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} className={`${fieldClass.replace(' text-foreground', '')} ${categoryTextClass(draft.category)}`}>
                  {categories.map((category) => (
                    <option key={category} value={category} className="bg-[#050505]" style={{ color: categoryTone[category]?.color ?? '#fafafa' }}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cena v kreditoch</span>
                <input value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} inputMode="decimal" placeholder="0,00" className={`${fieldClass} text-center text-xl font-bold tabular-nums text-primary placeholder:text-primary/50`} />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-3">
              <button type="button" onClick={closeCreate} className="inline-flex h-[42px] items-center gap-2 rounded-none border border-red-400/70 bg-red-500/10 px-4 text-sm font-bold uppercase tracking-wide text-red-400 shadow-[0_0_14px_rgba(248,113,113,0.32)] transition-colors hover:border-red-400 hover:bg-red-500/16 hover:shadow-[0_0_16px_rgba(248,113,113,0.42)]">
                Zrušiť
              </button>
              <button type="button" onClick={() => save(draft)} disabled={busy} className="inline-flex h-[42px] items-center gap-2 rounded-none border border-primary/80 bg-primary/10 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)] transition-colors hover:border-primary hover:bg-primary/16 hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] disabled:opacity-60">
                <Plus className="h-4 w-4" />
                Pridať službu
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {editingId && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-service-title"
            className="w-full max-w-md rounded-xl border border-primary/40 bg-[#070d16] p-4 shadow-[0_0_30px_rgba(0,242,255,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="edit-service-title" className="text-2xl font-black uppercase leading-none tracking-[0.16em] text-primary">Upraviť službu</h2>
            </div>
            <div className="grid gap-3">
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Názov</span>
                <input value={editDraft.name} onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))} className={fieldClass} maxLength={120} />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kategória</span>
                <select value={editDraft.category} onChange={(event) => setEditDraft((current) => ({ ...current, category: event.target.value }))} className={`${fieldClass.replace(' text-foreground', '')} ${categoryTextClass(editDraft.category)}`}>
                  {categories.map((category) => (
                    <option key={category} value={category} className="bg-[#050505]" style={{ color: categoryTone[category]?.color ?? '#fafafa' }}>
                      {category}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cena v kreditoch</span>
                <input value={editDraft.price} onChange={(event) => setEditDraft((current) => ({ ...current, price: event.target.value }))} inputMode="decimal" placeholder="0,00" className={`${fieldClass} text-center text-xl font-bold tabular-nums text-primary placeholder:text-primary/50`} />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-3">
              <button type="button" onClick={cancelEdit} className="inline-flex h-[42px] items-center gap-2 rounded-none border border-primary/80 bg-primary/10 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)] transition-colors hover:border-primary hover:bg-primary/16 hover:shadow-[0_0_16px_rgba(0,242,255,0.42)]">
                Zrušiť
              </button>
              <button type="button" onClick={() => save(editDraft)} disabled={busy} className="inline-flex h-[42px] items-center gap-2 rounded-none border border-green-400/80 bg-green-500/10 px-4 text-sm font-bold uppercase tracking-wide text-green-400 shadow-[0_0_14px_rgba(74,222,128,0.32)] transition-colors hover:border-green-400 hover:bg-green-500/16 hover:shadow-[0_0_16px_rgba(74,222,128,0.42)] disabled:opacity-60">
                <Check className="h-4 w-4" />
                Uložiť
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      {pendingDelete && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-service-title"
            className="w-full max-w-md rounded-xl border border-primary/40 bg-[#070d16] p-4 shadow-[0_0_30px_rgba(0,242,255,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="delete-service-title" className="text-sm font-bold uppercase tracking-[0.14em] text-primary">Zmazať službu</h2>
            <p className="mt-3 text-sm leading-relaxed text-foreground">
              Naozaj chcete zmazať službu <span className="font-semibold text-cyan-400">{pendingDelete.name}</span>?
            </p>
            <div className="mt-4 flex flex-wrap justify-end gap-3">
              <button type="button" onClick={closeDelete} disabled={busy} className="inline-flex h-[42px] items-center gap-2 rounded-none border border-primary/80 bg-primary/10 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)] transition-colors hover:border-primary hover:bg-primary/16 hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] disabled:opacity-60">
                Zrušiť
              </button>
              <button type="button" onClick={confirmRemove} disabled={busy} className="inline-flex h-[42px] items-center gap-2 rounded-none border border-red-500/80 bg-red-500/10 px-4 text-sm font-bold uppercase tracking-wide text-red-400 shadow-[0_0_14px_rgba(239,68,68,0.32)] transition-colors hover:border-red-400 hover:bg-red-500/16 hover:shadow-[0_0_16px_rgba(239,68,68,0.42)] disabled:opacity-60">
                <Trash2 className="h-4 w-4" />
                Zmazať
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      <div className="h-fit w-full shrink-0 rounded-xl border border-primary/20 bg-background/40 shadow-[0_0_30px_rgba(59,130,246,0.15)] backdrop-blur-xl">
        <div className="flex items-center justify-end gap-3 border-b border-primary/30 bg-[#0a192f] py-2.5 pl-4 pr-4">
          <button type="button" onClick={() => setCreating(true)} className="inline-flex h-[42px] shrink-0 items-center gap-2 rounded-md border border-primary/70 bg-primary/15 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_16px_rgba(0,242,255,0.28)] transition-colors hover:bg-primary/25">
            <Plus className="h-4 w-4" />
            Pridať službu
          </button>
          <div className="relative w-56 shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Hľadať službu..."
              className="h-[42px] w-full rounded-md border border-primary/70 bg-transparent py-2 pl-9 pr-4 text-base leading-6 text-foreground shadow-[0_0_16px_rgba(0,242,255,0.28)] placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <span className="inline-flex h-[42px] shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-primary/70 bg-primary/15 px-2.5 shadow-[0_0_16px_rgba(0,242,255,0.28)]" aria-label={loading ? 'Služby' : `${services.length} služieb`}>
            {loading ? (
              <span className="text-sm font-bold uppercase tracking-wide text-primary">Služby</span>
            ) : (
              <>
                <span className="text-2xl font-black leading-none tabular-nums text-cyan-400">{services.length}</span>
                <span className="text-[10px] font-bold uppercase leading-none tracking-wide text-primary/80">služieb</span>
              </>
            )}
          </span>
          <div
            ref={categoryMenuRef}
            className={`relative grid w-max shrink-0 ${categoryMenuOpen ? 'z-40' : ''}`}
            onFocusOut={(event) => {
              const next = event.relatedTarget;
              if (next instanceof Node && categoryMenuRef.current?.contains(next)) return;
              window.setTimeout(() => {
                const active = document.activeElement;
                if (active instanceof Node && categoryMenuRef.current?.contains(active)) return;
                setCategoryMenuOpen(false);
              }, 0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Tab') {
                setCategoryMenuOpen(false);
                return;
              }
              if (event.key === 'Escape') {
                if (!categoryMenuOpenRef.current) return;
                event.preventDefault();
                setCategoryMenuOpen(false);
                categoryFilterButtonRef.current?.focus();
                return;
              }
              if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
              event.preventDefault();
              moveCategoryHighlight(event.key === 'ArrowDown' ? 1 : -1);
            }}
          >
            {CATEGORY_FILTER_OPTIONS.map((option) => (
              <span key={option.label} aria-hidden className="invisible col-start-1 row-start-1 flex h-[42px] w-max items-center gap-2 whitespace-nowrap border border-transparent px-3 text-base leading-6">
                {option.label}
                <span className="inline-block h-4 w-4 shrink-0" />
              </span>
            ))}
            <button
              ref={categoryFilterButtonRef}
              type="button"
              aria-haspopup="listbox"
              aria-expanded={categoryMenuOpen}
              aria-label="Filtrovať kategóriu"
              onClick={() => {
                if (categoryMenuOpenRef.current) {
                  setCategoryMenuOpen(false);
                  return;
                }
                categoryHighlightRef.current = categoryFilter;
                categoryMenuOpenRef.current = true;
                setCategoryHighlight(categoryFilter);
                setCategoryMenuOpen(true);
              }}
              className={`col-start-1 row-start-1 inline-flex h-[42px] w-full items-center gap-2 whitespace-nowrap rounded-md border border-primary/70 bg-[#0a192f] px-3 text-left text-base leading-6 shadow-[0_0_16px_rgba(0,242,255,0.28)] focus:outline-none ${categoryFilter ? categoryTextClass(categoryFilter) : 'text-foreground'}`}
            >
              <span>{CATEGORY_FILTER_OPTIONS.find((option) => option.value === categoryFilter)?.label ?? 'Všetky kategórie'}</span>
              <ChevronDown className="ml-auto h-4 w-4 shrink-0" />
            </button>
            {categoryMenuOpen ? (
              <div
                role="listbox"
                aria-label="Kategória služieb"
                className="services-category-menu absolute right-0 top-[calc(100%+4px)] z-40 min-w-full overflow-hidden rounded-md border border-white/15 py-1 shadow-[0_12px_32px_rgba(0,0,0,0.55)]"
              >
                {CATEGORY_FILTER_OPTIONS.map((option) => (
                  <button
                    key={option.label}
                    type="button"
                    role="option"
                    data-category={option.value || 'all'}
                    aria-selected={categoryHighlight === option.value}
                    onClick={() => {
                      setCategoryFilter(option.value);
                      setCategoryMenuOpen(false);
                      categoryFilterButtonRef.current?.focus();
                    }}
                    className="block w-full whitespace-nowrap px-3 py-2 text-left text-base leading-6"
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
        <div className="max-h-[calc(100vh-18.5rem)] overflow-auto">
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="border-b border-primary/30 bg-[#0a192f] shadow-md">
                <th className="sticky top-0 z-20 w-full min-w-[18rem] whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-2.5 text-left align-middle text-sm font-bold uppercase tracking-wide text-white">Služba</th>
                <th className="sticky top-0 z-20 whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-2.5 text-left align-middle text-sm font-bold uppercase tracking-wide text-white">Kategória</th>
                <th className="sticky top-0 z-20 min-w-[13rem] whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-4 text-center align-middle text-sm font-bold uppercase tracking-wide text-white">Kredity</th>
                <th className="sticky top-0 right-0 z-30 min-w-[16.690625rem] whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-2.5 text-center align-middle text-sm font-bold uppercase tracking-wide text-white">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">Načítavam služby...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">Žiadne služby</td></tr>
              ) : visible.map((service) => {
                const picked = selectedId === service.id
                  ? ' bg-[#0b2430] shadow-[inset_0_0_18px_rgba(0,242,255,0.16)]'
                  : '';
                const cell = `border-r border-slate-800/60 px-4 py-0 align-middle${picked}`;
                return (
                  <tr key={service.id} onClick={() => setSelectedId(service.id)} className="cursor-pointer border-b border-slate-800/60">
                    <td className={cell}>
                      <p className="text-lg font-bold leading-none text-cyan-400">{service.name}</p>
                      {service.description && <p className="mt-1 text-xs text-white/70">{service.description}</p>}
                    </td>
                    <td className={`border-r border-slate-800/60 px-4 py-0 align-middle text-sm font-normal text-white${picked}`}>
                      <span className={`whitespace-nowrap ${categoryTextClass(service.category)}`}>{service.category}</span>
                    </td>
                    <td className={`${cell} text-center`}>
                      <p className="whitespace-nowrap text-xl font-bold leading-none text-primary">{formatCreditUnits(service.price, language)}</p>
                    </td>
                    <td className="sticky right-0 z-10 border-r border-slate-800/60 bg-[#070d16] px-0 py-0 align-middle">
                      <div className="flex h-8 w-full">
                        <button type="button" onClick={(event) => { event.stopPropagation(); beginEdit(service); }} className="inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 rounded-none border border-primary/80 bg-primary/10 px-3 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_12px_rgba(0,242,255,0.28)] transition-colors hover:border-primary hover:bg-primary/16 hover:shadow-[0_0_14px_rgba(0,242,255,0.4)]">
                          <Pencil className="h-4 w-4 shrink-0" />
                          Upraviť
                        </button>
                        <button type="button" disabled={busy} onClick={() => setPendingDelete(service)} className="inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 rounded-none border border-red-400/70 bg-red-500/10 px-3 text-sm font-bold uppercase tracking-wide text-red-400 shadow-[0_0_12px_rgba(248,113,113,0.28)] transition-colors hover:border-red-400 hover:bg-red-500/16 hover:shadow-[0_0_14px_rgba(248,113,113,0.4)] disabled:opacity-60">
                          <Trash2 className="h-4 w-4 shrink-0" />
                          Zmazať
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default AdminServices;
