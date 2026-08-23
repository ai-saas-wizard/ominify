"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
    Check,
    Plus,
    X,
    Mail,
    Phone,
    Smartphone,
    ChevronDown,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { seqOption, seqOptionSelected, seqFocusRing, seqBtnSecondary } from "@/components/sequences/theme";
import { normalizeToE164 } from "@/lib/phone-utils";
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
    const [smsError, setSmsError] = useState<string | null>(null);
    const presets = getHandoffPresetsForIndustry(industry);

    function handleSmsBlur() {
        const raw = config.notification.sms;
        if (!raw || !raw.trim()) {
            setSmsError(null);
            return;
        }
        const normalized = normalizeToE164(raw);
        if (normalized) {
            if (normalized !== raw) {
                onChange({
                    ...config,
                    notification: { ...config.notification, sms: normalized },
                });
            }
            setSmsError(null);
        } else {
            setSmsError("Please enter a valid phone number (e.g. +1 212 555 1212)");
        }
    }

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
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                    When should we hand it to you?
                </h2>
                <p className="mt-1 text-sm text-gray-500">
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
                                    "flex w-full items-center gap-3 rounded-lg p-3 text-left",
                                    seqFocusRing,
                                    isSelected ? seqOptionSelected : seqOption
                                )}
                            >
                                <div
                                    className={cn(
                                        "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                                        isSelected
                                            ? "border-emerald-600 bg-emerald-600"
                                            : "border-gray-300"
                                    )}
                                >
                                    {isSelected && <Check className="h-3 w-3 text-white" />}
                                </div>
                                <div className="flex-1">
                                    <p className="text-sm font-medium text-gray-900">{cond.label}</p>
                                    <p className="mt-0.5 text-xs text-gray-400">{cond.example}</p>
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
                                    "flex w-full items-center gap-3 rounded-lg p-3 text-left",
                                    seqFocusRing,
                                    isSelected
                                        ? "border border-amber-500 bg-amber-50/40 ring-1 ring-amber-500"
                                        : seqOption
                                )}
                            >
                                <div
                                    className={cn(
                                        "flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border transition-colors",
                                        isSelected
                                            ? "border-amber-500 bg-amber-500"
                                            : "border-gray-300"
                                    )}
                                >
                                    {isSelected && <Check className="h-3 w-3 text-white" />}
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
                                className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3"
                            >
                                <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md bg-gray-900">
                                    <Check className="h-3 w-3 text-white" />
                                </div>
                                <p className="flex-1 text-sm text-gray-700">
                                    {trigger.label}
                                </p>
                                <button
                                    onClick={() => {
                                        const customIdx = config.handoff_triggers.findIndex(
                                            (t) => t.type === "custom" && t.label === trigger.label
                                        );
                                        if (customIdx >= 0) removeCustomTrigger(customIdx);
                                    }}
                                    aria-label="Remove trigger"
                                    className={cn(
                                        "rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-200 hover:text-gray-600",
                                        seqFocusRing
                                    )}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </motion.div>
                        ))}
                </AnimatePresence>

                {/* Add custom trigger */}
                <div className="flex gap-2">
                    <div className="flex-1 relative">
                        <input
                            value={customTriggerText}
                            onChange={(e) => setCustomTriggerText(e.target.value)}
                            onKeyDown={(e) => e.key === "Enter" && addCustomTrigger()}
                            placeholder="Describe the trigger (e.g. asks about financing options, mentions a competitor)..."
                            className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm outline-none transition-colors hover:border-gray-300 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-600/30"
                        />
                    </div>
                    <button
                        onClick={addCustomTrigger}
                        disabled={!customTriggerText.trim()}
                        aria-label="Add trigger"
                        className={cn(seqBtnSecondary, "px-3 py-2.5")}
                    >
                        <Plus className="h-4 w-4 text-gray-500" />
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
                        <span className="text-sm font-semibold tabular-nums text-gray-900">
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
                                    "rounded-lg px-3 py-2.5 text-center text-sm font-medium",
                                    seqFocusRing,
                                    config.no_response.after_sequence === opt.value
                                        ? cn(seqOptionSelected, "text-emerald-800")
                                        : cn(seqOption, "text-gray-600")
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
                            <WeeksSelect
                                value={config.no_response.reengage_weeks || 2}
                                onChange={(w) =>
                                    onChange({
                                        ...config,
                                        no_response: {
                                            ...config.no_response,
                                            reengage_weeks: w,
                                        },
                                    })
                                }
                            />
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
                    Phone numbers must include country code, e.g. +1 212 555 1212.
                </p>

                <div className="space-y-3">
                    {/* SMS Notification */}
                    <div>
                        <div
                            className={cn(
                                "flex items-center justify-between p-3 rounded-lg border",
                                smsError ? "border-red-300" : "border-gray-200"
                            )}
                        >
                            <div className="flex items-center gap-2">
                                <Smartphone className="w-4 h-4 text-gray-400" />
                                <span className="text-sm text-gray-700">Text me</span>
                            </div>
                            <input
                                type="tel"
                                value={config.notification.sms}
                                onChange={(e) => {
                                    if (smsError) setSmsError(null);
                                    onChange({
                                        ...config,
                                        notification: { ...config.notification, sms: e.target.value },
                                    });
                                }}
                                onBlur={handleSmsBlur}
                                placeholder={tenantPhone || "+1 (212) 555-1212"}
                                className="text-sm text-right text-gray-600 bg-transparent outline-none w-44"
                            />
                        </div>
                        {smsError && (
                            <p className="mt-1 text-xs text-red-500" role="alert">
                                {smsError}
                            </p>
                        )}
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
                            className="data-[state=checked]:bg-emerald-600"
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

// ─── In-app styled week picker (replaces native <select> so the dropdown
// matches the rest of the wizard instead of the OS popup chrome) ───

const WEEK_OPTIONS = [2, 3, 4, 6, 8];

function WeeksSelect({
    value,
    onChange,
}: {
    value: number;
    onChange: (w: number) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!open) return;
        function onDocClick(e: MouseEvent) {
            if (ref.current && !ref.current.contains(e.target as Node)) {
                setOpen(false);
            }
        }
        function onKey(e: KeyboardEvent) {
            if (e.key === "Escape") setOpen(false);
        }
        document.addEventListener("mousedown", onDocClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onDocClick);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    return (
        <div ref={ref} className="relative">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={cn(
                    "flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2.5 py-1 text-sm transition-colors hover:border-gray-300",
                    seqFocusRing
                )}
            >
                <span>{value} weeks</span>
                <ChevronDown
                    className={cn(
                        "w-3.5 h-3.5 text-gray-400 transition-transform",
                        open && "rotate-180"
                    )}
                />
            </button>
            <AnimatePresence>
                {open && (
                    <motion.ul
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.12 }}
                        className="absolute left-0 z-20 mt-1 min-w-full overflow-hidden rounded-lg border border-gray-200 bg-white py-1 shadow-md"
                    >
                        {WEEK_OPTIONS.map((w) => {
                            const selected = w === value;
                            return (
                                <li key={w}>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            onChange(w);
                                            setOpen(false);
                                        }}
                                        className={cn(
                                            "w-full flex items-center justify-between gap-3 px-3 py-1.5 text-sm text-left transition-colors",
                                            selected
                                                ? "bg-emerald-50 text-emerald-700 font-medium"
                                                : "text-gray-700 hover:bg-gray-50"
                                        )}
                                    >
                                        <span>{w} weeks</span>
                                        {selected && (
                                            <Check className="w-3.5 h-3.5 text-emerald-600" />
                                        )}
                                    </button>
                                </li>
                            );
                        })}
                    </motion.ul>
                )}
            </AnimatePresence>
        </div>
    );
}
