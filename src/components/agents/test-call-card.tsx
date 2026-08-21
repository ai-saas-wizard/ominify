"use client";

import { useState, useCallback } from "react";
import Link from "next/link";
import { Loader2, Phone, CheckCircle2, AlertTriangle, ExternalLink } from "lucide-react";
import {
    startAgentTestCall,
    type StartAgentTestCallResult,
} from "@/app/actions/agent-test-call-actions";
import { isValidPhone, formatPhoneForDisplay } from "@/lib/phone-utils";

interface TestCallCardProps {
    clientId: string;
    /** VAPI assistant id (the `[id]` route param). */
    vapiAssistantId: string;
    /** False when the agent has no row in `agents` — a call can't be placed. */
    isSynced: boolean;
    callerId: { phone_number: string; friendly_name: string | null } | null;
}

export function TestCallCard({
    clientId,
    vapiAssistantId,
    isSynced,
    callerId,
}: TestCallCardProps) {
    const [phone, setPhone] = useState("");
    const [name, setName] = useState("");
    const [calling, setCalling] = useState(false);
    const [result, setResult] = useState<StartAgentTestCallResult | null>(null);

    const canCall = isSynced && !calling && isValidPhone(phone);

    const handleCall = useCallback(async () => {
        if (!canCall) return;
        setCalling(true);
        setResult(null);
        try {
            const res = await startAgentTestCall({
                clientId,
                vapiAssistantId,
                phone,
                name: name.trim() || undefined,
            });
            setResult(res);
        } catch (err: any) {
            setResult({
                success: false,
                error: err?.message || "Something went wrong placing the call.",
                code: "vapi_error",
            });
        } finally {
            setCalling(false);
        }
    }, [canCall, clientId, vapiAssistantId, phone, name]);

    return (
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
            <div className="p-5 space-y-4">
                <div>
                    <h3 className="font-semibold text-gray-900">Test Agent</h3>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                        Place a real outbound call from this agent to any phone, so
                        you hear exactly what a lead hears. Uses your voice minutes.
                    </p>
                </div>

                {/* Caller ID */}
                {callerId ? (
                    <p className="text-xs text-gray-500">
                        Calling from{" "}
                        <span className="font-medium text-gray-700">
                            {formatPhoneForDisplay(callerId.phone_number)}
                        </span>
                    </p>
                ) : (
                    <p className="flex items-start gap-1.5 text-xs text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-px" />
                        No outbound number assigned to this agent — we&apos;ll fall
                        back to the client&apos;s default.
                    </p>
                )}

                <div className="space-y-2">
                    <input
                        type="tel"
                        inputMode="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleCall();
                        }}
                        placeholder="Your phone number"
                        disabled={!isSynced || calling}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                    <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") handleCall();
                        }}
                        placeholder="Name (optional)"
                        disabled={!isSynced || calling}
                        className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 disabled:bg-gray-50 disabled:text-gray-400"
                    />
                </div>

                <button
                    onClick={handleCall}
                    disabled={!canCall}
                    className="w-full py-2.5 rounded-xl text-sm font-semibold bg-gradient-to-r from-emerald-600 to-emerald-600 text-white hover:from-emerald-700 hover:to-emerald-700 shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/25 transition-all disabled:opacity-50 disabled:cursor-not-allowed disabled:shadow-none flex items-center justify-center gap-2"
                >
                    {calling ? (
                        <>
                            <Loader2 className="h-4 w-4 animate-spin" />
                            Placing call...
                        </>
                    ) : (
                        <>
                            <Phone className="h-4 w-4" />
                            Call me
                        </>
                    )}
                </button>

                {!isSynced && (
                    <p className="text-xs text-gray-400 italic">
                        Agent not synced to database yet.
                    </p>
                )}

                {/* Result */}
                {result?.success && (
                    <div className="flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-xs text-emerald-800">
                        <CheckCircle2 className="h-4 w-4 shrink-0 mt-px text-emerald-600" />
                        <span>
                            Calling {formatPhoneForDisplay(result.to)} now — pick up
                            your phone.
                        </span>
                    </div>
                )}
                {result && !result.success && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-800">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-px text-red-600" />
                        <div className="space-y-1">
                            <p>{result.error}</p>
                            {result.fixHref && (
                                <Link
                                    href={result.fixHref}
                                    className="inline-flex items-center gap-1 font-medium underline underline-offset-2"
                                >
                                    {result.fixLabel || "Fix this"}
                                    <ExternalLink className="h-3 w-3" />
                                </Link>
                            )}
                        </div>
                    </div>
                )}

                <Link
                    href={`/client/${clientId}/unibox?agent=${vapiAssistantId}`}
                    className="flex items-center justify-center gap-1.5 w-full py-2 text-sm font-medium text-gray-600 hover:text-gray-900 border border-gray-200 rounded-xl hover:bg-gray-50 transition-colors"
                >
                    View in UNIBOX
                    <ExternalLink className="w-3.5 h-3.5" />
                </Link>
            </div>
        </div>
    );
}
