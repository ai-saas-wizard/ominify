"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Check,
    Plus,
    X,
    Bell,
    Mail,
    MessageSquare,
    Phone,
    Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { HandoffRulesConfig, HandoffTrigger } from "./types";
import {
    SUCCESS_CONDITIONS,
    AFTER_SEQUENCE_OPTIONS,
    getHandoffPresetsForIndustry,
} from "./constants";

interface HandoffRulesProps {
    config: HandoffRulesConfig;
    industry: string;
    tenantPhone: string;
    tenantEmail: string;
    maxTouchpoints: number;
    onChange: (config: HandoffRulesConfig) => void;
}

export function HandoffRulesScreen({
    config,
    industry,
    tenantPhone,
    tenantEmail,
    maxTouchpoints,
    onChange,
}: HandoffRulesProps) {
    const [customTriggerText, setCustomTriggerText] = useState("");
    const presets = getHandoffPresetsForIndustry(industry);

    function toggleSuccessCondition(id: string) {
        const current = config.success_conditions;
        const updated = current.includes(id)
            ? current.filter((c) => c !== id)
            : [...current, id];
        onChange({ ...config, success_conditions: updated });
    }

    function togglePresetTrigger(trigger: HandoffTrigger) {
        const existing = config.handoff_triggers;
        const idx = existing.findIndex(
            (t) => t.type === "preset" && t.id === trigger.id
        );
        if (idx >= 0) {
            onChange({
                ...config,
                handoff_triggers: existing.filter((_, i) => i !== idx),
            });
        } else {
            onChange({
                ...config,
                handoff_triggers: [...existing, trigger],
            });
        }
    }

    function addCustomTrigger() {
        if (!customTriggerText.trim()) return;
        const trigger: HandoffTrigger = {
            type: "custom",
            label: customTriggerText.trim(),
            description: customTriggerText.trim(),
        };
        onChange({
            ...config,
            handoff_triggers: [...config.handoff_triggers, trigger],
        });
        setCustomTriggerText("");
    }

    function removeCustomTrigger(index: number) {
        onChange({
            ...config,
            handoff_triggers: config.handoff_triggers.filter((_, i) => i !== index),
        });
    }

    return (
        <div className="space-y-8">
            <div>
                <h2 className="text-xl font-semibold text-gray-900">
                    When should we hand it to you?
                </h2>
                <p className="text-sm text-gray-500 mt-1">
                    Define when your AI should step aside and let you take over.
                </p>
            </div>

            {/* Section 1: Success Conditions */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">
                    Success conditions
                </label>
                <p className="text-xs text-gray-400">
                    What does "done" look like? Select one or more.
                </p>
                <div className="space-y-2">
                    {SUCCESS_CONDITIONS.map((cond) => {
                        const isSelected = config.success_conditions.includes(cond.id);
                        return (
                            <button
                                key={cond.id}
                                onClick={() => toggleSuccessCondition(cond.id)}
                                className={cn(
                                    "w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all",
                                    isSelected
                                        ? "border-emerald-500 bg-emerald-50/40"
                                        : "border-gray-200 hover:border-gray-300"
                                )}
                            >
                                <div
                                    className={cn(
                                        "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                                        isSelected
                                            ? "border-emerald-500 bg-emerald-500"
                                            : "border-gray-300"
                                    )}
                                >
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-900">{cond.label}</p>
                                    <p className="text-xs text-gray-400 mt-0.5">{cond.example}</p>
                                </div>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* Section 2: Handoff Triggers */}
            <div className="space-y-3">
                <label className="text-sm font-medium text-gray-700">
                    Handoff triggers
                </label>
                <p className="text-xs text-gray-400">
                    When should the AI step aside? These are scenarios where you handle it personally.
                </p>

                {/* Preset triggers */}
                <div className="space-y-2">
                    {presets.map((preset) => {
                        const isSelected = config.handoff_triggers.some(
                            (t) => t.type === "preset" && t.id === preset.id
                        );
                        return (
                            <button
                                key={preset.id}
                                onClick={() => togglePresetTrigger(preset)}
                                className={cn(
                                    "w-full flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                                    isSelected
                                        ? "border-amber-400 bg-amber-50/40"
                                        : "border-gray-200 hover:border-gray-300"
                                )}
                            >
                                <div
                                    className={cn(
                                        "w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 transition-colors",
                                        isSelected
                                            ? "border-amber-500 bg-amber-500"
                                            : "border-gray-300"
                                    )}
                                >
                                    {isSelected && <Check className="w-3 h-3 text-white" />}
                                </div>
                                <p className="text-sm text-gray-700">{preset.label}</p>
                            </button>
                        );
                    })}
                </div>

                {/* Custom triggers */}
                <AnimatePresence>
                    {config.handoff_triggers
                        .filter((t) => t.type === "custom")
                        .map((trigger, i) => (
                            <motion.div
                                key={`custom-${i}`}
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                className="flex items-center gap-2 p-3 rounded-lg border border-blue-200 bg-blue-50/30"
                            >
                                <div className="w-5 h-5 rounded-md bg-blue-500 flex items-center justify-center flex-shrink-0">
                                    <Check className="w-3 h-3 text-white" />
                                </div>
                                <p className="text-sm text-gray-700 flex-1">
                                    If they {trigger.label.toLowerCase()}
                                </p>
                                <button
                                    onClick={() => {
                                        const customIdx = config.handoff_triggers.findIndex(
                                            (t) => t.type === "custom" && t.label === trigger.label
                                        );
                                        if (customIdx >= 0) removeCustomTrigger(customIdx);
                                    }}
                                    className="p-1 hover:bg-blue-100 rounded transition-colors"
                                >
                                    <X className="w-3.5 h-3.5 text-blue-500" />
                                </button>
                            </motion.div>
                        ))}
                </AnimatePresence>

                {/* Add custom trigger */}
                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                            If they
                        </span>
                        <input
                            value={customTriggerText}
                            onChange={(e) => setCustomTriggerText(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && addCustomTrigger()}
                            placeholder="ask about financing options..."
                            className="w-full pl-16 pr-3 py-2.5 border border-gray-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-sm"
                        />
                    </div>
                    <button
                        onClick={addCustomTrigger}
                        disabled={!customTriggerText.trim()}
                        className="px-3 py-2.5 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 rounded-lg transition-colors"
                    >
                        <Plus className="w-4 h-4 text-gray-600" />
                    </button>
                </div>
            </div>

            {/* Section 3: No-Response Rules */}
            <div className="space-y-4">
                <label className="text-sm font-medium text-gray-700">
                    No-response rules
                </label>

                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-600">
                            Stop after how many unanswered touchpoints?
                        </span>
                        <span className="text-sm font-semibold text-gray-900">
                            {config.no_response.max_touchpoints}
                        </span>
                    </div>
                    <Slider
                        value={[config.no_response.max_touchpoints]}
                        min={2}
                        max={Math.max(maxTouchpoints, 4)}
                        step={1}
                        onValueChange={([val]) =>
                            onChange({
                                ...config,
                                no_response: { ...config.no_response, max_touchpoints: val },
                            })
                        }
                    />
                </div>

                <div className="space-y-2">
                    <span className="text-sm text-gray-600">
                        If no response after the sequence ends:
                    </span>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        {AFTER_SEQUENCE_OPTIONS.map((opt) => (
                            <button
                                key={opt.value}
                                onClick={() =>
                                    onChange({
                                        ...config,
                                        no_response: {
                                            ...config.no_response,
                                            after_sequence: opt.value as any,
                                        },
                                    })
                                }
                                className={cn(
                                    "px-3 py-2.5 rounded-lg border text-sm font-medium transition-all text-center",
                                    config.no_response.after_sequence === opt.value
                                        ? "border-emerald-500 bg-emerald-50 text-emerald-700"
                                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                                )}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>

                    {config.no_response.after_sequence === "reengage_weeks" && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="flex items-center gap-2 pl-1"
                        >
                            <span className="text-sm text-gray-500">Re-engage in</span>
                            <select
                                value={config.no_response.reengage_weeks || 2}
                                onChange={(e) =>
                                    onChange({
                                        ...config,
                                        no_response: {
                                            ...config.no_response,
                                            reengage_weeks: Number(e.target.value),
                                        },
                                    })
                                }
                                className="px-2 py-1 border rounded-lg text-sm bg-white"
                            >
                                {[2, 3, 4, 6, 8].map((w) => (
                                    <option key={w} value={w}>
                                        {w} weeks
                                    </option>
                                ))}
                            </select>
                        </motion.div>
                    )}
                </div>
            </div>

            {/* Section 4: Notification Preferences */}
            <div className="space-y-4">
                <label className="text-sm font-medium text-gray-700">
                    How to notify you
                </label>
                <p className="text-xs text-gray-400">
                    When a handoff or success condition fires, how should we reach you?
                </p>

                <div className="space-y-3">
                    {/* SMS Notification */}
                    <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2">
                            <Smartphone className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-700">Text me</span>
                        </div>
                        <input
                            value={config.notification.sms}
                            onChange={(e) =>
                                onChange({
                                    ...config,
                                    notification: { ...config.notification, sms: e.target.value },
                                })
                            }
                            placeholder={tenantPhone || "(555) 123-4567"}
                            className="text-sm text-right text-gray-600 bg-transparent outline-none w-36"
                        />
                    </div>

                    {/* Email Notification */}
                    <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2">
                            <Mail className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-700">Email me</span>
                        </div>
                        <input
                            value={config.notification.email}
                            onChange={(e) =>
                                onChange({
                                    ...config,
                                    notification: {
                                        ...config.notification,
                                        email: e.target.value,
                                    },
                                })
                            }
                            placeholder={tenantEmail || "you@business.com"}
                            className="text-sm text-right text-gray-600 bg-transparent outline-none w-48"
                        />
                    </div>

                    {/* Push Notification */}
                    <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2">
                            <Bell className="w-4 h-4 text-gray-400" />
                            <span className="text-sm text-gray-700">
                                Push notification in Omnify
                            </span>
                        </div>
                        <Switch
                            checked={config.notification.push}
                            onCheckedChange={(checked) =>
                                onChange({
                                    ...config,
                                    notification: { ...config.notification, push: checked },
                                })
                            }
                        />
                    </div>

                    {/* Urgent call */}
                    <div className="flex items-center justify-between p-3 rounded-lg border border-gray-200">
                        <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-gray-400" />
                            <div>
                                <span className="text-sm text-gray-700">
                                    Call me for urgent handoffs
                                </span>
                                <p className="text-xs text-gray-400">
                                    Complaints, emergencies, hot leads
                                </p>
                            </div>
                        </div>
                        <Switch
                            checked={config.notification.urgent_call}
                            onCheckedChange={(checked) =>
                                onChange({
                                    ...config,
                                    notification: {
                                        ...config.notification,
                                        urgent_call: checked,
                                    },
                                })
                            }
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
