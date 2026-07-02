"use client";

import { useState, useEffect } from "react";
import { Plus, Loader2, Zap } from "lucide-react";
import { createSequence, listOutboundAgents } from "@/app/actions/sequence-actions";
import { useRouter } from "next/navigation";

const TRIGGER_OPTIONS = [
    { value: "new_lead", label: "New Lead" },
    { value: "missed_call", label: "Missed Call" },
    { value: "form_submission", label: "Form Submission" },
    { value: "manual", label: "Manual" },
    { value: "tag_added", label: "Tag Added" },
    { value: "status_change", label: "Status Change" },
    { value: "schedule", label: "Schedule" },
];

const URGENCY_OPTIONS = [
    { value: "critical", label: "Critical" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
];

export function CreateSequenceDialog({
    clientId,
    variant,
    open,
    onOpenChange,
    hideTrigger,
}: {
    clientId: string;
    variant?: "default" | "secondary" | "link";
    /** Controlled-open mode (used by the Advanced menu); falls back to internal state. */
    open?: boolean;
    onOpenChange?: (open: boolean) => void;
    hideTrigger?: boolean;
}) {
    const [internalOpen, setInternalOpen] = useState(false);
    const isOpen = open ?? internalOpen;
    const setIsOpen = onOpenChange ?? setInternalOpen;
    const [loading, setLoading] = useState(false);
    const [agents, setAgents] = useState<{ id: string; name: string }[]>([]);
    const router = useRouter();

    // Load the client's outbound agents when the dialog opens so the user can
    // bind one — it drives the voice assistant for calls and the SMS persona
    // for texts.
    useEffect(() => {
        if (!isOpen) return;
        let active = true;
        listOutboundAgents(clientId).then((list) => {
            if (active) setAgents(list);
        });
        return () => {
            active = false;
        };
    }, [isOpen, clientId]);

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);

        const res = await createSequence(clientId, formData);
        setLoading(false);

        if (res.success) {
            setIsOpen(false);
            router.refresh();
            if (res.sequenceId) {
                router.push(`/client/${clientId}/sequences/${res.sequenceId}`);
            }
        } else {
            alert(res.error || "Failed to create sequence");
        }
    };

    if (!isOpen) {
        if (hideTrigger) return null;

        if (variant === "link") {
            return (
                <button
                    onClick={() => setIsOpen(true)}
                    className="text-sm text-gray-500 hover:text-emerald-600 transition-colors underline underline-offset-2"
                >
                    or create manually
                </button>
            );
        }

        if (variant === "secondary") {
            return (
                <button
                    onClick={() => setIsOpen(true)}
                    className="border border-gray-300 hover:border-emerald-300 hover:text-emerald-700 text-gray-700 px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium"
                >
                    <Plus className="w-4 h-4" />
                    Create Manually
                </button>
            );
        }

        return (
            <button
                onClick={() => setIsOpen(true)}
                className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg flex items-center gap-2 transition-colors text-sm font-medium"
            >
                <Plus className="w-4 h-4" />
                Create Sequence
            </button>
        );
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                <div className="px-6 py-4 border-b">
                    <div className="flex items-center gap-2">
                        <Zap className="w-5 h-5 text-emerald-600" />
                        <h3 className="font-semibold text-lg">Create Manual Sequence (Advanced)</h3>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">
                        Fixed steps you author yourself — the AI won&apos;t decide
                        channels, content, or timing. For AI-driven outreach, use
                        the sequence wizard instead.
                    </p>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    {/* Name */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            Name <span className="text-red-500">*</span>
                        </label>
                        <input
                            name="name"
                            required
                            placeholder="e.g., Missed Call Follow-up"
                            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                    </div>

                    {/* Description */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            Description
                        </label>
                        <textarea
                            name="description"
                            rows={3}
                            placeholder="Describe what this sequence does..."
                            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                        />
                    </div>

                    {/* Outbound Agent */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            Outbound Agent
                        </label>
                        <select
                            name="agent_id"
                            defaultValue=""
                            className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                            <option value="">No agent (generic)</option>
                            {agents.map((a) => (
                                <option key={a.id} value={a.id}>
                                    {a.name}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500">
                            The agent drives the voice prompt for calls and the SMS
                            persona for texts. Binding one also turns on call-aware
                            SMS auto-replies.
                        </p>
                    </div>

                    {/* Trigger Type */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            Trigger Type
                        </label>
                        <select
                            name="trigger_type"
                            defaultValue="manual"
                            className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                            {TRIGGER_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Urgency Tier */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            Urgency Tier
                        </label>
                        <select
                            name="urgency_tier"
                            defaultValue="medium"
                            className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                            {URGENCY_OPTIONS.map((opt) => (
                                <option key={opt.value} value={opt.value}>
                                    {opt.label}
                                </option>
                            ))}
                        </select>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-4">
                        <button
                            type="button"
                            onClick={() => setIsOpen(false)}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 flex items-center"
                        >
                            {loading && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
                            Create Sequence
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
