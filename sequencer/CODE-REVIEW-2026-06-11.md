# Sequencer Code Review — 2026-06-11 (commit 5280cab)

Three parallel reviewers covered workers, server/webhooks, and core libs (~13k lines, 36 files).
Verdict: **not production-ready.** The voice path is the most mature slice; the SMS stack appears
broken against the repo's schema, compliance (STOP/opt-out) has real holes, and the entire
"learning" layer (A/B, attribution, mutation outcomes, healing success) reads counters nothing writes.

---

## CRITICAL

### C1. SMS/Twilio stack queries columns that don't exist in the schema
`tenant_twilio_accounts` / `tenant_phone_numbers` / `tenant_a2p_registrations` are keyed on
`client_id` + `status` (`supabase/type-b-schema.sql:128-176`), and the Next.js writers insert that way.
But the sequencer queries `.eq('tenant_id', …).eq('is_active', true)` in:
- `src/workers/sms-worker.ts:30-76` → `getTenantTwilioConfig` returns null → **every SMS job fails**
- `src/server/middleware/webhook-auth.ts:26-31` → **all signed Twilio callbacks 403**
- `src/server/routes/twilio-webhooks.ts:48-54` → generic `/sms-inbound` always "Unknown destination"
- `src/server/routes/health.ts:106-166` → `/admin/umbrellas` 500s, `/migrate` always 404s
The scheduler's own voice path uses `client_id`/`status` correctly (`scheduler-worker.ts:779-783`).
Fix: use `client_id` + `status='active'` everywhere. If the live DB was hand-patched, reconcile migrations.

### C2. Twilio webhooks can't be parsed at all — missing form-body parser
`webhook-server.ts` registers only `@fastify/cors`; no `@fastify/formbody` and no content-type parser.
Twilio posts `application/x-www-form-urlencoded` → Fastify 4 replies **415 before the handler runs**.
All SMS status callbacks (`sms-worker.ts:281` sets statusCallback) and inbound SMS are dead on arrival.
Fix: `npm i @fastify/formbody` and register it.

### C3. STOP / opt-out is not deterministically or durably honored (TCPA/CAN-SPAM)
- No keyword check anywhere — opt-out detection is 100% GPT-4o. If OpenAI errors or misclassifies,
  a literal "STOP" text **continues the sequence** (`event-processor.ts:461-464, 586-591`).
  Fix: deterministic regex (`/^\s*(stop|stopall|unsubscribe|cancel|end|quit)\b/i`) before the LLM.
- `intent === 'stop'` only sets the one enrollment to `manual_stop` (`event-processor.ts:546-553`,
  email at `:1171-1173`); only the chatbot path writes `contacts.opted_out_at` (`:833-847`).
  Other active enrollments keep calling/texting; re-ingestion re-enrolls them
  (`lead-ingestion.ts:205-261` never checks `opted_out_at`).
- Scheduler DNC gate covers only `['sms','voice']` (`scheduler-worker.ts:425`) — email opt-outs are
  ignored. No List-Unsubscribe header, no unsubscribe endpoint, no HELP/START/UNSTOP handling.

### C4. Dynamic (JIT) sequences can send one lead's personalized content to another lead
`insertGeneratedStep` writes per-enrollment AI content into the **shared** `sequence_steps` table,
keyed only by `(sequence_id, step_order)` with a UNIQUE constraint (`dynamic-step-generator.ts:350-365`,
`type-b-schema.sql:308`). With 2+ enrollments on one dynamic sequence, the second insert violates the
constraint, returns null — and **both callers ignore the null** (`event-processor.ts:195-207`,
`scheduler-worker.ts:1126-1138`) and activate anyway. The scheduler then serves whatever row exists at
that step_order: **contact A's personalized message goes to contact B**.
Fix: add `enrollment_id` to generated steps + scheduler lookup; treat failed insert as hard error.

### C5. No send idempotency — crashes/silent DB failures cause duplicate outreach
`processStep` dispatches to queues, then advances state with **unchecked** supabase writes
(supabase-js returns `{error}`, never throws — e.g. `scheduler-worker.ts:964-974, 1030-1038`).
If advance fails or process dies in between, the 5-min lease expires and the same step re-dispatches
**every 5 minutes forever**. This failure mode already happened once (see migration
`20260504-enrollment-status-add-dynamic-states.sql`: "148 failed jobs").
Compounding: no deterministic BullMQ `jobId`s; send workers don't check the execution log before
sending; SIGTERM calls `process.exit(0)` without draining the tick (`scheduler-worker.ts:1234-1238`).
Fix: check advance result; idempotent jobIds (`enrollmentId:stepId`); `SET NX` guard before send; drain on SIGTERM.

### C6. Business-hours rescheduling loops forever for tenants whose window isn't 8am
`getNextBusinessHoursStart` ignores its `_businessHours` arg and hardcodes 08:00
(`scheduler-worker.ts:162-172`). Tenant with 09:00 start: rescheduled to 08:00, fails the window check,
reschedules to *tomorrow* 08:00 → **step never sends**. Weekend gaps hit the same loop.
Also: the timezone math double-converts (`utcToZonedTime` then `formatInTimeZone`), producing past
reschedules and a 5-second claim churn overnight (workers I7).

### C7. The A/B / learning loop is structurally dead end-to-end
- `step_variants.total_replies` / `total_conversions` are written **nowhere** — `conv_rate` is
  permanently 0, `evaluateTest` can never find a winner (the recent ≥3-variant fix sits on dead counters).
- RPCs `increment_enrollment_sms` (`sms-worker.ts:114-130`) and `increment_step_attributed_conversions`
  (`outcome-learning.ts:139-148`) **do not exist in any migration**; the try/catch fallbacks are dead
  code because `supabase.rpc()` returns `{error}` instead of throwing. `sms_sent` and attributed
  conversions are silently dropped.
- The scheduler's `variant_id` stamp races the worker (`scheduler-worker.ts:917-926` runs before the
  worker inserts the log row) — matches zero rows.
- `step_mutations.resulted_in_reply/conversion` and `healing_log.healing_succeeded` also never written.

### C8. Email/SMS tracking updates keyed by `step_id` smear across all enrollments
Tracking pixel/click URLs encode only the step id (`email-worker.ts:105-107`); `handleSmsDelivery`,
`handleEmailOpened/Clicked/Bounced` update `sequence_execution_log` filtered by `step_id` only
(`event-processor.ts:884-1032`). Static sequences share steps across all enrollments → one contact's
open/delivery status overwrites everyone's, and `.single()` lookups error with >1 row.
Fix: encode execution-log id (or enrollmentId) in tracking URLs; filter updates by `enrollment_id`.

---

## IMPORTANT (selected)

1. **VAPI `end-of-call-report` dedup race** — `tryClaimCall` result ignored (`vapi-webhooks.ts:474-497`);
   concurrent status-update + report double-queues `call-outcome` → double concurrency-slot release.
2. **VAPI metadata extraction misses `message.call.metadata`** (`vapi-webhooks.ts:413`) — nested-form
   events drop tenant/enrollment → slot leaks, outcomes lost.
3. **VAPI wiring risk**: every assistant-creation path sets `server.url` to the Next.js app, which does
   NOT forward to the sequencer. Assistant-level URL overrides org-level — verify the sequencer's
   `/webhooks/vapi/call-events` actually receives traffic.
4. **No retries/cleanup on any BullMQ queue** (`redis.ts:38-45`) — 1 attempt default: transient Twilio/
   SMTP/OpenAI errors permanently drop touches; completed/failed jobs retained in Redis forever.
5. **Concurrency slots leak** — release only happens on call-outcome event; lost webhook = phantom slot,
   no TTL/reconciliation; per-tenant usage drifts permanently (`concurrency-manager.ts:116-126`).
6. **No Twilio/email webhook idempotency** — no MessageSid dedup; Twilio retries/replays re-run EI and
   re-send chatbot SMS (contrast: VAPI has Redis dedup).
7. **Self-healer bypasses every gate** — healing dispatches push directly onto queues, skipping TCPA
   window, opt-out, business hours (`self-healer.ts:340-356, 483-537`); scheduler override path
   double-sends; `call_busy` retries every 15 min forever (no cap); step rollback is a stale
   read-modify-write.
8. **No OpenAI timeout anywhere** (7 libs, SDK default 10 min) and the scheduler tick is serial —
   one hung call stalls dispatch for all tenants. Repo's own pattern (`openai-extractor.ts`) passes timeout.
9. **A/B winner criterion still wrong with ≥3 variants** — promotes if leader beats ANY loser
   (`outcome-learning.ts:847-848`, `.some` should be `.every`); winner permanently overwrites step content.
10. **TCPA quiet hours use the tenant's timezone, not the contact's** (`scheduler-worker.ts:403`) —
    NY tenant calls CA lead at 5:30am local.
11. **Lead-ingestion bearer token is global** — one token can enroll/contact leads in every tenant
    (`lead-ingestion.ts:312`); Next.js side has per-client keys, this side doesn't.
12. **Open redirect** at `/webhooks/email/track/click/:id?url=...` (`email-webhooks.ts:129-138`).
13. **No phone normalization** — `libphonenumber-js` installed, never imported; raw-string dedup
    means Twilio E.164 replies don't match stored contacts → STOPs land as "untracked contact".
14. **Inbound email sender never verified** — anyone who learns an enrollment UUID (it's in Reply-To)
    can forge replies into EI/chatbot (`email-webhooks.ts:49-81`).
15. **`SEQUENCER_DISABLE_WEBHOOK_AUTH=1` disables everything incl. admin auth** (`webhook-auth.ts`);
    gate on NODE_ENV. `.env.example` omits every auth secret the middleware requires (fail-closed
    503s on a fresh deploy).
16. **Escalated leads keep getting automated outreach** — `handleDynamicTimeout` doesn't check
    `needs_human_intervention` (`scheduler-worker.ts:1059-1150`).
17. **Non-conversion end states recorded as `completed`** (opt-out, lead_lost) — inflates
    completion_rate, deflates opt_out_rate in analytics (`dynamic-step-generator.ts:407-415`).
18. **Prompt injection** — lead-supplied text flows un-fenced into action-driving prompts (voice agent
    system prompt, JIT generator, responders); `validateAnalysis` whitelists only 2 of ~7 enum fields.

---

## FUNCTIONALITY GAPS

- Gmail API sending is a TODO stub — falls back to SMTP or throws (`email-worker.ts:174-200`).
- Email bounce ingestion: `handleEmailBounced` is dead code; no route emits `email-bounced`.
- No unsubscribe endpoint / List-Unsubscribe header; no HELP/START/UNSTOP keywords; opt-out never clearable.
- `only_if` step conditions: read, never enforced (explicit TODO, `scheduler-worker.ts:200-204`).
- `healingQueue`/`analyticsQueue` declared but unused; healing runs synchronously inside event processing.
- Capacity-exhausted VAPI calls dropped after ~3 min of retries without healing/reschedule (`vapi-worker.ts:378-398`).
- `capacity_exhausted`/`call_failed` healing branches unreachable from the worker; `inject_fallback_sms`
  never re-queues the call despite its docstring.
- Unhandled VAPI events (hang, transcript, tool-calls, transfer-destination-request); `assistant-request`
  returns `{ok:true}` with no assistant payload.
- `supabase/migrations/schema.sql` is an **empty 0-byte untracked file** — real DDL lives in
  `supabase/*.sql`. Populate or delete; as-is it's a trap.
- No dead-letter handling or alerting on any worker; failures are console.error only.
- Per-contact timezone is not modeled at all (see Important #10).
- `emails_sent` counter never incremented; unrendered `{{placeholders}}` sent literally to leads.

---

## Suggested fix order

1. C1 + C2 (SMS stack literally non-functional) — then add one integration test that POSTs a real
   form-encoded Twilio payload through the server.
2. C3 (compliance: deterministic STOP, contact-level opt-out on all paths, email in DNC gate,
   opt-out check at enrollment).
3. C5 + queue retry/cleanup policy + idempotent jobIds (duplicate-outreach class).
4. C4 (JIT cross-contamination), C6 (business hours), C8 (tracking attribution).
5. C7 + Important list (learning loop, races, leaks, security hardening).
