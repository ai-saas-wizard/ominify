-- Persist the per-umbrella VAPI tool IDs for the 5 reusable calendar tools.
-- Created once via VAPI's /tool API and referenced by every UMBRELLA agent's
-- assistant payload via `model.toolIds`, so we no longer inline ~250 lines of
-- identical tool JSON into every assistant.
--
-- Shape:
--   {
--     "check_availability":     "tool_xxx",
--     "book_appointment":       "tool_yyy",
--     "lookup_appointment":     "tool_zzz",
--     "reschedule_appointment": "tool_aaa",
--     "cancel_appointment":     "tool_bbb"
--   }
--
-- NULL until the bootstrap runs. Self-healing: ensureUmbrellaCalendarTools()
-- only creates missing keys.
ALTER TABLE vapi_umbrellas
  ADD COLUMN IF NOT EXISTS calendar_tool_ids JSONB;
