-- Add metadata JSONB column to sequences table for task badges and extra info
ALTER TABLE sequences ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';
