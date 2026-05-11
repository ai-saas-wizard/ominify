"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, X, RotateCcw } from "lucide-react";
import { assignClientPlanAction } from "@/app/actions/admin-actions";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export interface TierOption {
    id: string;
    slug: string;
    display_name: string;
    /** Compact price label e.g. "$99 → $249 (2mo intro)" or "$479/mo" */
    price_label: string;
}

export interface OfferOption {
    id: string;
    slug: string;
    name: string;
    tier_count: number;
}

interface Props {
    client: {
        id: string;
        name: string | null;
        pricing_tier_id: string | null;
        signup_offer_id: string | null;
        subscription_status: string | null;
    };
    tiers: TierOption[];
    offers: OfferOption[];
}

/**
 * Admin modal to retag a client's pricing tier OR offer. Three tabs:
 * - Assign tier directly (locks pricing_tier_id, customer sees single-tier subscribe)
 * - Assign offer (clears tier, sets signup_offer_id, customer sees picker)
 * - Clear (clears both, customer falls back to public tier)
 *
 * Warns when the client has an active Stripe subscription — the change
 * is DB-only and won't affect what Stripe charges them.
 */
export function ChangePlanModal({ client, tiers, offers }: Props) {
    const router = useRouter();
    const [open, setOpen] = useState(false);
    const [pending, startTransition] = useTransition();
    const [error, setError] = useState<string | null>(null);
    const [selectedTier, setSelectedTier] = useState<string>(
        client.pricing_tier_id ?? ""
    );
    const [selectedOffer, setSelectedOffer] = useState<string>(
        client.signup_offer_id ?? ""
    );
    const [tab, setTab] = useState<string>(
        client.signup_offer_id ? "offer" : "tier"
    );

    const isSubscribed =
        client.subscription_status === "active" ||
        client.subscription_status === "trialing" ||
        client.subscription_status === "past_due" ||
        client.subscription_status === "admin_granted";

    function submit(kind: "tier" | "offer" | "clear") {
        setError(null);
        const formData = new FormData();
        formData.set("client_id", client.id);
        formData.set("kind", kind);
        if (kind === "tier") {
            if (!selectedTier) {
                setError("Pick a tier first.");
                return;
            }
            formData.set("tier_id", selectedTier);
        } else if (kind === "offer") {
            if (!selectedOffer) {
                setError("Pick an offer first.");
                return;
            }
            formData.set("offer_id", selectedOffer);
        }

        startTransition(async () => {
            const res = await assignClientPlanAction(formData);
            if (!res.ok) {
                setError(res.error);
                return;
            }
            setOpen(false);
            router.refresh();
        });
    }

    return (
        <>
            <button
                type="button"
                onClick={() => setOpen(true)}
                className="text-[10px] text-emerald-700 hover:text-emerald-800 underline underline-offset-2"
            >
                change plan
            </button>

            {open && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
                    onClick={() => !pending && setOpen(false)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between p-5 border-b border-gray-100">
                            <div>
                                <h2 className="text-lg font-semibold text-gray-900">Change plan</h2>
                                <p className="text-xs text-gray-500 mt-0.5">
                                    {client.name ?? "—"} ({client.id.slice(0, 8)}…)
                                </p>
                            </div>
                            <button
                                type="button"
                                onClick={() => !pending && setOpen(false)}
                                className="text-gray-400 hover:text-gray-700"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="p-5 space-y-4">
                            {isSubscribed && (
                                <div className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg p-3">
                                    <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                                    <div>
                                        <p className="font-semibold">
                                            This client has an active Stripe subscription.
                                        </p>
                                        <p className="mt-1">
                                            Changing the plan here updates what they see in our system,
                                            but Stripe will keep charging the original price until they
                                            cancel and resubscribe.
                                        </p>
                                    </div>
                                </div>
                            )}

                            <Tabs value={tab} onValueChange={setTab}>
                                <TabsList className="w-full grid grid-cols-3">
                                    <TabsTrigger value="tier">Assign tier</TabsTrigger>
                                    <TabsTrigger value="offer">Assign offer</TabsTrigger>
                                    <TabsTrigger value="clear">Clear</TabsTrigger>
                                </TabsList>

                                {/* Tier tab */}
                                <TabsContent value="tier" className="mt-4 space-y-2">
                                    <p className="text-xs text-gray-500">
                                        Locks the client to a specific tier. They&apos;ll see the
                                        single-tier subscribe page → Stripe Checkout.
                                    </p>
                                    <div className="max-h-72 overflow-y-auto space-y-1.5 border border-gray-200 rounded-lg p-2">
                                        {tiers.length === 0 ? (
                                            <p className="text-xs text-gray-400 text-center py-4">
                                                No active tiers.
                                            </p>
                                        ) : (
                                            tiers.map((tier) => {
                                                const isCurrent = client.pricing_tier_id === tier.id;
                                                const isSelected = selectedTier === tier.id;
                                                return (
                                                    <label
                                                        key={tier.id}
                                                        className={`flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors ${
                                                            isSelected
                                                                ? "bg-emerald-50 border border-emerald-200"
                                                                : "hover:bg-gray-50 border border-transparent"
                                                        }`}
                                                    >
                                                        <input
                                                            type="radio"
                                                            name="tier_choice"
                                                            checked={isSelected}
                                                            onChange={() => setSelectedTier(tier.id)}
                                                            className="text-emerald-600"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-medium text-gray-900">
                                                                    {tier.display_name}
                                                                </span>
                                                                {isCurrent && (
                                                                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                                                                        CURRENT
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-xs text-gray-500 mt-0.5">
                                                                {tier.price_label}{" "}
                                                                <span className="text-gray-400">
                                                                    · {tier.slug}
                                                                </span>
                                                            </p>
                                                        </div>
                                                    </label>
                                                );
                                            })
                                        )}
                                    </div>
                                    <div className="flex justify-end pt-2">
                                        <button
                                            type="button"
                                            onClick={() => submit("tier")}
                                            disabled={pending || !selectedTier}
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Check className="w-4 h-4" />
                                            {pending ? "Saving…" : "Assign tier"}
                                        </button>
                                    </div>
                                </TabsContent>

                                {/* Offer tab */}
                                <TabsContent value="offer" className="mt-4 space-y-2">
                                    <p className="text-xs text-gray-500">
                                        Clears the tier and lets the client pick from the offer&apos;s
                                        tiers on their subscribe page.
                                    </p>
                                    <div className="max-h-72 overflow-y-auto space-y-1.5 border border-gray-200 rounded-lg p-2">
                                        {offers.length === 0 ? (
                                            <p className="text-xs text-gray-400 text-center py-4">
                                                No active offers.
                                            </p>
                                        ) : (
                                            offers.map((offer) => {
                                                const isCurrent = client.signup_offer_id === offer.id;
                                                const isSelected = selectedOffer === offer.id;
                                                return (
                                                    <label
                                                        key={offer.id}
                                                        className={`flex items-center gap-3 p-2.5 rounded-md cursor-pointer transition-colors ${
                                                            isSelected
                                                                ? "bg-emerald-50 border border-emerald-200"
                                                                : "hover:bg-gray-50 border border-transparent"
                                                        }`}
                                                    >
                                                        <input
                                                            type="radio"
                                                            name="offer_choice"
                                                            checked={isSelected}
                                                            onChange={() => setSelectedOffer(offer.id)}
                                                            className="text-emerald-600"
                                                        />
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2">
                                                                <span className="text-sm font-medium text-gray-900">
                                                                    {offer.name}
                                                                </span>
                                                                {isCurrent && (
                                                                    <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded">
                                                                        CURRENT
                                                                    </span>
                                                                )}
                                                            </div>
                                                            <p className="text-xs text-gray-500 mt-0.5">
                                                                {offer.tier_count} tier
                                                                {offer.tier_count === 1 ? "" : "s"}{" "}
                                                                <span className="text-gray-400">
                                                                    · {offer.slug}
                                                                </span>
                                                            </p>
                                                        </div>
                                                    </label>
                                                );
                                            })
                                        )}
                                    </div>
                                    <div className="flex justify-end pt-2">
                                        <button
                                            type="button"
                                            onClick={() => submit("offer")}
                                            disabled={pending || !selectedOffer}
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            <Check className="w-4 h-4" />
                                            {pending ? "Saving…" : "Assign offer"}
                                        </button>
                                    </div>
                                </TabsContent>

                                {/* Clear tab */}
                                <TabsContent value="clear" className="mt-4 space-y-3">
                                    <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3">
                                        <p className="font-semibold text-gray-800 mb-1">
                                            Reset to default
                                        </p>
                                        <p>
                                            The customer&apos;s subscribe page will show the public-tier
                                            price. Their previous offer/tier assignment will be cleared
                                            from our DB. Any existing Stripe subscription stays
                                            unchanged.
                                        </p>
                                    </div>
                                    <div className="flex justify-end">
                                        <button
                                            type="button"
                                            onClick={() => submit("clear")}
                                            disabled={pending}
                                            className="inline-flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50"
                                        >
                                            <RotateCcw className="w-4 h-4" />
                                            {pending ? "Clearing…" : "Clear assignment"}
                                        </button>
                                    </div>
                                </TabsContent>
                            </Tabs>

                            {error && (
                                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded p-2">
                                    {error}
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
}
