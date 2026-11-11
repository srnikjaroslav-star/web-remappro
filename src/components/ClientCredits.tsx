import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { clientRecordName } from '@/lib/profileName';
import { supabase } from '@/lib/supabase';

type ClientAccount = {
  id: string;
  email: string;
  name: string;
  company?: string;
  balance: number;
};

const readInvoke = async <T,>(result: { data: T | null; error: unknown }) => {
  if (result.data) return result.data;
  try {
    return await (result.error as { context?: Response }).context?.json() as T;
  } catch {
    return null;
  }
};

const money = (value: number) =>
  `${value.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const sheetGrid = 'grid w-full grid-cols-[minmax(220px,max-content)_minmax(max-content,1fr)_max-content_20.25rem] text-base';
const nameCell = 'flex min-w-[220px] items-center whitespace-nowrap border-r border-slate-500 px-3 py-2 text-left';
const emailCell = 'flex min-w-max items-center whitespace-nowrap border-r border-slate-500 px-3 py-2 text-left';
const balanceCell = 'flex shrink-0 items-center whitespace-nowrap py-2 pl-3 pr-2';
const creditCell = 'flex shrink-0 items-center whitespace-nowrap';
const headChrome = 'sticky top-0 z-50 border-b border-primary/30 bg-[#0a192f] text-sm font-bold uppercase tracking-wide text-white';

const ClientCredits = () => {
  const [clients, setClients] = useState<ClientAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const loadClients = async () => {
    setLoading(true);
    const result = await supabase.functions.invoke('manage-clients', { body: { action: 'list' } });
    const data = await readInvoke<{ ok?: boolean; clients?: ClientAccount[]; code?: string }>(result);
    if (!data?.ok || !data.clients) {
      toast.error('Klientov sa nepodarilo načítať.');
      setLoading(false);
      return;
    }
    setClients(data.clients);
    setLoading(false);
  };

  useEffect(() => {
    loadClients();
  }, []);

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return clients;
    return clients.filter((client) =>
      client.email.toLowerCase().includes(needle) ||
      clientRecordName(client).toLowerCase().includes(needle),
    );
  }, [clients, query]);

  const adjust = async (client: ClientAccount, direction: 'add' | 'subtract') => {
    const amount = Number(String(drafts[client.id] ?? '').replace(',', '.'));
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Zadajte sumu väčšiu ako 0.');
      return;
    }
    setAdjustingId(client.id);
    const result = await supabase.functions.invoke('manage-clients', {
      body: { action: 'adjust', userId: client.id, amount, direction },
    });
    const data = await readInvoke<{ ok?: boolean; balance?: number; code?: string }>(result);
    setAdjustingId(null);
    if (!data?.ok || data.balance === undefined) {
      toast.error(data?.code === 'INSUFFICIENT_CREDITS'
        ? 'Na účte nie je dosť kreditov na odrátanie.'
        : 'Kredity sa nepodarilo upraviť.');
      return;
    }
    setClients((current) => current.map((item) => (
      item.id === client.id ? { ...item, balance: Number(data.balance) } : item
    )));
    setDrafts((current) => ({ ...current, [client.id]: '' }));
    toast.success(direction === 'add' ? 'Kredity boli pripísané.' : 'Kredity boli odrátané.');
  };

  return (
    <div className="h-fit w-full shrink-0 rounded-xl border border-primary/20 bg-background/40 shadow-[0_0_30px_rgba(59,130,246,0.15)] backdrop-blur-xl">
      <div className="flex items-center justify-end gap-3 border-b border-primary/30 bg-[#0a192f] px-4 py-2.5">
        <div className="relative w-72 shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Hľadať klienta..."
            className="h-[42px] w-full rounded-none border border-primary/50 bg-transparent py-2 pl-9 pr-4 text-base leading-6 text-foreground shadow-none placeholder:text-muted-foreground focus:outline-none"
          />
        </div>
        <button type="button" onClick={loadClients} className="btn-secondary flex items-center gap-2 rounded-none px-4 py-2 text-base">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Obnoviť
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className={sheetGrid}>
          <thead className="contents">
            <tr className="contents">
              <th className={`${nameCell} ${headChrome}`}>Meno</th>
              <th className={`${emailCell} ${headChrome}`}>E-mail</th>
              <th className={`${balanceCell} ${headChrome} justify-center text-center`}>Zostatok</th>
              <th className={`${creditCell} ${headChrome} justify-center px-2 py-2 text-center`}>Úprava kreditov</th>
            </tr>
          </thead>
          <tbody className="contents">
            {loading ? (
              <tr className="contents">
                <td colSpan={4} className="col-span-4 py-12 text-center text-muted-foreground">Načítavam klientov...</td>
              </tr>
            ) : visible.length === 0 ? (
              <tr className="contents">
                <td colSpan={4} className="col-span-4 py-12 text-center text-muted-foreground">Žiadni klienti</td>
              </tr>
            ) : visible.map((client) => {
              const busy = adjustingId === client.id;
              const active = selectedId === client.id;
              const label = clientRecordName(client);
              const rowBg = `cursor-pointer border-b border-slate-800/60 ${active ? 'bg-slate-800/40' : ''}`;
              const actionButton = 'inline-flex h-full min-w-0 flex-1 items-center justify-center border-0 bg-transparent px-2 text-sm font-bold uppercase tracking-wide transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60';
              return (
                <tr key={client.id} className="contents" onClick={() => setSelectedId(client.id)}>
                  <td className={`${nameCell} ${rowBg}`}>
                    <span className="text-base font-semibold leading-none text-cyan-400">{label || '—'}</span>
                  </td>
                  <td className={`${emailCell} ${rowBg}`}>
                    <span className="text-base font-medium leading-none text-white">{client.email || '—'}</span>
                  </td>
                  <td className={`${balanceCell} ${rowBg} justify-end text-right`}>
                    <span className="text-base font-bold leading-none tabular-nums text-primary">{money(client.balance)}</span>
                  </td>
                  <td className={`${creditCell} ${rowBg} items-stretch self-stretch p-0`} onClick={(event) => event.stopPropagation()}>
                    <div className="grid h-full min-h-10 w-full grid-cols-3 items-stretch overflow-hidden rounded-md border border-primary/35 bg-cyan-950/35 shadow-[0_0_16px_rgba(0,242,255,0.08)]">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={drafts[client.id] ?? ''}
                        onChange={(event) => setDrafts((current) => ({ ...current, [client.id]: event.target.value }))}
                        placeholder="0,00"
                        disabled={busy}
                        className="min-w-0 border-0 bg-transparent px-2 text-center text-base font-bold leading-none tabular-nums text-primary placeholder:font-bold placeholder:text-primary focus:outline-none disabled:opacity-60"
                      />
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => adjust(client, 'add')}
                        className={`${actionButton} text-cyan-300 hover:bg-cyan-500/20`}
                      >
                        Pripísať
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => adjust(client, 'subtract')}
                        className={`${actionButton} text-red-400 hover:bg-red-500/15`}
                      >
                        Odrátať
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
  );
};

export default ClientCredits;
