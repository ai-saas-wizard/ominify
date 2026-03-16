-- Add walkthrough_completed flag to tenant_profiles
-- Tracks whether the post-onboarding dashboard tour has been shown
ALTER TABLE tenant_profiles
ADD COLUMN IF NOT EXISTS walkthrough_completed BOOLEAN DEFAULT false;
