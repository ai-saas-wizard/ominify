"use client";

import { useEffect } from "react";

/**
 * Fires once on mount to clear the `omnify_tier` capture cookie. Mounted on
 * the subscribe page — by the time the user reaches it, their
 * `clients.pricing_tier_id` is already locked, so the cookie is no longer
 * needed and would otherwise leak into a different account on a shared
 * browser.
 */
export function ClearTierCookieOnMount() {
    useEffect(() => {
        fetch("/api/offers/clear-tier", { method: "POST" }).catch(() => {
            // Best-effort. Cookie expires on its own (max 30 days).
        });
    }, []);
    return null;
}
