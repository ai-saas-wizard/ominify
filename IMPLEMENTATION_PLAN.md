# Omnify Sequencer — 5-Feature Implementation Plan

## Overview

Five features that will make the Omnify Sequencer the most advanced outreach sequencer in the market. Each feature builds on existing infrastructure and creates compounding differentiation.

---

## Feature 1: Conversation Memory Across Channels

### What It Does
Every sequence step (SMS, email, voice) has full awareness of what happened on every other channel. A voice call transcript feeds into the next SMS. An SMS reply informs the next email. The AI agent on a call knows what SMS messages were exchanged. No other sequencer does this — they all treat channels as isolated silos.

### What Already Exists (Supabase)
- `contacts.conversation_summary` — AI-updated rolling summary (currently only from inbound calls)
- `contact_calls` table — per-call transcripts, summaries, outcomes
- `sequence_execution_log` — every action taken with `call_transcript`, `sms_status`, `email_status`, `provider_response`
- `sequence_enrollments` — boolean flags (`contact_replied`, `contact_answered_call`, `appointment_booked`)
- The frontend `contact-detail-modal.tsx` already displays conversation summaries and call history

### What's Missing
- SMS reply bodies are NOT stored anywhere persistent (only classified as intent, then discarded)
- Email content sent is not stored (only status)
- No unified "interaction timeline" that the scheduler can query
- Template variables don't include cross-channel context (`{{last_call_summary}}`, `{{sms_reply_text}}`, etc.)
- The `conversation_summary` on contacts is only updated from inbound calls, not from sequence interactions

### Implementation Plan

#### 1.1 New Database Table: `contact_interactions`
```sql
CREATE TABLE contact_interactions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE NOT NULL,
    enrollment_id UUID REFERENCES sequence_enrollments(id),
    step_id UUID REFERENCES sequence_steps(id),

    channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'voice')),
    direction TEXT NOT NULL CHECK (direction IN ('outbound', 'inbound')),

    -- Content
    content_body TEXT,           -- SMS body, email text, or call transcript
    content_subject TEXT,        -- Email subject
    content_summary TEXT,        -- AI-generated 1-2 sentence summary

    -- Outcome
    outcome TEXT,                -- 'delivered', 'replied', 'answered', 'voicemail', 'no_answer', 'bounced', 'opened', 'clicked'
    sentiment TEXT,              -- 'positive', 'negative', 'neutral', 'objection', 'interested', 'confused'
    intent TEXT,                 -- 'interested', 'not_interested', 'stop', 'reschedule', 'question', 'unknown'

    -- Voice-specific
    call_duration_seconds INT,
    call_disposition TEXT,
    appointment_booked BOOLEAN DEFAULT false,
    objections_raised JSONB,     -- ["price_concern", "timing", "competitor_mentioned"]
    key_topics JSONB,            -- ["emergency_repair", "pricing", "scheduling"]

    -- Metadata
    provider_id TEXT,            -- Twilio SID, VAPI call ID, email message ID
    created_at TIMESTAMPTZ DEFAULT now(),

    -- Indexes will be crucial
    CONSTRAINT fk_contact FOREIGN KEY (contact_id) REFERENCES contacts(id)
);

CREATE INDEX idx_interactions_contact_time ON contact_interactions(contact_id, created_at DESC);
CREATE INDEX idx_interactions_enrollment ON contact_interactions(enrollment_id, created_at DESC);
CREATE INDEX idx_interactions_channel ON contact_interactions(contact_id, channel, created_at DESC);
```

#### 1.2 New Library: `src/lib/conversation-memory.ts`
**Purpose:** Build a context object for any contact that the scheduler and workers can use.

```
Functions:
- getConversationContext(contactId, enrollmentId) → ConversationContext
  - Queries last N interactions from contact_interactions
  - Builds a structured object with:
    - last_interaction: { channel, summary, outcome, time_ago }
    - last_call: { summary, disposition, objections, duration, transcript_excerpt }
    - last_sms_reply: { body, intent, sentiment }
    - last_email: { subject, status (opened/clicked/none) }
    - interaction_count: { calls, sms, emails }
    - overall_sentiment: computed from recent interactions
    - objections_history: aggregated from all calls
    - key_topics: aggregated from all interactions

- summarizeInteraction(channel, content, outcome) → string
  - Uses OpenAI to generate a 1-2 sentence summary
  - Called by workers after each action completes

- updateContactSummary(contactId) → void
  - Reads last 10 interactions
  - Generates a rolling conversation_summary via OpenAI
  - Updates contacts.conversation_summary
```

#### 1.3 Modify Workers to Record Interactions

**sms-worker.ts** changes:
- After successful send → insert outbound SMS interaction into `contact_interactions`
- Store the SMS body in `content_body`

**event-processor.ts** changes:
- On `sms-reply` → insert inbound SMS interaction with reply body, classified intent, sentiment
- On `call-outcome` → insert voice interaction with transcript, disposition, duration, objections, key topics
- On `email-opened`/`email-clicked` → update existing email interaction outcome
- After any inbound interaction → call `updateContactSummary(contactId)`

**email-worker.ts** changes:
- After successful send → insert outbound email interaction with subject and body text

**vapi-worker.ts** changes:
- After call initiation → insert initial voice interaction (updated later by event processor)

#### 1.4 Expand Template Variables in Scheduler

**scheduler-worker.ts** changes to `renderTemplate()`:
- Before rendering, call `getConversationContext(contactId, enrollmentId)`
- Add new template variables:
  ```
  {{last_call_summary}}        — "We discussed pricing for emergency repair. Customer was interested but wanted a quote first."
  {{last_sms_reply}}           — The actual text of their last SMS reply
  {{last_sms_reply_intent}}    — "interested" / "question" / etc.
  {{overall_sentiment}}        — "positive" / "neutral" / "cooling_off"
  {{objections_raised}}        — "price_concern, timing"
  {{interaction_count}}        — "3 calls, 5 SMS, 2 emails"
  {{days_since_first_contact}} — "3 days"
  {{last_channel_used}}        — "voice"
  {{appointment_discussed}}    — "yes" / "no"
  ```

#### 1.5 Voice Agent Context Injection
- When dispatching VAPI calls, inject full conversation memory into `system_prompt`:
  ```
  CONVERSATION HISTORY:
  - [Day 1, 9:02am] Outbound SMS: "Hi {{first_name}}, this is {{company}}..."
  - [Day 1, 9:05am] Inbound SMS reply: "Yes I'm interested, what's the cost?"
  - [Day 1, 9:10am] Outbound call: Voicemail left (30s)
  - [Day 1, 2:00pm] Outbound SMS: Follow-up about pricing
  - [Day 2, 10:00am] THIS CALL — reference the previous SMS exchange about pricing
  ```

#### 1.6 Frontend: Interaction Timeline Component
- New component: `src/components/contacts/interaction-timeline.tsx`
- Shows unified timeline of all interactions across channels
- Color-coded by channel (blue=SMS, green=email, purple=voice)
- Expandable for full content
- Displayed in contact detail modal and enrollment detail view

### Files to Create
- `sequencer/src/lib/conversation-memory.ts`
- `supabase/contact-interactions-schema.sql`
- `src/components/contacts/interaction-timeline.tsx`

### Files to Modify
- `sequencer/src/workers/sms-worker.ts`
- `sequencer/src/workers/email-worker.ts`
- `sequencer/src/workers/vapi-worker.ts`
- `sequencer/src/workers/event-processor.ts`
- `sequencer/src/workers/scheduler-worker.ts`
- `sequencer/src/lib/types.ts`
- `src/components/contacts/contact-detail-modal.tsx`
- `src/app/actions/sequence-actions.ts` (add getInteractionTimeline action)

---

## Feature 2: Adaptive Sequence Mutation Engine

### What It Does
Instead of executing static, pre-written sequence steps, the AI dynamically rewrites upcoming steps based on what happened in prior steps. If a customer said "I'm interested but the price is too high" on a call, the next SMS doesn't send the generic template — it sends a personalized message addressing the price concern. The sequence literally evolves per-contact.

### What Already Exists
- OpenAI integration in `ai-sequence-generator.ts`
- Template rendering with `{{variables}}` in `scheduler-worker.ts`
- `on_success` and `on_failure` branching logic in `sequence_steps`
- Conversation memory (from Feature 1 above)
- `sequence_steps.content` is JSONB — already flexible

### What's Missing
- No mechanism to rewrite step content at execution time
- No AI that considers prior interactions when generating next message
- Steps are static templates, not adaptive
- No "mutation history" to track what was changed and why

### Implementation Plan

#### 2.1 New Database Table: `step_mutations`
```sql
CREATE TABLE step_mutations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE CASCADE NOT NULL,
    step_id UUID REFERENCES sequence_steps(id) NOT NULL,

    original_content JSONB NOT NULL,     -- The template as written
    mutated_content JSONB NOT NULL,      -- The AI-rewritten version
    mutation_reason TEXT,                 -- "Customer expressed price concern on last call"
    mutation_model TEXT DEFAULT 'gpt-4o', -- Which model was used
    confidence_score NUMERIC(3,2),       -- 0.00-1.00 — how confident the AI was

    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_mutations_enrollment ON step_mutations(enrollment_id, created_at DESC);
```

#### 2.2 New Column on `sequence_steps`
```sql
ALTER TABLE sequence_steps ADD COLUMN enable_ai_mutation BOOLEAN DEFAULT false;
ALTER TABLE sequence_steps ADD COLUMN mutation_instructions TEXT;
-- mutation_instructions: optional human guidance like "Always address pricing if it was mentioned"
```

#### 2.3 New Column on `sequences`
```sql
ALTER TABLE sequences ADD COLUMN enable_adaptive_mutation BOOLEAN DEFAULT false;
ALTER TABLE sequences ADD COLUMN mutation_aggressiveness TEXT DEFAULT 'moderate'
    CHECK (mutation_aggressiveness IN ('conservative', 'moderate', 'aggressive'));
-- conservative: only adjust tone and add context references
-- moderate: rewrite content while preserving intent and CTA
-- aggressive: completely regenerate content based on conversation history
```

#### 2.4 New Library: `src/lib/sequence-mutator.ts`
```
Functions:
- mutateStepContent(step, conversationContext, tenantProfile, aggressiveness) → MutatedContent
  - Takes: original step content, full conversation context, brand voice, aggressiveness level
  - Returns: rewritten content + reason + confidence score

  Prompt structure for OpenAI:
  """
  You are a sales copywriter for {{brand_voice}} brand in {{industry}}.

  ORIGINAL TEMPLATE:
  {{original_content}}

  CONVERSATION HISTORY:
  {{formatted_interaction_timeline}}

  MUTATION RULES:
  - Aggressiveness: {{aggressiveness}}
  - If conservative: Keep the original structure. Only add a brief reference to prior conversations.
  - If moderate: Rewrite to address specific concerns/interests from the conversation. Keep the same CTA.
  - If aggressive: Completely regenerate. The original is just inspiration.
  - NEVER change: phone numbers, links, legal disclaimers, opt-out language
  - ALWAYS maintain: brand voice, TCPA compliance, character limits (160 for SMS)
  - Include: specific references to what the customer said/did

  CUSTOM INSTRUCTIONS:
  {{mutation_instructions}}

  Return JSON: { "content": {...}, "reason": "...", "confidence": 0.85 }
  """

- shouldMutate(step, enrollment, conversationContext) → boolean
  - Decides whether mutation is worthwhile
  - Returns false if: no prior interactions, sequence is on first step, mutation disabled
  - Returns true if: customer replied, objection detected, sentiment changed, prior step failed
```

#### 2.5 Modify Scheduler Worker

**scheduler-worker.ts** changes in `processStep()`:
- After loading conversation context (Feature 1), check if mutation is enabled
- If `sequence.enable_adaptive_mutation && (step.enable_ai_mutation || shouldMutate(...))`
  - Call `mutateStepContent()` with conversation context
  - Use mutated content instead of original template
  - Store mutation in `step_mutations` table
  - Log mutation in execution log
- Fall back to original template if mutation fails or confidence < 0.5

```typescript
// In processStep(), after variable rendering:
if (sequence.enable_adaptive_mutation && shouldMutate(step, enrollment, conversationContext)) {
    try {
        const mutation = await mutateStepContent(step, conversationContext, tenantProfile, sequence.mutation_aggressiveness);
        if (mutation.confidence >= 0.5) {
            renderedContent = mutation.content;
            await recordMutation(enrollment.id, step.id, step.content, mutation);
        }
    } catch (err) {
        console.log('[SCHEDULER] Mutation failed, using original template');
    }
}
```

#### 2.6 Frontend: Mutation Controls & Visibility

**Sequence Settings:**
- Toggle: "Enable Adaptive AI Mutation" (per sequence)
- Dropdown: Mutation aggressiveness (conservative/moderate/aggressive)

**Step Editor:**
- Toggle: "Enable AI Mutation" (per step)
- Textarea: "Mutation Instructions" (optional guidance)

**Execution Log Enhancement:**
- Show original vs mutated content side-by-side
- Show mutation reason and confidence score
- Badge: "AI Adapted" on mutated steps

**Analytics:**
- Compare conversion rates: mutated vs non-mutated steps
- Show which mutation reasons correlate with success

### Files to Create
- `sequencer/src/lib/sequence-mutator.ts`
- `supabase/step-mutations-schema.sql`

### Files to Modify
- `sequencer/src/workers/scheduler-worker.ts` (core mutation logic)
- `sequencer/src/lib/types.ts` (new types)
- `supabase/type-b-schema.sql` (new columns)
- `src/components/sequences/sequence-step-editor.tsx` (mutation toggle/instructions)
- `src/components/sequences/sequence-detail-client.tsx` (mutation visibility in logs)
- `src/app/actions/sequence-actions.ts` (save mutation settings)

---

## Feature 3: Emotional Intelligence Layer

### What It Does
Replaces the keyword-based `classifyReplyIntent()` with a deep LLM-powered analysis that detects emotion, urgency, objection type, buying signals, and recommended next action. This feeds into the Adaptive Mutation Engine (Feature 2) and Conversation Memory (Feature 1) to create a truly intelligent response loop.

### What Already Exists
- `classifyReplyIntent()` in `event-processor.ts` — simple keyword matching for 6 intents
- OpenAI SDK already configured
- `sequence_execution_log` stores outcomes
- Contact flags: `contact_replied`, `contact_answered_call`

### What's Missing
- No nuanced emotion detection (frustration vs confusion vs excitement)
- No objection classification (price, timing, competitor, authority, need)
- No buying signal detection (asking about pricing, availability, next steps)
- No urgency detection in replies
- No recommended next action based on analysis
- Call transcripts are stored but never analyzed for emotional content
- No "human intervention needed" flagging

### Implementation Plan

#### 3.1 New Library: `src/lib/emotional-intelligence.ts`
```
Types:
- EmotionalAnalysis {
    // Core emotions
    primary_emotion: 'excited' | 'interested' | 'neutral' | 'hesitant' | 'frustrated' | 'confused' | 'angry' | 'dismissive'
    emotion_confidence: number  // 0-1

    // Intent (replaces old classifyReplyIntent)
    intent: 'interested' | 'not_interested' | 'stop' | 'reschedule' | 'question' | 'objection' | 'ready_to_buy' | 'needs_info' | 'unknown'

    // Objections detected
    objections: Array<{
        type: 'price' | 'timing' | 'competitor' | 'authority' | 'need' | 'trust' | 'urgency'
        detail: string  // "Thinks $500 is too expensive for basic service"
        severity: 'mild' | 'moderate' | 'strong'
    }>

    // Buying signals
    buying_signals: Array<{
        signal: string  // "Asked about availability this week"
        strength: 'weak' | 'moderate' | 'strong'
    }>

    // Urgency
    urgency_level: 'immediate' | 'soon' | 'flexible' | 'no_rush' | 'lost'

    // Action recommendation
    recommended_action: 'escalate_to_human' | 'continue_sequence' | 'pause_and_notify' | 'fast_track' | 'end_sequence' | 'switch_channel' | 'address_objection'
    recommended_channel: 'sms' | 'email' | 'voice' | 'any'
    recommended_tone: 'empathetic' | 'urgent' | 'casual' | 'professional' | 'reassuring'
    action_reason: string  // "Customer is frustrated about response time. Human touch needed."

    // Flags
    needs_human_intervention: boolean
    is_hot_lead: boolean
    is_at_risk: boolean  // About to disengage
}

Functions:
- analyzeMessage(messageBody: string, channel: string, conversationHistory: string) → EmotionalAnalysis
  - Uses OpenAI GPT-4o with structured output
  - Prompt includes conversation history for context
  - Returns full EmotionalAnalysis object

- analyzeCallTranscript(transcript: string, duration: number, disposition: string) → EmotionalAnalysis
  - Specialized for voice — analyzes full transcript
  - Detects: tone shifts, objection patterns, engagement level, booking intent

- computeEngagementScore(interactions: ContactInteraction[]) → number
  - 0-100 score based on: reply rate, response speed, sentiment trend, channel engagement
  - Decays over time (recent interactions weighted more)

- detectSentimentTrend(interactions: ContactInteraction[]) → 'warming' | 'stable' | 'cooling' | 'hot' | 'cold'
  - Analyzes sentiment across last N interactions
  - Detects if customer is becoming more or less engaged
```

#### 3.2 New Database Columns
```sql
-- On contact_interactions (from Feature 1)
ALTER TABLE contact_interactions ADD COLUMN emotional_analysis JSONB;
ALTER TABLE contact_interactions ADD COLUMN engagement_score INT;

-- On sequence_enrollments
ALTER TABLE sequence_enrollments ADD COLUMN engagement_score INT DEFAULT 50;
ALTER TABLE sequence_enrollments ADD COLUMN sentiment_trend TEXT DEFAULT 'stable'
    CHECK (sentiment_trend IN ('warming', 'stable', 'cooling', 'hot', 'cold'));
ALTER TABLE sequence_enrollments ADD COLUMN needs_human_intervention BOOLEAN DEFAULT false;
ALTER TABLE sequence_enrollments ADD COLUMN last_emotion TEXT;
ALTER TABLE sequence_enrollments ADD COLUMN objections_detected JSONB DEFAULT '[]';

-- On contacts
ALTER TABLE contacts ADD COLUMN engagement_score INT DEFAULT 50;
ALTER TABLE contacts ADD COLUMN sentiment_trend TEXT DEFAULT 'stable';
```

#### 3.3 Modify Event Processor

**event-processor.ts** `handleSmsReply()` changes:
- Replace `classifyReplyIntent()` with `analyzeMessage()`
- Store full `EmotionalAnalysis` in interaction record
- Update enrollment with: engagement_score, sentiment_trend, needs_human_intervention, last_emotion, objections_detected
- New action handling:
  - `escalate_to_human` → pause sequence, create notification, flag enrollment
  - `fast_track` → skip to next voice call step or shorten delays
  - `address_objection` → trigger mutation engine with objection context
  - `switch_channel` → reorder upcoming steps to prioritize recommended channel

**event-processor.ts** `handleCallOutcome()` changes:
- Call `analyzeCallTranscript()` on the transcript
- Extract objections, buying signals, emotion
- Update interaction and enrollment records
- If `needs_human_intervention` → pause and notify

#### 3.4 New Notification System
```sql
CREATE TABLE tenant_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    enrollment_id UUID REFERENCES sequence_enrollments(id),
    contact_id UUID REFERENCES contacts(id),

    type TEXT NOT NULL CHECK (type IN (
        'hot_lead', 'needs_human', 'objection_detected', 'sentiment_drop',
        'appointment_booked', 'sequence_completed', 'escalation'
    )),

    title TEXT NOT NULL,
    body TEXT,
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),

    read BOOLEAN DEFAULT false,
    read_at TIMESTAMPTZ,

    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_notifications_client_unread ON tenant_notifications(client_id, read) WHERE read = false;
```

#### 3.5 Modify Scheduler for Emotion-Aware Decisions

**scheduler-worker.ts** additions:
- Before processing a step, check `enrollment.needs_human_intervention` — if true, skip
- Check `enrollment.sentiment_trend`:
  - If `cooling` → increase delay between steps (give space)
  - If `hot` → decrease delay (strike while iron is hot)
  - If `cold` → consider ending sequence early
- Pass emotional context to mutation engine (Feature 2)

#### 3.6 Frontend: Emotion Dashboard

**Contact Detail Enhancement:**
- Emotion badge on each interaction (emoji + label)
- Engagement score meter (0-100)
- Sentiment trend sparkline
- Objection tags
- "Needs Human Attention" alert banner

**Sequence Dashboard Enhancement:**
- Filter enrollments by: needs_human, hot_leads, at_risk
- Bulk action: "Take over" (pause sequence, open for manual follow-up)

**Notification Center:**
- New component: `src/components/layout/notification-center.tsx`
- Bell icon in header with unread count
- Real-time via Supabase subscription on `tenant_notifications`
- Click → navigate to contact/enrollment

### Files to Create
- `sequencer/src/lib/emotional-intelligence.ts`
- `supabase/emotional-intelligence-schema.sql`
- `src/components/layout/notification-center.tsx`
- `src/components/contacts/engagement-meter.tsx`
- `src/components/contacts/emotion-badge.tsx`

### Files to Modify
- `sequencer/src/workers/event-processor.ts` (major rewrite of handlers)
- `sequencer/src/workers/scheduler-worker.ts` (emotion-aware scheduling)
- `sequencer/src/lib/types.ts` (EmotionalAnalysis type, updated EventJobPayload)
- `src/components/contacts/contact-detail-modal.tsx` (emotion display)
- `src/components/sequences/enrollment-table.tsx` (emotion columns)
- `src/components/layout/sidebar.tsx` (notification bell)

---

## Feature 4: Self-Healing Sequences

### What It Does
When a step fails (SMS undelivered, email bounced, call no-answer, capacity exhausted), instead of just retrying the same action or skipping, the system intelligently adapts: switches channels, finds alternative contact methods, re-orders remaining steps, and recovers gracefully. No human intervention needed.

### What Already Exists
- `on_failure` field on `sequence_steps` (retry_after_seconds, skip, end_sequence)
- SMS delivery status tracking via webhooks
- VAPI call disposition tracking (answered, voicemail, no_answer, busy, failed)
- Email status tracking (sent, failed)
- Concurrency re-queue with backoff in vapi-worker

### What's Missing
- No cross-channel fallback (SMS fails → try email)
- No alternative contact lookup (email bounced → find another email)
- No intelligent step re-ordering based on failures
- No phone type detection (landline vs mobile → skip SMS for landlines)
- No progressive failure tracking (3 failed SMS in a row → switch to email)
- No "healing actions" that inject new steps into the sequence

### Implementation Plan

#### 4.1 New Library: `src/lib/self-healer.ts`
```
Types:
- HealingAction {
    type: 'switch_channel' | 'retry_alternative' | 'skip_and_advance' | 'inject_step' | 'extend_delay' | 'end_sequence' | 'enrich_contact'
    details: {
        new_channel?: ChannelType
        new_content?: any
        delay_seconds?: number
        reason: string
    }
}

- FailureContext {
    enrollment: SequenceEnrollment
    step: SequenceStep
    failure_type: 'sms_undelivered' | 'sms_failed' | 'email_bounced' | 'email_spam' | 'call_no_answer' | 'call_busy' | 'call_failed' | 'capacity_exhausted' | 'invalid_number' | 'landline_detected'
    error_details: any
    failure_history: Array<{ channel, failure_type, step_order, timestamp }>
}

Functions:
- diagnoseFailure(failureContext: FailureContext) → HealingAction
  Decision tree:

  SMS_UNDELIVERED / SMS_FAILED:
    - If first failure → retry once after 5 min
    - If 2+ SMS failures → check if phone is landline
      - If landline → switch remaining SMS steps to email, flag number
      - If mobile → try from different number, check A2P status
    - If no email on contact → attempt enrichment via waterfall
    - If email exists → switch to email for this step

  EMAIL_BOUNCED:
    - If hard bounce → mark email invalid, switch to SMS
    - If soft bounce → retry after 1 hour
    - If 2+ bounces → attempt enrichment for alternative email

  CALL_NO_ANSWER:
    - If first no-answer → send immediate SMS referencing the missed call
    - If 2+ no-answers → extend delay, try at different time of day
    - If 3+ no-answers → switch to SMS/email only for remaining steps

  CALL_BUSY:
    - Re-queue with 15 min delay

  CALL_FAILED / CAPACITY_EXHAUSTED:
    - Send SMS immediately as fallback
    - Re-queue call with longer delay

  INVALID_NUMBER:
    - Skip all phone-based steps
    - Switch entirely to email
    - Attempt enrichment for valid number

- executeHealingAction(action: HealingAction, enrollment, step) → void
  - switch_channel: Dispatch to different channel queue with adapted content
  - inject_step: Insert a new step into the sequence for this enrollment only
  - enrich_contact: Queue an enrichment job to find alternative contact info
  - extend_delay: Update next_step_at to give more time
  - skip_and_advance: Move to next step

- getFailureHistory(enrollmentId) → FailureRecord[]
  - Query execution_log for all failures in this enrollment
  - Used by diagnoseFailure to detect patterns

- adaptRemainingSteps(enrollmentId, failedChannel) → void
  - If a channel is consistently failing, rewrite remaining steps
  - e.g., if SMS keeps failing, convert remaining SMS steps to email
  - Store adapted sequence in enrollment-level override
```

#### 4.2 New Database Columns
```sql
-- On sequence_enrollments
ALTER TABLE sequence_enrollments ADD COLUMN healing_actions_taken JSONB DEFAULT '[]';
ALTER TABLE sequence_enrollments ADD COLUMN failed_channels JSONB DEFAULT '[]';  -- ['sms', 'voice']
ALTER TABLE sequence_enrollments ADD COLUMN channel_overrides JSONB DEFAULT '{}';
-- channel_overrides: { "sms": "email" } — for this enrollment, route SMS steps to email

-- On contacts
ALTER TABLE contacts ADD COLUMN phone_type TEXT CHECK (phone_type IN ('mobile', 'landline', 'voip', 'unknown'));
ALTER TABLE contacts ADD COLUMN email_valid BOOLEAN DEFAULT true;
ALTER TABLE contacts ADD COLUMN phone_valid BOOLEAN DEFAULT true;
ALTER TABLE contacts ADD COLUMN alternative_email TEXT;
ALTER TABLE contacts ADD COLUMN alternative_phone TEXT;
```

#### 4.3 New BullMQ Queue: `healing:actions`
- Separate queue for healing actions to not block main channel queues
- Processed by event-processor (or dedicated healing worker)

#### 4.4 Modify Event Processor

**event-processor.ts** changes:

`handleSmsDelivery()`:
- On failure/undelivered → call `diagnoseFailure()` → execute healing action
- Track failure in enrollment's `healing_actions_taken`

`handleCallOutcome()`:
- On no_answer/busy/failed → call `diagnoseFailure()` → execute healing action
- On voicemail → inject immediate SMS step: "Hey {{first_name}}, just tried calling. Will try again later. In the meantime, reply to this text if you'd like to chat!"

New handler: `handleEmailBounce()`:
- On hard bounce → diagnoseFailure → switch to SMS
- On soft bounce → schedule retry

#### 4.5 Modify Scheduler Worker

**scheduler-worker.ts** changes:
- Before dispatching, check `enrollment.channel_overrides`
- If the current step's channel has an override, use the override channel instead
- Before SMS dispatch, check `contact.phone_type` — skip SMS for landlines
- Before email dispatch, check `contact.email_valid` — skip if invalid

#### 4.6 Phone Type Detection
- On first SMS send, use Twilio Lookup API to detect phone type
- Store in `contacts.phone_type`
- Cache result (phone types rarely change)

#### 4.7 Frontend: Healing Visibility

**Execution Log Enhancement:**
- Show healing actions inline: "Step 3 (SMS) failed → Healed: switched to email"
- Healing action badges with color coding
- Hover for details (failure reason, healing reason)

**Enrollment Detail:**
- "Healing History" section showing all adaptations
- Channel override indicator: "SMS → Email (phone is landline)"

### Files to Create
- `sequencer/src/lib/self-healer.ts`
- `supabase/self-healing-schema.sql`

### Files to Modify
- `sequencer/src/workers/event-processor.ts` (healing triggers)
- `sequencer/src/workers/scheduler-worker.ts` (channel overrides, phone type check)
- `sequencer/src/workers/sms-worker.ts` (phone type detection via Twilio Lookup)
- `sequencer/src/lib/types.ts` (HealingAction types)
- `sequencer/src/lib/redis.ts` (healing queue)
- `src/components/sequences/sequence-detail-client.tsx` (healing visibility)

---

## Feature 5: Outcome-Based Sequence Learning

### What It Does
The system tracks which sequence steps, channels, timings, and content actually lead to conversions (appointments booked, replies, answered calls). It computes step-level attribution, identifies winning patterns, auto-suggests optimizations, and can auto-promote winning variants. It learns from aggregate multi-tenant data (anonymized) to recommend industry-specific best practices.

### What Already Exists
- `sequence_execution_log` — every action with timestamps, outcomes, costs
- `sequence_enrollments` — final status (completed, booked, replied, etc.)
- `sequences` — denormalized counters (total_enrolled, total_completed, total_converted)
- Frontend analytics: call volume, outcomes, agent performance
- Multi-tenant architecture — same DB, different client_ids

### What's Missing
- No step-level attribution (which step triggered the conversion?)
- No A/B testing infrastructure
- No statistical significance tracking
- No auto-optimization recommendations
- No cross-tenant benchmarking
- No learning loop that feeds back into sequence generation

### Implementation Plan

#### 5.1 New Database Tables

```sql
-- Step-level performance metrics (materialized/computed)
CREATE TABLE step_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id UUID REFERENCES sequence_steps(id) ON DELETE CASCADE NOT NULL,
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    -- Volume
    total_executions INT DEFAULT 0,
    total_skipped INT DEFAULT 0,

    -- Outcomes
    total_delivered INT DEFAULT 0,       -- SMS delivered, email sent, call connected
    total_failed INT DEFAULT 0,
    total_replies INT DEFAULT 0,         -- Inbound replies after this step
    total_conversions INT DEFAULT 0,     -- Appointments booked after this step

    -- Engagement
    reply_rate NUMERIC(5,4) DEFAULT 0,   -- replies / delivered
    conversion_rate NUMERIC(5,4) DEFAULT 0,  -- conversions / delivered
    avg_response_time_seconds INT,       -- How fast do people reply after this step?

    -- Attribution
    attributed_conversions INT DEFAULT 0, -- Conversions where this was the last touch
    attribution_score NUMERIC(5,4) DEFAULT 0, -- 0-1 — how important is this step?

    -- Timing
    avg_time_to_next_step_seconds INT,
    optimal_send_hour INT,               -- Best hour to send (0-23)
    optimal_send_day INT,                -- Best day to send (0=Sun, 6=Sat)

    -- Content metrics (for mutation comparison)
    mutated_executions INT DEFAULT 0,
    mutated_conversions INT DEFAULT 0,
    mutated_conversion_rate NUMERIC(5,4) DEFAULT 0,

    -- Cost efficiency
    total_cost NUMERIC(10,4) DEFAULT 0,
    cost_per_conversion NUMERIC(10,4),

    -- Period
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_step_analytics_step ON step_analytics(step_id, period_start DESC);
CREATE INDEX idx_step_analytics_sequence ON step_analytics(sequence_id, period_start DESC);

-- Sequence-level performance
CREATE TABLE sequence_analytics (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE NOT NULL,
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,

    -- Volume
    total_enrollments INT DEFAULT 0,
    total_completions INT DEFAULT 0,
    total_conversions INT DEFAULT 0,

    -- Rates
    completion_rate NUMERIC(5,4) DEFAULT 0,
    conversion_rate NUMERIC(5,4) DEFAULT 0,
    reply_rate NUMERIC(5,4) DEFAULT 0,
    opt_out_rate NUMERIC(5,4) DEFAULT 0,

    -- Timing
    avg_time_to_conversion_hours NUMERIC(10,2),
    avg_steps_to_conversion NUMERIC(5,2),

    -- Cost
    total_cost NUMERIC(10,4) DEFAULT 0,
    cost_per_conversion NUMERIC(10,4),
    cost_per_enrollment NUMERIC(10,4),

    -- Channel effectiveness
    channel_breakdown JSONB DEFAULT '{}',
    -- { "sms": { "sent": 100, "replies": 15, "conversions": 5 }, ... }

    -- Period
    period_start TIMESTAMPTZ NOT NULL,
    period_end TIMESTAMPTZ NOT NULL,

    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- AI optimization suggestions
CREATE TABLE optimization_suggestions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id UUID REFERENCES clients(id) ON DELETE CASCADE NOT NULL,
    sequence_id UUID REFERENCES sequences(id),
    step_id UUID REFERENCES sequence_steps(id),

    type TEXT NOT NULL CHECK (type IN (
        'remove_step', 'add_step', 'change_channel', 'change_timing',
        'change_content', 'reorder_steps', 'split_test', 'merge_sequences'
    )),

    title TEXT NOT NULL,              -- "Step 4 (email) has 0.2% reply rate"
    description TEXT NOT NULL,        -- "Consider replacing with an SMS..."
    expected_improvement TEXT,        -- "+15% conversion rate"
    confidence TEXT CHECK (confidence IN ('low', 'medium', 'high')),

    suggested_change JSONB,           -- The actual change to apply

    status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'dismissed', 'auto_applied')),
    accepted_at TIMESTAMPTZ,
    dismissed_at TIMESTAMPTZ,

    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_suggestions_client ON optimization_suggestions(client_id, status) WHERE status = 'pending';

-- A/B test variants
CREATE TABLE step_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    step_id UUID REFERENCES sequence_steps(id) ON DELETE CASCADE NOT NULL,

    variant_name TEXT NOT NULL,       -- "A", "B", "C"
    content JSONB NOT NULL,           -- Variant content
    traffic_weight NUMERIC(3,2) DEFAULT 0.5, -- 0-1 traffic allocation

    -- Performance
    total_sent INT DEFAULT 0,
    total_replies INT DEFAULT 0,
    total_conversions INT DEFAULT 0,
    reply_rate NUMERIC(5,4) DEFAULT 0,
    conversion_rate NUMERIC(5,4) DEFAULT 0,

    -- Statistical significance
    is_winner BOOLEAN DEFAULT false,
    p_value NUMERIC(5,4),            -- Statistical significance

    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_variants_step ON step_variants(step_id) WHERE is_active = true;
```

#### 5.2 New Library: `src/lib/outcome-learning.ts`
```
Functions:

ATTRIBUTION:
- computeStepAttribution(enrollmentId) → AttributionResult
  Called when enrollment reaches terminal state (booked, completed, replied)
  - Last-touch attribution: which step directly preceded the conversion?
  - Multi-touch attribution: weighted score across all steps
  - Time-decay: recent steps get more credit

- computeOptimalTiming(sequenceId) → TimingRecommendation
  Analyzes: which hours/days get the best response rates per step
  Returns: recommended send times for each step

ANALYTICS COMPUTATION:
- computeStepAnalytics(stepId, periodStart, periodEnd) → StepAnalytics
  Aggregates execution_log data into step_analytics row

- computeSequenceAnalytics(sequenceId, periodStart, periodEnd) → SequenceAnalytics
  Aggregates enrollment + execution data into sequence_analytics row

- runAnalyticsJob() → void
  Scheduled job (hourly) that recomputes analytics for all active sequences

OPTIMIZATION:
- generateOptimizations(sequenceId) → OptimizationSuggestion[]
  Analyzes step_analytics and generates suggestions:
  - "Step 4 has 0.2% reply rate vs 8% average → suggest removing or changing channel"
  - "Step 2 (SMS at 2pm) has 3x better reply rate than step 5 (SMS at 9am) → suggest time change"
  - "Voice calls convert 5x better than SMS for this sequence → suggest adding a call step"
  - "Mutated steps convert 40% better → suggest enabling mutation for all steps"
  - "Average conversion happens at step 3 → steps 6-8 may be unnecessary"

A/B TESTING:
- selectVariant(stepId) → StepVariant
  Weighted random selection based on traffic_weight

- evaluateTest(stepId) → TestResult
  Computes statistical significance (chi-squared test)
  If p_value < 0.05 → declare winner

- autoPromoteWinner(stepId) → void
  When winner detected: set traffic_weight=1 for winner, deactivate losers
  Create optimization_suggestion record

BENCHMARKING (multi-tenant):
- computeIndustryBenchmarks(industry) → Benchmarks
  Anonymized aggregate across tenants in same industry
  Returns: avg reply rates, conversion rates, best channels, optimal timing

- compareToIndustry(sequenceId) → Comparison
  "Your SMS reply rate (12%) is 2x industry average (6%)"
  "Your email open rate (8%) is below industry average (15%)"
```

#### 5.3 New Scheduled Job: Analytics Worker
```
File: sequencer/src/workers/analytics-worker.ts

Runs every hour:
1. Compute step_analytics for all active sequences (last 24h rolling)
2. Compute sequence_analytics
3. Evaluate all active A/B tests
4. Auto-promote winners where p_value < 0.05
5. Generate optimization suggestions for sequences with enough data (>50 enrollments)
6. Compute engagement scores for active enrollments
7. Update industry benchmarks (weekly)
```

#### 5.4 Modify Scheduler for A/B Testing

**scheduler-worker.ts** changes:
- Before rendering content, check if step has active variants
- If yes → call `selectVariant(stepId)` → use variant content
- Track which variant was used in execution_log

#### 5.5 Modify Event Processor for Attribution

**event-processor.ts** changes:
- When enrollment reaches terminal state (booked, completed, replied):
  - Call `computeStepAttribution(enrollmentId)`
  - Update step_analytics.attributed_conversions
  - Update sequence_analytics

#### 5.6 Frontend: Learning Dashboard

**New Page: `/client/[clientId]/analytics/learning`**

**Sequence Performance Card:**
- Conversion funnel: enrolled → engaged → replied → converted
- Step-by-step drop-off chart
- Cost per conversion
- Time to conversion distribution

**Step Attribution View:**
- Bar chart: attribution score per step
- "Step 3 (voice call) drives 45% of conversions"
- Channel effectiveness breakdown

**A/B Testing Panel:**
- Create variant for any step
- Live results with confidence intervals
- Auto-promote toggle
- Winner badge when significance reached

**Optimization Feed:**
- Card-based feed of suggestions
- Accept/dismiss buttons
- "Expected improvement: +15% conversion rate"
- History of accepted changes and their actual impact

**Industry Benchmarks Panel:**
- "Your performance vs industry average"
- Radar chart comparing key metrics
- Specific recommendations based on gaps

### Files to Create
- `sequencer/src/lib/outcome-learning.ts`
- `sequencer/src/workers/analytics-worker.ts`
- `supabase/outcome-learning-schema.sql`
- `src/app/client/[clientId]/analytics/learning/page.tsx`
- `src/components/analytics/step-attribution-chart.tsx`
- `src/components/analytics/ab-test-panel.tsx`
- `src/components/analytics/optimization-feed.tsx`
- `src/components/analytics/industry-benchmarks.tsx`
- `src/components/analytics/conversion-funnel.tsx`

### Files to Modify
- `sequencer/src/workers/scheduler-worker.ts` (A/B variant selection)
- `sequencer/src/workers/event-processor.ts` (attribution on conversion)
- `sequencer/src/lib/redis.ts` (analytics queue for scheduled job)
- `sequencer/ecosystem.config.js` (add analytics-worker process)
- `sequencer/package.json` (add analytics-worker script)
- `src/app/actions/sequence-actions.ts` (analytics data fetching)
- `src/components/analytics/analytics-overview.tsx` (link to learning dashboard)

---

## Implementation Order & Dependencies

```
Phase 1: Conversation Memory (Feature 1)     — Foundation for everything
   ↓
Phase 2: Emotional Intelligence (Feature 3)   — Depends on interaction data from Phase 1
   ↓
Phase 3: Adaptive Mutation (Feature 2)         — Uses context from Phase 1 + emotion from Phase 2
   ↓
Phase 4: Self-Healing (Feature 4)              — Independent but enhanced by emotion data
   ↓
Phase 5: Outcome Learning (Feature 5)          — Needs data from all above features running
```

### Estimated Effort Per Phase
- **Phase 1 (Conversation Memory):** 3-4 days — New table, modify 4 workers, new lib, frontend timeline
- **Phase 2 (Emotional Intelligence):** 3-4 days — New lib with OpenAI, modify event processor, notification system, frontend
- **Phase 3 (Adaptive Mutation):** 2-3 days — New lib, modify scheduler, frontend controls
- **Phase 4 (Self-Healing):** 3-4 days — New lib with decision tree, modify event processor + scheduler, phone detection
- **Phase 5 (Outcome Learning):** 4-5 days — Analytics tables, attribution engine, A/B testing, analytics worker, full dashboard

**Total: ~15-20 days for all 5 features**

---

## Cross-Feature Integration Points

| Feature | Feeds Into | Receives From |
|---------|-----------|---------------|
| Conversation Memory | Mutation Engine, Emotional Intelligence, Voice Agent Context | All workers (interactions logged) |
| Emotional Intelligence | Mutation Engine, Self-Healer, Scheduler, Notifications | Conversation Memory (history) |
| Adaptive Mutation | Outcome Learning (track mutated vs original) | Conversation Memory + Emotional Intelligence |
| Self-Healing | Outcome Learning (track healing success) | Event Processor (failures), Emotional Intelligence |
| Outcome Learning | Optimization Suggestions, A/B Testing | All features (aggregated data) |

---

## New Infrastructure Required
- **OpenAI costs:** ~$0.01-0.05 per mutation/analysis (GPT-4o). Budget ~$0.10 per enrollment for all AI features combined.
- **New PM2 process:** analytics-worker (1 instance, runs hourly)
- **New BullMQ queue:** healing:actions
- **New Supabase tables:** 6 new tables, ~8 new columns across existing tables
- **Redis:** Minimal additional usage (healing queue, analytics cache)
