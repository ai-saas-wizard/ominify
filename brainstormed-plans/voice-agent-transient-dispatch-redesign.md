# Voice Agent Transient Dispatch Redesign

## Problem

When the sequencer dispatches outbound voice calls, it has two bad paths:

1. **`vapi_assistant_id` path** — Uses a fixed VAPI agent. All dynamic prompt work (conversation memory, EI tone directives, mutations) is built by the scheduler but **thrown away** by `vapi-worker.ts:98-110` because it switches to the fixed assistant ID. Only `override_variables` survive.

2. **Inline transient path** — Dynamic prompt works, but voice is hardcoded to `playht/jennifer` and model to `gpt-4` instead of the tenant's actual `11labs/Sarah` and `gpt-4o-mini` configured during onboarding.

Neither gives us: **tenant's real voice/model config + dynamic prompt per call**.

Additionally, the full system prompt and agent config live only in VAPI's system — not in our DB. If VAPI is down at dispatch time or we need to reconstruct the agent, we can't.

---

## Solution: Agent Blueprint + Section-Based Prompt Overrides

### Core Idea

During onboarding, save the full VAPI agent config as a **blueprint** in our DB. At call dispatch, load the blueprint, surgically edit only the prompt sections that need to change (conversation memory, tone, mutations), and send it as an **inline/transient agent** to VAPI. Never use `assistantId` for sequence calls.

---

## 1. Prompt: Section-Based Overrides (Not Full Swap)

The onboarding prompt from `prompt-templates.ts` already has a natural structure. Store the base prompt as **named sections**, not a single string:

```json
{
  "prompt_sections": {
    "identity": "You are Sarah, a receptionist at ...",
    "business_context": "We serve the Phoenix metro area...",
    "conversation_flow": "Step 1: Greet warmly...",
    "qualification": "Ask about timeline, budget...",
    "brand_voice": "Friendly but professional...",
    "closing": "Always offer to book an appointment..."
  }
}
```

At dispatch time, the sequencer builds an **override map** — only the sections it wants to change:

```json
{
  "step_overrides": {
    "conversation_flow": "This is a follow-up call. The lead...",
    "closing": "Reference the previous SMS they replied to..."
  }
}
```

Identity, business_context, brand_voice remain untouched from the base.

Then the mutation engine operates on **individual sections** — it might rewrite `conversation_flow` based on EI signals but leave `identity` and `qualification` alone.

Conversation memory and tone directives become **injected sections** (`conversation_history`, `tone_directive`) that don't exist in the base but get appended at render time.

**Why this scales:**
- Base prompt changes (onboarding edits, tenant profile updates) propagate automatically — overridden sections stay overridden, everything else picks up the latest base
- Mutations are scoped — you can track which section was mutated and measure its impact independently
- Prompt size stays controlled — you're not duplicating the entire prompt per step, just the deltas

---

## 2. Tools: Inherit Base + Step-Level Add/Remove

The base agent's tools are the default. Steps declare **modifiers**, not full tool sets:

```json
{
  "tool_overrides": {
    "add": ["transfer_to_human"],
    "remove": ["book_appointment", "check_availability"]
  }
}
```

- **Cold outreach step** → `remove: ["book_appointment"]` — lead hasn't shown interest, no point offering booking
- **Follow-up after positive EI signal** → keep booking tools, maybe `add: ["send_follow_up_sms"]`
- **Dynamic step generator** can emit tool overrides too — if EI detects a hot lead, the generated step could add booking tools even if the sequence template wouldn't have them

**Why this scales:**
- When you add a new tool to the base agent (e.g., payment link tool), every sequence step gets it automatically unless explicitly removed
- Step definitions stay lightweight — just deltas
- The self-healer could add `transfer_to_human` if it detects conversation going sideways, without needing a separate step config

---

## 3. First Message: Dynamic, Same Section-Override Pattern

`first_message` should be dynamic per step and eligible for mutation:

- **Step 1** (cold): Use base first message or step-defined override
- **Step 3** (after SMS reply): Mutation engine rewrites it referencing the SMS — "Hey {first_name}, I saw your message about the leak — wanted to follow up personally"
- **Step 5** (re-engagement after silence): Different tone entirely

Conversation memory should feed into `first_message` mutation too — it's the contact's first impression of the call.

---

## 4. Schema: Dedicated `agent_blueprint` JSONB Column

**Don't expand `agent_config`** — it serves a different purpose (UI metadata, billing). Add a new column:

```sql
ALTER TABLE agents ADD COLUMN agent_blueprint JSONB;
```

Structure:

```json
{
  "version": "1.0",
  "prompt_sections": {
    "identity": "...",
    "business_context": "...",
    "conversation_flow": "...",
    "qualification": "...",
    "brand_voice": "...",
    "closing": "..."
  },
  "first_message": "Hi, this is Sarah from...",
  "model": {
    "provider": "openai",
    "model": "gpt-4o-mini",
    "temperature": 0.7
  },
  "voice": {
    "provider": "11labs",
    "voiceId": "EXAVITQu4vr4xnSDxMaL",
    "voiceName": "Sarah"
  },
  "transcriber": {
    "provider": "deepgram",
    "model": "nova-2",
    "language": "en"
  },
  "tools": ["check_availability", "book_appointment", "end_call"],
  "settings": {
    "maxDurationSeconds": 300,
    "backgroundSound": "office",
    "voicemailMessage": "...",
    "endCallMessage": "..."
  }
}
```

**Why separate from `agent_config`:**
- `agent_config` is read by the frontend for UI display. `agent_blueprint` is read by the sequencer for call dispatch. Different consumers, different lifecycles.
- Blueprint is the source of truth for "what does this agent sound and behave like." Config is metadata about the agent entity.
- When the tenant edits their agent in the UI, you update both VAPI (via API) and the blueprint in DB. They stay in sync, but you're not dependent on VAPI being available at dispatch time.

**Why this scales:**
- Blueprint is self-contained — the sequencer doesn't need to call VAPI's GET assistant API at dispatch time (no added latency or failure point)
- Version field lets you migrate blueprint structure without breaking existing agents
- If you ever support multiple voice providers beyond VAPI, the blueprint is provider-agnostic enough to adapt

---

## 5. Full Dispatch Flow (Proposed)

1. Scheduler loads step + agent blueprint from DB (single query with join)
2. Apply step-level `prompt_section_overrides` and `tool_overrides`
3. Mutation engine rewrites specific sections if `shouldMutate()`
4. Conversation memory + tone directive injected as additional sections
5. `first_message` override or mutation applied
6. Assemble final prompt from sections, build inline VAPI payload from blueprint
7. Dispatch to vapi-worker — **always transient/inline, never `assistantId`**

No VAPI assistant reference needed at call time. The `vapi_id` still exists for managing the agent in VAPI's dashboard, but the sequencer doesn't use it.

---

## Key Files to Modify

| File | Change |
|------|--------|
| `sequencer/src/workers/vapi-worker.ts` | Remove `assistantId` path, always use inline agent built from blueprint |
| `sequencer/src/workers/scheduler-worker.ts` | Load blueprint, apply section overrides, pass assembled config to queue |
| `sequencer/src/lib/types.ts` | Add `AgentBlueprint` type, update `VoiceContent` to carry full config |
| `sequencer/src/lib/sequence-mutator.ts` | Mutate individual prompt sections instead of whole `system_prompt` |
| `src/app/actions/assistant-creation-actions.ts` | Save blueprint to DB during onboarding |
| `src/app/actions/agent-deployment-actions.ts` | Save blueprint on agent deploy |
| `supabase/migrations/` | Add `agent_blueprint` column to `agents` table |

---

## Open Questions

- **Blueprint sync**: When tenant edits agent in UI, how do we keep blueprint in DB and VAPI config in sync? Update both atomically, or treat DB as source of truth and push to VAPI?
- **Tool definitions**: Currently tools are full function schemas (check_availability with all params). Do we store full schemas in blueprint or just tool names and resolve schemas at dispatch time?
- **Section naming convention**: Need to standardize section names across all prompt templates (v1, v2, dynamic) so the override system works consistently.

---

*Brainstormed: 2026-04-02*
