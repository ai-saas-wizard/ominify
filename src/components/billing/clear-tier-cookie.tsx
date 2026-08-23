"use client";

import { useEffect } from "react";

/**
 * Fires once on mount to clear all offer capture cookies (omnify_visit,
 * omnify_preferred_tier, and the legacy omnify_tier). Mounted on the
 * subscribe page, by the time the customer reaches it, their
 * `clients.pricing_tier_id` or `signup_offer_id` is locked server-side, so
 * the cookies are no longer needed and would otherwise leak into a
 * different account on a shared browser.
 */
export function ClearTierCookieOnMount() {
    useEffect(() => {
        fetch("/api/offers/clear-tier", { method: "POST" }).catch(() => {
            // Best-effort. Cookie expires on its own (max 30 days).
        });
    }, []);
    return null;
}
