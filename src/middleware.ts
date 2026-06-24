import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { hasActiveSubscriptionEdge, isAdminEdge } from "@/lib/access-edge";

// Public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/legal/(.*)',
    '/walkthrough-realestate',
    '/offers/(.*)',
    '/api/stripe/webhook',
    '/api/webhooks/vapi',
    '/api/vapi/tools/(.*)',
    '/api/client/(.*)/leads',
    // Internal MCP / admin programmatic surface. Bypasses Clerk so the route
    // handlers can enforce the MCP_ADMIN_TOKEN bearer check themselves
    // (same pattern as the leads endpoint above).
    '/api/admin/mcp/(.*)',
    '/api/integrations/google-calendar/callback',
    '/api/offers/clear-tier',
    '/'
]);

export default clerkMiddleware(async (auth, req) => {
    const { userId, sessionClaims } = await auth();
    const url = req.nextUrl;
    const pathname = url.pathname;

    // Forward the current pathname to server components/layouts so they can
    // route-gate (e.g. paywall allowlist).
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-pathname', pathname);

    // Visit capture: every /offers/<slug> visit gets an `omnify_visit`
    // cookie carrying that slug verbatim. The slug may be either a tier or
    // an offer — disambiguation happens at signup time via
    // `resolveOfferOrTier` in src/lib/visit-resolution.ts. If it resolves to
    // an offer, autoProvision sets clients.signup_offer_id (deferring the
    // tier pick to the post-signup picker on /client/<id>/subscribe). If it
    // resolves to a tier, pricing_tier_id is set directly. If it resolves
    // to neither, the customer falls back to the public tier.
    const offersMatch = pathname.match(/^\/offers\/([^\/]+)\/?$/);
    if (offersMatch && /^[a-zA-Z0-9_-]{1,64}$/.test(offersMatch[1])) {
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        response.cookies.set('omnify_visit', offersMatch[1], {
            httpOnly: true,
            sameSite: 'lax',
            path: '/',
            maxAge: 60 * 60 * 24 * 30, // 30 days
            secure: process.env.NODE_ENV === 'production',
        });
        return response;
    }

    // Allow public routes
    if (isPublicRoute(req)) {
        return NextResponse.next({ request: { headers: requestHeaders } });
    }

    // Redirect to sign-in if not authenticated
    if (!userId) {
        const signInUrl = new URL('/sign-in', req.url);
        signInUrl.searchParams.set('redirect_url', pathname);
        return NextResponse.redirect(signInUrl);
    }

    // ── Paywall gate for /client/[clientId]/* routes ─────────────────────────
    // Runs in middleware so it fires on EVERY request (including client-side
    // navigation), which is stronger than a parent-layout check that Next.js
    // skips when the segment boundary doesn't change.
    const clientMatch = pathname.match(/^\/client\/([^\/]+)/);
    if (clientMatch) {
        const clientId = clientMatch[1];

        // Allowlist the subscribe flow + billing (so users can re-subscribe
        // after cancel) and any client-scoped API endpoints that need to work
        // pre-subscription (Stripe callbacks, etc.).
        const allow = [
            `/client/${clientId}/subscribe`,
            `/client/${clientId}/billing`,
        ];
        const onAllowed =
            allow.some((p) => pathname === p || pathname.startsWith(p + '/')) ||
            pathname.startsWith('/api/');

        if (!onAllowed) {
            const userEmail =
                (sessionClaims as any)?.email ||
                (sessionClaims as any)?.primary_email_address ||
                null;

            try {
                // Admins bypass so they can help/debug any client.
                const admin = await isAdminEdge(userEmail, userId);
                if (!admin) {
                    const access = await hasActiveSubscriptionEdge(clientId);
                    if (!access.allowed && access.reason !== 'client_not_found') {
                        const subscribeUrl = new URL(
                            `/client/${clientId}/subscribe`,
                            req.url
                        );
                        return NextResponse.redirect(subscribeUrl);
                    }
                }
            } catch (err) {
                // Fail-open on infra errors — the layout/page-level gates
                // catch these on initial load. Middleware failing closed
                // would be a bigger footgun than failing open.
                console.error('[middleware] paywall check failed:', err);
            }
        }
    }

    return NextResponse.next({ request: { headers: requestHeaders } });
});

export const config = {
    matcher: [
        // Skip Next.js internals and static files
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
        // Always run for API routes
        "/(api|trpc)(.*)",
    ],
};
