import { NextRequest, NextResponse } from 'next/server';
import { constructWebhookEvent, stripe } from '@/lib/stripe';
import { completePurchase } from '@/lib/billing';
import Stripe from 'stripe';

export async function POST(request: NextRequest) {
    const payload = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
        return NextResponse.json(
            { error: 'Missing Stripe signature' },
            { status: 400 }
        );
    }

    let event: Stripe.Event;

    try {
        event = constructWebhookEvent(payload, signature);
    } catch (error: any) {
        console.error('Webhook signature verification failed:', error.message);
        return NextResponse.json(
            { error: 'Invalid signature' },
            { status: 400 }
        );
    }

    // Handle the event
    switch (event.type) {
        case 'checkout.session.completed': {
            const session = event.data.object as Stripe.Checkout.Session;

            console.log('Checkout session completed:', session.id);
            console.log('Metadata:', session.metadata);

            // Complete the purchase and add minutes
            try {
                const purchase = await completePurchase(
                    session.id,
                    session.payment_intent as string
                );

                if (purchase) {
                    console.log(`Added ${purchase.minutes_purchased} minutes for client ${purchase.client_id}`);
                } else {
                    console.warn('Purchase record not found for session:', session.id);
                }
            } catch (error: any) {
                console.error('Error completing purchase:', error.message);
            }
            break;
        }

        case 'payment_intent.payment_failed': {
            const paymentIntent = event.data.object as Stripe.PaymentIntent;
            console.log('Payment failed:', paymentIntent.id);
            // Could update purchase status to 'failed' here
            break;
        }

        default:
            console.log('Unhandled event type:', event.type);
    }

    return NextResponse.json({ received: true });
}
