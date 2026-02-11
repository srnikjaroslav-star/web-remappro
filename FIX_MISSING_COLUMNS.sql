-- KRITICKÁ OPRAVA: Pridanie chýbajúcich stĺpcov do orders tabuľky
-- Spusti tento skript v Supabase SQL Editori (https://supabase.com/dashboard/project/YOUR_PROJECT/sql)

-- 1. Pridanie stĺpcov do orders tabuľky
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS refund_amount DECIMAL(10,2) DEFAULT NULL,
ADD COLUMN IF NOT EXISTS refund_reason TEXT DEFAULT NULL,
ADD COLUMN IF NOT EXISTS tax_point_date TIMESTAMP WITH TIME ZONE DEFAULT NULL,
ADD COLUMN IF NOT EXISTS refund_iban TEXT DEFAULT NULL;

-- 2. Vytvorenie tabuľky pre activity logy (ak neexistuje)
CREATE TABLE IF NOT EXISTS activity_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  details JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  admin_id TEXT
);

-- 3. Vytvorenie indexov pre rýchlejšie dotazy
CREATE INDEX IF NOT EXISTS idx_activity_logs_order_id ON activity_logs(order_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action ON activity_logs(action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_refund_iban ON orders(refund_iban) WHERE refund_iban IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_orders_tax_point_date ON orders(tax_point_date) WHERE tax_point_date IS NOT NULL;

-- 4. Pridanie komentárov pre dokumentáciu
COMMENT ON COLUMN orders.refund_reason IS 'Reason for refund (why the money is being returned)';
COMMENT ON COLUMN orders.tax_point_date IS 'Tax point date for credit note (legally required date when the credit note is issued)';
COMMENT ON COLUMN orders.refund_iban IS 'IBAN where the refund was sent';
COMMENT ON COLUMN orders.refund_amount IS 'Partial refund amount (if not 100%, this is the amount being refunded)';

-- Overenie: Skontroluj, či stĺpce existujú
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'orders'
  AND column_name IN ('refund_amount', 'refund_reason', 'tax_point_date', 'refund_iban')
ORDER BY column_name;
