import Stripe from 'stripe';
import { getOrCreateClientBilling, createPurchaseRecord } from './billing';
import { supabase } from './supabase';

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;

export const stripe = stripeSecretKey
    ? new Stripe(stripeSecretKey, { apiVersion: '2025-12-15.clover' })
    : null;

/**
 * Get or create a Stripe customer for a client
 */
export async function getOrCreateStripeCustomer(
    clientId: string,
    email: string,
    name?: string
): Promise<string> {
    if (!stripe) throw new Error('Stripe not configured');

    const billing = await getOrCreateClientBilling(clientId);

    // Return existing customer if we have one
    if (billing.stripe_customer_id) {
        return billing.stripe_customer_id;
    }

    // Create new Stripe customer
    const customer = await stripe.customers.create({
        email,
        name: name || undefined,
        metadata: { clientId }
    });

    // Save to database
    await supabase
        .from('client_billing')
        .update({ stripe_customer_id: customer.id })
        .eq('client_id', clientId);

    return customer.id;
}

/**
 * Create a Stripe Checkout session for purchasing custom minutes
 */
export async function createCheckoutSession(
    clientId: string,
    email: string,
    minutes: number,
    pricePerMinute: number,
    successUrl: string,
    cancelUrl: string
): Promise<{ sessionId: string; url: string }> {
    if (!stripe) throw new Error('Stripe not configured');

    const totalPrice = minutes * pricePerMinute;

    // Get or create customer
    const customerId = await getOrCreateStripeCustomer(clientId, email);

    // Create checkout session
    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ['card'],
        line_items: [
            {
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: `${minutes} Voice Minutes`,
                        description: `Voice agent calling minutes at $${pricePerMinute.toFixed(2)}/min`,
                    },
                    unit_amount: Math.round(totalPrice * 100), // Stripe uses cents
                },
                quantity: 1,
            },
        ],
        mode: 'payment',
        success_url: successUrl,
        cancel_url: cancelUrl,
        metadata: {
            clientId,
            minutes: minutes.toString(),
            pricePerMinute: pricePerMinute.toString(),
        },
    });

    // Create pending purchase record
    await createPurchaseRecord(
        clientId,
        minutes,
        totalPrice,
        session.id
    );

    return {
        sessionId: session.id,
        url: session.url!
    };
}

/**
 * Verify Stripe webhook signature
 */
export function constructWebhookEvent(
    payload: string | Buffer,
    signature: string
): Stripe.Event {
    if (!stripe) throw new Error('Stripe not configured');

    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!webhookSecret) throw new Error('Webhook secret not configured');

    return stripe.webhooks.constructEvent(payload, signature, webhookSecret);
}
