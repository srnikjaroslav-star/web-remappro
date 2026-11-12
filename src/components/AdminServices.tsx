import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';
import { catalogCategories, loadServiceCatalog, subscribeServiceCatalog, type CatalogService } from '@/lib/serviceCatalog';
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

const credits = (price: number) =>
  `${price.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CR`;

const categoryTone: Record<string, { text: string; color: string }> = {
  'Emission Control': { text: 'text-cyan-400', color: '#22d3ee' },
  'Engine Functions': { text: 'text-lime-400', color: '#a3e635' },
  Performance: { text: 'text-amber-400', color: '#fbbf24' },
  Security: { text: 'text-fuchsia-400', color: '#e879f9' },
};

const categoryTextClass = (category: string) => categoryTone[category]?.text ?? 'text-white';

const readInvoke = async <T,>(result: { data: T | null; error: unknown }) => {
  if (result.data) return result.data;
  try {
    return await (result.error as { context?: Response }).context?.json() as T;
  } catch {
    return null;
  }
};

const fieldClass = 'h-11 w-full rounded-md border border-primary/70 bg-[#0a192f] px-3 text-sm text-foreground shadow-[0_0_16px_rgba(0,242,255,0.28)] focus:border-primary focus:outline-none focus:shadow-[0_0_16px_rgba(0,242,255,0.45)]';
const inlineClass = 'h-12 w-full min-w-0 rounded-md border border-primary/50 bg-black/50 px-2.5 text-foreground focus:border-primary focus:outline-none focus:shadow-[0_0_12px_rgba(0,242,255,0.35)]';

const AdminServices = () => {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Draft>(emptyDraft);
  const [busy, setBusy] = useState(false);
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const reload = async () => {
    try {
      setServices(await loadServiceCatalog());
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
    setConfirmId(null);
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
    const price = current.price.trim();
    if (!current.name.trim() || !current.category.trim() || !price) {
      toast.error('Vyplňte názov, kategóriu a cenu.');
      return;
    }
    setBusy(true);
    const result = await supabase.functions.invoke('manage-services', {
      body: {
        action: current.id ? 'update' : 'create',
        id: current.id || undefined,
        name: current.name,
        description: current.description,
        category: current.category,
        price,
      },
    });
    const data = await readInvoke<{ ok?: boolean; code?: string }>(result);
    setBusy(false);
    if (!data?.ok) {
      toast.error(data?.code === 'FORBIDDEN' ? 'Na úpravu služieb nemáte oprávnenie.' : 'Službu sa nepodarilo uložiť.');
      return;
    }
    toast.success(current.id ? 'Služba bola upravená.' : 'Služba bola pridaná.');
    if (current.id) cancelEdit();
    else closeCreate();
    reload();
  };

  const remove = async (service: CatalogService) => {
    if (confirmId !== service.id) {
      setConfirmId(service.id);
      return;
    }
    setBusy(true);
    const result = await supabase.functions.invoke('manage-services', {
      body: { action: 'delete', id: service.id },
    });
    const data = await readInvoke<{ ok?: boolean; code?: string }>(result);
    setBusy(false);
    setConfirmId(null);
    if (!data?.ok) {
      toast.error('Službu sa nepodarilo zmazať.');
      return;
    }
    if (editingId === service.id) cancelEdit();
    if (selectedId === service.id) setSelectedId(null);
    toast.success('Služba bola zmazaná.');
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
            className="w-full max-w-3xl rounded-xl border border-primary/40 bg-[#070d16] p-4 shadow-[0_0_30px_rgba(0,242,255,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="new-service-title" className="text-2xl font-black uppercase leading-none tracking-[0.16em] text-primary">Nová služba</h2>
              <button type="button" onClick={closeCreate} aria-label="Zavrieť" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-red-400/45 bg-[#0a192f] text-xl leading-none text-red-400 shadow-[0_0_12px_rgba(248,113,113,0.28)] transition-colors hover:border-red-400 hover:bg-red-500/15 hover:shadow-[0_0_16px_rgba(248,113,113,0.5)]">
                ×
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
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
              <label className="block">
                <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Popis</span>
                <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={500} className={fieldClass} />
              </label>
            </div>
            <div className="mt-3 flex justify-end gap-3">
              <button type="button" onClick={closeCreate} className="inline-flex h-[42px] items-center gap-2 rounded-md border border-red-400/55 bg-[#0a192f] px-4 text-sm font-bold uppercase tracking-wide text-red-400 shadow-[0_0_16px_rgba(248,113,113,0.28)] transition-colors hover:border-red-400 hover:bg-red-500/15 hover:shadow-[0_0_16px_rgba(248,113,113,0.5)]">
                Zrušiť
              </button>
              <button type="button" onClick={() => save(draft)} disabled={busy} className="inline-flex h-[42px] items-center gap-2 rounded-md border border-primary/70 bg-primary/15 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_16px_rgba(0,242,255,0.28)] transition-colors hover:bg-primary/25 disabled:opacity-60">
                <Plus className="h-4 w-4" />
                Pridať službu
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
          <select
            value={categoryFilter}
            onChange={(event) => setCategoryFilter(event.target.value)}
            aria-label="Filtrovať kategóriu"
            className={`h-[42px] w-[15.5rem] shrink-0 rounded-md border border-primary/70 bg-[#0a192f] px-3 text-base leading-6 shadow-[0_0_16px_rgba(0,242,255,0.28)] focus:outline-none ${categoryFilter ? categoryTextClass(categoryFilter) : 'text-foreground'}`}
          >
            <option value="" className="bg-[#050505] text-white">Všetky kategórie</option>
            {catalogCategories.map((category) => (
              <option key={category} value={category} className="bg-[#050505]" style={{ color: categoryTone[category].color }}>
                {category}
              </option>
            ))}
          </select>
        </div>
        <div className="max-h-[calc(100vh-18.5rem)] overflow-auto">
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="border-b border-primary/30 bg-[#0a192f] shadow-md">
                <th className="sticky top-0 z-20 w-full min-w-[18rem] whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-2.5 text-left align-middle text-sm font-bold uppercase tracking-wide text-white">Služba</th>
                <th className="sticky top-0 z-20 whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-2.5 text-left align-middle text-sm font-bold uppercase tracking-wide text-white">Kategória</th>
                <th className="sticky top-0 z-20 min-w-[8.5rem] whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-4 text-center align-middle text-sm font-bold uppercase tracking-wide text-white">Kredity</th>
                <th className="sticky top-0 right-0 z-30 min-w-[16.690625rem] whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-2.5 text-center align-middle text-sm font-bold uppercase tracking-wide text-white">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">Načítavam služby...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">Žiadne služby</td></tr>
              ) : visible.map((service) => {
                const editing = editingId === service.id;
                const picked = !editing && selectedId === service.id
                  ? ' bg-[#0b2430] shadow-[inset_0_0_18px_rgba(0,242,255,0.16)]'
                  : '';
                const cell = editing
                  ? 'border-r border-slate-800/60 px-3 py-0 align-middle bg-slate-800/40'
                  : `border-r border-slate-800/60 px-4 py-0 align-middle${picked}`;
                return (
                  <tr key={service.id} onClick={() => setSelectedId(service.id)} className="cursor-pointer border-b border-slate-800/60">
                    <td className={cell}>
                      {editing ? (
                        <div className="w-0 min-w-full">
                          <input
                            value={editDraft.name}
                            onChange={(event) => setEditDraft((current) => ({ ...current, name: event.target.value }))}
                            maxLength={120}
                            aria-label="Názov služby"
                            className={`${inlineClass} text-lg font-bold leading-none text-cyan-400`}
                          />
                        </div>
                      ) : (
                        <>
                          <p className="text-lg font-bold leading-none text-cyan-400">{service.name}</p>
                          {service.description && <p className="mt-1 text-xs text-white/70">{service.description}</p>}
                        </>
                      )}
                    </td>
                    <td className={`border-r border-slate-800/60 py-0 align-middle text-sm font-normal text-white ${editing ? 'bg-slate-800/40 px-1' : `px-4${picked}`}`}>
                      {editing ? (
                        <div className="w-0 min-w-full">
                          <select
                            value={editDraft.category}
                            onChange={(event) => setEditDraft((current) => ({ ...current, category: event.target.value }))}
                            aria-label="Kategória"
                            className={`h-12 w-full min-w-0 rounded-md border border-primary/50 bg-black/50 pl-1.5 pr-1 text-sm font-normal focus:border-primary focus:outline-none focus:shadow-[0_0_12px_rgba(0,242,255,0.35)] ${categoryTextClass(editDraft.category)}`}
                          >
                            {categories.map((category) => (
                              <option key={category} value={category} className="bg-[#050505]" style={{ color: categoryTone[category]?.color ?? '#fafafa' }}>
                                {category}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : <span className={`whitespace-nowrap ${categoryTextClass(service.category)}`}>{service.category}</span>}
                    </td>
                    <td className={`${cell} text-center`}>
                      {editing ? (
                        <div className="w-0 min-w-full">
                          <input
                            value={editDraft.price}
                            onChange={(event) => setEditDraft((current) => ({ ...current, price: event.target.value }))}
                            inputMode="decimal"
                            placeholder="0,00"
                            aria-label="Cena v kreditoch"
                            className={`${inlineClass} text-center text-xl font-bold leading-none tabular-nums text-primary placeholder:text-primary/50`}
                          />
                        </div>
                      ) : (
                        <p className="text-xl font-bold leading-none text-primary">{credits(service.price)}</p>
                      )}
                    </td>
                    <td className={`sticky right-0 z-10 border-r border-slate-800/60 bg-[#070d16] py-0 align-middle ${editing ? 'px-3' : 'px-0'}`}>
                      {editing ? (
                        <div className="flex h-12 w-full overflow-hidden rounded-md border border-primary/35 bg-cyan-950/35 shadow-[0_0_16px_rgba(0,242,255,0.08)]">
                          <button type="button" disabled={busy} onClick={() => save(editDraft)} className="inline-flex h-full min-w-[7.25rem] flex-1 items-center justify-center gap-2 whitespace-nowrap border-0 bg-transparent px-3 text-sm font-bold uppercase tracking-wide text-cyan-300 transition-colors hover:bg-cyan-500/20 disabled:opacity-60">
                            <Check className="h-4 w-4 shrink-0" />
                            Uložiť
                          </button>
                          <button type="button" onClick={cancelEdit} className="inline-flex h-full min-w-[7.25rem] flex-1 items-center justify-center gap-2 whitespace-nowrap border-0 bg-transparent px-3 text-sm font-bold uppercase tracking-wide text-white/80 shadow-[inset_1px_0_0_rgba(0,234,255,0.35)] transition-colors hover:bg-white/10 hover:text-white">
                            <X className="h-4 w-4 shrink-0" />
                            Zrušiť
                          </button>
                        </div>
                      ) : (
                        <div className="flex h-12 w-full">
                          <button type="button" onClick={() => beginEdit(service)} className="inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 border-0 bg-cyan-500/15 px-3 text-sm font-bold uppercase tracking-wide text-cyan-300 transition-colors hover:bg-cyan-500/25">
                            <Pencil className="h-4 w-4 shrink-0" />
                            Upraviť
                          </button>
                          <button type="button" disabled={busy} onClick={() => remove(service)} className="inline-flex h-full min-w-0 flex-1 items-center justify-center gap-2 border-l-2 border-l-cyan-300/80 bg-red-500/15 px-3 text-sm font-bold uppercase tracking-wide text-red-400 transition-colors hover:bg-red-500/25 disabled:opacity-60">
                            <Trash2 className="h-4 w-4 shrink-0" />
                            {confirmId === service.id ? 'Potvrdiť' : 'Zmazať'}
                          </button>
                        </div>
                      )}
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
