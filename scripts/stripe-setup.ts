/**
 * One-off Stripe setup script.
 *
 * Creates the Product + recurring Price for the $479/mo Basic subscription.
 * Idempotent — looks up by product metadata key, reuses if found.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/stripe-setup.ts
 *
 * Paste the printed IDs into .env.local / Vercel env:
 *   STRIPE_PRODUCT_ID_BASIC=prod_...
 *   STRIPE_PRICE_ID_SUBSCRIPTION_BASIC=price_...
 */

import "dotenv/config";
import Stripe from "stripe";

const PRODUCT_KEY = "omnify_subscription_basic";
const PLAN_KEY = "basic_479";
const MONTHLY_MINUTES = 1000;
const ROLLOVER_CAP = 2000;
const UNIT_AMOUNT_CENTS = 47900; // $479.00

async function main() {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
        console.error("STRIPE_SECRET_KEY not set");
        process.exit(1);
    }

    const stripe = new Stripe(secret, { apiVersion: "2025-12-15.clover" as any });

    // -------- Product ------------------------------------------------------
    let product: Stripe.Product;

    const search = await stripe.products.search({
        query: `metadata['key']:'${PRODUCT_KEY}'`,
    });

    if (search.data[0]) {
        product = search.data[0];
        console.log(`Reusing existing product: ${product.id}`);
    } else {
        product = await stripe.products.create({
            name: "Omnify Voice Agents — Basic",
            description: `${MONTHLY_MINUTES.toLocaleString()} voice minutes per month, unused minutes roll over up to ${ROLLOVER_CAP.toLocaleString()}.`,
            metadata: {
                key: PRODUCT_KEY,
                plan_key: PLAN_KEY,
            },
        });
        console.log(`Created product: ${product.id}`);
    }

    // -------- Price --------------------------------------------------------
    const prices = await stripe.prices.list({ product: product.id, active: true, limit: 100 });
    let price = prices.data.find(
        (p) =>
            p.unit_amount === UNIT_AMOUNT_CENTS &&
            p.currency === "usd" &&
            p.recurring?.interval === "month"
    );

    if (price) {
        console.log(`Reusing existing price: ${price.id}`);
    } else {
        price = await stripe.prices.create({
            product: product.id,
            unit_amount: UNIT_AMOUNT_CENTS,
            currency: "usd",
            recurring: { interval: "month" },
            metadata: {
                plan_key: PLAN_KEY,
                monthly_minutes: String(MONTHLY_MINUTES),
                rollover_cap: String(ROLLOVER_CAP),
            },
        });
        console.log(`Created price: ${price.id}`);
    }

    console.log();
    console.log("──────────────────────────────────────────────────────────────");
    console.log("Add these to .env.local / Vercel env:");
    console.log();
    console.log(`STRIPE_PRODUCT_ID_BASIC=${product.id}`);
    console.log(`STRIPE_PRICE_ID_SUBSCRIPTION_BASIC=${price.id}`);
    console.log("──────────────────────────────────────────────────────────────");
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
