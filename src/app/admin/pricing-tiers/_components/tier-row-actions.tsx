"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Pencil, Power, Trash2, Check } from "lucide-react";
import { toggleTierActiveAction, deleteTierAction } from "../actions";

export function TierRowActions({
    tierId,
    isActive,
    offerUrl,
}: {
    tierId: string;
    isActive: boolean;
    offerUrl: string;
}) {
    const router = useRouter();
    const [copied, setCopied] = useState(false);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function handleCopy() {
        navigator.clipboard.writeText(offerUrl).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
        });
    }

    function handleToggle() {
        setError(null);
        startTransition(async () => {
            const r = await toggleTierActiveAction(tierId);
            if (!r.ok) setError(r.error);
            else router.refresh();
        });
    }

    function handleDelete() {
        if (!confirm("Delete this tier? Cannot be undone.")) return;
        setError(null);
        startTransition(async () => {
            const r = await deleteTierAction(tierId);
            if (!r.ok) setError(r.error);
            else router.refresh();
        });
    }

    return (
        <div className="flex items-center gap-1">
            <button
                type="button"
                onClick={handleCopy}
                title="Copy campaign URL"
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
                {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            </button>
            <Link
                href={`/admin/pricing-tiers/${tierId}/edit`}
                title="Edit"
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors"
            >
                <Pencil className="w-4 h-4" />
            </Link>
            <button
                type="button"
                onClick={handleToggle}
                disabled={pending}
                title={isActive ? "Deactivate" : "Activate"}
                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded transition-colors disabled:opacity-50"
            >
                <Power className={`w-4 h-4 ${isActive ? "text-emerald-600" : ""}`} />
            </button>
            <button
                type="button"
                onClick={handleDelete}
                disabled={pending}
                title="Delete"
                className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors disabled:opacity-50"
            >
                <Trash2 className="w-4 h-4" />
            </button>
            {error && <span className="ml-2 text-xs text-red-600">{error}</span>}
        </div>
    );
}
