# Pricing Tiers — Design, Operations, and Follow-ups

This document covers the pricing-tiers system that drives subscription billing for UMBRELLA accounts: how it's structured today, what to monitor, and the known gaps.

## What's shipped

### Single-phase tiers (segmented pricing)

A `pricing_tiers` table holds a catalog of subscription tiers. Each tier has a Stripe price ID, monthly minute allowance, rollover cap, and admin-editable landing page content. Each `clients` row carries a `pricing_tier_id` FK that locks the customer to one tier at signup.

- Visitors land on `/offers/[slug]`. Middleware sets a 30-day HttpOnly cookie `omnify_visit=<slug>` on the response — the slug may be either a tier slug (single-tier campaign) or an offer slug (multi-tier picker). Disambiguation happens at signup time via [`resolveOfferOrTier`](../src/lib/visit-resolution.ts).
- After Clerk signup, [`autoProvisionUmbrellaClient`](../src/app/page.tsx) reads the cookie, resolves it, and writes EITHER `pricing_tier_id` (tier slug → direct assignment) OR `signup_offer_id` (offer slug → defer tier pick to post-signup picker) to the new client row. Missing/invalid slugs fall back to the public tier.
- The cookie is cleared on the subscribe page via `<ClearTierCookieOnMount>` to prevent leakage to a different account on a shared browser.
- Subscribe page reads the client's tier server-side and renders one tier per client — the page never enumerates other tiers.
- Default public tier (`is_public=true`) covers anyone who signs up directly without a campaign URL.

Admin manages tiers at [`/admin/pricing-tiers`](../src/app/admin/pricing-tiers/page.tsx) — full CRUD with copy-able campaign URLs and active/inactive toggle.

### Multi-tier offers (multiple plans on one campaign URL)

An **offer** is a marketing landing page that contains multiple tier cards. Use this when you want one campaign URL to surface a Starter / Pro / Enterprise picker for a specific audience (real-estate agents, chiropractors, etc.).

- Offer rows live in the [`offers`](../supabase/migrations/20260510-offers.sql) table — they own the page wrapper (eyebrow, headline, subhead).
- Each tier optionally points at an offer via [`pricing_tiers.offer_id`](../src/lib/pricing-tiers.ts) (FK, nullable). `sort_order` controls card order; `is_recommended` adds a "Most Popular" badge.
- Resolution at [`/offers/[slug]`](../src/app/offers/[slug]/page.tsx): the route checks the offers table first; if the slug matches an offer, it renders [`<MultiTierOfferLanding>`](../src/app/offers/[slug]/_components/multi-tier-landing.tsx) with one [`<TierCard>`](../src/components/billing/tier-card.tsx) per assigned active tier. Otherwise it falls back to single-tier rendering.
- Cookie capture: middleware sets `omnify_visit=<slug>` on any `/offers/<slug>` visit. For multi-tier offers, clicking a card additionally fires [`selectTierAction`](../src/app/offers/[slug]/actions.ts) which writes a soft preference hint to `omnify_preferred_tier=<tier-slug>` — used to pre-highlight the matching card on the post-signup picker. The actual tier selection commits server-side on the picker via [`selectClientTierAction`](../src/app/client/[clientId]/subscribe/_components/actions.ts), which writes `clients.pricing_tier_id` after validating the tier belongs to the customer's signup offer.
- Stripe / billing flow is unchanged — offers are a presentation-layer concept; a customer always ends up locked to exactly one tier.

#### Admin workflow

1. Create the offer at [/admin/offers](../src/app/admin/offers/page.tsx) → set slug, name, landing copy.
2. Create or edit the tiers you want to feature at [/admin/pricing-tiers](../src/app/admin/pricing-tiers/page.tsx); on each tier set the **Offer** dropdown to your new offer, plus `sort_order` and (optionally) `is_recommended` for one tier.
3. Back on the offer's edit page, the "Tiers in this offer" section shows the assignment with up/down reorder buttons and a "remove from offer" action.

Single-tier campaign URLs continue to work unchanged — you don't need to migrate existing tiers into offers.

#### Slug uniqueness

`offers.slug` and `pricing_tiers.slug` are each individually `UNIQUE`. Cross-table collisions are blocked at the application layer — both create/update actions check the other table and return a clear error if the slug is already in use. Existing data is grandfathered (you can rename if needed).

### Multi-phase tiers (intro / promo pricing)

A tier can carry an ordered `phases` array (JSONB on `pricing_tiers.phases`). Each phase has its own `stripe_price_id`, `price_usd`, `monthly_minutes`, and `duration_months` (last phase has `null` = runs forever). Single-phase tiers leave `phases=NULL` and behave as before.

**Stripe wiring**: [`convertSubscriptionToSchedule`](../src/lib/stripe.ts) wraps the live subscription in a Stripe Subscription Schedule via two API calls (`create({ from_subscription })` then `update(id, { phases })`). Stripe handles the auto-transition between phases at billing time. Our webhook on [`customer.subscription.created`](../src/app/api/stripe/webhook/route.ts) does the wrap; subsequent events (renewals, transitions) flow through `invoice.paid`.

**Phase resolution at `invoice.paid`**: helper `getRecurringLinePriceId` extracts the billed price from `invoice.lines.data[i].pricing.price_details.price` (Stripe API `2025-12-15.clover` shape), filtered by `line.parent.type === 'subscription_item_details'`. We match it against the tier's `phases` array and grant `phase.monthly_minutes`. If no phase matches on a multi-phase tier, the grant is **skipped** rather than silently falling back to phase 1 — see operational note below.

**Plan key trust model**: after the first `customer.subscription.created` event, our `subscriptions.plan_key` column is the source of truth. `getStoredPlanKey` reads from there; Stripe `subscription.metadata.plan_key` is only used pre-row-creation. This protects against tier downgrades via Customer Portal metadata edits.

## Operational notes

### What to monitor

| Log line | What it means | Action |
|---|---|---|
| `[Stripe] Webhook handler error: ...` (with HTTP 500) | Outer catch fired; Stripe will redeliver. | Check application logs for the underlying exception. Most causes are transient (Supabase blip, Stripe rate limit) and self-heal. Watch for repeated retries on the same `event.id`. |
| `[Stripe] FAILED to wrap sub=... in schedule` | Schedule conversion failed — customer is on phase 1 but no schedule exists. Stripe will redeliver. | If it persists past 2-3 retries, inspect the tier definition (do all phase price IDs exist in Stripe?) and the Stripe API status. |
| `no phase match for price=... on multi-phase tier=...; SKIPPING grant` | A multi-phase invoice billed at a price ID that's not in our tier's phases. Customer paid, we did **not** grant minutes. | Run the reconciliation procedure (see below). Common causes: admin edited a phase's `stripe_price_id` mid-billing; a Stripe SDK shape change; a manual edit to the schedule via Stripe Dashboard. |
| `lines.has_more=true; phase resolution may be incomplete` | An invoice had paginated line items and we only saw the first page. | If this fires, check whether the recurring line was on a later page. If so, we may have skipped the grant on a paid invoice. Reconcile manually. |

### Reconciliation procedure (manual, no UI yet)

When a SKIP happens — customer paid but minutes weren't granted — there's no admin button for it today. Recovery is by SQL:

```sql
-- 1. Find the invoice
SELECT id, client_id, status, kind, stripe_invoice_id, created_at, amount_paid
  FROM minute_purchases
 WHERE client_id = '<id>' AND created_at >= '<around when they paid>';
-- (the row will be missing if a grant was skipped)

-- 2. Apply the grant
INSERT INTO minute_purchases
  (client_id, minutes_purchased, amount_paid, status, kind, stripe_invoice_id)
VALUES
  ('<client-id>', <phase-minutes>, <invoice-amount>, 'completed', 'subscription_grant', '<stripe-invoice-id>');

-- 3. Bump the bucket (mind the rollover cap)
UPDATE minute_balances
   SET subscription_minutes = LEAST(subscription_rollover_cap, subscription_minutes + <phase-minutes>),
       last_subscription_grant_at = now(),
       updated_at = now()
 WHERE client_id = '<client-id>';
```

This is workable for a handful of cases. **Build the admin tool before this becomes routine** (see follow-ups).

### Idempotency guarantees

- **Minute grants**: deduplicated by `(client_id, kind, stripe_invoice_id)` unique index in `minute_purchases`. Webhook redelivery is safe.
- **Subscription upserts**: keyed by `stripe_subscription_id`. Safe to call repeatedly.
- **Schedule wrap**: `convertSubscriptionToSchedule` catches "already wrapped" errors and re-fetches the existing schedule, then proceeds with the update. Repeat calls converge to the same end state as long as the tier's phases array hasn't changed between attempts.

### What returning HTTP 500 from the webhook means

The outer catch in [`webhook/route.ts`](../src/app/api/stripe/webhook/route.ts) returns 500 on any unhandled exception so Stripe retries (up to 3 days, exponential backoff). This is correct for **transient** errors. It becomes a problem if our code has a **permanent** bug (e.g. a Supabase column doesn't exist after a partial deploy) — every event for every customer will retry for 3 days. Mitigation today is "watch the logs"; future improvement is to tag known-permanent error classes and return 4xx for those.

## Follow-ups

These are real items, not bug fixes. Listed in priority order.

### 1. Admin reconciliation tool — must-do before promotional pricing goes live

When `invoice.paid` SKIPs a multi-phase grant, an admin needs a UI to retroactively grant the right number of minutes for that invoice. Manual SQL is acceptable for ≤ 5 cases; beyond that it's a footgun.

**Scope**: a button on each minute_purchase row in the admin client view: "Reconcile invoice <stripe_invoice_id>" → looks up the tier's current phase for that invoice's billed price → grants minutes → audit log row. Maybe ½ day.

### 2. `subscriptions.schedule_id` column for observability

Today there's no column on our `subscriptions` row indicating whether a schedule wraps the subscription. Diagnosis requires re-fetching from Stripe. Add a `schedule_id text` column; populate at `customer.subscription.created` after the wrap; read it at `customer.subscription.updated` to detect schedule changes.

**Scope**: small migration + 2 lines in the webhook + a column in the admin client view. ~1 hour.

### 3. Phase snapshot on the subscription row

The webhook resolves phases by reading `pricing_tiers.phases` LIVE on every `invoice.paid`. If an admin edits phase 2's `stripe_price_id`, existing subscribers' renewal invoices reference the OLD price (Stripe schedule is baked at signup) but our DB has the NEW price → no phase match → SKIP grant. The edit-page banner warns admins about this, but the safer fix is to write a snapshot of `phases` to the `subscriptions` row at signup and read from that for grants — decouples phase resolution from current tier state.

**Scope**: migration adds `subscriptions.phase_snapshot jsonb`; populate at upsert time; read in `invoice.paid` instead of (or as a fallback to) the live tier. ~1 day, including a backfill plan for existing rows.

### 4. Tag known-permanent errors as 4xx in the webhook

Stripe's documented advice is 4xx for non-retryable, 5xx for transient. Today everything is 5xx. Permanent failures (missing Supabase column, validation throws on a malformed event) trigger a 3-day retry storm.

**Scope**: enumerate the permanent error classes (Supabase PG error codes for missing tables / columns; validation throws from `validatePhases`; etc.) and return 4xx for those. ~1 hour, ~30 min of testing.

### 5. Promo code interaction verification

Stripe Checkout's `allow_promotion_codes: true` (currently set in [`createSubscriptionCheckoutSession`](../src/lib/stripe.ts)) lets customers apply a coupon at signup. Behavior on multi-phase tiers is unverified: does the coupon discount apply across all phases, only phase 1, or get stripped by the schedule wrap? Worth testing before running paid promotions on multi-phase tiers.

**Scope**: Stripe test-clock smoke test. ~1 hour.

### 6. Subscribe button copy review (legal/non-engineering)

The CTA `"Start with $99/month"` for multi-phase tiers may not satisfy FTC ROSCA "clear and conspicuous" disclosure requirements when followed by a $379/month phase. The price journey IS shown above the button via `<PhaseSummary>`, but consumer-protection law generally expects the steady-state price near the action button itself.

**Recommendation**: change the button to e.g. `"Start with $99/mo · then $379/mo"`. Get a lawyer to review before promotional pricing campaigns go live in regulated jurisdictions (US, EU, UK).

### 7. Drag-and-drop reorder for tiers in an offer

Today: up/down buttons on the offer edit page. Acceptable for ≤ 5 tiers but feels clunky beyond that. Adding `react-dnd` or `@dnd-kit` would make the experience nicer; the underlying server action `moveTierInOfferAction` already canonicalizes `sort_order` to 1..N on every move so a drag-drop reorder can issue one bulk update at the end.

**Scope**: ~½ day for a clean drag-and-drop implementation that submits a single reorder server action.

### 8. Stripe test-clock end-to-end smoke test

The implementation is type-checked and SDK-shape-correct, but no integration test has actually rolled the clock forward across a phase boundary. Before shipping a real campaign:

1. Create both Stripe Prices (intro + main) in test mode.
2. Create a multi-phase tier in `/admin/pricing-tiers` with a 1-month phase 1 (for fast iteration).
3. Sign up via `/offers/<slug>` with a test card.
4. Verify in Stripe Dashboard: subscription has a schedule with 2 phases.
5. Verify in our DB: `subscriptions.plan_key` correct, `minute_balances.subscription_minutes` got phase 1's allowance.
6. Use a [Stripe test clock](https://docs.stripe.com/billing/testing/test-clocks) to advance past phase 1.
7. Verify Stripe billed phase 2's price; our webhook granted phase 2's minutes; `subscriptions.price_id` updated.

**Cannot ship a multi-phase tier without this loop closed.**

## Edge cases / known limitations

- **Tier editing affects new sign-ups only.** Existing Stripe schedules are baked at signup and don't pick up tier edits. The edit-page banner warns admins. Item #3 above (phase snapshot) would make this defensive at the data layer.
- **Tier deletion is gated by FK.** `pricing_tiers` rows referenced by any `clients.pricing_tier_id` cannot be deleted; admins must deactivate (`is_active=false`) instead. Existing subscribers keep working — their grants resolve via `getTierBySlug({ onlyActive: false })`.
- **No tier-change UI for active subscribers.** Stripe portal handles cancel+resub. An admin re-tag (changing `clients.pricing_tier_id`) only affects the next subscription, not the active one.
- **Cookie-based tier capture has a 30-day TTL.** A user clicking a campaign link, leaving for 31+ days, then signing up gets the public tier. Acceptable. Shorter TTL would reduce shared-browser bleed risk; longer would stretch the marketing window.
- **No retag-by-cookie after signup.** A public-flow user clicking `/offers/<slug>` doesn't move them to that tier. Admin must do it manually. This is a deliberate leak-prevention choice.

## File map

| Area | Files |
|---|---|
| Schema | [`supabase/migrations/20260508-pricing-tiers.sql`](../supabase/migrations/20260508-pricing-tiers.sql), [`supabase/migrations/20260509-pricing-tier-phases.sql`](../supabase/migrations/20260509-pricing-tier-phases.sql), [`supabase/migrations/20260510-offers.sql`](../supabase/migrations/20260510-offers.sql) |
| Server helpers | [`src/lib/pricing-tiers.ts`](../src/lib/pricing-tiers.ts), [`src/lib/offers.ts`](../src/lib/offers.ts), [`src/lib/stripe.ts`](../src/lib/stripe.ts), [`src/lib/subscriptions.ts`](../src/lib/subscriptions.ts) |
| Webhook | [`src/app/api/stripe/webhook/route.ts`](../src/app/api/stripe/webhook/route.ts) |
| Checkout | [`src/app/api/stripe/subscribe/route.ts`](../src/app/api/stripe/subscribe/route.ts) |
| Customer-facing UI | [`src/app/offers/[slug]/page.tsx`](../src/app/offers/[slug]/page.tsx), [`src/app/offers/[slug]/_components/`](../src/app/offers/[slug]/_components/), [`src/app/offers/[slug]/actions.ts`](../src/app/offers/[slug]/actions.ts), [`src/app/client/[clientId]/subscribe/page.tsx`](../src/app/client/[clientId]/subscribe/page.tsx), [`src/components/billing/phase-summary.tsx`](../src/components/billing/phase-summary.tsx), [`src/components/billing/tier-card.tsx`](../src/components/billing/tier-card.tsx), [`src/components/billing/subscribe-button.tsx`](../src/components/billing/subscribe-button.tsx), [`src/components/billing/clear-tier-cookie.tsx`](../src/components/billing/clear-tier-cookie.tsx) |
| Admin: tiers | [`src/app/admin/pricing-tiers/page.tsx`](../src/app/admin/pricing-tiers/page.tsx), [`src/app/admin/pricing-tiers/new/page.tsx`](../src/app/admin/pricing-tiers/new/page.tsx), [`src/app/admin/pricing-tiers/[id]/edit/page.tsx`](../src/app/admin/pricing-tiers/[id]/edit/page.tsx), [`src/app/admin/pricing-tiers/actions.ts`](../src/app/admin/pricing-tiers/actions.ts), [`src/app/admin/pricing-tiers/_components/`](../src/app/admin/pricing-tiers/_components/) |
| Admin: offers | [`src/app/admin/offers/page.tsx`](../src/app/admin/offers/page.tsx), [`src/app/admin/offers/new/page.tsx`](../src/app/admin/offers/new/page.tsx), [`src/app/admin/offers/[id]/edit/page.tsx`](../src/app/admin/offers/[id]/edit/page.tsx), [`src/app/admin/offers/actions.ts`](../src/app/admin/offers/actions.ts), [`src/app/admin/offers/_components/`](../src/app/admin/offers/_components/) |
| Tier capture | [`src/middleware.ts`](../src/middleware.ts), [`src/app/page.tsx`](../src/app/page.tsx), [`src/app/api/offers/clear-tier/route.ts`](../src/app/api/offers/clear-tier/route.ts) |
