# Omnify Sequencer — Full Implementation Context

> **5 AI-powered features** implemented across the Omnify sequencer platform.
> Use this document to provide context in a new conversation.

---

## Architecture Overview

### Tech Stack
- **Frontend**: Next.js 14+ (App Router), React, TypeScript, Tailwind CSS, Clerk Auth
- **Backend (Sequencer Engine)**: Node.js + TypeScript, BullMQ queues, Redis
- **Database**: Supabase (PostgreSQL) with RLS, service_role policies
- **AI**: OpenAI GPT-4o for emotional intelligence, mutation, and optimization
- **Telephony**: Twilio (SMS, Lookup API), VAPI (voice calls)
- **Email**: Nodemailer

### Directory Structure
```
/Users/vishnuanilkumar/Omnify/
├── src/                              # Next.js frontend
│   ├── app/
│   │   ├── actions/
│   │   │   └── sequence-actions.ts   # Server actions for all sequence features
│   │   └── client/[clientId]/
│   │       ├── sequences/
│   │       │   ├── page.tsx                          # Sequence list page
│   │       │   └── [sequenceId]/
│   │       │       ├── page.tsx                      # Sequence detail page
│   │       │       └── learning/
│   │       │           ├── page.tsx                   # Learning dashboard (Phase 5)
│   │       │           └── learning-ab-tests.tsx      # A/B test client wrapper
│   │       └── analytics/
│   │           └── page.tsx                          # General analytics page
│   ├── components/
│   │   ├── sequences/
│   │   │   ├── sequence-detail-client.tsx  # Main interactive detail component
│   │   │   ├── sequence-step-editor.tsx    # Step creation/editing form
│   │   │   ├── mutation-badge.tsx          # Phase 3 — AI mutation display
│   │   │   └── healing-badge.tsx           # Phase 4 — Self-healing display
│   │   ├── contacts/
│   │   │   └── emotion-badge.tsx           # Phase 2 — Emotion indicator
│   │   └── analytics/
│   │       ├── conversion-funnel.tsx       # Phase 5 — Conversion funnel viz
│   │       ├── step-attribution-chart.tsx  # Phase 5 — Step attribution bars
│   │       ├── optimization-feed.tsx       # Phase 5 — AI suggestions feed
│   │       ├── ab-test-panel.tsx           # Phase 5 — A/B test management
│   │       ├── industry-benchmarks.tsx     # Phase 5 — Industry comparison
│   │       ├── analytics-overview.tsx      # Existing analytics
│   │       ├── call-volume-chart.tsx       # Existing call volume chart
│   │       ├── call-outcomes-chart.tsx     # Existing call outcomes
│   │       ├── agent-performance-table.tsx # Existing agent perf
│   │       └── peak-hours-heatmap.tsx      # Existing peak hours
│   └── lib/
│       └── supabase.ts                    # Supabase client (service_role)
│
├── sequencer/                        # Backend sequencer engine
│   ├── src/
│   │   ├── lib/
│   │   │   ├── types.ts                   # All type definitions (all 5 phases)
│   │   │   ├── db.ts                      # Supabase client
│   │   │   ├── redis.ts                   # Redis + BullMQ queues (7 queues)
│   │   │   ├── conversation-memory.ts     # Phase 1 — Cross-channel memory
│   │   │   ├── emotional-intelligence.ts  # Phase 2 — EI analysis engine
│   │   │   ├── tone-adapter.ts            # Phase 2 — Tone/delay adjustment
│   │   │   ├── sequence-mutator.ts        # Phase 3 — AI content mutation
│   │   │   ├── self-healer.ts             # Phase 4 — Failure recovery engine
│   │   │   ├── outcome-learning.ts        # Phase 5 — Attribution + A/B + optimization
│   │   │   └── concurrency-manager.ts     # VAPI concurrency management
│   │   ├── workers/
│   │   │   ├── scheduler-worker.ts        # Main scheduler (polls every 5s)
│   │   │   ├── sms-worker.ts              # SMS dispatch (Twilio)
│   │   │   ├── email-worker.ts            # Email dispatch (Nodemailer)
│   │   │   ├── vapi-worker.ts             # Voice call dispatch (VAPI)
│   │   │   ├── event-processor.ts         # Webhook event handler
│   │   │   └── analytics-worker.ts        # Phase 5 — Hourly analytics
│   │   └── server/
│   │       └── webhook-server.ts          # Fastify webhook ingestion
│   ├── ecosystem.config.js               # PM2 process config (7 processes)
│   ├── package.json
│   └── tsconfig.json
│
└── supabase/                         # Database schemas
    ├── contact-interactions-schema.sql    # Phase 1
    ├── emotional-intelligence-schema.sql  # Phase 2
    ├── adaptive-mutation-schema.sql       # Phase 3
    ├── self-healing-schema.sql            # Phase 4
    └── outcome-learning-schema.sql        # Phase 5
```

### Worker Architecture
The sequencer runs 7 processes via PM2:
1. **scheduler** — Polls every 5s for due enrollments, dispatches to queues
2. **sms-worker** (x2 instances) — Sends SMS via Twilio
3. **email-worker** (x2 instances) — Sends email via Nodemailer
4. **vapi-worker** — Dispatches voice calls via VAPI
5. **webhook-server** — Receives Twilio/VAPI webhooks, pushes to event queue
6. **event-processor** — Processes webhook events, updates enrollment state
7. **analytics-worker** — Hourly analytics computation (Phase 5)

### BullMQ Queues (Redis)
- `sms:send` — SMS dispatch jobs
- `email:send` — Email dispatch jobs
- `vapi:calls` — Voice call dispatch jobs
- `events:process` — Webhook event processing
- `healing:actions` — Self-healing async actions (Phase 4)
- `analytics:compute` — Analytics computation jobs (Phase 5)

---

## Phase 1: Cross-Channel Conversation Memory

### Purpose
Gives the sequencer full awareness of all prior interactions across SMS, email, and voice channels. Every outbound and inbound interaction is stored in a unified timeline, and this context is injected into templates and voice agent prompts.

### Database Schema (`contact-interactions-schema.sql`)
**Table: `contact_interactions`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| client_id | UUID | Tenant reference |
| contact_id | UUID | Contact reference |
| enrollment_id | UUID | Optional enrollment reference |
| step_id | UUID | Optional step reference |
| channel | TEXT | sms, email, voice |
| direction | TEXT | outbound, inbound |
| content_body | TEXT | Message body / transcript |
| content_subject | TEXT | Email subject |
| content_summary | TEXT | AI-generated summary |
| outcome | TEXT | delivered, replied, answered, voicemail, bounced, etc. |
| sentiment | TEXT | positive, negative, neutral, interested, objection, confused |
| intent | TEXT | interested, not_interested, stop, reschedule, question, unknown |
| call_duration_seconds | INT | Voice call duration |
| call_disposition | TEXT | answered, no-answer, busy, etc. |
| appointment_booked | BOOLEAN | Whether appointment was booked |
| objections_raised | JSONB | Array of objection strings |
| key_topics | JSONB | Array of topic strings |
| provider_id | TEXT | Twilio SID, VAPI call ID |
| emotional_analysis | JSONB | Phase 2 — Full EI analysis |
| engagement_score | INT | Phase 2 — 0-100 score |

### Core Library (`conversation-memory.ts` — ~486 lines)
```typescript
// Record any interaction to unified timeline
recordInteraction(params: {
    clientId, contactId, enrollmentId?, stepId?,
    channel, direction, contentBody?, contentSubject?,
    outcome?, sentiment?, intent?, callDuration?, callDisposition?,
    appointmentBooked?, objections?, keyTopics?, providerId?
}): Promise<string>  // returns interaction ID

// Update existing interaction (e.g., after call ends)
updateInteraction(id, updates): Promise<void>

// Find interaction by Twilio SID or VAPI call ID
findInteractionByProviderId(providerId): Promise<ContactInteraction | null>

// Build full conversation context for a contact
getConversationContext(contactId, enrollmentId?): Promise<ConversationContext>

// Convert context to template variables: {{last_call_summary}}, {{interaction_count}}, etc.
buildTemplateVariables(ctx: ConversationContext): Record<string, any>

// Build voice agent context injection (appended to system_prompt)
buildVoiceAgentContext(ctx: ConversationContext): string

// Generate rolling AI summary of all interactions
updateContactConversationSummary(contactId): Promise<void>
```

### Template Variables Available
| Variable | Example |
|----------|---------|
| `{{last_interaction_summary}}` | "Called 2 days ago, left voicemail" |
| `{{last_call_summary}}` | "Discussed pricing, asked about availability" |
| `{{last_sms_reply}}` | "I'm interested but need to check my schedule" |
| `{{interaction_count}}` | "5" |
| `{{days_since_first_contact}}` | "7" |
| `{{overall_sentiment}}` | "interested" |
| `{{objections_history}}` | "price, timing" |
| `{{key_topics_history}}` | "pricing, availability, warranty" |

### Integration Points
- **scheduler-worker.ts**: Calls `getConversationContext()` before dispatching any step, injects variables into templates
- **event-processor.ts**: Calls `recordInteraction()` for inbound SMS replies, `updateInteraction()` for call outcomes
- **sms-worker.ts**: Records outbound SMS interaction after sending
- **Voice agent**: Conversation timeline appended to `system_prompt` via `buildVoiceAgentContext()`

---

## Phase 2: Emotional Intelligence Layer

### Purpose
Replaces simple keyword-based intent detection with GPT-4o-powered emotional analysis. Detects emotions, objections, buying signals, and urgency for every inbound message and call transcript. Drives tone adaptation, delay adjustment, notification generation, and hot lead flagging.

### Database Schema (`emotional-intelligence-schema.sql`)

**New columns on `contact_interactions`:**
- `emotional_analysis` (JSONB) — Full EmotionalAnalysis object
- `engagement_score` (INT 0-100)

**New columns on `sequence_enrollments`:**
- `engagement_score` (INT, default 50)
- `sentiment_trend` (TEXT: warming, stable, cooling, hot, cold)
- `needs_human_intervention` (BOOLEAN)
- `last_emotion` (TEXT)
- `objections_detected` (JSONB)
- `recommended_tone` (TEXT: empathetic, urgent, casual, professional, reassuring)
- `is_hot_lead` (BOOLEAN)
- `is_at_risk` (BOOLEAN)

**New columns on `contacts`:**
- `engagement_score` (INT, default 50)
- `sentiment_trend` (TEXT)

**New table: `tenant_notifications`**
- Types: hot_lead, needs_human, objection_detected, sentiment_drop, appointment_booked, sequence_completed, escalation, at_risk
- Fields: type, title, body, priority (low/normal/high/urgent), read, metadata

### Core Library (`emotional-intelligence.ts` — ~602 lines)
```typescript
// Analyze inbound SMS or email with GPT-4o
analyzeMessage(message: string, channel: 'sms'|'email', conversationHistory?: string): Promise<EmotionalAnalysis>

// Analyze voice call transcript with GPT-4o
analyzeCallTranscript(transcript: string, duration: number, disposition: string): Promise<EmotionalAnalysis>

// Compute engagement score (0-100) from recent interactions
computeEngagementScore(interactions: ContactInteraction[]): number

// Detect sentiment trajectory over time
detectSentimentTrend(interactions: ContactInteraction[]): SentimentTrend

// Update enrollment with EI data
updateEnrollmentEI(enrollmentId, analysis, interactions): Promise<void>

// Generate notifications (hot lead, escalation, objection alerts)
generateEINotifications(clientId, contactId, enrollmentId, analysis, contactName?): Promise<void>

// Create a notification record
createNotification(params): Promise<void>
```

### EmotionalAnalysis Type
```typescript
interface EmotionalAnalysis {
    primary_emotion: 'excited'|'interested'|'neutral'|'hesitant'|'frustrated'|'confused'|'angry'|'dismissive';
    emotion_confidence: number; // 0-1
    intent: 'interested'|'not_interested'|'stop'|'reschedule'|'question'|'objection'|'ready_to_buy'|'needs_info';
    objections: Array<{ type: ObjectionType; detail: string; severity: 'mild'|'moderate'|'strong' }>;
    buying_signals: Array<{ signal: string; strength: 'weak'|'moderate'|'strong' }>;
    urgency_level: 'immediate'|'soon'|'flexible'|'no_rush'|'lost';
    recommended_action: 'escalate_to_human'|'continue_sequence'|'pause_and_notify'|'fast_track'|'end_sequence'|'switch_channel'|'address_objection';
    recommended_channel: ChannelType | 'any';
    recommended_tone: 'empathetic'|'urgent'|'casual'|'professional'|'reassuring';
    action_reason: string;
    needs_human_intervention: boolean;
    is_hot_lead: boolean;
    is_at_risk: boolean;
}
```

### Tone Adapter (`tone-adapter.ts` — ~243 lines)
```typescript
// Generate voice agent tone directive for system prompt
buildVoiceAgentToneDirective(state): string

// Get template variables for tone context
getToneTemplateVariables(state): Record<string, string>

// Compute delay multiplier based on emotional state
// Hot lead: 0.5x (faster), At risk: 1.5x (slower), Cooling: 1.3x, etc.
getEmotionBasedDelayMultiplier(state): number
```

### UI Component (`emotion-badge.tsx`)
- Compact inline badge showing emotion icon + color
- Hot lead fire indicator, at-risk warning, needs-human escalation badge
- Configurable sizes (xs, sm, md)

### Integration Points
- **event-processor.ts**: Calls `analyzeMessage()` on every inbound SMS, `analyzeCallTranscript()` on call transcripts. Updates enrollment EI state and generates notifications.
- **scheduler-worker.ts**: Reads enrollment EI fields (sentiment_trend, recommended_tone, is_hot_lead). Calls `getEmotionBasedDelayMultiplier()` for delay adjustment. Calls `buildVoiceAgentToneDirective()` for voice calls. Skips step if `needs_human_intervention` is true.

---

## Phase 3: Adaptive Sequence Mutation

### Purpose
AI-rewrites upcoming sequence step content based on conversation history, emotional state, and objections. The original template is preserved and the mutated version is used for delivery. Configurable aggressiveness levels and optional human guidance instructions.

### Database Schema (`adaptive-mutation-schema.sql`)

**New columns on `sequences`:**
- `enable_adaptive_mutation` (BOOLEAN, default false)
- `mutation_aggressiveness` (TEXT: conservative, moderate, aggressive)

**New columns on `sequence_steps`:**
- `enable_ai_mutation` (BOOLEAN, default false)
- `mutation_instructions` (TEXT — human guidance for AI)

**New table: `step_mutations`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| enrollment_id | UUID | Which enrollment |
| step_id | UUID | Which step was mutated |
| client_id | UUID | Tenant reference |
| original_content | JSONB | Original template content |
| mutated_content | JSONB | AI-rewritten content |
| mutation_reason | TEXT | Why the AI made changes |
| mutation_model | TEXT | e.g., "gpt-4o" |
| confidence_score | NUMERIC | 0-1, must exceed MIN_CONFIDENCE (0.50) |
| aggressiveness | TEXT | conservative, moderate, aggressive |
| resulted_in_reply | BOOLEAN | Outcome tracking |
| resulted_in_conversion | BOOLEAN | Outcome tracking |

### Core Library (`sequence-mutator.ts`)
```typescript
// Determine if mutation should happen
shouldMutate(step, sequence, enrollment, conversationCtx?): boolean

// AI-rewrite content using GPT-4o
mutateStepContent(step, conversationCtx, tenantProfile, aggressiveness): Promise<MutationResult>

// Store mutation audit record
recordMutation(enrollmentId, stepId, clientId, originalContent, mutation, aggressiveness): Promise<void>

MIN_CONFIDENCE = 0.50  // Minimum confidence to use mutated content
```

### Aggressiveness Levels
| Level | Behavior |
|-------|----------|
| **conservative** | Only adjusts tone and phrasing. Same structure and offer. |
| **moderate** | Can reorganize content, emphasize different benefits, address specific objections. |
| **aggressive** | Can completely rewrite the message, change the CTA, add new angles. |

### UI Components
- **sequence-step-editor.tsx**: Toggle for "AI Adaptive Mutation" per step + mutation_instructions textarea
- **sequence-detail-client.tsx**: Sequence-level mutation toggle + aggressiveness dropdown in action bar
- **mutation-badge.tsx**: `MutationBadge` — expandable diff showing original vs mutated; `MutationEnabledDot` — timeline indicator

### Integration in scheduler-worker.ts
```
1. Load conversation context
2. Build template variables
3. ▶ Check shouldMutate() → call mutateStepContent() → recordMutation()
4. Render template (uses mutated content if mutation passed confidence threshold)
5. Check channel overrides (Phase 4)
6. Dispatch to queue
```

---

## Phase 4: Self-Healing Sequences

### Purpose
Intelligently recovers from delivery failures by switching channels, finding alternative contact methods, detecting landlines via Twilio Lookup, and progressively escalating recovery actions. All healing actions are logged for audit and analytics.

### Database Schema (`self-healing-schema.sql`)

**New columns on `sequence_enrollments`:**
- `healing_actions_taken` (JSONB) — Array of healing action records
- `failed_channels` (JSONB) — Array of permanently failed channels
- `channel_overrides` (JSONB) — Map like `{ "sms": "email" }` for permanent rerouting

**New columns on `contacts`:**
- `phone_type` (TEXT: mobile, landline, voip, unknown)
- `email_valid` (BOOLEAN)
- `phone_valid` (BOOLEAN)
- `alternative_email` (TEXT)
- `alternative_phone` (TEXT)

**New table: `healing_log`**
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| enrollment_id | UUID | Which enrollment |
| step_id | UUID | Which step failed |
| client_id | UUID | Tenant |
| failure_type | TEXT | sms_undelivered, email_bounced, call_no_answer, etc. |
| failure_details | JSONB | Raw error data |
| healing_action | TEXT | switch_channel, override_channel, inject_fallback_sms, etc. |
| healing_details | JSONB | What was done (new channel, delay, etc.) |
| healing_succeeded | BOOLEAN | Outcome |

### Core Library (`self-healer.ts` — ~450 lines)
```typescript
// Public entry point: diagnose → execute → log
handleFailure(enrollmentId, stepId, failureType, errorDetails): Promise<void>

// Decision tree based on failure type + history
diagnoseFailure(ctx: FailureContext): HealingAction

// Execute the healing action
executeHealingAction(action: HealingAction, ctx: FailureContext): Promise<void>

// Check if enrollment has channel override
getChannelOverride(enrollment, originalChannel): ChannelType | null

// Check if contact is valid for channel
checkContactValidity(contact, channel): { valid: boolean; reason?: string; failureType?: FailureType }

// Get failure history for progressive escalation
getFailureHistory(enrollmentId): Promise<FailureRecord[]>
```

### Failure Decision Tree
| Failure | 1st Occurrence | 2nd+ Occurrence | Permanent |
|---------|----------------|-----------------|-----------|
| **SMS failed/undelivered** | Retry in 5 min | Check landline → switch email | Override SMS → email |
| **Email bounced** | Retry in 1 hour | Mark email invalid → switch SMS | Override email → SMS |
| **Email spam** | Override all email → SMS | — | — |
| **Call no-answer** | Inject fallback SMS | Extend delay 2hr | Override voice → SMS/email |
| **Call busy** | Extend delay 15 min | — | — |
| **Call failed/capacity** | Inject fallback SMS | — | — |
| **Invalid number** | Override to email | End sequence if no email | — |
| **Landline detected** | Override SMS → email/voice | — | — |

### Phone Type Detection (`sms-worker.ts` addition)
```typescript
// Added before SMS send:
detectAndCachePhoneType(client, contactPhone, enrollmentId, tenantId): Promise<void>
// Uses Twilio Lookup v2 API (line_type_intelligence)
// Caches result on contacts.phone_type
// If landline → triggers handleFailure() → throws LANDLINE_DETECTED
```

### UI Components (`healing-badge.tsx`)
- `HealingBadge` — Expandable inline badge: failure type → healing action → details
- `HealingHistoryPanel` — Full audit trail for an enrollment
- `ChannelOverrideIndicator` — Shows active overrides (e.g., "SMS → EMAIL")

### Integration Points
- **scheduler-worker.ts**: Pre-dispatch `getChannelOverride()` + `checkContactValidity()` checks
- **event-processor.ts**: Triggers `handleFailure()` on SMS delivery failures, call failures, email bounces
- **sms-worker.ts**: `detectAndCachePhoneType()` before sending, throws LANDLINE_DETECTED
- **sequence-detail-client.tsx**: HealingBadge in execution log status column

---

## Phase 5: Outcome-Based Sequence Learning

### Purpose
Tracks which steps, channels, timings, and content actually lead to conversions. Computes step-level attribution, runs A/B tests with statistical significance, generates AI optimization suggestions, and benchmarks against industry averages.

### Database Schema (`outcome-learning-schema.sql`)

**Table: `step_analytics`** — Per-step performance metrics
| Column | Type | Description |
|--------|------|-------------|
| step_id, sequence_id, client_id | UUID | References |
| total_executions, total_delivered, total_failed | INT | Volume |
| total_replies, total_conversions | INT | Outcomes |
| reply_rate, conversion_rate, delivery_rate | NUMERIC | Computed rates |
| attributed_conversions, attribution_score | NUMERIC | Multi-touch attribution |
| optimal_send_hour, optimal_send_day | INT | Timing optimization |
| hourly_response_rates | JSONB | Per-hour rates |
| mutated_executions, mutated_conversions, mutated_conversion_rate | NUMERIC/INT | Mutation tracking |
| total_cost, cost_per_conversion | NUMERIC | Cost efficiency |
| period_start, period_end | TIMESTAMPTZ | Rolling period |

**Table: `sequence_analytics`** — Sequence-level performance
- Funnel: total_enrollments, total_completions, total_conversions, total_opt_outs
- Rates: completion_rate, conversion_rate, reply_rate, opt_out_rate
- Timing: avg_time_to_conversion_hours, avg_steps_to_conversion
- Cost: total_cost, cost_per_conversion, cost_per_enrollment
- Channel breakdown: channel_effectiveness (JSONB)
- Healing: total_healed, healing_success_rate

**Table: `optimization_suggestions`** — AI recommendations
- Types: remove_step, add_step, change_channel, change_timing, change_content, reorder_steps, split_test, merge_sequences, enable_mutation, adjust_aggressiveness
- Fields: title, description, expected_improvement, confidence (low/medium/high)
- Status: pending, accepted, dismissed, auto_applied, expired
- Evidence: JSONB with supporting data

**Table: `step_variants`** — A/B testing
- variant_name, content (JSONB), traffic_weight
- total_sent, total_replies, total_conversions
- reply_rate, conversion_rate
- is_winner, p_value, confidence_interval

**Table: `industry_benchmarks`** — Cross-tenant anonymous benchmarks
- Per industry: avg rates, timing, cost, channel benchmarks
- sample_size, tenant_count

**New columns on `sequence_execution_log`:**
- `variant_id` (UUID) — Which A/B variant was used
- `execution_cost` (NUMERIC) — Cost of this execution

**New columns on `sequence_enrollments`:**
- `converting_step_id` (UUID) — Which step triggered conversion
- `conversion_type` (TEXT: booked, replied, answered, clicked)
- `time_to_conversion_seconds` (INT)

### Core Library (`outcome-learning.ts` — ~600 lines)

**Attribution Engine:**
```typescript
// Multi-touch time-decay attribution
// Last touch: 40%, First touch: 20%, Middle: 40% (time-weighted)
computeStepAttribution(enrollmentId, conversionType): Promise<AttributionResult | null>
```

**Analytics Computation:**
```typescript
computeStepAnalytics(stepId, periodStart, periodEnd): Promise<void>
computeSequenceAnalytics(sequenceId, periodStart, periodEnd): Promise<void>
runAnalyticsJob(): Promise<void>      // Hourly batch job
runBenchmarkJob(): Promise<void>      // Weekly benchmark job
```

**Optimization Engine (7 strategies):**
```typescript
generateOptimizations(sequenceId): Promise<void>
// Strategies:
// 1. Remove underperforming steps (<2% reply rate, >30 deliveries)
// 2. Channel switching (email→SMS if <3% reply, SMS→voice if step 3+)
// 3. Timing optimization (optimal send hour)
// 4. Enable mutation (if mutated versions convert 20%+ better)
// 5. A/B test suggestion (>100 deliveries, no active variants)
// 6. Sequence truncation (if avg conversion happens before last steps)
// Requires >50 enrollments for statistical relevance
```

**A/B Testing:**
```typescript
selectVariant(stepId): Promise<{ variantId, content } | null>  // Weighted random
recordVariantSent(variantId): Promise<void>
evaluateTest(stepId): Promise<boolean>       // Chi-squared significance test
autoPromoteWinner(stepId): Promise<void>     // p_value < 0.05 → promote
```

**Industry Benchmarks:**
```typescript
computeIndustryBenchmarks(industry, periodStart, periodEnd): Promise<void>
compareToIndustry(sequenceId): Promise<{ sequence, industry, delta } | null>
```

### Analytics Worker (`analytics-worker.ts`)
- Runs hourly: step analytics → sequence analytics → A/B evaluation → optimization generation
- Runs weekly: industry benchmark computation
- 10s startup delay to let other workers initialize

### Frontend Components

**ConversionFunnel** (`conversion-funnel.tsx`)
- Visual funnel: Enrolled → Engaged → Replied → Answered → Converted
- Shows drop-off percentages between stages
- Opt-out count display
- Overall conversion rate

**StepAttributionChart** (`step-attribution-chart.tsx`)
- Per-step bar chart showing attribution scores
- Channel icons (SMS/Email/Voice) with color coding
- Trophy icon for high-attribution steps (>30%)
- Stats: delivered, reply rate, conversion rate, AI mutation rate, cost

**OptimizationFeed** (`optimization-feed.tsx`)
- Card-based feed of AI suggestions with accept/dismiss buttons
- Expected improvement percentages with trend-up icon
- Confidence badges (low/medium/high)
- Filter: pending vs all
- Pending count badge

**ABTestPanel** (`ab-test-panel.tsx`)
- Per-step A/B test management
- Create variant form with JSON content input
- Live results: sent, replies, reply rate, conversion rate
- Winner badge + p-value display
- Statistical significance indicator

**IndustryBenchmarks** (`industry-benchmarks.tsx`)
- Your metrics vs industry average grid
- 6 comparison metrics: conversion rate, reply rate, opt-out rate, time to conversion, steps to conversion, cost per conversion
- Trend indicators: green (better), red (worse), gray (neutral)
- Industry label + sample size display

**Learning Dashboard Page** (`/client/[clientId]/sequences/[sequenceId]/learning`)
- "Learning Dashboard" button on sequence detail page (Brain icon, violet)
- Layout: Funnel + Attribution (top row), Optimization Feed + Benchmarks (middle row), A/B Tests per step (bottom)

### Integration Points
- **scheduler-worker.ts**: Calls `selectVariant()` before rendering content, tracks `variant_id` in execution log
- **event-processor.ts**: Calls `computeStepAttribution()` when enrollment is booked or positively replied
- **analytics-worker.ts**: Runs `runAnalyticsJob()` hourly, `runBenchmarkJob()` weekly

---

## Complete File Inventory

### Files Created (New)

| Phase | File | Lines | Purpose |
|-------|------|-------|---------|
| 1 | `sequencer/src/lib/conversation-memory.ts` | ~486 | Cross-channel interaction recording + context |
| 1 | `supabase/contact-interactions-schema.sql` | ~64 | contact_interactions table |
| 2 | `sequencer/src/lib/emotional-intelligence.ts` | ~602 | GPT-4o emotional analysis engine |
| 2 | `sequencer/src/lib/tone-adapter.ts` | ~243 | Tone directives + delay multipliers |
| 2 | `supabase/emotional-intelligence-schema.sql` | ~137 | EI columns + tenant_notifications table |
| 2 | `src/components/contacts/emotion-badge.tsx` | ~100 | Emotion indicator component |
| 3 | `sequencer/src/lib/sequence-mutator.ts` | ~350 | AI content mutation engine |
| 3 | `supabase/adaptive-mutation-schema.sql` | ~80 | Mutation columns + step_mutations table |
| 3 | `src/components/sequences/mutation-badge.tsx` | ~200 | Mutation diff display |
| 4 | `sequencer/src/lib/self-healer.ts` | ~450 | Failure recovery decision tree |
| 4 | `supabase/self-healing-schema.sql` | ~100 | Healing columns + healing_log table |
| 4 | `src/components/sequences/healing-badge.tsx` | ~250 | Healing action display |
| 5 | `sequencer/src/lib/outcome-learning.ts` | ~600 | Attribution + A/B + optimization |
| 5 | `sequencer/src/workers/analytics-worker.ts` | ~65 | Scheduled analytics worker |
| 5 | `supabase/outcome-learning-schema.sql` | ~200 | 5 analytics tables |
| 5 | `src/components/analytics/conversion-funnel.tsx` | ~130 | Funnel visualization |
| 5 | `src/components/analytics/step-attribution-chart.tsx` | ~160 | Attribution chart |
| 5 | `src/components/analytics/optimization-feed.tsx` | ~200 | AI suggestions feed |
| 5 | `src/components/analytics/ab-test-panel.tsx` | ~200 | A/B test management |
| 5 | `src/components/analytics/industry-benchmarks.tsx` | ~200 | Industry comparison |
| 5 | `src/app/client/[clientId]/sequences/[sequenceId]/learning/page.tsx` | ~85 | Learning dashboard page |
| 5 | `src/app/client/[clientId]/sequences/[sequenceId]/learning/learning-ab-tests.tsx` | ~40 | A/B test client wrapper |

### Files Modified

| File | Phase(s) | Changes |
|------|----------|---------|
| `sequencer/src/lib/types.ts` | 1,2,3,4,5 | Added ~300 lines of type definitions across all phases |
| `sequencer/src/lib/redis.ts` | 4,5 | Added healing + analytics queues, updated stats + close |
| `sequencer/src/workers/scheduler-worker.ts` | 1,2,3,4,5 | Conversation context, tone vars, mutation, channel overrides, A/B variants |
| `sequencer/src/workers/event-processor.ts` | 1,2,4,5 | Interaction recording, EI analysis, self-healing triggers, attribution |
| `sequencer/src/workers/sms-worker.ts` | 1,4 | Outbound interaction recording, phone type detection |
| `sequencer/ecosystem.config.js` | 5 | Added analytics-worker process |
| `sequencer/package.json` | 5 | Added analytics-worker script |
| `src/app/actions/sequence-actions.ts` | 1,3,4,5 | Added ~250 lines: interaction timeline, mutation settings, healing log, all Phase 5 analytics actions |
| `src/components/sequences/sequence-step-editor.tsx` | 3 | AI Mutation toggle + instructions textarea |
| `src/components/sequences/sequence-detail-client.tsx` | 3,4 | Mutation controls in action bar, MutationBadge + HealingBadge in execution log |
| `src/app/client/[clientId]/sequences/[sequenceId]/page.tsx` | 5 | Added Learning Dashboard link button |

---

## Scheduler Worker Processing Pipeline (Full Flow)

```
tick() → fetchDueEnrollments() → for each enrollment:
│
├── 0. Check needs_human_intervention flag (Phase 2 EI)
│      → If true: skip step, wait for human
│
├── 1. Check skip conditions (contact_replied, appointment_booked, etc.)
│
├── 2. Check business hours (voice + SMS only)
│
├── 3. TCPA compliance check (no calls/texts 9pm-8am)
│
├── 4. Load conversation context (Phase 1)
│      → getConversationContext(contactId, enrollmentId)
│
├── 5a. Build template variables
│       → Contact fields + custom_variables + conversation vars + tone vars
│
├── 5b. A/B Variant Selection (Phase 5)
│       → selectVariant(stepId) → if variant exists, use variant content
│       → recordVariantSent(variantId)
│
├── 5c. Render template with variables
│
├── 6. Adaptive Mutation (Phase 3)
│      → shouldMutate() → mutateStepContent() → recordMutation()
│      → If confidence >= 0.50: use mutated content
│
├── 7. Self-Healing Channel Override Check (Phase 4)
│      → getChannelOverride(enrollment, channel)
│      → checkContactValidity(contact, dispatchChannel)
│      → If invalid: handleFailure() → return
│
├── 8. Dispatch to queue (sms:send / email:send / vapi:calls)
│      → For voice: inject conversation context + tone directive
│
├── 9. Track variant_id in execution log (Phase 5)
│
└── 10. Advance to next step with emotion-based delay adjustment (Phase 2)
        → getEmotionBasedDelayMultiplier() → adjust delay_seconds
```

---

## Event Processor Flow (on webhook)

```
processEvent(job) → switch event.type:
│
├── sms-reply:
│   ├── analyzeMessage() → EmotionalAnalysis (Phase 2)
│   ├── recordInteraction() (Phase 1)
│   ├── updateContactConversationSummary() (Phase 1)
│   ├── updateEnrollmentEI() (Phase 2)
│   ├── generateEINotifications() (Phase 2)
│   ├── computeStepAttribution() on positive reply (Phase 5)
│   └── Handle EI actions (escalate, fast_track, end)
│
├── call-outcome:
│   ├── Release concurrency slot
│   ├── Update enrollment (answered/booked)
│   ├── computeStepAttribution() if booked (Phase 5)
│   ├── handleFailure() if not answered (Phase 4)
│   ├── analyzeCallTranscript() (Phase 2)
│   ├── updateInteraction() (Phase 1)
│   ├── updateEnrollmentEI() (Phase 2)
│   └── generateEINotifications() (Phase 2)
│
├── sms-delivery:
│   ├── Update execution log status
│   └── handleFailure() if failed/undelivered (Phase 4)
│
├── email-bounced:
│   ├── Update execution log + interaction
│   └── handleFailure() with email_bounced (Phase 4)
│
├── email-opened: Update interaction outcome
└── email-clicked: Update interaction outcome
```

---

## SQL Migration Order

Run these in order against Supabase:
1. `supabase/contact-interactions-schema.sql` (Phase 1)
2. `supabase/emotional-intelligence-schema.sql` (Phase 2)
3. `supabase/adaptive-mutation-schema.sql` (Phase 3)
4. `supabase/self-healing-schema.sql` (Phase 4)
5. `supabase/outcome-learning-schema.sql` (Phase 5)

---

## Environment Variables Required

```env
# Supabase
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=

# Redis
REDIS_URL=redis://localhost:6379

# OpenAI (for EI analysis, mutation, optimization)
OPENAI_API_KEY=

# Twilio (for SMS + phone lookup)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_MESSAGING_SERVICE_SID=

# VAPI (for voice calls)
VAPI_API_KEY=
```

---

## Build Verification

Both builds pass cleanly:
- `cd /Users/vishnuanilkumar/Omnify && npx next build` — Frontend compiles with all routes
- `cd /Users/vishnuanilkumar/Omnify/sequencer && npx tsc --noEmit` — Backend compiles with no errors
