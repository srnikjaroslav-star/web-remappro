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

const parseAmount = (value: unknown) => {
  const amount = Math.round(Number(String(value ?? "").replace(",", ".")) * 100) / 100;
  if (!Number.isFinite(amount) || amount < 0.5 || amount > 100000) return null;
  return amount;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!stripeKey || !supabaseUrl || !anonKey) {
      return json({ ok: false, code: "SERVER" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) return json({ ok: false, code: "NOT_AUTHENTICATED" }, 401);

    const body = await req.json().catch(() => ({}));
    const amount = parseAmount((body as { amount?: unknown }).amount);
    if (amount === null) return json({ ok: false, code: "INVALID_AMOUNT" }, 400);

    const origin = req.headers.get("origin") || "";
    if (!origin) return json({ ok: false, code: "SERVER" }, 500);

    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: user.email || undefined,
      client_reference_id: user.id,
      success_url: `${origin}/#/?credit_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#/`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: Math.round(amount * 100),
          product_data: { name: "Dobitie kreditov" },
        },
      }],
      metadata: {
        purpose: "credit_topup",
        user_id: user.id,
        amount: amount.toFixed(2),
      },
    });

    if (!session.url) return json({ ok: false, code: "SERVER" }, 500);
    return json({ ok: true, url: session.url });
  } catch (error) {
    console.error("[create-credit-checkout]", error);
    return json({ ok: false, code: "SERVER" }, 500);
  }
});
