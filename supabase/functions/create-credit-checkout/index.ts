import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { creditPackageByCredits, packageItemName, PACKAGE_ITEM_DESCRIPTION } from "../_shared/creditPackages.ts";

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

const text = (value: unknown) => String(value ?? "").trim();

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

    const body = await req.json().catch(() => ({})) as {
      credits?: unknown;
      termsConsent?: unknown;
      declarationConsent?: unknown;
    };
    const pack = creditPackageByCredits(Number(body.credits));
    if (!pack) return json({ ok: false, code: "INVALID_PACKAGE" }, 400);
    if (body.termsConsent !== true || body.declarationConsent !== true) {
      return json({ ok: false, code: "CONSENT_REQUIRED" }, 400);
    }

    const profile = await userClient
      .from("client_profiles")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle();
    const byId = profile.data ? profile : await userClient
      .from("client_profiles")
      .select("*")
      .eq("id", user.id)
      .maybeSingle();
    const row = (byId.data ?? {}) as Record<string, unknown>;
    const meta = user.user_metadata ?? {};
    const company = text(row.company_name) || text(meta.company);
    const accountName = [text(row.first_name) || text(meta.first_name), text(row.last_name) || text(meta.last_name)]
      .filter(Boolean)
      .join(" ");
    const accountEmail = text(row.email) || text(user.email);

    const origin = req.headers.get("origin") || "";
    if (!origin) return json({ ok: false, code: "SERVER" }, 500);

    const stripe = new Stripe(stripeKey);
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      customer_email: accountEmail || undefined,
      client_reference_id: user.id,
      success_url: `${origin}/#/?credit_session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/#/`,
      line_items: [{
        quantity: 1,
        price_data: {
          currency: "eur",
          unit_amount: Math.round(pack.price * 100),
          product_data: {
            name: packageItemName(pack.credits),
            description: PACKAGE_ITEM_DESCRIPTION,
          },
        },
      }],
      metadata: {
        purpose: "credit_topup",
        user_id: user.id,
        credits: String(pack.credits),
        amount: pack.price.toFixed(2),
        terms_consent: "true",
        declaration_consent: "true",
        consented_at: new Date().toISOString(),
        company: company.slice(0, 450),
        account_name: accountName.slice(0, 450),
        account_email: accountEmail.slice(0, 450),
      },
    });

    if (!session.url) return json({ ok: false, code: "SERVER" }, 500);
    return json({ ok: true, url: session.url });
  } catch (error) {
    console.error("[create-credit-checkout]", error);
    return json({ ok: false, code: "SERVER" }, 500);
  }
});
