-- ============================================================================
-- Stripe Subscription Paywall
-- ============================================================================
-- Adds recurring-subscription support on top of the existing one-time
-- minute-purchase model.
--
--  * `subscriptions` table tracks per-client Stripe subscription state.
--  * `minute_balances` gets a second bucket (`subscription_minutes`) for the
--     monthly allowance, subject to a rollover cap. Existing `balance_minutes`
--     stays as the top-up bucket.
--  * `clients.subscription_grandfathered` exempts a client from the paywall.
--  * `minute_purchases.kind` + `stripe_invoice_id` let us attribute subscription
--     grants (and idempotency-protect webhook replays).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. subscriptions table
-- ---------------------------------------------------------------------------

create table if not exists subscriptions (
    id uuid primary key default gen_random_uuid(),
    client_id uuid not null references clients(id) on delete cascade,
    stripe_subscription_id text unique,
    stripe_customer_id text,
    status text not null check (status in (
        'active','trialing','past_due','incomplete','incomplete_expired',
        'canceled','unpaid','paused','admin_granted'
    )),
    plan_key text not null,
    price_id text,
    current_period_start timestamptz,
    current_period_end timestamptz,
    cancel_at timestamptz,
    canceled_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

-- One live sub per client (allow multiple historical rows)
create unique index if not exists subscriptions_client_active_idx
    on subscriptions(client_id)
    where status in ('active','trialing','past_due','admin_granted');

create index if not exists subscriptions_stripe_sub_idx
    on subscriptions(stripe_subscription_id);

create index if not exists subscriptions_stripe_customer_idx
    on subscriptions(stripe_customer_id);

-- ---------------------------------------------------------------------------
-- 2. minute_balances: subscription-minute bucket with rollover cap
-- ---------------------------------------------------------------------------

alter table minute_balances
    add column if not exists subscription_minutes numeric(10,2) not null default 0;

alter table minute_balances
    add column if not exists last_subscription_grant_at timestamptz;

alter table minute_balances
    add column if not exists subscription_rollover_cap numeric(10,2) not null default 2000;

-- ---------------------------------------------------------------------------
-- 3. clients: grandfathering flag
-- ---------------------------------------------------------------------------

alter table clients
    add column if not exists subscription_grandfathered boolean not null default false;

create index if not exists clients_grandfathered_idx
    on clients(subscription_grandfathered)
    where subscription_grandfathered = true;

-- ---------------------------------------------------------------------------
-- 4. minute_purchases: distinguish subscription grants from top-ups
-- ---------------------------------------------------------------------------

alter table minute_purchases
    add column if not exists kind text not null default 'topup';

alter table minute_purchases
    add constraint minute_purchases_kind_check
    check (kind in ('topup','subscription_grant','subscription_rollover_trim'));

alter table minute_purchases
    add column if not exists stripe_invoice_id text;

-- Webhook idempotency: one grant per (client, kind, invoice).
create unique index if not exists minute_purchases_invoice_uniq_idx
    on minute_purchases(client_id, kind, stripe_invoice_id)
    where stripe_invoice_id is not null;

-- ---------------------------------------------------------------------------
-- 5. Grandfather every client that existed before this migration.
--    Only signups from rollout forward are gated by the paywall.
-- ---------------------------------------------------------------------------

update clients
   set subscription_grandfathered = true
 where created_at < now();
