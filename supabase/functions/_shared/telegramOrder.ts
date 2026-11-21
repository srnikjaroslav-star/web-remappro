const CATALOG_URL = "https://huswisewblkfcozdgvrq.supabase.co";
const CATALOG_KEY = "sb_publishable_LM2MhZV7ROsdMSZQb9_wpA_9ZOXOIlZ";
const PACKED_ADDRESS = "rp1:";

const LEGACY_SERVICE_NAMES: Record<string, string> = {
  "diesel-stage1": "Diesel STAGE1",
  "petrol-stage1": "Petrol STAGE1",
  "tcu-gearbox": "TCU Gearbox",
  adblue: "ADBlue",
  dpf: "DPF",
  "opf-gpf": "OPF/GPF",
  egr: "EGR",
  "swirl-flaps": "SWIRL Flaps",
  lambda: "Lambda",
  immo: "Immo",
  "emission-ek-stk": "Emission (EK/STK)",
  vmax: "V-Max",
  "hot-start": "Hot Start",
  "cold-start": "Cold Start",
  "idle-speed-rpm": "Idle Speed RPM",
  "torque-limiter": "Torque (Errors) Limiter",
  dtc: "DTC",
  "start-stop": "Start Stop",
  burbles: "Burbles",
  "cylinder-shutdown": "Cylinder Shutdown",
  "oil-pressure": "Oil Pressure",
  "glow-plugs-time": "Glow Plugs Time",
  "eolys-off": "Eolys (OFF)",
};

const CURRENT_ORDER_COLUMNS = [
  "id",
  "user_id",
  "vehicle_brand",
  "vehicle_model",
  "vehicle_year",
  "engine",
  "ecu",
  "fuel",
  "services",
  "total_price",
  "status",
  "file_url",
  "note",
  "created_at",
];

const LEGACY_ORDER_COLUMNS = [
  "order_number",
  "customer_name",
  "customer_email",
  "customer_company",
  "customer_note",
  "car_brand",
  "car_model",
  "fuel_type",
  "year",
  "ecu_type",
  "service_type",
  "price",
  "amount",
];

const ORDER_COLUMNS = [
  CURRENT_ORDER_COLUMNS.join(", "),
  ...LEGACY_ORDER_COLUMNS,
];

type Row = Record<string, unknown>;

type AdminClient = {
  from: (table: string) => any;
  auth: {
    admin: {
      getUserById: (id: string) => Promise<{
        data: { user?: { email?: string | null; user_metadata?: Record<string, unknown> | null } | null } | null;
      }>;
    };
  };
};

const clean = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const redact = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error ?? "request failed");
  return message.replace(/bot[^/\s]+/gi, "bot***");
};

const missingColumn = (message: string) => /column|does not exist|schema cache/i.test(message);

export const dispatchTelegram = (work: Promise<void>): void => {
  const safe = work.catch((error) => {
    console.error("[telegram] notification failed", redact(error));
  });
  try {
    const waitUntil = (globalThis as {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }).EdgeRuntime?.waitUntil;
    if (waitUntil) {
      waitUntil(safe);
      return;
    }
  } catch (error) {
    console.error("[telegram] waitUntil unavailable", redact(error));
  }
  void safe;
};

const sendTelegram = async (text: string): Promise<void> => {
  const token = Deno.env.get("TELEGRAM_BOT_TOKEN")?.trim() ?? "";
  const chatId = Deno.env.get("TELEGRAM_CHAT_ID")?.trim() ?? "";
  if (!token || !chatId) {
    console.error("[telegram] TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is not set");
    return;
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        disable_web_page_preview: true,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (response.ok) return;
    const body = await response.text();
    let description = "";
    try {
      description = String((JSON.parse(body) as { description?: unknown }).description ?? "");
    } catch {
      description = "";
    }
    console.error("[telegram] sendMessage failed", response.status, description.slice(0, 200));
  } catch (error) {
    console.error("[telegram] sendMessage failed", redact(error));
  }
};

const loadOrder = async (admin: AdminClient, orderId: string): Promise<Row | null> => {
  const order: Row = {};
  let found = false;
  const pending = [...ORDER_COLUMNS];
  for (let index = 0; index < pending.length; index += 1) {
    const columns = pending[index];
    try {
      const { data, error } = await admin.from("orders").select(columns).eq("id", orderId).maybeSingle();
      if (error) {
        const parts = columns.split(",").map((column) => column.trim()).filter(Boolean);
        if (missingColumn(error.message ?? "") && parts.length > 1) {
          pending.splice(index + 1, 0, ...parts);
          continue;
        }
        if (!missingColumn(error.message ?? "")) console.error("[telegram] order load failed", error.message);
        continue;
      }
      if (!data) {
        if (!found) return null;
        continue;
      }
      found = true;
      Object.assign(order, data);
    } catch (error) {
      console.error("[telegram] order load failed", redact(error));
    }
  }
  return found ? order : null;
};

const readProfile = async (admin: AdminClient, userId: string): Promise<Row | null> => {
  const selects = ["first_name, last_name, company_name, address", "company_name, address"];
  for (const column of ["user_id", "id"]) {
    for (const fields of selects) {
      try {
        const { data, error } = await admin.from("client_profiles").select(fields).eq(column, userId).maybeSingle();
        if (!error && data) return data;
      } catch {
        continue;
      }
    }
  }
  return null;
};

const readInvoice = async (admin: AdminClient, orderId: string): Promise<Row | null> => {
  try {
    const { data, error } = await admin
      .from("invoices")
      .select("customer_first_name, customer_last_name, customer_company, customer_name")
      .eq("order_id", orderId)
      .limit(1);
    if (error || !data?.length) return null;
    return data[0];
  } catch {
    return null;
  }
};

const packedName = (address: unknown) => {
  const raw = String(address ?? "");
  if (!raw.startsWith(PACKED_ADDRESS)) return { person: "", company: "" };
  try {
    const parsed = JSON.parse(raw.slice(PACKED_ADDRESS.length)) as { firstName?: unknown; lastName?: unknown };
    return { person: clean([parsed.firstName, parsed.lastName].filter(Boolean).join(" ")), company: "" };
  } catch {
    return { person: "", company: "" };
  }
};

export const customerLine = (person: string, company: string, fallback: string) => {
  const name = person.trim();
  const firm = company.trim();
  const backup = fallback.trim();
  const resolvedName = name || (backup && backup !== firm ? backup : "");
  if (resolvedName && firm && resolvedName.localeCompare(firm, "sk", { sensitivity: "accent" }) !== 0) {
    return `${resolvedName} / ${firm}`;
  }
  return resolvedName || firm || backup || "—";
};

export const splitStoredNote = (order: Row) => {
  const primary = String(order.customer_note ?? "");
  const fallback = String(order.note ?? "");
  const source = primary.trim() ? primary : fallback;
  const lines = source.split("\n");
  let engine = "";
  let skippedMotor = false;
  const kept: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^RP-[A-Z0-9]+$/i.test(trimmed)) continue;
    if (!skippedMotor && /^Motor:\s*\S+/i.test(trimmed)) {
      engine = trimmed.replace(/^Motor:\s*/i, "").trim();
      skippedMotor = true;
      continue;
    }
    if (trimmed.startsWith("[[rp-")) continue;
    if (trimmed) kept.push(trimmed);
  }
  return { engine, note: kept.join("\n").trim().slice(0, 1500) };
};

export const orderCode = (order: Row) => {
  const number = clean(order.order_number);
  if (number) return number;
  const tagged = String(order.note ?? "").split("\n").map((line) => line.trim()).find((line) => /^RP-[A-Z0-9]+$/i.test(line));
  return tagged || clean(order.id) || "—";
};

export const vehicleLine = (order: Row, engineFromNote: string) => {
  const brand = clean(order.car_brand || order.vehicle_brand);
  const model = clean(order.car_model || order.vehicle_model);
  const year = clean(order.year || order.vehicle_year).replace(/^0$/, "");
  let engine = clean(order.engine) || engineFromNote;
  const fuel = clean(order.fuel_type || order.fuel);
  const ecu = clean(order.ecu_type || order.ecu);
  if (engine && model.toLowerCase().includes(engine.toLowerCase())) engine = "";
  const title = [brand, model].filter(Boolean).join(" ");
  return [title, year, engine, fuel, ecu].filter(Boolean).join(", ") || "—";
};

const parseServiceIds = (value: unknown): string[] => {
  if (Array.isArray(value)) return value.map((item) => clean(item)).filter(Boolean);
  const raw = String(value ?? "").trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((item) => clean(item)).filter(Boolean);
  } catch {
    // Plain text stored before the catalog used ids.
  }
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
};

const finiteAmount = (value: unknown) => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" && value.trim() === "") return null;
  const amount = typeof value === "number"
    ? value
    : Number(String(value).trim().replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(amount) ? amount : null;
};

type CatalogService = { name: string; price: number | null };

const selectedServiceIds = (order: Row) => {
  const fromServiceType = parseServiceIds(order.service_type);
  return fromServiceType.length > 0 ? fromServiceType : parseServiceIds(order.services);
};

const rememberCatalogRow = (catalog: Map<string, CatalogService>, row: unknown, overwrite: boolean) => {
  if (!row || typeof row !== "object") return;
  const record = row as Row;
  const id = clean(record.id);
  if (!id) return;
  const name = clean(record.name);
  const price = finiteAmount(record.price);
  const current = catalog.get(id);
  if (!current) {
    catalog.set(id, { name, price });
    return;
  }
  if (name && (overwrite || !current.name)) current.name = name;
  if (price !== null && (overwrite || current.price === null)) current.price = price;
};

const loadServiceCatalog = async (admin: AdminClient) => {
  const catalog = new Map<string, CatalogService>();
  try {
    const local = await admin.from("services").select("id,name,price");
    if (!local.error && Array.isArray(local.data)) {
      for (const row of local.data) rememberCatalogRow(catalog, row, true);
    }
  } catch {
    // The public catalog below still resolves the names and prices shown at checkout.
  }
  for (const [id, name] of Object.entries(LEGACY_SERVICE_NAMES)) {
    if (!catalog.has(id)) catalog.set(id, { name, price: null });
  }
  try {
    const response = await fetch(`${CATALOG_URL}/rest/v1/services?select=id,name,price`, {
      headers: { apikey: CATALOG_KEY, Authorization: `Bearer ${CATALOG_KEY}` },
      signal: AbortSignal.timeout(5000),
    });
    if (response.ok) {
      const rows = await response.json();
      if (Array.isArray(rows)) {
        for (const row of rows) rememberCatalogRow(catalog, row, false);
      }
    }
  } catch (error) {
    console.error("[telegram] service catalog unavailable", redact(error));
  }
  return catalog;
};

const serviceNames = (order: Row, catalog: Map<string, CatalogService>) => {
  const ids = selectedServiceIds(order);
  if (ids.length === 0) return "—";
  return ids.map((id) => catalog.get(id)?.name || id).join(", ");
};

const servicePriceTotal = (order: Row, catalog: Map<string, CatalogService>) => {
  const ids = selectedServiceIds(order);
  if (ids.length === 0) return null;
  let sum = 0;
  for (const id of ids) {
    const price = catalog.get(id)?.price;
    if (price === null || price === undefined) return null;
    sum += price;
  }
  return Math.round(sum * 100) / 100;
};

const resolveCustomer = async (admin: AdminClient, order: Row) => {
  let person = "";
  let company = "";
  let authEmail = "";
  const remember = (nextPerson: string, nextCompany: string) => {
    if (!person && nextPerson) person = nextPerson;
    if (!company && nextCompany) company = nextCompany;
  };

  const userId = clean(order.user_id);
  if (userId) {
    const profile = await readProfile(admin, userId);
    if (profile) {
      const packed = packedName(profile.address);
      remember(clean([profile.first_name, profile.last_name].filter(Boolean).join(" ")) || packed.person, clean(profile.company_name));
    }
    try {
      const user = await admin.auth.admin.getUserById(userId);
      authEmail = clean(user.data?.user?.email);
      const meta = user.data?.user?.user_metadata ?? {};
      remember(
        clean([meta.first_name, meta.last_name].filter(Boolean).join(" ")) || clean(meta.full_name),
        clean(meta.company || meta.company_name),
      );
    } catch {
      // Profile and the order name still identify the client.
    }
  }

  const invoice = await readInvoice(admin, clean(order.id));
  if (invoice) {
    remember(
      clean([invoice.customer_first_name, invoice.customer_last_name].filter(Boolean).join(" ")),
      clean(invoice.customer_company),
    );
  }

  const named = customerLine(
    person,
    company,
    clean(order.customer_name) || clean(order.customer_company) || clean(invoice?.customer_name) || clean(invoice?.customer_company),
  );
  if (named !== "—") return named;
  return clean(order.customer_email) || authEmail || "—";
};

export const priceLine = (value: unknown) => {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  const formatted = new Intl.NumberFormat("sk-SK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `${formatted} €`;
};

export const buildOrderMessage = (fields: {
  orderId: string;
  customer: string;
  vehicle: string;
  service: string;
  note: string;
  price: string;
}) => {
  const lines = [
    "🔔 Nová objednávka REMAPPRO",
    "",
    `ID objednávky: ${fields.orderId}`,
    `Zákazník: ${fields.customer}`,
    `Vozidlo: ${fields.vehicle}`,
    `Požadovaná služba: ${fields.service}`,
  ];
  if (fields.note) lines.push(`Poznámka zákazníka: ${fields.note}`);
  lines.push(`Cena: ${fields.price}`);
  return lines.join("\n").slice(0, 4000);
};

export const notifyCreatedOrder = async (
  admin: AdminClient,
  ids: { orderId?: unknown; orderNumber?: unknown },
): Promise<void> => {
  const orderId = clean(ids.orderId);
  if (orderId) {
    await notifyOrderById(admin, orderId);
    return;
  }
  const orderNumber = clean(ids.orderNumber);
  if (!orderNumber) return;
  try {
    const found = await admin.from("orders").select("id").eq("order_number", orderNumber).maybeSingle();
    const id = clean(found.data?.id);
    if (id) await notifyOrderById(admin, id);
  } catch (error) {
    console.error("[telegram] order lookup failed", redact(error));
  }
};

export const notifyOrderById = async (admin: AdminClient, orderId: string): Promise<void> => {
  try {
    const id = orderId.trim();
    if (!id) return;
    const order = await loadOrder(admin, id);
    if (!order) {
      console.error("[telegram] order not found");
      return;
    }
    const stored = splitStoredNote(order);
    const catalog = await loadServiceCatalog(admin);
    const amount = finiteAmount(order.total_price)
      ?? finiteAmount(order.price)
      ?? finiteAmount(order.amount)
      ?? servicePriceTotal(order, catalog);
    const text = buildOrderMessage({
      orderId: orderCode(order),
      customer: await resolveCustomer(admin, order),
      vehicle: vehicleLine(order, stored.engine),
      service: serviceNames(order, catalog),
      note: stored.note,
      price: amount === null ? "—" : priceLine(amount),
    });
    await sendTelegram(text);
  } catch (error) {
    console.error("[telegram] notification failed", redact(error));
  }
};
