import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isFunctionAdmin } from "./operatingStatus.ts";

// The anon key is a valid project JWT, so the gateway check alone does not
// prove who called the function. Staff actions need a user session or the
// service role used by another Edge function.

export const requireStaffCaller = async (
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<Response | null> => {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (serviceKey && token === serviceKey) return null;

  const deny = (status: number) =>
    new Response(JSON.stringify({ success: false, error: "Not authorized" }), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey || !token || token === anonKey) return deny(401);

  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: header } },
  });
  const { data, error } = await client.auth.getUser();
  const user = data.user;
  if (error || !user) return deny(401);

  const configured = (Deno.env.get("ADMIN_EMAIL") || "").trim().toLowerCase();
  const email = String(user.email ?? "").trim().toLowerCase();
  const admin = isFunctionAdmin(user) || (configured.length > 0 && email === configured);
  if (!admin) return deny(403);
  return null;
};
