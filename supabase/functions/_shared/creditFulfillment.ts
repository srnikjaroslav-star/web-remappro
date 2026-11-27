import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { clientMailShell, sendClientEmail } from "./clientNotice.ts";
import { PACKAGE_ITEM_DESCRIPTION } from "./creditPackages.ts";
import { renderPackageInvoice } from "./packageInvoice.ts";
import { clientPortalLanguage } from "./statusEmail.ts";
import { dispatchTelegram, notifyCreditTopUp } from "./telegramOrder.ts";

type Claim = {
  claimed?: boolean;
  reason?: string;
  invoice_number?: string | null;
  user_id?: string | null;
  amount?: number | string | null;
  credits?: number | string | null;
  company?: string | null;
  account_name?: string | null;
  account_email?: string | null;
  topup_ref?: string | null;
  consent_summary?: string | null;
  notified_at?: string | null;
};

type Buyer = {
  name: string;
  company: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  postalCode: string;
  ico: string;
  dic: string;
};

const emptyBuyer = (): Buyer => ({
  name: "",
  company: "",
  email: "",
  phone: "",
  street: "",
  city: "",
  postalCode: "",
  ico: "",
  dic: "",
});

const text = (value: unknown) => String(value ?? "").trim();

const num = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const euros = (value: number, language: "SK" | "EN") =>
  `${value.toLocaleString(language === "EN" ? "en-GB" : "sk-SK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} €`;

const unpackAddress = (value: unknown) => {
  const raw = text(value);
  if (!raw.startsWith("rp1:")) return null;
  try {
    const parsed = JSON.parse(raw.slice(4)) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
};

const loadBuyer = async (admin: SupabaseClient, userId: string): Promise<Buyer> => {
  const buyer = emptyBuyer();
  if (!userId) return buyer;
  let row: Record<string, unknown> | null = null;
  for (const column of ["user_id", "id"] as const) {
    const result = await admin.from("client_profiles").select("*").eq(column, userId).maybeSingle();
    if (!result.error && result.data) {
      row = result.data as Record<string, unknown>;
      break;
    }
  }
  const packed = unpackAddress(row?.address);
  let authEmail = "";
  let meta: Record<string, unknown> = {};
  try {
    const user = await admin.auth.admin.getUserById(userId);
    authEmail = text(user.data.user?.email);
    meta = user.data.user?.user_metadata ?? {};
  } catch (error) {
    console.warn("[credit-invoice] profile lookup", error);
  }
  const first = text(row?.first_name) || text(packed?.firstName) || text(meta.first_name);
  const last = text(row?.last_name) || text(packed?.lastName) || text(meta.last_name);
  buyer.name = [first, last].filter(Boolean).join(" ");
  buyer.company = text(row?.company_name) || text(meta.company);
  buyer.email = text(row?.email) || text(packed?.email) || authEmail;
  buyer.phone = text(row?.phone) || text(packed?.phone);
  buyer.street = text(row?.street) || text(packed?.street);
  buyer.city = text(row?.city) || text(packed?.city);
  buyer.postalCode = text(row?.postal_code) || text(packed?.postalCode);
  buyer.ico = text(row?.ico) || text(row?.vat_id);
  buyer.dic = text(row?.dic) || text(row?.tax_id);
  return buyer;
};

const loadPackageItemDescription = async (admin: SupabaseClient) => {
  const { data, error } = await admin.from("system_settings").select("value").eq("key", "invoice").maybeSingle();
  if (error) return PACKAGE_ITEM_DESCRIPTION;
  const value = data?.value && typeof data.value === "object"
    ? (data.value as Record<string, unknown>).itemDescription
    : "";
  return text(value) || PACKAGE_ITEM_DESCRIPTION;
};

const notifyAdminOnce = async (
  admin: SupabaseClient,
  sessionId: string,
  claim: Claim,
  buyer: Buyer,
  recipient: string,
) => {
  if (claim.notified_at) return;
  const userId = text(claim.user_id);
  const balanceRow = userId
    ? await admin.from("credit_accounts").select("balance").eq("user_id", userId).maybeSingle()
    : null;
  dispatchTelegram(notifyCreditTopUp({
    topupRef: text(claim.topup_ref),
    credits: num(claim.credits),
    price: num(claim.amount),
    email: recipient,
    name: buyer.name || text(claim.account_name),
    company: buyer.company || text(claim.company),
    invoiceNumber: text(claim.invoice_number),
    balance: num((balanceRow?.data as { balance?: unknown } | null)?.balance),
  }));
  await admin.from("credit_topups").update({ notified_at: new Date().toISOString() }).eq("stripe_session_id", sessionId);
};

export const fulfillCreditPackage = async (
  admin: SupabaseClient,
  sessionId: string,
): Promise<{ ok: boolean; invoiceSent: boolean }> => {
  const id = sessionId.trim();
  if (!id.startsWith("cs_")) return { ok: false, invoiceSent: false };

  const { data, error } = await admin.rpc("claim_credit_package_invoice", {
    p_stripe_session_id: id,
  });
  if (error) {
    console.error("[credit-invoice]", error.message);
    return { ok: false, invoiceSent: false };
  }
  const claim = (data ?? {}) as Claim;
  if (!claim.claimed) {
    const alreadySent = claim.reason === "sent";
    return { ok: alreadySent, invoiceSent: alreadySent };
  }

  const userId = text(claim.user_id);
  const buyer = await loadBuyer(admin, userId);
  const recipient = buyer.email || text(claim.account_email);
  const language = await clientPortalLanguage(admin, userId, recipient);
  const credits = num(claim.credits);
  const price = num(claim.amount);
  const invoiceNumber = text(claim.invoice_number);
  const topupRef = text(claim.topup_ref);
  const safeName = escapeHtml(buyer.name);
  const greeting = language === "EN"
    ? (buyer.name ? `Hello ${safeName},` : "Hello,")
    : (buyer.name ? `Dobrý deň ${safeName},` : "Dobrý deň,");

  let attachment: { filename: string; content: string } | undefined;
  try {
    const pdf = renderPackageInvoice({
      invoiceNumber,
      credits,
      price,
      topupId: topupRef,
      itemDescription: await loadPackageItemDescription(admin),
      buyerName: buyer.company || buyer.name || text(claim.company) || text(claim.account_name) || "Zákazník",
      buyerContact: buyer.company && buyer.name ? buyer.name : "",
      buyerStreet: buyer.street,
      buyerPostal: buyer.postalCode,
      buyerCity: buyer.city,
      buyerEmail: recipient,
      buyerPhone: buyer.phone,
      buyerIco: buyer.ico,
      buyerDic: buyer.dic,
      consentSummary: text(claim.consent_summary),
    });
    if (pdf.content) attachment = { filename: pdf.filename, content: pdf.content };
  } catch (pdfError) {
    console.error("[credit-invoice] pdf", pdfError);
  }

  const body = language === "EN"
    ? `<p>${greeting}</p>
       <p><strong>${escapeHtml(String(credits))}</strong> credits were added to your REMAPPRO account. The package was paid in advance: <strong>${escapeHtml(euros(price, language))}</strong>.</p>
       <p>${attachment ? `Invoice <strong>${escapeHtml(invoiceNumber)}</strong> is attached.` : `Invoice number: <strong>${escapeHtml(invoiceNumber)}</strong>.`} Top-up ID: <strong>${escapeHtml(topupRef)}</strong>.</p>
       <p>The supplier is not a VAT payer.</p>`
    : `<p>${greeting}</p>
       <p>Na váš účet v portáli REMAPPRO bolo pripísaných <strong>${escapeHtml(String(credits))}</strong> kreditov. Balík bol uhradený vopred sumou <strong>${escapeHtml(euros(price, language))}</strong>.</p>
       <p>${attachment ? `V prílohe je faktúra <strong>${escapeHtml(invoiceNumber)}</strong>.` : `Číslo faktúry: <strong>${escapeHtml(invoiceNumber)}</strong>.`} ID dobitia: <strong>${escapeHtml(topupRef)}</strong>.</p>
       <p>Dodávateľ nie je platiteľom DPH.</p>`;
  const sent = await sendClientEmail({
    to: recipient,
    subject: language === "EN"
      ? `Credit top-up and invoice ${invoiceNumber}`
      : `Dobitie kreditov a faktúra ${invoiceNumber}`,
    html: clientMailShell(language === "EN" ? "Credits have been added" : "Kredity boli pripísané", body, language),
    attachments: attachment ? [attachment] : undefined,
  });

  await notifyAdminOnce(admin, id, claim, buyer, recipient);

  if (!sent) {
    console.error("[credit-invoice] e-mail sa neodoslal, kredity aj číslo faktúry ostávajú", id);
  }
  return { ok: true, invoiceSent: sent };
};

export const sendCreditOrderEmail = async (
  admin: SupabaseClient,
  input: {
    userId: string;
    email: string;
    name: string;
    orderNumber: string;
    vehicle: string;
    credits: number;
    explicitLanguage?: unknown;
  },
) => {
  const language = await clientPortalLanguage(admin, input.userId, input.email, input.explicitLanguage);
  const safeName = escapeHtml(input.name);
  const greeting = language === "EN"
    ? (input.name ? `Hello ${safeName},` : "Hello,")
    : (input.name ? `Dobrý deň ${safeName},` : "Dobrý deň,");
  const vehicle = input.vehicle ? `<p>${language === "EN" ? "Vehicle" : "Vozidlo"}: <strong>${escapeHtml(input.vehicle)}</strong></p>` : "";
  const amount = escapeHtml(String(input.credits));
  const orderNumber = escapeHtml(input.orderNumber);
  const body = language === "EN"
    ? `<p>${greeting}</p>
       <p>Your order <strong>${orderNumber}</strong> has been received. <strong>${amount}</strong> credits were drawn from your prepaid account.</p>
       ${vehicle}
       <p>You can follow the order in the REMAPPRO client portal.</p>`
    : `<p>${greeting}</p>
       <p>Vaša objednávka <strong>${orderNumber}</strong> bola prijatá. Z predplateného účtu bolo čerpaných <strong>${amount}</strong> kreditov.</p>
       ${vehicle}
       <p>Stav objednávky sledujete v klientskom portáli REMAPPRO.</p>`;
  await sendClientEmail({
    to: input.email,
    subject: language === "EN"
      ? `Order ${input.orderNumber} has been received`
      : `Objednávka ${input.orderNumber} bola prijatá`,
    html: clientMailShell(language === "EN" ? "Order received" : "Objednávka prijatá", body, language),
  });
};
