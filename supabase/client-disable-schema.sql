-- Add disabled column to clients table
-- When disabled = true, non-admin users cannot access the client dashboard
ALTER TABLE clients ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false;
