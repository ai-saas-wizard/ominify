-- ============================================================================
-- Multi-Phase Pricing — promotional/intro pricing on top of pricing_tiers
-- ============================================================================
-- Adds time-based phase support to a pricing tier. Each phase carries its own
-- Stripe price + monthly minute allowance. Stripe Subscription Schedules
-- handle the auto-transition between phases at signup; our webhook matches the
-- billed price.id against this array to grant the right minutes per invoice.
--
-- Single-phase tiers (today's behavior) keep `phases = NULL` and the existing
-- top-level fields drive the single price.
-- ============================================================================

alter table pricing_tiers
    add column if not exists phases jsonb;

comment on column pricing_tiers.phases is
'Optional ordered phase journey for time-based pricing. NULL = single-phase tier (use top-level fields). When set, each element: {stripe_price_id, price_usd, monthly_minutes, duration_months}; last element has duration_months: null (terminal/runs forever).';
