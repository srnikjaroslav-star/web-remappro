import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isFunctionAdmin } from "../_shared/operatingStatus.ts";

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

const callerIsAdmin = (user: { email?: string | null; app_metadata?: Record<string, unknown> | null; user_metadata?: Record<string, unknown> | null }) => {
  if (isFunctionAdmin(user)) return true;
  const configured = (Deno.env.get("ADMIN_EMAIL") || "").trim().toLowerCase();
  const email = String(user.email ?? "").trim().toLowerCase();
  return Boolean(configured) && email === configured;
};

const orderIdOf = (value: unknown) => {
  const orderId = String(value ?? "").trim();
  return /^[0-9a-f-]{36}$/i.test(orderId) ? orderId : null;
};

const realLabel = (value: unknown) => {
  const text = String(value ?? "").trim();
  if (!text || text.includes("@")) return "";
  return text;
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
    if (userError || !caller || !callerIsAdmin(caller)) {
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

      const withCompany = await admin
        .from("client_profiles")
        .select("user_id, first_name, last_name, company_name");
      const profileResult = withCompany.error
        ? await admin.from("client_profiles").select("user_id, first_name, last_name")
        : withCompany;
      if (profileResult.error) return json({ ok: false, code: "SERVER" }, 500);
      const profileNames = new Map(
        (profileResult.data ?? []).map((profile) => {
          const row = profile as { user_id?: string; first_name?: string; last_name?: string; company_name?: string };
          const person = [row.first_name, row.last_name].map((part) => realLabel(part)).filter(Boolean).join(" ");
          const company = realLabel(row.company_name);
          return [String(row.user_id ?? ""), { person, company }] as const;
        }),
      );

      const clients = users
        .map((user) => {
          const meta = user.user_metadata ?? {};
          const storedProfile = profileNames.get(user.id);
          const metaPerson = [meta.first_name, meta.last_name].map((part) => realLabel(part)).filter(Boolean).join(" ")
            || realLabel(meta.full_name || meta.name);
          const metaCompany = realLabel(meta.company || meta.company_name || meta.firma);
          const person = storedProfile?.person || metaPerson;
          const company = storedProfile?.company || metaCompany;
          return {
            id: user.id,
            email: user.email ?? "",
            name: person,
            company,
            balance: balances.get(user.id) ?? 0,
            createdAt: user.created_at ?? null,
          };
        })
        .sort((a, b) => a.email.localeCompare(b.email, "sk"));

      return json({ ok: true, clients });
    }

    const ledgerCode = (message: string) => {
      if (message.includes("INSUFFICIENT_CREDITS")) return "INSUFFICIENT_CREDITS";
      if (message.includes("NO_ACCOUNT")) return "NO_ACCOUNT";
      if (message.includes("INVALID_ORDER")) return "INVALID_ORDER";
      if (message.includes("INVALID_AMOUNT")) return "INVALID_AMOUNT";
      return "SERVER";
    };

    if (body.action === "adjust" || body.action === "charge" || body.action === "restore") {
      const userId = String(body.userId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(userId)) {
        return json({ ok: false, code: "INVALID_AMOUNT" });
      }
      const amount = Math.round(Number(String(body.amount).replace(",", ".")) * 100) / 100;
      if (!Number.isFinite(amount) || amount <= 0 || amount > 100000) {
        return json({ ok: false, code: "INVALID_AMOUNT" });
      }
      const orderId = orderIdOf(body.orderId);
      let delta = 0;
      let note = "";
      if (body.action === "adjust") {
        const direction = body.direction === "subtract" ? "subtract" : body.direction === "add" ? "add" : "";
        if (!direction) return json({ ok: false, code: "INVALID_AMOUNT" });
        delta = direction === "subtract" ? -amount : amount;
        note = direction === "add" ? "Ručné pripísanie" : "Ručné odrátanie";
      } else if (body.action === "charge") {
        if (!orderId) return json({ ok: false, code: "INVALID_ORDER" });
        const { data, error } = await admin.rpc("charge_completion_once", {
          p_user_id: userId,
          p_amount: amount,
          p_order_id: orderId,
        });
        if (error) {
          const code = ledgerCode(error.message ?? "");
          return json({ ok: false, code }, code === "SERVER" ? 500 : 200);
        }
        return json({
          ok: true,
          balance: Number(data?.balance),
          charged: data?.charged === true,
          userId,
        });
      } else {
        if (!orderId) return json({ ok: false, code: "INVALID_ORDER" });
        delta = amount;
        note = "Vrátenie po neúspešnom dokončení";
      }

      const { data, error } = await admin.rpc("adjust_client_credits", {
        p_user_id: userId,
        p_delta: delta,
        p_note: note,
        p_order_id: orderId,
      });
      if (error) {
        const code = ledgerCode(error.message ?? "");
        return json({ ok: false, code }, code === "SERVER" ? 500 : 200);
      }
      return json({ ok: true, balance: Number(data?.balance), userId });
    }

    if (body.action === "refund-order" || body.action === "cancel-order") {
      const orderId = orderIdOf(body.orderId);
      if (!orderId) return json({ ok: false, code: "INVALID_ORDER" });

      let orderStatus = "";
      if (body.action === "cancel-order") {
        const { data: order, error: orderError } = await admin
          .from("orders")
          .select("id, status")
          .eq("id", orderId)
          .maybeSingle();
        if (orderError || !order) {
          return json({ ok: false, code: "NOT_FOUND", message: orderError?.message ?? "Order not found" });
        }
        orderStatus = String(order.status ?? "");
      }

      const { data, error } = await admin.rpc("refund_order_credits", { p_order_id: orderId });
      if (error) {
        const code = ledgerCode(error.message ?? "");
        return json({ ok: false, code, message: error.message }, code === "SERVER" ? 500 : 200);
      }

      if (body.action === "cancel-order" && orderStatus !== "cancelled") {
        const { error: updateError } = await admin
          .from("orders")
          .update({ status: "cancelled" })
          .eq("id", orderId);
        if (updateError) {
          return json({ ok: false, code: "SERVER", message: updateError.message }, 500);
        }
      }

      return json({
        ok: true,
        refunded: Number(data?.refunded) || 0,
        balance: data?.balance === null || data?.balance === undefined ? null : Number(data.balance),
        userId: data?.user_id ?? null,
      });
    }

    return json({ ok: false, code: "INVALID_AMOUNT" });
  } catch (error) {
    console.error("[manage-clients]", error);
    return json({ ok: false, code: "SERVER" }, 500);
  }
});
