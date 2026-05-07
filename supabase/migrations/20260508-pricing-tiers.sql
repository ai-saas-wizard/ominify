-- ============================================================================
-- Pricing Tiers — multi-segment pricing (real-estate campaign + future)
-- ============================================================================
-- Replaces the single hardcoded `basic_479` plan with a database-driven
-- catalog. Each tier carries its own Stripe price ID and admin-editable
-- landing page content (rendered at /offers/[slug]).
--
-- Flow: visitor lands on /offers/[slug] → middleware sets `omnify_tier`
-- cookie → user signs up → autoProvisionUmbrellaClient reads the cookie and
-- assigns clients.pricing_tier_id → subscribe/webhook routes resolve all
-- pricing decisions from that tier.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. pricing_tiers table
-- ---------------------------------------------------------------------------

create table if not exists pricing_tiers (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    display_name text not null,
    price_usd numeric(10,2) not null,
    monthly_minutes integer not null,
    rollover_cap integer not null default 2000,
    stripe_price_id text not null,
    is_public boolean not null default false,
    is_active boolean not null default true,
    description text,

    -- Admin-editable landing page content (rendered at /offers/[slug])
    landing_eyebrow text,
    landing_headline text,
    landing_subheadline text,
    landing_features jsonb not null default '[]'::jsonb,
    landing_cta_label text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- Exactly one active is_public tier at a time
create unique index if not exists pricing_tiers_one_public_idx
    on pricing_tiers (is_public)
    where is_public = true and is_active = true;

create index if not exists pricing_tiers_active_idx
    on pricing_tiers (is_active);

-- ---------------------------------------------------------------------------
-- 2. clients.pricing_tier_id
-- ---------------------------------------------------------------------------

alter table clients
    add column if not exists pricing_tier_id uuid references pricing_tiers(id) on delete set null;

create index if not exists clients_pricing_tier_idx on clients(pricing_tier_id);

-- ---------------------------------------------------------------------------
-- 3. Seed: migrate the current basic_479 plan into the catalog.
--    The Stripe price ID matches STRIPE_PRICE_ID_SUBSCRIPTION_BASIC in
--    .env.local (price_1TN61TRypv7xTJggefm7JZHn).
-- ---------------------------------------------------------------------------

insert into pricing_tiers (
    slug, display_name, price_usd, monthly_minutes, rollover_cap,
    stripe_price_id, is_public, description,
    landing_headline, landing_subheadline, landing_features, landing_cta_label
) values (
    'basic_479',
    'Basic',
    479,
    1000,
    2000,
    'price_1TN61TRypv7xTJggefm7JZHn',
    true,
    'Public plan for self-serve sign-ups',
    'Unlock your AI voice agents',
    'Run inbound and outbound calls on autopilot. Cancel anytime.',
    '["1,000 voice minutes included every month","Unused minutes — rollover for 2 months","Top up with extra minute packs anytime","Cancel, upgrade, or update your card via the Stripe portal"]'::jsonb,
    'Subscribe — $479/month'
)
on conflict (slug) do nothing;

-- ---------------------------------------------------------------------------
-- 4. Backfill existing clients onto the public tier
-- ---------------------------------------------------------------------------

update clients
   set pricing_tier_id = (select id from pricing_tiers where slug = 'basic_479')
 where pricing_tier_id is null;
