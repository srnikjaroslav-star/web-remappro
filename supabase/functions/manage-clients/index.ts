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

    if (body.action === "cancel-order") {
      const orderId = String(body.orderId ?? "");
      if (!/^[0-9a-f-]{36}$/i.test(orderId)) {
        return json({ ok: false, code: "INVALID_ORDER" });
      }

      const { data: order, error: orderError } = await admin
        .from("orders")
        .select("id, status")
        .eq("id", orderId)
        .maybeSingle();
      if (orderError || !order) {
        return json({ ok: false, code: "NOT_FOUND", message: orderError?.message ?? "Order not found" });
      }

      const { data: transactions, error: transactionError } = await admin
        .from("credit_transactions")
        .select("user_id, amount")
        .eq("order_id", orderId);
      if (transactionError) {
        return json({ ok: false, code: "SERVER", message: transactionError.message }, 500);
      }

      const rows = transactions ?? [];
      let net = Math.round(rows.reduce((sum, row) => sum + Number(row.amount), 0) * 100) / 100;
      let refundUserId = String(rows.find((row) => row.user_id)?.user_id ?? "");

      if (rows.length === 0 && order.status !== "cancelled") {
        const { data: invoiceRows, error: invoiceError } = await admin
          .from("invoices")
          .select("user_id, amount, payment_method")
          .eq("order_id", orderId);
        if (invoiceError) {
          return json({ ok: false, code: "SERVER", message: invoiceError.message }, 500);
        }
        const creditInvoices = (invoiceRows ?? []).filter((row) => row.payment_method === "credits" && row.user_id);
        const invoiceTotal = Math.round(
          creditInvoices.reduce((sum, row) => sum + Number(row.amount), 0) * 100,
        ) / 100;
        if (invoiceTotal > 0) {
          net = -invoiceTotal;
          refundUserId = String(creditInvoices[0].user_id);
        }
      }

      let refunded = 0;

      if (net < 0) {
        const userId = refundUserId;
        if (!/^[0-9a-f-]{36}$/i.test(userId)) {
          return json({ ok: false, code: "NO_ACCOUNT", message: "Credit payment has no client account." });
        }
        refunded = Math.round(-net * 100) / 100;

        const { data: account, error: accountError } = await admin
          .from("credit_accounts")
          .select("balance")
          .eq("user_id", userId)
          .maybeSingle();
        if (accountError || !account) {
          return json({ ok: false, code: "NO_ACCOUNT", message: accountError?.message ?? "Credit account not found" });
        }

        const nextBalance = Math.round((Number(account.balance) + refunded) * 100) / 100;
        const { error: balanceError } = await admin
          .from("credit_accounts")
          .update({ balance: nextBalance, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
        if (balanceError) {
          return json({ ok: false, code: "SERVER", message: balanceError.message }, 500);
        }

        const { error: insertError } = await admin.from("credit_transactions").insert({
          user_id: userId,
          amount: refunded,
          order_id: orderId,
          note: "Vrátenie za zrušenú objednávku",
        });
        if (insertError) {
          await admin
            .from("credit_accounts")
            .update({ balance: Number(account.balance), updated_at: new Date().toISOString() })
            .eq("user_id", userId);
          return json({ ok: false, code: "SERVER", message: insertError.message }, 500);
        }
      }

      if (order.status !== "cancelled") {
        const { error: updateError } = await admin
          .from("orders")
          .update({ status: "cancelled" })
          .eq("id", orderId);
        if (updateError) {
          return json({ ok: false, code: "SERVER", message: updateError.message }, 500);
        }
      }

      return json({ ok: true, refunded });
    }

    return json({ ok: false, code: "INVALID_AMOUNT" });
  } catch (error) {
    console.error("[manage-clients]", error);
    return json({ ok: false, code: "SERVER" }, 500);
  }
});
