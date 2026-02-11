import { createClient } from '@supabase/supabase-js';

export const SUPABASE_URL = 'https://kivqvwdfujsnuwfxjtcz.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImtpdnF2d2RmdWpzbnV3ZnhqdGN6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjcwMjQ1OTMsImV4cCI6MjA4MjYwMDU5M30.-iDvC0T6lozYv5d4xrHrHeS9PSGOfqwajZapMB7hqjQ';

export interface Order {
  id: string;
  order_number: string | null;
  customer_name: string;
  customer_email: string;
  car_brand: string;
  car_model: string;
  fuel_type: string;
  year: number;
  ecu_type: string;
  vin: string | null;
  service_type: string[];
  total_price: number;
  status: string;
  file_url: string | null;
  result_file_url: string | null;
  legal_consent: boolean;
  customer_note: string | null;
  checksum_crc: string | null;
  internal_note: string | null;
  important_note: string | null;
  invoice_number: string | null;
  invoice_url: string | null;
  credit_note_number: string | null;
  credit_note_pdf: string | null;
  refund_reason: string | null;
  tax_point_date: string | null;
  refund_iban: string | null;
  refund_amount: number | null;
  stripe_session_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface ActivityLog {
  id: string;
  order_id: string;
  action: string;
  details: Record<string, any>;
  created_at: string;
  admin_id: string | null;
}

export interface OrderInsert {
  customer_name: string;
  customer_email: string;
  car_brand: string;
  car_model: string;
  fuel_type: string;
  year: number;
  ecu_type: string;
  service_type: string[];
  total_price: number;
  status?: string;
  file_url?: string | null;
  result_file_url?: string | null;
  legal_consent: boolean;
  customer_note?: string | null;
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
