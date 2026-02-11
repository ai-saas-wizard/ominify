"use client";

import { cn } from "@/lib/utils";
import type { StepProps } from "../types";
import { TIMEZONES, DAYS_OF_WEEK } from "../constants";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AIFieldBadge } from "./ai-field-badge";

interface BusinessHoursStepProps extends StepProps {
    updateHours: (day: string, field: "open" | "close" | "closed", value: string | boolean) => void;
}

export function BusinessHoursStep({ form, fieldMeta, updateField, resetFieldToAI, updateHours }: BusinessHoursStepProps) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">Business Hours</h2>
                <p className="mt-1 text-sm text-gray-500">
                    Set your operating hours so AI agents know when to schedule and when to take messages.
                </p>
            </div>

            <div className="space-y-5">
                {/* Timezone */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label>Timezone</Label>
                        <AIFieldBadge meta={fieldMeta.timezone} onReset={() => resetFieldToAI("timezone")} />
                    </div>
                    <Select value={form.timezone} onValueChange={(v) => updateField("timezone", v)}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select timezone..." />
                        </SelectTrigger>
                        <SelectContent>
                            {TIMEZONES.map((tz) => (
                                <SelectItem key={tz.value} value={tz.value}>
                                    {tz.label}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>

                {/* Weekly Hours */}
                <div className="space-y-2">
                    <div className="flex items-center justify-between">
                        <Label>Weekly Schedule</Label>
                        <AIFieldBadge meta={fieldMeta.business_hours} onReset={() => resetFieldToAI("business_hours")} />
                    </div>
                    <div className="space-y-2">
                        {DAYS_OF_WEEK.map(({ key, label }) => {
                            const dayHours = form.business_hours[key];
                            return (
                                <div
                                    key={key}
                                    className={cn(
                                        "flex items-center gap-3 p-3 rounded-lg border",
                                        dayHours?.closed
                                            ? "bg-gray-50 border-gray-200"
                                            : "bg-white border-gray-200"
                                    )}
                                >
                                    <div className="w-24 flex-shrink-0">
                                        <span className="text-sm font-medium text-gray-700">{label}</span>
                                    </div>

                                    <label className="flex items-center gap-2 cursor-pointer flex-shrink-0">
                                        <input
                                            type="checkbox"
                                            checked={!dayHours?.closed}
                                            onChange={(e) => updateHours(key, "closed", !e.target.checked)}
                                            className="w-4 h-4 rounded border-gray-300 text-violet-600 focus:ring-violet-500"
                                        />
                                        <span className="text-xs text-gray-500">Open</span>
                                    </label>

                                    {!dayHours?.closed && (
                                        <div className="flex items-center gap-2 ml-2">
                                            <input
                                                type="time"
                                                value={dayHours?.open || "08:00"}
                                                onChange={(e) => updateHours(key, "open", e.target.value)}
                                                className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none"
                                            />
                                            <span className="text-gray-400 text-sm">to</span>
                                            <input
                                                type="time"
                                                value={dayHours?.close || "17:00"}
                                                onChange={(e) => updateHours(key, "close", e.target.value)}
                                                className="px-2 py-1 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-violet-500 focus:border-transparent outline-none"
                                            />
                                        </div>
                                    )}

                                    {dayHours?.closed && (
                                        <span className="text-xs text-gray-400 ml-2">Closed</span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* After-Hours Behavior */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label>After-Hours Behavior</Label>
                        <AIFieldBadge meta={fieldMeta.after_hours_behavior} onReset={() => resetFieldToAI("after_hours_behavior")} />
                    </div>
                    <Select value={form.after_hours_behavior} onValueChange={(v) => updateField("after_hours_behavior", v)}>
                        <SelectTrigger>
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="voicemail">Take a voicemail</SelectItem>
                            <SelectItem value="emergency_forward">Forward emergency calls</SelectItem>
                            <SelectItem value="schedule_callback">Schedule a callback</SelectItem>
                            <SelectItem value="ai_handle">AI handles all calls 24/7</SelectItem>
                        </SelectContent>
                    </Select>
                </div>

                {/* Emergency Phone */}
                <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                        <Label htmlFor="emergency_phone">Emergency Phone Number</Label>
                        <AIFieldBadge meta={fieldMeta.emergency_phone} onReset={() => resetFieldToAI("emergency_phone")} />
                    </div>
                    <Input
                        id="emergency_phone"
                        type="tel"
                        value={form.emergency_phone}
                        onChange={(e) => updateField("emergency_phone", e.target.value)}
                        placeholder="+1 (555) 000-0000"
                    />
                    <p className="text-xs text-gray-400">
                        Number to forward urgent after-hours calls to.
                    </p>
                </div>
            </div>
        </div>
    );
}
