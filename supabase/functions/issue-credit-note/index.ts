import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface CreditNoteRequest {
  orderId: string;
  orderNumber: string;
  customerName: string;
  customerEmail: string;
  items: Array<{ name: string; price: number; quantity: number }>;
  totalAmount: number; // Already negative
  subtotal: number; // Already negative
  taxAmount: number; // Already negative
  brand?: string;
  model?: string;
  fuelType?: string;
  year?: number;
  ecuType?: string;
  vin?: string;
  originalInvoiceNumber?: string | null;
  creditNoteNumber: string;
  refundReason: string;
  refundAmount: number; // Already negative
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const data: CreditNoteRequest = await req.json();
    console.log("[issue-credit-note] Received request:", {
      orderId: data.orderId,
      orderNumber: data.orderNumber,
      creditNoteNumber: data.creditNoteNumber,
      totalAmount: data.totalAmount,
    });

    // VALIDATION: Amount MUST be negative
    if (data.totalAmount >= 0) {
      console.error("[issue-credit-note] CRITICAL ERROR: Amount is not negative!", data.totalAmount);
      throw new Error("Credit note amount must be negative. Current amount: " + data.totalAmount);
    }

    const {
      orderId,
      orderNumber,
      customerName,
      customerEmail,
      items,
      totalAmount,
      subtotal,
      taxAmount,
      brand,
      model,
      fuelType,
      year,
      ecuType,
      vin,
      originalInvoiceNumber,
      creditNoteNumber,
      refundReason,
      refundAmount,
    } = data;

    // Import jsPDF
    const { jsPDF } = await import("https://esm.sh/jspdf@2.5.1");

    // Generate PDF
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const rightEdge = pageWidth - margin;

    // Colors
    const primaryColor = [0, 242, 255]; // #00f2ff
    const textBlack = [30, 30, 30];
    const textGray = [100, 100, 100];

    // Header
    doc.setFillColor(...primaryColor);
    doc.rect(0, 0, pageWidth, 50, "F");

    // Logo area (left)
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.text("REMAPPRO", margin, 30);

    // Title: DOBROPIS (OPRAVNÝ DOKLAD)
    doc.setTextColor(...textBlack);
    doc.setFontSize(32);
    doc.setFont("helvetica", "bold");
    doc.text("DOBROPIS (OPRAVNÝ DOKLAD)", rightEdge, 30, { align: "right" });

    // Credit Note number
    doc.setTextColor(...textGray);
    doc.setFontSize(12);
    doc.setFont("helvetica", "normal");
    doc.text(`Credit Note No.: ${creditNoteNumber}`, rightEdge, 40, { align: "right" });

    // Order number
    doc.setFontSize(10);
    doc.text(`Order: ${orderNumber}`, rightEdge, 47, { align: "right" });

    // Date
    const currentDate = new Date().toLocaleDateString('sk-SK', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    doc.text(`Dátum vystavenia dobropisu: ${currentDate}`, rightEdge, 54, { align: "right" });

    // Customer info
    let yPos = margin + 60;
    doc.setTextColor(...textBlack);
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Bill To:", margin, yPos);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    yPos += 7;
    doc.text(customerName, margin, yPos);
    yPos += 5;
    doc.text(customerEmail, margin, yPos);

    // Items table
    yPos = margin + 100;
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text("Item", margin, yPos);
    doc.text("Price", rightEdge - 60, yPos, { align: "right" });
    doc.text("Total", rightEdge, yPos, { align: "right" });

    yPos += 8;
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, yPos, rightEdge, yPos);

    // Items
    yPos += 8;
    doc.setFont("helvetica", "normal");
    items.forEach((item) => {
      const itemName = item.name;
      const unitPrice = item.price; // Already negative
      const quantity = item.quantity || 1;
      const totalPrice = unitPrice * quantity; // Already negative

      doc.text(itemName, margin, yPos);
      doc.text(`-€${Math.abs(unitPrice).toFixed(2)}`, rightEdge - 60, yPos, { align: "right" });
      doc.text(`-€${Math.abs(totalPrice).toFixed(2)}`, rightEdge, yPos, { align: "right" });
      yPos += 8;
    });

    // Summary
    yPos += 10;
    doc.line(margin, yPos, rightEdge, yPos);
    yPos += 8;

    const summaryWidth = 80;
    const summaryX = rightEdge - summaryWidth;

    // Base Amount (HARDCODE MINUS)
    doc.setTextColor(...textGray);
    doc.setFontSize(10);
    doc.text("Base Amount:", summaryX, yPos, { align: "right" });
    doc.setTextColor(...textBlack);
    doc.setFontSize(11);
    doc.text(`-€${Math.abs(subtotal).toFixed(2)}`, rightEdge, yPos + 6, { align: "right" });

    yPos += 12;

    // VAT (HARDCODE MINUS)
    doc.setTextColor(...textGray);
    doc.setFontSize(10);
    doc.text("VAT (20%):", summaryX, yPos, { align: "right" });
    doc.setTextColor(...textBlack);
    doc.setFontSize(11);
    doc.text(`-€${Math.abs(taxAmount).toFixed(2)}`, rightEdge, yPos + 6, { align: "right" });

    yPos += 12;

    // Total (HARDCODE MINUS)
    doc.setFontSize(12);
    doc.setFont("helvetica", "bold");
    doc.text("Total Amount:", summaryX, yPos, { align: "right" });
    doc.setFontSize(14);
    doc.setTextColor(255, 68, 68); // Red for negative
    doc.text(`-€${Math.abs(totalAmount).toFixed(2)}`, rightEdge, yPos + 6, { align: "right" });

    // Status: REFUNDED / CANCELLED
    yPos = pageHeight - 60;
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(255, 68, 68); // Red
    doc.text("REFUNDED / CANCELLED", pageWidth / 2, yPos, { align: "center" });

    // Footer
    yPos = pageHeight - 30;
    doc.setFontSize(8);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...textGray);
    doc.text("REMAPPRO - Janka Kráľa 29, Veľký Krtíš, Slovakia", pageWidth / 2, yPos, { align: "center" });
    doc.text("IČO: 12345678 | DIČ: SK1234567890", pageWidth / 2, yPos + 5, { align: "center" });

    // Generate PDF base64
    const pdfBase64 = doc.output("base64");

    // Upload to Storage
    const fileName = `credit-note-${orderId}.pdf`;
    const bucketName = 'credit-notes';
    const pdfBuffer = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));

    const { error: uploadError } = await supabase.storage
      .from(bucketName)
      .upload(fileName, pdfBuffer, {
        contentType: 'application/pdf',
        upsert: true,
      });

    if (uploadError) {
      console.error("[issue-credit-note] PDF upload error:", uploadError);
      throw new Error(`Failed to upload credit note PDF: ${uploadError.message}`);
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    const creditNoteUrl = urlData?.publicUrl || null;
    console.log("[issue-credit-note] Credit note PDF URL:", creditNoteUrl);

    if (!creditNoteUrl) {
      throw new Error("Failed to get public URL for credit note PDF");
    }

    // Save to database
    const { error: dbError } = await supabase
      .from('orders')
      .update({
        credit_note_number: creditNoteNumber,
        credit_note_pdf: creditNoteUrl,
        refund_amount: refundAmount,
        refund_reason: refundReason,
      })
      .eq('id', orderId);

    if (dbError) {
      console.error("[issue-credit-note] Database update error:", dbError);
      throw new Error(`Failed to save credit note to database: ${dbError.message}`);
    }

    // Send email with NEW refund template
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SENDER = Deno.env.get("RESEND_SENDER_EMAIL") || "REMAPPRO <noreply@remappro.eu>";
    const BCC_EMAIL = Deno.env.get("RESEND_BCC_EMAIL") || "";
    const SITE_URL = Deno.env.get("SITE_URL") || "https://remappro.eu";

    if (RESEND_API_KEY) {
      try {
        const emailHtml = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #0a0e0f;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0e0f; padding: 40px 20px;">
            <tr>
              <td align="center">
                <table width="600" cellpadding="0" cellspacing="0" style="background-color: #1a1f21; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 20px rgba(0, 0, 0, 0.3);">
                  <!-- Header -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #00f2ff 0%, #0099cc 100%); padding: 40px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 32px; font-weight: 700; letter-spacing: 2px;">
                        REFUND / VRÁTENIE PEŇAZÍ
                      </h1>
                      <p style="margin: 12px 0 0; color: #ffffff; font-size: 14px; font-weight: 600;">
                        Credit Note ${creditNoteNumber}
                      </p>
                    </td>
                  </tr>

                  <!-- Main Content -->
                  <tr>
                    <td style="padding: 50px 40px;">
                      <h2 style="margin: 0 0 25px; color: #e5e5e5; font-size: 28px; font-weight: 700; line-height: 1.2;">
                        Refund Issued
                      </h2>
                      <p style="margin: 0 0 20px; color: #e5e5e5; font-size: 16px; line-height: 1.6;">
                        Dobrý deň,
                      </p>
                      <p style="margin: 0 0 20px; color: #e5e5e5; font-size: 16px; line-height: 1.6;">
                        Vaša objednávka bola stornovaná. V prílohe Vám zasielame dobropis. Suma <strong style="color: #ff4444;">-${Math.abs(totalAmount).toFixed(2)} €</strong> Vám bude vrátená na Váš účet.
                      </p>
                      <p style="margin: 0 0 20px; color: #e5e5e5; font-size: 16px; line-height: 1.6;">
                        Dobropis ${creditNoteNumber} k objednávke ${orderNumber}.
                      </p>
                      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; border-radius: 5px; margin: 20px 0;">
                        <tr>
                          <td style="padding: 15px;">
                            <p style="margin: 0 0 8px; color: #888888; font-size: 12px; text-transform: uppercase;">Položka</p>
                            <p style="margin: 0 0 15px; color: #e5e5e5; font-size: 14px;">Refund of Order #${orderNumber}</p>
                            <p style="margin: 0 0 8px; color: #888888; font-size: 12px; text-transform: uppercase;">Celková suma</p>
                            <p style="margin: 0; color: #ff4444; font-size: 18px; font-weight: 600;">-${Math.abs(totalAmount).toFixed(2)} €</p>
                          </td>
                        </tr>
                      </table>
                      <p style="margin: 0 0 30px; color: #888888; font-size: 14px; line-height: 1.6; font-style: italic;">
                        Tento dokument (${creditNoteNumber}) ruší právny účinok faktúry ${originalInvoiceNumber || 'N/A'}.
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #0f1415; padding: 30px 40px; text-align: center; border-top: 1px solid #1a2e31;">
                      <p style="margin: 0; color: #888888; font-size: 12px; line-height: 1.6;">
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

        const emailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: SENDER,
            to: [customerEmail],
            bcc: [BCC_EMAIL],
            subject: `Dobropis / Credit Note ${creditNoteNumber} k objednávke ${orderNumber}`,
            html: emailHtml,
            attachments: [
              {
                filename: `Credit-Note-${creditNoteNumber}.pdf`,
                content: pdfBase64,
              },
            ],
          }),
        });

        const emailResult = await emailRes.text();
        console.log("[issue-credit-note] Email response:", emailRes.status, emailResult);

        if (!emailRes.ok) {
          console.warn("[issue-credit-note] Email sending failed, but PDF is saved");
        } else {
          console.log("[issue-credit-note] Email sent successfully");
        }
      } catch (resendError: any) {
        console.error("[issue-credit-note] Resend error (non-fatal):", resendError);
        console.log("[issue-credit-note] Credit note PDF is saved, function will return success");
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: 'Credit note issued successfully',
        creditNoteNumber,
        creditNoteUrl 
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );

  } catch (error: any) {
    console.error("[issue-credit-note] Error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 500,
      }
    );
  }
});
