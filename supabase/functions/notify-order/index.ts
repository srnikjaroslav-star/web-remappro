import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { dispatchTelegram, notifyOrderById } from "../_shared/telegramOrder.ts";

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

const ORDER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const loadOwnedOrder = async (
  admin: { from: (table: string) => any },
  orderId: string,
  userId: string,
  userEmail: string,
) => {
  const selects = [
    "id, user_id, customer_email, created_at",
    "id, user_id, created_at",
    "id, user_id",
  ];
  for (const columns of selects) {
    const { data, error } = await admin.from("orders").select(columns).eq("id", orderId).maybeSingle();
    if (error || !data) continue;
    const ownerId = String(data.user_id ?? "");
    const email = String(data.customer_email ?? "").trim().toLowerCase();
    const caller = userEmail.trim().toLowerCase();
    const owns = ownerId === userId || (email.length > 0 && email === caller);
    if (!owns) {
      console.error("[notify-order] caller does not own the order");
      return null;
    }
    const createdAt = Date.parse(String(data.created_at ?? ""));
    if (Number.isFinite(createdAt) && Date.now() - createdAt > 30 * 60 * 1000) {
      console.error("[notify-order] order is outside the notification window");
      return null;
    }
    return data;
  }
  console.error("[notify-order] order was not found");
  return null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  if (req.method !== "POST") return json({ ok: false }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !anonKey || !serviceKey) return json({ ok: true });

    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    });
    const { data: userData, error: userError } = await userClient.auth.getUser();
    const user = userData.user;
    if (userError || !user) return json({ ok: false, code: "NOT_AUTHENTICATED" }, 401);

    const body = await req.json().catch(() => ({}));
    const orderId = String((body as { orderId?: unknown })?.orderId ?? "").trim();
    if (!ORDER_ID.test(orderId)) return json({ ok: false });

    const admin = createClient(supabaseUrl, serviceKey);
    const owned = await loadOwnedOrder(admin, orderId, user.id, user.email ?? "");
    if (!owned) return json({ ok: false });

    dispatchTelegram(notifyOrderById(admin, orderId));
    return json({ ok: true });
  } catch (error) {
    console.error("[notify-order]", error instanceof Error ? error.message : error);
    return json({ ok: true });
  }
});
