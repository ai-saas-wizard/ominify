"use client";

import { useState } from "react";
import { toggleClientDisabled } from "@/app/actions/client-actions";
import { Ban, CheckCircle2 } from "lucide-react";

export function DisableClientButton({
    clientId,
    disabled,
}: {
    clientId: string;
    disabled: boolean;
}) {
    const [loading, setLoading] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);

    async function handleToggle() {
        setLoading(true);
        try {
            await toggleClientDisabled(clientId, !disabled);
        } catch (err) {
            console.error("Failed to toggle client:", err);
        } finally {
            setLoading(false);
            setShowConfirm(false);
        }
    }

    if (showConfirm) {
        return (
            <div className="flex items-center gap-1.5">
                <span className="text-xs text-gray-500">
                    {disabled ? "Enable?" : "Disable?"}
                </span>
                <button
                    onClick={handleToggle}
                    disabled={loading}
                    className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-700 hover:bg-red-200 disabled:opacity-50"
                >
                    {loading ? "..." : "Confirm"}
                </button>
                <button
                    onClick={() => setShowConfirm(false)}
                    className="text-xs font-medium px-2 py-0.5 rounded bg-gray-100 text-gray-600 hover:bg-gray-200"
                >
                    Cancel
                </button>
            </div>
        );
    }

    if (disabled) {
        return (
            <button
                onClick={() => setShowConfirm(true)}
                className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md bg-green-50 text-green-700 hover:bg-green-100 transition-colors"
                title="Enable this client"
            >
                <CheckCircle2 className="w-3.5 h-3.5" />
                Enable
            </button>
        );
    }

    return (
        <button
            onClick={() => setShowConfirm(true)}
            className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md bg-red-50 text-red-600 hover:bg-red-100 transition-colors"
            title="Disable this client"
        >
            <Ban className="w-3.5 h-3.5" />
            Disable
        </button>
    );
}
