-- Migration: Add credit_note_number and credit_note_pdf columns to orders table
-- These columns store credit note information separately

ALTER TABLE orders
ADD COLUMN IF NOT EXISTS credit_note_number TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS credit_note_pdf TEXT DEFAULT NULL;

-- Add comments to document the columns
COMMENT ON COLUMN orders.credit_note_number IS 'Unique credit note number (e.g., CN-2026-XXXX)';
COMMENT ON COLUMN orders.credit_note_pdf IS 'URL to the credit note PDF document stored in credit-note bucket';

-- Create index for faster queries on credit notes
CREATE INDEX IF NOT EXISTS idx_orders_credit_note_number ON orders (credit_note_number) WHERE credit_note_number IS NOT NULL;
