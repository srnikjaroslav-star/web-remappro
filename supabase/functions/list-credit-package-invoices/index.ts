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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 200, headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ ok: false }, 500);

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) return json({ ok: false, code: "NOT_AUTHENTICATED" }, 401);

    const admin = createClient(supabaseUrl, serviceKey);
    let query = admin
      .from("credit_topups")
      .select("stripe_session_id, user_id, invoice_number, invoice_sent_at, created_at, credits, amount, company, account_name, account_email, topup_ref, consent_summary")
      .not("invoice_number", "is", null)
      .order("created_at", { ascending: false });
    if (!isDatabaseAdmin(user)) query = query.eq("user_id", user.id);

    const { data, error } = await query;
    if (error) {
      console.error("[list-credit-package-invoices]", error.message);
      return json({ ok: false }, 500);
    }
    const rows = (data ?? []).filter((row) => String((row as { invoice_number?: string | null }).invoice_number ?? "").trim());
    return json({ ok: true, rows });
  } catch (error) {
    console.error("[list-credit-package-invoices]", error);
    return json({ ok: false }, 500);
  }
});
