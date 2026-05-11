-- ============================================================================
-- Move tier selection from pre-signup to post-signup
-- ============================================================================
-- Adds `clients.signup_offer_id` so visitors arriving from a multi-tier offer
-- URL can defer their tier pick to a post-signup picker on the subscribe
-- page rather than committing pre-signup via a cookie.
--
-- State invariants:
--   pricing_tier_id set + signup_offer_id null    -> direct subscribe
--   pricing_tier_id null + signup_offer_id set    -> show picker
--   pricing_tier_id set + signup_offer_id set     -> picker complete (audit)
--   both null                                     -> fallback to public tier
-- ============================================================================

alter table clients
    add column if not exists signup_offer_id uuid references offers(id) on delete set null;

create index if not exists clients_signup_offer_idx
    on clients(signup_offer_id)
    where signup_offer_id is not null;

comment on column clients.signup_offer_id is
'Set during signup when the visitor landed on a multi-tier offer URL. Indicates the customer must pick a tier on the post-signup subscribe page. Persists after picking as an audit trail.';
