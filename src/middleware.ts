import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Public routes that don't require authentication
const isPublicRoute = createRouteMatcher([
    '/sign-in(.*)',
    '/sign-up(.*)',
    '/api/stripe/webhook',
    '/'
]);

// Admin routes
const isAdminRoute = createRouteMatcher(['/admin(.*)']);

// Client routes
const isClientRoute = createRouteMatcher(['/client/(.*)']);

export default clerkMiddleware(async (auth, req) => {
    const { userId, sessionClaims } = await auth();
    const url = req.nextUrl;
    const pathname = url.pathname;

    // Allow public routes
    if (isPublicRoute(req)) {
        return NextResponse.next();
    }

    // Redirect to sign-in if not authenticated
    if (!userId) {
        const signInUrl = new URL('/sign-in', req.url);
        signInUrl.searchParams.set('redirect_url', pathname);
        return NextResponse.redirect(signInUrl);
    }

    // Get user email from session claims
    const userEmail = (sessionClaims as any)?.email ||
        (sessionClaims as any)?.primary_email_address;

    // For admin routes, we'll check access in the page/layout level
    // This is because we can't do async DB calls in middleware easily
    // The middleware just ensures authentication

    // For client routes, extract the client ID and let the page handle authorization
    // The page will check if user has access to the specific client

    return NextResponse.next();
});

export const config = {
    matcher: [
        // Skip Next.js internals and static files
        "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
        // Always run for API routes
        "/(api|trpc)(.*)",
    ],
};
