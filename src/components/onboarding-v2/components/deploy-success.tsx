"use client";

import { motion } from "framer-motion";
import { Check, Bot, Workflow, Phone, ArrowRight } from "lucide-react";

interface DeploySuccessProps {
    clientId: string;
    agentCount: number;
    sequenceCount: number;
}

export function DeploySuccess({ clientId, agentCount, sequenceCount }: DeploySuccessProps) {
    return (
        <div className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 px-4">
            <motion.div
                className="flex w-full max-w-lg flex-col items-center gap-8"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5 }}
            >
                {/* Success icon with ring animation */}
                <motion.div
                    className="relative"
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", delay: 0.2 }}
                >
                    <motion.div
                        className="absolute inset-0 rounded-full bg-emerald-500/20 blur-2xl"
                        animate={{ scale: [1, 1.2, 1], opacity: [0.5, 0.3, 0.5] }}
                        transition={{ duration: 3, repeat: Infinity }}
                    />
                    <div className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-500/10 ring-2 ring-emerald-500/30">
                        <Check className="h-10 w-10 text-emerald-400" />
                    </div>
                </motion.div>

                {/* Heading */}
                <div className="text-center">
                    <motion.h1
                        className="text-3xl font-bold text-white"
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: 0.3 }}
                    >
                        Your AI Call Center is Live
                    </motion.h1>
                    <motion.p
                        className="mt-2 text-zinc-400"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: 0.4 }}
                    >
                        {agentCount} agent{agentCount !== 1 ? "s" : ""} deployed
                        {sequenceCount > 0 && `, ${sequenceCount} sequence${sequenceCount !== 1 ? "s" : ""} configured`}
                    </motion.p>
                </div>

                {/* Quick action cards */}
                <motion.div
                    className="grid w-full gap-3 sm:grid-cols-3"
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.5 }}
                >
                    <QuickActionCard
                        href={`/client/${clientId}/agents`}
                        icon={Bot}
                        label="View Agents"
                        description={`${agentCount} active`}
                    />
                    <QuickActionCard
                        href={`/client/${clientId}/sequences`}
                        icon={Workflow}
                        label="View Sequences"
                        description={`${sequenceCount} configured`}
                    />
                    <QuickActionCard
                        href={`/client/${clientId}/phone-numbers`}
                        icon={Phone}
                        label="Phone Numbers"
                        description="Set up routing"
                    />
                </motion.div>

                {/* Primary CTA */}
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.6 }}
                >
                    <a
                        href={`/client/${clientId}`}
                        className="inline-flex items-center justify-center gap-2 rounded-lg bg-violet-600 px-8 py-2.5 text-sm font-medium text-white transition-colors hover:bg-violet-500"
                    >
                        Go to Dashboard
                        <ArrowRight className="h-4 w-4" />
                    </a>
                </motion.div>
            </motion.div>
        </div>
    );
}

function QuickActionCard({
    href,
    icon: Icon,
    label,
    description,
}: {
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    label: string;
    description: string;
}) {
    return (
        <a
            href={href}
            className="group rounded-xl border border-zinc-800 bg-zinc-900/50 p-4 text-center transition-colors hover:border-zinc-700 hover:bg-zinc-800/50"
        >
            <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-lg bg-zinc-800 transition-colors group-hover:bg-violet-500/10">
                <Icon className="h-5 w-5 text-zinc-400 transition-colors group-hover:text-violet-400" />
            </div>
            <p className="text-sm font-medium text-white">{label}</p>
            <p className="mt-0.5 text-xs text-zinc-500">{description}</p>
        </a>
    );
}
