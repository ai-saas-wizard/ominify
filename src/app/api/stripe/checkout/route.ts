import { NextRequest, NextResponse } from 'next/server';
import { createCheckoutSession } from '@/lib/stripe';

export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { clientId, email, minutes, pricePerMinute, successUrl, cancelUrl } = body;

        if (!clientId || !email || !minutes || !pricePerMinute || !successUrl || !cancelUrl) {
            return NextResponse.json(
                { error: 'Missing required fields' },
                { status: 400 }
            );
        }

        if (minutes <= 0) {
            return NextResponse.json(
                { error: 'Minutes must be greater than 0' },
                { status: 400 }
            );
        }

        const session = await createCheckoutSession(
            clientId,
            email,
            minutes,
            pricePerMinute,
            successUrl,
            cancelUrl
        );

        return NextResponse.json({
            sessionId: session.sessionId,
            url: session.url
        });
    } catch (error: any) {
        console.error('Checkout error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to create checkout session' },
            { status: 500 }
        );
    }
}
