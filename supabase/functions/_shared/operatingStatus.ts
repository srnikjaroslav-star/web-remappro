const ADMIN_EMAILS = ["srnik.jaroslav@gmail.com", "info@remappro.eu"];
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const WEEKDAYS: Record<string, (typeof DAY_KEYS)[number]> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

type DayHours = { open: boolean; from: string; to: string };

const dayHours = (): DayHours => ({ open: true, from: "08:00", to: "20:00" });

const defaultSchedule = () => Object.fromEntries(DAY_KEYS.map((key) => [key, dayHours()])) as Record<(typeof DAY_KEYS)[number], DayHours>;

const minutes = (value: string) => {
  const [hour, minute] = value.split(":").map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  return hour * 60 + minute;
};

export const isOperatingOpen = (value: unknown): boolean => {
  const record = value && typeof value === "object" ? value as { mode?: unknown; schedule?: unknown } : {};
  const mode = record.mode === "online" || record.mode === "offline" ? record.mode : "auto";
  if (mode === "online") return true;
  if (mode === "offline") return false;
  const schedule = defaultSchedule();
  const source = record.schedule && typeof record.schedule === "object" ? record.schedule as Record<string, unknown> : {};
  for (const key of DAY_KEYS) {
    const row = source[key];
    if (!row || typeof row !== "object") continue;
    const item = row as { open?: unknown; from?: unknown; to?: unknown };
    schedule[key] = {
      open: item.open === true,
      from: typeof item.from === "string" && TIME_PATTERN.test(item.from) ? item.from : schedule[key].from,
      to: typeof item.to === "string" && TIME_PATTERN.test(item.to) ? item.to : schedule[key].to,
    };
  }
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Bratislava",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "Mon";
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const day = schedule[WEEKDAYS[weekday] ?? "mon"];
  if (!day?.open) return false;
  const from = minutes(day.from);
  const to = minutes(day.to);
  if (from === null || to === null || from === to) return false;
  const now = hour * 60 + minute;
  if (from < to) return now >= from && now < to;
  return now >= from || now < to;
};

export const isFunctionAdmin = (user: { email?: string | null; app_metadata?: Record<string, unknown> | null; user_metadata?: Record<string, unknown> | null }) => {
  const email = String(user.email ?? "").trim().toLowerCase();
  if (ADMIN_EMAILS.includes(email)) return true;
  const role = String(user.app_metadata?.role ?? user.user_metadata?.role ?? "").trim().toLowerCase();
  return role === "admin";
};

export const isDatabaseAdmin = (user: { email?: string | null; app_metadata?: Record<string, unknown> | null }) => {
  const email = String(user.email ?? "").trim().toLowerCase();
  if (ADMIN_EMAILS.includes(email)) return true;
  const configured = String(Deno.env.get("ADMIN_EMAIL") ?? "").trim().toLowerCase();
  if (configured && email === configured) return true;
  return String(user.app_metadata?.role ?? "").trim().toLowerCase() === "admin";
};

export const operatingOpen = async (): Promise<boolean> => {
  const url = String(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/$/, "");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!url || !key) return isOperatingOpen(null);
  try {
    const response = await fetch(`${url}/rest/v1/system_settings?select=value&key=eq.system_status`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return isOperatingOpen(null);
    const rows = await response.json();
    const value = Array.isArray(rows) ? rows[0]?.value : null;
    return isOperatingOpen(value);
  } catch {
    return isOperatingOpen(null);
  }
};
