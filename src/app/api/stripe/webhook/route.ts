import { NextRequest, NextResponse } from 'next/server';
import { constructWebhookEvent, convertSubscriptionToSchedule, stripe } from '@/lib/stripe';
import { completePurchase } from '@/lib/billing';
import {
    grantSubscriptionMinutes,
    markSubscriptionCanceled,
    resolveClientFromStripeIds,
    upsertSubscription,
} from '@/lib/subscriptions';
import {
    getPhaseByPriceId,
    getPublicTier,
    getTierBySlug,
    getTierPhases,
    isMultiPhase,
} from '@/lib/pricing-tiers';
import { supabase } from '@/lib/supabase';
import Stripe from 'stripe';

/**
 * Extract the subscription ID from an Invoice. In Stripe API
 * 2025-12-15.clover, `invoice.subscription` was moved to
 * `invoice.parent.subscription_details.subscription`. Fall back to the
 * pre-clover top-level field for safety on older payloads.
 */
function getInvoiceSubscriptionId(invoice: Stripe.Invoice): string | null {
    type InvoiceWithSubFields = {
        parent?: {
            type?: string;
            subscription_details?: {
                subscription?: string | Stripe.Subscription | null;
            } | null;
        } | null;
        subscription?: string | Stripe.Subscription | null;
    };
    const inv = invoice as unknown as InvoiceWithSubFields;
    const fromParent = inv.parent?.subscription_details?.subscription;
    const raw = fromParent ?? inv.subscription ?? null;
    if (!raw) return null;
    return typeof raw === 'string' ? raw : raw.id;
}

/**
 * Extract the recurring subscription line item's price ID. In Stripe API
 * 2025-12-15.clover, line items have:
 *   line.parent.type === 'subscription_item_details' (vs 'invoice_item_details')
 *   line.pricing.price_details.price (string ID)
 * The pre-clover `line.price.id` is no longer populated.
 */
function getRecurringLinePriceId(invoice: Stripe.Invoice): string | null {
    type LineWithDetails = {
        parent?: { type?: string } | null;
        pricing?: {
            price_details?: { price?: string | Stripe.Price | null } | null;
        } | null;
    };
    for (const l of invoice.lines.data as unknown as LineWithDetails[]) {
        if (l.parent?.type !== 'subscription_item_details') continue;
        const price = l.pricing?.price_details?.price;
        if (!price) continue;
        return typeof price === 'string' ? price : price.id;
    }
    return null;
}

/**
 * Read the plan_key our system has stored for a Stripe subscription. After
 * the initial `customer.subscription.created` event our DB row is the source
 * of truth — Stripe metadata becomes a hint that an attacker could
 * theoretically tamper with via the Customer Portal.
 */
async function getStoredPlanKey(stripeSubId: string): Promise<string | null> {
    const { data } = await supabase
        .from('subscriptions')
        .select('plan_key')
        .eq('stripe_subscription_id', stripeSubId)
        .maybeSingle();
    return (data?.plan_key as string | undefined) ?? null;
}

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
                // For `created`, no DB row exists yet so metadata is the only
                // source. For `updated`, prefer the DB row our code wrote at
                // signup — Stripe metadata can be tampered through the
                // Customer Portal in some configurations and we don't want a
                // user changing their tier mid-subscription.
                const storedPlanKey =
                    event.type === 'customer.subscription.updated'
                        ? await getStoredPlanKey(sub.id)
                        : null;
                const planKey =
                    storedPlanKey ||
                    (sub.metadata?.plan_key as string | undefined) ||
                    (await getPublicTier()).slug;
                await upsertSubscription(sub, clientId, planKey);
                console.log(
                    `[Stripe] ${event.type}: sub=${sub.id} client=${clientId} status=${sub.status}`
                );

                // For multi-phase tiers, wrap the freshly-created subscription
                // in a Stripe Schedule so future phases bill at their own
                // price. Re-throws on failure so Stripe redelivers — silent
                // catch would strand the customer on phase 1 forever.
                if (event.type === 'customer.subscription.created' && !sub.schedule) {
                    const tier = await getTierBySlug(planKey, { onlyActive: false });
                    if (tier && isMultiPhase(tier)) {
                        await convertSubscriptionToSchedule({
                            subscriptionId: sub.id,
                            phases: getTierPhases(tier).map((p) => ({
                                stripe_price_id: p.stripe_price_id,
                                duration_months: p.duration_months,
                            })),
                            metadata: { clientId, plan_key: planKey },
                        });
                        console.log(
                            `[Stripe] Wrapped sub=${sub.id} in schedule (${getTierPhases(tier).length} phases)`
                        );
                    }
                }
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

                const billingReason = (invoice as unknown as { billing_reason?: string | null })
                    .billing_reason;

                // Only grant minutes for subscription invoices (initial + renewals).
                if (
                    billingReason !== 'subscription_create' &&
                    billingReason !== 'subscription_cycle' &&
                    billingReason !== 'subscription_update'
                ) {
                    break;
                }

                const subscriptionId = getInvoiceSubscriptionId(invoice);

                // Pull metadata from the subscription to resolve clientId + plan.
                // Our DB row, once written, is the source of truth for plan_key
                // — Stripe metadata is only used for the very first event
                // (before our row exists) since a customer could theoretically
                // tamper with it through the Customer Portal.
                let clientId: string | null = null;
                let planKey: string | null = subscriptionId
                    ? await getStoredPlanKey(subscriptionId)
                    : null;

                if (subscriptionId && stripe) {
                    const sub = await stripe.subscriptions.retrieve(subscriptionId);
                    clientId = await resolveClientFromStripeIds({
                        clientIdFromMetadata:
                            (sub.metadata?.clientId as string | undefined) ?? null,
                        stripeCustomerId:
                            typeof sub.customer === 'string' ? sub.customer : sub.customer?.id,
                    });
                    if (!planKey) {
                        planKey = (sub.metadata?.plan_key as string | undefined) ?? null;
                    }
                    // Keep our subscriptions row fresh on every invoice.
                    if (clientId && planKey) {
                        await upsertSubscription(sub, clientId, planKey);
                    }
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

                if (!planKey) planKey = (await getPublicTier()).slug;
                const tier =
                    (await getTierBySlug(planKey, { onlyActive: false })) ??
                    (await getPublicTier());

                // Find the subscription line item to resolve the phase. If
                // pagination cut off the lines we need, log it loudly — for
                // typical single-line subscription invoices this won't fire.
                if (invoice.lines.has_more) {
                    console.warn(
                        `[Stripe] invoice.paid ${invoice.id}: lines.has_more=true; phase resolution may be incomplete (consider listLineItems pagination)`
                    );
                }
                const lineItemPriceId = getRecurringLinePriceId(invoice);

                let phase = getPhaseByPriceId(tier, lineItemPriceId);
                if (!phase) {
                    if (isMultiPhase(tier)) {
                        // Refuse to silently grant phase 1's minutes — that
                        // would over- or under-grant on every cycle if the
                        // tier's price IDs and Stripe's billed price ever
                        // diverge (e.g. an admin edit, or an API/SDK shape
                        // change). Better to skip the grant; admin/support
                        // can retroactively reconcile.
                        console.error(
                            `[Stripe] invoice.paid ${invoice.id}: no phase match for price=${lineItemPriceId} on multi-phase tier=${tier.slug}; SKIPPING grant — admin must reconcile`
                        );
                        break;
                    }
                    // Single-phase tier: fall back to phase 1 (the only phase).
                    phase = getTierPhases(tier)[0];
                }

                const amountPaid = (invoice.amount_paid ?? 0) / 100;

                const result = await grantSubscriptionMinutes({
                    clientId,
                    minutes: phase.monthly_minutes,
                    rolloverCap: tier.rollover_cap,
                    stripeInvoiceId: invoice.id ?? null,
                    amountPaid,
                });

                if (result === null) {
                    console.log(`[Stripe] invoice.paid ${invoice.id} — already granted (idempotent skip)`);
                } else {
                    console.log(
                        `[Stripe] invoice.paid ${invoice.id} — granted ${result.granted}min, trimmed ${result.trimmed}min for client ${clientId} (tier=${tier.slug}, price=${lineItemPriceId ?? 'none'})`
                    );
                }
                break;
            }

            case 'invoice.payment_failed': {
                const invoice = event.data.object as Stripe.Invoice;
                const subscriptionId = getInvoiceSubscriptionId(invoice);
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
                            (await getStoredPlanKey(subscriptionId)) ||
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
    } catch (err: unknown) {
        // Return 5xx so Stripe redelivers. The handler is designed to be
        // idempotent (minute grants are keyed by (client, kind, invoice_id);
        // schedule conversion checks `!sub.schedule`; subscription upserts
        // dedupe by id). Returning 2xx here previously silently dropped
        // failures (e.g. a broken schedule conversion) with no retry.
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Stripe] Webhook handler error:', msg);
        return NextResponse.json({ error: msg }, { status: 500 });
    }

    return NextResponse.json({ received: true });
}
