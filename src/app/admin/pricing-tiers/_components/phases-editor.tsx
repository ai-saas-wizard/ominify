"use client";

import { useEffect, useMemo } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

export interface EditablePhase {
    stripe_price_id: string;
    price_usd: string;       // string for input; coerced on submit
    monthly_minutes: string;
    duration_months: string; // empty = "forever" (terminal)
}

function emptyPhase(): EditablePhase {
    return {
        stripe_price_id: "",
        price_usd: "",
        monthly_minutes: "",
        duration_months: "",
    };
}

export function phasesToJson(
    enabled: boolean,
    phases: EditablePhase[]
): string {
    if (!enabled || phases.length < 2) return "";
    const cleaned = phases.map((p, i) => ({
        stripe_price_id: p.stripe_price_id.trim(),
        price_usd: Number(p.price_usd),
        monthly_minutes: Number(p.monthly_minutes),
        duration_months:
            i === phases.length - 1
                ? null
                : p.duration_months.trim() === ""
                  ? null
                  : Number(p.duration_months),
    }));
    return JSON.stringify(cleaned);
}

/**
 * Renders the multi-phase editor. When the toggle is OFF, this component is
 * effectively invisible — callers fall back to the single-price fields above.
 * When ON, phases drive the actual pricing on submit.
 *
 * The parent form is responsible for:
 * - Forwarding the toggle state to the server (we expose `enabled` via prop)
 * - Mirroring phase 1's values into the top-level Stripe price ID / Price /
 *   Minutes fields on submit (so DB reads that don't know about phases still
 *   work). This component just owns the local edit state.
 */
export function PhasesEditor({
    enabled,
    onEnabledChange,
    phases,
    onPhasesChange,
    syncSinglePhase,
}: {
    enabled: boolean;
    onEnabledChange: (v: boolean) => void;
    phases: EditablePhase[];
    onPhasesChange: (next: EditablePhase[]) => void;
    /**
     * Called whenever phase 1's pricing fields change while multi-phase is
     * enabled, so the parent form can keep the (disabled) top-level inputs
     * in sync.
     */
    syncSinglePhase?: (phase1: EditablePhase) => void;
}) {
    // Keep top-level fields in sync with phase 1 while multi-phase is on
    useEffect(() => {
        if (enabled && phases[0] && syncSinglePhase) {
            syncSinglePhase(phases[0]);
        }
    }, [enabled, phases, syncSinglePhase]);

    function update(idx: number, patch: Partial<EditablePhase>) {
        const next = phases.slice();
        next[idx] = { ...next[idx], ...patch };
        onPhasesChange(next);
    }

    function addPhase() {
        const next = phases.slice();
        // The previous final phase is no longer terminal — give it a default duration.
        if (next.length > 0) {
            const last = next[next.length - 1];
            next[next.length - 1] = {
                ...last,
                duration_months: last.duration_months || "1",
            };
        }
        next.push(emptyPhase());
        onPhasesChange(next);
    }

    function removePhase(idx: number) {
        if (phases.length <= 2) return;
        const next = phases.filter((_, i) => i !== idx);
        onPhasesChange(next);
    }

    function handleToggle(v: boolean) {
        if (v && phases.length < 2) {
            onPhasesChange([
                phases[0] ?? emptyPhase(),
                emptyPhase(),
            ]);
        }
        onEnabledChange(v);
    }

    const preview = useMemo(() => {
        if (!enabled || phases.length < 2) return null;
        const segments = phases
            .map((p, i) => {
                const price = p.price_usd ? `$${p.price_usd}` : "$?";
                const isLast = i === phases.length - 1;
                if (isLast) return `${price}/mo`;
                const dur = p.duration_months || "?";
                return `${price}/mo × ${dur}`;
            })
            .join(" → ");
        const minutes = phases
            .map((p) => `${p.monthly_minutes || "?"}min`)
            .join(" → ");
        return `${segments}  •  ${minutes}`;
    }, [enabled, phases]);

    return (
        <div className="space-y-4 border border-gray-200 rounded-xl p-4 bg-gray-50/50">
            <div className="flex items-center justify-between">
                <div>
                    <Label htmlFor="multi_phase" className="cursor-pointer">
                        Multi-phase pricing (intro / promo)
                    </Label>
                    <p className="text-xs text-gray-500 mt-0.5">
                        Charge a different price + grant different minutes for the first
                        N months, then transition to the steady-state price.
                    </p>
                </div>
                <Switch id="multi_phase" checked={enabled} onCheckedChange={handleToggle} />
            </div>

            {enabled && (
                <>
                    <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-2">
                        When ON, the &quot;Stripe price ID / Price / Monthly minutes&quot;
                        fields above are managed by Phase 1 below. Each phase needs its
                        own Stripe Price (create them in Stripe Dashboard, paste the IDs
                        here).
                    </p>

                    <div className="space-y-3">
                        {phases.map((p, i) => {
                            const isLast = i === phases.length - 1;
                            return (
                                <div
                                    key={i}
                                    className="bg-white border border-gray-200 rounded-lg p-4 space-y-3"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2 py-1 rounded">
                                                Phase {i + 1}
                                            </span>
                                            {isLast && (
                                                <span className="text-xs text-gray-500">
                                                    runs forever
                                                </span>
                                            )}
                                        </div>
                                        {phases.length > 2 && (
                                            <button
                                                type="button"
                                                onClick={() => removePhase(i)}
                                                className="p-1 text-gray-400 hover:text-red-600 rounded"
                                                title="Remove phase"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                    </div>

                                    <div>
                                        <Label htmlFor={`phase_${i}_price_id`}>
                                            Stripe price ID
                                        </Label>
                                        <Input
                                            id={`phase_${i}_price_id`}
                                            value={p.stripe_price_id}
                                            onChange={(e) =>
                                                update(i, {
                                                    stripe_price_id: e.target.value,
                                                })
                                            }
                                            placeholder="price_1Txxxxxx"
                                        />
                                    </div>

                                    <div className="grid grid-cols-3 gap-3">
                                        <div>
                                            <Label htmlFor={`phase_${i}_price_usd`}>
                                                Price (USD/mo)
                                            </Label>
                                            <Input
                                                id={`phase_${i}_price_usd`}
                                                type="number"
                                                step="0.01"
                                                min="0.01"
                                                value={p.price_usd}
                                                onChange={(e) =>
                                                    update(i, { price_usd: e.target.value })
                                                }
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor={`phase_${i}_minutes`}>
                                                Monthly minutes
                                            </Label>
                                            <Input
                                                id={`phase_${i}_minutes`}
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={p.monthly_minutes}
                                                onChange={(e) =>
                                                    update(i, {
                                                        monthly_minutes: e.target.value,
                                                    })
                                                }
                                            />
                                        </div>
                                        <div>
                                            <Label htmlFor={`phase_${i}_duration`}>
                                                Duration (months)
                                            </Label>
                                            <Input
                                                id={`phase_${i}_duration`}
                                                type="number"
                                                min="1"
                                                step="1"
                                                value={isLast ? "" : p.duration_months}
                                                onChange={(e) =>
                                                    update(i, {
                                                        duration_months: e.target.value,
                                                    })
                                                }
                                                disabled={isLast}
                                                placeholder={isLast ? "Forever" : "2"}
                                            />
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>

                    <button
                        type="button"
                        onClick={addPhase}
                        className="inline-flex items-center gap-2 text-sm text-emerald-700 hover:text-emerald-800"
                    >
                        <Plus className="w-4 h-4" /> Add another phase
                    </button>

                    {preview && (
                        <div className="text-xs text-gray-600 bg-white border border-gray-200 rounded px-3 py-2">
                            <span className="font-semibold">Preview:</span> {preview}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
