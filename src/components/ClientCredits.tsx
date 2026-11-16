import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Search } from 'lucide-react';
import { toast } from 'sonner';
import ConnectionDot from '@/components/ConnectionDot';
import { loadClientBilling, loadPortalActivityByClient, readCreditBalance, saveCreditBalance, type PortalActivity } from '@/lib/clientProfile';
import { clientRecordName, joinProfileName } from '@/lib/profileName';
import { supabase } from '@/lib/supabase';

type ClientAccount = {
  id: string;
  email: string;
  name: string;
  company?: string;
  balance: number;
};

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

const money = (value: number) =>
  `${value.toLocaleString('sk-SK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;

const formatActivity = (value: string | null) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('sk-SK', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const sheetGrid = 'grid w-full grid-cols-[minmax(220px,max-content)_minmax(180px,1fr)_6.5rem_11.5rem_max-content_20.25rem] text-base';
const nameCell = 'flex min-w-[220px] items-center whitespace-nowrap border-r border-slate-500 px-3 py-2 text-left';
const emailCell = 'flex min-w-max items-center whitespace-nowrap border-r border-slate-500 px-3 py-2 text-left';
const balanceCell = 'flex shrink-0 items-center whitespace-nowrap border-r border-slate-500 py-2 pl-3 pr-2';
const visitsCell = 'flex shrink-0 items-center justify-center whitespace-nowrap border-r border-slate-500 px-3 py-2 text-center';
const activityCell = 'flex shrink-0 items-center whitespace-nowrap border-r border-slate-500 px-3 py-2';
const creditCell = 'flex shrink-0 items-center whitespace-nowrap';
const headChrome = 'sticky top-0 z-50 border-b border-primary/30 bg-[#0a192f] text-sm font-bold uppercase tracking-wide text-white';

type ClientCreditsProps = {
  onlineIds: ReadonlySet<string>;
};

type CreditDirection = 'add' | 'subtract';

type PendingCredit = {
  clientId: string;
  direction: CreditDirection;
};

const amountField = 'h-11 w-full rounded-md border border-primary/70 bg-[#0a192f] px-3 text-center text-xl font-bold tabular-nums text-primary shadow-[0_0_16px_rgba(0,242,255,0.28)] placeholder:text-primary/50 focus:border-primary focus:outline-none focus:shadow-[0_0_16px_rgba(0,242,255,0.45)]';

const ClientCredits = ({ onlineIds }: ClientCreditsProps) => {
  const [clients, setClients] = useState<ClientAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [amount, setAmount] = useState('');
  const [pending, setPending] = useState<PendingCredit | null>(null);
  const [adjustingId, setAdjustingId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activity, setActivity] = useState<Record<string, PortalActivity>>({});

  const loadClients = async () => {
    setLoading(true);
    const { data: authData, error: authError } = await supabase.auth.getUser();
    const user = authData.user;
    if (authError || !user) {
      toast.error('Klientov sa nepodarilo načítať.');
      setClients([]);
      setLoading(false);
      return;
    }

    const billing = await loadClientBilling(user);
    const balance = await readCreditBalance(user.id);
    const meta = user.user_metadata ?? {};
    const metaName = joinProfileName(
      typeof meta.first_name === 'string' ? meta.first_name : '',
      typeof meta.last_name === 'string' ? meta.last_name : '',
    );

    const rows = [{
      id: user.id,
      email: billing?.email || user.email || '',
      name: joinProfileName(billing?.firstName, billing?.lastName) || metaName,
      company: billing?.company || text(meta.company) || text(meta.company_name),
      balance: Number.isFinite(balance) ? balance : 0,
    }];
    const stats = await loadPortalActivityByClient(rows);
    setClients(rows);
    setActivity(Object.fromEntries(stats));
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

  const onlineCount = useMemo(
    () => clients.reduce((count, client) => count + (onlineIds.has(client.id) ? 1 : 0), 0),
    [clients, onlineIds],
  );
  const offlineCount = Math.max(0, clients.length - onlineCount);

  const pendingClient = pending ? clients.find((client) => client.id === pending.clientId) ?? null : null;

  const openCredit = (client: ClientAccount, direction: CreditDirection) => {
    setAmount('');
    setPending({ clientId: client.id, direction });
  };

  const closeCredit = () => {
    if (adjustingId) return;
    setPending(null);
    setAmount('');
  };

  useEffect(() => {
    if (!pending) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeCredit();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pending, adjustingId]);

  const confirmAdjust = async () => {
    if (!pendingClient || !pending) return;
    const value = Number(amount.trim().replace(',', '.'));
    if (!Number.isFinite(value) || value <= 0) {
      toast.error('Zadajte sumu väčšiu ako 0.');
      return;
    }
    const delta = pending.direction === 'subtract' ? -value : value;
    const nextBalance = Math.round((pendingClient.balance + delta) * 100) / 100;
    if (nextBalance < 0) {
      toast.error('Na účte nie je dosť kreditov na odrátanie.');
      return;
    }
    setAdjustingId(pendingClient.id);
    const saved = await saveCreditBalance(pendingClient.id, nextBalance);
    const balance = saved ? await readCreditBalance(pendingClient.id) : nextBalance;
    setAdjustingId(null);
    setClients((current) => current.map((item) => (
      item.id === pendingClient.id ? { ...item, balance } : item
    )));
    setPending(null);
    setAmount('');
    if (saved) toast.success(pending.direction === 'add' ? 'Kredity boli pripísané.' : 'Kredity boli odrátané.');
  };

  const confirmLabel = pending?.direction === 'subtract' ? 'Odrátať' : 'Pripísať';
  const confirmClass = pending?.direction === 'subtract'
    ? 'inline-flex h-[42px] items-center gap-2 rounded-none border border-red-500/80 bg-red-500/10 px-4 text-sm font-bold uppercase tracking-wide text-red-400 shadow-[0_0_14px_rgba(239,68,68,0.32)] transition-colors hover:border-red-400 hover:bg-red-500/16 hover:shadow-[0_0_16px_rgba(239,68,68,0.42)] disabled:opacity-60'
    : 'inline-flex h-[42px] items-center gap-2 rounded-none border border-primary/80 bg-primary/10 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_14px_rgba(0,242,255,0.32)] transition-colors hover:border-primary hover:bg-primary/16 hover:shadow-[0_0_16px_rgba(0,242,255,0.42)] disabled:opacity-60';

  return (
    <div className="h-fit w-full shrink-0 rounded-xl border border-primary/20 bg-background/40 shadow-[0_0_30px_rgba(59,130,246,0.15)] backdrop-blur-xl">
      {pendingClient && pending && createPortal(
        <div
          className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4"
          onClick={closeCredit}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="credit-edit-title"
            className="w-full max-w-md rounded-xl border border-primary/40 bg-[#070d16] p-4 shadow-[0_0_30px_rgba(0,242,255,0.22)]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 id="credit-edit-title" className="text-2xl font-black uppercase leading-none tracking-[0.16em] text-primary">{pending.direction === 'subtract' ? 'Odrátať kredity' : 'Pripísať kredity'}</h2>
              <button type="button" onClick={closeCredit} aria-label="Zavrieť" className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-none border border-red-400/70 bg-red-500/10 text-xl leading-none text-red-400 shadow-[0_0_12px_rgba(248,113,113,0.32)] transition-colors hover:border-red-400 hover:bg-red-500/15 hover:shadow-[0_0_16px_rgba(248,113,113,0.45)]">
                ×
              </button>
            </div>
            <div className="mb-3 rounded-lg border border-primary/20 bg-black/40 px-3 py-2.5">
              <p className="text-sm font-semibold leading-none text-cyan-400">{clientRecordName(pendingClient) || '—'}</p>
              <p className="mt-1.5 text-sm font-medium leading-none text-white">{pendingClient.email || '—'}</p>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Zostatok <span className="ml-2 text-base font-bold normal-case tracking-normal text-primary">{money(pendingClient.balance)}</span>
              </p>
            </div>
            <label className="block">
              <span className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Suma kreditov</span>
              <input
                type="text"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                placeholder="0,00"
                disabled={adjustingId === pendingClient.id}
                autoFocus
                className={amountField}
              />
            </label>
            <div className="mt-3 flex justify-end gap-3">
              <button type="button" onClick={closeCredit} disabled={adjustingId === pendingClient.id} className="inline-flex h-[42px] items-center gap-2 rounded-none border border-red-400/70 bg-red-500/10 px-4 text-sm font-bold uppercase tracking-wide text-red-400 shadow-[0_0_14px_rgba(248,113,113,0.32)] transition-colors hover:border-red-400 hover:bg-red-500/16 hover:shadow-[0_0_16px_rgba(248,113,113,0.42)] disabled:opacity-60">
                Zrušiť
              </button>
              <button type="button" onClick={confirmAdjust} disabled={adjustingId === pendingClient.id} className={confirmClass}>
                {confirmLabel}
              </button>
            </div>
          </div>
        </div>,
        document.body,
      )}
      <div className="flex items-center gap-3 border-b border-primary/30 bg-[#0a192f] px-4 py-2.5">
        <div className="mr-auto inline-flex h-[42px] shrink-0 items-center gap-3" aria-live="polite" aria-label="Stav prihlásenia klientov">
          <div className="inline-flex h-[42px] shrink-0 items-center gap-2 rounded-md border border-primary/70 bg-primary/15 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_16px_rgba(0,242,255,0.28)]">
            <ConnectionDot online decorative label="Prihlásení" />
            <span>Prihlásení</span>
            <span className="text-2xl font-bold leading-none tabular-nums text-green-400">{loading ? '—' : onlineCount}</span>
          </div>
          <div className="inline-flex h-[42px] shrink-0 items-center gap-2 rounded-md border border-primary/70 bg-primary/15 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_16px_rgba(0,242,255,0.28)]">
            <ConnectionDot online={false} decorative label="Odhlásení" />
            <span>Odhlásení</span>
            <span className="text-2xl font-bold leading-none tabular-nums text-red-400">{loading ? '—' : offlineCount}</span>
          </div>
        </div>
        <div className="relative w-56 shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Hľadať klienta..."
            className="h-[42px] w-full rounded-md border border-primary/70 bg-transparent py-2 pl-9 pr-4 text-base leading-6 text-foreground shadow-[0_0_16px_rgba(0,242,255,0.28)] placeholder:text-muted-foreground transition-shadow hover:border-primary hover:shadow-[0_0_16px_rgba(0,242,255,0.45)] focus:border-primary focus:outline-none focus:shadow-[0_0_16px_rgba(0,242,255,0.45)]"
          />
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className={sheetGrid}>
          <thead className="contents">
            <tr className="contents">
              <th className={`${nameCell} ${headChrome}`}>Meno</th>
              <th className={`${emailCell} ${headChrome}`}>E-mail</th>
              <th className={`${balanceCell} ${headChrome} justify-center text-center`}>Zostatok</th>
              <th className={`${visitsCell} ${headChrome}`}>Návštevy</th>
              <th className={`${activityCell} ${headChrome}`}>Posledná aktivita</th>
              <th className={`${creditCell} ${headChrome} justify-center px-2 py-2 text-center`}>Úprava kreditov</th>
            </tr>
          </thead>
          <tbody className="contents">
            {loading ? (
              <tr className="contents">
                <td colSpan={6} className="col-span-6 py-12 text-center text-muted-foreground">Načítavam klientov...</td>
              </tr>
            ) : visible.length === 0 ? (
              <tr className="contents">
                <td colSpan={6} className="col-span-6 py-12 text-center text-muted-foreground">Žiadni klienti</td>
              </tr>
            ) : visible.map((client) => {
              const busy = adjustingId === client.id;
              const active = selectedId === client.id;
              const label = clientRecordName(client);
              const rowBg = 'cursor-pointer border-b border-slate-800/60';
              const picked = active ? ' bg-[#0b2430] shadow-[inset_0_0_18px_rgba(0,242,255,0.16)]' : '';
              const actionButton = 'inline-flex h-full min-w-0 flex-1 items-center justify-center rounded-none border px-2 text-sm font-bold uppercase tracking-wide transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-60';
              return (
                <tr key={client.id} className="contents" onClick={() => setSelectedId(client.id)}>
                  <td className={`${nameCell} ${rowBg}${picked}`}>
                    <ConnectionDot
                      online={onlineIds.has(client.id)}
                      size="md"
                      label={onlineIds.has(client.id) ? 'Prihlásený' : 'Offline'}
                      className="mr-2"
                    />
                    <span className="text-base font-semibold leading-none text-cyan-400">{label || '—'}</span>
                  </td>
                  <td className={`${emailCell} ${rowBg}${picked}`}>
                    <span className="text-base font-medium leading-none text-white">{client.email || '—'}</span>
                  </td>
                  <td className={`${balanceCell} ${rowBg}${picked} justify-end text-right`}>
                    <span className="text-base font-bold leading-none tabular-nums text-primary">{money(client.balance)}</span>
                  </td>
                  <td className={`${visitsCell} ${rowBg}${picked}`}>
                    <span className="text-base font-bold leading-none tabular-nums text-white">{activity[client.id]?.visits ?? 0}</span>
                  </td>
                  <td className={`${activityCell} ${rowBg}${picked}`}>
                    <span className="text-sm font-medium leading-none text-white">{formatActivity(activity[client.id]?.lastVisit ?? null)}</span>
                  </td>
                  <td className={`${creditCell} ${rowBg} items-stretch self-stretch p-0`} onClick={(event) => event.stopPropagation()}>
                    <div className="grid h-full min-h-10 w-full grid-cols-2 items-stretch">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openCredit(client, 'add')}
                        className={`${actionButton} border-primary/80 bg-primary/10 text-primary shadow-[0_0_12px_rgba(0,242,255,0.28)] hover:border-primary hover:bg-primary/16 hover:shadow-[0_0_14px_rgba(0,242,255,0.4)]`}
                      >
                        Pripísať
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => openCredit(client, 'subtract')}
                        className={`${actionButton} border-red-400/70 bg-red-500/10 text-red-400 shadow-[0_0_12px_rgba(248,113,113,0.28)] hover:border-red-400 hover:bg-red-500/16 hover:shadow-[0_0_14px_rgba(248,113,113,0.4)]`}
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
