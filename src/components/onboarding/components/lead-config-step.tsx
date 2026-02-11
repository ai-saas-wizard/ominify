"use client";

import { cn } from "@/lib/utils";
import type { StepProps } from "../types";
import { LEAD_SOURCE_OPTIONS, GOAL_OPTIONS, formatLeadSourceLabel } from "../constants";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIFieldBadge } from "./ai-field-badge";

interface LeadConfigStepProps extends StepProps {
    toggleLeadSource: (source: string) => void;
}

export function LeadConfigStep({ form, fieldMeta, updateField, resetFieldToAI, toggleLeadSource }: LeadConfigStepProps) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Lead Configuration</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Configure where your leads come from and how they should be handled.
                </p>
            </div>

            <div className="space-y-5">
                {/* Lead Sources */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label>Lead Sources</Label>
                        <AIFieldBadge meta={fieldMeta.lead_sources} onReset={() => resetFieldToAI("lead_sources")} />
                    </div>
                    <p className="text-xs text-gray-400">
                        Select all the channels you receive leads from.
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        {LEAD_SOURCE_OPTIONS.map((source) => (
                            <button
                                key={source}
                                type="button"
                                onClick={() => toggleLeadSource(source)}
                                className={cn(
                                    "px-3 py-2 rounded-lg border text-sm font-medium transition-all",
                                    form.lead_sources.includes(source)
                                        ? "border-violet-500 bg-violet-50 text-violet-700"
                                        : "border-gray-200 text-gray-600 hover:border-gray-300 bg-white"
                                )}
                            >
                                {formatLeadSourceLabel(source)}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Primary Goal */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label>Primary Goal</Label>
                        <AIFieldBadge meta={fieldMeta.primary_goal} onReset={() => resetFieldToAI("primary_goal")} />
                    </div>
                    <Select value={form.primary_goal} onValueChange={(v) => updateField("primary_goal", v)}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select primary goal..." />
                        </SelectTrigger>
                        <SelectContent>
                            {GOAL_OPTIONS.map((goal) => (
                                <SelectItem key={goal.value} value={goal.value}>
                                    {goal.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Qualification Criteria */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="qualification_criteria">Qualification Criteria</Label>
                        <AIFieldBadge meta={fieldMeta.qualification_criteria} onReset={() => resetFieldToAI("qualification_criteria")} />
                    </div>
                    <Textarea
                        id="qualification_criteria"
                        value={form.qualification_criteria}
                        onChange={(e) => updateField("qualification_criteria", e.target.value)}
                        placeholder={`Enter as JSON, e.g.:\n{\n  "must_have": ["location_in_service_area", "budget_above_minimum"],\n  "nice_to_have": ["referral_source", "repeat_customer"],\n  "disqualifiers": ["outside_service_area", "commercial_only"]\n}`}
                        rows={5}
                        className="font-mono text-sm"
                    />
                    <p className="text-xs text-gray-400">
                        JSON format defining how leads should be qualified.
                    </p>
                </div>
            </div>
        </div>
    );
}
