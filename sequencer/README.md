# OMINIFY Sequencer Engine

AI-powered multi-channel outreach sequencer for TYPE B clients.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SEQUENCER ENGINE (VM)                        │
│                                                                 │
│  PM2 Managed Processes:                                        │
│  ├── scheduler-worker    — Polls DB, dispatches to queues      │
│  ├── sms-worker (x2)     — Twilio SMS sending                  │
│  ├── email-worker (x2)   — Gmail/SMTP                          │
│  ├── vapi-worker         — Voice calls, umbrella concurrency   │
│  ├── webhook-server      — Receives Twilio/VAPI/lead webhooks  │
│  └── event-processor     — Updates enrollments from events     │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

```bash
cp .env.example .env
# Edit .env with your credentials
```

### 3. Run Database Migrations

Run `supabase/type-b-schema.sql` in your Supabase SQL editor.

### 4. Development

Start individual workers:

```bash
# Terminal 1
npm run webhook-server

# Terminal 2
npm run scheduler

# Terminal 3 (optional - if testing SMS)
npm run sms-worker
```

### 5. Production (PM2)

```bash
npm run build
pm2 start ecosystem.config.js --env production
pm2 logs
```

### 6. Production (Docker)

```bash
docker-compose up -d
docker-compose logs -f
```

## Environment Variables

| Variable | Description |
|----------|-------------|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Supabase service role key |
| `REDIS_URL` | Redis connection URL |
| `TWILIO_ACCOUNT_SID` | Twilio main account SID |
| `TWILIO_AUTH_TOKEN` | Twilio main account auth token |
| `OPENAI_API_KEY` | OpenAI API key (for AI sequence generation) |
| `ENCRYPTION_KEY` | 64-char hex string for API key encryption |
| `WEBHOOK_BASE_URL` | Public URL where webhooks are received |

## Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /health` | Health check with queue stats |
| `GET /ready` | Readiness probe |
| `POST /webhooks/twilio/sms-inbound` | Inbound SMS |
| `POST /webhooks/twilio/sms-status/:tenantId` | SMS delivery status |
| `POST /webhooks/vapi/call-events` | VAPI call events |
| `POST /webhooks/leads/google-ads/:tenantId` | Google Ads leads |
| `POST /webhooks/leads/facebook/:tenantId` | Facebook leads |
| `POST /webhooks/leads/generic/:tenantId` | Generic lead webhook |
| `GET /admin/umbrellas` | List umbrella assignments |
| `POST /admin/umbrellas/migrate` | Migrate tenant between umbrellas |

## How It Works

1. **Lead Ingestion**: Leads arrive via webhooks (Google Ads, Facebook, etc.)
2. **Sequence Matching**: Engine matches lead to appropriate sequence based on trigger conditions
3. **Enrollment**: Contact is enrolled in sequence, first step scheduled
4. **Scheduler**: Polls every 5 seconds for due steps, checks business hours + TCPA
5. **Dispatch**: Steps dispatched to channel queues (SMS, Email, Voice)
6. **Workers**: Process jobs, send messages, make calls
7. **Webhooks**: Receive delivery status, call outcomes, replies
8. **Event Processing**: Update enrollment state, trigger branching logic

## VAPI Umbrella Concurrency

The engine manages VAPI concurrency at the **umbrella** level:

- Multiple tenants can share a single VAPI account (umbrella)
- Redis Lua scripts provide atomic slot acquisition
- Per-tenant soft caps prevent one tenant from starving others
- Webhook sync provides ground truth correction
- Zero-downtime tenant migration between umbrellas
