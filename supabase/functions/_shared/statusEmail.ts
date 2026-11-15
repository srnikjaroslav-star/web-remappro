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

  const { data: userData } = await supabase.auth.admin.getUserById(userId);
  const metadata = userData?.user?.user_metadata ?? {};
  return normalizeMailLanguage(metadata.language ?? metadata.lang ?? metadata.locale);
};

const findUserId = async (
  supabase: ReturnType<typeof createClient>,
  orderId: string,
  customerEmail: string,
) => {
  if (orderId) {
    const byId = await supabase.from("orders").select("user_id").eq("id", orderId).maybeSingle();
    const orderUserId = String((byId.data as { user_id?: string | null } | null)?.user_id || "");
    if (!byId.error && orderUserId) return orderUserId;

    const ledger = await supabase
      .from("credit_transactions")
      .select("user_id")
      .eq("order_id", orderId)
      .limit(1)
      .maybeSingle();
    const ledgerUserId = String((ledger.data as { user_id?: string | null } | null)?.user_id || "");
    if (!ledger.error && ledgerUserId) return ledgerUserId;
  }

  const email = customerEmail.trim().toLowerCase();
  if (!email) return "";

  for (const column of ["user_id", "id"] as const) {
    const profile = await supabase
      .from("client_profiles")
      .select(column)
      .eq("email", email)
      .maybeSingle();
    const profileUserId = String((profile.data as Record<string, unknown> | null)?.[column] || "");
    if (!profile.error && profileUserId) return profileUserId;
  }

  return "";
};

const readOrderCustomer = async (
  supabase: ReturnType<typeof createClient>,
  orderId: string,
) => {
  if (!orderId) return { email: "", name: "" };
  const { data, error } = await supabase
    .from("orders")
    .select("customer_email, customer_name")
    .eq("id", orderId)
    .maybeSingle();
  if (error || !data) return { email: "", name: "" };
  const row = data as { customer_email?: string | null; customer_name?: string | null };
  return {
    email: String(row.customer_email || "").trim(),
    name: String(row.customer_name || "").trim(),
  };
};

export const loadOrderMailContext = async (
  orderId: string,
  payloadEmail: string,
  payloadName: string,
) => {
  const fallback = {
    lang: "SK" as MailLanguage,
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
    let lang: MailLanguage = "SK";
    try {
      const userId = await findUserId(supabase, orderId, recipient);
      if (userId) lang = (await readLanguage(supabase, userId)) || "SK";
    } catch (error) {
      console.warn("[status-email] Language lookup failed, using Slovak:", error);
    }
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
    processing: "Your file is currently being worked on.",
    completed: "Your file is ready to use.",
    download: "Download File",
    cancelled:
      "We apologize, but this order could not be completed. Your credits have been fully refunded to your account. We look forward to serving you successfully next time.",
    pending: "Your order has been received. Thank you.",
    other: (status: string) => `Your order status has been updated: ${status}.`,
    subject: {
      processing: (orderNumber: string) => `Order ${orderNumber} in progress - REMAPPRO`,
      completed: (orderNumber: string) => `Order ${orderNumber} completed - REMAPPRO`,
      cancelled: (orderNumber: string) => `Order ${orderNumber} cancelled - REMAPPRO`,
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
}) => {
  const language = input.language === "EN" ? "EN" : "SK";
  const text = copy[language];
  const key = statusKey(input.status);
  const orderNumber = input.orderNumber.trim();
  const customerName = input.customerName.trim();
  const vehicle = input.vehicle.trim();
  const detail = key === "processing"
    ? text.processing
    : key === "completed"
    ? text.completed
    : key === "cancelled"
    ? text.cancelled
    : key === "pending"
    ? text.pending
    : text.other(input.status.trim());
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
