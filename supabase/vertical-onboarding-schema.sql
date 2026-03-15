-- ═══════════════════════════════════════════════════════════
-- VERTICAL ONBOARDING: Targeted Industry Templates
-- Adds column to track which vertical was used during onboarding.
-- Backward-compatible (IF NOT EXISTS + nullable default).
-- ═══════════════════════════════════════════════════════════

-- ─── TENANT PROFILES TABLE ───
-- onboarding_vertical: stores the vertical ID (e.g. 'real_estate_investor')
-- NULL = auto-generated onboarding (existing V2 flow)

ALTER TABLE tenant_profiles ADD COLUMN IF NOT EXISTS onboarding_vertical TEXT;
