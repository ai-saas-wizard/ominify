// ─── GOAL CARDS ───

export type GoalId =
    | "missed_call_followup"
    | "dormant_reengagement"
    | "new_lead_nurture"
    | "post_appointment"
    | "win_back_quotes"
    | "custom";

export interface GoalCard {
    id: GoalId;
    title: string;
    description: string;
    icon: string;
    defaults: {
        trigger_type: string;
        urgency_tier: string;
        cadence: number;
        duration: number;
        success_conditions: string[];
    };
}

// ─── WIZARD STATE ───

export interface WizardChannels {
    sms: boolean;
    email: boolean;
    voice: boolean;
}

export interface ChannelConfig {
    channels: WizardChannels;
    cadence: number;
    duration: number;
}

// ─── HANDOFF RULES ───

export interface HandoffTrigger {
    type: "preset" | "custom";
    id?: string;
    label: string;
    description?: string;
}

export interface HandoffRulesConfig {
    success_conditions: string[];
    handoff_triggers: HandoffTrigger[];
    no_response: {
        max_touchpoints: number;
        after_sequence: "mark_cold" | "reengage_weeks" | "notify_personal";
        reengage_weeks?: number;
    };
    notification: {
        sms: string;
        email: string;
        push: boolean;
        urgent_call: boolean;
    };
}

// ─── SIMULATION ───

export interface SimulationEntry {
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

export interface SimulationScenario {
    scenario_name: string;
    scenario_type: "positive" | "neutral" | "negative" | "opt_out" | "handoff";
    fake_contact: { name: string; source: string };
    timeline: SimulationEntry[];
}

// ─── FULL WIZARD STATE ───

export interface WizardState {
    goal: GoalId | null;
    customGoalDescription: string;
    channelConfig: ChannelConfig;
    handoffRules: HandoffRulesConfig;
}

// ─── WIZARD STEP ───

export interface WizardStep {
    label: string;
    description: string;
}
