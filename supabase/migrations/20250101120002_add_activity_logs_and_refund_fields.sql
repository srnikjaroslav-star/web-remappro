-- Migration: Add activity_logs table and extend orders table with refund fields
-- This migration adds professional credit note tracking and refund management

-- 1. Create activity_logs table for tracking all order actions
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  admin_id TEXT,
  CONSTRAINT fk_order FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);

-- Add comments to document the table
COMMENT ON TABLE activity_logs IS 'Activity log for tracking all order-related actions (invoice generation, credit note generation, status changes, etc.)';
COMMENT ON COLUMN activity_logs.action IS 'Action type (e.g., CN_GENERATED, INVOICE_GENERATED, STATUS_CHANGED)';
COMMENT ON COLUMN activity_logs.details IS 'JSON object with action-specific details';
COMMENT ON COLUMN activity_logs.admin_id IS 'Identifier of the admin/user who performed the action';

-- Create indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_activity_logs_order_id ON activity_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);

-- 2. Extend orders table with refund-related fields
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS refund_reason TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS tax_point_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS refund_iban TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS refund_amount NUMERIC(10, 2) DEFAULT NULL;

-- Add comments to document the new columns
COMMENT ON COLUMN orders.refund_reason IS 'Reason for refund (why the money is being returned)';
COMMENT ON COLUMN orders.tax_point_date IS 'Tax point date for credit note (legally required date when the credit note is issued)';
COMMENT ON COLUMN orders.refund_iban IS 'IBAN where the refund was sent';
COMMENT ON COLUMN orders.refund_amount IS 'Partial refund amount (if not 100%, this is the amount being refunded)';

-- Create index for refund queries
CREATE INDEX IF NOT EXISTS idx_orders_refund_iban ON orders(refund_iban) WHERE refund_iban IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tax_point_date ON orders(tax_point_date) WHERE tax_point_date IS NOT NULL;
