-- ═══════════════════════════════════════════════════════════
-- APPOINTMENT MEETING LINK
-- Google bookings now add the lead as an attendee and request a
-- Google Meet link (conferenceData). Persist the join URL so the
-- dashboard / follow-up messaging can surface it without a
-- round-trip to the Calendar API.
--
-- Attendee email is already persisted as appointments.customer_email.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE appointments
    ADD COLUMN IF NOT EXISTS meeting_url TEXT;
