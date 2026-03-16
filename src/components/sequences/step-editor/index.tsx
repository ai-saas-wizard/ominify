"use client";

import { useState, useCallback } from "react";
import { Loader2 } from "lucide-react";
import { AnimatePresence } from "framer-motion";
import { useRouter } from "next/navigation";
import { addSequenceStep, updateSequenceStep, updateStepMutationSettings } from "@/app/actions/sequence-actions";

// Sub-components
import ChannelSelector from "./channel-selector";
import DelayConfig from "./delay-config";
import SkipConditionsConfig from "./skip-conditions-config";
import SuccessFailureConfig from "./success-failure-config";
import MutationConfig from "./mutation-config";

// Content editors
import { SmsContentEditor } from "./content-editors/sms-content-editor";
import { EmailContentEditor } from "./content-editors/email-content-editor";
import { VoiceContentEditor } from "./content-editors/voice-content-editor";

// Types
import type { ExistingStep, ChannelType, SmsContent, EmailContent, VoiceContent, WaitContent, ConditionContent } from "./types";
import { serializeContent, deserializeContent } from "./types";

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
    const router = useRouter();

    const [loading, setLoading] = useState(false);
    const [channel, setChannel] = useState<ChannelType>((existingStep?.channel as ChannelType) || "sms");
    const [delayMinutes, setDelayMinutes] = useState(existingStep?.delay_minutes || 0);
    const [delayType, setDelayType] = useState(existingStep?.delay_type || "after_previous");

    // Content state per channel - deserialize existing content
    const [smsContent, setSmsContent] = useState<SmsContent>(
        existingStep?.channel === "sms" ? deserializeContent("sms", existingStep.content) as SmsContent : { body: "" }
    );
    const [emailContent, setEmailContent] = useState<EmailContent>(
        existingStep?.channel === "email" ? deserializeContent("email", existingStep.content) as EmailContent : { subject: "", body_html: "", body_text: "" }
    );
    const [voiceContent, setVoiceContent] = useState<VoiceContent>(
        existingStep?.channel === "voice" ? deserializeContent("voice", existingStep.content) as VoiceContent : { first_message: "", system_prompt: "" }
    );
    const [waitContent, setWaitContent] = useState<WaitContent>(
        existingStep?.channel === "wait" ? deserializeContent("wait", existingStep.content) as WaitContent : { reason: "" }
    );
    const [conditionContent, setConditionContent] = useState<ConditionContent>(
        existingStep?.channel === "condition" ? deserializeContent("condition", existingStep.content) as ConditionContent : { check: "replied", true_step: 1, false_step: 1 }
    );

    // Skip conditions
    const [skipConditions, setSkipConditions] = useState<string[]>(
        existingStep?.skip_conditions?.skip_if || []
    );

    // Success/failure
    const [onSuccess, setOnSuccess] = useState<{ action: string; target_step?: number }>(
        existingStep?.on_success || { action: "continue" }
    );
    const [onFailure, setOnFailure] = useState<{ action: string; retry_delay?: number }>(
        existingStep?.on_failure || { action: "skip" }
    );

    // AI Mutation
    const [aiMutationEnabled, setAiMutationEnabled] = useState(existingStep?.enable_ai_mutation || false);
    const [mutationInstructions, setMutationInstructions] = useState(existingStep?.mutation_instructions || "");

    const getCurrentContent = useCallback(() => {
        switch (channel) {
            case "sms": return smsContent;
            case "email": return emailContent;
            case "voice": return voiceContent;
            case "wait": return waitContent;
            case "condition": return conditionContent;
        }
    }, [channel, smsContent, emailContent, voiceContent, waitContent, conditionContent]);

    const handleSubmit = async () => {
        setLoading(true);

        const formData = new FormData();
        formData.set("channel", channel);
        formData.set("delay_minutes", String(delayMinutes));
        formData.set("delay_type", delayType);
        formData.set("content_template", serializeContent(channel, getCurrentContent()));
        formData.set("skip_conditions", JSON.stringify({ skip_if: skipConditions }));
        formData.set("on_success", JSON.stringify(onSuccess));
        formData.set("on_failure", JSON.stringify(onFailure));
        formData.set("enable_ai_mutation", aiMutationEnabled ? "true" : "false");
        formData.set("mutation_instructions", mutationInstructions);

        let res;
        if (existingStep) {
            res = await updateSequenceStep(existingStep.id, formData);
        } else {
            res = await addSequenceStep(sequenceId, formData);
        }

        // Handle mutation settings separately for existing steps
        if (res.success && existingStep) {
            if (aiMutationEnabled !== existingStep.enable_ai_mutation ||
                mutationInstructions !== (existingStep.mutation_instructions || "")) {
                await updateStepMutationSettings(existingStep.id, {
                    enable_ai_mutation: aiMutationEnabled,
                    mutation_instructions: mutationInstructions || null,
                });
            }
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
        <div className="space-y-5">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="font-semibold text-lg text-gray-900">
                        {existingStep ? "Edit Step" : "Add Step"}
                    </h3>
                    {existingStep && (
                        <p className="text-sm text-gray-500">Step #{existingStep.step_order}</p>
                    )}
                </div>
            </div>

            {/* Channel Selector */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Channel</label>
                <ChannelSelector value={channel} onChange={(ch) => setChannel(ch as ChannelType)} />
            </div>

            {/* Delay Config */}
            <DelayConfig
                delayMinutes={delayMinutes}
                delayType={delayType}
                onDelayMinutesChange={setDelayMinutes}
                onDelayTypeChange={setDelayType}
            />

            {/* Content Editor - switches based on channel */}
            <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Content</label>
                <AnimatePresence mode="wait">
                    {channel === "sms" && (
                        <SmsContentEditor key="sms" content={smsContent} onChange={setSmsContent} />
                    )}
                    {channel === "email" && (
                        <EmailContentEditor key="email" content={emailContent} onChange={setEmailContent} />
                    )}
                    {channel === "voice" && (
                        <VoiceContentEditor key="voice" content={voiceContent} onChange={setVoiceContent} />
                    )}
                    {channel === "wait" && (
                        <div key="wait" className="space-y-2">
                            <label className="text-xs text-gray-500">Reason for wait</label>
                            <textarea
                                rows={2}
                                value={waitContent.reason}
                                onChange={(e) => setWaitContent({ reason: e.target.value })}
                                placeholder="e.g., Wait for business hours"
                                className="w-full p-3 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500 text-sm resize-none"
                            />
                        </div>
                    )}
                    {channel === "condition" && (
                        <div key="condition" className="space-y-3">
                            <div className="space-y-2">
                                <label className="text-xs text-gray-500">Check Type</label>
                                <select
                                    value={conditionContent.check}
                                    onChange={(e) => setConditionContent({ ...conditionContent, check: e.target.value })}
                                    className="w-full p-2 border rounded-lg bg-white outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                                >
                                    <option value="replied">Contact Replied</option>
                                    <option value="answered_call">Answered Call</option>
                                    <option value="booked">Appointment Booked</option>
                                    <option value="opened_email">Opened Email</option>
                                    <option value="clicked_link">Clicked Link</option>
                                </select>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="space-y-2">
                                    <label className="text-xs text-gray-500">If True → Go to Step</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={conditionContent.true_step}
                                        onChange={(e) => setConditionContent({ ...conditionContent, true_step: parseInt(e.target.value) || 1 })}
                                        className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                                    />
                                </div>
                                <div className="space-y-2">
                                    <label className="text-xs text-gray-500">If False → Go to Step</label>
                                    <input
                                        type="number"
                                        min={1}
                                        value={conditionContent.false_step}
                                        onChange={(e) => setConditionContent({ ...conditionContent, false_step: parseInt(e.target.value) || 1 })}
                                        className="w-full p-2 border rounded-lg outline-none focus:ring-2 focus:ring-violet-500 text-sm"
                                    />
                                </div>
                            </div>
                        </div>
                    )}
                </AnimatePresence>
            </div>

            {/* Skip Conditions */}
            <SkipConditionsConfig selected={skipConditions} onChange={setSkipConditions} />

            {/* AI Mutation */}
            <MutationConfig
                channel={channel}
                enabled={aiMutationEnabled}
                instructions={mutationInstructions}
                onEnabledChange={setAiMutationEnabled}
                onInstructionsChange={setMutationInstructions}
            />

            {/* Success / Failure */}
            <SuccessFailureConfig
                onSuccess={onSuccess}
                onFailure={onFailure}
                onSuccessChange={setOnSuccess}
                onFailureChange={setOnFailure}
            />

            {/* Actions */}
            <div className="flex justify-end gap-2 pt-4 border-t">
                <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    Cancel
                </button>
                <button
                    onClick={handleSubmit}
                    disabled={loading}
                    className="px-4 py-2 text-sm font-medium text-white rounded-lg bg-violet-600 hover:bg-violet-700 disabled:opacity-50 flex items-center transition-colors"
                >
                    {loading && <Loader2 className="w-3 h-3 animate-spin mr-2" />}
                    {existingStep ? "Update Step" : "Add Step"}
                </button>
            </div>
        </div>
    );
}
