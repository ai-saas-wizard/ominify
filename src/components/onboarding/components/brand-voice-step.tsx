"use client";

import { cn } from "@/lib/utils";
import type { StepProps } from "../types";
import { BRAND_VOICES } from "../constants";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { AIFieldBadge } from "./ai-field-badge";

export function BrandVoiceStep({ form, fieldMeta, updateField, resetFieldToAI }: StepProps) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Brand Voice</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Define how your AI agents should communicate with customers.
                </p>
            </div>

            <div className="space-y-5">
                {/* Voice Style */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label>Voice Style</Label>
                        <AIFieldBadge meta={fieldMeta.brand_voice} onReset={() => resetFieldToAI("brand_voice")} />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                        {BRAND_VOICES.map((voice) => (
                            <button
                                key={voice.value}
                                type="button"
                                onClick={() => updateField("brand_voice", voice.value)}
                                className={cn(
                                    "p-4 rounded-lg border-2 text-left transition-all",
                                    form.brand_voice === voice.value
                                        ? "border-violet-500 bg-violet-50"
                                        : "border-gray-200 hover:border-gray-300 bg-white"
                                )}
                            >
                                <div className="font-medium text-gray-900">{voice.label}</div>
                                <div className="text-xs text-gray-500 mt-0.5">{voice.desc}</div>
                            </button>
                        ))}
                    </div>
                </div>

                {/* Custom Phrases */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="custom_phrases">Custom Phrases / Brand Guidelines</Label>
                        <AIFieldBadge meta={fieldMeta.custom_phrases} onReset={() => resetFieldToAI("custom_phrases")} />
                    </div>
                    <Textarea
                        id="custom_phrases"
                        value={form.custom_phrases}
                        onChange={(e) => updateField("custom_phrases", e.target.value)}
                        placeholder={`Enter as JSON, e.g.:\n{\n  "always_mention": ["family-owned since 1985", "licensed & insured"],\n  "never_say": ["cheap", "discount"]\n}`}
                        rows={5}
                        className="font-mono text-sm"
                    />
                    <p className="text-xs text-gray-400">
                        JSON format with &quot;always_mention&quot; and &quot;never_say&quot; arrays.
                    </p>
                </div>

                {/* Greeting Style */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="greeting_style">Greeting Style</Label>
                        <AIFieldBadge meta={fieldMeta.greeting_style} onReset={() => resetFieldToAI("greeting_style")} />
                    </div>
                    <Textarea
                        id="greeting_style"
                        value={form.greeting_style}
                        onChange={(e) => updateField("greeting_style", e.target.value)}
                        placeholder='e.g., "Thanks for calling [Business Name], this is [Agent]. How can I help you today?"'
                        rows={3}
                    />
                </div>
            </div>
        </div>
    );
}
