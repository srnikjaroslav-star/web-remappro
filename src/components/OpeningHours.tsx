import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  DAY_KEYS,
  defaultSchedule,
  fetchSystemSettings,
  isSystemOnline,
  normalizeSchedule,
  saveSystemSettings,
  setSystemStatusInDB,
  type DayKey,
  type OpeningSchedule,
  type SystemSettings,
  type SystemStatusMode,
} from '@/components/SystemStatus';

const DAY_LABELS: Record<DayKey, string> = {
  mon: 'Pondelok',
  tue: 'Utorok',
  wed: 'Streda',
  thu: 'Štvrtok',
  fri: 'Piatok',
  sat: 'Sobota',
  sun: 'Nedeľa',
};

const MODES: { id: SystemStatusMode; label: string }[] = [
  { id: 'auto', label: 'Automaticky' },
  { id: 'online', label: 'Vynútiť Online' },
  { id: 'offline', label: 'Vynútiť Offline' },
];

const weekday = (open: boolean, from = '08:00', to = '20:00'): OpeningSchedule => {
  const schedule = defaultSchedule();
  for (const key of DAY_KEYS) {
    const weekend = key === 'sat' || key === 'sun';
    schedule[key] = { open: open && !weekend, from, to };
  }
  return schedule;
};

const OpeningHours = () => {
  const [live, setLive] = useState<SystemSettings>({ mode: 'auto', schedule: defaultSchedule() });
  const [draft, setDraft] = useState<OpeningSchedule>(defaultSchedule());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modeBusy, setModeBusy] = useState(false);

  useEffect(() => {
    let active = true;
    fetchSystemSettings().then((settings) => {
      if (!active) return;
      if (settings) {
        setLive(settings);
        setDraft(settings.schedule);
      }
      setLoading(false);
    });
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<SystemSettings>).detail;
      if (!detail?.mode || !detail.schedule) return;
      setLive({ mode: detail.mode, schedule: normalizeSchedule(detail.schedule) });
    };
    window.addEventListener('systemStatusChange', handleChange);
    return () => {
      active = false;
      window.removeEventListener('systemStatusChange', handleChange);
    };
  }, []);

  const chooseMode = async (mode: SystemStatusMode) => {
    setModeBusy(true);
    const ok = await setSystemStatusInDB(mode);
    setModeBusy(false);
    if (!ok) {
      toast.error('Stav prevádzky sa nepodarilo zmeniť.');
      return;
    }
    toast.success(mode === 'auto'
      ? 'Prevádzka sa riadi otváracími hodinami.'
      : mode === 'online'
        ? 'Portál je vynútene Online.'
        : 'Portál je vynútene Offline.');
  };

  const updateDay = (key: DayKey, patch: Partial<OpeningSchedule[DayKey]>) => {
    setDraft((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  };

  const saveHours = async () => {
    const invalid = DAY_KEYS.find((key) => draft[key].open && draft[key].from === draft[key].to);
    if (invalid) {
      toast.error(`Pri dni ${DAY_LABELS[invalid]} nemôže byť čas otvorenia a zatvorenia rovnaký.`);
      return;
    }
    const current = await fetchSystemSettings();
    if (!current) {
      toast.error('Aktuálny stav sa nepodarilo načítať.');
      return;
    }
    setSaving(true);
    const ok = await saveSystemSettings({ mode: current.mode, schedule: draft });
    setSaving(false);
    if (!ok) {
      toast.error('Otváracie hodiny sa nepodarilo uložiť.');
      return;
    }
    toast.success('Otváracie hodiny sú uložené.');
  };

  const online = isSystemOnline(live.mode, live.schedule);

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/20 bg-background/40 p-4 shadow-[0_0_30px_rgba(59,130,246,0.15)] backdrop-blur-xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-[0.16em] text-primary">Režim prevádzky</h2>
            <p className="mt-1 text-sm text-muted-foreground">Automatický režim používa hodiny nižšie v časovom pásme Europe/Bratislava. Manuálny režim má prednosť a rovnaký stav sa zobrazí v hlavičke.</p>
          </div>
          <div className="inline-flex items-center gap-3 rounded-md border border-primary/35 bg-black/40 px-3 py-2">
            <span className={`h-2.5 w-2.5 rounded-full ${online ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]' : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'}`} />
            <span className={`text-sm font-bold ${online ? 'text-green-500' : 'text-red-500'}`}>{online ? 'ONLINE' : 'OFFLINE'}</span>
            <span className={`text-xs font-bold uppercase ${online ? 'text-green-400' : 'text-red-400'}`}>
              {live.mode === 'auto' ? 'Podľa hodín' : 'Manuálne'}
            </span>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          {MODES.map((mode) => {
            const active = live.mode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                disabled={modeBusy || loading}
                onClick={() => chooseMode(mode.id)}
                className={`h-11 rounded-md border px-4 text-sm font-bold uppercase tracking-wide transition-colors disabled:opacity-60 ${
                  active
                    ? 'border-primary bg-primary/20 text-primary shadow-[0_0_16px_rgba(0,242,255,0.35)]'
                    : 'border-primary/30 text-muted-foreground hover:text-foreground'
                }`}
              >
                {mode.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="h-fit w-full shrink-0 rounded-xl border border-primary/20 bg-background/40 shadow-[0_0_30px_rgba(59,130,246,0.15)] backdrop-blur-xl">
        <div className="flex flex-wrap items-center justify-end gap-2 border-b border-primary/30 bg-[#0a192f] px-4 py-2.5">
          <p className="mr-auto text-sm font-bold uppercase tracking-wide text-white">Otváracie hodiny</p>
          <button type="button" onClick={() => setDraft(weekday(true))} className="btn-secondary rounded-none px-4 py-2 text-sm">
            Po–Pi 08:00–20:00
          </button>
          <button type="button" onClick={() => setDraft(defaultSchedule())} className="btn-secondary rounded-none px-4 py-2 text-sm">
            Každý deň 08:00–20:00
          </button>
          <button type="button" onClick={saveHours} disabled={saving || loading} className="inline-flex h-11 items-center rounded-md border border-primary/70 bg-primary/15 px-4 text-sm font-bold uppercase tracking-wide text-primary shadow-[0_0_16px_rgba(0,242,255,0.28)] transition-colors hover:bg-primary/25 disabled:opacity-60">
            {saving ? 'Ukladám...' : 'Uložiť hodiny'}
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-base">
            <thead>
              <tr className="border-b border-primary/30 bg-[#0a192f]">
                <th className="w-full whitespace-nowrap border-r border-slate-500 p-2.5 text-left text-sm font-bold uppercase tracking-wide text-white">Deň</th>
                <th className="whitespace-nowrap border-r border-slate-500 p-2.5 text-center text-sm font-bold uppercase tracking-wide text-white">Prevádzka</th>
                <th className="whitespace-nowrap border-r border-slate-500 p-2.5 text-center text-sm font-bold uppercase tracking-wide text-white">Od</th>
                <th className="whitespace-nowrap border-r border-slate-500 p-2.5 text-center text-sm font-bold uppercase tracking-wide text-white">Do</th>
              </tr>
            </thead>
            <tbody>
              {DAY_KEYS.map((key) => {
                const day = draft[key];
                const cell = 'border-r border-slate-800/60 px-4 py-2 align-middle';
                return (
                  <tr key={key} className="border-b border-slate-800/60">
                    <td className={cell}>
                      <p className="text-lg font-bold leading-none text-cyan-400">{DAY_LABELS[key]}</p>
                    </td>
                    <td className={`${cell} text-center`}>
                      <button
                        type="button"
                        onClick={() => updateDay(key, { open: !day.open })}
                        className={`inline-flex h-10 min-w-[8.5rem] items-center justify-center rounded-md border px-3 text-sm font-bold uppercase ${
                          day.open
                            ? 'border-primary/70 bg-primary/15 text-primary'
                            : 'border-slate-600 bg-transparent text-muted-foreground'
                        }`}
                      >
                        {day.open ? 'Otvorené' : 'Zatvorené'}
                      </button>
                    </td>
                    <td className={`${cell} text-center`}>
                      <input
                        type="time"
                        value={day.from}
                        disabled={!day.open}
                        onChange={(event) => updateDay(key, { from: event.target.value })}
                        className="h-10 rounded-md border border-primary/45 bg-transparent px-3 text-center text-lg font-bold tabular-nums text-primary [color-scheme:dark] disabled:opacity-40"
                      />
                    </td>
                    <td className={`${cell} text-center`}>
                      <input
                        type="time"
                        value={day.to}
                        disabled={!day.open}
                        onChange={(event) => updateDay(key, { to: event.target.value })}
                        className="h-10 rounded-md border border-primary/45 bg-transparent px-3 text-center text-lg font-bold tabular-nums text-primary [color-scheme:dark] disabled:opacity-40"
                      />
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

export default OpeningHours;
