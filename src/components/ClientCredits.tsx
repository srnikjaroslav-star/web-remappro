import { useEffect, useMemo, useState } from 'react';
import { RefreshCw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { accountDisplayName } from '@/lib/profileName';
import { supabase } from '@/lib/supabase';

type ClientAccount = {
  id: string;
  email: string;
  name: string;
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
      accountDisplayName(client).toLowerCase().includes(needle),
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
        <table className="w-full border-collapse text-base">
          <thead className="sticky top-0 z-50">
            <tr className="border-b border-primary/30 bg-[#0a192f] shadow-md">
              <th className="whitespace-nowrap border-r border-slate-500 p-2.5 text-left align-middle text-sm font-bold uppercase tracking-wide text-white">E-mail</th>
              <th className="w-full min-w-[16rem] whitespace-nowrap border-r border-slate-500 p-2.5 text-left align-middle text-sm font-bold uppercase tracking-wide text-white">Meno</th>
              <th className="min-w-[8.5rem] whitespace-nowrap border-r border-slate-500 p-4 text-center align-middle text-sm font-bold uppercase tracking-wide text-white">Zostatok</th>
              <th className="sticky right-0 z-10 min-w-[22rem] whitespace-nowrap border-r border-slate-500 bg-[#0a192f] p-2.5 text-center align-middle text-sm font-bold uppercase tracking-wide text-white">Úprava kreditov</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-muted-foreground">Načítavam klientov...</td>
              </tr>
            ) : visible.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-12 text-center text-muted-foreground">Žiadni klienti</td>
              </tr>
            ) : visible.map((client) => {
              const busy = adjustingId === client.id;
              const active = selectedId === client.id;
              const label = accountDisplayName(client);
              const cell = `border-r border-slate-800/60 px-4 py-2 align-middle ${active ? 'bg-slate-800/40' : ''}`;
              const actionButton = 'inline-flex min-h-12 min-w-[7.25rem] flex-1 items-center justify-center border-0 bg-transparent px-4 text-sm font-bold uppercase tracking-wide transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60';
              return (
                <tr
                  key={client.id}
                  onClick={() => setSelectedId(client.id)}
                  className="cursor-pointer border-b border-slate-800/60 align-middle"
                >
                  <td className={`${cell} whitespace-nowrap`}>
                    <p className="whitespace-nowrap text-xs leading-none text-white">{client.email || '—'}</p>
                  </td>
                  <td className={`${cell} w-full min-w-[16rem]`}>
                    <p className="whitespace-nowrap text-lg font-bold leading-none text-cyan-400">{label || '—'}</p>
                  </td>
                  <td className={`min-w-[8.5rem] whitespace-nowrap border-r border-slate-800/60 p-4 text-center align-middle ${active ? 'bg-slate-800/40' : ''}`}>
                    <p className="flex items-center justify-center text-xl font-bold leading-none text-primary">{money(client.balance)}</p>
                  </td>
                  <td className="sticky right-0 z-10 border-r border-slate-800/60 bg-[#070d16] px-3 py-2 align-middle" onClick={(event) => event.stopPropagation()}>
                    <div className="flex h-12 items-stretch overflow-hidden rounded-md border border-primary/35 bg-cyan-950/35 shadow-[0_0_16px_rgba(0,242,255,0.08)]">
                      <input
                        type="text"
                        inputMode="decimal"
                        value={drafts[client.id] ?? ''}
                        onChange={(event) => setDrafts((current) => ({ ...current, [client.id]: event.target.value }))}
                        placeholder="0,00"
                        disabled={busy}
                        className="w-32 shrink-0 border-0 bg-transparent px-3 text-center text-xl font-bold leading-none tabular-nums text-primary placeholder:font-bold placeholder:text-primary focus:outline-none disabled:opacity-60"
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
