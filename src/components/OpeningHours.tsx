import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';
import {
  DAY_KEYS,
  defaultSchedule,
  fetchSystemSettings,
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

const MODES: { id: SystemStatusMode; label: string; active: string; idle: string }[] = [
  {
    id: 'auto',
    label: 'Auto (Schedule)',
    active: 'border-primary/70 bg-primary/20 text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)]',
    idle: 'border-primary/35 bg-transparent text-primary/80 hover:bg-primary/15',
  },
  {
    id: 'online',
    label: 'Force ONLINE',
    active: 'border-green-500/70 bg-green-500/20 text-green-400 shadow-[0_0_16px_rgba(34,197,94,0.4)]',
    idle: 'border-green-500/35 bg-transparent text-green-400/80 hover:bg-green-500/15',
  },
  {
    id: 'offline',
    label: 'Force OFFLINE',
    active: 'border-red-500/70 bg-red-500/20 text-red-400 shadow-[0_0_16px_rgba(239,68,68,0.4)]',
    idle: 'border-red-500/35 bg-transparent text-red-400/80 hover:bg-red-500/15',
  },
];

const HOURS = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, '0'));
const MINUTES = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, '0'));

const TimeField = ({
  value,
  disabled,
  label,
  onChange,
}: {
  value: string;
  disabled: boolean;
  label: string;
  onChange: (value: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [menu, setMenu] = useState({ top: 0, left: 0 });
  const rootRef = useRef<HTMLDivElement>(null);
  const hourRef = useRef<HTMLButtonElement>(null);
  const minuteRef = useRef<HTMLButtonElement>(null);
  const [rawHour = '08', rawMinute = '00'] = value.split(':');
  const hour = rawHour.padStart(2, '0');
  const minute = rawMinute.padStart(2, '0');

  useEffect(() => {
    if (!open) return;
    const center = (node: HTMLButtonElement | null) => {
      const column = node?.parentElement;
      if (!node || !column) return;
      column.scrollTop = node.offsetTop - column.clientHeight / 2 + node.clientHeight / 2;
    };
    center(hourRef.current);
    center(minuteRef.current);

    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      if ((target as HTMLElement).closest?.('[data-time-menu]')) return;
      setOpen(false);
    };
    const closeMenu = () => setOpen(false);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    const onScroll = (event: Event) => {
      const menuNode = document.querySelector('[data-time-menu]');
      if (menuNode && event.target instanceof Node && menuNode.contains(event.target)) return;
      closeMenu();
    };
    const onWheel = (event: WheelEvent) => {
      const menuNode = document.querySelector('[data-time-menu]');
      const column = event.target instanceof Element ? event.target.closest('[data-time-col]') : null;
      if (menuNode && column && menuNode.contains(column)) {
        const canScroll = column.scrollHeight > column.clientHeight + 1;
        const atTop = column.scrollTop <= 0 && event.deltaY < 0;
        const atBottom = column.scrollTop + column.clientHeight >= column.scrollHeight - 1 && event.deltaY > 0;
        if (canScroll && !atTop && !atBottom) return;
      }
      closeMenu();
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('wheel', onWheel, { capture: true, passive: true });
    window.addEventListener('resize', closeMenu);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('wheel', onWheel, { capture: true });
      window.removeEventListener('resize', closeMenu);
    };
  }, [open]);

  const toggle = () => {
    if (disabled) return;
    if (open) {
      setOpen(false);
      return;
    }
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect) return;
    const width = 220;
    const height = 248;
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow < height && rect.top > spaceBelow
      ? Math.max(8, rect.top - height - 4)
      : rect.bottom + 4;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8));
    setMenu({ top, left });
    setOpen(true);
  };

  const optionClass = (active: boolean) => `block w-full px-2 py-1 text-center text-sm font-bold tabular-nums transition-colors ${
    active
      ? 'bg-primary/25 text-primary shadow-[inset_0_0_12px_rgba(0,242,255,0.35)]'
      : 'text-foreground hover:bg-primary/15 hover:text-primary'
  }`;

  return (
    <div ref={rootRef} className="inline-block align-middle">
      <button
        type="button"
        disabled={disabled}
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={toggle}
        className="inline-flex h-10 w-[151.9px] items-center justify-center rounded-md border border-primary/45 bg-transparent px-3 text-lg font-bold tabular-nums text-primary disabled:opacity-40"
      >
        {hour}:{minute}
      </button>
      {open && createPortal(
        <div
          data-time-menu
          role="dialog"
          aria-label={label}
          style={{ top: menu.top, left: menu.left }}
          className="fixed z-[120] flex w-[220px] overflow-hidden rounded-md border border-primary/70 bg-[#050505] shadow-[0_0_18px_rgba(0,242,255,0.45)]"
        >
          <div className="flex min-w-0 flex-1 flex-col border-r border-primary/35">
            <p className="border-b border-primary/35 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-primary">Hodiny</p>
            <div data-time-col className="max-h-52 overflow-auto py-1">
              {HOURS.map((item) => (
                <button
                  key={item}
                  ref={item === hour ? hourRef : undefined}
                  type="button"
                  className={optionClass(item === hour)}
                  onClick={() => onChange(`${item}:${minute}`)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col">
            <p className="border-b border-primary/35 px-2 py-1.5 text-center text-[10px] font-bold uppercase tracking-wide text-primary">Minúty</p>
            <div data-time-col className="max-h-52 overflow-auto py-1">
              {MINUTES.map((item) => (
                <button
                  key={item}
                  ref={item === minute ? minuteRef : undefined}
                  type="button"
                  className={optionClass(item === minute)}
                  onClick={() => onChange(`${hour}:${item}`)}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
};

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

  const matchesPreset = (weekendOpen: boolean) => DAY_KEYS.every((key) => {
    const day = draft[key];
    const weekend = key === 'sat' || key === 'sun';
    return day.open === (weekend ? weekendOpen : true) && day.from === '08:00' && day.to === '20:00';
  });

  const presetClass = (active: boolean) => `h-[38px] shrink-0 rounded-full border px-4 text-sm font-medium transition-colors ${
    active
      ? 'border-primary/70 bg-primary/20 text-primary shadow-[0_0_16px_rgba(0,242,255,0.4)]'
      : 'border-primary/45 bg-[#070d16] text-primary/90 hover:border-primary hover:bg-primary/15 hover:text-primary hover:shadow-[0_0_16px_rgba(0,242,255,0.35)]'
  }`;

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

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-primary/20 bg-background/40 p-4 shadow-[0_0_30px_rgba(59,130,246,0.15)] backdrop-blur-xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="h-11">
            <h2 className="text-2xl font-bold uppercase leading-none tracking-[0.16em] text-primary">Režim prevádzky</h2>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2">
          {MODES.map((mode) => {
            const active = live.mode === mode.id;
            return (
              <button
                key={mode.id}
                type="button"
                disabled={modeBusy || loading}
                onClick={() => chooseMode(mode.id)}
                className={`h-[42px] shrink-0 rounded-lg border px-4 text-sm font-medium transition-colors disabled:opacity-60 ${active ? mode.active : mode.idle}`}
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
          <button type="button" aria-pressed={matchesPreset(false)} onClick={() => setDraft(weekday(true))} className={presetClass(matchesPreset(false))}>
            Po–Pi 08:00–20:00
          </button>
          <button type="button" aria-pressed={matchesPreset(true)} onClick={() => setDraft(defaultSchedule())} className={presetClass(matchesPreset(true))}>
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
                      <TimeField
                        value={day.from}
                        disabled={!day.open}
                        label={`${DAY_LABELS[key]} od`}
                        onChange={(from) => updateDay(key, { from })}
                      />
                    </td>
                    <td className={`${cell} text-center`}>
                      <TimeField
                        value={day.to}
                        disabled={!day.open}
                        label={`${DAY_LABELS[key]} do`}
                        onChange={(to) => updateDay(key, { to })}
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
