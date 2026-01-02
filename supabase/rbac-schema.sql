-- Role-Based Access Control Tables
-- Run this after the base schema.sql

-- Admin Users (platform admins)
create table if not exists admin_users (
  id uuid primary key default uuid_generate_v4(),
  email text unique not null,
  clerk_id text unique,
  name text,
  added_by text,
  created_at timestamp with time zone default now()
);

-- Seed initial admin
insert into admin_users (email, name, added_by) 
values ('vishnu@ewiai.com', 'Vishnu', 'system')
on conflict (email) do nothing;

-- Client Team Members (can access specific client accounts)
create table if not exists client_members (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete cascade not null,
  email text not null,
  clerk_id text,
  role text check (role in ('owner', 'admin', 'member')) default 'member',
  name text,
  invited_by text,
  accepted_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  unique(client_id, email)
);

-- Enable RLS
alter table admin_users enable row level security;
alter table client_members enable row level security;

-- Indexes
create index if not exists idx_admin_users_email on admin_users(email);
create index if not exists idx_admin_users_clerk on admin_users(clerk_id);
create index if not exists idx_client_members_email on client_members(email);
create index if not exists idx_client_members_clerk on client_members(clerk_id);
create index if not exists idx_client_members_client on client_members(client_id);
