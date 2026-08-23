-- 2026-08-23: Archive clients out of the admin lists without deleting them.
--
-- clients.archived_at is an ADMIN-VIEW state only: an archived client drops out
-- of the default Admin → Clients grid and the onboarding queue so the list stays
-- readable once an account is dead. It deliberately does NOT gate access — that
-- is what clients.disabled does (see client-disable-schema.sql). A client can be
-- archived while still enabled, and the archive dialog says so when that happens.
--
-- Mirrors the contact_lists.archived_at convention already used elsewhere.
-- Idempotent — safe to re-run.

ALTER TABLE clients ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ;

COMMENT ON COLUMN clients.archived_at IS
    'When an admin archived this client (hidden from the default admin lists). NULL = not archived. Does NOT affect dashboard access — see clients.disabled.';

-- The hot read is "every client that is not archived, newest first".
CREATE INDEX IF NOT EXISTS idx_clients_active_created_at
    ON clients (created_at DESC)
    WHERE archived_at IS NULL;
