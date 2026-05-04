// ═══════════════════════════════════════════════════════════
// CANONICAL APP URL
//
// Single source of truth for the public URL of this app. Used by:
// - VAPI assistant `server.url` (the webhook target)
// - VAPI tool `server.url` (calendar tools, transfer tools)
// - OAuth redirect URIs (Google Ads, Calendly, Stripe, etc.)
// - Twilio number webhooks
//
// Resolution order:
// 1. `NEXT_PUBLIC_APP_URL` env var (respected when explicitly set —
//    that's how local dev points at http://localhost:3000 via .env.local)
// 2. `VERCEL_URL` if running on a Vercel preview deployment
// 3. The production URL `https://app.omnifycrm.com` as the safe fallback
//
// We deliberately do NOT fall back to localhost in production. A baked-in
// localhost URL on a VAPI assistant is invisible until a real call comes
// in and the webhook silently fails — exactly the bug we just hit.
// ═══════════════════════════════════════════════════════════

const PRODUCTION_APP_URL = "https://app.omnifycrm.com";

export function getAppUrl(): string {
    if (process.env.NEXT_PUBLIC_APP_URL) {
        return process.env.NEXT_PUBLIC_APP_URL;
    }
    if (process.env.VERCEL_URL) {
        return `https://${process.env.VERCEL_URL}`;
    }
    return PRODUCTION_APP_URL;
}

/** The canonical production URL. Use this only when you specifically need
 *  the production URL regardless of env (e.g. links inside transactional
 *  emails sent from a preview deployment). Most code should use getAppUrl(). */
export const PRODUCTION_URL = PRODUCTION_APP_URL;
