"use server";

import OpenAI from "openai";
import { supabase } from "@/lib/supabase";

// ─── Types ───

interface SimulationInput {
    clientId: string;
    goal: string;
    customGoalDescription?: string;
    channels: { sms: boolean; email: boolean; voice: boolean };
    /** Operator-chosen opening channel. Omitted/null = infer it from the goal. */
    firstTouch?: "sms" | "email" | "voice" | null;
    cadence: number;
    duration: number;
    handoffRules: {
        success_conditions: string[];
        handoff_triggers: Array<{ type: string; label: string; id?: string }>;
    };
    scenarioType?: "positive" | "neutral" | "negative" | "opt_out" | "handoff";
}

interface SimulationEntry {
    day: number;
    time: string;
    channel: "sms" | "email" | "voice";
    direction: "outbound" | "inbound";
    content: string;
    ai_reasoning?: string;
    ai_analysis?: string;
    adaptation?: string;
    step_brief?: { intent: string; cta: string };
    handoff?: {
        triggered: boolean;
        reason: string;
        notification: string;
    };
}

interface SimulationScenario {
    scenario_name: string;
    scenario_type: "positive" | "neutral" | "negative" | "opt_out" | "handoff";
    fake_contact: { name: string; source: string };
    timeline: SimulationEntry[];
}

// ─── Tenant Profile Fetcher ───

async function getTenantContext(clientId: string) {
    const { data: profile } = await supabase
        .from("tenant_profiles")
        .select("*")
        .eq("client_id", clientId)
        .single();

    const { data: agents } = await supabase
        .from("agents")
        .select("id, name, agent_type")
        .eq("client_id", clientId)
        .limit(1);

    return {
        businessName: profile?.business_name || profile?.legal_business_name || "Your Business",
        industry: profile?.industry || "general",
        brandVoice: profile?.brand_voice || "professional",
        timezone: profile?.timezone || "America/New_York",
        services: profile?.job_types || [],
        agentName: agents?.[0]?.name || "Sarah",
    };
}

// ─── Goal Label Map ───

const GOAL_LABELS: Record<string, string> = {
    missed_call_followup: "Follow up on missed calls",
    dormant_reengagement: "Re-engage dormant leads",
    new_lead_nurture: "Nurture new leads",
    post_appointment: "Post-appointment follow-up",
    win_back_quotes: "Win back lost quotes",
    meta_ads_lead: "Convert Meta Ads leads",
    google_ads_lead: "Convert Google Ads leads",
    custom: "Custom goal",
};

const TRIGGER_SOURCE_MAP: Record<string, string> = {
    missed_call_followup: "Missed call",
    dormant_reengagement: "CRM — dormant 30+ days",
    new_lead_nurture: "Website form submission",
    post_appointment: "Appointment completed",
    win_back_quotes: "Quote sent — no response",
    meta_ads_lead: "Meta Lead Ad submission",
    google_ads_lead: "Google Lead Form Asset submission",
    custom: "Manual enrollment",
};

// ─── Main Generation ───

export async function generateSimulation(
    input: SimulationInput
): Promise<{ success: boolean; scenario?: SimulationScenario; error?: string }> {
    try {
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY,
            timeout: 60_000,
        });

        const tenant = await getTenantContext(input.clientId);

        const enabledChannels = Object.entries(input.channels)
            .filter(([, v]) => v)
            .map(([k]) => k);

        const totalTouchpoints = input.cadence * input.duration;
        const goalLabel = input.goal === "custom"
            ? input.customGoalDescription || "Custom outreach"
            : GOAL_LABELS[input.goal] || input.goal;

        const scenarioType = input.scenarioType || "positive";
        const contactSource = TRIGGER_SOURCE_MAP[input.goal] || "Manual enrollment";

        const handoffTriggersList = input.handoffRules.handoff_triggers
            .map((t) => `- ${t.label}`)
            .join("\n");

        const successConditionsList = input.handoffRules.success_conditions
            .map((c) => `- ${c.replace(/_/g, " ")}`)
            .join("\n");

        // The operator can pin the opening channel. Only honor a pick that is
        // actually enabled — otherwise fall back to inferring it from the goal.
        const firstTouch =
            input.firstTouch && enabledChannels.includes(input.firstTouch)
                ? input.firstTouch
                : null;

        const firstTouchRule = firstTouch
            ? `0. FIRST TOUCH CHANNEL (non-negotiable): the operator explicitly chose
   "${firstTouch}" as the opening channel. The FIRST entry of the timeline MUST
   be direction "outbound" with channel "${firstTouch}". Do NOT infer a
   different opener from the goal text, the channel list order, or which
   channel is cheaper. Other enabled channels may only appear as LATER steps,
   under the rules below.`
            : `0. FIRST TOUCH CHANNEL (decide this before anything else): the opening outbound
   is whichever ENABLED channel the stated goal actually calls for. Read the
   Goal text above and honour what it describes — if it talks about calling,
   dialling, cold calling, or an agent speaking to the lead, open with "voice";
   if it talks about texting, messaging, or a text-first nurture, open with
   "sms"; if it describes emailing, open with "email". When the goal names a
   later channel too ("call them, then text the link"), that later channel is a
   FOLLOW-UP step, not the opener. Only when the goal implies no channel at all
   should you infer one from the contact data available (phone-only lists
   suggest voice or sms; email-only lists suggest email). There is no default
   channel — never open with SMS merely because it is listed first or because
   it is the lower-effort option. This timeline becomes the operator's real
   campaign plan, so the opening channel must be the one they asked for.`;

        const firstTouchExampleChannel = firstTouch
            ? `"${firstTouch}"`
            : `"<the first-touch channel you chose per rule 0 — NOT automatically sms>"`;

        const prompt = `You are generating a realistic simulation of an AI-powered lead follow-up sequence for a business owner to preview. The simulation MUST behave EXACTLY like the production sequencer — same channel selection, same opt-out handling, same handoff behavior. Owners watching this preview need to trust that the live system will act the same way.

BUSINESS CONTEXT:
- Business: ${tenant.businessName}
- Industry: ${tenant.industry}
- Brand voice: ${tenant.brandVoice}
- AI Agent name: ${tenant.agentName}
- Services: ${JSON.stringify(tenant.services.slice(0, 5))}

SEQUENCE CONFIG:
- Goal: ${goalLabel}
- Enabled channels: ${enabledChannels.join(", ")}
- Cadence: ${input.cadence} touchpoints/week
- Duration: ${input.duration} weeks
- Total touchpoints: ~${totalTouchpoints}

HANDOFF RULES:
Success conditions:
${successConditionsList || "- None specified"}

Handoff triggers (AI must step aside):
${handoffTriggersList || "- None specified"}

SCENARIO TYPE: ${scenarioType}
${scenarioType === "positive" ? "Lead engages positively across 2-3 replies on the same channel and moves toward a success condition (e.g. books an appointment, accepts the offer). End with a confirmation outbound from the AI." : ""}
${scenarioType === "neutral" ? "Lead never responds. Show 3-4 outbound attempts that alternate channels with growing delays, then the AI backs off gracefully. NO inbound entries at all." : ""}
${scenarioType === "negative" ? "Lead replies once with a clear opt-out using language like 'stop contacting me', 'don't text me again', 'remove me from your list', or 'not interested'. That inbound reply is the FINAL entry in the timeline. NO outbound entries after it. Set handoff.triggered: true on that final inbound entry with reason: 'opted_out'." : ""}
${scenarioType === "handoff" ? "Lead's reply triggers one of the configured handoff triggers above (e.g. asks for a human, files a complaint, mentions a sensitive topic). That inbound reply is the FINAL entry. NO outbound entries after it. Set handoff.triggered: true on that final inbound entry with the matching reason." : ""}

DECISION RULES (follow strictly — these match the production sequencer):

${firstTouchRule}

1. CHANNEL STICKINESS (CRITICAL): If an inbound entry has channel "X", the very next outbound entry MUST also have channel "X". Do NOT switch channels while the lead is actively replying. This is non-negotiable — owners specifically asked for this.

2. CHANNEL ALTERNATION: Only alternate channels when the lead has gone SILENT after 1-2 outbound attempts on the current channel. Alternate to any other ENABLED channel that has not just been tried — the pairing is symmetric (voice ↔ sms, sms ↔ email, voice ↔ email), not a fixed ladder that starts at SMS. The one directional rule is voicemail: see rule 5.

3. OPT-OUT IS A HARD STOP: If any inbound entry contains opt-out language ("stop", "don't contact me", "remove me", "not interested", "leave me alone", "unsubscribe", or similar), that inbound entry MUST be the LAST entry in the timeline. Set its handoff field to { triggered: true, reason: "opted_out", notification: "<short internal owner notification>" }. Generate ZERO outbound entries after it.

4. HANDOFF ENDS THE SIMULATION: When a handoff fires (lead requests human, complaint, sensitive topic, opt-out, goal achieved, etc.), the inbound entry that triggered it is the LAST entry. NEVER generate outbound after a handoff.

5. VOICEMAIL HANDLING: If a voice outbound goes unanswered (no inbound follows), the next outbound should be SMS referencing the missed call.

6. POSITIVE PROGRESSION: When the lead engages positively, the AI escalates toward the success condition on the SAME channel they replied on, then ends with a confirmation outbound.

STEP BRIEF RULES (these become the LIVE campaign, read carefully):

Each outbound entry's step_brief is persisted as the real plan and applied to
EVERY lead — including the majority who never reply. It is authored once, from
this one simulated conversation, and then reused blind.

So a brief must describe what WE do at that step, never what the lead did:
- NEVER write an intent or cta that presupposes a reply, an agreement, an
  appointment, or a booking. "confirm appointment", "finalize booking",
  "follow up on our chat" are all invalid — they produce messages telling a
  silent lead they have an appointment they never made.
- Write briefs that stay true whether or not the lead has ever responded:
  "share one concrete reason it is worth a look", "offer the booking link",
  "final polite close".
- The message TEXT in this simulation may reflect this scenario's outcome; the
  step_brief may not.

CONTENT RULES:
- Use ONLY channels from the enabled list: ${enabledChannels.join(", ")}
- Messages should sound natural and match the "${tenant.brandVoice}" brand voice
- For voice entries, write what the agent would say (dialog style)
- Each outbound entry MUST have ai_reasoning explaining WHY this channel/timing/message was chosen (especially when applying channel stickiness or alternation)
- Each inbound entry SHOULD have ai_analysis describing what the AI inferred
- When the AI changes strategy, include an "adaptation" field explaining the change
- For handoff/opt-out scenarios, the notification field should include the lead's name, what happened, and a recommendation for the owner

TIMELINE LENGTH:
- Positive: 5-7 entries ending in confirmation
- Neutral: 3-4 outbound entries, no inbound, no handoff
- Negative: 2-4 entries, ending in the opt-out inbound with handoff
- Handoff: 3-5 entries, ending in the handoff-triggering inbound with handoff

Return ONLY valid JSON in this exact format:
{
  "scenario_name": "string describing the scenario",
  "scenario_type": "${scenarioType}",
  "fake_contact": { "name": "realistic first and last name", "source": "${contactSource}" },
  "timeline": [
    {
      "day": 1,
      "time": "10:02 AM",
      "channel": ${firstTouchExampleChannel},
      "direction": "outbound",
      "content": "the actual message text",
      "ai_reasoning": "why the AI chose this approach",
      "step_brief": { "intent": "warm intro", "cta": "get them to respond" }
    }
  ]
}`;

        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            messages: [{ role: "user", content: prompt }],
            response_format: { type: "json_object" },
            temperature: 0.3,
        });

        const raw = response.choices[0]?.message?.content;
        if (!raw) {
            return { success: false, error: "No response from AI" };
        }

        const scenario = JSON.parse(raw) as SimulationScenario;

        // Basic validation
        if (!scenario.timeline || !Array.isArray(scenario.timeline) || scenario.timeline.length === 0) {
            return { success: false, error: "Invalid simulation format" };
        }

        enforceProductionRules(scenario);

        return { success: true, scenario };
    } catch (err: any) {
        console.error("generateSimulation error:", err);
        return { success: false, error: err.message || "Failed to generate simulation" };
    }
}

// ─── Defensive Rule Enforcement ───
// Mirrors the production sequencer's hard rules so the demo never shows
// behavior that diverges from what users will see live.

const OPT_OUT_PATTERNS = [
    /\bstop\b/i,
    /\bdo\s*n[o']?t\s+(contact|text|call|message|email)\b/i,
    /\bremove\s+me\b/i,
    /\bnot\s+interested\b/i,
    /\bleave\s+me\s+alone\b/i,
    /\bunsubscribe\b/i,
    /\bopt[- ]?out\b/i,
];

function looksLikeOptOut(content: string): boolean {
    return OPT_OUT_PATTERNS.some((re) => re.test(content));
}

function enforceProductionRules(scenario: SimulationScenario): void {
    const timeline = scenario.timeline;

    // Rule 1: hard-stop on opt-out / handoff. Drop everything after the first
    // inbound entry that either has handoff.triggered === true or contains
    // opt-out language.
    let stopIdx = -1;
    for (let i = 0; i < timeline.length; i++) {
        const entry = timeline[i];
        if (entry.direction !== "inbound") continue;
        const hasHandoff = entry.handoff?.triggered === true;
        const hasOptOut = looksLikeOptOut(entry.content);
        if (hasHandoff || hasOptOut) {
            if (hasOptOut && !hasHandoff) {
                entry.handoff = {
                    triggered: true,
                    reason: "opted_out",
                    notification:
                        entry.handoff?.notification ||
                        `${scenario.fake_contact.name} opted out. Sequence stopped — do not contact again.`,
                };
            }
            stopIdx = i;
            break;
        }
    }
    if (stopIdx >= 0 && stopIdx < timeline.length - 1) {
        scenario.timeline = timeline.slice(0, stopIdx + 1);
    }

    // Rule 2: channel stickiness. Any outbound that immediately follows an
    // inbound on a different channel gets snapped to the inbound's channel.
    for (let i = 1; i < scenario.timeline.length; i++) {
        const prev = scenario.timeline[i - 1];
        const cur = scenario.timeline[i];
        if (
            prev.direction === "inbound" &&
            cur.direction === "outbound" &&
            prev.channel !== cur.channel
        ) {
            cur.channel = prev.channel;
        }
    }
}
