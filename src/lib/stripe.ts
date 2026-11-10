import { supabase } from "@/integrations/supabase/client";

export const generateOrderId = () => {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `RP-${result}`;
};

export const redirectToCheckout = async (options: any) => {
  try {
    // Validate items array before processing
    if (!options.items || !Array.isArray(options.items) || options.items.length === 0) {
      throw new Error('No services selected');
    }

    // Build items array with validated prices
    const items = options.items.map((item: any) => {
      const price = typeof item.price === 'number' ? item.price : 0;
      if (price <= 0) {
        console.warn('[redirectToCheckout] Invalid price for item:', item);
      }
      return {
        name: item.name || 'Service',
        amount: price,
      };
    });

    // Validate that at least one item has a valid price
    const totalAmount = items.reduce((sum: number, item: any) => sum + item.amount, 0);
    if (totalAmount <= 0) {
      throw new Error('Total amount must be greater than 0');
    }

    const serviceNames = items.map((item: any) => item.name).join(', ') || 'Nezadané';
    
    // CRITICAL: Extract vehicle data - check if vehicleData is not empty
    const vehicle = options.vehicle || {};
    
    console.log('[redirectToCheckout] Vehicle data received:', vehicle);
    
    if (!vehicle || Object.keys(vehicle).length === 0) {
      console.error('[redirectToCheckout] ERROR: Vehicle data is empty!', options);
      throw new Error('Vehicle data is required');
    }
    
    const brand = vehicle.brand?.trim() || '';
    const model = vehicle.model?.trim() || '';
    const ecuType = vehicle.ecuType?.trim() || '';
    
    // Fuel type: Must be "Diesel" or "Petrol"
    const fuelTypeRaw = vehicle.fuelType?.trim() || '';
    const fuelType = (fuelTypeRaw === 'Diesel' || fuelTypeRaw === 'Petrol') ? fuelTypeRaw : '';
    
    // Year: Ensure it's a valid number (1900-2100), otherwise send empty string
    // CRITICAL: Must extract real year value from vehicleData.year
    let year = 0;
    if (vehicle.year) {
      const yearNum = typeof vehicle.year === 'number' ? vehicle.year : parseInt(vehicle.year.toString());
      if (!isNaN(yearNum) && yearNum >= 1900 && yearNum <= 2100) {
        year = yearNum;
      }
    }
    
    console.log('[redirectToCheckout] Year extraction:', {
      'vehicle.year (raw)': vehicle.year,
      'vehicle.year (type)': typeof vehicle.year,
      'parsed year': year,
      'year as string': String(year),
    });
    
    console.log('[redirectToCheckout] Extracted vehicle data:', {
      brand,
      model,
      fuelType,
      year,
      yearString: String(year),
      ecuType,
      fileUrl: options.fileUrl,
    });
    
    console.log('[redirectToCheckout] Sending request:', { 
      orderId: options.orderId,
      customerEmail: options.customerEmail,
      totalAmount,
      items,
      metadata: { 
        carBrand: brand, 
        carModel: model, 
        carEcu: ecuType, 
        carServices: serviceNames,
        fuel_type: fuelType,
        year: year.toString(),
        file_url: options.fileUrl || '',
      }
    });
    
    // Prepare metadata for Stripe checkout session
    // CRITICAL: Must match DB column names: car_brand, car_model, fuel_type, year, file_url
    // Use vehicleData directly to ensure no data loss
    const metadata = {
      orderId: options.orderId,
      customer_name: options.customerName?.trim() || 'Nezadané',
      customerNote: options.customerNote || '',
      brand: brand, // From vehicleData.brand - maps to car_brand in DB
      model: model, // From vehicleData.model - maps to car_model in DB
      ecu_type: ecuType,
      services: serviceNames,
      fuel_type: fuelType, // From vehicleData.fuelType - maps to fuel_type in DB
      year: year > 0 ? String(year) : '', // From vehicleData.year - must be string for Stripe metadata - maps to year in DB
      file_url: options.fileUrl || '', // uploadedFileName - maps to file_url in DB
      legal_consent: options.legalConsent ? 'true' : 'false',
    };
    
    console.log('[redirectToCheckout] Metadata to send:', JSON.stringify(metadata, null, 2));
    console.log('[redirectToCheckout] Vehicle data check:', {
      'vehicleData.brand': vehicle.brand,
      'vehicleData.model': vehicle.model,
      'vehicleData.fuelType': vehicle.fuelType,
      'vehicleData.year (raw)': vehicle.year,
      'vehicleData.year (type)': typeof vehicle.year,
      'extracted brand': brand,
      'extracted model': model,
      'extracted fuel_type': fuelType,
      'extracted year (number)': year,
      'extracted year (string)': year > 0 ? String(year) : '',
      'file_url': options.fileUrl,
    });
    
    const { data, error } = await supabase.functions.invoke("create-checkout", {
      body: {
        items,
        email: options.customerEmail,
        metadata,
      },
    });

    if (error) throw error;
    if (data?.url) window.location.href = data.url;
  } catch (error: any) {
    console.error("Stripe Checkout Error:", error);
    throw error;
  }
};
