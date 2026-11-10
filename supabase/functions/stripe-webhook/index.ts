import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY") ?? "";
const SENDER = "REMAPPRO <info@remappro.eu>";
const SITE_URL = "https://remappro.eu";
const ADMIN_EMAIL = "srnik.jaroslav@gmail.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, stripe-signature",
};

serve(async (req) => {
  console.log("Stripe webhook received:", req.method);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  try {
    const body = await req.text();
    console.log("Received body length:", body.length);

    // Verify webhook signature if secret is configured
    const STRIPE_WEBHOOK_SECRET = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    const signature = req.headers.get("stripe-signature");
    
    let event;
    
    if (STRIPE_WEBHOOK_SECRET && signature) {
      // Use Stripe signature verification
      const crypto = await import("https://deno.land/std@0.190.0/crypto/mod.ts");
      const encoder = new TextEncoder();
      
      // Parse signature header
      const sigParts = signature.split(",").reduce((acc, part) => {
        const [key, value] = part.split("=");
        acc[key] = value;
        return acc;
      }, {} as Record<string, string>);
      
      const timestamp = sigParts["t"];
      const expectedSig = sigParts["v1"];
      
      if (!timestamp || !expectedSig) {
        console.error("Invalid signature format");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Check timestamp tolerance (5 minutes)
      const tolerance = 300;
      const timestampNum = parseInt(timestamp, 10);
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - timestampNum) > tolerance) {
        console.error("Webhook timestamp too old");
        return new Response(JSON.stringify({ error: "Timestamp too old" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // Compute expected signature
      const signedPayload = `${timestamp}.${body}`;
      const key = await crypto.crypto.subtle.importKey(
        "raw",
        encoder.encode(STRIPE_WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
      );
      const signatureBytes = await crypto.crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(signedPayload)
      );
      const computedSig = Array.from(new Uint8Array(signatureBytes))
        .map(b => b.toString(16).padStart(2, "0"))
        .join("");
      
      if (computedSig !== expectedSig) {
        console.error("Signature mismatch");
        return new Response(JSON.stringify({ error: "Invalid signature" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      console.log("Webhook signature verified successfully");
    }
    
    try {
      event = JSON.parse(body);
    } catch (parseError) {
      console.error("Failed to parse webhook body:", parseError);
      return new Response(JSON.stringify({ error: "Invalid JSON" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("Webhook event type:", event.type);

    // Handle checkout.session.completed event
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      const sessionId = session.id; // cs_live_... or cs_test_...
      console.log("Checkout session completed:", sessionId);
      console.log("Session metadata:", JSON.stringify(session.metadata));
      
      const customerEmail = session.customer_details?.email || session.customer_email;
      const customerName = session.customer_details?.name || session.metadata?.customer_name || "Customer";
      // Extract customer_note from session.metadata (Additional info from form)
      const customerNote = session.metadata?.customer_note || "";
      const amountTotal = session.amount_total ? (session.amount_total / 100).toFixed(2) : "0";
      
      console.log("Customer note from metadata:", customerNote);
      
      // CRITICAL: Extract ALL 5 fields from session.metadata
      // These must match the keys sent from stripe.ts: brand, model, fuel_type, year, file_url
      // And map to DB columns: car_brand, car_model, fuel_type, year, file_url
      
      // 1. Brand - maps to car_brand in DB
      const carBrand = session.metadata?.brand || session.metadata?.car_brand || "";
      
      // 2. Model - maps to car_model in DB
      const carModel = session.metadata?.model || session.metadata?.car_model || "";
      
      // 3. Fuel type - maps to fuel_type in DB
      const fuelTypeRaw = session.metadata?.fuel_type || "";
      const fuelType = (fuelTypeRaw === "Diesel" || fuelTypeRaw === "Petrol") ? fuelTypeRaw : "";
      
      // 4. Year - maps to year in DB (TEXT column)
      // CRITICAL: Extract from session.metadata.year and ensure it's a valid year
      const yearRaw = session.metadata?.year;
      let year: string | null = null;
      if (yearRaw && yearRaw.toString().trim()) {
        const yearStr = yearRaw.toString().trim();
        const parsedYear = parseInt(yearStr);
        if (!isNaN(parsedYear) && parsedYear >= 1900 && parsedYear <= 2100) {
          year = parsedYear.toString(); // Store as string for TEXT column
        } else {
          console.warn("Invalid year value:", yearRaw, "-> parsed:", parsedYear);
        }
      } else {
        console.warn("Year is missing or empty in metadata:", yearRaw);
      }
      
      // 5. File URL - maps to file_url in DB
      const fileUrlRaw = session.metadata?.file_url || null;
      let fileUrl: string | null = null;
      if (fileUrlRaw && fileUrlRaw.trim()) {
        // If it's a full URL, extract just the file name
        // Otherwise, assume it's already just the file name
        if (fileUrlRaw.includes('/')) {
          // Extract file name from URL (last part after last slash)
          const urlParts = fileUrlRaw.split('/');
          fileUrl = urlParts[urlParts.length - 1].split('?')[0]; // Remove query params if any
        } else {
          // Already just the file name
          fileUrl = fileUrlRaw.trim();
        }
      }
      
      const ecuType = session.metadata?.ecu_type || "";
      const legalConsent = session.metadata?.legal_consent === "true";
      
      // VIN: Use null if empty or not provided (matches DB column type)
      const vinRaw = session.metadata?.vin || "";
      const vin = vinRaw.trim() ? vinRaw.trim().toUpperCase() : null;
      
      // Parse services from metadata (JSON array or comma-separated names)
      let serviceTypes: string[] = [];
      const servicesRaw = session.metadata?.services || "";
      if (servicesRaw) {
        try {
          const parsed = JSON.parse(servicesRaw);
          serviceTypes = Array.isArray(parsed) ? parsed.map((item) => String(item)) : [String(parsed)];
        } catch {
          serviceTypes = servicesRaw.split(",").map((item: string) => item.trim()).filter(Boolean);
        }
      }
      
      console.log("=== STRIPE WEBHOOK DEBUG ===");
      console.log("Session metadata:", JSON.stringify(session.metadata, null, 2));
      console.log("Customer email:", customerEmail);
      console.log("Customer name:", customerName);
      console.log("=== EXTRACTED FROM METADATA ===");
      console.log("1. brand (-> car_brand):", session.metadata?.brand, "->", carBrand);
      console.log("2. model (-> car_model):", session.metadata?.model, "->", carModel);
      console.log("3. fuel_type (-> fuel_type):", session.metadata?.fuel_type, "->", fuelType);
      console.log("4. year (-> year):", {
        'session.metadata.year (raw)': session.metadata?.year,
        'session.metadata.year (type)': typeof session.metadata?.year,
        'extracted year': year,
        'year is null': year === null,
      });
      console.log("5. file_url (-> file_url):", session.metadata?.file_url, "->", fileUrl);
      console.log("Car:", carBrand, carModel, "Fuel:", fuelType, "Year:", year, "VIN:", vin);
      console.log("Services:", serviceTypes);

      // Create Supabase client
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: existingOrder } = await supabase
        .from("orders")
        .select("id, order_number")
        .eq("stripe_session_id", sessionId)
        .maybeSingle();

      if (existingOrder) {
        console.log("Order already stored for session:", sessionId, existingOrder.order_number);
        return new Response(JSON.stringify({ received: true, order_number: existingOrder.order_number }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // Generate unique order number with random suffix for uniqueness
      const timestamp = Date.now().toString(36).toUpperCase();
      const randomSuffix = Math.random().toString(36).substring(2, 5).toUpperCase();
      const orderNumber = `RP-${timestamp}${randomSuffix}`;
      
      // ATOMIC: Create order in database FIRST - this is the source of truth
      // Extract ALL 5 fields from session.metadata and map to DB columns
      const orderData: any = {
        order_number: orderNumber,
        customer_name: customerName,
        customer_email: customerEmail?.toLowerCase() || "",
        // CRITICAL: Map all 5 fields from metadata to DB columns
        car_brand: carBrand || null,  // From session.metadata.brand
        car_model: carModel || null,  // From session.metadata.model
        fuel_type: fuelType || null,  // From session.metadata.fuel_type
        year: year,  // From session.metadata.year (as string for TEXT column)
        file_url: fileUrl,  // From session.metadata.file_url
        ecu_type: ecuType || null,
        vin: vin,  // VIN column - null if not provided
        service_type: serviceTypes.length > 0 ? serviceTypes : null,
        total_price: parseFloat(amountTotal),
        status: "processing",
        legal_consent: legalConsent,
        customer_note: customerNote || null,
        stripe_session_id: sessionId,
      };
      
      // Log the data being inserted for debugging
      console.log("=== INSERTING INTO DB ===");
      console.log("Inserting into DB:", JSON.stringify(orderData, null, 2));
      console.log("=== MAPPING VERIFICATION ===");
      console.log("1. session.metadata.brand -> car_brand:", session.metadata?.brand, "->", orderData.car_brand);
      console.log("2. session.metadata.model -> car_model:", session.metadata?.model, "->", orderData.car_model);
      console.log("3. session.metadata.fuel_type -> fuel_type:", session.metadata?.fuel_type, "->", orderData.fuel_type);
      console.log("4. session.metadata.year -> year:", {
        'metadata.year (raw)': session.metadata?.year,
        'metadata.year (type)': typeof session.metadata?.year,
        'extracted year': year,
        'orderData.year': orderData.year,
        'year is null': orderData.year === null,
      });
      console.log("5. session.metadata.file_url -> file_url:", session.metadata?.file_url, "->", orderData.file_url);
      console.log("6. session.metadata.customer_note -> customer_note:", session.metadata?.customer_note, "->", orderData.customer_note);
      
      console.log("ATOMIC: Creating order with data:", JSON.stringify(orderData));
      
      // Use RETURNING to get the actual order_number from DB
      const { data: newOrder, error: insertError } = await supabase
        .from("orders")
        .insert([orderData])
        .select("id, order_number, customer_email, created_at")
        .single();
      
      if (insertError || !newOrder) {
        console.error("=== CRITICAL DB ERROR - Failed to create order ===");
        console.error("Insert error:", JSON.stringify({
          error: insertError?.message,
          code: insertError?.code,
          details: insertError?.details,
          hint: insertError?.hint,
          status: insertError?.status,
        }, null, 2));
        console.error("Order data that failed:", JSON.stringify({
          ...orderData,
          file_url: orderData.file_url ? `[FILE: ${orderData.file_url}]` : "[NULL]",
        }, null, 2));
        console.error("Possible causes:");
        console.error("- RLS (Row Level Security) policy blocking insert");
        console.error("- Type mismatch (e.g., year should be TEXT, not INTEGER)");
        console.error("- Missing required fields");
        console.error("- Invalid data format");
        
        // Return 500 to tell Stripe to retry
        return new Response(JSON.stringify({ 
          error: "Failed to create order", 
          details: insertError?.message,
          code: insertError?.code,
          hint: insertError?.hint,
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      // CRITICAL: Use the order_number returned from DB, not the generated one
      const confirmedOrderNumber = newOrder.order_number;
      const confirmedOrderId = newOrder.id;
      
      if (!confirmedOrderNumber) {
        console.error("CRITICAL: DB returned order but order_number is null/empty:", newOrder);
        return new Response(JSON.stringify({ 
          error: "Order created but order_number is missing",
          orderId: confirmedOrderId
        }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      
      console.log("ATOMIC: Order created successfully - ID:", confirmedOrderId, "Order#:", confirmedOrderNumber);

      // Sequence: Update DB -> Admin Email -> Customer Email

      // Step 1: Send admin notification email
      if (RESEND_API_KEY) {
        const adminEmailHtml = `
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
                    <!-- Header -->
                    <tr>
                      <td style="padding: 50px 40px 40px; text-align: center; border-bottom: 2px solid #00f2ff;">
                        <h1 style="margin: 0; font-size: 36px; font-weight: 800; letter-spacing: 3px;">
                          <span style="color: #ffffff;">REMAP</span><span style="color: #00f2ff;">PRO</span>
                        </h1>
                        <p style="margin: 12px 0 0; color: #00f2ff; font-size: 18px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px;">
                          🔔 NEW ORDER RECEIVED
                        </p>
                      </td>
                    </tr>
                    
                    <!-- Main Content -->
                    <tr>
                      <td style="padding: 50px 40px;">
                        <!-- Order Info -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; border-radius: 5px; margin-bottom: 20px;">
                          <tr>
                            <td style="padding: 25px;">
                              <p style="margin: 0 0 8px; color: #888888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                                Order ID
                              </p>
                              <p style="margin: 0 0 15px; color: #00f2ff; font-size: 24px; font-weight: bold; font-family: 'Monaco', 'Consolas', monospace;">
                                ${confirmedOrderNumber}
                              </p>
                              <p style="margin: 0 0 8px; color: #888888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                                Amount
                              </p>
                              <p style="margin: 0; color: #00f2ff; font-size: 20px; font-weight: bold;">
                                €${amountTotal}
                              </p>
                            </td>
                          </tr>
                        </table>
                        
                        <!-- Customer Info -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; border-radius: 5px; margin-bottom: 20px;">
                          <tr>
                            <td style="padding: 25px;">
                              <p style="margin: 0 0 8px; color: #888888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                                Customer
                              </p>
                              <p style="margin: 0 0 5px; color: #00f2ff; font-size: 16px; font-weight: 600;">
                                ${customerName}
                              </p>
                              <p style="margin: 0; color: #00f2ff; font-size: 14px;">
                                ${customerEmail}
                              </p>
                            </td>
                          </tr>
                        </table>
                        
                        ${customerNote ? `
                        <!-- Customer Note -->
                        <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #1a2e31; border-radius: 5px; margin-bottom: 20px;">
                          <tr>
                            <td style="padding: 25px;">
                              <p style="margin: 0 0 8px; color: #888888; font-size: 12px; text-transform: uppercase; letter-spacing: 1px;">
                                ⚠️ Customer Note
                              </p>
                              <p style="margin: 0; color: #00f2ff; font-size: 14px; line-height: 1.6;">
                                ${customerNote}
                              </p>
                            </td>
                          </tr>
                        </table>
                        ` : ''}
                        
                        <!-- CTA Button -->
                        <table width="100%" cellpadding="0" cellspacing="0">
                          <tr>
                            <td align="center">
                              <a href="${SITE_URL}/manage" 
                                 style="background-color: #00f2ff; color: #000000; padding: 12px 25px; text-decoration: none; font-weight: bold; border-radius: 4px; display: inline-block;">
                                Open Admin Portal
                              </a>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                    
                    <!-- Footer -->
                    <tr>
                      <td style="margin-top: 30px; border-top: 1px solid #333333; padding-top: 20px; text-align: center;">
                        <p style="margin: 0; color: #666666; font-size: 12px;">
                          REMAPPRO Admin Notification
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

        const adminEmailRes = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${RESEND_API_KEY}`,
          },
          body: JSON.stringify({
            from: SENDER,
            to: [ADMIN_EMAIL],
            subject: `🔔 New Order: ${confirmedOrderNumber} - €${amountTotal}`,
            html: adminEmailHtml,
          }),
        });

        const adminEmailResult = await adminEmailRes.text();
        console.log("Admin notification email sent:", adminEmailRes.ok, adminEmailResult);
      }

      // Step 2: Send order confirmation email to customer
      // This email contains only basic info: Order ID, Tracking Link, and confirmation
      // Invoice generation is NOT done here - it's moved to send-order-ready (when order is completed)
      try {
        // Prepare data with fallback values
        const emailOrderNumber = confirmedOrderNumber || confirmedOrderId || "N/A";
        const emailCustomerName = customerName || "Zákazník";
        const emailCustomerEmail = customerEmail || "";
        const emailTotalAmount = session.amount_total ? parseFloat((session.amount_total / 100).toFixed(2)) : 0;
        
        if (!emailCustomerEmail) {
          console.error("ERROR: Customer email is missing, cannot send confirmation email");
        } else {
          // Use explicit SERVICE_ROLE_KEY and FUNCTION_URL (mirroring admin notification pattern)
          const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
          const FUNCTION_URL = `${supabaseUrl}/functions/v1/order-confirmation`;
          
          console.log("CRITICAL: Executing customer confirmation via Service Role Key for Order:", confirmedOrderId);
          
          // Direct fetch to order-confirmation function (NOT using supabase.functions.invoke)
          // Mirror the exact implementation used for Admin notification
          const confirmationRes = await fetch(FUNCTION_URL, {
            method: "POST",
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${SERVICE_ROLE_KEY}`
            },
            body: JSON.stringify({
              orderId: confirmedOrderId,
              orderNumber: emailOrderNumber,
              customerEmail: emailCustomerEmail,
              customerName: emailCustomerName,
              totalAmount: emailTotalAmount,
              brand: carBrand || undefined,
              model: carModel || undefined,
              fuelType: fuelType || undefined,
              year: year || undefined,
              vin: vin || undefined,
              createdAt: newOrder.created_at || new Date().toISOString(),
            }),
          });
          
          if (!confirmationRes.ok) {
            const errorText = await confirmationRes.text();
            console.error("ERROR: Order confirmation email HTTP error:", confirmationRes.status, errorText);
          } else {
            const confirmationResult = await confirmationRes.json();
            console.log("SUCCESS: Order confirmation email sent successfully:", confirmationResult);
          }
        }
      } catch (confirmationError) {
        console.error("ERROR: Order confirmation email failed (non-fatal):", confirmationError);
        // Continue - don't fail the webhook, order is already saved
      }

      return new Response(JSON.stringify({ received: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      });
    }

    // Return success for other event types
    return new Response(JSON.stringify({ received: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });

  } catch (error: any) {
    console.error("=== WEBHOOK CATCH BLOCK ERROR ===");
    console.error("Error type:", error?.constructor?.name);
    console.error("Error message:", error?.message);
    console.error("Error stack:", error?.stack);
    console.error("Full error object:", JSON.stringify(error, Object.getOwnPropertyNames(error), 2));
    
    // Log if it's a Supabase error
    if (error?.code || error?.details || error?.hint) {
      console.error("Supabase error detected:", {
        code: error.code,
        details: error.details,
        hint: error.hint,
        message: error.message,
      });
    }
    
    // Always return 200 to prevent Stripe from retrying
    return new Response(
      JSON.stringify({ received: true, error: error?.message || "Unknown error" }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
