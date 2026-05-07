import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { canAccessClient } from '@/lib/auth';
import { createSubscriptionCheckoutSession } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';
import { getTierForClient } from '@/lib/pricing-tiers';
import { hasActiveSubscription } from '@/lib/access';

/**
 * POST /api/stripe/subscribe
 * Body: { clientId: string }
 * Returns: { url: string }
 *
 * Creates a Stripe Checkout session (mode=subscription) for the caller's
 * client. The user is redirected to the returned URL on the client side.
 */
export async function POST(request: NextRequest) {
    try {
        const { userId } = await auth();
        if (!userId) return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

        const user = await currentUser();
        const email = user?.emailAddresses[0]?.emailAddress;
        if (!email) return NextResponse.json({ error: 'no_email' }, { status: 401 });

        const { clientId } = (await request.json()) as { clientId?: string };
        if (!clientId) return NextResponse.json({ error: 'missing_client' }, { status: 400 });

        const access = (await canAccessClient(email, clientId)) ||
            (await canAccessClient(userId, clientId));
        if (!access) return NextResponse.json({ error: 'forbidden' }, { status: 403 });

        // Idempotent — if already subscribed, send them back to the app.
        const subAccess = await hasActiveSubscription(clientId);
        if (subAccess.allowed) {
            return NextResponse.json({ error: 'already_active' }, { status: 409 });
        }

        // Resolve client name for nicer Stripe customer records.
        const { data: client } = await supabase
            .from('clients')
            .select('name')
            .eq('id', clientId)
            .single();

        // Pricing is server-resolved from clients.pricing_tier_id — never
        // trusts a value from the request body. This is the only place we
        // pick the Stripe price for the upcoming subscription.
        const tier = await getTierForClient(clientId);
        const priceId = tier.stripe_price_id;
        const planKey = tier.slug;
        if (!priceId) {
            return NextResponse.json(
                { error: `tier_missing_stripe_price:${tier.slug}` },
                { status: 500 }
            );
        }

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ||
            request.nextUrl.origin;
        const successUrl = `${appUrl}/client/${clientId}/subscribe/success?session_id={CHECKOUT_SESSION_ID}`;
        const cancelUrl = `${appUrl}/client/${clientId}/subscribe`;

        const session = await createSubscriptionCheckoutSession(
            clientId,
            email,
            priceId,
            planKey,
            successUrl,
            cancelUrl,
            client?.name
        );

        return NextResponse.json({ url: session.url });
    } catch (err: any) {
        console.error('[subscribe] error:', err?.message || err);
        return NextResponse.json(
            { error: err?.message || 'failed_to_create_session' },
            { status: 500 }
        );
    }
}
