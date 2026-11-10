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

const adminEmail = () => (Deno.env.get("ADMIN_EMAIL") || "info@remappro.eu").trim().toLowerCase();

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

    if (body.action === "list") {
      const users: { id: string; email?: string; created_at?: string; user_metadata?: Record<string, unknown> }[] = [];
      for (let page = 1; page <= 10; page += 1) {
        const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (error) return json({ ok: false, code: "SERVER" }, 500);
        users.push(...data.users);
        if (data.users.length < 200) break;
      }

      const { data: accounts, error: accountError } = await admin
        .from("credit_accounts")
        .select("user_id, balance");
      if (accountError) return json({ ok: false, code: "SERVER" }, 500);

      const balances = new Map(
        (accounts ?? []).map((account) => [account.user_id as string, Number(account.balance)]),
      );

      const { data: profiles, error: profileError } = await admin
        .from("client_profiles")
        .select("user_id, first_name, last_name");
      if (profileError) return json({ ok: false, code: "SERVER" }, 500);
      const profileNames = new Map(
        (profiles ?? []).map((profile) => [
          profile.user_id as string,
          [profile.first_name, profile.last_name].map((part) => String(part ?? "").trim()).filter(Boolean).join(" "),
        ]),
      );

      const clients = users
        .map((user) => {
          const meta = user.user_metadata ?? {};
          const stored = profileNames.get(user.id)
            || [meta.first_name, meta.last_name].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ")
            || String(meta.full_name || meta.name || "").trim();
          const company = String(meta.company || meta.company_name || meta.firma || "").trim();
          const local = String(user.email ?? "").split("@")[0]?.trim() ?? "";
          return {
            id: user.id,
            email: user.email ?? "",
            name: stored || company || local,
            balance: balances.get(user.id) ?? 0,
            createdAt: user.created_at ?? null,
          };
        })
        .sort((a, b) => a.email.localeCompare(b.email, "sk"));

      return json({ ok: true, clients });
    }

    if (body.action === "adjust") {
      const userId = String(body.userId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        return json({ ok: false, code: "INVALID_AMOUNT" });
      }
      const amount = Math.round(Number(String(body.amount).replace(",", ".")) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
        return json({ ok: false, code: "INVALID_AMOUNT" });
      }
      const direction = body.direction === "subtract" ? "subtract" : body.direction === "add" ? "add" : "";
      if (!direction) return json({ ok: false, code: "INVALID_AMOUNT" });

      const delta = direction === "subtract" ? -amount : amount;
      const note = direction === "add" ? "Ručné pripísanie" : "Ručné odrátanie";
      const { data, error } = await admin.rpc("adjust_client_credits", {
        p_user_id: userId,
        p_delta: delta,
        p_note: note,
      });
      if (error) {
        const message = error.message ?? "";
        const code = message.includes("INSUFFICIENT_CREDITS") ? "INSUFFICIENT_CREDITS" : "SERVER";
        return json({ ok: false, code }, code === "SERVER" ? 500 : 200);
      }
      return json({ ok: true, balance: Number(data?.balance) });
    }

    return json({ ok: false, code: "INVALID_AMOUNT" });
  } catch (error) {
    console.error("[manage-clients]", error);
    return json({ ok: false, code: "SERVER" }, 500);
  }
});
