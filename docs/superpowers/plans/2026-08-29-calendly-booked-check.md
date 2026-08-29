# Calendly Booked-Check Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Before dispatching any sequence follow-up, ask Calendly whether the lead's email already booked a meeting; if so, mark the enrollment `booked` and stop.

**Architecture:** A new sequencer lib module polls Calendly's `GET /scheduled_events?invitee_email=` with the tenant's stored PAT (Redis-cached negatives, fail-open). A new gate in `processStep` (scheduler-worker) right after the opt-out gate consumes it, mirroring the AI-booked path's enrollment fields + attribution. Cosmetic label additions on the Next.js side.

**Tech Stack:** TypeScript (sequencer, tsc build, ESM `.js` import suffixes), Supabase, ioredis, global `fetch` (Node ≥18), Calendly REST API v2.

**Spec:** `docs/superpowers/specs/2026-08-29-calendly-booked-check-design.md`

**Testing note:** The sequencer has no test runner (no `test` script; repo convention is `tsc` + probe scripts under `sequencer/scripts/`). Verification is typecheck/build per task + a live probe script (Task 5). This deviates from TDD deliberately, following repo convention.

---

### Task 1: Move `attributeVariantOutcome` into the shared attribution lib

It's currently private to `event-processor.ts`. The scheduler gate needs it too, and importing from `event-processor` would boot that worker's BullMQ consumers inside the scheduler process. Its sibling `computeStepAttribution` already lives in `outcome-learning.ts`.

**Files:**
- Modify: `sequencer/src/lib/outcome-learning.ts` (add exported function)
- Modify: `sequencer/src/workers/event-processor.ts:144-175` (delete local copy, extend existing import at line 48)

- [ ] **Step 1: Add the function to `outcome-learning.ts`**

Append near `computeStepAttribution` (body identical to the event-processor original except the log prefix):

```ts
/**
 * A/B variant attribution (last-touch): credit the most recently sent
 * variant for this enrollment with a reply or a conversion.
 * (Moved from event-processor so the scheduler's Calendly booked-gate can
 * credit conversions without importing a worker module.)
 */
export async function attributeVariantOutcome(
    enrollmentId: string,
    kind: 'reply' | 'conversion'
): Promise<void> {
    const { data: logRow, error: logErr } = await supabase
        .from('sequence_execution_log')
        .select('variant_id')
        .eq('enrollment_id', enrollmentId)
        .not('variant_id', 'is', null)
        .order('executed_at', { ascending: false })
        .limit(1)
        .maybeSingle();

    if (logErr) {
        console.error(`[ATTRIBUTION] Variant attribution lookup failed for enrollment ${enrollmentId}:`, logErr);
        return;
    }
    if (!logRow?.variant_id) return;

    const rpcName = kind === 'reply' ? 'increment_variant_replies' : 'increment_variant_conversions';
    const { error: rpcErr } = await supabase.rpc(rpcName, { p_variant_id: logRow.variant_id });
    if (rpcErr) {
        console.error(`[ATTRIBUTION] ${rpcName} failed for variant ${logRow.variant_id}:`, rpcErr);
    } else {
        console.log(`[ATTRIBUTION] Variant ${logRow.variant_id} credited with ${kind} (enrollment ${enrollmentId})`);
    }
}
```

(`supabase` is already imported at the top of `outcome-learning.ts`.)

- [ ] **Step 2: Delete the local copy in `event-processor.ts` and import instead**

Delete the whole `attributeVariantOutcome` function (lines ~144-175 including its doc comment). Change line 48 from:

```ts
import { computeStepAttribution } from '../lib/outcome-learning.js';
```

to:

```ts
import { computeStepAttribution, attributeVariantOutcome } from '../lib/outcome-learning.js';
```

All existing call sites keep working unchanged.

- [ ] **Step 3: Verify build**

Run: `cd /Users/vishnuanilkumar/Omnify/sequencer && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add sequencer/src/lib/outcome-learning.ts sequencer/src/workers/event-processor.ts
git commit -m "refactor(sequencer): move attributeVariantOutcome to outcome-learning lib"
```

---

### Task 2: Create the Calendly booked-check module

**Files:**
- Create: `sequencer/src/lib/calendly-booking-check.ts`

- [ ] **Step 1: Write the module**

```ts
/**
 * Calendly booked-meeting check (dispatch-time poll).
 *
 * A lead who books directly on the tenant's Calendly page — via the booking
 * link we text/email — never tells Omnify, so follow-ups kept firing at
 * people who already booked. The AI-booked path flips the enrollment to
 * 'booked'; this module gives the scheduler the same signal for external
 * bookings, queried straight from Calendly right before a follow-up sends.
 *
 * Only works for tenants with an active tenant_calendly connection (PAT from
 * Settings → Integrations). Fail-open by design: any config/API problem
 * returns 'unavailable' and the send proceeds — a Calendly outage must not
 * freeze campaigns.
 */
import { supabase } from './db.js';
import { redis } from './redis.js';
import { decrypt } from './encryption.js';

const CALENDLY_API = 'https://api.calendly.com';
// A lead who hasn't booked is re-checked at most every 15 minutes, so
// parking/retry churn in the scheduler never hammers Calendly's rate limit.
const NEGATIVE_CACHE_TTL_SECONDS = 15 * 60;
const FETCH_TIMEOUT_MS = 8000;

export type CalendlyBookedResult = 'booked' | 'not_booked' | 'unavailable';

export async function checkLeadBookedOnCalendly(
    tenantId: string,
    contactEmail: string | null | undefined,
    enrolledAt: string
): Promise<CalendlyBookedResult> {
    const email = (contactEmail || '').trim().toLowerCase();
    if (!email) return 'unavailable';

    const minStart = new Date(enrolledAt);
    if (Number.isNaN(minStart.getTime())) return 'unavailable';

    const cacheKey = `calendly:not-booked:${tenantId}:${email}`;
    try {
        if (await redis.get(cacheKey)) return 'not_booked';
    } catch (err) {
        console.warn('[CALENDLY-CHECK] Redis read failed (continuing uncached):', err);
    }

    const { data: conn, error: connErr } = await supabase
        .from('tenant_calendly')
        .select('calendly_pat_encrypted, calendly_user_uri')
        .eq('client_id', tenantId)
        .eq('is_active', true)
        .maybeSingle();

    if (connErr) {
        console.warn(`[CALENDLY-CHECK] tenant_calendly lookup failed for ${tenantId}:`, connErr);
        return 'unavailable';
    }
    if (!conn?.calendly_pat_encrypted || !conn.calendly_user_uri) return 'unavailable';

    let pat = '';
    try {
        pat = decrypt(conn.calendly_pat_encrypted);
    } catch (err) {
        console.warn(`[CALENDLY-CHECK] PAT decrypt failed for tenant ${tenantId}:`, err);
        return 'unavailable';
    }
    if (!pat) return 'unavailable';

    // min_start_time = enrolled_at: catches meetings booked mid-sequence even
    // if they've already happened, ignores pre-enrollment history.
    // status=active excludes canceled bookings.
    const params = new URLSearchParams({
        user: conn.calendly_user_uri,
        invitee_email: email,
        status: 'active',
        min_start_time: minStart.toISOString(),
        count: '1',
    });

    try {
        const res = await fetch(`${CALENDLY_API}/scheduled_events?${params.toString()}`, {
            headers: { Authorization: `Bearer ${pat}` },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!res.ok) {
            console.warn(`[CALENDLY-CHECK] API ${res.status} for tenant ${tenantId} — failing open`);
            return 'unavailable';
        }
        const body = (await res.json()) as { collection?: unknown[] };
        if (Array.isArray(body.collection) && body.collection.length > 0) {
            return 'booked';
        }
    } catch (err) {
        console.warn(`[CALENDLY-CHECK] API call failed for tenant ${tenantId} — failing open:`, err);
        return 'unavailable';
    }

    try {
        await redis.set(cacheKey, '1', 'EX', NEGATIVE_CACHE_TTL_SECONDS);
    } catch {
        // Cache is best-effort; worst case we ask Calendly again next tick.
    }
    return 'not_booked';
}
```

- [ ] **Step 2: Verify build**

Run: `cd /Users/vishnuanilkumar/Omnify/sequencer && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add sequencer/src/lib/calendly-booking-check.ts
git commit -m "feat(sequencer): Calendly booked-meeting check with cached fail-open polling"
```

---

### Task 3: Wire the gate into `processStep`

**Files:**
- Modify: `sequencer/src/workers/scheduler-worker.ts` (imports ~line 44; gate inserted immediately after the opt-out gate's closing `}` at ~line 488, before the `// 1. Check skip conditions` comment)

- [ ] **Step 1: Extend imports**

The existing import from outcome-learning:

```ts
import {
    selectVariant,
    recordVariantSent,
} from '../lib/outcome-learning.js';
```

becomes:

```ts
import {
    selectVariant,
    recordVariantSent,
    computeStepAttribution,
    attributeVariantOutcome,
} from '../lib/outcome-learning.js';
```

And add below it:

```ts
import { checkLeadBookedOnCalendly } from '../lib/calendly-booking-check.js';
```

- [ ] **Step 2: Insert gate 0c after the opt-out gate**

Between the opt-out gate's `return;`+`}` (~line 488) and `// 1. Check skip conditions` (~line 490), insert:

```ts
    // 0c. Meeting-booked gate — a lead who booked on the tenant's Calendly
    // page (via the booking link we text/email) must not keep getting
    // follow-ups. Polled right before dispatch; negative results are
    // Redis-cached 15 min inside the check. Fail-open: 'unavailable'
    // (no Calendly connection, no email, API error) falls through to send.
    if (!isTestEnrollmentEarly(enrollment) && contact.email) {
        const bookedResult = await checkLeadBookedOnCalendly(
            enrollment.tenant_id,
            contact.email,
            enrollment.enrolled_at
        );
        if (bookedResult === 'booked') {
            console.log(
                `[SCHEDULER] Contact ${contact.id} already booked on Calendly — marking enrollment ${enrollment.id} as booked`
            );
            const { error: bookErr } = await supabase
                .from('sequence_enrollments')
                .update({
                    status: 'booked',
                    appointment_booked: true,
                    completed_at: new Date().toISOString(),
                    updated_at: new Date().toISOString(),
                })
                .eq('id', enrollment.id);
            if (bookErr) {
                // We KNOW they booked — never fall through to a send. Park
                // and let the next claim retry the status write.
                console.error(`[SCHEDULER] Failed to mark enrollment ${enrollment.id} booked:`, bookErr);
                await rescheduleStep(enrollment.id, new Date(Date.now() + 10 * 60_000));
                return;
            }
            const { error: logErr } = await supabase.from('sequence_execution_log').insert({
                enrollment_id: enrollment.id,
                step_id: step.id,
                channel: step.channel,
                action: 'skipped_meeting_booked',
                provider_id: null,
                provider_response: { source: 'calendly_poll', invitee_email: contact.email },
                call_status: 'skipped',
                executed_at: new Date().toISOString(),
            });
            if (logErr) {
                console.error(`[SCHEDULER] Failed to log meeting-booked skip for enrollment ${enrollment.id}:`, logErr);
            }
            try {
                await computeStepAttribution(enrollment.id, 'booked');
            } catch (err) {
                console.error('[SCHEDULER] Attribution computation failed:', err);
            }
            try {
                await attributeVariantOutcome(enrollment.id, 'conversion');
            } catch (err) {
                console.error('[SCHEDULER] Variant attribution failed:', err);
            }
            return;
        }
    }
```

Note: `rescheduleStep` is defined later in the same file (~line 1426) — function hoisting makes it callable here, same as other gates do.

- [ ] **Step 3: Verify build**

Run: `cd /Users/vishnuanilkumar/Omnify/sequencer && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add sequencer/src/workers/scheduler-worker.ts
git commit -m "feat(sequencer): stop follow-ups when the lead already booked on Calendly"
```

---

### Task 4: Timeline labels for the new skip action (Next.js side)

**Files:**
- Modify: `src/lib/analytics/index.ts:67-77` (`BLOCKED_LABELS` map)
- Modify: `src/app/actions/sequence-actions.ts:~3235` (test-event severity switch)

- [ ] **Step 1: Add to `BLOCKED_LABELS`**

After the `skipped_conditions` entry add:

```ts
    skipped_meeting_booked: { label: "Stopped, meeting booked", tone: "muted" },
```

(`tone: "muted"` is already used by sibling entries, so it's in `BlockedReason["tone"]`. If a positive tone like `"emerald"` exists in that union, prefer it — check the type before choosing.)

- [ ] **Step 2: Add a case to the severity switch in `sequence-actions.ts`**

Next to `case "skipped_opt_out":` add:

```ts
        case "skipped_meeting_booked":
            return {
                severity: "ok",
                explanation: "Lead already booked a meeting on Calendly — sequence stopped.",
            };
```

(`severity: "ok"` is an existing `TestEventSeverity` value — see the `sms_sent` case.)

- [ ] **Step 3: Verify the Next.js side compiles**

Run: `cd /Users/vishnuanilkumar/Omnify && npx tsc --noEmit -p tsconfig.json 2>&1 | head -20`
Expected: no NEW errors attributable to these two files (pre-existing unrelated errors, if any, are out of scope).

- [ ] **Step 4: Commit**

```bash
git add src/lib/analytics/index.ts src/app/actions/sequence-actions.ts
git commit -m "feat(sequences): render the skipped_meeting_booked timeline action"
```

---

### Task 5: Live probe script

**Files:**
- Create: `sequencer/scripts/test-calendly-booked-check.mjs`

Modeled on `sequencer/scripts/verify-twilio-creds.mjs` (loads `.env.production`, direct Supabase client, local decrypt copy — copy the exact `decrypt` implementation from that script).

- [ ] **Step 1: Write the probe**

```js
#!/usr/bin/env node
/**
 * READ-ONLY probe for the Calendly booked-meeting check.
 *
 * Replicates exactly what sequencer/src/lib/calendly-booking-check.ts does
 * (minus the Redis cache) so the query can be exercised against a real
 * tenant + email without deploying.
 *
 * Usage (from sequencer/):
 *   node scripts/test-calendly-booked-check.mjs --tenant <uuid> --email <addr> [--since <ISO date>]
 *
 * Expected:
 *   - email that booked on the tenant's Calendly  → BOOKED (lists events)
 *   - email with no booking                       → NOT BOOKED
 *   - tenant without an active Calendly connection → UNAVAILABLE
 */
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env.production') });

const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i !== -1 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d; };
const tenantId = opt('tenant', null);
const email = (opt('email', '') || '').trim().toLowerCase();
const since = opt('since', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());

if (!tenantId || !email) {
    console.error('Usage: node scripts/test-calendly-booked-check.mjs --tenant <uuid> --email <addr> [--since <ISO>]');
    process.exit(1);
}

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY);

function decrypt(enc) {
    const SHAPE = /^[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;
    if (!SHAPE.test(enc)) return enc; // legacy plaintext passthrough (mirrors encryption.ts)
    const key = Buffer.from(process.env.ENCRYPTION_KEY, 'hex');
    const [iv, tag, ct] = enc.split(':');
    const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
    d.setAuthTag(Buffer.from(tag, 'base64'));
    return d.update(ct, 'base64', 'utf8') + d.final('utf8');
}

const { data: conn, error } = await sb
    .from('tenant_calendly')
    .select('calendly_pat_encrypted, calendly_user_uri, calendly_user_email')
    .eq('client_id', tenantId)
    .eq('is_active', true)
    .maybeSingle();

if (error) { console.error('DB error:', error.message); process.exit(1); }
if (!conn?.calendly_pat_encrypted || !conn.calendly_user_uri) {
    console.log('RESULT: UNAVAILABLE (no active Calendly connection for this tenant)');
    process.exit(0);
}

const pat = decrypt(conn.calendly_pat_encrypted);
console.log(`Calendly account: ${conn.calendly_user_email}  (user ${conn.calendly_user_uri})`);
console.log(`Checking invitee_email=${email} min_start_time=${since}\n`);

const params = new URLSearchParams({
    user: conn.calendly_user_uri,
    invitee_email: email,
    status: 'active',
    min_start_time: new Date(since).toISOString(),
    count: '5',
});
const res = await fetch(`https://api.calendly.com/scheduled_events?${params.toString()}`, {
    headers: { Authorization: `Bearer ${pat}` },
});
if (!res.ok) {
    console.error(`Calendly API ${res.status}:`, (await res.text()).slice(0, 300));
    console.log('RESULT: UNAVAILABLE (sequencer would fail open — send proceeds)');
    process.exit(0);
}
const body = await res.json();
const events = body.collection || [];
if (events.length === 0) {
    console.log('RESULT: NOT BOOKED (follow-ups would proceed)');
} else {
    console.log(`RESULT: BOOKED — ${events.length} event(s); enrollment would stop:`);
    for (const ev of events) {
        console.log(`  - ${ev.name || '(unnamed)'} @ ${ev.start_time} [${ev.status}]`);
    }
}
```

- [ ] **Step 2: Syntax-check the probe**

Run: `cd /Users/vishnuanilkumar/Omnify/sequencer && node --check scripts/test-calendly-booked-check.mjs`
Expected: no output (valid syntax).

- [ ] **Step 3: Run it live against a connected tenant**

Run: `node scripts/test-calendly-booked-check.mjs --tenant <tenant-with-calendly> --email <email-that-booked>`
Expected: `RESULT: BOOKED` with the event listed. Then run with a made-up email → `RESULT: NOT BOOKED`. (Requires `.env.production` locally; if absent, hand the command to the user.)

- [ ] **Step 4: Commit**

```bash
git add sequencer/scripts/test-calendly-booked-check.mjs
git commit -m "test(sequencer): live probe for the Calendly booked-meeting check"
```

---

### Task 6: Full build + deployment notes

- [ ] **Step 1: Full sequencer build**

Run: `cd /Users/vishnuanilkumar/Omnify/sequencer && npm run build`
Expected: clean `tsc` exit; `dist/lib/calendly-booking-check.js` exists.

- [ ] **Step 2: Verify the compiled gate is in dist**

Run: `grep -l "skipped_meeting_booked" dist/workers/scheduler-worker.js && grep -l "calendly" dist/lib/calendly-booking-check.js`
Expected: both paths print.

- [ ] **Step 3: Deploy (user's canonical procedure — do not use scripts/deploy.sh)**

Per `sequencer-ec2-deploy-procedure` memory: build → rsync `dist/` only → `pm2 reload ecosystem.production.config.js` → grep-verify + confirm 9 processes online. The Next.js label change deploys via normal git push to main (Vercel).
