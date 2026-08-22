# "Rotate numbers" — per-campaign outbound number rotation (design)

Date: 2026-08-23 · Status: approved (plan-mode session)

## Problem

One sequence dialing/texting ~300 leads from a single number risks that number
being spam-flagged / blacklisted. The operator wants a per-campaign toggle that,
when on, spreads outbound **voice calls and SMS** across a pool of the account's
existing phone numbers (which the Phone Numbers page already buys + syncs to VAPI).

Today every outbound touch resolves to ONE number:

- Voice: `sequencer/src/workers/scheduler-worker.ts` — 3-tier pick (tenant
  `default_outbound_phone_id` → number assigned to `step.voice_agent_id` → first
  active VAPI-synced number), stamped on the BullMQ job as `phoneNumberId`.
- SMS: `sequencer/src/workers/sms-worker.ts` — Messaging Service SID if present,
  else the first `purpose='sequencer'` number.
- Nothing is keyed per number; no log records which number was used; the
  self-healer's voice re-queues stamp no caller ID at all.
- Inbound callbacks to a number that isn't assigned to an agent get **no
  assistant**: numbers are imported to VAPI with a `serverUrl` but no
  `assistantId`, and the `assistant-request` webhook returns only variable values.

## Decisions (confirmed with the user)

1. **Pool = hand-picked per campaign** — toggle + checklist in the sequence settings.
2. **Sticky per lead** — an enrollment picks one number on its first outbound touch
   (round-robin) and keeps it for every call + text in that campaign.
3. **Voice + SMS both rotate.** SMS sends `from` the sticky number AND keeps
   `messagingServiceSid` (Twilio: both may be passed; the From must be in the
   service's sender pool; A2P campaign + service features still apply).
4. **Callbacks answered by the agent that called** — most recent live enrollment's
   bound agent → the number's own agent → the account's inbound agent → today's
   behavior.
5. Toggle label **"Rotate numbers"**; default OFF = byte-identical to today.

## Data model

- `sequences.rotate_phone_numbers BOOLEAN NOT NULL DEFAULT false`
- `sequences.rotation_phone_number_ids UUID[]` — pool in rotation order, plain
  array (no FK: number rows are hard-deleted on release, so dispatch filters to
  rows that still exist, are active and VAPI-synced; the card prunes stale ids).
  CHECK: ON ⇒ non-empty pool; a stored pool while OFF is fine.
- `sequence_enrollments.outbound_phone_id UUID REFERENCES tenant_phone_numbers(id)
  ON DELETE SET NULL` + partial index — the sticky number; a released number
  re-picks on the next touch.

## Components

- **`sequencer/src/lib/outbound-phone.ts`** (new) — `resolveRotationPhone()`:
  sequence flag → eligible pool in saved order → sticky if still eligible, else
  Redis `INCR seq:phone-rotation:{sequenceId}` round-robin pick + CAS write on
  the enrollment (concurrent voice job + chatbot SMS can't diverge; the loser
  adopts the winner). Never throws; `null` ⇒ caller uses its legacy path.
  `resolveVoiceCallerId()`: rotation first, then the legacy 3-tier moved here
  verbatim.
- **Scheduler** (voice dispatch) calls `resolveVoiceCallerId`; **vapi-worker**
  resolves at dial time when a job carries no `phoneNumberId` (closes the
  self-healer gap); **sms-worker** asks `resolveRotationPhone` and sends
  `from` (+ `messagingServiceSid`). Every SMS enqueue site carries
  `enrollmentId`, so chatbot replies and booking-link texts reuse the sticky number.
- **Logging**: from-number / VAPI phone id recorded in the existing JSONB
  `sequence_execution_log.provider_response` (no migration).
- **App**: `listRotationPhoneOptions` + `updateSequencePhoneRotation` actions
  (same skeleton as `updateSequencePacing`; validates ownership/active/VAPI-synced;
  syncs picked numbers into the tenant's Twilio Messaging Service by listing then
  adding missing ones BEFORE the write), a `NumberRotationCard` mounted in both
  sequence views next to the Calling Schedule card.
- **Callbacks**: `resolveInboundAssistant` in `src/app/api/webhooks/vapi/route.ts`
  — dialed `phoneNumberId` → tenant → caller's most recent live enrollment →
  campaign agent (fallbacks above) → response gains `assistantId`.

## Semantics / edge cases

- OFF: resolver returns before reading `outbound_phone_id`; behavior unchanged.
- ON with an unusable pool or a Redis/DB error → warn + legacy path; never blocks.
- Pool shrinks → sticky not in pool = unassigned → CAS overwrite, re-pick.
- Number released → FK nulls the sticky → re-pick; a job already stamped with the
  dead VAPI id fails at VAPI → healer re-queue → worker re-resolves.
- First touch may be SMS or voice; retries and capacity requeues reuse the number.
- Test enrollments rotate like live ones. Cursor TTL expiry restarts at slot 0.

## Known limitations (deliberately out of scope)

- SMS capability checks / test preflight still key on a Messaging Service OR a
  `purpose='sequencer'` number; rotation itself ignores `purpose`.
- No per-number daily cap (the per-sequence cap still applies).
