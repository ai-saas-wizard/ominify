-- A2P 10DLC: record registrations we discovered rather than created
--
-- A business can complete 10DLC directly with Twilio, before or outside of
-- Omnify. We previously read registration state only from this table, so those
-- tenants showed as "not registered" while they were sending perfectly well.
-- checkA2PStatus now asks Twilio and adopts what it finds, and these two
-- columns record that the row arrived that way rather than through our wizard.
--
-- Run this against your Supabase database by hand.

ALTER TABLE tenant_a2p_registrations
    ADD COLUMN IF NOT EXISTS discovered_externally BOOLEAN DEFAULT false;

ALTER TABLE tenant_a2p_registrations
    ADD COLUMN IF NOT EXISTS discovered_at TIMESTAMPTZ;

COMMENT ON COLUMN tenant_a2p_registrations.discovered_externally IS
    'True when the brand or campaign was registered directly with Twilio and adopted by Omnify, rather than created through the in-app wizard.';
