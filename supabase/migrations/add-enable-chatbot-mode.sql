-- Add enable_chatbot_mode to sequences table for Phase 5 SMS chatbot
ALTER TABLE sequences ADD COLUMN IF NOT EXISTS enable_chatbot_mode BOOLEAN DEFAULT false;
