# Calendly booked-check gate — design

**Date:** 2026-08-29
**Status:** Approved (dispatch-time check chosen over webhook / both)

## Problem

Sequence follow-ups keep firing after a lead books a meeting directly on the
tenant's Calendly link. The AI-booked path already stops the sequence
(`status='booked'` via event-processor / vapi-webhooks), but a lead who clicks
the `booking_link` from an SMS/email and books on Calendly's page is invisible
to Omnify: the Calendly webhook route deliberately ignores `invitee.created`,
the enrollment stays `active`, and the scheduler keeps sending follow-ups.
A booked lead receiving "grab a time here" texts reads as a broken product.

## Scope

- Applies only to tenants with an **active Calendly connection**
  (`tenant_calendly` row with a PAT, connected in Settings → Integrations).
  A pasted `booking_link` alone cannot authenticate API calls.
- Applies only to enrollments whose **contact has an email** — Calendly's
  scheduled-events filter is by invitee email.
- Live enrollments only; `is_test` enrollments bypass the gate (same as the
  business-hours / TCPA / fatigue gates).

## Design

### 1. `sequencer/src/lib/calendly-booking-check.ts` (new)

One exported function:

```ts
checkLeadBookedOnCalendly(tenantId, contactEmail, enrolledAt)
  → Promise<'booked' | 'not_booked' | 'unavailable'>
```

- Loads the active `tenant_calendly` row; decrypts `calendly_pat_encrypted`
  with the sequencer's existing `decrypt()` (same AES-256-GCM format +
  `ENCRYPTION_KEY` as the Vercel side — verified compatible).
- Queries
  `GET /scheduled_events?user={calendly_user_uri}&invitee_email={email}&status=active&min_start_time={enrolledAt}&count=1`.
  Any returned event ⇒ `'booked'`.
  - `min_start_time = enrolled_at` catches meetings that already happened
    (booked mid-sequence for a date that has since passed) as well as
    upcoming ones, and ignores stale pre-enrollment history.
  - `status=active` excludes canceled bookings — a lead who books then
    cancels keeps receiving follow-ups **unless** the gate already fired;
    once marked `booked` the stop is permanent (matches the AI-booked path).
- **Redis negative cache**: `calendly:not-booked:{tenantId}:{emailLower}`,
  TTL 15 minutes — parking/retry churn never hammers Calendly, and the
  rate cost is bounded by dispatch volume. A `'booked'` result needs no
  cache (the enrollment is terminally marked).
- Missing connection, missing email, HTTP error, or timeout ⇒
  `'unavailable'` → **fail open** (send proceeds, warning logged).
  A Calendly outage must not freeze every campaign; worst case is today's
  status quo.

### 2. Gate in `processStep` (scheduler-worker.ts)

Slotted immediately after the opt-out gate (0b), before skip-conditions and
all LLM/dispatch work. On `'booked'`:

- Update enrollment: `status='booked'`, `appointment_booked=true`,
  `completed_at=now` — identical fields to the AI-booked path, so
  analytics/UI need no changes.
- Insert `sequence_execution_log` row with `action='skipped_meeting_booked'`,
  `call_status='skipped'`, `provider_response={ source: 'calendly_poll' }` —
  the Unibox timeline shows why follow-ups stopped.
- Run the same conversion attribution as the AI-booked path:
  `computeStepAttribution(enrollmentId, 'booked')` + variant conversion
  credit, each in try/catch.
- Return without advancing. `'not_booked'` / `'unavailable'` fall through to
  the remaining gates.

### 3. UI label (Next.js side, cosmetic)

Add `skipped_meeting_booked` to the action→label map in
`src/lib/analytics/index.ts` (and the switch in `sequence-actions.ts` if it
gates display) so the timeline renders "Skipped — meeting already booked".

## Non-goals

- No DB migration (all columns/statuses exist), no new env vars.
- No `invitee.created` webhook handling (rejected alternative; can be added
  later as a freshness enhancement).
- No `appointments` row insert — that table records bookings Omnify created.
- No changes to chatbot / self-healer / booking-link-SMS paths — their
  existing `status==='booked'` / `appointment_booked` guards respect the
  mark once the gate sets it.
- No cancel-resume (booked-then-canceled stays stopped once marked).

## Failure policy

Fail open on any Calendly/API/Redis error: log a warning, let the send
proceed. Deliberate trade-off approved in design review.

## Verification

- `tsc` build of the sequencer (no test runner exists; repo convention is
  typecheck + probe scripts).
- `sequencer/scripts/test-calendly-booked-check.mjs`: runs the check against
  a real connected tenant — a known-booked email returns `booked`, an
  unknown email returns `not_booked`, a tenant without Calendly returns
  `unavailable`.
- Deploy via the canonical 4-step EC2 procedure (build → rsync dist →
  pm2 reload → verify 9 online).
