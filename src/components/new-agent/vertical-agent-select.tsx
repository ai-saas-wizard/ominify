"use client";

import { motion } from "framer-motion";
import {
    ArrowLeft,
    ArrowRight,
    Phone,
    PhoneIncoming,
    PhoneOutgoing,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getVertical } from "@/lib/verticals/registry";
import type { VerticalAgentDef } from "@/lib/verticals/types";

interface VerticalAgentSelectProps {
    verticalId: string;
    onSelectInbound: (agentDef: VerticalAgentDef) => void;
    onSelectOutbound: () => void;
    onBack: () => void;
}

const ICON_MAP: Record<
    string,
    React.ComponentType<{ className?: string }>
> = {
    Phone,
    PhoneIncoming,
    PhoneOutgoing,
};

export function VerticalAgentSelect({
    verticalId,
    onSelectInbound,
    onSelectOutbound,
    onBack,
}: VerticalAgentSelectProps) {
    const vertical = getVertical(verticalId);
    if (!vertical) return null;

    const inboundAgents = vertical.agents.filter(
        (a) => a.direction === "inbound"
    );
    const hasOutbound = vertical.agents.some(
        (a) => a.direction === "outbound"
    );

    // Outbound card copy is vertical-aware (RE wording preserved exactly).
    const outboundDescription =
        verticalId === "saas_companies"
            ? "Call marketing-sourced leads, qualify fit, and book product demos via Google Calendar."
            : "Place outbound calls to re-engage sellers, follow up on missed appointments, or run cold outreach. Pick a goal next.";

    return (
        <div className="flex min-h-screen items-center justify-center p-6">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
                className="w-full max-w-3xl"
            >
                <button
                    onClick={onBack}
                    className="mb-4 flex items-center gap-1.5 text-sm text-gray-400 transition-colors hover:text-gray-700"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Back
                </button>

                <div className="mb-8">
                    <h1 className="text-2xl font-bold text-gray-900">
                        Which {vertical.name} agent do you want to add?
                    </h1>
                    <p className="mt-2 text-sm text-gray-500">
                        Choose a direction. You can always add another later.
                    </p>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                    {inboundAgents.map((agent, index) => (
                        <AgentCard
                            key={agent.id}
                            title={agent.name}
                            description={agent.description}
                            icon={agent.icon}
                            badge="Inbound"
                            badgeColor="bg-emerald-50 text-emerald-600 ring-emerald-200"
                            onClick={() => onSelectInbound(agent)}
                            delay={0.1 + index * 0.05}
                        />
                    ))}

                    {hasOutbound && (
                        <AgentCard
                            title="Outbound Agent"
                            description={outboundDescription}
                            icon="PhoneOutgoing"
                            badge="Outbound"
                            badgeColor="bg-amber-50 text-amber-600 ring-amber-200"
                            onClick={onSelectOutbound}
                            delay={0.1 + inboundAgents.length * 0.05}
                        />
                    )}
                </div>
            </motion.div>
        </div>
    );
}

function AgentCard({
    title,
    description,
    icon,
    badge,
    badgeColor,
    onClick,
    delay = 0,
}: {
    title: string;
    description: string;
    icon: string;
    badge: string;
    badgeColor: string;
    onClick: () => void;
    delay?: number;
}) {
    const Icon = ICON_MAP[icon] || Phone;

    return (
        <motion.button
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay }}
            onClick={onClick}
            className={cn(
                "group relative flex flex-col items-start rounded-2xl border border-gray-200 bg-white p-6 text-left shadow-sm",
                "transition-all duration-200 hover:border-emerald-300 hover:shadow-md"
            )}
        >
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50">
                <Icon className="h-6 w-6 text-emerald-600" />
            </div>

            <div className="mt-4 flex items-center gap-2">
                <h3 className="text-base font-semibold text-gray-900">
                    {title}
                </h3>
                <span
                    className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-medium ring-1",
                        badgeColor
                    )}
                >
                    {badge}
                </span>
            </div>

            <p className="mt-2 text-sm leading-relaxed text-gray-500">
                {description}
            </p>

            <div className="mt-4 flex items-center gap-1.5 text-sm font-medium text-emerald-600 transition-colors group-hover:text-emerald-700">
                Continue
                <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </div>
        </motion.button>
    );
}
