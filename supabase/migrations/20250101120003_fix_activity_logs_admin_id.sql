-- Migration: Fix activity_logs table - Add admin_id column if missing
-- This fixes the Activity Log error where admin_id column may not exist

ALTER TABLE activity_logs 
ADD COLUMN IF NOT EXISTS admin_id TEXT DEFAULT NULL;

-- Update comment
COMMENT ON COLUMN activity_logs.admin_id IS 'Identifier of the admin/user who performed the action (can be UUID or text)';

-- If the column already exists as UUID, we keep it as TEXT for flexibility
-- No need to drop and recreate, TEXT can handle both UUID strings and text identifiers
