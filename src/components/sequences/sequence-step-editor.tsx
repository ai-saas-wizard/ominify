"use client";

import { useState } from "react";
import { Loader2, MessageSquare, Mail, Phone, Clock, GitBranch } from "lucide-react";
import { addSequenceStep, updateSequenceStep } from "@/app/actions/sequence-actions";
import { useRouter } from "next/navigation";

const CHANNEL_OPTIONS = [
    { value: "sms", label: "SMS", icon: MessageSquare },
    { value: "email", label: "Email", icon: Mail },
    { value: "voice", label: "Voice Call", icon: Phone },
    { value: "wait", label: "Wait / Delay", icon: Clock },
    { value: "condition", label: "Condition / Branch", icon: GitBranch },
];

const DELAY_TYPE_OPTIONS = [
    { value: "immediate", label: "Immediate" },
    { value: "fixed_delay", label: "Fixed Delay" },
    { value: "business_hours_only", label: "Business Hours Only" },
];

const ON_SUCCESS_OPTIONS = [
    { value: "continue", label: "Continue to Next Step" },
    { value: "jump_to_step", label: "Jump to Step" },
    { value: "end_sequence", label: "End Sequence" },
];

const ON_FAILURE_OPTIONS = [
    { value: "skip", label: "Skip and Continue" },
    { value: "end_sequence", label: "End Sequence" },
    { value: "retry_after_seconds", label: "Retry After Delay" },
];

interface ExistingStep {
    id: string;
    step_order: number;
    channel: string;
    delay_minutes: number;
    delay_type: string;
    content_template: any;
    skip_conditions: any;
    on_success: any;
    on_failure: any;
}

export function SequenceStepEditor({
    sequenceId,
    existingStep,
    onClose,
    onSaved,
}: {
    sequenceId: string;
    existingStep?: ExistingStep | null;
    onClose: () => void;
    onSaved: () => void;
}) {
    const [loading, setLoading] = useState(false);
    const [channel, setChannel] = useState(existingStep?.channel || "sms");
    const router = useRouter();

    const isEditing = !!existingStep;

    const getDefaultTemplate = (ch: string, template: any) => {
        if (!template) return "";
        return JSON.stringify(template, null, 2);
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setLoading(true);
        const formData = new FormData(e.currentTarget);

        let res;
        if (isEditing && existingStep) {
            res = await updateSequenceStep(existingStep.id, formData);
        } else {
            res = await addSequenceStep(sequenceId, formData);
        }

        setLoading(false);

        if (res.success) {
            onSaved();
            onClose();
            router.refresh();
        } else {
            alert(res.error || "Failed to save step");
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
                <div className="px-6 py-4 border-b flex-shrink-0">
                    <h3 className="font-semibold text-lg">
                        {isEditing ? "Edit Step" : "Add Step"}
                    </h3>
                    {isEditing && (
                        <p className="text-sm text-gray-500">
                            Step #{existingStep.step_order}
                        </p>
                    )}
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
                    {/* Channel */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">Channel</label>
                        <div className="grid grid-cols-5 gap-2">
                            {CHANNEL_OPTIONS.map((opt) => {
                                const Icon = opt.icon;
                                const isSelected = channel === opt.value;
                                return (
                                    <button
                                        key={opt.value}
                                        type="button"
                                        onClick={() => setChannel(opt.value)}
                                        className={`flex flex-col items-center gap-1 p-2.5 rounded-lg border text-xs font-medium transition-colors ${
                                            isSelected
                                                ? "border-violet-500 bg-violet-50 text-violet-700"
                                                : "border-gray-200 text-gray-500 hover:bg-gray-50"
                                        }`}
                                    >
                                        <Icon className="w-4 h-4" />
                                        {opt.label}
                                    </button>
                                );
                            })}
                        </div>
                        <input type="hidden" name="channel" value={channel} />
                    </div>

                    {/* Delay Minutes */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Delay (minutes)
                            </label>
                            <input
                                name="delay_minutes"
                                type="number"
                                min="0"
                                defaultValue={existingStep?.delay_minutes || 0}
                                className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500"
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                Delay Type
                            </label>
                            <select
                                name="delay_type"
                                defaultValue={existingStep?.delay_type || "fixed_delay"}
                                className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-500"
                            >
                                {DELAY_TYPE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Content Template */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            Content Template{" "}
                            <span className="text-gray-400 font-normal">(JSON)</span>
                        </label>
                        <p className="text-xs text-gray-400">
                            {channel === "sms" && 'e.g., {"body": "Hi {{name}}, we missed your call..."}'}
                            {channel === "email" && 'e.g., {"subject": "Following up", "body": "Hi {{name}}..."}'}
                            {channel === "voice" && 'e.g., {"system_prompt": "You are calling {{name}} to follow up..."}'}
                            {channel === "wait" && 'e.g., {"reason": "Wait for business hours"}'}
                            {channel === "condition" && 'e.g., {"check": "replied", "true_step": 5, "false_step": 3}'}
                        </p>
                        <textarea
                            name="content_template"
                            rows={4}
                            defaultValue={getDefaultTemplate(channel, existingStep?.content_template)}
                            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500 font-mono text-sm resize-none"
                        />
                    </div>

                    {/* Skip Conditions */}
                    <div className="space-y-2">
                        <label className="text-sm font-medium text-gray-700">
                            Skip Conditions{" "}
                            <span className="text-gray-400 font-normal">(JSON, optional)</span>
                        </label>
                        <textarea
                            name="skip_conditions"
                            rows={2}
                            defaultValue={
                                existingStep?.skip_conditions
                                    ? JSON.stringify(existingStep.skip_conditions, null, 2)
                                    : ""
                            }
                            placeholder='e.g., {"if_replied": true, "if_booked": true}'
                            className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500 font-mono text-sm resize-none"
                        />
                    </div>

                    {/* On Success / On Failure */}
                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                On Success
                            </label>
                            <select
                                name="on_success"
                                defaultValue={
                                    existingStep?.on_success?.action || "continue"
                                }
                                className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                            >
                                {ON_SUCCESS_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-gray-700">
                                On Failure
                            </label>
                            <select
                                name="on_failure"
                                defaultValue={
                                    existingStep?.on_failure?.action || "skip"
                                }
                                className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                            >
                                {ON_FAILURE_OPTIONS.map((opt) => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="flex justify-end gap-2 pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 flex items-center"
                        >
                            {loading && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
                            {isEditing ? "Update Step" : "Add Step"}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
