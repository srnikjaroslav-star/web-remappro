import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

type DocumentKind = "invoice" | "credit";

const limit = 9999;

const calendarYear = (issued = new Date()) => {
  const year = Number(new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Bratislava",
    year: "numeric",
  }).format(issued));
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw new Error("Číslo dokladu sa nepodarilo priradiť.");
  }
  return year;
};

const prefixFor = (kind: DocumentKind, year: number) => (
  kind === "invoice" ? String(year) : `9${String(year).slice(1)}`
);

const formatNumber = (kind: DocumentKind, year: number, serial: number) => {
  if (!Number.isInteger(serial) || serial < 1 || serial > limit) {
    throw new Error("Číselný rad dokladov pre tento rok je vyčerpaný.");
  }
  return `${prefixFor(kind, year)}${String(serial).padStart(4, "0")}`;
};

const serialOf = (kind: DocumentKind, year: number, value: string) => {
  const prefix = prefixFor(kind, year);
  const number = value.trim();
  if (number.length !== prefix.length + 4 || !number.startsWith(prefix)) return 0;
  const tail = number.slice(prefix.length);
  return /^\d{4}$/.test(tail) ? Number(tail) : 0;
};

const adminClient = () => {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return createClient(url, key);
};

const markedNumber = (note: string, kind: DocumentKind) => {
  const tag = kind === "invoice" ? "[[rp-invoice]]" : "[[rp-credit]]";
  const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return note.match(new RegExp(`${escaped}([^\\n|]*)`))?.[1]?.trim() || "";
};

const reserve = async (admin: SupabaseClient, kind: DocumentKind, year: number) => {
  const { data, error } = await admin.rpc("next_accounting_number", { p_kind: kind, p_year: year });
  if (error) {
    if (/NUMBER_EXHAUSTED/i.test(error.message || "")) {
      throw new Error("Číselný rad dokladov pre tento rok je vyčerpaný.");
    }
    console.error("[accounting-number] sequence rpc failed", error.message);
    return "";
  }
  return typeof data === "string" && serialOf(kind, year, data) > 0 ? data : "";
};

const nextFromNotes = async (admin: SupabaseClient, kind: DocumentKind, year: number) => {
  const taken = new Set<number>();
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const rows = await admin.from("orders").select("note").range(from, from + pageSize - 1);
    if (rows.error) throw new Error(rows.error.message || "Číslo dokladu sa nepodarilo priradiť.");
    const batch = rows.data || [];
    for (const row of batch) {
      const serial = serialOf(kind, year, markedNumber(String(row.note || ""), kind));
      if (serial > 0) taken.add(serial);
    }
    if (batch.length < pageSize) break;
  }
  if (kind === "invoice") {
    const topups = await admin.from("credit_topups").select("invoice_number");
    if (!topups.error) {
      for (const row of topups.data || []) {
        const serial = serialOf(kind, year, String((row as { invoice_number?: string | null }).invoice_number || ""));
        if (serial > 0) taken.add(serial);
      }
    }
  }
  for (let serial = 1; serial <= limit; serial += 1) {
    if (!taken.has(serial)) return formatNumber(kind, year, serial);
  }
  throw new Error("Číselný rad dokladov pre tento rok je vyčerpaný.");
};

export const keepOrAssignDocumentNumber = async (orderId: string, kind: DocumentKind, issued = new Date()) => {
  const year = calendarYear(issued);
  const admin = adminClient();
  if (admin && orderId) {
    const current = await admin.from("orders").select("note").eq("id", orderId).maybeSingle();
    if (!current.error) {
      const existing = markedNumber(String(current.data?.note || ""), kind);
      if (existing) return existing;
    }
    const column = kind === "invoice" ? "invoice_number" : "credit_note_number";
    const stored = await admin.from("orders").select(column).eq("id", orderId).maybeSingle();
    const storedRow = stored.data as Record<string, string | null> | null;
    const storedNumber = String(storedRow?.[column] || "").trim();
    if (!stored.error && storedNumber) return storedNumber;
    const reserved = await reserve(admin, kind, year);
    if (reserved) return reserved;
    return nextFromNotes(admin, kind, year);
  }
  return formatNumber(kind, year, 1);
};

export const documentIssueAllowed = async (
  orderId: string,
  kind: DocumentKind,
): Promise<"ok" | "missing" | "too_early" | "exists"> => {
  const admin = adminClient();
  if (!admin || !orderId) return "missing";
  const full = await admin
    .from("orders")
    .select("status, note, invoice_number, credit_note_number")
    .eq("id", orderId)
    .maybeSingle();
  const row = full.error
    ? await admin.from("orders").select("status, note").eq("id", orderId).maybeSingle()
    : full;
  if (row.error || !row.data) return "missing";
  const data = row.data as {
    status?: string | null;
    note?: string | null;
    invoice_number?: string | null;
    credit_note_number?: string | null;
  };
  const note = String(data.note || "");
  const invoice = String(data.invoice_number || "").trim() || markedNumber(note, "invoice");
  const credit = String(data.credit_note_number || "").trim() || markedNumber(note, "credit");
  if (kind === "invoice") {
    if (invoice) return "exists";
    if (String(data.status || "") !== "completed") return "too_early";
    return "ok";
  }
  if (credit) return "exists";
  if (!invoice) return "too_early";
  return "ok";
};
