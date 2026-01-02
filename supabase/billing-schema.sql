-- Billing System Tables
-- Run this after the base schema.sql

-- Per-client billing configuration
create table if not exists client_billing (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade unique not null,
  price_per_minute numeric(10,4) default 0.15, -- What we charge the client
  cost_per_minute numeric(10,4) default 0.12,  -- What Vapi costs us
  stripe_customer_id text,                      -- Stripe Customer ID
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Client minute balance/credits
create table if not exists minute_balances (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade unique not null,
  balance_minutes numeric(10,2) default 0, -- Current available minutes
  total_purchased_minutes numeric(10,2) default 0,
  total_used_minutes numeric(10,2) default 0,
  updated_at timestamp with time zone default now()
);

-- Purchase history
create table if not exists minute_purchases (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  minutes_purchased integer not null,
  amount_paid numeric(10,2) not null, -- USD
  stripe_payment_intent_id text,
  stripe_checkout_session_id text,
  status text check (status in ('pending', 'completed', 'failed', 'refunded')) default 'pending',
  created_at timestamp with time zone default now()
);

-- Detailed usage tracking
create table if not exists usage_records (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  vapi_call_id text not null,
  duration_seconds integer not null,
  minutes_charged numeric(10,2) not null, -- Rounded up
  cost_to_us numeric(10,4) not null,      -- Vapi cost
  price_charged numeric(10,4) not null,   -- What we charge
  recorded_at timestamp with time zone default now()
);

-- Platform settings (singleton table)
create table if not exists platform_settings (
  id text primary key default 'default',
  default_price_per_minute numeric(10,4) default 0.15,
  default_cost_per_minute numeric(10,4) default 0.12,
  platform_name text default 'Voice Agent Platform',
  updated_at timestamp with time zone default now()
);

-- Insert default settings
insert into platform_settings (id) values ('default') on conflict do nothing;

-- Enable RLS
alter table client_billing enable row level security;
alter table minute_balances enable row level security;
alter table minute_purchases enable row level security;
alter table usage_records enable row level security;
alter table platform_settings enable row level security;

-- Indexes for performance
create index if not exists idx_minute_balances_client on minute_balances(client_id);
create index if not exists idx_minute_purchases_client on minute_purchases(client_id);
create index if not exists idx_usage_records_client on usage_records(client_id);
create index if not exists idx_usage_records_vapi_call on usage_records(vapi_call_id);
