# SMS & Email Channel Parity — Intent-Guided Generation + Email Reply Loop

## Problem

Voice has full contextual intelligence: conversation memory, EI analysis, tone adaptation, dynamic prompts per call. SMS and email are dumb pipes by comparison.

**SMS outbound:** Static template → variable substitution → optional mutation → send. The mutation engine tries to add context, but the base content is whatever was written at sequence creation time. Meanwhile the SMS *inbound* responder (sms-responder.ts) is a full GPT-4o chatbot with business context, conversation history, and goal awareness. A customer gets a generic outbound followed by a contextually perfect reply — tonal whiplash.

**Email outbound:** Same static template pipe as SMS. No tracking pixels, no click rewriting — the open/click/bounce handlers exist in event-processor but have no webhook source feeding them.

**Email inbound:** Nothing. No reply handling. Replies go to a black hole. No EI analysis, no conversation memory update. The `reply_to_email` field exists in `tenant_email_accounts` but is never read.

---

## Solution Overview

Every channel gets the same intelligence voice has. Three parts:

1. **Intent-guided generation** for outbound SMS and email
2. **Step awareness** for inbound responders
3. **Email reply loop** (Gmail-first via SMTP, configurable auto-reply)

---

## Part 1: Intent-Guided Outbound Generation

### The Concept

Instead of writing the actual message in the step, the user (or AI sequence generator) writes a **brief** — the intent of the message. At dispatch time, GPT generates the actual content using the brief + conversation memory + brand voice + EI state.

### Step Brief Schema

New optional field on `sequence_steps`:

```
step_brief: {
  intent: "re-engage after 3 days of silence",
  key_points: ["reference the roof inspection quote", "create soft urgency"],
  cta: "get them to confirm a time",
  constraints: ["don't mention price", "keep casual"],
  channel_hints: {
    sms: { max_length: 160 },
    email: { tone: "professional", include_subject: true }
  }
}
```

The existing `content` field (SmsContent / EmailContent) remains as **fallback** — used if brief generation fails or if the step is a legacy static step.

### How It Works at Dispatch Time (scheduler-worker)

```
1. Load step + conversation context + brand voice + EI state (already happening)
2. If step has step_brief:
   a. Call generateOutboundContent(channel, brief, context, brandVoice, eiState)
   b. GPT generates message using brief as strategic guide
   c. If generation fails → fall back to step.content + existing template rendering
3. If step has NO step_brief:
   a. Use existing template rendering flow (backward compatible)
4. Dispatch to channel worker as usual
```

### The Generation Function

One shared function, channel-specific constraints:

**Input:**
- Channel (sms | email)
- Step brief (intent, key_points, cta, constraints)
- Conversation context (prior calls, SMS exchanges, email opens — from conversation-memory.ts)
- Brand voice + business profile (from tenant_profiles)
- EI state (sentiment trend, emotion, hot lead flag — from enrollment EI data)
- Contact info (name, company, custom fields)
- Step context: which step number this is, what previous steps did, what outcomes occurred

**Output:**
- SMS: `{ body: string }` — the generated message
- Email: `{ subject: string, body_text: string }` — plain text email (HTML later)

**Constraints baked into the system prompt:**
- SMS: 160 chars preferred, 320 max. Conversational tone. No links unless CTA requires it.
- Email: Subject under 60 chars. Body 3-5 sentences for follow-ups, longer for initial outreach. Plain text for now.
- Both: Match brand voice. Reference prior interactions naturally. Never reveal AI. Drive toward the CTA without being pushy. Respect constraints from brief.

### Example Flow

Step brief: `{ intent: "follow up after positive call", key_points: ["they asked about pricing"], cta: "send them the quote" }`

Conversation memory says: 4-minute call 2 days ago, customer asked about roof inspection cost, said they'd think about it, sentiment: warming.

**Generated SMS:**
> "Hey Mike, great talking Tuesday! I put together that inspection quote you asked about — want me to send it over? Happy to walk through it too."

vs. static template:
> "Hey {{first_name}}, just following up on our conversation. Let me know if you have any questions!"

### Where This Touches the AI Sequence Generator

`ai-generate-sequence-actions.ts` already generates full sequences via GPT. Currently it outputs static `content: { body: "..." }` for each step.

**Change:** When generating sequences, output `step_brief` instead of (or in addition to) static content. The brief is what the AI generates at creation time. The actual message is generated fresh at dispatch time with real-time context.

This means AI-generated sequences get smarter over time — same brief, but the generated messages adapt to how the conversation has evolved.

### What Happens to the Mutation Engine

For brief-based steps: **mutation engine is bypassed**. The generation IS the contextualization. No need to take static text and try to rewrite it — we're generating contextual text from scratch.

For legacy template-based steps: mutation engine continues to work as-is. Backward compatible.

This simplifies the flow for new sequences and reduces GPT calls (one generation call instead of template render + mutation call).

---

## Part 2: Step Awareness for Inbound Responders

### The Gap

The SMS responder (`sms-responder.ts`) knows the sequence goal but NOT which step triggered the reply. If step 1 was "cold outreach about a roof inspection" and step 3 was "follow up on a quote," the responder treats them identically.

### The Fix

When the event-processor routes an SMS reply to the responder, pass the **triggering step info**:

**Currently passed:**
- enrollmentId, sequenceId, contactId, clientId, inboundMessage, fromPhone

**Add:**
- `triggeringStep`: The last outbound step that was executed before this reply
  - `step_order`: Which step number
  - `channel`: What channel it was sent on
  - `content_summary`: What the outbound message said (or the brief intent)
  - `step_brief`: The brief if it exists
  - `sent_at`: When it was sent

**How to get it:** Query `sequence_execution_log` for the most recent outbound action for this enrollment. The log already stores the step_id — join to get step details.

**Impact on responder prompt:**

Add a section to the GPT system prompt:

```
TRIGGERING STEP:
The customer is replying to Step 3 (sent 2 hours ago via SMS).
Step intent: "follow up on the quote they requested"
What we sent: "Hey Mike, I put together that inspection quote you asked about — want me to send it over?"
```

This makes the responder's reply contextually anchored to the specific conversation moment.

### Same for Email Responder (Part 3)

The email responder (to be built) will receive the same triggering step context.

---

## Part 3: Email Reply Loop

### Architecture

Since tenants use SMTP (no Gmail API yet, Google OAuth pending), email reply ingestion requires a **reply-to routing strategy**.

### Option A: Unique Reply-To Addresses (Recommended)

Use a catch-all domain or subdomain for reply routing:

**Flow:**
1. When sending an outbound email, set the `Reply-To` header to a unique address:
   `reply+{enrollmentId}@replies.ominify.io` (or tenant's subdomain)
2. Configure the domain's MX records to route to an inbound email service (SendGrid Inbound Parse, Mailgun Routes, or AWS SES receiving)
3. The inbound service POSTs the email content to a webhook endpoint on the sequencer
4. The webhook extracts the enrollmentId from the reply-to address, queues an `email-reply` event

**Why this approach:**
- Works with any SMTP provider (tenant sends via their SMTP, replies come back to our domain)
- enrollmentId is embedded in the address — instant routing, no fuzzy matching
- Tenants don't need to configure anything — it's transparent

**Infrastructure needed:**
- A domain/subdomain for replies (e.g., `replies.ominify.io`)
- MX records pointing to an inbound email service
- One new webhook endpoint: `/webhooks/email/inbound`

### Option B: IMAP Polling (Simpler, Less Scalable)

Poll the tenant's inbox via IMAP for replies to sequence emails. Match by `In-Reply-To` / `References` headers.

**Downside:** Requires IMAP credentials, polling is slow, doesn't scale.

**Recommendation:** Option A. The unique reply-to address is cleaner, faster, and doesn't depend on tenant inbox access.

### Email-Worker Changes

In `email-worker.ts`, when sending:
- Set `Reply-To: reply+{enrollmentId}@replies.ominify.io`
- Set `Message-ID` header with a trackable ID
- These are the only changes to the sending path

### New: Email Inbound Webhook

New route: `/webhooks/email/inbound`

Receives POST from inbound email service with:
- `from`: sender email
- `to`: the reply-to address (contains enrollmentId)
- `subject`: email subject
- `text`: plain text body
- `html`: HTML body (if any)

Parses enrollmentId from the to-address, queues an `email-reply` event to the event processor.

### New: Email Reply Handler in Event Processor

Add `handleEmailReply` to `event-processor.ts`, mirroring `handleSmsReply`:

1. **EI Analysis:** Run `analyzeMessage()` on the reply body (same as SMS)
2. **Record Interaction:** Log to `contact_interactions` with channel='email', direction='inbound'
3. **Update Conversation Memory:** Call `updateContactConversationSummary()`
4. **Route to Email Responder:** If tenant has email responses enabled

### New: Email Responder

New file: `sequencer/src/lib/email-responder.ts`

Mirrors `sms-responder.ts` architecture but with email-specific behavior:

**Same decision engine:**
- `reply`: Draft/send an email response
- `goal_achieved`: Mark conversion
- `escalate`: Flag for human
- `opt_out`: Unsubscribe

**Email-specific differences from SMS:**
- Longer responses allowed (3-5 sentences vs 160 chars)
- Includes subject line (Re: original subject)
- Plain text format (for now)
- Respects email etiquette (greeting, sign-off with business name)
- References the original email context

**Configurable auto-reply (per tenant):**

New field on `tenant_profiles` or `tenant_email_accounts`:

```
email_reply_mode: 'auto' | 'draft' | 'notify_only'
```

- `auto`: Full chatbot loop — analyze, generate, send. Same as SMS.
- `draft`: Analyze, generate response, save as draft + notify tenant. Tenant approves/edits before sending.
- `notify_only`: Analyze, record in conversation memory, notify tenant. No draft generated. Default for new tenants.

**Turn limit:** Same as SMS — max 10 chatbot turns per enrollment to prevent runaway conversations.

---

## Part 4: Email Tracking (Prerequisite)

The event-processor has `handleEmailOpened`, `handleEmailClicked`, `handleEmailBounced` — but no webhook source feeds them. This needs to work for email to be a real channel.

### Tracking Pixel (Opens)

In `email-worker.ts`, before sending, inject a 1x1 tracking pixel:

```html
<img src="https://seq.ominify.io/track/open/{executionLogId}" width="1" height="1" style="display:none" />
```

New endpoint: `GET /track/open/:executionLogId` — returns a 1x1 transparent GIF and queues an `email-opened` event.

### Click Tracking

Rewrite URLs in email body to route through a redirect:

`https://seq.ominify.io/track/click/{executionLogId}?url={encodedOriginalUrl}`

New endpoint: `GET /track/click/:executionLogId` — queues an `email-clicked` event, 302 redirects to original URL.

### Bounce Handling

Configure the SMTP sending to use a bounce return-path that routes to our inbound email service. Parse bounce notifications and queue `email-bounced` events.

---

## Schema Changes Summary

### sequence_steps table
```sql
-- New column
ALTER TABLE sequence_steps ADD COLUMN step_brief JSONB;
-- Structure: { intent, key_points[], cta, constraints[], channel_hints }
```

### tenant_profiles or tenant_email_accounts
```sql
-- New column for email reply behavior
ALTER TABLE tenant_email_accounts ADD COLUMN email_reply_mode TEXT DEFAULT 'notify_only';
-- Values: 'auto', 'draft', 'notify_only'
```

### EventJobPayload type update
```typescript
// Add new event type
type: '... | email-reply'

// Add email-specific fields
emailSubject?: string;
emailBodyText?: string;
emailBodyHtml?: string;
```

---

## New Files

| File | Purpose |
|------|---------|
| `sequencer/src/lib/outbound-generator.ts` | Shared intent-guided generation function for SMS + email |
| `sequencer/src/lib/email-responder.ts` | Email reply chatbot (mirrors sms-responder.ts) |
| `sequencer/src/server/routes/email-webhooks.ts` | Inbound email webhook + tracking pixel + click redirect |

## Modified Files

| File | Change |
|------|--------|
| `sequencer/src/workers/scheduler-worker.ts` | Brief-based generation path before dispatch |
| `sequencer/src/workers/email-worker.ts` | Reply-To header, tracking pixel injection, click rewriting |
| `sequencer/src/workers/event-processor.ts` | Add `handleEmailReply`, pass step context to responders |
| `sequencer/src/lib/sms-responder.ts` | Accept + use triggering step context |
| `sequencer/src/lib/types.ts` | StepBrief type, email-reply event type, email reply mode |
| `sequencer/src/server/webhook-server.ts` | Register email webhook routes |
| `src/app/actions/ai-generate-sequence-actions.ts` | Generate step_brief instead of static content |
| `src/app/actions/sequence-actions.ts` | Support step_brief in step creation |

---

## Rollout Order

1. **Step awareness** for SMS responder — smallest change, immediate value
2. **Intent-guided SMS generation** — `outbound-generator.ts` + scheduler changes
3. **Email tracking** (pixel + click) — prerequisite for email intelligence
4. **Email reply ingestion** — reply-to routing + inbound webhook
5. **Email responder** — chatbot + configurable auto-reply
6. **AI sequence generator update** — generate briefs instead of static content

Steps 1-2 are SMS-only, no infrastructure. Steps 3-5 require the inbound email domain setup. Step 6 is a frontend/generation change that benefits from the others being live.

---

## Open Questions

- **Reply domain:** What domain/subdomain for reply-to routing? `replies.ominify.io`? Tenant custom domains later?
- **Inbound email service:** SendGrid Inbound Parse vs Mailgun Routes vs AWS SES Receiving? All support POST-to-webhook. SendGrid is simplest if already in the stack.
- **Email tracking domain:** Same as reply domain or separate? `seq.ominify.io` for tracking, `replies.ominify.io` for replies?
- **Brief editor UI:** How should the step editor change? A "brief" tab alongside the current "content" tab? Or replace the content editor entirely for new sequences?
- **Cost control:** Intent-guided generation means a GPT call per outbound message (not just per mutation). At 1000 contacts × 5 steps = 5000 GPT calls per sequence run. GPT-4o-mini makes this ~$0.75 total — acceptable?

---

*Brainstormed: 2026-04-02*
