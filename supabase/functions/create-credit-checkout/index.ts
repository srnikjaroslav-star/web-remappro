import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { creditPackageByCredits, packageItemName, PACKAGE_ITEM_DESCRIPTION } from "../_shared/creditPackages.ts";
import { isDatabaseAdmin, isFunctionAdmin, operatingOpen } from "../_shared/operatingStatus.ts";

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
const TEST_CODE = "TEST100";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (!supabaseUrl || !anonKey) {
      return json({ ok: false, code: "SERVER" }, 500);
    }

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) return json({ ok: false, code: "NOT_AUTHENTICATED" }, 401);
    if (!isFunctionAdmin(user) && !await operatingOpen()) {
      return json({ ok: false, code: "OFFLINE" }, 403);
    }

    const body = await req.json().catch(() => ({})) as {
      credits?: unknown;
      termsConsent?: unknown;
      declarationConsent?: unknown;
      testCode?: unknown;
    };
    const pack = creditPackageByCredits(Number(body.credits));
    if (!pack) return json({ ok: false, code: "INVALID_PACKAGE" }, 400);
    if (body.termsConsent !== true || body.declarationConsent !== true) {
      return json({ ok: false, code: "CONSENT_REQUIRED" }, 400);
    }
    const testCode = text(body.testCode);
    if (testCode && (testCode !== TEST_CODE || !isDatabaseAdmin(user))) {
      return json({ ok: false, code: "TEST_FORBIDDEN" }, 403);
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

    if (testCode === TEST_CODE) {
      const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (!serviceKey) return json({ ok: false, code: "SERVER" }, 500);
      const admin = createClient(supabaseUrl, serviceKey);
      const sessionId = `cs_admtest${crypto.randomUUID().replace(/-/g, "")}`;
      const consentedAt = new Date().toISOString();
      const applied = await admin.rpc("apply_admin_test_credit_topup", {
        p_user_id: user.id,
        p_credits: pack.credits,
        p_session_id: sessionId,
        p_company: company,
        p_account_name: accountName,
        p_account_email: accountEmail,
        p_terms_consent: true,
        p_declaration_consent: true,
        p_consented_at: consentedAt,
      });
      if (applied.error) {
        const message = applied.error.message || "";
        console.error("[create-credit-checkout] test top-up", message);
        if (message.includes("CONSENT_REQUIRED")) return json({ ok: false, code: "CONSENT_REQUIRED" }, 400);
        if (message.includes("INVALID_AMOUNT") || message.includes("INVALID_SESSION")) {
          return json({ ok: false, code: "INVALID_PACKAGE" }, 400);
        }
        return json({ ok: false, code: "SERVER" }, 500);
      }
      const rowData = applied.data as { balance?: number | string | null; credited?: boolean } | null;
      const balance = Number(rowData?.balance);
      const { fulfillCreditPackage } = await import("../_shared/creditFulfillment.ts");
      const delivered = await fulfillCreditPackage(admin, sessionId);
      if (!delivered.ok) {
        return json({
          ok: false,
          code: "INVOICE_FAILED",
          test: true,
          balance: Number.isFinite(balance) ? balance : 0,
          credited: rowData?.credited === true,
        }, 502);
      }
      return json({
        ok: true,
        test: true,
        balance: Number.isFinite(balance) ? balance : 0,
        credited: rowData?.credited === true,
        invoiceSent: delivered.invoiceSent,
      });
    }

    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const origin = req.headers.get("origin") || "";
    if (!stripeKey || !origin) return json({ ok: false, code: "SERVER" }, 500);

    // npm: uses Deno's current Node compatibility. The esm.sh ?target=deno build
    // imports deno.land/std@0.177.1/node/process.ts, whose nextTick queue calls
    // Deno.core.runMicrotasks() and crashes the Edge isolate.
    const { default: Stripe } = await import("npm:stripe@17.7.0");
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
