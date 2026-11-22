import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { applyCreditTopUpSession, isCreditTopUpSession } from "../_shared/creditTopup.ts";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!stripeKey || !supabaseUrl || !anonKey || !serviceKey) {
      return json({ ok: false, code: "SERVER" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) return json({ ok: false, code: "NOT_AUTHENTICATED" }, 401);

    const body = await req.json().catch(() => ({}));
    const sessionId = String((body as { sessionId?: unknown }).sessionId ?? "").trim();
    if (!sessionId.startsWith("cs_")) return json({ ok: false, code: "INVALID" }, 400);

    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (!isCreditTopUpSession(session)) return json({ ok: false, code: "INVALID" }, 400);
    if (String(session.metadata?.user_id ?? "") !== user.id) {
      return json({ ok: false, code: "FORBIDDEN" }, 403);
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const applied = await applyCreditTopUpSession(admin, session);
    if (!applied.ok) {
      const status = applied.code === "UNPAID" ? 409 : applied.code === "SERVER" ? 500 : 400;
      return json({ ok: false, code: applied.code }, status);
    }

    return json({
      ok: true,
      balance: applied.balance,
      credited: applied.credited,
      amount: applied.amount,
    });
  } catch (error) {
    console.error("[confirm-credit-topup]", error);
    return json({ ok: false, code: "SERVER" }, 500);
  }
});
