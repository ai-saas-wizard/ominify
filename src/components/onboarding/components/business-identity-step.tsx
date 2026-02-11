"use client";

import type { StepProps } from "../types";
import { INDUSTRIES } from "../constants";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIFieldBadge } from "./ai-field-badge";

export function BusinessIdentityStep({ form, fieldMeta, updateField, resetFieldToAI }: StepProps) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Business Identity</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Tell us about your business so we can tailor your AI agents accordingly.
                </p>
            </div>

            <div className="space-y-5">
                {/* Industry */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="industry">Industry</Label>
                        <AIFieldBadge meta={fieldMeta.industry} onReset={() => resetFieldToAI("industry")} />
                    </div>
                    <Select value={form.industry} onValueChange={(v) => updateField("industry", v)}>
                        <SelectTrigger id="industry">
                            <SelectValue placeholder="Select an industry..." />
                        </SelectTrigger>
                        <SelectContent>
                            {INDUSTRIES.map((ind) => (
                                <SelectItem key={ind.value} value={ind.value}>
                                    {ind.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Sub-industry */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="sub_industry">Sub-industry / Specialization</Label>
                        <AIFieldBadge meta={fieldMeta.sub_industry} onReset={() => resetFieldToAI("sub_industry")} />
                    </div>
                    <Input
                        id="sub_industry"
                        value={form.sub_industry}
                        onChange={(e) => updateField("sub_industry", e.target.value)}
                        placeholder="e.g., HVAC, Plumbing, Roofing, Family Law..."
                    />
                </div>

                {/* Business Description */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="business_description">Business Description</Label>
                        <AIFieldBadge meta={fieldMeta.business_description} onReset={() => resetFieldToAI("business_description")} />
                    </div>
                    <Textarea
                        id="business_description"
                        value={form.business_description}
                        onChange={(e) => updateField("business_description", e.target.value)}
                        placeholder="Briefly describe what your business does, your key services, and what makes you unique..."
                        rows={4}
                    />
                </div>

                {/* Website */}
                <div className="space-y-1.5">
                    <Label htmlFor="website">Website</Label>
                    <Input
                        id="website"
                        type="url"
                        value={form.website}
                        onChange={(e) => updateField("website", e.target.value)}
                        placeholder="https://www.yourcompany.com"
                    />
                </div>
            </div>
        </div>
    );
}
