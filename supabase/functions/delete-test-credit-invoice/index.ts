import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isDatabaseAdmin } from "../_shared/operatingStatus.ts";

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
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ ok: false, code: "SERVER" }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) return json({ ok: false, code: "NOT_AUTHENTICATED" }, 401);
    if (!isDatabaseAdmin(user)) return json({ ok: false, code: "FORBIDDEN" }, 403);

    const body = await req.json().catch(() => ({})) as { stripeSessionId?: unknown };
    const sessionId = text(body.stripeSessionId);
    if (!sessionId) return json({ ok: false, code: "INVALID_SESSION" }, 400);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data, error } = await admin.rpc("delete_test_credit_package_invoice", {
      p_stripe_session_id: sessionId,
    });
    if (error) {
      const message = error.message || "DELETE_FAILED";
      const code = message.includes("NOT_TEST_DOCUMENT") ? "NOT_TEST_DOCUMENT" : "DELETE_FAILED";
      return json({ ok: false, code }, code === "NOT_TEST_DOCUMENT" ? 403 : 400);
    }

    const result = (data ?? {}) as { deleted?: boolean; reason?: string; invoice_number?: string };
    if (!result.deleted) return json({ ok: false, code: result.reason || "missing" }, 404);
    return json({ ok: true, invoiceNumber: result.invoice_number ?? "" });
  } catch (error) {
    console.error("[delete-test-credit-invoice]", error);
    return json({ ok: false, code: "SERVER" }, 500);
  }
});
