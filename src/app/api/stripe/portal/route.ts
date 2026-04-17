import { NextRequest, NextResponse } from 'next/server';
import { auth, currentUser } from '@clerk/nextjs/server';
import { canAccessClient } from '@/lib/auth';
import { createPortalSession } from '@/lib/stripe';
import { supabase } from '@/lib/supabase';

/**
 * POST /api/stripe/portal
 * Body: { clientId: string }
 * Returns: { url: string }
 *
 * Opens the Stripe hosted Customer Portal so the user can cancel their
 * subscription, update their payment method, or view invoices. Cancellation
 * mode (immediate vs period-end) is configured in the Stripe Dashboard.
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

        const { data: client } = await supabase
            .from('clients')
            .select('name')
            .eq('id', clientId)
            .single();

        const appUrl = process.env.NEXT_PUBLIC_APP_URL ||
            request.nextUrl.origin;
        const returnUrl = `${appUrl}/client/${clientId}/billing`;

        const session = await createPortalSession(clientId, email, returnUrl, client?.name);
        return NextResponse.json({ url: session.url });
    } catch (err: any) {
        console.error('[portal] error:', err?.message || err);
        return NextResponse.json(
            { error: err?.message || 'failed_to_create_portal' },
            { status: 500 }
        );
    }
}
