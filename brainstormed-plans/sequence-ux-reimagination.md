# Sequence UX Reimagination — Goal-First Wizard + Interactive Simulation + Handoff Rules

## Problem

The current sequence builder requires 8+ decisions across multiple screens before a single message goes out. It looks and feels like every other sequencer (GHL, Outreach, Salesloft) — a manual step-by-step flow builder with JSON content visible in nodes.

Meanwhile, Omnify's actual differentiator — live AI voice calls, cross-channel conversation memory, emotional intelligence, and real-time message adaptation — is invisible to the user. The UI makes it look like a static automation tool when it's actually an adaptive AI system.

**The gap:** The product is smarter than the UI makes it look.

---

## Target Users

**Both equally:**
- **Small business owners** (plumbers, roofers, dentists) — non-technical, want to flip a switch and have leads followed up. Don't know what a "sequence" is.
- **Sales teams / SDRs** — understand outreach, want some control over messaging and timing but don't want to spend 30 minutes building each sequence.

---

## Solution: Two-Layer Model

### Layer 1: Goal-First Wizard (default for everyone)
Simple 4-screen flow that any business owner can complete in under 2 minutes.

### Layer 2: Advanced Editor (escape hatch for power users)
The existing flow canvas, accessible from the wizard output. Same underlying data, more control.

---

## Layer 1: Goal-First Wizard

### Screen 1 — "What do you want to achieve?"

Pre-built goal cards, one tap to select:

| Goal Card | Description | Inferred Settings |
|-----------|-------------|-------------------|
| Follow up on missed calls | Reach leads who called but didn't connect | Trigger: missed_call, Urgency: high, Default cadence: 4/week |
| Re-engage dormant leads | Win back leads who went cold | Trigger: manual/tag, Urgency: medium, Default cadence: 2/week |
| Nurture new leads | Build relationship with fresh inbound leads | Trigger: new_lead, Urgency: medium, Default cadence: 3/week |
| Post-appointment follow-up | Stay top-of-mind after a visit/estimate | Trigger: status_change, Urgency: low, Default cadence: 1/week |
| Win back lost quotes | Re-engage leads who got a quote but didn't convert | Trigger: manual, Urgency: medium, Default cadence: 2/week |
| **Custom goal** | "Describe what you want..." (free text) | AI infers settings from description |

Each card shows: icon + title + one-line description. No jargon (no "trigger type", "urgency tier", "generation mode").

**Under the hood:** Selecting a goal card sets trigger_type, urgency_tier, generation_mode='dynamic', and default cadence/duration. These map directly to existing `Sequence` fields.

### Screen 2 — "How should we reach them?"

**Channels** — toggle on/off:
- 📱 SMS (on by default)
- ✉️ Email (on by default)
- 📞 Voice Calls (on by default; shows "Set up your AI agent first" if no agent exists)

**Cadence** — simple slider:
- "Touchpoints per week" — 1 to 5
- Default set by goal card, user can adjust
- Visual indicator: 1 = "Gentle" ... 5 = "Persistent"

**Duration** — dropdown or slider:
- "Run for __ weeks" — 1, 2, 3, 4, 6, 8
- Default set by goal card (e.g., missed call = 2 weeks, dormant = 4 weeks)

**That's it.** Three controls. No per-step configuration. No delay settings. No content writing.

**Under the hood:** Cadence + duration + channels → AI calculates optimal step count, channel distribution, and timing. A 3/week × 2 week sequence with all channels = ~6 touches, distributed across SMS/email/voice with intelligent spacing.

### Screen 3 — "When should we hand it to you?"

This is where the business owner defines the boundary between what the AI handles and what they handle personally. Critical because the AI can't know that a plumber needs to personally measure before quoting, or that only the owner can authorize discounts.

#### Section 1: Success Conditions (what does "done" look like?)

Cards/checkboxes — select one or more:

| Condition | Example | What happens |
|-----------|---------|-------------|
| When they book an appointment | "Thursday morning works" | AI confirms booking, sequence ends, owner notified |
| When they express interest | "Yeah I'd like to know more" | AI flags as hot lead, owner notified, sequence can continue or pause (configurable) |
| When they ask for a quote/pricing | "How much for a full remodel?" | AI hands over, owner notified with full context |
| When they agree to next steps | "Sure, send me the details" | AI confirms, sequence ends or transitions |

Defaults vary by goal card from Screen 1:
- Missed call follow-up → "When they book an appointment" pre-checked
- Dormant re-engage → "When they express interest" pre-checked
- Win back lost quotes → "When they ask for a quote/pricing" pre-checked

#### Section 2: Handoff Triggers (when should the AI step aside?)

These are scenarios where the AI should NOT try to handle it — just notify and freeze.

**Pre-built triggers** (shown based on tenant industry from their profile):

For **home services** (plumber, roofer, HVAC):
- ☐ They need an in-person estimate or measurement
- ☐ They ask about pricing I haven't configured
- ☐ They mention emergency/urgent work
- ☐ They ask about commercial (not residential) work

For **medical/dental**:
- ☐ They describe symptoms or medical concerns
- ☐ They ask about insurance coverage
- ☐ They need to reschedule an existing appointment

For **general services**:
- ☐ They ask for a discount or coupon code
- ☐ They mention a competitor
- ☐ They have a complaint about past service
- ☐ They request a specific person by name

**Custom triggers** (free text input):
```
+ Add your own: "If they ____________"
```
Examples: "If they ask about financing options", "If they want a same-day appointment", "If the job is over $5000"

The AI interprets these as intent-based rules. They get injected into the EI analysis prompt, the SMS/email responder prompts, and the voice agent prompt sections so every channel knows when to step aside.

#### Section 3: No-Response Rules

Simple controls for when the lead goes dark:

- **"Stop after __ touchpoints with no response"** — slider, default based on cadence × duration (e.g., 3/week × 2 weeks = 6, but owner can cap at 4)
- **"If no response after the sequence ends"** — dropdown:
  - Mark as cold (default)
  - Re-engage automatically in __ weeks
  - Notify me to follow up personally

#### Section 4: How to Notify You

When a handoff trigger fires or success condition is met:

- 📱 **Text me** at (555) 123-4567 — pre-filled from tenant profile
- ✉️ **Email me** at owner@business.com — pre-filled from tenant profile
- 🔔 **Push notification** in Omnify
- Toggle: **Urgent handoffs** (complaint, emergency, hot lead) → also call me

Each notification includes full context: the conversation history, EI summary (sentiment, intent, what the lead asked for), and a one-line recommendation ("Mike asked for a bathroom remodel quote. He's warm — call him today.")

#### How Handoff Rules Feed Into the System

The handoff configuration is stored on the `sequences` table as a JSONB field:

```json
{
  "handoff_rules": {
    "success_conditions": ["appointment_booked", "pricing_requested"],
    "handoff_triggers": [
      { "type": "preset", "id": "in_person_estimate" },
      { "type": "preset", "id": "pricing_not_configured" },
      { "type": "custom", "description": "If they ask about financing options" }
    ],
    "no_response": {
      "max_touchpoints": 6,
      "after_sequence": "mark_cold"
    },
    "notification": {
      "sms": "+15551234567",
      "email": "owner@business.com",
      "push": true,
      "urgent_call": false
    }
  }
}
```

These rules get injected into **every AI touchpoint**:

1. **EI analysis prompt** (`emotional-intelligence.ts`) — "In addition to standard escalation rules, escalate when: [custom triggers]. Always escalate when: [preset triggers]."
2. **SMS/Email responder prompts** (`sms-responder.ts`, `email-responder.ts`) — "If the customer mentions [trigger], respond with 'Let me have [owner name/agent name] follow up with you personally on that' and flag for handoff."
3. **Voice agent prompt sections** (from agent blueprint) — Injected as a `handoff_rules` section: "If the customer asks about [trigger], acknowledge their request, let them know someone will follow up, and end the call gracefully."
4. **Dynamic step generator** (`dynamic-step-generator.ts`) — "Do not generate further steps after a handoff trigger has fired. If success condition met, end the sequence."
5. **Outbound content generator** (`outbound-generator.ts`) — "The lead has previously triggered [condition]. Do not pursue this topic — it's being handled by the business owner."

The owner's rules **always take priority** over the AI's own judgment. If the owner says "always hand over pricing questions," the AI does it even if the EI layer thinks it can handle it.

#### Handoff vs. Escalation (Clarification)

The existing EI system has `recommended_action: 'escalate_to_human'` which fires when the AI detects anger, complex objections, or explicit requests to talk to a human. This is **AI-initiated escalation** — the AI decides on its own.

Handoff rules are **owner-initiated rules** — the owner pre-defines when to hand over. Both coexist:

- AI escalation: "This customer is furious, I should get a human" → fires even if no handoff rule matches
- Owner handoff: "They asked about commercial work" → fires even if the AI thinks it can handle it
- Both trigger the same outcome: `needs_human_intervention = true`, notification sent, sequence paused

#### What the Simulation Shows

The simulation (Screen 4) includes handoff scenarios. At least one of the generated scenarios should demonstrate a handoff firing:

```
📞 Day 2 — Voice Call
Sarah: "...I'd love to help you get that estimate set up"
Mike: "Yeah, how much would a full bathroom remodel run?"

🔔 HANDOFF → You get notified
AI thinking: "Customer asked about pricing — this business
handles custom quotes personally."

📱 Notification to you:
"Mike R. wants a bathroom remodel quote. He's warm, had a
4-min call with Sarah. Prior SMS: asked about availability.
Recommendation: Call him today while he's engaged."
```

This builds trust: the owner sees the AI knows its boundaries and will get them involved at the right moment.

### Screen 4 — "Watch your AI in action" (Interactive Simulation)

This is the differentiator. Instead of showing a flow diagram or a list of fixed messages, the user watches a **simulated lead journey** unfold.

#### The Simulation UI

A timeline / chat-style view that auto-plays like a movie:

**Components per timeline entry:**
1. **Timestamp** — "Day 1, 10:02 AM"
2. **Channel badge** — SMS / Email / Voice Call
3. **Message preview** — the actual message the AI would send
4. **"AI thinking" bubble** — shows the AI's reasoning ("First touch, warm intro, keep it short")
5. **Simulated lead response** (when applicable) — "Mike replies: Need a quote for a bathroom remodel"
6. **Adaptation callout** (when the AI changes course) — "AI adapts: Lead expressed interest, moving voice call up and referencing their remodel question"

**Interaction:**
- Auto-plays with 1-2 second delays between entries (feels like watching it happen)
- Scroll to explore or let it play
- **"Simulate another scenario"** button — generates a different path:
  - Scenario A: Lead engages positively, books appointment
  - Scenario B: Lead never responds, AI backs off gracefully
  - Scenario C: Lead is hostile/opts out, AI handles it professionally
  - Scenario D: Lead asks a question, chatbot engages
  - Scenario E: Lead triggers a handoff rule, owner gets notified with full context
- **"Replay with different responses"** — lets user see how the AI adapts to different lead behaviors

**What this shows the owner:**
- "This is what my leads will experience"
- "The AI adapts based on what happens — it's not sending the same canned messages to everyone"
- "It handles edge cases — no-replies, opt-outs, hostile responses"
- "The messages sound like my brand, not a robot"

#### Simulation Generation (behind the scenes)

**One GPT call generates the entire simulation:**

Input:
- Goal (from Screen 1)
- Channels + cadence + duration + aggressiveness (from Screen 2)
- Handoff rules + success conditions + notification prefs (from Screen 3)
- Tenant profile (business_name, brand_voice, industry, services, timezone)
- Agent persona (from agent blueprint — voice name, greeting style)
- Scenario type (positive/neutral/negative/opt-out/handoff)

Output — structured JSON:
```json
{
  "scenario_name": "Engaged lead books appointment",
  "fake_contact": { "name": "Mike Rodriguez", "source": "Missed call" },
  "timeline": [
    {
      "day": 1, "time": "10:02 AM",
      "channel": "sms",
      "direction": "outbound",
      "content": "Hey Mike, noticed I missed your call earlier!...",
      "ai_reasoning": "First touch, warm intro, reference the missed call",
      "step_brief": { "intent": "warm intro after missed call", "cta": "get them to respond" }
    },
    {
      "day": 1, "time": "10:15 AM",
      "channel": "sms",
      "direction": "inbound",
      "content": "Need a quote for a bathroom remodel",
      "ai_analysis": "Positive sentiment, service inquiry, buying signal detected"
    },
    {
      "day": 1, "time": "10:16 AM",
      "channel": "sms",
      "direction": "outbound",
      "content": "Great timing Mike! We have availability this week...",
      "ai_reasoning": "Hot lead response, pivot to booking immediately",
      "adaptation": "Moved voice call earlier due to positive engagement"
    }
  ]
}
```

The frontend renders this as the animated timeline.

#### What gets saved when user clicks "Activate"

The simulation is just for preview. What actually gets saved is:

1. **Sequence** with goal, trigger, urgency, cadence, duration, channels, generation_mode='dynamic'
2. **Sequence strategy** with the goal, available channels, max steps, agent context
3. **Handoff rules** — success conditions, handoff triggers, no-response rules, notification prefs (JSONB on sequence)
4. **Step briefs** — one per touchpoint, generated from the simulation's intent structure

The step briefs are the "plan" the AI follows. At dispatch time, actual messages are generated fresh using the brief + real conversation memory (as defined in the SMS/Email Channel Parity plan).

### Activation Flow

After the simulation, one button: **"Activate"**

- Creates the sequence in the DB
- Saves the step briefs
- Sets sequence to active
- Shows confirmation: "Your AI is now following up on missed calls. You'll be notified when leads engage."

**Total time from start to activation: ~90 seconds.**

---

## Layer 2: Advanced Editor (Power User Escape Hatch)

### Access Points
- From the wizard preview: small link — "Customize in advanced editor"
- From the sequences list: "Create from scratch" link (opens old create dialog → flow canvas)
- From any active sequence: "Edit sequence" opens the flow canvas

### What Power Users Get
- The existing flow canvas with all current functionality
- Step-by-step editing: channel, content, timing, skip conditions, mutation settings, success/failure handlers
- For wizard-created sequences: the step briefs are visible and editable
- Can switch individual steps between brief-based (AI generates at dispatch) and static (fixed template)
- Can add conditional branches, wait steps, etc.

### The Data is the Same
Both the wizard and the advanced editor operate on the same `sequences` + `sequence_steps` tables. The wizard just abstracts the creation. The advanced editor provides full access.

---

## Post-Activation Experience

### What the owner sees after activating

Instead of a flow diagram, they see a **live dashboard** for the sequence:

**Key metrics:**
- Leads in sequence: 23
- Messages sent this week: 47
- Replies received: 8
- Appointments booked: 2
- Active conversations: 5

**Recent activity feed** (live):
```
2 min ago — AI sent SMS to Mike R. about the remodel estimate
15 min ago — Sarah (voice) called Lisa K., discussed pricing,
             booked appointment for Thursday
1 hr ago — Alex M. replied to SMS: "Not interested right now"
           → AI paused sequence, will re-engage in 2 weeks
```

**"Watch live"** — tap any active lead to see their full conversation timeline (actual, not simulated) with the same AI thinking/adaptation callouts from the simulation.

This reinforces the value: "My AI is working. I can see it thinking and adapting."

---

## Technical Integration with Existing Plans

### How this connects to the Voice Agent Blueprint plan:
- Simulation uses agent persona (voice name, brand voice) from the `agent_blueprint` JSONB
- "Voice Call" entries in the simulation show what the agent would say using the blueprint's prompt sections

### How this connects to the SMS/Email Channel Parity plan:
- Step briefs from the wizard ARE the `step_brief` field defined in that plan
- The simulation's message generation uses the same `outbound-generator.ts` function
- Inbound responses in the simulation demonstrate the chatbot + EI loop

### How this connects to the existing AI sequence generation:
- `ai-generate-sequence-actions.ts` already generates sequences from goals
- The wizard is a structured input version of the conversational generation (goal cards instead of chat)
- The simulation is a rendered version of what `confirmAndGenerate()` produces

---

## Competitive Positioning

| Feature | GHL / Outreach | Lemlist / Instantly | Omnify |
|---------|---------------|-------------------|--------|
| **Setup** | Build step by step | Prompt → generate | Goal card → 3 toggles → simulate → activate |
| **Preview** | Flow diagram | Message list | **Interactive simulation with AI reasoning** |
| **Voice** | None | None | **Real AI voice calls visible in simulation** |
| **Trust-building** | "Trust the automation" | "Here's what we'll send" | **"Watch your AI handle a lead before going live"** |
| **Adaptation visibility** | Hidden | Hidden | **AI thinking/adaptation bubbles** visible to user |
| **Time to activate** | 20-30 min | 5-10 min | **~90 seconds** |
| **Technical skill needed** | Sales ops knowledge | Basic prompt writing | **None — tap a goal card** |
| **Handoff control** | Manual stop/start | Basic auto-stop | **Owner-defined handoff rules + AI judgment combined** |
| **Handoff context** | "Lead stopped responding" | Basic status | **Full conversation history + EI summary + recommendation** |

---

## New Files (Frontend)

| File | Purpose |
|------|---------|
| `src/components/sequences/wizard/goal-selector.tsx` | Screen 1: goal card grid |
| `src/components/sequences/wizard/channel-config.tsx` | Screen 2: channel toggles + cadence slider + duration |
| `src/components/sequences/wizard/handoff-rules.tsx` | Screen 3: success conditions, handoff triggers, no-response, notifications |
| `src/components/sequences/wizard/simulation-view.tsx` | Screen 4: interactive simulation timeline |
| `src/components/sequences/wizard/simulation-entry.tsx` | Single timeline entry (message, AI thinking, adaptation) |
| `src/components/sequences/wizard/index.tsx` | Wizard orchestrator (3-screen flow) |
| `src/app/actions/simulation-actions.ts` | Server action: generate simulation from goal + config |
| `src/components/sequences/live-dashboard.tsx` | Post-activation: live metrics + activity feed |

## Modified Files

| File | Change |
|------|--------|
| `src/app/client/[clientId]/sequences/page.tsx` | Default CTA opens wizard instead of create dialog |
| `src/app/actions/sequence-actions.ts` | New `createSequenceFromWizard()` that takes goal + config instead of manual fields |
| `src/app/actions/ai-generate-sequence-actions.ts` | Extract shared generation logic, add simulation output format |

---

## Rollout Strategy

1. **Phase 1: Wizard + Static Preview** — Goal cards → config → strategy view (text-based intent tree, no simulation yet). Gets the simplified flow live fast.
2. **Phase 2: Simulation** — Add the interactive simulation with AI-generated timeline. The killer feature.
3. **Phase 3: Live Dashboard** — Replace the flow canvas as the default post-activation view. Activity feed + live conversations.
4. **Phase 4: "Watch Live"** — Tap any active lead to see their real conversation timeline with AI reasoning.

Phase 1 can ship quickly (mostly frontend + one server action). Phase 2 is the differentiation play. Phases 3-4 are the long-term retention story.

---

## Open Questions

- **Simulation speed:** Auto-play at 1-2 sec per entry, or let user control the pace? Could offer both (play/pause + skip ahead).
- **How many scenarios:** Generate 2-3 pre-built scenarios (positive, neutral, negative) on load, or generate one at a time on demand?
- **Mobile experience:** The simulation timeline should work well on mobile (business owners check on their phone). Need to design for narrow screens.
- **Wizard for existing sequences:** Can an owner re-enter the wizard to adjust an active sequence (change cadence, add a channel, update handoff rules), or do they need the advanced editor for changes?
- **Industry presets:** How many industry-specific handoff trigger presets do we need at launch? Start with home services + medical/dental + general, expand later?
- **Handoff trigger learning:** Should the system suggest new handoff triggers based on patterns it sees? e.g., "3 leads this week asked about financing — want to add that as a handoff trigger?"

---

*Brainstormed: 2026-04-04*
