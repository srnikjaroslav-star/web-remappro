import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { mailLogoAttachment } from "../_shared/clientNotice.ts";
import { loadOrderMailContext, portalOrderUrl, renderStatusEmail } from "../_shared/statusEmail.ts";
import { requireStaffCaller } from "../_shared/staffCaller.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SENDER = "REMAPPRO <info@remappro.eu>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CompletionEmailRequest {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  customerName: string;
  carBrand: string;
  carModel: string;
  year: number;
}

const handler = async (req: Request): Promise<Response> => {
  console.log("send-completion-email function called");

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
      language,
      clientUserId,
    }: CompletionEmailRequest & { language?: string; clientUserId?: string } = await req.json();

    console.log(`Sending completion email for order ${orderNumber} to ${customerEmail}, language: ${language || "lookup"}`);

    const mail = await loadOrderMailContext(orderId, customerEmail, customerName, language, clientUserId);
    if (!mail.recipient) {
      throw new Error("Customer email is required");
    }

    if (!RESEND_API_KEY) {
      throw new Error("RESEND_API_KEY is not configured");
    }

    const displayOrderId = orderNumber || orderId.slice(0, 8).toUpperCase();
    const vehicleInfo = `${carBrand || ''} ${carModel || ''}`.replace(/\s+/g, ' ').trim();
    const { subject, html: emailHtml } = renderStatusEmail({
      language: mail.lang,
      status: "completed",
      orderNumber: displayOrderId,
      customerName: mail.customerName,
      vehicle: vehicleInfo,
      downloadUrl: portalOrderUrl(displayOrderId),
    });

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
        subject,
        html: emailHtml,
        attachments: [mailLogoAttachment()],
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
      console.error("Resend API error:", {
        status: res.status,
        statusText: res.statusText,
        body: emailResponse,
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: "Resend API request failed",
          resend: {
            status: res.status,
            statusText: res.statusText,
            body: emailResponse,
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    console.log("Completion email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending completion email:", error);
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
