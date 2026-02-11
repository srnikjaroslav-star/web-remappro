import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { jsPDF } from "https://esm.sh/jspdf@2.5.1";

// CORS Headers - defined at the top, before everything else
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
// Fix odosielateľa: Použi testovací sender ak nemáš overenú doménu
const SENDER = Deno.env.get("RESEND_SENDER_EMAIL") || "onboarding@resend.dev";
const BCC_EMAIL = Deno.env.get("RESEND_BCC_EMAIL") || "";

interface CreditNoteRequest {
  orderId: string;
  orderNumber: string;
  customerEmail: string;
  customerName?: string;
  totalAmount: number;
  taxAmount?: number;
  refundReason?: string;
}

serve(async (req) => {
  // 1. TOTO JE KRITICKÉ: Musíš odpovedať na OPTIONS request
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  // Totálna ochrana: Celý vnútrajšok Deno.serve musí byť v try-catch
  try {
    console.log("Generate credit note function called");
    console.log("Request method:", req.method);

    const payload: CreditNoteRequest = await req.json();
    // Overenie dát: Na začiatok funkcie pridaj console.log
    console.log("Dáta prijaté na backend:", JSON.stringify(payload));
    console.log("[generate-credit-note] Received request:", JSON.stringify(payload, null, 2));

    const { orderId, orderNumber, customerEmail, customerName, totalAmount, taxAmount, refundReason } = payload;

    // Validate required fields
    if (!orderId || !customerEmail || !totalAmount) {
      throw new Error("Missing required fields: orderId, customerEmail, and totalAmount are required");
    }

    // Logika Dobropisu: Natvrdo nastav multiplier = -1
    const multiplier = -1;
    console.log("[generate-credit-note] Using multiplier:", multiplier);

    // Calculate amounts - všetky musia byť záporné
    const rawTotal = typeof totalAmount === 'string' ? parseFloat(totalAmount) : (totalAmount || 0);
    const rawTax = typeof taxAmount === 'string' ? parseFloat(taxAmount) : (taxAmount || 0);

    let finalTotal: number;
    let finalTax: number;
    let finalSubtotal: number;

    if (Math.abs(rawTotal) > 0) {
      // Pre dobropis: suma / 1.20 = základ dane, suma - základ dane = DPH
      const absTotal = Math.abs(rawTotal);
      finalSubtotal = (absTotal / 1.20) * multiplier;
      finalTax = (absTotal - (absTotal / 1.20)) * multiplier;
      finalTotal = absTotal * multiplier;
    } else {
      throw new Error("Total amount must be greater than 0");
    }

    console.log("[generate-credit-note] Calculated amounts (all negative):", {
      finalTotal: finalTotal.toFixed(2),
      finalTax: finalTax.toFixed(2),
      finalSubtotal: finalSubtotal.toFixed(2),
    });

    // Generate PDF - PDF Dokument: Nadpis musí byť "OPRAVNÝ DOKLAD / DOBROPIS"
    // Reset číslovania: Prvá nová objednávka začína číslom 20260001
    const safeOrderNumber = orderNumber || orderId.slice(0, 8).toUpperCase();
    
    // Generate credit note number starting from 20260001
    const numericPart = safeOrderNumber.match(/\d+/)?.[0] || '0001';
    const baseNumber = parseInt(numericPart, 10);
    const sequentialNumber = baseNumber > 0 ? baseNumber : 20260001;
    const creditNoteNumber = `CN-${sequentialNumber}`;
    
    const doc = new jsPDF();
    const invoiceTitle = "OPRAVNÝ DOKLAD / DOBROPIS";

    doc.setFontSize(20);
    doc.setTextColor(255, 68, 68); // Red color for credit note
    doc.text(invoiceTitle, 20, 20);
    doc.setTextColor(0, 0, 0); // Black for rest
    doc.setFontSize(12);
    doc.text(`Číslo: ${creditNoteNumber}`, 20, 35);
    doc.text(`Zákazník: ${customerName || 'Customer'}`, 20, 45);
    doc.text(`Email: ${customerEmail}`, 20, 55);
    doc.text(`Celková suma: ${finalTotal.toFixed(2)} €`, 20, 65);
    doc.text(`Základ dane: ${finalSubtotal.toFixed(2)} €`, 20, 75);
    doc.text(`DPH: ${finalTax.toFixed(2)} €`, 20, 85);
    if (refundReason) {
      doc.text(`Dôvod: ${refundReason}`, 20, 95);
    }

    // Kontrola PDF knižnice: Uisti sa, že PDF je správne vygenerovaný
    let pdfBase64: string;
    try {
      const dataUri = doc.output('datauristring');
      if (!dataUri || !dataUri.includes(',')) {
        throw new Error("PDF generation failed - invalid data URI");
      }
      pdfBase64 = dataUri.split(',')[1];
      if (!pdfBase64) {
        throw new Error("PDF generation failed - empty base64 content");
      }
      console.log("[generate-credit-note] PDF generated successfully, size:", pdfBase64.length);
    } catch (pdfError: any) {
      console.error("[generate-credit-note] PDF generation error:", pdfError);
      throw new Error(`PDF generation failed: ${pdfError.message}`);
    }

    // Bulletproof Storage: Uprav kód tak, aby pri zlyhaní zápisu do Storage nezrúbal celú funkciu, ale aspoň odoslal e-mail
    let pdfUrl: string | null = null;
    let storageError: any = null;
    
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      if (!supabaseUrl || !supabaseKey) {
        console.warn("[generate-credit-note] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not configured - skipping Storage upload");
      } else {
        const supabase = createClient(supabaseUrl, supabaseKey);
        console.log("[generate-credit-note] Supabase client created successfully");

        const fileName = `CN-${orderId}.pdf`;
        const filePath = `credit-notes/${fileName}`;
        
        console.log("[generate-credit-note] Uploading PDF to Storage:", filePath);

        // Convert base64 to Uint8Array
        const pdfBytes = Uint8Array.from(atob(pdfBase64), c => c.charCodeAt(0));

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('credit-notes')
          .upload(filePath, pdfBytes, {
            contentType: 'application/pdf',
            upsert: true,
          });

        if (uploadError) {
          console.error("[generate-credit-note] Storage upload error (non-fatal):", uploadError);
          storageError = uploadError;
          // Continue without PDF URL - email will still be sent
        } else {
          console.log("[generate-credit-note] PDF uploaded to Storage:", uploadData);

          // Get public URL
          const { data: urlData } = supabase.storage
            .from('credit-notes')
            .getPublicUrl(filePath);

          pdfUrl = urlData.publicUrl;
          console.log("[generate-credit-note] PDF public URL:", pdfUrl);
        }
      }
    } catch (storageException: any) {
      console.error("[generate-credit-note] Storage exception (non-fatal):", storageException);
      storageError = storageException;
      // Continue without PDF URL - email will still be sent
    }

    // Update database (only if we have Supabase client)
    try {
      const supabaseUrl = Deno.env.get("SUPABASE_URL");
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      
      if (supabaseUrl && supabaseKey) {
        const supabase = createClient(supabaseUrl, supabaseKey);
        const { error: updateError } = await supabase
          .from('orders')
          .update({
            credit_note_number: creditNoteNumber,
            credit_note_pdf: pdfUrl,
            refund_amount: finalTotal,
            refund_reason: refundReason || null,
            status: 'cancelled',
          })
          .eq('id', orderId);

        if (updateError) {
          console.error("[generate-credit-note] Database update error (non-fatal):", updateError);
        } else {
          console.log("[generate-credit-note] Database updated successfully");
        }
      }
    } catch (dbError: any) {
      console.error("[generate-credit-note] Database update exception (non-fatal):", dbError);
    }

    // Email templates
    const finalOrderNumber = orderNumber || orderId.slice(0, 8).toUpperCase();
    const finalCustomerEmail = customerEmail || '';
    const finalCustomerName = customerName || 'Customer';

    // Email: Použi profesionálnu šablónu bez textu "Ďakujeme za nákup"
    const CREDIT_NOTE_TEMPLATE = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
    </head>
    <body style="margin: 0; padding: 20px; background-color: #0a0a0a; color: #ffffff; font-family: sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #0a0a0a;">
        <tr>
          <td align="center">
            <table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; background-color: #111111; border: 1px solid #333333; padding: 40px; border-radius: 8px;">
              <tr>
                <td style="padding: 50px 40px 40px; text-align: center; border-bottom: 2px solid #ff4444;">
                  <h1 style="margin: 0; font-size: 36px; font-weight: 800; letter-spacing: 3px;">
                    <span style="color: #ffffff;">REMAP</span><span style="color: #00f2ff;">PRO</span>
                  </h1>
                  <p style="margin: 15px 0 0; color: #ff4444; font-size: 18px; font-weight: 700;">
                    🔄 OPRAVNÝ DOKLAD / DOBROPIS
                  </p>
                </td>
              </tr>
              <tr>
                <td style="padding: 50px 40px;">
                  <h2 style="margin: 0 0 25px; color: #ff4444; font-size: 32px; font-weight: 700; text-align: center;">
                    OPRAVNÝ DOKLAD / DOBROPIS
                  </h2>
                  <p style="margin: 0 0 20px; color: #e5e5e5; font-size: 16px; line-height: 1.6;">
                    Dobrý deň,
                  </p>
                  <p style="margin: 0 0 20px; color: #e5e5e5; font-size: 16px; line-height: 1.6;">
                    Vaša objednávka ${finalOrderNumber} bola stornovaná. Suma bola vrátená na Váš účet.
                  </p>
                  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; border-radius: 5px; margin: 20px 0; border: 2px solid #ff4444;">
                    <tr>
                      <td style="padding: 20px;">
                        <p style="margin: 0 0 8px; color: #888888; font-size: 12px; text-transform: uppercase;">Položka</p>
                        <p style="margin: 0 0 15px; color: #e5e5e5; font-size: 14px;">Storno objednávky ${finalOrderNumber}</p>
                        <p style="margin: 0 0 8px; color: #888888; font-size: 12px; text-transform: uppercase;">Celková suma</p>
                        <p style="margin: 0; color: #ff4444; font-size: 28px; font-weight: 700;">${finalTotal.toFixed(2)} €</p>
                      </td>
                    </tr>
                  </table>
                  ${refundReason ? `<p style="margin: 20px 0; color: #888888; font-size: 14px;"><strong>Dôvod:</strong> ${refundReason}</p>` : ''}
                  <p style="margin: 20px 0; color: #888888; font-size: 14px; line-height: 1.6; font-style: italic;">
                    Tento dokument (${creditNoteNumber}) ruší právny účinok pôvodnej faktúry.
                  </p>
                </td>
              </tr>
              <tr>
                <td style="margin-top: 30px; border-top: 1px solid #333333; padding-top: 20px; text-align: center;">
                  <p style="margin: 0; color: #666666; font-size: 12px;">
                    REMAPPRO | Janka Krala 29, 990 01 Velky Krtis, Slovakia
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

    // Email: Predmet: "Dobropis k objednávke {orderNumber}"
    const emailSubject = `Dobropis k objednávke ${finalOrderNumber}`;

    console.log("[generate-credit-note] Email template prepared");
    console.log("SENDING EMAIL TO:", finalCustomerEmail, "WITH SUBJECT:", emailSubject);
    console.log("SENDER:", SENDER);
    console.log("RESEND_API_KEY present:", !!RESEND_API_KEY);

    // Email sending with try-catch
    let emailSent = false;
    let emailError: any = null;

    if (RESEND_API_KEY) {
      try {
        // Logovanie: Payload pred odoslaním mailu
        const emailPayload = {
          from: SENDER,
          to: [finalCustomerEmail],
          bcc: BCC_EMAIL ? [BCC_EMAIL] : undefined,
          subject: emailSubject,
          html: CREDIT_NOTE_TEMPLATE,
          attachments: pdfBase64 ? [
            {
              filename: fileName,
              content: pdfBase64,
            },
          ] : undefined,
        };
        
        console.log("Payload pred odoslaním mailu:", JSON.stringify({
          from: emailPayload.from,
          to: emailPayload.to,
          subject: emailPayload.subject,
          hasHtml: !!emailPayload.html,
          hasAttachments: !!emailPayload.attachments,
          attachmentFilename: emailPayload.attachments[0]?.filename,
        }, null, 2));

        // Overenie odosielateľa
        console.log("Overenie odosielateľa - FROM field:", emailPayload.from);
        console.log("Overenie odosielateľa - SENDER constant:", SENDER);

        // Debuguj Resend: Použi fetch s lepším error handlingom
        let emailRes: Response;
        try {
          emailRes = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${RESEND_API_KEY}`,
            },
            body: JSON.stringify(emailPayload),
          });
        } catch (fetchError: any) {
          console.error("EMAIL FAILED - Fetch error:", fetchError);
          emailError = fetchError;
          return new Response(
            JSON.stringify({ 
              success: false,
              error: `Fetch failed: ${fetchError.message}`,
              catchError: fetchError.message 
            }), 
            { 
              status: 500, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        const emailResult = await emailRes.text();
        console.log("Resend API response status:", emailRes.status);
        console.log("Resend API response body:", emailResult);

        if (!emailRes.ok) {
          let parsedError: any;
          try {
            parsedError = JSON.parse(emailResult);
          } catch {
            parsedError = { raw: emailResult };
          }
          
          emailError = {
            status: emailRes.status,
            statusText: emailRes.statusText,
            body: parsedError,
          };
          
          console.error("RESEND ERROR:", JSON.stringify(emailError, null, 2));
          return new Response(
            JSON.stringify({ 
              success: false,
              error: parsedError.message || `Resend API error: ${emailRes.status}`,
              resendError: emailError
            }), 
            { 
              status: 400, 
              headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
            }
          );
        }

        emailSent = true;
        console.log("Email sent successfully via Resend");

      } catch (resendError: any) {
        emailError = resendError;
        console.error("EMAIL FAILED:", JSON.stringify({
          message: resendError.message,
          stack: resendError.stack,
          name: resendError.name,
          cause: resendError.cause,
        }, null, 2));
        
        // Ak odosielanie zlyhá, funkcia NESMIE vrátiť status 200
        return new Response(
          JSON.stringify({ 
            success: false,
            error: `Email sending failed: ${resendError.message}`,
            catchError: resendError.message
          }), 
          { 
            status: 500, 
            headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
          }
        );
      }
    } else {
      console.warn("RESEND_API_KEY not configured - skipping email sending");
    }

    // Return success only if email was sent successfully (or if no API key)
    if (!emailSent && RESEND_API_KEY) {
      return new Response(
        JSON.stringify({ 
          success: false,
          error: "Email sending failed - check logs for details"
        }), 
        { 
          status: 500, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        message: emailSent ? 'Credit note generated and email sent successfully' : 'Credit note generated (email skipped - no API key)',
        creditNoteNumber,
        pdfUrl,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    );

  } catch (error: any) {
    // Try-Catch s detailom: Zabaľ celú funkciu do try-catch tak, aby pri chybe vrátila JSON.stringify({ error: error.message })
    console.error("Generate credit note error:", error);
    console.error("Error stack:", error.stack);
    console.error("Error details:", {
      message: error.message,
      name: error.name,
      cause: error.cause,
      stack: error.stack,
    });
    
    // Chcem vidieť chybu v konzole, nie len číslo 500!
    return new Response(
      JSON.stringify({ 
        error: error.message || 'Unknown error occurred',
        stack: error.stack || 'No stack trace available',
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
