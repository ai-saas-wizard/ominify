-- Enable UUID extension
create extension if not exists "uuid-ossp";

-- Clients Table (Type A and Type B)
create table clients (
  id uuid primary key default uuid_generate_v4(),
  clerk_id text unique not null,
  name text,
  email text,
  account_type text check (account_type in ('CUSTOM', 'UMBRELLA')) default 'CUSTOM',
  vapi_key text, -- Stores the private API key for CUSTOM clients
  vapi_org_id text, -- Optional: Org ID if needed
  created_at timestamp with time zone default now()
);

-- Agents Table (Synced from Vapi or Created locally)
create table agents (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  vapi_id text not null, -- The ID from Vapi
  name text not null,
  config jsonb, -- Store the full agent config dump
  updated_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- Call Logs Table
create table calls (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  agent_id uuid references agents(id) on delete set null,
  vapi_call_id text unique not null,
  duration_seconds integer,
  recording_url text,
  transcript text,
  cost real, -- Cost in USD
  status text,
  started_at timestamp with time zone,
  ended_at timestamp with time zone,
  created_at timestamp with time zone default now()
);

-- RLS Policies (Optional for now as we use Service Role in Server Actions, but good practice)
alter table clients enable row level security;
alter table agents enable row level security;
alter table calls enable row level security;
