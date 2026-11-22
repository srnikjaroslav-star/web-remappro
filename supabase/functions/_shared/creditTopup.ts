import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const USER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type SessionLike = {
  id?: string;
  payment_status?: string | null;
  amount_total?: number | null;
  payment_intent?: unknown;
  metadata?: Record<string, string> | null;
};

export const isCreditTopUpSession = (session: SessionLike) =>
  session.metadata?.purpose === "credit_topup";

const paymentIntentId = (session: SessionLike) => {
  const value = session.payment_intent;
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && "id" in value) {
    const id = String((value as { id?: unknown }).id ?? "").trim();
    return id || null;
  }
  return null;
};

export const creditTopUpAmount = (session: SessionLike) => {
  const cents = Number(session.amount_total ?? 0);
  if (!Number.isFinite(cents) || cents <= 0) return 0;
  return Math.round(cents) / 100;
};

export const applyCreditTopUpSession = async (admin: SupabaseClient, session: SessionLike) => {
  const sessionId = String(session.id ?? "").trim();
  const userId = String(session.metadata?.user_id ?? "").trim();
  const amount = creditTopUpAmount(session);
  if (!sessionId.startsWith("cs_") || !USER_ID.test(userId) || amount <= 0 || amount > 100000) {
    return { ok: false as const, code: "INVALID" };
  }
  if (session.payment_status !== "paid") {
    return { ok: false as const, code: "UNPAID" };
  }

  const { data, error } = await admin.rpc("apply_credit_topup", {
    p_user_id: userId,
    p_amount: amount,
    p_stripe_session_id: sessionId,
    p_payment_intent_id: paymentIntentId(session),
  });
  if (error) {
    console.error("[credit-topup]", error.message);
    return { ok: false as const, code: "SERVER" };
  }

  const row = data as { balance?: number | string | null; credited?: boolean; user_id?: string; amount?: number } | null;
  const balance = Number(row?.balance);
  return {
    ok: true as const,
    balance: Number.isFinite(balance) ? balance : 0,
    credited: row?.credited === true,
    userId: String(row?.user_id ?? userId),
    amount: Number(row?.amount ?? amount),
  };
};
