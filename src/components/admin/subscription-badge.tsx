"use client";

import { useTransition } from "react";
import { toggleClientGrandfather } from "@/app/actions/admin-actions";
import { Badge } from "@/components/ui/badge";

interface Props {
    clientId: string;
    accountType: string;
    grandfathered: boolean;
    subscriptionStatus: string | null;
    /** True when client has signup_offer_id set but no pricing_tier_id and no live sub. */
    pickerPending?: boolean;
    /** True when pricing_tier_id is set but no live subscription has been paid yet. */
    awaitingPayment?: boolean;
}

/**
 * Admin-facing subscription status badge with a right-click / button toggle
 * for the grandfather flag. Keeps the surface area small — one tap, one
 * audit-logged DB write.
 */
export function SubscriptionBadge({
    clientId,
    accountType,
    grandfathered,
    subscriptionStatus,
    pickerPending = false,
    awaitingPayment = false,
}: Props) {
    const [pending, startTransition] = useTransition();

    // Resolution order matters — grandfathered + CUSTOM short-circuit; live
    // Stripe statuses come next; the new local-state flags (picker pending,
    // awaiting payment) are last because they're only meaningful when there
    // is NO live subscription.
    const { label, color } = (() => {
        if (grandfathered)
            return { label: "GRANDFATHERED", color: "bg-blue-100 text-blue-700 border-blue-200" };
        if (accountType === "CUSTOM")
            return { label: "CUSTOM (no sub)", color: "bg-purple-100 text-purple-700 border-purple-200" };
        if (subscriptionStatus === "active" || subscriptionStatus === "trialing")
            return { label: "SUB ACTIVE", color: "bg-green-100 text-green-700 border-green-200" };
        if (subscriptionStatus === "admin_granted")
            return { label: "COMP'D", color: "bg-blue-100 text-blue-700 border-blue-200" };
        if (subscriptionStatus === "past_due")
            return { label: "PAST DUE", color: "bg-amber-100 text-amber-700 border-amber-200" };
        if (subscriptionStatus === "canceled")
            return { label: "CANCELED", color: "bg-red-100 text-red-700 border-red-200" };
        if (pickerPending)
            return { label: "PICKER PENDING", color: "bg-amber-100 text-amber-700 border-amber-200" };
        if (awaitingPayment)
            return { label: "AWAITING PAYMENT", color: "bg-indigo-100 text-indigo-700 border-indigo-200" };
        return { label: "NOT SUBSCRIBED", color: "bg-gray-100 text-gray-700 border-gray-200" };
    })();

    return (
        <div className="flex items-center gap-1">
            <Badge className={`text-[10px] px-1.5 py-0 ${color}`}>{label}</Badge>
            <button
                type="button"
                title={grandfathered ? "Revoke grandfather" : "Grandfather this client"}
                disabled={pending}
                onClick={() =>
                    startTransition(async () => {
                        await toggleClientGrandfather(clientId, !grandfathered);
                    })
                }
                className="text-[10px] text-gray-400 hover:text-gray-700 underline disabled:opacity-40"
            >
                {pending ? "…" : grandfathered ? "revoke" : "grant"}
            </button>
        </div>
    );
}
