import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { loadOrderMailContext, renderStatusEmail } from "../_shared/statusEmail.ts";
import { requireStaffCaller } from "../_shared/staffCaller.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SENDER = "REMAPPRO <info@remappro.eu>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-client-language",
};

interface StatusEmailRequest {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  customerName: string;
  carBrand: string;
  carModel: string;
  year: number;
  status: string;
  language?: string;
  lang?: string;
  clientUserId?: string;
  creditNoteNumber?: string;
}

const handler = async (req: Request): Promise<Response> => {
  console.log("send-status-email function called");

  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  const denied = await requireStaffCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const {
      orderId,
      orderNumber,
      customerEmail,
      customerName,
      carBrand,
      carModel,
      status,
      language,
      lang,
      clientUserId,
      creditNoteNumber,
    }: StatusEmailRequest = await req.json();

    const requestedLanguage = language || lang || req.headers.get("x-client-language") || "";
    console.log(`Sending status email for order ${orderNumber} to ${customerEmail}, status: ${status}, language: ${requestedLanguage || "lookup"}`);

    const mail = await loadOrderMailContext(orderId, customerEmail, customerName, requestedLanguage, clientUserId);
    if (!mail.recipient) {
      throw new Error("Customer email is required");
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not configured in Supabase Edge Function secrets");
      throw new Error("RESEND_API_KEY is not configured. Please set it in Supabase Dashboard > Project Settings > Edge Functions > Secrets");
    }

    const displayOrderId = orderNumber || orderId.slice(0, 8).toUpperCase();
    const vehicleInfo = `${carBrand || ''} ${carModel || ''}`.replace(/\s+/g, ' ').trim();
    const { subject: emailSubject, html: emailHtml } = renderStatusEmail({
      language: mail.lang,
      status,
      orderNumber: displayOrderId,
      customerName: mail.customerName,
      vehicle: vehicleInfo,
      ...(creditNoteNumber?.trim() ? { creditNoteNumber: creditNoteNumber.trim() } : {}),
    });
    console.log(`Status email language ${mail.lang} for ${displayOrderId}, recipient ${mail.recipient}`);

    // Use Resend API (fetch) to send email
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: SENDER,
        to: [mail.recipient],
        ...(mail.copyTo ? { bcc: [mail.copyTo] } : {}),
        subject: emailSubject,
        html: emailHtml,
      }),
    });

    const rawBody = await res.text();
    let emailResponse: any = null;
    try {
      emailResponse = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      emailResponse = { raw: rawBody };
    }

    if (!res.ok) {
      const errorDetails = {
        status: res.status,
        statusText: res.statusText,
        body: emailResponse,
        apiKeyPresent: !!RESEND_API_KEY,
        apiKeyLength: RESEND_API_KEY.length,
        sender: SENDER,
        recipient: mail.recipient,
      };
      
      console.error("Resend API error:", errorDetails);
      
      // Check for specific error types
      let errorMessage = "Resend API request failed";
      if (res.status === 401 || res.status === 403) {
        errorMessage = "RESEND_API_KEY is invalid or expired";
      } else if (res.status === 422) {
        errorMessage = "Email domain not verified in Resend or invalid sender/recipient";
      } else if (emailResponse?.message) {
        errorMessage = emailResponse.message;
      }

      return new Response(
        JSON.stringify({
          success: false,
          error: errorMessage,
          details: errorDetails,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log("Status email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending status email:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }
};

serve(handler);
