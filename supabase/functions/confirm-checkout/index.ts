import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const parseServices = (raw: string | undefined): string[] => {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((item) => String(item)) : [String(parsed)];
  } catch {
    return raw.split(",").map((item) => item.trim()).filter(Boolean);
  }
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const { sessionId } = await req.json();
    if (!sessionId || typeof sessionId !== "string" || !sessionId.startsWith("cs_")) {
      return json({ error: "A valid Stripe session id is required" }, 400);
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeKey || !supabaseUrl || !serviceKey) {
      return json({ error: "Payment confirmation is not configured" }, 500);
    }

    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid" && session.status !== "complete") {
      return json({ error: "Payment is not completed" }, 409);
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    const { data: existing, error: existingError } = await supabase
      .from("orders")
      .select("*")
      .eq("stripe_session_id", sessionId)
      .maybeSingle();

    if (existingError) {
      console.error("[confirm-checkout] Lookup failed:", JSON.stringify({
        message: existingError.message,
        code: existingError.code,
        details: existingError.details,
        hint: existingError.hint,
      }));
      return json({
        error: existingError.message,
        code: existingError.code,
        details: existingError.details,
        hint: existingError.hint,
      }, 500);
    }

    if (existing) {
      return json({ order: existing, created: false });
    }

    const metadata = session.metadata || {};
    const amountTotal = session.amount_total ? session.amount_total / 100 : 0;
    const fuelRaw = metadata.fuel_type || "";
    const fuelType = fuelRaw === "Diesel" || fuelRaw === "Petrol" ? fuelRaw : "";
    const yearRaw = metadata.year ? String(metadata.year).trim() : "";
    const parsedYear = parseInt(yearRaw, 10);
    const year = !isNaN(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100
      ? String(parsedYear)
      : null;

    let fileUrl: string | null = null;
    const fileUrlRaw = metadata.file_url || "";
    if (fileUrlRaw.trim()) {
      fileUrl = fileUrlRaw.includes("/")
        ? fileUrlRaw.split("/").pop()?.split("?")[0] || null
        : fileUrlRaw.trim();
    }

    const serviceTypes = parseServices(metadata.services);
    const timestamp = Date.now().toString(36).toUpperCase();
    const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();

    const orderData = {
      order_number: `RP-${timestamp}${randomSuffix}`,
      customer_name: session.customer_details?.name || metadata.customer_name || "Customer",
      customer_email: (session.customer_details?.email || session.customer_email || "").toLowerCase(),
      car_brand: metadata.brand || null,
      car_model: metadata.model || null,
      fuel_type: fuelType || null,
      year,
      file_url: fileUrl,
      ecu_type: metadata.ecu_type || null,
      service_type: serviceTypes.length > 0 ? serviceTypes : null,
      total_price: Number(amountTotal.toFixed(2)),
      status: "pending",
      legal_consent: metadata.legal_consent === "true",
      customer_note: metadata.customer_note || null,
      stripe_session_id: sessionId,
    };

    const { data: created, error: insertError } = await supabase
      .from("orders")
      .insert([orderData])
      .select("*")
      .single();

    if (insertError || !created) {
      const { data: raced } = await supabase
        .from("orders")
        .select("*")
        .eq("stripe_session_id", sessionId)
        .maybeSingle();

      if (raced) return json({ order: raced, created: false });

      console.error("[confirm-checkout] Insert failed:", JSON.stringify({
        message: insertError?.message,
        code: insertError?.code,
        details: insertError?.details,
        hint: insertError?.hint,
      }));
      return json({
        error: insertError?.message || "Failed to save the order",
        code: insertError?.code || null,
        details: insertError?.details || null,
        hint: insertError?.hint || null,
      }, 500);
    }

    return json({ order: created, created: true });
  } catch (error) {
    console.error("[confirm-checkout] Error:", error);
    const message = error instanceof Error ? error.message : "Failed to confirm payment";
    return json({ error: message }, 500);
  }
});
