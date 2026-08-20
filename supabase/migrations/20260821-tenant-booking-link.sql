-- 2026-08-21: Deterministic booking-link follow-up.
--
-- tenant_profiles.booking_link holds the tenant's public scheduling URL
-- (Calendly etc.). The sequencer texts it to a lead after an answered call
-- that ended positive (hot lead / interested) without an appointment being
-- booked, and exposes it to templates as {{booking_link}}. NULL/empty means
-- the feature is off for that tenant.

ALTER TABLE tenant_profiles
    ADD COLUMN IF NOT EXISTS booking_link TEXT;
