import Stripe from "https://esm.sh/stripe@17.7.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { 
      status: 200, 
      headers: corsHeaders 
    });
  }

  try {
    const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY");
    if (!STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not configured");
    }

    const stripe = new Stripe(STRIPE_SECRET_KEY);

    // Debug: log raw body text before parsing
    const rawBody = await req.text();
    console.log('Raw body received:', rawBody);
    
    let parsedBody;
    try {
      parsedBody = JSON.parse(rawBody);
    } catch (parseErr) {
      console.error('JSON parse error:', parseErr);
      throw new Error(`Invalid JSON body: ${rawBody.substring(0, 200)}`);
    }

    const { items, email, successUrl, cancelUrl, metadata } = parsedBody;

    console.log('=== CREATE-CHECKOUT DEBUG ===');
    console.log('Parsed request body:', JSON.stringify({ items, email, metadata }, null, 2));
    console.log('Metadata type:', typeof metadata);
    console.log('Metadata is null/undefined:', metadata == null);
    
    if (!metadata) {
      console.error('CRITICAL: metadata is null or undefined!');
      throw new Error('Metadata is required');
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      throw new Error('At least one line item is required');
    }

    if (!email || !email.includes('@')) {
      throw new Error('Valid email address is required');
    }

    // Validate items - expect { name, amount } where amount is in EUR
    for (const item of items) {
      if (!item || typeof item.name !== 'string' || item.name.trim().length === 0) {
        throw new Error('Each item must have a valid name');
      }
      if (typeof item.amount !== 'number' || item.amount <= 0) {
        throw new Error('Each item must have a positive amount (in EUR)');
      }
    }

    const origin = req.headers.get('origin') || '';
    const finalSuccessUrl = successUrl || (origin ? `${origin}/#/success?session_id={CHECKOUT_SESSION_ID}` : '');
    const finalCancelUrl = cancelUrl || (origin ? `${origin}/order` : '');

    if (!finalSuccessUrl || !finalCancelUrl) {
      throw new Error('Missing successUrl/cancelUrl (and Origin header fallback was empty)');
    }

    const totalAmountEur = items.reduce((sum: number, item: any) => sum + item.amount, 0);
    const description = items.map((i: any) => i.name).join(', ');

    console.log('Creating checkout session with promo codes enabled (v4):');
    console.log('Items:', items);
    console.log('Total amount (EUR):', totalAmountEur);
    console.log('=== METADATA EXTRACTION ===');
    console.log('metadata.brand:', metadata?.brand);
    console.log('metadata.model:', metadata?.model);
    console.log('metadata.fuel_type:', metadata?.fuel_type);
    console.log('metadata.year (raw):', metadata?.year);
    console.log('metadata.year (type):', typeof metadata?.year);
    console.log('metadata.year (as string):', metadata?.year ? String(metadata.year) : '');
    console.log('metadata.file_url:', metadata?.file_url);
    console.log('metadata.customer_note (additionalInfo):', metadata?.customerNote);
    console.log('Full metadata:', JSON.stringify(metadata, null, 2));

    const line_items = items.map((item: any) => ({
      price_data: {
        currency: 'eur',
        product_data: {
          name: item.name,
        },
        unit_amount: Math.round(item.amount * 100), // Convert EUR to cents for Stripe
      },
      quantity: 1,
    }));

    // CRITICAL: Define metadata object with vehicleData values
    // Ensure all 5 fields are present: brand, model, fuel_type, year, file_url
    const sessionMetadata = {
      order_id: metadata?.orderId || '',
      services: metadata?.services || description,
      total_amount_eur: totalAmountEur.toFixed(2),
      order_type: metadata?.orderType || 'tuning',
      source: metadata?.source || 'web',
      customer_note: metadata?.customerNote || '', // Additional info from form field
      customer_name: metadata?.customer_name || '',
      // CRITICAL: These 5 fields must match what webhook expects
      brand: metadata?.brand || '', // vehicleData.brand
      model: metadata?.model || '', // vehicleData.model
      fuel_type: metadata?.fuel_type || '', // vehicleData.fuelType
      year: metadata?.year ? String(metadata.year) : '', // String(vehicleData.year) - Stripe requires string, not number!
      file_url: metadata?.file_url || '', // uploadedFileName
      ecu_type: metadata?.ecu_type || '',
      legal_consent: metadata?.legal_consent || '',
    };
    
    console.log('=== SESSION METADATA TO CREATE ===');
    console.log('Session metadata:', JSON.stringify(sessionMetadata, null, 2));

    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items,
      mode: 'payment',
      success_url: finalSuccessUrl,
      cancel_url: finalCancelUrl,
      client_reference_id: metadata?.orderId || undefined,
      customer_email: email,
      allow_promotion_codes: true,
      metadata: sessionMetadata,
    });

    console.log("Checkout session created:", session.id);

    return new Response(
      JSON.stringify({ url: session.url }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (error: any) {
    console.error("Checkout error:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      }
    );
  }
});
