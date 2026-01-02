---
name: Vapi Voice Agent Platform
overview: Build a high-end, multi-tenant voice agent platform with a "Synthflow-inspired" UI, Admin panel, Client dashboard (Custom/Umbrella modes), Vapi SDK integration, and Stripe billing.
todos:
  - id: setup-project
    content: Initialize Next.js project with Tailwind and "Synthflow" aesthetic (Sidebar + Layout)
    status: pending
  - id: setup-auth
    content: Configure Clerk with role-based dashboard redirection
    status: pending
  - id: setup-db
    content: Set up Supabase schema for Clients, Agents, and Call Logs
    status: pending
  - id: setup-stripe
    content: Integrate Stripe for subscriptions and prepaid minute top-ups (Billing Section)
    status: pending
  - id: admin-panel
    content: Implement Admin Panel for agency-wide client management
    status: pending
  - id: agent-editor
    content: Build sleek Agent Editor with Vapi integration (Synthflow-style settings)
    status: pending
  - id: call-logs
    content: Implement Call Logs UI with session recordings and duration tracking
    status: pending
  - id: vapi-webhooks
    content: Implement Webhooks for real-time usage and log synchronization
    status: pending
---

# Vapi Voice Agent Platform Implementation Plan (Synthflow Style)

I will build a premium-tier voice agent platform with a sleek, minimalist UI inspired by Synthflow. The focus is on a phased delivery starting with core agent management, call logs, and billing.

## Phase 1: Core Foundation & UI (Current Priority)

### 1. Aesthetic & Layout (Synthflow Inspired)

- **Sidebar**: High-contrast minimalist sidebar with sections for Analytics, Agents, Call Logs, Billing, and Settings.
- **Theme**: Light/Dark mode support with a focus on clean typography (Inter/Geist) and subtle shadows.
- **Agent Dashboard**: "Empty State" with large action cards ("Start from Scratch", "Templates").

### 2. Client Account Types

- **Type A (Custom)**: Client provides their own Vapi Key/Org. Platform is just a management layer.
- **Type B (Umbrella)**: Client uses Agency credentials. Usage is restricted by prepaid credits.

### 3. Feature Set

- **Editable AI Agents**: Dynamic configuration of Vapi properties (Voice, Prompt, Speed, etc.).
- **Call Logs**: Detailed list of calls, durations, costs, and recordings fetched via Vapi.
- **Billing Section**: Stripe-integrated dashboard for managing subscriptions and topping up minutes.

## Implementation Details

```mermaid
graph TD
    User[Client] -->|Auth| Clerk
    Clerk -->|Redirect| Dashboard[Synthflow-style Dashboard]
    Dashboard --> Agents[Agent Editor]
    Dashboard --> Logs[Call Logs]
    Dashboard --> Billing[Stripe Billing]
    Agents -->|Vapi SDK| VapiAPI[Vapi Backend]
    VapiAPI -->|Webhooks| Logs
```



### Database Schema (Supabase)

- `clients`: `id`, `name`, `email`, `account_type` (CUSTOM/UMBRELLA), `vapi_key`, `vapi_org_id`, `balance`.
- `agents`: `id`, `client_id`, `vapi_id`, `name`, `config` (JSON).
- `calls`: `id`, `client_id`, `agent_id`, `duration`, `recording_url`, `transcript`, `cost`.

## Key Files

- `src/components/layout/sidebar.tsx`: The Synthflow-style navigation.
- `src/app/dashboard/agents/page.tsx`: Grid/List view of agents with "Create New" cards.
- `src/app/dashboard/logs/page.tsx`: Table view for call logs.