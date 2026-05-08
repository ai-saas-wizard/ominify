-- ============================================================================
-- Offers — multi-tier pricing pages
-- ============================================================================
-- An offer is a marketing landing page (slug + copy) that contains an ordered
-- set of pricing tiers. Customers visit /offers/<offer-slug>, see a card per
-- tier, click one, and proceed to sign-up locked to that tier.
--
-- Single-tier campaign URLs (existing /offers/<tier-slug>) keep working —
-- offers are opt-in, resolved at the route level by checking the offers table
-- before falling back to tiers. Tiers without an offer have offer_id=NULL.
-- ============================================================================

create table if not exists offers (
    id uuid primary key default gen_random_uuid(),
    slug text not null unique,
    name text not null,
    is_active boolean not null default true,

    -- Landing-page wrapper rendered above the tier cards
    landing_eyebrow text,
    landing_headline text,
    landing_subheadline text,

    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists offers_active_idx on offers(is_active);

-- ---------------------------------------------------------------------------
-- pricing_tiers gains offer_id (nullable), sort_order, and is_recommended
-- ---------------------------------------------------------------------------

alter table pricing_tiers
    add column if not exists offer_id uuid references offers(id) on delete set null;

alter table pricing_tiers
    add column if not exists sort_order integer not null default 0;

alter table pricing_tiers
    add column if not exists is_recommended boolean not null default false;

create index if not exists pricing_tiers_offer_idx
    on pricing_tiers(offer_id, sort_order);
