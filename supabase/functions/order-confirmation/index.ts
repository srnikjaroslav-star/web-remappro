import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { requireStaffCaller } from "../_shared/staffCaller.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SENDER = "REMAPPRO <info@remappro.eu>";
const SITE_URL = Deno.env.get("SITE_URL") || "https://remappro.eu";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface OrderConfirmationRequest {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  customerName: string;
  totalAmount: number;
  brand?: string;
  model?: string;
  fuelType?: string;
  year?: string | number;
  vin?: string;
  createdAt: string;
}

const handler = async (req: Request): Promise<Response> => {
  console.log("LOG: send-order-confirmation prijala požiadavku");

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ success: false, error: "Method not allowed" }),
      {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      }
    );
  }

  const denied = await requireStaffCaller(req, corsHeaders);
  if (denied) return denied;

  try {
    const {
      orderId,
      orderNumber,
      customerEmail,
      customerName,
      totalAmount,
      brand,
      model,
      fuelType,
      year,
      vin,
      createdAt,
    }: OrderConfirmationRequest = await req.json();

    console.log(`Sending order confirmation email for order ${orderNumber} to ${customerEmail}`);

    if (!customerEmail) {
      throw new Error("Customer email is required");
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not configured in Supabase Edge Function secrets");
      throw new Error("RESEND_API_KEY is not configured. Please set it in Supabase Dashboard > Project Settings > Edge Functions > Secrets");
    }

    const displayOrderId = orderNumber || orderId.slice(0, 8).toUpperCase();
    const formattedDate = new Date(createdAt).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });

    // Tracking URL with order ID and email
    const trackingUrl = `${SITE_URL}/track?id=${encodeURIComponent(displayOrderId)}&email=${encodeURIComponent(customerEmail)}`;

    const emailHtml = `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
      </head>
      <body style="margin: 0; padding: 20px; background-color: #0a0a0a; color: #ffffff; font-family: sans-serif;">
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a;">
          <tr>
            <td align="center">
              <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #111111; border: 1px solid #333333; padding: 40px; border-radius: 8px;">
                <!-- Header with Logo -->
                <tr>
                  <td style="padding: 50px 40px 40px; text-align: center; border-bottom: 2px solid #00f2ff;">
                    <h1 style="margin: 0; font-size: 36px; font-weight: 800; letter-spacing: 3px;">
                      <span style="color: #ffffff;">REMAP</span><span style="color: #00f2ff;">PRO</span>
                    </h1>
                    <p style="margin: 12px 0 0; color: #888888; font-size: 12px; text-transform: uppercase; letter-spacing: 2px;">
                      Professional ECU Tuning
                    </p>
                  </td>
                </tr>
                
                <!-- Main Content -->
                <tr>
                  <td style="padding: 50px 40px;">
                    <h2 style="margin: 0 0 25px; color: #e5e5e5; font-size: 28px; font-weight: 700; line-height: 1.2;">
                      Thank you for your purchase!
                    </h2>
                    
                    <p style="margin: 0 0 35px; color: #e5e5e5; font-size: 16px; line-height: 1.7;">
                      Our technicians are now starting to process your files.
                    </p>
                    
                    <!-- Order Details -->
                    <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; margin-bottom: 35px; border-radius: 5px;">
                      <tr>
                        <td style="padding: 25px;">
                          <div style="padding: 10px 0;">
                            <p style="margin: 0; color: #888888; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Order ID</p>
                            <p style="margin: 6px 0 0; color: #00f2ff; font-size: 20px; font-weight: 700; font-family: 'Courier New', monospace; letter-spacing: 1px;">${displayOrderId}</p>
                          </div>
                          <div style="padding: 10px 0;">
                            <p style="margin: 0; color: #888888; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Date</p>
                            <p style="margin: 6px 0 0; color: #00f2ff; font-size: 16px; font-weight: 500;">${formattedDate}</p>
                          </div>
                          <div style="padding: 10px 0;">
                            <p style="margin: 0; color: #888888; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Customer Name</p>
                            <p style="margin: 6px 0 0; color: #00f2ff; font-size: 16px; font-weight: 500;">${customerName || 'N/A'}</p>
                          </div>
                          <div style="padding: 10px 0;">
                            <p style="margin: 0; color: #888888; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; font-weight: 600;">Price</p>
                            <p style="margin: 6px 0 0; color: #00f2ff; font-size: 22px; font-weight: 700;">€${totalAmount.toFixed(2)}</p>
                          </div>
                        </td>
                      </tr>
                    </table>
                    
                    <!-- Tracking Button -->
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" style="padding: 25px 0;">
                          <a href="${trackingUrl}" 
                             style="background-color: #00f2ff; color: #000000; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block;">
                            VIEW LIVE TRACKING
                          </a>
                        </td>
                      </tr>
                    </table>
                    
                    <p style="margin: 35px 0 0; color: #888888; font-size: 14px; line-height: 1.7; text-align: center;">
                      You can track your order status in real-time by clicking the button above or visiting our tracking page.
                    </p>
                  </td>
                </tr>
                
                <!-- Footer -->
                <tr>
                  <td style="margin-top: 30px; border-top: 1px solid #333333; padding-top: 20px; text-align: center;">
                    <p style="margin: 0 0 8px; color: #666666; font-size: 12px; line-height: 1.6;">
                      REMAPPRO | Janka Krala 29, 990 01 Velky Krtis, Slovakia
                    </p>
                    <p style="margin: 0 0 15px; color: #666666; font-size: 12px; line-height: 1.6;">
                      Reg. No.: 41281471 | Tax ID: 1041196607 | info@remappro.eu
                    </p>
                    <p style="margin: 0; color: #666666; font-size: 12px;">
                      © ${new Date().getFullYear()} REMAPPRO. All rights reserved.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
      </html>
    `;

    // Use Resend API to send email
    console.log("Sending email via Resend API:", {
      from: SENDER,
      to: customerEmail,
      subject: `Order Confirmation - ${displayOrderId}`,
      apiKeyPresent: !!RESEND_API_KEY,
      apiKeyLength: RESEND_API_KEY.length,
    });

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: SENDER,
        to: [customerEmail],
        subject: `Order Confirmation - ${displayOrderId}`,
        html: emailHtml,
      }),
    });

    const rawBody = await res.text();
    console.log("Resend Response:", rawBody);
    
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
        recipient: customerEmail,
      };
      
      console.error("Resend API error:", errorDetails);
      
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

    console.log("Order confirmation email sent successfully:", emailResponse);

    return new Response(JSON.stringify({ success: true, data: emailResponse }), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (error: any) {
    console.error("Error sending order confirmation email:", error);
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
