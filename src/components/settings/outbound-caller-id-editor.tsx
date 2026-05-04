"use client";

import { useState, useTransition } from "react";
import { Phone, Loader2, Check, AlertTriangle, ExternalLink } from "lucide-react";
import { useRouter } from "next/navigation";
import {
    setDefaultOutboundPhone,
    type OutboundPhoneOption,
} from "@/app/actions/default-outbound-phone-actions";

interface Props {
    clientId: string;
    initialDefaultPhoneId: string | null;
    phones: OutboundPhoneOption[];
}

export function OutboundCallerIdEditor({
    clientId,
    initialDefaultPhoneId,
    phones,
}: Props) {
    const router = useRouter();
    const [selectedId, setSelectedId] = useState<string | null>(initialDefaultPhoneId);
    const [savedId, setSavedId] = useState<string | null>(initialDefaultPhoneId);
    const [error, setError] = useState<string>("");
    const [isPending, startTransition] = useTransition();

    const dirty = selectedId !== savedId;

    function handleSave() {
        setError("");
        startTransition(async () => {
            const result = await setDefaultOutboundPhone(clientId, selectedId);
            if (result.success) {
                setSavedId(selectedId);
                router.refresh();
            } else {
                setError(result.error || "Failed to save");
            }
        });
    }

    function handleClear() {
        setError("");
        setSelectedId(null);
        startTransition(async () => {
            const result = await setDefaultOutboundPhone(clientId, null);
            if (result.success) {
                setSavedId(null);
                router.refresh();
            } else {
                setError(result.error || "Failed to clear default");
            }
        });
    }

    if (phones.length === 0) {
        return (
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center space-y-3">
                <div className="w-12 h-12 rounded-xl bg-gray-100 flex items-center justify-center mx-auto">
                    <Phone className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-gray-700 font-medium">
                    You don't have any phone numbers yet
                </p>
                <p className="text-sm text-gray-500">
                    Purchase a number first, then come back here to set the
                    default outbound caller ID.
                </p>
                <a
                    href={`/client/${clientId}/phone-numbers`}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-600 hover:text-emerald-700"
                >
                    Go to Phone Numbers
                    <ExternalLink className="w-3.5 h-3.5" />
                </a>
            </div>
        );
    }

    return (
        <div className="space-y-5">
            <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/40 flex items-center justify-between">
                    <div>
                        <h2 className="text-base font-semibold text-gray-900">
                            Default outbound number
                        </h2>
                        <p className="text-xs text-gray-500 mt-0.5">
                            Used as the caller ID for every outbound call unless
                            an agent has its own assignment.
                        </p>
                    </div>
                </div>

                <div className="divide-y divide-gray-100">
                    {phones.map((phone) => {
                        const isSelected = selectedId === phone.id;
                        const isCurrent = savedId === phone.id;
                        const notSynced = !phone.vapi_phone_number_id;

                        return (
                            <label
                                key={phone.id}
                                className={`flex items-center gap-4 px-6 py-4 cursor-pointer transition-colors ${
                                    isSelected ? "bg-emerald-50/60" : "hover:bg-gray-50"
                                } ${notSynced ? "opacity-60" : ""}`}
                            >
                                <input
                                    type="radio"
                                    name="default-outbound-phone"
                                    value={phone.id}
                                    checked={isSelected}
                                    disabled={notSynced || isPending}
                                    onChange={() => setSelectedId(phone.id)}
                                    className="w-4 h-4 text-emerald-600 border-gray-300 focus:ring-emerald-500"
                                />

                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2">
                                        <span className="font-mono text-sm font-medium text-gray-900">
                                            {phone.phone_number}
                                        </span>
                                        {isCurrent && (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full uppercase tracking-wider">
                                                <Check className="w-2.5 h-2.5" />
                                                Current default
                                            </span>
                                        )}
                                    </div>
                                    {phone.friendly_name && (
                                        <p className="text-xs text-gray-500 mt-0.5">
                                            {phone.friendly_name}
                                        </p>
                                    )}
                                    {notSynced && (
                                        <p className="inline-flex items-center gap-1 text-[11px] text-amber-700 mt-1">
                                            <AlertTriangle className="w-3 h-3" />
                                            Not synced to VAPI yet — sync from the
                                            Phone Numbers page first
                                        </p>
                                    )}
                                </div>
                            </label>
                        );
                    })}
                </div>
            </div>

            {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {error}
                </div>
            )}

            <div className="flex items-center justify-between gap-3">
                <button
                    type="button"
                    onClick={handleClear}
                    disabled={isPending || (!savedId && !selectedId)}
                    className="text-sm text-gray-600 hover:text-gray-900 font-medium disabled:opacity-40 transition-colors"
                >
                    Clear default
                </button>

                <button
                    type="button"
                    onClick={handleSave}
                    disabled={!dirty || isPending}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 text-white text-sm font-semibold hover:bg-emerald-700 shadow-sm shadow-emerald-500/20 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                >
                    {isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                        <Check className="w-4 h-4" />
                    )}
                    {isPending ? "Saving..." : "Save default"}
                </button>
            </div>

            <p className="text-xs text-gray-500 leading-relaxed">
                Need to manage which agents own which numbers, or purchase a new
                number?{" "}
                <a
                    href={`/client/${clientId}/phone-numbers`}
                    className="text-emerald-600 hover:text-emerald-700 font-medium underline-offset-2 hover:underline"
                >
                    Go to Phone Numbers
                </a>
                .
            </p>
        </div>
    );
}
