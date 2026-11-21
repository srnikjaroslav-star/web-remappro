import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchTelegram, notifyCreatedOrder } from "../_shared/telegramOrder.ts";

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
      const code = ["NO_ACCOUNT", "INSUFFICIENT_CREDITS", "INVALID_AMOUNT", "NOT_AUTHENTICATED"]
        .find((item) => message.includes(item)) ?? "SERVER";
      return json({ ok: false, code }, code === "SERVER" ? 500 : 200);
    }

    const mailLanguage = (value: unknown) => {
      const raw = String(value ?? "").trim().toUpperCase();
      if (raw.startsWith("EN")) return "EN";
      if (raw.startsWith("SK")) return "SK";
      return "";
    };
    let language = mailLanguage(body.language);
    if (!language) {
      const profile = await admin.from("client_profiles").select("language").eq("user_id", user.id).maybeSingle();
      language = mailLanguage((profile.data as { language?: unknown } | null)?.language)
        || mailLanguage(user.user_metadata?.language)
        || mailLanguage(user.user_metadata?.lang)
        || "SK";
    }
    const orderNumber = String(data?.order_number ?? "");
    if (orderNumber) {
      const saved = await admin.from("orders").update({ language, user_id: user.id }).eq("order_number", orderNumber);
      if (saved.error) {
        await admin.from("orders").update({ user_id: user.id }).eq("order_number", orderNumber);
        await admin.from("orders").update({ language }).eq("order_number", orderNumber);
      }
    }

    let telegramScheduled = false;
    try {
      dispatchTelegram(notifyCreatedOrder(admin, {
        orderId: data?.order_id,
        orderNumber,
      }));
      telegramScheduled = true;
    } catch (telegramError) {
      console.error("[pay-with-credits] telegram", telegramError);
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
