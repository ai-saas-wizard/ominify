import { NextRequest, NextResponse } from 'next/server';
import { constructWebhookEvent, stripe } from '@/lib/stripe';
import { completePurchase } from '@/lib/billing';
import {
    grantSubscriptionMinutes,
    markSubscriptionCanceled,
    resolveClientFromStripeIds,
    upsertSubscription,
} from '@/lib/subscriptions';
import { getPublicTier, getTierBySlug } from '@/lib/pricing-tiers';
import Stripe from 'stripe';

/**
 * Stripe webhook entry point.
 *
 * Handles three distinct flows:
 *   1. One-time minute top-ups (mode=payment)       → completePurchase()
 *   2. Subscription lifecycle events                → upsert/cancel rows
 *   3. Subscription invoice paid (initial+renewal)  → grant monthly minutes
 *
 * Every branch is idempotent: minute grants are keyed by stripe_invoice_id
 * via a unique index, and subscription upserts are keyed by subscription id.
 */
export async function POST(request: NextRequest) {
    const payload = await request.text();
    const signature = request.headers.get('stripe-signature');

    if (!signature) {
        return NextResponse.json({ error: 'Missing Stripe signature' }, { status: 400 });
    }

    let event: Stripe.Event;
    try {
        event = constructWebhookEvent(payload, signature);
    } catch (error: any) {
        console.error('Webhook signature verification failed:', error.message);
        return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
    }

    try {
        switch (event.type) {
            case 'checkout.session.completed': {
                const session = event.data.object as Stripe.Checkout.Session;

                if (session.mode === 'payment') {
                    // Existing one-time minute top-up flow
                    const purchase = await completePurchase(
                        session.id,
                        session.payment_intent as string
                    );
                    if (purchase) {
                        console.log(
                            `[Stripe] Top-up completed: +${purchase.minutes_purchased}min for ${purchase.client_id}`
                        );
                    } else {
                        console.warn('[Stripe] No purchase row for session:', session.id);
                    }
                } else if (session.mode === 'subscription') {
                    // Authoritative signals for subs come from subscription.* +
                    // invoice.paid events. This is a log-only breadcrumb.
                    console.log(
                        `[Stripe] Subscription checkout completed: ${session.id} (sub=${session.subscription})`
                    );
                }
                break;
            }

            case 'customer.subscription.created':
            case 'customer.subscription.updated': {
                const sub = event.data.object as Stripe.Subscription;
                const clientId = await resolveClientFromStripeIds({
                    clientIdFromMetadata:
                        (sub.metadata?.clientId as string | undefined) ?? null,
                    stripeCustomerId:
                        typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
                });
                if (!clientId) {
                    console.warn(
                        `[Stripe] ${event.type} — could not resolve clientId for sub ${sub.id}`
                    );
                    break;
                }
                const planKey =
                    (sub.metadata?.plan_key as string | undefined) ||
                    (await getPublicTier()).slug;
                await upsertSubscription(sub, clientId, planKey);
                console.log(
                    `[Stripe] ${event.type}: sub=${sub.id} client=${clientId} status=${sub.status}`
                );
                break;
            }

            case 'customer.subscription.deleted': {
                const sub = event.data.object as Stripe.Subscription;
                await markSubscriptionCanceled(sub.id);
                console.log(`[Stripe] Subscription canceled: ${sub.id}`);
                break;
            }

            case 'invoice.paid': {
                const invoice = event.data.object as Stripe.Invoice;

                const invoiceAny = invoice as unknown as {
                    subscription?: string | Stripe.Subscription | null;
                    billing_reason?: string | null;
                };
                const billingReason = invoiceAny.billing_reason;

                // Only grant minutes for subscription invoices (initial + renewals).
                if (
                    billingReason !== 'subscription_create' &&
                    billingReason !== 'subscription_cycle' &&
                    billingReason !== 'subscription_update'
                ) {
                    break;
                }

                const subscriptionIdRaw = invoiceAny.subscription;
                const subscriptionId =
                    typeof subscriptionIdRaw === 'string'
                        ? subscriptionIdRaw
                        : subscriptionIdRaw?.id ?? null;

                // Pull metadata from the subscription to resolve clientId + plan.
                let clientId: string | null = null;
                let planKey: string = (await getPublicTier()).slug;

                if (subscriptionId && stripe) {
                    const sub = await stripe.subscriptions.retrieve(subscriptionId);
                    clientId = await resolveClientFromStripeIds({
                        clientIdFromMetadata:
                            (sub.metadata?.clientId as string | undefined) ?? null,
                        stripeCustomerId:
                            typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
                    });
                    planKey =
                        (sub.metadata?.plan_key as string | undefined) || planKey;

                    // Keep our subscriptions row fresh on every invoice.
                    if (clientId) await upsertSubscription(sub, clientId, planKey);
                }

                if (!clientId) {
                    clientId = await resolveClientFromStripeIds({
                        clientIdFromMetadata: null,
                        stripeCustomerId:
                            typeof invoice.customer === 'string'
                                ? invoice.customer
                                : invoice.customer?.id,
                    });
                }

                if (!clientId) {
                    console.warn(`[Stripe] invoice.paid — unresolved client for ${invoice.id}`);
                    break;
                }

                const tier = (await getTierBySlug(planKey, { onlyActive: false })) ??
                    (await getPublicTier());
                const amountPaid = (invoice.amount_paid ?? 0) / 100;

                const result = await grantSubscriptionMinutes({
                    clientId,
                    minutes: tier.monthly_minutes,
                    rolloverCap: tier.rollover_cap,
                    stripeInvoiceId: invoice.id ?? null,
                    amountPaid,
                });

                if (result === null) {
                    console.log(`[Stripe] invoice.paid ${invoice.id} — already granted (idempotent skip)`);
                } else {
                    console.log(
                        `[Stripe] invoice.paid ${invoice.id} — granted ${result.granted}min, trimmed ${result.trimmed}min for client ${clientId}`
                    );
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                const invoiceAny = invoice as unknown as {
                    subscription?: string | Stripe.Subscription | null;
                };
                const subscriptionIdRaw = invoiceAny.subscription;
                const subscriptionId =
                    typeof subscriptionIdRaw === 'string'
                        ? subscriptionIdRaw
                        : subscriptionIdRaw?.id ?? null;
                if (subscriptionId && stripe) {
                    const sub = await stripe.subscriptions.retrieve(subscriptionId);
                    const clientId = await resolveClientFromStripeIds({
                        clientIdFromMetadata:
                            (sub.metadata?.clientId as string | undefined) ?? null,
                        stripeCustomerId:
                            typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
                    });
                    if (clientId) {
                        const planKey =
                            (sub.metadata?.plan_key as string | undefined) ||
                            (await getPublicTier()).slug;
                        // upsert surfaces the past_due status, which the access
                        // helper treats as "not allowed".
                        await upsertSubscription(sub, clientId, planKey);
                    }
                }
                console.log(`[Stripe] invoice.payment_failed: ${invoice.id}`);
                break;
            }

            case 'payment_intent.payment_failed': {
                const paymentIntent = event.data.object as Stripe.PaymentIntent;
                console.log('[Stripe] Payment failed:', paymentIntent.id);
                break;
            }

            default:
                console.log('[Stripe] Unhandled event type:', event.type);
        }
    } catch (err: any) {
        // Always log but ack 2xx so Stripe doesn't retry indefinitely on
        // transient errors — we have alerting on console errors.
        console.error('[Stripe] Webhook handler error:', err?.message || err);
    }

    return NextResponse.json({ received: true });
}
