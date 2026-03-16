"use client";

import { useState } from "react";
import { Phone, Loader2, Unlink, Link2 } from "lucide-react";
import { assignPhoneNumberToAgent, unassignPhoneNumberFromAgent } from "@/app/actions/phone-assignment-actions";
import { useRouter } from "next/navigation";

interface PhoneNumber {
    id: string;
    phone_number: string;
    friendly_name?: string;
    agent_id?: string | null;
}

interface Props {
    clientId: string;
    agentDbId: string;
    assignedNumber: PhoneNumber | null;
    availableNumbers: PhoneNumber[];
}

export function PhoneNumberAssignment({ clientId, agentDbId, assignedNumber, availableNumbers }: Props) {
    const router = useRouter();
    const [loading, setLoading] = useState(false);
    const [selectedNumberId, setSelectedNumberId] = useState("");
    const [error, setError] = useState("");

    async function handleAssign() {
        if (!selectedNumberId) return;
        setLoading(true);
        setError("");
        try {
            const result = await assignPhoneNumberToAgent(clientId, selectedNumberId, agentDbId);
            if (result.success) {
                setSelectedNumberId("");
                router.refresh();
            } else {
                setError(result.error || "Failed to assign");
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    async function handleUnassign() {
        if (!assignedNumber) return;
        setLoading(true);
        setError("");
        try {
            const result = await unassignPhoneNumberFromAgent(clientId, assignedNumber.id);
            if (result.success) {
                router.refresh();
            } else {
                setError(result.error || "Failed to unassign");
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }

    return (
        <div className="space-y-3">
            <label className="text-xs font-medium text-gray-500">Phone Number</label>

            {assignedNumber ? (
                <div className="space-y-2">
                    <div className="flex items-center justify-between p-3 bg-green-50 rounded-lg border border-green-200">
                        <div className="flex items-center gap-2">
                            <Phone className="w-4 h-4 text-green-600" />
                            <span className="text-gray-900 font-mono tracking-wide text-sm">
                                {assignedNumber.phone_number}
                            </span>
                        </div>
                        <span className="text-xs font-medium text-green-700 bg-green-100 px-2 py-0.5 rounded-full">
                            Connected
                        </span>
                    </div>
                    <p className="text-xs text-gray-500">
                        Inbound calls route to this agent. Outbound calls use this as caller ID.
                    </p>
                    <button
                        onClick={handleUnassign}
                        disabled={loading}
                        className="inline-flex items-center gap-1.5 text-xs text-red-600 hover:text-red-700 font-medium disabled:opacity-50"
                    >
                        {loading ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                            <Unlink className="w-3 h-3" />
                        )}
                        Unassign Number
                    </button>
                </div>
            ) : (
                <div className="space-y-2">
                    {availableNumbers.length > 0 ? (
                        <div className="flex items-center gap-2">
                            <select
                                value={selectedNumberId}
                                onChange={(e) => setSelectedNumberId(e.target.value)}
                                disabled={loading}
                                className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white focus:ring-2 focus:ring-violet-500 focus:border-transparent disabled:opacity-50"
                            >
                                <option value="">Select a number...</option>
                                {availableNumbers.map((num) => (
                                    <option key={num.id} value={num.id}>
                                        {num.phone_number}{num.friendly_name ? ` (${num.friendly_name})` : ""}
                                    </option>
                                ))}
                            </select>
                            <button
                                onClick={handleAssign}
                                disabled={loading || !selectedNumberId}
                                className="inline-flex items-center gap-1.5 px-3 py-2 bg-violet-600 text-white rounded-lg text-sm font-medium hover:bg-violet-700 transition-colors disabled:opacity-50"
                            >
                                {loading ? (
                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                    <Link2 className="w-3.5 h-3.5" />
                                )}
                                Assign
                            </button>
                        </div>
                    ) : (
                        <div className="p-3 bg-gray-50 rounded-lg border border-gray-100 text-center">
                            <p className="text-sm text-gray-400 italic">No available numbers</p>
                            <a
                                href={`/client/${clientId}/phone-numbers`}
                                className="text-xs text-violet-600 hover:underline mt-1 inline-block"
                            >
                                Purchase a number first
                            </a>
                        </div>
                    )}
                    <p className="text-xs text-gray-500">
                        Assign a phone number to enable inbound calls and consistent outbound caller ID.
                    </p>
                </div>
            )}

            {error && (
                <p className="text-xs text-red-600">{error}</p>
            )}
        </div>
    );
}
