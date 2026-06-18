# Sequencer Deploy Checklist — 2026-06-11 review fixes

Run these **in order**. Steps 1–3 must happen before/with the code deploy or the
sequencer regresses (the scheduler claim RPC and auth secrets are hard prerequisites).

## 1. Apply the DB migration FIRST (hard blocker)

Apply `supabase/migrations/20260611-sequencer-review-fixes.sql` to the live Supabase DB
(SQL editor or your migration tool).

Why first: the scheduler now claims due enrollments via `rpc('claim_due_enrollments', …)`.
If that function doesn't exist, the scheduler claims **zero** enrollments and the whole
sequencer stops dispatching — a full outage. The migration also adds the
`increment_enrollment_*`, `increment_variant_*`, and `increment_step_attributed_conversions`
RPCs plus `sequence_steps.enrollment_id`.

## 2. Sequencer env (`sequencer/.env.production`)

Already present: `VAPI_WEBHOOK_SECRET`, `LEAD_INGESTION_API_TOKEN`, `EMAIL_INBOUND_API_TOKEN`,
`ADMIN_API_TOKEN`. Add the one newly-required var:

```
TRACKING_BASE_URL=https://<sequencer-public-url>   # email pixels / click links / unsubscribe
# Optional:
# TRACKING_SIGNING_SECRET=...        # falls back to ENCRYPTION_KEY if unset
# CORS_ALLOWED_ORIGINS=https://app.<domain>
```

## 3. Next.js (Vercel) env — for VAPI → sequencer forwarding

The sequencer's outbound calls report their outcomes to the Next.js `/api/webhooks/vapi`
route (that's where every VAPI assistant's serverUrl points). That route now forwards
sequencer-originated events (those with `metadata.enrollmentId`) to the sequencer. Add:

```
SEQUENCER_WEBHOOK_URL=http://<sequencer-ip>:3000   # the EC2 webhook server, no trailing slash
```

**Critical:** `VAPI_WEBHOOK_SECRET` must be the SAME value on Vercel and in
`sequencer/.env.production`. Next.js forwards it as the `X-Vapi-Secret` header and the
sequencer validates against its own `VAPI_WEBHOOK_SECRET`. Mismatch → sequencer 403s every
forwarded event → call outcomes never processed.

Inbound/dashboard calls (no enrollmentId) are not forwarded; client-webhook/CRM forwarding
still fires for all calls including sequence calls.

## 4. Deploy the code

```bash
./deploy-sequencer.sh            # builds dist/ locally, uploads, npm install (picks up @fastify/formbody), restarts PM2
```

Redeploy the Next.js app to Vercel (the forwarding change in
`src/app/api/webhooks/vapi/route.ts` ships with it).

## 5. Verify

- `pm2 list` on EC2 → all workers `online`.
- Place one test sequence call. Confirm in sequencer logs: `[VAPI] Webhook: status-update`
  / `end-of-call-report` arriving (forwarded from Next.js), and the concurrency slot
  releasing. In Vercel logs look for `[VAPI→SEQ] Forward returned` only on errors.
- Send one test SMS through a sequence; confirm it sends (not "No Twilio configuration") and
  a reply with "STOP" sets `contacts.opted_out_at`.
- Trigger one email step; confirm the tracking pixel/unsubscribe URLs use TRACKING_BASE_URL.

## Notes / still-deferred

- Gmail API sending is still a TODO stub (SMTP fallback works).
- Per-contact timezone for TCPA windows isn't modeled (tenant timezone used; see compliance.ts).
- `supabase/migrations/schema.sql` is an empty 0-byte file (left as-is).
- If a forward to the sequencer fails, the sequencer's awaiting_outcome timeout reconciler is
  the backstop — enrollments degrade (delayed) rather than stall permanently.
