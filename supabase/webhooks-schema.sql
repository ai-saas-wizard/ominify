-- Webhooks System
-- Run this to enable client webhooks

-- Webhooks definition
create table if not exists webhooks (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  name text not null,
  url text not null,
  secret text, -- HMAC secret
  events text[] default array['call.ended'], -- ['call.started', 'call.ended', 'call.transcript']
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Mapping webhooks to specific agents
create table if not exists webhook_agents (
  webhook_id uuid references webhooks(id) on delete cascade,
  agent_id uuid references agents(id) on delete cascade,
  primary key (webhook_id, agent_id)
);

-- Delivery logs for debugging
create table if not exists webhook_logs (
  id uuid primary key default uuid_generate_v4(),
  webhook_id uuid references webhooks(id) on delete cascade,
  event_type text,
  payload jsonb,
  response_status integer,
  error_message text,
  delivered_at timestamp with time zone default now()
);

-- RLS Policies
alter table webhooks enable row level security;
alter table webhook_agents enable row level security;
alter table webhook_logs enable row level security;

-- Index for fast lookups
create index if not exists idx_webhooks_client on webhooks(client_id);
create index if not exists idx_webhook_agents_agent on webhook_agents(agent_id);
create index if not exists idx_webhook_agents_webhook on webhook_agents(webhook_id);
