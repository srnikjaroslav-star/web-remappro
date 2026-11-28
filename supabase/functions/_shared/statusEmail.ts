import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export type MailLanguage = "SK" | "EN";

const SITE_URL = (Deno.env.get("SITE_URL") || "https://remappro.eu").replace(/\/$/, "");

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const normalizeMailLanguage = (value: unknown): MailLanguage | null => {
  const raw = String(value ?? "").trim().toUpperCase();
  if (!raw) return null;
  if (raw === "EN" || raw.startsWith("EN")) return "EN";
  if (raw === "SK" || raw.startsWith("SK")) return "SK";
  return null;
};

export const portalOrderUrl = (orderNumber: string) =>
  `${SITE_URL}/#/objednavky?order=${encodeURIComponent(orderNumber)}`;

const readLanguage = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
): Promise<MailLanguage | null> => {
  for (const column of ["user_id", "id"] as const) {
    const { data, error } = await supabase
      .from("client_profiles")
      .select("language")
      .eq(column, userId)
      .maybeSingle();
    if (error || !data) continue;
    const fromProfile = normalizeMailLanguage((data as { language?: unknown }).language);
    if (fromProfile) return fromProfile;
  }

  try {
    const { data: userData } = await supabase.auth.admin.getUserById(userId);
    const metadata = userData?.user?.user_metadata ?? {};
    const fromMetadata = normalizeMailLanguage(metadata.language ?? metadata.lang ?? metadata.locale);
    if (fromMetadata) return fromMetadata;
  } catch (error) {
    console.warn("[status-email] Auth metadata lookup failed:", error);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return null;
  try {
    const response = await fetch(`${supabaseUrl}/auth/v1/admin/users/${userId}`, {
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    });
    if (!response.ok) return null;
    const user = await response.json();
    const metadata = user?.user_metadata ?? {};
    return normalizeMailLanguage(metadata.language ?? metadata.lang ?? metadata.locale);
  } catch (error) {
    console.warn("[status-email] Auth admin lookup failed:", error);
    return null;
  }
};

const missingColumn = (error: { code?: string; message?: string } | null) =>
  error?.code === "42703"
  || error?.code === "PGRST204"
  || /column .* does not exist|schema cache/i.test(error?.message ?? "");

const firstUserId = (rows: { user_id?: string | null }[] | null | undefined) =>
  String(rows?.find((row) => String(row.user_id || "").trim())?.user_id || "").trim();

const collectUserIds = async (
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  customerEmail: string,
  knownUserIds: string[] = [],
) => {
  const ids: string[] = [];
  const add = (userId: string) => {
    const value = userId.trim();
    if (value && !ids.includes(value)) ids.push(value);
  };
  knownUserIds.forEach(add);

  if (orderId) {
    const ledger = await supabase
      .from("credit_transactions")
      .select("user_id")
      .eq("order_id", orderId)
      .limit(1);
    if (!ledger.error) add(firstUserId(ledger.data as { user_id?: string | null }[] | null));

    const invoice = await supabase
      .from("invoices")
      .select("user_id")
      .eq("order_id", orderId)
      .limit(1);
    if (!invoice.error) add(firstUserId(invoice.data as { user_id?: string | null }[] | null));
  }

  const email = customerEmail.trim().toLowerCase();
  if (email) {
    const profile = await supabase
      .from("client_profiles")
      .select("user_id")
      .ilike("email", email)
      .limit(1);
    if (!profile.error) add(firstUserId(profile.data as { user_id?: string | null }[] | null));
  }

  return ids;
};

const readLanguageByEmail = async (
  supabase: ReturnType<typeof createClient>,
  customerEmail: string,
) => {
  const email = customerEmail.trim().toLowerCase();
  if (!email) return null;
  const profile = await supabase
    .from("client_profiles")
    .select("language")
    .ilike("email", email)
    .limit(1);
  if (profile.error) return null;
  return normalizeMailLanguage((profile.data?.[0] as { language?: unknown } | undefined)?.language);
};

const readOrderCustomer = async (
  supabase: ReturnType<typeof createClient>,
  orderId: string,
) => {
  const empty = { email: "", name: "", language: "", userId: "" };
  if (!orderId) return empty;
  const attempts = [
    "customer_email, customer_name, language, user_id",
    "customer_email, customer_name, user_id",
    "user_id",
  ];
  for (const columns of attempts) {
    const result = await supabase.from("orders").select(columns).eq("id", orderId).maybeSingle();
    if (result.error) {
      if (missingColumn(result.error)) continue;
      return empty;
    }
    const row = result.data as {
      customer_email?: string | null;
      customer_name?: string | null;
      language?: string | null;
      user_id?: string | null;
    } | null;
    if (!row) return empty;
    return {
      email: String(row.customer_email || "").trim(),
      name: String(row.customer_name || "").trim(),
      language: String(row.language || "").trim(),
      userId: String(row.user_id || "").trim(),
    };
  }
  return empty;
};

export const clientPortalLanguage = async (
  supabase: ReturnType<typeof createClient>,
  userId: string,
  email = "",
  explicit?: unknown,
): Promise<MailLanguage> => {
  const chosen = normalizeMailLanguage(explicit);
  if (chosen) return chosen;
  if (userId.trim()) {
    const stored = await readLanguage(supabase, userId.trim());
    if (stored) return stored;
  }
  const byEmail = await readLanguageByEmail(supabase, email);
  if (byEmail) return byEmail;
  return "SK";
};

export const loadOrderMailContext = async (
  orderId: string,
  payloadEmail: string,
  payloadName: string,
  explicitLanguage?: unknown,
  clientUserId?: string,
) => {
  const explicit = normalizeMailLanguage(explicitLanguage);
  const fallback = {
    lang: (explicit === "EN" ? "EN" : "SK") as MailLanguage,
    recipient: payloadEmail.trim(),
    copyTo: "",
    customerName: payloadName.trim(),
  };

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!supabaseUrl || !serviceKey) return fallback;

  try {
    const supabase = createClient(supabaseUrl, serviceKey);
    const orderCustomer = await readOrderCustomer(supabase, orderId);
    const requested = fallback.recipient;
    const recipient = orderCustomer.email || requested;
    const copyTo = orderCustomer.email && requested && orderCustomer.email.toLowerCase() !== requested.toLowerCase()
      ? requested
      : "";
    const customerName = orderCustomer.name || fallback.customerName;
    const orderLanguage = normalizeMailLanguage(orderCustomer.language);
    let clientLanguage: MailLanguage | null = null;
    try {
      const userIds = await collectUserIds(supabase, orderId, orderCustomer.email, [
        clientUserId || "",
        orderCustomer.userId,
      ]);
      for (const userId of userIds) {
        const stored = await readLanguage(supabase, userId);
        if (stored === "EN") {
          clientLanguage = "EN";
          break;
        }
        if (stored === "SK") clientLanguage = clientLanguage || "SK";
      }
      if (clientLanguage !== "EN") {
        const byEmail = await readLanguageByEmail(supabase, orderCustomer.email);
        if (byEmail === "EN") clientLanguage = "EN";
        else if (byEmail) clientLanguage = clientLanguage || byEmail;
      }
    } catch (error) {
      console.warn("[status-email] Language lookup failed, using the order language:", error);
    }
    const lang: MailLanguage = orderLanguage || clientLanguage || explicit || "SK";
    return { lang, recipient, copyTo, customerName };
  } catch (error) {
    console.warn("[status-email] Order lookup failed, using request data:", error);
    return fallback;
  }
};

type StatusKey = "processing" | "completed" | "cancelled" | "pending" | "other";

const statusKey = (status: string): StatusKey => {
  const value = status.trim().toLowerCase();
  if (value === "processing" || value === "in_progress" || value === "in-progress") return "processing";
  if (value === "completed" || value === "complete" || value === "done") return "completed";
  if (value === "cancelled" || value === "canceled" || value === "error" || value === "failed") return "cancelled";
  if (value === "pending") return "pending";
  return "other";
};

const copy = {
  SK: {
    greeting: (name: string) => (name ? `Dobrý deň, ${name},` : "Dobrý deň,"),
    order: (orderNumber: string, vehicle: string) =>
      vehicle
        ? `Vaša objednávka ${orderNumber} pre vozidlo ${vehicle}.`
        : `Vaša objednávka ${orderNumber}.`,
    processing: "Na Vašom súbore sa v tejto chvíli pracuje.",
    completed: "Váš súbor je pripravený na použitie.",
    download: "Stiahnuť súbor",
    cancelled:
      "Ospravedlňujeme sa, ale túto objednávku nebolo možné dokončiť. Vaše kredity boli v plnej výške vrátené späť na Váš účet. Veríme, že pri ďalšej objednávke všetko prebehne úspešne.",
    pending: "Vaša objednávka bola prijatá. Ďakujeme.",
    other: (status: string) => `Stav objednávky bol aktualizovaný: ${status}.`,
    subject: {
      processing: (orderNumber: string) => `Objednávka ${orderNumber} je v procese - REMAPPRO`,
      completed: (orderNumber: string) => `Objednávka ${orderNumber} je dokončená - REMAPPRO`,
      cancelled: (orderNumber: string) => `Objednávka ${orderNumber} bola zrušená - REMAPPRO`,
      pending: (orderNumber: string) => `Objednávka ${orderNumber} bola prijatá - REMAPPRO`,
      other: (orderNumber: string) => `Objednávka ${orderNumber} - aktualizácia stavu - REMAPPRO`,
    },
  },
  EN: {
    greeting: (name: string) => (name ? `Hello ${name},` : "Hello,"),
    order: (orderNumber: string, vehicle: string) =>
      vehicle
        ? `Your order ${orderNumber} for vehicle ${vehicle}.`
        : `Your order ${orderNumber}.`,
    processing: "Your order is currently being processed.",
    completed: "Your file is ready to use.",
    download: "Download File",
    cancelled:
      "We apologize, but this order could not be completed. Your credits have been fully refunded to your account. We look forward to serving you successfully next time.",
    pending: "Your order has been received. Thank you.",
    other: (status: string) => `Your order status has been updated: ${status}.`,
    subject: {
      processing: (orderNumber: string) => `Order ${orderNumber} is in progress - REMAPPRO`,
      completed: (orderNumber: string) => `Order ${orderNumber} is completed - REMAPPRO`,
      cancelled: (orderNumber: string) => `Order ${orderNumber} is cancelled - REMAPPRO`,
      pending: (orderNumber: string) => `Order ${orderNumber} received - REMAPPRO`,
      other: (orderNumber: string) => `Order ${orderNumber} status update - REMAPPRO`,
    },
  },
} as const;

export const renderStatusEmail = (input: {
  language: MailLanguage;
  status: string;
  orderNumber: string;
  customerName: string;
  vehicle: string;
  downloadUrl?: string;
  creditNoteNumber?: string;
}) => {
  const language = input.language === "EN" ? "EN" : "SK";
  const text = copy[language];
  const key = statusKey(input.status);
  const orderNumber = input.orderNumber.trim();
  const customerName = input.customerName.trim();
  const vehicle = input.vehicle.trim();
  const detail = key === "processing"
    ? (language === "EN" ? `Your order ${orderNumber} is currently being processed.` : text.processing)
    : key === "completed"
    ? text.completed
    : key === "cancelled"
    ? text.cancelled
    : key === "pending"
    ? text.pending
    : text.other(input.status.trim());
  const creditNoteNumber = input.creditNoteNumber?.trim() || "";
  const ordersLink = `<a href="${escapeHtml(portalOrderUrl(orderNumber))}" target="_blank" style="color: #00d2ff; text-decoration: underline;">${language === "EN" ? "My Orders" : "Moje objednávky"}</a>`;
  const creditNote = key === "cancelled" && creditNoteNumber
    ? `
          <tr>
            <td style="padding: 0 32px 28px 32px; color: #c9d1d9; font-size: 15px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif;">
              ${language === "EN"
                ? `A credit note <strong>${escapeHtml(creditNoteNumber)}</strong> has been issued for this order. You can download it in the ${ordersLink} section.`
                : `K objednávke bol vystavený dobropis č. <strong>${escapeHtml(creditNoteNumber)}</strong>. Stiahnuť si ho môžete v sekcii ${ordersLink}.`}
            </td>
          </tr>`
    : "";
  const download = key === "completed"
    ? `
                    <tr>
                      <td align="center" style="padding: 8px 32px 8px 32px;">
                        <table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center">
                          <tr>
                            <td align="center" bgcolor="#00d2ff" style="background-color: #00d2ff; border-radius: 6px;">
                              <a href="${escapeHtml(input.downloadUrl || portalOrderUrl(orderNumber))}" target="_blank" style="background-color: #00d2ff; color: #000000; font-weight: bold; font-size: 15px; line-height: 1.2; font-family: Arial, Helvetica, sans-serif; border-radius: 6px; padding: 12px 24px; display: inline-block; text-decoration: none;">${text.download}</a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>`
    : "";

  const html = `<!DOCTYPE html>
<html lang="${language === "EN" ? "en" : "sk"}">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
</head>
<body bgcolor="#0a0c10" style="margin: 0; padding: 0; background-color: #0a0c10; color: #c9d1d9; font-family: Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0c10" style="margin: 0; padding: 0; background-color: #0a0c10;">
    <tr>
      <td align="center" bgcolor="#0a0c10" style="padding: 24px 12px; background-color: #0a0c10;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="#161b22" style="width: 600px; max-width: 600px; background-color: #161b22; border: 1px solid #30363d;">
          <tr>
            <td align="center" style="text-align: center; padding: 30px 20px 0px 20px; line-height: 0;">
              <img src="https://huswisewblkfcozdgvrq.supabase.co/storage/v1/object/public/assets/Logo-mail-clean.png" alt="REMAPPRO" width="250" style="width: 250px; max-width: 100%; height: auto; display: block; margin: 0 auto; border: none; outline: none; text-decoration: none;">
              <hr style="border: 0; border-top: 2px solid #00d2ff; margin-top: 15px; margin-bottom: 20px; width: 100%;">
            </td>
          </tr>
          <tr>
            <td style="padding: 28px 32px 8px 32px; color: #c9d1d9; font-size: 15px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif;">
              ${escapeHtml(text.greeting(customerName))}
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 8px 32px; color: #c9d1d9; font-size: 15px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif;">
              ${escapeHtml(text.order(orderNumber, vehicle))}
            </td>
          </tr>
          <tr>
            <td style="padding: 0 32px 28px 32px; color: #c9d1d9; font-size: 15px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif;">
              ${escapeHtml(detail)}
            </td>
          </tr>
          ${creditNote}
          ${download}
          <tr>
            <td align="center" style="padding: 12px 24px 32px 24px; text-align: center; border-top: 1px solid #30363d;">
              <p style="margin: 16px 0 8px 0; color: #8b949e; font-size: 12px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif;">REMAPPRO | Janka Krála 29, 990 01 Velký Krtíš, Slovakia</p>
              <p style="margin: 0 0 8px 0; color: #8b949e; font-size: 12px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif;">IČO: 41281471 | DIČ: 1041196607 | info@remappro.eu</p>
              <p style="margin: 0; color: #8b949e; font-size: 12px; line-height: 1.6; font-family: Arial, Helvetica, sans-serif;">© 2026 REMAPPRO. Všetky práva vyhradené. / All rights reserved.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: text.subject[key](orderNumber),
    html,
  };
};
