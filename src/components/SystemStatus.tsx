import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useLanguage } from '@/i18n/LanguageContext';

export type SystemStatusMode = 'auto' | 'online' | 'offline';
export type DayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type DayHours = {
  open: boolean;
  from: string;
  to: string;
};

export type OpeningSchedule = Record<DayKey, DayHours>;

export type SystemSettings = {
  mode: SystemStatusMode;
  schedule: OpeningSchedule;
};

export const DAY_KEYS: DayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS: Record<string, DayKey> = {
  Mon: 'mon',
  Tue: 'tue',
  Wed: 'wed',
  Thu: 'thu',
  Fri: 'fri',
  Sat: 'sat',
  Sun: 'sun',
};

const dayHours = (): DayHours => ({ open: true, from: '08:00', to: '20:00' });

export const defaultSchedule = (): OpeningSchedule => ({
  mon: dayHours(),
  tue: dayHours(),
  wed: dayHours(),
  thu: dayHours(),
  fri: dayHours(),
  sat: dayHours(),
  sun: dayHours(),
});

export const normalizeSchedule = (value: unknown): OpeningSchedule => {
  const schedule = defaultSchedule();
  if (!value || typeof value !== 'object') return schedule;
  const source = value as Record<string, unknown>;
  for (const key of DAY_KEYS) {
    const row = source[key];
    if (!row || typeof row !== 'object') continue;
    const record = row as { open?: unknown; from?: unknown; to?: unknown };
    schedule[key] = {
      open: record.open === true,
      from: typeof record.from === 'string' && TIME_PATTERN.test(record.from) ? record.from : schedule[key].from,
      to: typeof record.to === 'string' && TIME_PATTERN.test(record.to) ? record.to : schedule[key].to,
    };
  }
  return schedule;
};

const parseSettings = (value: unknown): SystemSettings => {
  const record = value && typeof value === 'object' ? value as { mode?: unknown; schedule?: unknown } : {};
  const mode = record.mode === 'online' || record.mode === 'offline' ? record.mode : 'auto';
  return { mode, schedule: normalizeSchedule(record.schedule) };
};

const fallbackSettings = (): SystemSettings => ({ mode: 'auto', schedule: defaultSchedule() });

export const fetchSystemSettings = async (): Promise<SystemSettings | null> => {
  try {
    const { data, error } = await supabase
      .from('system_settings')
      .select('value')
      .eq('key', 'system_status')
      .single();
    if (error) return null;
    return parseSettings(data?.value);
  } catch {
    return null;
  }
};

export const fetchSystemStatusFromDB = async (): Promise<SystemStatusMode> => {
  const settings = await fetchSystemSettings();
  return settings?.mode ?? 'auto';
};

export const saveSystemSettings = async (settings: SystemSettings): Promise<boolean> => {
  const next = {
    mode: settings.mode === 'online' || settings.mode === 'offline' ? settings.mode : 'auto' as const,
    schedule: normalizeSchedule(settings.schedule),
  };
  try {
    const { error } = await supabase
      .from('system_settings')
      .upsert({
        key: 'system_status',
        value: next,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'key' });
    if (error) return false;
    window.dispatchEvent(new CustomEvent('systemStatusChange', { detail: next }));
    return true;
  } catch {
    return false;
  }
};

export const setSystemStatusInDB = async (mode: SystemStatusMode): Promise<boolean> => {
  const current = await fetchSystemSettings();
  if (!current) return false;
  return saveSystemSettings({ mode, schedule: current.schedule });
};

const minutes = (value: string) => {
  const [hour, minute] = value.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return hour * 60 + minute;
};

export const isSystemOnline = (
  mode: SystemStatusMode,
  schedule: OpeningSchedule = defaultSchedule(),
): boolean => {
  if (mode === 'online') return true;
  if (mode === 'offline') return false;
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Bratislava',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  const day = schedule[WEEKDAYS[weekday] ?? 'mon'];
  if (!day?.open) return false;
  const from = minutes(day.from);
  const to = minutes(day.to);
  if (from === null || to === null || from === to) return false;
  const now = hour * 60 + minute;
  if (from < to) return now >= from && now < to;
  return now >= from || now < to;
};

export const settingsMatch = (left: SystemSettings, right: SystemSettings) => {
  if (left.mode !== right.mode) return false;
  return DAY_KEYS.every((key) => {
    const a = left.schedule[key];
    const b = right.schedule[key];
    return a.open === b.open && a.from === b.from && a.to === b.to;
  });
};

const applyDetail = (current: SystemSettings, detail: unknown): SystemSettings => {
  if (detail === 'online' || detail === 'offline' || detail === 'auto') {
    return { ...current, mode: detail };
  }
  if (detail && typeof detail === 'object' && 'mode' in detail) {
    return parseSettings(detail);
  }
  return current;
};

const SystemStatus = ({ showModeLabel = false }: { showModeLabel?: boolean }) => {
  const { t } = useLanguage();
  const [settings, setSettings] = useState<SystemSettings>(fallbackSettings);
  const [loading, setLoading] = useState(true);
  const [clock, setClock] = useState(0);

  useEffect(() => {
    let active = true;
    fetchSystemSettings().then((next) => {
      if (!active) return;
      if (next) setSettings((current) => (settingsMatch(current, next) ? current : next));
      setLoading(false);
    });

    const handleChange = (event: Event) => {
      if (!active) return;
      const detail = (event as CustomEvent<unknown>).detail;
      setSettings((current) => {
        const next = applyDetail(current, detail);
        return settingsMatch(current, next) ? current : next;
      });
    };
    window.addEventListener('systemStatusChange', handleChange);

    const channel = supabase
      .channel('system_settings_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'system_settings',
          filter: 'key=eq.system_status',
        },
        (payload) => {
          if (!active) return;
          const next = (payload.new as { value?: unknown } | undefined)?.value;
          if (!next) return;
          setSettings((current) => {
            const parsed = parseSettings(next);
            return settingsMatch(current, parsed) ? current : parsed;
          });
        },
      )
      .subscribe();

    return () => {
      active = false;
      window.removeEventListener('systemStatusChange', handleChange);
      supabase.removeChannel(channel);
    };
  }, []);

  useEffect(() => {
    if (settings.mode !== 'auto') return;
    const interval = window.setInterval(() => setClock((value) => value + 1), 60000);
    return () => window.clearInterval(interval);
  }, [settings.mode]);

  const online = isSystemOnline(settings.mode, settings.schedule);
  void clock;

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm">
        <span className="w-2.5 h-2.5 rounded-full bg-gray-500 animate-pulse" />
        <span className="text-muted-foreground">{t('statusLoading')}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={`w-2.5 h-2.5 rounded-full ${
          online
            ? 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.6)]'
            : 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]'
        }`}
      />
      <span className={online ? 'text-green-500' : 'text-red-500 font-bold'}>
        {online ? t('statusOnline') : t('statusOffline')}
      </span>
      {showModeLabel && settings.mode !== 'auto' && (
        <span className={`text-xs ${online ? 'text-muted-foreground/60' : 'text-red-400/60'}`}>{t('statusManual')}</span>
      )}
    </div>
  );
};

export default SystemStatus;
