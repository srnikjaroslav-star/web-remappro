import { useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react';
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

const readInvoke = async <T,>(result: { data: T | null; error: unknown }) => {
  if (result.data) return result.data;
  try {
    return await (result.error as { context?: Response }).context?.json() as T;
  } catch {
    return null;
  }
};

const fieldClass = 'h-11 w-full rounded-md border border-primary/50 bg-transparent px-3 text-sm text-foreground focus:outline-none';

const AdminServices = () => {
  const [services, setServices] = useState<CatalogService[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState<Draft>(emptyDraft);
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
      .filter((service) => !needle || [service.name, service.category, service.description].join(' ').toLowerCase().includes(needle))
      .sort((a, b) => rank(a.category) - rank(b.category) || a.name.localeCompare(b.name, 'sk'));
  }, [query, services]);

  const edit = (service: CatalogService) => {
    setConfirmId(null);
    setDraft({
      id: service.id,
      name: service.name,
      description: service.description,
      category: service.category,
      price: service.price.toFixed(2).replace('.', ','),
    });
  };

  const save = async () => {
    const price = draft.price.trim();
    if (!draft.name.trim() || !draft.category.trim() || !price) {
      toast.error('Vyplňte názov, kategóriu a cenu.');
      return;
    }
    setBusy(true);
    const result = await supabase.functions.invoke('manage-services', {
      body: {
        action: draft.id ? 'update' : 'create',
        id: draft.id || undefined,
        name: draft.name,
        description: draft.description,
        category: draft.category,
        price,
      },
    });
    const data = await readInvoke<{ ok?: boolean; code?: string }>(result);
    setBusy(false);
    if (!data?.ok) {
      toast.error(data?.code === 'FORBIDDEN' ? 'Na úpravu služieb nemáte oprávnenie.' : 'Službu sa nepodarilo uložiť.');
      return;
    }
    toast.success(draft.id ? 'Služba bola upravená.' : 'Služba bola pridaná.');
    if (!draft.id) setDraft(emptyDraft());
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
    if (draft.id === service.id) setDraft(emptyDraft());
    toast.success('Služba bola zmazaná.');
    reload();
  };

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/20 bg-background/40 p-4 shadow-[0_0_30px_rgba(59,130,246,0.15)] backdrop-blur-xl">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-primary">
            {draft.id ? 'Upraviť službu' : 'Nová služba'}
          </h2>
          {draft.id && (
            <button type="button" onClick={() => setDraft(emptyDraft())} className="text-xs font-semibold text-muted-foreground hover:text-primary">
              Zrušiť úpravu
            </button>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Názov</span>
            <input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} className={fieldClass} maxLength={120} />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Kategória</span>
            <select value={draft.category} onChange={(event) => setDraft((current) => ({ ...current, category: event.target.value }))} className={fieldClass}>
              {categories.map((category) => <option key={category} value={category} className="bg-[#050505]">{category}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Cena v kreditoch</span>
            <input value={draft.price} onChange={(event) => setDraft((current) => ({ ...current, price: event.target.value }))} inputMode="decimal" placeholder="0,00" className={`${fieldClass} text-center text-xl font-bold tabular-nums text-primary placeholder:text-primary/50`} />
          </label>
          <label className="block md:col-span-2 xl:col-span-1">
            <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Popis</span>
            <input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} maxLength={500} className={fieldClass} />
          </label>
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={save} disabled={busy} className="inline-flex h-11 items-center gap-2 rounded-md border border-primary/70 bg-primary/15 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_16px_rgba(0,242,255,0.28)] transition-colors hover:bg-primary/25 disabled:opacity-60">
            {draft.id ? <Pencil className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            {draft.id ? 'Uložiť zmeny' : 'Pridať službu'}
          </button>
        </div>
      </div>

      <div className="h-fit w-full shrink-0 rounded-xl border border-primary/20 bg-background/40 shadow-[0_0_30px_rgba(59,130,246,0.15)] backdrop-blur-xl">
        <div className="flex items-center justify-end gap-3 border-b border-primary/30 bg-[#0a192f] px-4 py-2.5">
          <p className="mr-auto text-sm font-bold uppercase tracking-wide text-white">{loading ? 'Služby' : `${services.length} služieb`}</p>
          <div className="relative w-72 shrink-0">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Hľadať službu..."
              className="h-[42px] w-full rounded-none border border-primary/50 bg-transparent py-2 pl-9 pr-4 text-base leading-6 text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none"
            />
          </div>
          <button type="button" onClick={reload} className="btn-secondary flex items-center gap-2 rounded-none px-4 py-2 text-base">
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Obnoviť
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <thead className="sticky top-0 z-50">
              <tr className="border-b border-primary/30 bg-[#0a192f] shadow-md">
                <th className="w-full min-w-[18rem] whitespace-nowrap border-r border-slate-500 p-2.5 text-left align-middle text-sm font-bold uppercase tracking-wide text-white">Služba</th>
                <th className="whitespace-nowrap border-r border-slate-500 p-2.5 text-left align-middle text-sm font-bold uppercase tracking-wide text-white">Kategória</th>
                <th className="min-w-[8.5rem] whitespace-nowrap border-r border-slate-500 p-4 text-center align-middle text-sm font-bold uppercase tracking-wide text-white">Kredity</th>
                <th className="sticky right-0 z-10 min-w-[16rem] whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-2.5 text-center align-middle text-sm font-bold uppercase tracking-wide text-white">Akcie</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">Načítavam služby...</td></tr>
              ) : visible.length === 0 ? (
                <tr><td colSpan={4} className="py-12 text-center text-muted-foreground">Žiadne služby</td></tr>
              ) : visible.map((service) => {
                const active = draft.id === service.id;
                const cell = `border-r border-slate-800/60 px-4 py-2 align-middle ${active ? 'bg-slate-800/40' : ''}`;
                return (
                  <tr key={service.id} onClick={() => edit(service)} className="cursor-pointer border-b border-slate-800/60">
                    <td className={cell}>
                      <p className="text-lg font-bold leading-none text-cyan-400">{service.name}</p>
                      {service.description && <p className="mt-1 text-xs text-white/70">{service.description}</p>}
                    </td>
                    <td className={`${cell} whitespace-nowrap text-sm text-white`}>{service.category}</td>
                    <td className={`${cell} text-center`}>
                      <p className="text-xl font-bold leading-none text-primary">{credits(service.price)}</p>
                    </td>
                    <td className="sticky right-0 z-10 border-r border-slate-800/60 bg-[#070d16] px-3 py-2 align-middle" onClick={(event) => event.stopPropagation()}>
                      <div className="flex h-12 overflow-hidden rounded-md border border-primary/35 bg-cyan-950/35 shadow-[0_0_16px_rgba(0,242,255,0.08)]">
                        <button type="button" onClick={() => edit(service)} className="inline-flex min-w-[7.25rem] flex-1 items-center justify-center gap-2 border-0 bg-transparent px-4 text-sm font-bold uppercase tracking-wide text-cyan-300 transition-colors hover:bg-cyan-500/20">
                          <Pencil className="h-4 w-4" />
                          Upraviť
                        </button>
                        <button type="button" disabled={busy} onClick={() => remove(service)} className="inline-flex min-w-[7.25rem] flex-1 items-center justify-center gap-2 border-0 bg-transparent px-4 text-sm font-bold uppercase tracking-wide text-red-400 transition-colors hover:bg-red-500/15 disabled:opacity-60">
                          <Trash2 className="h-4 w-4" />
                          {confirmId === service.id ? 'Potvrdiť' : 'Zmazať'}
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
