import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CATALOG_URL = "https://huswisewblkfcozdgvrq.supabase.co";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const adminEmail = () => (Deno.env.get("ADMIN_EMAIL") || "info@remappro.eu").trim().toLowerCase();

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

const cleanText = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

const readPrice = (value: unknown) => {
  const price = Math.round(Number(String(value ?? "").replace(",", ".")) * 100) / 100;
  if (!Number.isFinite(price) || price < 0 || price > 100000) return null;
  return price;
};

const catalogRequest = async (path: string, method: string, body?: unknown) => {
  const key = Deno.env.get("CATALOG_SERVICE_ROLE_KEY") ?? "";
  if (!key) return { ok: false, payload: null };
  const response = await fetch(`${CATALOG_URL}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      "User-Agent": "Deno/2.1.4 (SupabaseEdgeFunction)",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }
  return { ok: response.ok, payload };
};

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
    const caller = userData.user;
    if (userError || !caller?.email || caller.email.toLowerCase() !== adminEmail()) {
      return json({ ok: false, code: "FORBIDDEN" });
    }

    const body = await req.json().catch(() => ({}));
    const admin = createClient(supabaseUrl, serviceKey);
    const name = cleanText(body.name, 120);
    const category = cleanText(body.category, 80);
    const description = cleanText(body.description, 500);
    const price = readPrice(body.price);

    if (body.action === "create" || body.action === "update") {
      if (!name || !category || price === null) {
        return json({ ok: false, code: "INVALID" });
      }
    }

    if (body.action === "create") {
      const created = await catalogRequest("services", "POST", { name, category, price });
      const row = Array.isArray(created.payload) ? created.payload[0] : null;
      if (!created.ok || !row?.id) return json({ ok: false, code: "SERVER" }, 502);
      const { error } = await admin.from("service_details").upsert({
        service_id: row.id,
        description,
        updated_at: new Date().toISOString(),
      });
      if (error) return json({ ok: false, code: "SERVER" }, 500);
      return json({ ok: true, id: row.id });
    }

    if (body.action === "update") {
      if (!isUuid(body.id)) return json({ ok: false, code: "INVALID" });
      const updated = await catalogRequest(`services?id=eq.${body.id}`, "PATCH", { name, category, price });
      const row = Array.isArray(updated.payload) ? updated.payload[0] : null;
      if (!updated.ok || !row?.id) return json({ ok: false, code: "NOT_FOUND" });
      const { error } = await admin.from("service_details").upsert({
        service_id: body.id,
        description,
        updated_at: new Date().toISOString(),
      });
      if (error) return json({ ok: false, code: "SERVER" }, 500);
      return json({ ok: true, id: body.id });
    }

    if (body.action === "delete") {
      if (!isUuid(body.id)) return json({ ok: false, code: "INVALID" });
      const removed = await catalogRequest(`services?id=eq.${body.id}`, "DELETE");
      const row = Array.isArray(removed.payload) ? removed.payload[0] : null;
      if (!removed.ok || !row?.id) return json({ ok: false, code: "NOT_FOUND" });
      await admin.from("service_details").delete().eq("service_id", body.id);
      return json({ ok: true });
    }

    return json({ ok: false, code: "INVALID" });
  } catch (error) {
    console.error("[manage-services]", error);
    return json({ ok: false, code: "SERVER" }, 500);
  }
});
