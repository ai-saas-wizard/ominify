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
    '/api/integrations/google-calendar/callback',
    '/api/offers/clear-tier',
    '/'
]);

// Slug shape: alphanumeric, dash, underscore; 1-64 chars. Anything outside
// this gets ignored (no cookie set), preventing weird path injection.
const VALID_SLUG = /^[a-zA-Z0-9_-]{1,64}$/;

export default clerkMiddleware(async (auth, req) => {
    const { userId, sessionClaims } = await auth();
    const url = req.nextUrl;
    const pathname = url.pathname;

    // Forward the current pathname to server components/layouts so they can
    // route-gate (e.g. paywall allowlist).
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set('x-pathname', pathname);

    // Tier capture: visitors landing on /offers/<slug> get tagged with that
    // slug via a 30-day HttpOnly cookie. Auto-provision reads this cookie at
    // signup time. Slug validity (does it exist? is it active?) is checked at
    // signup time, not here — middleware just stores the value cheaply.
    const offersMatch = pathname.match(/^\/offers\/([^\/]+)\/?$/);
    if (offersMatch && VALID_SLUG.test(offersMatch[1])) {
        const response = NextResponse.next({ request: { headers: requestHeaders } });
        response.cookies.set('omnify_tier', offersMatch[1], {
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
