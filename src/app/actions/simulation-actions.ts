"use server";

import OpenAI from "openai";
import { supabase } from "@/lib/supabase";

// ─── Types ───

interface SimulationInput {
    clientId: string;
    goal: string;
    customGoalDescription?: string;
    channels: { sms: boolean; email: boolean; voice: boolean };
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
    custom: "Custom goal",
};

const TRIGGER_SOURCE_MAP: Record<string, string> = {
    missed_call_followup: "Missed call",
    dormant_reengagement: "CRM — dormant 30+ days",
    new_lead_nurture: "Website form submission",
    post_appointment: "Appointment completed",
    win_back_quotes: "Quote sent — no response",
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

        const prompt = `You are generating a realistic simulation of an AI-powered lead follow-up sequence for a business owner to preview.

BUSINESS CONTEXT:
- Business: ${tenant.businessName}
- Industry: ${tenant.industry}
- Brand voice: ${tenant.brandVoice}
- AI Agent name: ${tenant.agentName}
- Services: ${JSON.stringify(tenant.services.slice(0, 5))}

SEQUENCE CONFIG:
- Goal: ${goalLabel}
- Channels: ${enabledChannels.join(", ")}
- Cadence: ${input.cadence} touchpoints/week
- Duration: ${input.duration} weeks
- Total touchpoints: ~${totalTouchpoints}

HANDOFF RULES:
Success conditions:
${successConditionsList || "- None specified"}

Handoff triggers (AI must step aside):
${handoffTriggersList || "- None specified"}

SCENARIO TYPE: ${scenarioType}
${scenarioType === "positive" ? "Lead engages positively and moves toward a success condition." : ""}
${scenarioType === "neutral" ? "Lead never responds. AI backs off gracefully after several attempts." : ""}
${scenarioType === "negative" ? "Lead is hostile or opts out. AI handles it professionally." : ""}
${scenarioType === "handoff" ? "Lead triggers one of the handoff rules. AI steps aside and notifies the owner." : ""}

Generate a JSON simulation with 5-8 timeline entries. The simulation should feel realistic and demonstrate:
1. How the AI adapts its messaging based on what happens
2. The AI's reasoning at each step (shown to the owner as "AI thinking" bubbles)
3. Natural, brand-appropriate messaging
4. ${scenarioType === "handoff" ? "At least one handoff trigger firing with a detailed owner notification" : "Appropriate handling of the " + scenarioType + " scenario"}

IMPORTANT RULES:
- Use ONLY channels from the enabled list: ${enabledChannels.join(", ")}
- Messages should sound natural and match the "${tenant.brandVoice}" brand voice
- Include a mix of outbound (AI sends) and inbound (lead responds) entries where appropriate
- For voice entries, write what the agent would say (dialog style)
- Each outbound entry MUST have ai_reasoning
- Each inbound entry SHOULD have ai_analysis
- When the AI adapts its strategy, include an "adaptation" field explaining the change
- For handoff scenarios, include a handoff object with triggered: true, reason, and a notification message that includes the lead's name, context, and a recommendation

Return ONLY valid JSON in this exact format:
{
  "scenario_name": "string describing the scenario",
  "scenario_type": "${scenarioType}",
  "fake_contact": { "name": "realistic first and last name", "source": "${contactSource}" },
  "timeline": [
    {
      "day": 1,
      "time": "10:02 AM",
      "channel": "sms",
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
            temperature: 0.8,
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

        return { success: true, scenario };
    } catch (err: any) {
        console.error("generateSimulation error:", err);
        return { success: false, error: err.message || "Failed to generate simulation" };
    }
}
