import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendCreditOrderEmail } from "../_shared/creditFulfillment.ts";
import { isFunctionAdmin, operatingOpen } from "../_shared/operatingStatus.ts";
import { clientPortalLanguage } from "../_shared/statusEmail.ts";

const scheduleOrderNotice = (supabaseUrl: string, anonKey: string, authHeader: string, orderId: string) => {
  const work = fetch(`${supabaseUrl}/functions/v1/notify-order`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      apikey: anonKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ orderId }),
  }).then((response) => {
    if (!response.ok) console.error("[pay-with-credits] telegram", response.status);
  }).catch((error) => {
    console.error("[pay-with-credits] telegram", error);
  });
  try {
    const waitUntil = (globalThis as {
      EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
    }).EdgeRuntime?.waitUntil;
    if (waitUntil) {
      waitUntil(work);
      return;
    }
  } catch (error) {
    console.error("[pay-with-credits] telegram", error);
  }
  void work;
};

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATALOG_URL = "https://huswisewblkfcozdgvrq.supabase.co";
const CATALOG_KEY = "sb_publishable_LM2MhZV7ROsdMSZQb9_wpA_9ZOXOIlZ";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) {
      return json({ ok: false, code: "SERVER" }, 500);
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) {
      return json({ ok: false, code: "NOT_AUTHENTICATED" });
    }

    if (!isFunctionAdmin(user) && !await operatingOpen()) {
      return json({ ok: false, code: "OFFLINE" });
    }

    const body = await req.json();
    const serviceIds = Array.isArray(body.serviceIds)
      ? body.serviceIds.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)
      : [];
    if (serviceIds.length === 0) {
      return json({ ok: false, code: "INVALID_AMOUNT" });
    }

    const catalogResponse = await fetch(
      `${CATALOG_URL}/rest/v1/services?select=id,price`,
      { headers: { apikey: CATALOG_KEY, Authorization: `Bearer ${CATALOG_KEY}` } },
    );
    if (!catalogResponse.ok) {
      return json({ ok: false, code: "SERVER" }, 502);
    }
    const catalog = await catalogResponse.json() as { id: string; price: number | string }[];
    const prices = new Map(catalog.map((service) => [service.id, Number(service.price)]));

    let amount = 0;
    for (const id of serviceIds) {
      const price = prices.get(id);
      if (price === undefined || !Number.isFinite(price) || price < 0) {
        return json({ ok: false, code: "UNKNOWN_SERVICE" });
      }
      amount += price;
    }
    amount = Math.round(amount * 100) / 100;

    const fuelType = body.fuelType === "Diesel" || body.fuelType === "Petrol" ? body.fuelType : "";
    const yearNumber = Number(body.year);
    const year = Number.isInteger(yearNumber) && yearNumber >= 1900 && yearNumber <= 2100
      ? String(yearNumber)
      : "";

    if (body.legalConsent !== true) {
      return json({ ok: false, code: "CONSENT_REQUIRED" });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data, error } = await admin.rpc("pay_with_credits", {
      p_user_id: user.id,
      p_amount: amount,
      p_customer_name: String(body.customerName ?? "").trim(),
      p_customer_email: String(body.customerEmail ?? user.email ?? "").trim(),
      p_car_brand: String(body.brand ?? "").trim(),
      p_car_model: String(body.model ?? "").trim(),
      p_fuel_type: fuelType,
      p_year: year,
      p_ecu_type: String(body.ecuType ?? "").trim(),
      p_service_type: JSON.stringify(serviceIds),
      p_file_url: String(body.fileUrl ?? "").trim(),
      p_customer_note: String(body.customerNote ?? ""),
      p_legal_consent: body.legalConsent === true,
    });

    if (error) {
      const message = error.message ?? "";
      const code = ["NO_ACCOUNT", "INSUFFICIENT_CREDITS", "INVALID_AMOUNT", "NOT_AUTHENTICATED", "CONSENT_REQUIRED"]
        .find((item) => message.includes(item)) ?? "SERVER";
      return json({ ok: false, code }, code === "SERVER" ? 500 : 200);
    }

    const customerEmail = String(body.customerEmail ?? user.email ?? "").trim();
    const language = await clientPortalLanguage(admin, user.id, customerEmail, body.language);
    const orderId = String(data?.order_id ?? "");
    if (orderId) {
      const records: Record<string, unknown>[] = [];
      const pushRecord = (value: unknown) => {
        if (!value || typeof value !== "object" || Array.isArray(value)) return;
        records.push(value as Record<string, unknown>);
      };
      pushRecord(body);
      pushRecord((body as { body?: unknown } | null)?.body);
      pushRecord((body as { consent?: unknown } | null)?.consent);
      const folded = new Map<string, unknown>();
      for (const record of records) {
        for (const [key, value] of Object.entries(record)) {
          folded.set(key.toLowerCase().replace(/[^a-z0-9]/g, ""), value);
        }
      }
      const isTrue = (value: unknown) => {
        if (value === true || value === 1) return true;
        if (typeof value === "string") {
          const normalized = value.trim().toLowerCase();
          return normalized === "true" || normalized === "1" || normalized === "yes";
        }
        return false;
      };
      const readFlag = (...names: string[]) => names.some((name) => isTrue(folded.get(name)));
      const readText = (...names: string[]) => {
        for (const name of names) {
          const value = folded.get(name);
          if (typeof value === "string" && value.trim()) return value.slice(0, 2000);
        }
        return null;
      };
      const legalConsent = readFlag("legalconsent");
      let emissionOffroadConsent = readFlag("emissionoffroadconsent", "emissionack");
      let consentSummary = readText("consentsummary");
      if (
        !emissionOffroadConsent
        && consentSummary
        && /off-road|offroad/i.test(consentSummary)
        && /potvrdzujem|i confirm|vyhlásenie|declaration/i.test(consentSummary)
      ) {
        emissionOffroadConsent = true;
      }
      const consentedAt = new Date().toISOString();
      const consentPatch = {
        legal_consent: Boolean(legalConsent),
        legal_consent_at: legalConsent ? consentedAt : null,
        emission_offroad_consent: Boolean(emissionOffroadConsent),
        emission_offroad_consent_at: emissionOffroadConsent ? consentedAt : null,
        consent_summary: consentSummary,
      };
      const languageSaved = await admin.from("orders").update({
        language,
        user_id: user.id,
      }).eq("id", orderId);
      if (languageSaved.error) {
        console.error("[pay-with-credits] language", languageSaved.error.message);
        await admin.from("orders").update({ user_id: user.id }).eq("id", orderId);
      }
      const consentSaved = await admin.from("orders").update(consentPatch).eq("id", orderId);
      if (consentSaved.error) {
        console.error("[pay-with-credits] consent audit", consentSaved.error.message);
      }
    }

    let telegramScheduled = false;
    if (/^[0-9a-f-]{36}$/i.test(orderId)) {
      try {
        scheduleOrderNotice(supabaseUrl, anonKey, authHeader, orderId);
        telegramScheduled = true;
      } catch (telegramError) {
        console.error("[pay-with-credits] telegram", telegramError);
      }
      const vehicle = [body.brand, body.model, body.year].map((part: unknown) => String(part ?? "").trim()).filter(Boolean).join(" ");
      const mail = sendCreditOrderEmail(admin, {
        userId: user.id,
        email: customerEmail,
        name: String(body.customerName ?? "").trim(),
        orderNumber: String(data?.order_number ?? ""),
        vehicle,
        credits: amount,
        explicitLanguage: language,
      }).catch((mailError) => {
        console.error("[pay-with-credits] order email", mailError);
      });
      try {
        const waitUntil = (globalThis as {
          EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void };
        }).EdgeRuntime?.waitUntil;
        if (waitUntil) waitUntil(mail);
        else void mail;
      } catch (mailError) {
        console.error("[pay-with-credits] order email", mailError);
        void mail;
      }
    }

    return json({
      ok: true,
      balance: Number(data?.balance),
      orderNumber: data?.order_number,
      orderId: data?.order_id ?? null,
      telegramScheduled,
    });
  } catch (error) {
    console.error("[pay-with-credits]", error);
    return json({ ok: false, code: "SERVER" }, 500);
  }
});
