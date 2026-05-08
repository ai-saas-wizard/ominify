"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUp, ArrowDown, X, Sparkles } from "lucide-react";
import {
    moveTierInOfferAction,
    removeTierFromOfferAction,
} from "../actions";

export interface AssignedTier {
    id: string;
    slug: string;
    display_name: string;
    price_label: string;
    is_recommended: boolean;
    sort_order: number;
}

export function OfferTiersManager({ tiers }: { tiers: AssignedTier[] }) {
    const router = useRouter();
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);

    function move(tierId: string, direction: "up" | "down") {
        setError(null);
        startTransition(async () => {
            const r = await moveTierInOfferAction(tierId, direction);
            if (!r.ok) setError(r.error);
            else router.refresh();
        });
    }

    function remove(tierId: string) {
        if (!confirm("Remove this tier from the offer? The tier itself stays — only its assignment is cleared.")) return;
        setError(null);
        startTransition(async () => {
            const r = await removeTierFromOfferAction(tierId);
            if (!r.ok) setError(r.error);
            else router.refresh();
        });
    }

    return (
        <div className="space-y-3">
            <h2 className="text-base font-semibold text-gray-900">Tiers in this offer</h2>

            {tiers.length === 0 ? (
                <div className="text-sm text-gray-500 bg-gray-50 border border-gray-200 rounded-lg p-4">
                    No tiers assigned yet. Create or edit a tier at{" "}
                    <Link href="/admin/pricing-tiers" className="text-emerald-700 underline">
                        Pricing Tiers
                    </Link>{" "}
                    and set its Offer dropdown to this one.
                </div>
            ) : (
                <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100">
                    {tiers.map((t, i) => (
                        <li key={t.id} className="px-4 py-3 flex items-center gap-3">
                            <div className="flex flex-col items-center gap-0.5">
                                <button
                                    type="button"
                                    onClick={() => move(t.id, "up")}
                                    disabled={pending || i === 0}
                                    className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Move up"
                                >
                                    <ArrowUp className="w-4 h-4" />
                                </button>
                                <button
                                    type="button"
                                    onClick={() => move(t.id, "down")}
                                    disabled={pending || i === tiers.length - 1}
                                    className="p-0.5 text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed"
                                    title="Move down"
                                >
                                    <ArrowDown className="w-4 h-4" />
                                </button>
                            </div>
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <Link
                                        href={`/admin/pricing-tiers/${t.id}/edit`}
                                        className="font-medium text-gray-900 hover:underline truncate"
                                    >
                                        {t.display_name}
                                    </Link>
                                    {t.is_recommended && (
                                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-700 bg-amber-50 px-2 py-0.5 rounded uppercase tracking-wide">
                                            <Sparkles className="w-3 h-3" /> Featured
                                        </span>
                                    )}
                                </div>
                                <div className="text-xs text-gray-500">
                                    <code>{t.slug}</code> · {t.price_label}
                                </div>
                            </div>
                            <button
                                type="button"
                                onClick={() => remove(t.id)}
                                disabled={pending}
                                title="Remove from offer"
                                className="p-1.5 text-gray-400 hover:text-red-600 rounded disabled:opacity-50"
                            >
                                <X className="w-4 h-4" />
                            </button>
                        </li>
                    ))}
                </ul>
            )}

            <p className="text-xs text-gray-500">
                To add a tier, edit one at{" "}
                <Link href="/admin/pricing-tiers" className="text-emerald-700 underline">
                    /admin/pricing-tiers
                </Link>{" "}
                and set its Offer dropdown.
            </p>

            {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
    );
}
