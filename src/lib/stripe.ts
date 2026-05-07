import "server-only";
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
 * Handles case where customer ID exists but is invalid (e.g., test mode ID used with live keys)
 */
export async function getOrCreateStripeCustomer(
    clientId: string,
    email: string,
    name?: string
): Promise<string> {
    if (!stripe) throw new Error('Stripe not configured');

    const billing = await getOrCreateClientBilling(clientId);

    // If we have an existing customer ID, verify it's valid
    if (billing.stripe_customer_id) {
        try {
            // Try to retrieve the customer to verify it exists
            await stripe.customers.retrieve(billing.stripe_customer_id);
            return billing.stripe_customer_id;
        } catch (error: unknown) {
            // Customer doesn't exist (likely test mode ID with live keys)
            // Log and proceed to create a new customer
            console.warn(
                `Stripe customer ${billing.stripe_customer_id} not found, creating new customer for client ${clientId}`
            );
        }
    }

    // Create new Stripe customer
    const customer = await stripe.customers.create({
        email,
        name: name || undefined,
        metadata: { clientId }
    });

    // Save to database (this updates the old invalid ID with the new one)
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

/**
 * Create a Stripe Checkout session for a recurring subscription.
 *
 * Used by POST /api/stripe/subscribe. Attaches `clientId` + `plan_key` to both
 * the checkout session's metadata and the resulting subscription's metadata so
 * the webhook can resolve our client record reliably.
 */
export async function createSubscriptionCheckoutSession(
    clientId: string,
    email: string,
    priceId: string,
    planKey: string,
    successUrl: string,
    cancelUrl: string,
    name?: string
): Promise<{ sessionId: string; url: string }> {
    if (!stripe) throw new Error('Stripe not configured');
    if (!priceId) throw new Error('Stripe subscription price ID not configured');

    const customerId = await getOrCreateStripeCustomer(clientId, email, name);

    const session = await stripe.checkout.sessions.create({
        customer: customerId,
        mode: 'subscription',
        payment_method_types: ['card'],
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: successUrl,
        cancel_url: cancelUrl,
        subscription_data: {
            metadata: { clientId, plan_key: planKey },
        },
        metadata: { clientId, plan_key: planKey },
        allow_promotion_codes: true,
    });

    return { sessionId: session.id, url: session.url! };
}

/**
 * Wrap an existing live Subscription in a Subscription Schedule with
 * pre-defined phases. Used immediately after Checkout for multi-phase tiers
 * so Stripe handles the auto-transition between phases (e.g. 2 months at
 * $99 → forever at $379).
 *
 * Stripe's API requires this in two calls: `create({ from_subscription })`
 * mints a schedule wrapping the live sub with a single default phase; then
 * `update(id, { phases })` replaces that phase list with our multi-phase
 * journey. Calling them in one shot returns 400 — `from_subscription` and
 * `phases` are mutually exclusive.
 *
 * The webhook idempotency-guards this with `!sub.schedule` before calling,
 * but if Stripe redelivers and the create fails with "subscription already
 * has a schedule", the caller should treat that as success and skip.
 */
export async function convertSubscriptionToSchedule(args: {
    subscriptionId: string;
    phases: Array<{ stripe_price_id: string; duration_months: number | null }>;
    metadata: { clientId: string; plan_key: string };
}): Promise<Stripe.SubscriptionSchedule> {
    if (!stripe) throw new Error('Stripe not configured');

    // Step 1: wrap the live subscription. Stripe creates a schedule with a
    // single default phase mirroring the subscription's current item.
    // Idempotency: if the subscription is already wrapped (e.g. webhook
    // redelivery race), retrieve the existing schedule by re-reading the
    // subscription rather than failing.
    let schedule: Stripe.SubscriptionSchedule;
    try {
        schedule = await stripe.subscriptionSchedules.create({
            from_subscription: args.subscriptionId,
        });
    } catch (err) {
        const fresh = await stripe.subscriptions.retrieve(args.subscriptionId);
        const existingScheduleId =
            typeof fresh.schedule === 'string' ? fresh.schedule : fresh.schedule?.id;
        if (!existingScheduleId) throw err;
        schedule = await stripe.subscriptionSchedules.retrieve(existingScheduleId);
    }

    // Step 2: replace the default phase list with our explicit phases.
    // `duration: { interval, interval_count }` is the post-19.0.0 shape;
    // `iterations` was removed. The terminal phase has no duration so it
    // runs until the subscription is canceled.
    return stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release',
        metadata: args.metadata,
        phases: args.phases.map((p) => ({
            items: [{ price: p.stripe_price_id }],
            ...(p.duration_months
                ? {
                      duration: {
                          interval: 'month' as const,
                          interval_count: p.duration_months,
                      },
                  }
                : {}),
        })),
    });
}

/**
 * Create a Stripe Billing Portal session so the user can cancel, update card,
 * and view invoices. Portal behavior (e.g. immediate cancellation) is
 * configured in the Stripe Dashboard, not here.
 */
export async function createPortalSession(
    clientId: string,
    email: string,
    returnUrl: string,
    name?: string
): Promise<{ url: string }> {
    if (!stripe) throw new Error('Stripe not configured');

    const customerId = await getOrCreateStripeCustomer(clientId, email, name);

    const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: returnUrl,
    });

    return { url: session.url };
}
