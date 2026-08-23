"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Shuffle } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
    listRotationPhoneOptions,
    updateSequencePhoneRotation,
    type RotationPhoneOption,
} from "@/app/actions/sequence-actions";
import { cn } from "@/lib/utils";
import {
    seqBtnPrimary,
    seqCardStatic,
    type SeqRailPanelProps,
} from "@/components/sequences/theme";

/** The sequence fields this card reads, a structural subset of the row. */
export interface NumberRotationFields {
    rotate_phone_numbers?: boolean | null;
    rotation_phone_number_ids?: string[] | null;
}

/**
 * "Rotate numbers": spread this sequence's calls + texts across a hand-picked
 * pool of the account's numbers. Each lead is stuck to one number for the
 * whole campaign (sequencer lib/outbound-phone.ts), so replies and callbacks
 * land where the lead expects them.
 */
export function NumberRotationCard({
    sequenceId,
    clientId,
    sequence,
    className,
    bare,
    onDirtyChange,
    registerSave,
}: SeqRailPanelProps & {
    sequenceId: string;
    clientId: string;
    sequence: NumberRotationFields | null | undefined;
    className?: string;
}) {
    const router = useRouter();
    const serverEnabled = sequence?.rotate_phone_numbers === true;
    const serverIds = sequence?.rotation_phone_number_ids ?? [];
    const serverIdsKey = serverIds.join(",");

    const [phones, setPhones] = useState<RotationPhoneOption[]>([]);
    const [loading, setLoading] = useState(true);
    const [enabled, setEnabled] = useState(serverEnabled);
    const [selected, setSelected] = useState<Set<string>>(() => new Set(serverIds));
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        listRotationPhoneOptions(clientId)
            .then((rows) => {
                if (!cancelled) setPhones(rows);
            })
            .finally(() => !cancelled && setLoading(false));
        return () => {
            cancelled = true;
        };
    }, [clientId]);

    // Re-sync when the server row changes under us (router.refresh after save,
    // a concurrent edit in another tab). Done during render rather than in an
    // effect, React's "reset state when a prop changes" pattern, so the
    // synced values paint in the same pass instead of one render late.
    const serverKey = `${sequenceId}|${serverEnabled}|${serverIdsKey}`;
    const [syncedKey, setSyncedKey] = useState(serverKey);
    if (syncedKey !== serverKey) {
        setSyncedKey(serverKey);
        setEnabled(serverEnabled);
        setSelected(new Set(serverIdsKey ? serverIdsKey.split(",") : []));
    }

    const eligible = phones.filter((p) => !!p.vapi_phone_number_id);
    const selectedCount = phones.filter((p) => selected.has(p.id)).length;
    const missingCount = loading
        ? 0
        : serverIds.filter((id) => !phones.some((p) => p.id === id)).length;

    function toggleNumber(id: string) {
        setSelected((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
        setSaved(false);
        setError(null);
    }

    function handleToggle(on: boolean) {
        setEnabled(on);
        setSaved(false);
        setError(null);
    }

    async function handleSave() {
        // Option order (created_at asc) = the rotation order the sequencer uses.
        // Stale ids (released numbers) never make it into the list.
        const ids = phones.filter((p) => selected.has(p.id)).map((p) => p.id);
        if (enabled && ids.length === 0) {
            setError("Pick at least one number to rotate across");
            return;
        }
        setSaving(true);
        setError(null);
        setSaved(false);

        const res = await updateSequencePhoneRotation(sequenceId, {
            rotate_phone_numbers: enabled,
            rotation_phone_number_ids: ids,
        });

        setSaving(false);
        if (res?.success) {
            setSaved(true);
            router.refresh();
        } else {
            setError(res?.error || "Could not save number rotation");
        }
    }

    // --- Rail integration -------------------------------------------------
    // See SeqRailPanelProps: the sequence-detail rail shows one save bar for
    // every config panel, so it needs the dirty flag and a commit function.
    const draftIds = phones.filter((p) => selected.has(p.id)).map((p) => p.id);
    const dirty = enabled !== serverEnabled || draftIds.join(",") !== serverIdsKey;

    useEffect(() => {
        onDirtyChange?.(dirty);
    }, [dirty, onDirtyChange]);

    const draftIdsKey = draftIds.join(",");
    const commit = useCallback(async (): Promise<string | null> => {
        const ids = draftIdsKey ? draftIdsKey.split(",") : [];
        if (enabled && ids.length === 0) return "Pick at least one number to rotate across";
        const res = await updateSequencePhoneRotation(sequenceId, {
            rotate_phone_numbers: enabled,
            rotation_phone_number_ids: ids,
        });
        return res?.success ? null : res?.error || "Could not save number rotation";
    }, [sequenceId, enabled, draftIdsKey]);

    useEffect(() => {
        if (!registerSave) return;
        registerSave(dirty ? commit : null);
        return () => registerSave(null);
    }, [registerSave, commit, dirty]);

    const body = (
        <>
            <div className="flex items-center justify-between gap-2">
                <label htmlFor="rotate-numbers" className="min-w-0 text-xs text-gray-600">
                    Rotate numbers
                    {bare && (
                        <span className="mt-0.5 block text-[10.5px] text-gray-400">
                            each lead keeps one number
                        </span>
                    )}
                </label>
                <Switch
                    id="rotate-numbers"
                    checked={enabled}
                    onCheckedChange={handleToggle}
                    disabled={saving || loading}
                    className="shrink-0 data-[state=checked]:bg-emerald-600"
                />
            </div>

            {enabled && (
                <div className="mt-3">
                    {loading ? (
                        <p className="flex items-center gap-1.5 text-xs text-gray-400">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Loading numbers…
                        </p>
                    ) : phones.length === 0 ? (
                        <p className="text-xs text-gray-500">
                            No active numbers yet.{" "}
                            <Link
                                href={`/client/${clientId}/phone-numbers`}
                                className="font-medium text-emerald-700 hover:underline"
                            >
                                Buy numbers
                            </Link>{" "}
                            on the Phone Numbers page first.
                        </p>
                    ) : (
                        <>
                            <div className="space-y-0.5" role="group" aria-label="Numbers in rotation">
                                {phones.map((p) => {
                                    const synced = !!p.vapi_phone_number_id;
                                    return (
                                        <label
                                            key={p.id}
                                            className={cn(
                                                "flex items-start gap-2.5 rounded-md px-1 py-1.5",
                                                synced
                                                    ? "cursor-pointer hover:bg-gray-50"
                                                    : "cursor-not-allowed opacity-60"
                                            )}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selected.has(p.id)}
                                                onChange={() => toggleNumber(p.id)}
                                                // Unsynced numbers can't be picked, but one that
                                                // lost its sync after being picked must stay
                                                // deselectable or the save can never pass.
                                                disabled={saving || (!synced && !selected.has(p.id))}
                                                className="mt-0.5 h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500"
                                            />
                                            <span className="min-w-0 flex-1">
                                                <span className="block truncate text-sm text-gray-900">
                                                    {p.friendly_name || p.phone_number}
                                                </span>
                                                <span className="block text-xs text-gray-500">
                                                    {p.friendly_name ? `${p.phone_number} · ` : ""}
                                                    {!synced ? (
                                                        <span className="text-amber-700">Not synced to VAPI</span>
                                                    ) : p.agent_name ? (
                                                        `Assigned to ${p.agent_name}`
                                                    ) : (
                                                        "Unassigned"
                                                    )}
                                                </span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                            <p className="mt-2 text-xs text-gray-500">
                                {selectedCount} of {eligible.length} selected
                                {eligible.length < 2 && " · rotation needs at least two numbers to matter"}
                            </p>
                            {missingCount > 0 && (
                                <p className="mt-1 text-xs text-amber-700">
                                    {missingCount} previously picked number{missingCount === 1 ? "" : "s"} no
                                    longer exist{missingCount === 1 ? "s" : ""} and will be dropped on save.
                                </p>
                            )}
                        </>
                    )}
                </div>
            )}

        </>
    );

    // Inside the sequence-detail rail the accordion header carries the title and
    // the rail's save bar carries the commit, so only the controls belong here.
    if (bare) {
        return <div className={cn("space-y-2.5", className)}>{body}</div>;
    }

    return (
        <div className={cn(seqCardStatic, "p-4", className)}>
            <div className="mb-1 flex items-center justify-between">
                <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-gray-500">
                    <Shuffle className="h-3.5 w-3.5 text-gray-400" />
                    Rotate Numbers
                </h4>
                {saving && (
                    <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Saving
                    </span>
                )}
                {!saving && saved && (
                    <span className="flex items-center gap-1 text-xs text-emerald-700">
                        <Check className="h-3 w-3" />
                        Saved
                    </span>
                )}
            </div>
            <p className="mb-3 text-xs text-gray-500">
                Spread this sequence&apos;s calls and texts across several of your numbers.
                Each lead keeps the same number for every touch.
            </p>

            {body}

            {error && <p className="mt-2 text-xs text-red-600">{error}</p>}

            <button
                type="button"
                onClick={handleSave}
                disabled={saving || loading}
                className={cn(seqBtnPrimary, "mt-3 w-full px-3 py-1.5 text-xs")}
            >
                {saving ? "Saving..." : "Save rotation"}
            </button>
        </div>
    );
}
