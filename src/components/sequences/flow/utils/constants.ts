import {
    MessageSquare,
    Mail,
    Phone,
    Clock,
    GitBranch,
    Zap,
    PhoneIncoming,
    FileText,
    Tag,
    RefreshCw,
    Calendar,
    type LucideIcon,
} from "lucide-react";

// Layout constants
export const FLOW_NODE_WIDTH = 280;
export const FLOW_NODE_HEIGHT = 80;
export const FLOW_VERTICAL_SPACING = 160;
export const FLOW_CENTER_X = 500;
export const FLOW_BRANCH_OFFSET = 200;

// Channel visual config for flow nodes
export interface ChannelFlowConfig {
    icon: LucideIcon;
    bgColor: string;
    textColor: string;
    accentColor: string;
    label: string;
}

export const CHANNEL_FLOW_CONFIG: Record<string, ChannelFlowConfig> = {
    sms: {
        icon: MessageSquare,
        bgColor: "bg-green-50",
        textColor: "text-green-700",
        accentColor: "bg-green-500",
        label: "SMS",
    },
    email: {
        icon: Mail,
        bgColor: "bg-blue-50",
        textColor: "text-blue-700",
        accentColor: "bg-blue-500",
        label: "Email",
    },
    voice_call: {
        icon: Phone,
        bgColor: "bg-emerald-50",
        textColor: "text-emerald-700",
        accentColor: "bg-emerald-500",
        label: "Voice Call",
    },
    voice: {
        icon: Phone,
        bgColor: "bg-emerald-50",
        textColor: "text-emerald-700",
        accentColor: "bg-emerald-500",
        label: "Voice Call",
    },
    wait: {
        icon: Clock,
        bgColor: "bg-amber-50",
        textColor: "text-amber-700",
        accentColor: "bg-amber-500",
        label: "Wait / Delay",
    },
    condition: {
        icon: GitBranch,
        bgColor: "bg-pink-50",
        textColor: "text-pink-700",
        accentColor: "bg-pink-500",
        label: "Condition",
    },
};

// Trigger type config
export const TRIGGER_FLOW_CONFIG: Record<string, { icon: LucideIcon; label: string }> = {
    new_lead: { icon: Zap, label: "New Lead" },
    missed_call: { icon: PhoneIncoming, label: "Missed Call" },
    form_submission: { icon: FileText, label: "Form Submission" },
    manual: { icon: Zap, label: "Manual Trigger" },
    tag_added: { icon: Tag, label: "Tag Added" },
    status_change: { icon: RefreshCw, label: "Status Change" },
    schedule: { icon: Calendar, label: "Schedule" },
};

// Delay type labels
export const DELAY_LABELS: Record<string, string> = {
    after_previous: "After previous step",
    after_enrollment: "After enrollment",
    specific_time: "At specific time",
    immediate: "Immediately",
};
