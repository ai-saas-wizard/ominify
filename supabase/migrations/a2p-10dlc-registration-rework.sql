-- A2P 10DLC Registration Rework — Database Migration
-- Run this against your Supabase database

-- ─── tenant_profiles: Add A2P business fields ───────────────────────────────

ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS business_industry TEXT;
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS business_registration_id_type TEXT DEFAULT 'EIN';
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS business_regions_of_operation TEXT DEFAULT 'USA_AND_CANADA';
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS authorized_rep_1 JSONB;
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS authorized_rep_2 JSONB;
ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS a2p_business_info_complete BOOLEAN DEFAULT false;

-- ─── tenant_a2p_registrations: Add TrustHub pipeline fields ─────────────────

-- Drop the restrictive CHECK constraints so Twilio status values work
ALTER TABLE tenant_a2p_registrations DROP CONSTRAINT IF EXISTS tenant_a2p_registrations_brand_status_check;
ALTER TABLE tenant_a2p_registrations DROP CONSTRAINT IF EXISTS tenant_a2p_registrations_campaign_status_check;

ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS secondary_customer_profile_sid TEXT;
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS secondary_profile_status TEXT DEFAULT 'not_started';
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS trust_product_sid TEXT;
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS trust_product_status TEXT DEFAULT 'not_started';
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS address_sid TEXT;
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS end_user_business_sid TEXT;
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS end_user_rep1_sid TEXT;
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS end_user_rep2_sid TEXT;
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS end_user_a2p_profile_sid TEXT;
ALTER TABLE tenant_a2p_registrations ADD COLUMN IF NOT EXISTS current_step TEXT DEFAULT 'business_info';
