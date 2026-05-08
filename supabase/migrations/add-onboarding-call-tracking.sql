-- Onboarding call tracking
-- Adds columns to tenant_profiles to track the white-glove "Schedule onboarding call" flow.

ALTER TABLE tenant_profiles
    ADD COLUMN IF NOT EXISTS onboarding_path TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_call_requested_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS onboarding_call_scheduled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS onboarding_call_invitee_uri TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_call_event_uri TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_call_invitee_email TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_call_invitee_name TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_call_reschedule_url TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_call_cancel_url TEXT,
    ADD COLUMN IF NOT EXISTS onboarding_call_answers JSONB;

COMMENT ON COLUMN tenant_profiles.onboarding_path IS
    'Tracks which onboarding flow the user picked. Values: NULL | ''auto'' | ''manual_call_pending'' | ''manual_call_booked'' | ''vertical_re''';

CREATE INDEX IF NOT EXISTS idx_tenant_profiles_onboarding_path
    ON tenant_profiles (onboarding_path)
    WHERE onboarding_path IN ('manual_call_pending', 'manual_call_booked');

CREATE INDEX IF NOT EXISTS idx_tenant_profiles_onboarding_call_invitee_uri
    ON tenant_profiles (onboarding_call_invitee_uri)
    WHERE onboarding_call_invitee_uri IS NOT NULL;
