import { serve } from "https://deno.land/std@0.190.0/http/server.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SENDER = "REMAPPRO <info@remappro.eu>";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
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
}

const handler = async (req: Request): Promise<Response> => {
  console.log("send-status-email function called");

  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  try {
    const {
      orderId,
      orderNumber,
      customerEmail,
      customerName,
      carBrand,
      carModel,
      year,
      status,
    }: StatusEmailRequest = await req.json();

    console.log(`Sending status email for order ${orderNumber} to ${customerEmail}, status: ${status}`);

    // STRICT BLOCK: If status is 'cancelled', DO NOT send any emails
    // Credit notes are handled by generate-invoice function with documentType: 'CREDIT_NOTE'
    if (status === 'cancelled') {
      console.warn('[status-email] BLOCKED: Status is cancelled - email sending is forbidden. Use generate-invoice with documentType: CREDIT_NOTE instead.');
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Email sending blocked: Order is cancelled. Credit note workflow must be used instead.',
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        }
      );
    }

    if (!customerEmail) {
      throw new Error("Customer email is required");
    }

    if (!RESEND_API_KEY) {
      console.error("RESEND_API_KEY is not configured in Supabase Edge Function secrets");
      throw new Error("RESEND_API_KEY is not configured. Please set it in Supabase Dashboard > Project Settings > Edge Functions > Secrets");
    }

    const displayOrderId = orderNumber || orderId.slice(0, 8).toUpperCase();
    const brand = carBrand || '';
    const model = carModel || '';
    const yearStr = year ? year.toString() : '';
    const vehicleInfo = `${brand} ${model} ${yearStr}`.trim();

    // Generate email content based on status
    let emailSubject = '';
    let emailContent = '';

    if (status === 'completed') {
      emailSubject = `Order ${displayOrderId} Completed - REMAPPRO`;
      emailContent = `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; border-radius: 5px; margin-bottom: 20px;">
          <tr>
            <td style="padding: 25px;">
              <p style="margin: 0; color: #00f2ff; font-size: 16px; line-height: 1.6;">
                Hello,<br><br>
                Your order <strong style="color: #00f2ff;">${displayOrderId}</strong> at REMAPPRO for vehicle <strong style="color: #00f2ff;">${vehicleInfo}</strong> has been successfully completed.<br><br>
                We look forward to your visit.
              </p>
            </td>
          </tr>
        </table>
      `;
    } else if (status === 'processing') {
      emailSubject = `Order ${displayOrderId} In Progress - REMAPPRO`;
      emailContent = `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; border-radius: 5px; margin-bottom: 20px;">
          <tr>
            <td style="padding: 25px;">
              <p style="margin: 0; color: #00f2ff; font-size: 16px; line-height: 1.6;">
                Hello,<br><br>
                Your order <strong style="color: #00f2ff;">${displayOrderId}</strong> at REMAPPRO for vehicle <strong style="color: #00f2ff;">${vehicleInfo}</strong> is now being processed.<br><br>
                We will keep you informed of the progress.
              </p>
            </td>
          </tr>
        </table>
      `;
    } else if (status === 'pending') {
      emailSubject = `Order ${displayOrderId} Received - REMAPPRO`;
      emailContent = `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; border-radius: 5px; margin-bottom: 20px;">
          <tr>
            <td style="padding: 25px;">
              <p style="margin: 0; color: #00f2ff; font-size: 16px; line-height: 1.6;">
                Hello,<br><br>
                Your order <strong style="color: #00f2ff;">${displayOrderId}</strong> at REMAPPRO for vehicle <strong style="color: #00f2ff;">${vehicleInfo}</strong> has been received.<br><br>
                Thank you for your order.
              </p>
            </td>
          </tr>
        </table>
      `;
    } else {
      emailSubject = `Order ${displayOrderId} Status Update - REMAPPRO`;
      emailContent = `
        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; border-radius: 5px; margin-bottom: 20px;">
          <tr>
            <td style="padding: 25px;">
              <p style="margin: 0; color: #00f2ff; font-size: 16px; line-height: 1.6;">
                Hello,<br><br>
                The status of your order <strong style="color: #00f2ff;">${displayOrderId}</strong> at REMAPPRO for vehicle <strong style="color: #00f2ff;">${vehicleInfo}</strong> has been updated.<br><br>
                New status: <strong style="color: #00f2ff;">${status}</strong>
              </p>
            </td>
          </tr>
        </table>
      `;
    }

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
                    ${emailContent}
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

    // Use Resend API (fetch) to send email
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: SENDER,
        to: [customerEmail],
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
        recipient: customerEmail,
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
