# OMINIFY CRM — Sequencer Engine: Technical Design

## 1. Executive Summary

The OMINIFY Sequencer is an AI-powered, multi-channel outreach engine that takes structured onboarding data and auto-generates custom follow-up sequences per client. It orchestrates **SMS (Twilio)**, **Email (Gmail API + SMTP)**, and **Voice Calls (VAPI)** with intelligent concurrency management, deployed on a VM for full control over long-running processes.

The key differentiator: **clients don't configure sequences manually — the AI builds them from a 30-minute onboarding conversation.**

---

## 1.1 Account Types: TYPE A vs TYPE B

OMINIFY serves two distinct account types. This document covers the **TYPE B** implementation only.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        OMINIFY ACCOUNT TYPES                                │
├─────────────────────────────────────────┬───────────────────────────────────┤
│           TYPE A                        │          TYPE B (This Doc)        │
├─────────────────────────────────────────┼───────────────────────────────────┤
│ Custom agency-onboarded clients         │ Self-serve SaaS clients           │
│ Manually configured by EWIAI team       │ AI-guided 30-min onboarding       │
│                                         │ auto-generates everything         │
│                                         │                                   │
│ Existing infrastructure — out of        │ Twilio subaccounts provisioned    │
│ scope for this document                 │ automatically under OMINIFY main  │
│                                         │                                   │
│ High-touch, low-volume                  │ Low-touch, high-volume            │
│                                         │                                   │
│ ALREADY LIVE IN PRODUCTION              │ ⬅ WHAT WE ARE BUILDING            │
└─────────────────────────────────────────┴───────────────────────────────────┘
```

Everything in this document from Section 2 onward describes the **TYPE B** implementation.

---

## 1.2 Twilio Infrastructure — Main Account + Subaccount Model

> **Reference:** Full discussion in [this chat](https://claude.ai/chat/9ed588e4-498b-4492-88f5-e31226b309f3)

### Architecture: ISV Type #1 (Twilio Recommended)

This is Twilio's explicitly recommended architecture for ISVs. Each TYPE B tenant gets their own isolated Twilio subaccount under OMINIFY's main account.

```
OMINIFY Main Twilio Account (EWIAI)
│
│  Holds billing relationship with Twilio
│  Has master API credentials
│  All subaccount usage rolls up here
│
├── Subaccount: Tenant "AcmePlumbing"
│   ├── Phone Numbers: +1-555-0101, +1-555-0102
│   ├── Messaging Service (SID)
│   ├── Secondary Customer Profile (Acme's business info)
│   ├── Brand Registration (Acme as the brand)
│   ├── Campaign: "Lead Follow-up" (A2P 10DLC approved)
│   └── All call/SMS logs isolated to this subaccount
│
├── Subaccount: Tenant "SummitRoofing"
│   ├── Phone Numbers: +1-555-0201
│   ├── Messaging Service (SID)
│   ├── Secondary Customer Profile (Summit's business info)
│   ├── Brand Registration (Summit as the brand)
│   ├── Campaign: "Estimate Scheduling" (A2P 10DLC approved)
│   └── Isolated logs, isolated compliance
│
├── Subaccount: Tenant "EliteHVAC"
│   └── ... (same pattern)
│
└── Main Account Resources
    ├── Primary Customer Profile (EWIAI's business)
    ├── Brand Registration (EWIAI) — for internal use
    └── Platform-level webhooks and monitoring
```

### Why Subaccounts (Not Shared Number Pools)

| Benefit | Detail |
|---------|--------|
| **Compliance Isolation** | One tenant's spam violations only affect THEIR subaccount, not your main account or other tenants |
| **Billing Transparency** | Per-tenant usage is automatically tracked by Twilio |
| **Number Ownership** | Each tenant's numbers live in their subaccount |
| **A2P 10DLC Isolation** | Each tenant registers their OWN brand — brand reputation is isolated |
| **Scalability** | No limit on subaccounts. Each new tenant = one new subaccount |
| **Portability** | If a tenant leaves, their numbers can theoretically be migrated |

### Subaccount Provisioning Flow (During TYPE B Onboarding)

```typescript
// twilio-provisioning.ts

async function provisionTwilioForTenant(tenantId: string, onboardingData: any): Promise<void> {
  const mainClient = twilio(MAIN_ACCOUNT_SID, MAIN_AUTH_TOKEN);
  
  // ═══ STEP 1: Create Subaccount ═══
  const subaccount = await mainClient.api.accounts.create({
    friendlyName: `OMINIFY - ${onboardingData.companyName}`
  });
  
  // Store credentials (encrypted)
  await db.query(`
    INSERT INTO tenant_twilio_accounts 
      (tenant_id, account_type, subaccount_sid, auth_token_encrypted, friendly_name)
    VALUES ($1, 'type_b_subaccount', $2, $3, $4)
  `, [tenantId, subaccount.sid, encrypt(subaccount.authToken), subaccount.friendlyName]);
  
  // ═══ STEP 2: Purchase Phone Number ═══
  const subClient = twilio(subaccount.sid, subaccount.authToken);
  
  // Search for local number in tenant's service area
  const availableNumbers = await subClient.availablePhoneNumbers('US')
    .local.list({
      areaCode: onboardingData.preferredAreaCode,
      smsEnabled: true,
      voiceEnabled: true,
      limit: 5
    });
  
  const purchased = await subClient.incomingPhoneNumbers.create({
    phoneNumber: availableNumbers[0].phoneNumber,
    smsUrl: `${WEBHOOK_BASE_URL}/webhooks/twilio/sms-inbound/${tenantId}`,
    voiceUrl: `${WEBHOOK_BASE_URL}/webhooks/twilio/voice-inbound/${tenantId}`,
    statusCallback: `${WEBHOOK_BASE_URL}/webhooks/twilio/status/${tenantId}`
  });
  
  // ═══ STEP 3: Create Messaging Service ═══
  const messagingService = await subClient.messaging.v1.services.create({
    friendlyName: `${onboardingData.companyName} - Sequencer`,
    inboundRequestUrl: `${WEBHOOK_BASE_URL}/webhooks/twilio/messaging/${tenantId}`,
    statusCallback: `${WEBHOOK_BASE_URL}/webhooks/twilio/sms-status/${tenantId}`,
    useInboundWebhookOnNumber: false  // Use service-level webhook
  });
  
  // Add purchased number to messaging service
  await subClient.messaging.v1.services(messagingService.sid)
    .phoneNumbers.create({ phoneNumberSid: purchased.sid });
  
  console.log(`[TWILIO] Tenant ${tenantId}: Subaccount ${subaccount.sid}, Number ${purchased.phoneNumber}, MessagingService ${messagingService.sid}`);
}
```

### A2P 10DLC Registration — Automated via API

Every TYPE B tenant must have A2P 10DLC registration for SMS to work reliably in the US. This is collected during onboarding and submitted via Twilio's Trust Hub + Messaging APIs.

#### Data Collected During Onboarding (Phase 1 — Business Understanding)

The 30-minute onboarding already collects most of what's needed:

```
From existing onboarding questions:
├── Company name              → Brand registration
├── Industry/sub-industry     → Vertical classification
├── Service area              → Campaign scope

Additional A2P fields needed (added to onboarding):
├── Legal business name       → Brand: legal_name
├── EIN (Tax ID)              → Brand: tax_id
├── Business address          → Brand: address
├── Business type             → Brand: entity_type (LLC, Corp, Sole Prop)
├── Website URL               → Brand: website
├── Expected SMS volume       → Campaign: volume_tier
└── Sample message content    → Campaign: sample_messages (AI can auto-generate from onboarding data)
```

#### A2P Registration Flow (Automated)

```typescript
// a2p-registration.ts

async function registerA2P10DLC(tenantId: string, businessInfo: any): Promise<{
  brandStatus: string;
  campaignStatus: string;
  estimatedApprovalDays: number;
}> {
  const tenant = await getTenantTwilioConfig(tenantId);
  const subClient = twilio(tenant.subaccountSid, decrypt(tenant.authToken));
  
  // ═══ STEP 1: Create Secondary Customer Profile (Trust Hub) ═══
  // This represents the tenant's business in Twilio's Trust Hub
  
  const customerProfile = await subClient.trusthub.v1.customerProfiles.create({
    friendlyName: businessInfo.legalName,
    email: businessInfo.contactEmail,
    policySid: 'RN...',  // Twilio's A2P Trust policy SID
    statusCallback: `${WEBHOOK_BASE_URL}/webhooks/twilio/trusthub/${tenantId}`
  });
  
  // Add business information to profile
  await subClient.trusthub.v1.customerProfiles(customerProfile.sid)
    .customerProfilesEntityAssignments.create({
      objectSid: await createEndUserBundle(subClient, businessInfo)
    });
  
  // Submit for review
  await subClient.trusthub.v1.customerProfiles(customerProfile.sid)
    .update({ status: 'pending-review' });
  
  // ═══ STEP 2: Register Brand ═══
  // Brand = the business entity (e.g., "Acme Plumbing LLC")
  
  const brand = await subClient.messaging.v1.brandRegistrations.create({
    customerProfileBundleSid: customerProfile.sid,
    a2PProfileBundleSid: customerProfile.sid,
    brandType: 'STANDARD',  // or 'STARTER' for sole props
  });
  
  // ═══ STEP 3: Create Campaign (after brand approval) ═══
  // Campaign = the specific use case (e.g., "Lead follow-up SMS")
  // NOTE: This must wait for brand approval. Schedule as async job.
  
  await a2pCampaignQueue.add('create-campaign', {
    tenantId,
    messagingServiceSid: tenant.messagingServiceSid,
    brandRegistrationSid: brand.sid,
    useCase: 'MIXED',  // Lead follow-up includes marketing + customer care
    description: generateCampaignDescription(businessInfo),
    sampleMessages: generateSampleMessages(businessInfo),
    // AI generates compliant sample messages from onboarding data:
    // "Hi {{name}}, this is {{company}}. Following up on your {{job_type}} request..."
    // "{{company}} here - just checking if you still need help with {{job_type}}..."
    optInKeywords: ['START', 'YES', 'SUBSCRIBE'],
    optOutKeywords: ['STOP', 'UNSUBSCRIBE', 'CANCEL'],
    helpKeywords: ['HELP', 'INFO'],
    optInMessage: `You're now receiving messages from ${businessInfo.companyName}. Reply STOP to opt out.`,
    optOutMessage: `You've been unsubscribed from ${businessInfo.companyName}. Reply START to re-subscribe.`,
  }, {
    delay: 0,  // Will retry with backoff until brand is approved
    attempts: 20,
    backoff: { type: 'exponential', delay: 3600000 } // Check every hour, up to 20 attempts
  });
  
  // ═══ STEP 4: Store registration state ═══
  await db.query(`
    INSERT INTO tenant_a2p_registrations 
      (tenant_id, brand_sid, brand_status, customer_profile_sid, campaign_status)
    VALUES ($1, $2, 'pending', $3, 'awaiting_brand')
  `, [tenantId, brand.sid, customerProfile.sid]);
  
  return {
    brandStatus: 'pending',
    campaignStatus: 'awaiting_brand_approval',
    estimatedApprovalDays: businessInfo.entityType === 'SOLE_PROPRIETOR' ? 7 : 3
  };
}

// Campaign creation worker (retries until brand is approved)
const a2pCampaignWorker = new Worker('a2p:campaign', async (job) => {
  const { tenantId, messagingServiceSid, brandRegistrationSid } = job.data;
  
  const tenant = await getTenantTwilioConfig(tenantId);
  const subClient = twilio(tenant.subaccountSid, decrypt(tenant.authToken));
  
  // Check if brand is approved yet
  const brand = await subClient.messaging.v1.brandRegistrations(brandRegistrationSid).fetch();
  
  if (brand.status !== 'APPROVED') {
    throw new Error(`Brand not yet approved. Status: ${brand.status}`);
    // BullMQ will retry with exponential backoff
  }
  
  // Brand approved — create the campaign
  const campaign = await subClient.messaging.v1.services(messagingServiceSid)
    .usAppToPerson.create({
      brandRegistrationSid: brandRegistrationSid,
      description: job.data.description,
      messageFlow: job.data.description,
      messageSamples: job.data.sampleMessages,
      usAppToPersonUsecase: job.data.useCase,
      hasEmbeddedLinks: true,
      hasEmbeddedPhone: true,
      optInKeywords: job.data.optInKeywords,
      optOutKeywords: job.data.optOutKeywords,
      helpKeywords: job.data.helpKeywords,
      optInMessage: job.data.optInMessage,
      optOutMessage: job.data.optOutMessage,
    });
  
  // Update registration state
  await db.query(`
    UPDATE tenant_a2p_registrations 
    SET campaign_sid = $2, campaign_status = 'pending_approval'
    WHERE tenant_id = $1
  `, [tenantId, campaign.sid]);
  
  console.log(`[A2P] Tenant ${tenantId}: Campaign created (${campaign.sid}), awaiting TCR approval`);
}, { connection: redis });
```

#### A2P Registration Timeline & Tenant Experience

```
Onboarding Day 0:
├── Tenant completes 30-min onboarding
├── Subaccount created instantly
├── Phone number purchased instantly
├── Brand registration submitted
├── AI sequences generated
│
│  ⏳ INTERIM PERIOD (3-7 days):
│  ├── Tenant can receive inbound calls immediately
│  ├── Outbound VAPI calls work immediately (voice, not SMS)
│  ├── SMS is in "pre-registration" mode:
│  │   └── Low throughput (~1 SMS/sec) but functional
│  │       Twilio allows unregistered 10DLC at reduced rate
│  ├── Dashboard shows: "SMS Compliance: Pending (est. 3-5 days)"
│  └── System auto-retries brand/campaign checks hourly
│
Day 3-7:
├── Brand approved ✅
├── Campaign approved ✅ (usually 1-5 days after brand)
├── Full A2P throughput enabled
├── Dashboard updates: "SMS Compliance: Approved ✅"
└── Notification sent to tenant: "Your SMS is now fully verified!"
```

#### A2P Compliance Monitoring

```typescript
// a2p-monitoring.ts — Ongoing compliance enforcement

// Check spam complaint rates per tenant
async function monitorA2PCompliance(): Promise<void> {
  const tenants = await db.query(`
    SELECT t.id, t.company_name, a.campaign_sid, a.brand_sid
    FROM tenants t
    JOIN tenant_a2p_registrations a ON a.tenant_id = t.id
    WHERE a.campaign_status = 'approved'
  `);
  
  for (const tenant of tenants) {
    const subClient = getTenantTwilioClient(tenant.id);
    
    // Check message delivery stats
    const messages = await subClient.messages.list({
      dateSentAfter: new Date(Date.now() - 24 * 60 * 60 * 1000),
      limit: 1000
    });
    
    const total = messages.length;
    const failed = messages.filter(m => ['undelivered', 'failed'].includes(m.status)).length;
    const failureRate = total > 0 ? failed / total : 0;
    
    if (failureRate > 0.05) {  // 5% failure rate threshold
      await sendAlert({
        type: 'a2p_compliance_warning',
        tenantId: tenant.id,
        companyName: tenant.company_name,
        failureRate: `${(failureRate * 100).toFixed(1)}%`,
        totalMessages: total,
        failedMessages: failed,
        action: 'Review message content and opt-out compliance'
      });
    }
    
    if (failureRate > 0.15) {  // 15% — auto-pause sequences
      await db.query(`
        UPDATE sequence_enrollments SET status = 'paused' 
        WHERE tenant_id = $1 AND status = 'active'
      `, [tenant.id]);
      
      await sendAlert({
        type: 'a2p_compliance_critical',
        tenantId: tenant.id,
        action: 'SMS sequences auto-paused. Manual review required.'
      });
    }
  }
}

// Run every 6 hours
setInterval(monitorA2PCompliance, 6 * 60 * 60 * 1000);
```

### DB Tables — Twilio Infrastructure (TYPE B)

```sql
-- Twilio subaccount per TYPE B tenant
CREATE TABLE tenant_twilio_accounts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    account_type TEXT NOT NULL DEFAULT 'type_b_subaccount'
        CHECK (account_type IN ('type_a_byoa', 'type_b_subaccount')),
    
    -- For TYPE B: subaccount under OMINIFY's main
    subaccount_sid TEXT,               -- AC...
    auth_token_encrypted TEXT,
    
    -- For TYPE A: customer's own account (reference only)
    external_account_sid TEXT,
    
    -- Provisioned resources
    messaging_service_sid TEXT,
    
    friendly_name TEXT,
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id)
);

-- Phone numbers per tenant
CREATE TABLE tenant_phone_numbers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    twilio_account_id UUID REFERENCES tenant_twilio_accounts(id),
    
    phone_number TEXT NOT NULL,         -- E.164 format
    phone_number_sid TEXT,              -- PN...
    
    capabilities JSONB DEFAULT '{"sms": true, "voice": true, "mms": false}',
    purpose TEXT DEFAULT 'sequencer',   -- 'sequencer', 'inbound', 'dedicated'
    
    is_active BOOLEAN DEFAULT true,
    purchased_at TIMESTAMPTZ DEFAULT now()
);

-- A2P 10DLC registration tracking
CREATE TABLE tenant_a2p_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Brand (business entity)
    customer_profile_sid TEXT,          -- BU...
    brand_sid TEXT,                     -- BN...
    brand_status TEXT DEFAULT 'pending'
        CHECK (brand_status IN ('pending', 'approved', 'failed', 'suspended')),
    brand_approved_at TIMESTAMPTZ,
    
    -- Campaign (use case)
    campaign_sid TEXT,                  -- QE...
    campaign_status TEXT DEFAULT 'awaiting_brand'
        CHECK (campaign_status IN ('awaiting_brand', 'pending_approval', 'approved', 'failed', 'suspended')),
    campaign_approved_at TIMESTAMPTZ,
    
    -- Compliance metrics
    last_compliance_check TIMESTAMPTZ,
    spam_complaint_rate NUMERIC(5,4),
    
    -- Business info snapshot (what was submitted)
    registration_data JSONB,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id)
);

CREATE INDEX idx_a2p_pending ON tenant_a2p_registrations(brand_status) 
    WHERE brand_status = 'pending' OR campaign_status IN ('awaiting_brand', 'pending_approval');
```

---

## 2. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          OMINIFY PLATFORM                               │
│                                                                         │
│  ┌──────────────┐     ┌──────────────────┐     ┌────────────────────┐  │
│  │  Onboarding  │────▶│  AI Sequence     │────▶│  Sequence Store    │  │
│  │  Data (DB)   │     │  Generator       │     │  (Supabase)        │  │
│  └──────────────┘     └──────────────────┘     └────────┬───────────┘  │
│                                                          │              │
│  ┌───────────────────────────────────────────────────────┼──────────┐  │
│  │                    SEQUENCER ENGINE (VM)               │          │  │
│  │                                                        ▼          │  │
│  │  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐    │  │
│  │  │   Scheduler  │───▶│   Step       │───▶│  Channel Router  │    │  │
│  │  │   (Cron +    │    │   Evaluator  │    │                  │    │  │
│  │  │   Event)     │    │   (Conditions│    │  ┌────┐┌────┐┌──┐│    │  │
│  │  └──────────────┘    │   + Branching│    │  │SMS ││Mail││VC││    │  │
│  │                      └──────────────┘    │  └─┬──┘└─┬──┘└┬─┘│    │  │
│  │                                          └────┼─────┼────┼──┘    │  │
│  │                                               │     │    │       │  │
│  │  ┌────────────────────────────────────────────┼─────┼────┼───┐  │  │
│  │  │               QUEUE LAYER (Redis/BullMQ)   │     │    │   │  │  │
│  │  │                                            │     │    │   │  │  │
│  │  │  ┌─────────────┐  ┌──────────┐  ┌─────────┴──┐  │    │   │  │  │
│  │  │  │ sms:queue   │  │email:    │  │ vapi:queue  │  │    │   │  │  │
│  │  │  │ (standard)  │  │queue     │  │ (CONCURRENCY│  │    │   │  │  │
│  │  │  │             │  │(standard)│  │  MANAGED)   │  │    │   │  │  │
│  │  │  └──────┬──────┘  └────┬─────┘  └──────┬─────┘  │    │   │  │  │
│  │  └─────────┼──────────────┼───────────────┼─────────┘    │   │  │  │
│  │            │              │               │              │   │  │  │
│  └────────────┼──────────────┼───────────────┼──────────────┘   │  │  │
│               ▼              ▼               ▼                  │  │  │
│         ┌──────────┐  ┌──────────┐  ┌──────────────┐           │  │  │
│         │  Twilio  │  │Gmail API │  │    VAPI      │           │  │  │
│         │  API     │  │+ SMTP    │  │    API       │           │  │  │
│         └────┬─────┘  └────┬─────┘  └──────┬───────┘           │  │  │
│              │              │               │                   │  │  │
│              └──────────┬───┴───────────────┘                   │  │  │
│                         ▼                                       │  │  │
│              ┌──────────────────┐                               │  │  │
│              │  Webhook Ingress │◀── Delivery receipts,         │  │  │
│              │  (Express/Fastify│    call outcomes, replies      │  │  │
│              └────────┬─────────┘                               │  │  │
│                       │                                         │  │  │
│                       ▼                                         │  │  │
│              ┌──────────────────┐                               │  │  │
│              │  Event Processor │── Updates contact state,      │  │  │
│              │                  │   triggers branching,          │  │  │
│              │                  │   feeds analytics              │  │  │
│              └──────────────────┘                               │  │  │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Data Model

### 3.1 Core Tables (Supabase/PostgreSQL)

```sql
-- Tenant onboarding profile (populated during 30-min onboarding)
CREATE TABLE tenant_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    -- Business context
    industry TEXT NOT NULL,           -- 'home_services', 'real_estate', etc.
    sub_industry TEXT,                -- 'hvac', 'plumbing', 'roofing'
    service_area JSONB,              -- {cities: [], zip_codes: [], radius_miles: 25}
    timezone TEXT DEFAULT 'America/New_York',
    
    -- Job types & urgency tiers
    job_types JSONB NOT NULL,        -- [{name, urgency_tier, avg_ticket, keywords}]
    -- Example: [
    --   {name: "Emergency Repair", urgency_tier: "critical", avg_ticket: 350, keywords: ["leak","burst","no heat"]},
    --   {name: "System Replacement", urgency_tier: "high", avg_ticket: 12000, keywords: ["replace","install","new unit"]}
    -- ]
    
    -- Communication DNA
    brand_voice TEXT DEFAULT 'professional',  -- 'casual', 'professional', 'friendly'
    custom_phrases JSONB,            -- {always_mention: ["family-owned","24/7"], never_say: ["cheap"]}
    business_hours JSONB,            -- {weekdays: {start: "07:00", end: "19:00"}, emergency_24_7: true}
    
    -- Sequence goals
    primary_goal TEXT,               -- 'book_appointment', 'phone_qualification', 'direct_schedule'
    
    -- Lead source configs
    lead_sources JSONB,              -- [{source: "google_ads", urgency_multiplier: 1.5, connected: true}]
    
    -- AI generation metadata
    onboarding_transcript JSONB,
    onboarding_completed_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Sequences (AI-generated from onboarding, editable by tenant)
CREATE TABLE sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    
    name TEXT NOT NULL,               -- "Google Ads - Emergency Lead"
    description TEXT,
    
    -- Trigger conditions
    trigger_conditions JSONB NOT NULL,
    -- {
    --   lead_source: ["google_ads"],
    --   job_type_keywords: ["emergency","repair","broken"],
    --   urgency_tier: "critical",
    --   custom_field_matches: {}
    -- }
    
    urgency_tier TEXT NOT NULL,       -- 'critical', 'high', 'medium', 'low'
    
    -- Sequence configuration
    max_attempts INT DEFAULT 8,
    sequence_timeout_hours INT DEFAULT 168,  -- 7 days default
    respect_business_hours BOOLEAN DEFAULT true,
    
    -- AI metadata
    generated_by_ai BOOLEAN DEFAULT true,
    generation_prompt JSONB,
    
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Sequence steps (the individual actions in order)
CREATE TABLE sequence_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE,
    
    step_order INT NOT NULL,
    channel TEXT NOT NULL CHECK (channel IN ('sms', 'email', 'voice')),
    
    -- Timing
    delay_seconds INT NOT NULL DEFAULT 0,      -- delay from previous step
    delay_type TEXT DEFAULT 'after_previous',   -- 'after_previous', 'after_enrollment', 'specific_time'
    specific_time TIME,                         -- if delay_type = 'specific_time'
    
    -- Content templates (with {{variable}} placeholders)
    content JSONB NOT NULL,
    -- SMS:   {body: "Hey {{first_name}}, ..."}
    -- Email: {subject: "...", body_html: "...", body_text: "..."}
    -- Voice: {vapi_assistant_id: "...", first_message: "...", system_prompt: "...", transfer_number: "..."}
    
    -- Conditions (skip this step if...)
    skip_conditions JSONB,
    -- {
    --   skip_if: ["contact_replied", "contact_answered_call", "appointment_booked"],
    --   only_if: ["voicemail_left"],  -- only execute if this happened
    --   time_window: {not_before: "08:00", not_after: "21:00"}  -- TCPA compliance
    -- }
    
    -- Branching
    on_success JSONB,   -- {action: "continue" | "jump_to_step" | "end_sequence", target_step: 5}
    on_failure JSONB,   -- {action: "retry_after_seconds" | "skip" | "end_sequence", retry_delay: 300}
    
    created_at TIMESTAMPTZ DEFAULT now()
);

-- Contact enrollment in sequences
CREATE TABLE sequence_enrollments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
    sequence_id UUID REFERENCES sequences(id) ON DELETE CASCADE,
    contact_id UUID REFERENCES contacts(id) ON DELETE CASCADE,
    
    -- State machine
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'paused', 'completed', 'replied', 'booked', 'failed', 'manual_stop')),
    
    current_step_order INT DEFAULT 0,
    
    -- Execution tracking
    enrolled_at TIMESTAMPTZ DEFAULT now(),
    next_step_at TIMESTAMPTZ,          -- when the next step should fire
    completed_at TIMESTAMPTZ,
    
    -- Outcome tracking
    total_attempts INT DEFAULT 0,
    calls_made INT DEFAULT 0,
    sms_sent INT DEFAULT 0,
    emails_sent INT DEFAULT 0,
    
    -- Contact responded?
    contact_replied BOOLEAN DEFAULT false,
    contact_answered_call BOOLEAN DEFAULT false,
    appointment_booked BOOLEAN DEFAULT false,
    
    -- Metadata
    enrollment_source TEXT,            -- 'google_ads', 'facebook', 'webhook', 'csv_upload', 'manual'
    custom_variables JSONB,            -- per-contact overrides: {first_name, job_type, address, etc.}
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(sequence_id, contact_id)    -- prevent double-enrollment
);

-- Execution log (every action taken)
CREATE TABLE sequence_execution_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id UUID REFERENCES sequence_enrollments(id) ON DELETE CASCADE,
    step_id UUID REFERENCES sequence_steps(id),
    
    channel TEXT NOT NULL,
    action TEXT NOT NULL,               -- 'sent', 'delivered', 'failed', 'skipped', 'call_completed'
    
    -- Channel-specific results
    provider_id TEXT,                   -- Twilio SID, VAPI call ID, email message ID
    provider_response JSONB,            -- Raw response from provider
    
    -- Voice-specific
    call_duration_seconds INT,
    call_disposition TEXT,              -- 'answered', 'voicemail', 'no_answer', 'busy', 'failed'
    call_transcript TEXT,
    vapi_concurrency_used INT,          -- concurrency at time of call
    
    -- SMS-specific
    sms_status TEXT,                    -- 'queued', 'sent', 'delivered', 'failed', 'undelivered'
    
    -- Email-specific
    email_status TEXT,                  -- 'sent', 'delivered', 'opened', 'clicked', 'bounced'
    
    executed_at TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════════════════════════════
-- VAPI UMBRELLA MODEL
-- ═══════════════════════════════════════════════════════════════════
-- An "umbrella" is a single VAPI account. Multiple tenants can share
-- one umbrella (shared concurrency pool), or a tenant can have its
-- own dedicated umbrella. Tenants can be migrated between umbrellas
-- at any time without downtime.
-- ═══════════════════════════════════════════════════════════════════

-- VAPI Umbrellas (each = one VAPI account with its own API key + concurrency limit)
CREATE TABLE vapi_umbrellas (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    name TEXT NOT NULL,                  -- "Shared Pool A", "Dedicated - AcmePlumbing"
    umbrella_type TEXT NOT NULL DEFAULT 'shared'
        CHECK (umbrella_type IN ('shared', 'dedicated')),
    
    -- VAPI account credentials
    vapi_api_key_encrypted TEXT NOT NULL,
    vapi_org_id TEXT,                    -- optional, for VAPI org-level tracking
    
    -- Concurrency limits (from VAPI account)
    concurrency_limit INT NOT NULL DEFAULT 10,
    current_concurrency INT DEFAULT 0,
    
    -- Capacity planning
    max_tenants INT,                     -- NULL = unlimited, set for shared pools
    
    -- Health
    is_active BOOLEAN DEFAULT true,
    last_webhook_at TIMESTAMPTZ,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tenant ↔ Umbrella mapping (the join table that enables migration)
CREATE TABLE tenant_vapi_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    umbrella_id UUID NOT NULL REFERENCES vapi_umbrellas(id) ON DELETE RESTRICT,
    
    -- Assignment metadata
    assigned_at TIMESTAMPTZ DEFAULT now(),
    assigned_by TEXT,                    -- 'system', 'admin', 'auto_migration'
    
    -- Per-tenant soft limits WITHIN the umbrella
    -- e.g., umbrella has 10 concurrency, but this tenant is capped at 4
    -- NULL = no tenant-level cap (uses full umbrella capacity, fair-shared)
    tenant_concurrency_cap INT,
    
    -- Priority weight for fair scheduling within shared umbrellas
    -- Higher = gets more slots when competing. Default 1.0
    priority_weight NUMERIC(3,1) DEFAULT 1.0,
    
    is_active BOOLEAN DEFAULT true,
    
    created_at TIMESTAMPTZ DEFAULT now(),
    
    UNIQUE(tenant_id)  -- A tenant can only be in ONE umbrella at a time
);

-- Migration history (audit trail for umbrella moves)
CREATE TABLE vapi_umbrella_migrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES tenants(id),
    from_umbrella_id UUID REFERENCES vapi_umbrellas(id),
    to_umbrella_id UUID NOT NULL REFERENCES vapi_umbrellas(id),
    reason TEXT,                         -- 'scaling_up', 'dedicated_upgrade', 'rebalancing'
    migrated_at TIMESTAMPTZ DEFAULT now(),
    migrated_by TEXT DEFAULT 'system'
);

-- Indexes for the scheduler
CREATE INDEX idx_enrollments_next_step ON sequence_enrollments(next_step_at) 
    WHERE status = 'active';
CREATE INDEX idx_enrollments_tenant_status ON sequence_enrollments(tenant_id, status);
CREATE INDEX idx_execution_log_enrollment ON sequence_execution_log(enrollment_id, executed_at DESC);
CREATE INDEX idx_tenant_vapi_active ON tenant_vapi_assignments(tenant_id) WHERE is_active = true;
CREATE INDEX idx_umbrella_tenants ON tenant_vapi_assignments(umbrella_id) WHERE is_active = true;
```

---

## 4. Sequencer Engine — Core Components

### 4.1 Tech Stack (VM Deployment)

```
Runtime:       Node.js 20+ (TypeScript)
Queue:         BullMQ + Redis
Database:      Supabase (PostgreSQL) — existing
Cache:         Redis (shared with BullMQ)
HTTP Server:   Fastify (webhook ingress + API)
Process Mgr:   PM2 (keeps workers alive)
VM:            AWS EC2 or Azure VM (t3.medium to start)
```

**Why Node.js + BullMQ over Python + Celery?**
- BullMQ has native delayed job support (critical for "execute step at X time")
- Better VAPI SDK support (JS-first)
- Rate limiting built into BullMQ
- Your existing Supabase client works natively

### 4.2 Worker Architecture

```
PM2 Process Map:
├── scheduler-worker      (1 instance)  — Polls for due steps, dispatches to queues
├── sms-worker            (2 instances) — Processes SMS queue via Twilio
├── email-worker          (2 instances) — Processes email queue via Gmail/SMTP
├── vapi-worker           (1 instance)  — Processes voice queue with concurrency mgmt
├── webhook-server        (1 instance)  — Fastify server for inbound webhooks
└── event-processor       (1 instance)  — Processes webhook events, updates state
```

---

## 5. Channel Implementations

### 5.1 SMS — Twilio Subaccount (TYPE B Tenant Isolation)

SMS uses the tenant's own Twilio subaccount, ensuring complete isolation of numbers, compliance, and billing.

```typescript
// sms-worker.ts
import { Worker } from 'bullmq';
import twilio from 'twilio';

const smsWorker = new Worker('sms:send', async (job) => {
  const { tenantId, contactPhone, body, enrollmentId, stepId } = job.data;
  
  // Get tenant's Twilio subaccount credentials (TYPE B = subaccount under OMINIFY main)
  const tenant = await getTenantTwilioConfig(tenantId);
  
  // Use subaccount SID + auth token (NOT main account)
  // This ensures SMS is sent FROM the tenant's subaccount, 
  // using THEIR number, under THEIR A2P brand registration
  const client = twilio(tenant.subaccountSid, decrypt(tenant.authTokenEncrypted));
  
  // Check A2P registration status — warn if not yet approved
  const a2p = await getA2PStatus(tenantId);
  if (a2p.campaignStatus !== 'approved') {
    console.log(`[SMS] Tenant ${tenantId}: A2P not yet approved (${a2p.campaignStatus}). Sending at reduced throughput.`);
  }
  
  // Send via Messaging Service (which has the A2P campaign linked)
  const message = await client.messages.create({
    to: contactPhone,
    messagingServiceSid: tenant.messagingServiceSid,  // Routes through A2P-approved campaign
    body: body,
    statusCallback: `${WEBHOOK_BASE_URL}/webhooks/twilio/sms-status/${tenantId}`
  });
  
  // Log execution
  await logExecution({
    enrollmentId,
    stepId,
    channel: 'sms',
    action: 'sent',
    providerId: message.sid,
    providerResponse: message
  });
  
  return { sid: message.sid, status: message.status };
}, {
  connection: redis,
  concurrency: 10,
  limiter: {
    max: 100,
    duration: 1000
  }
});
```

### 5.2 Email — Gmail API + SMTP Fallback

Two paths depending on tenant's email setup:

```typescript
// email-worker.ts
const emailWorker = new Worker('email:send', async (job) => {
  const { tenantId, contactEmail, subject, bodyHtml, bodyText, enrollmentId, stepId } = job.data;
  
  const tenant = await getTenantEmailConfig(tenantId);
  
  let result;
  
  if (tenant.emailProvider === 'gmail') {
    // Gmail API — requires OAuth token
    result = await sendViaGmailAPI({
      accessToken: tenant.gmailAccessToken,
      refreshToken: tenant.gmailRefreshToken,
      from: tenant.fromEmail,
      to: contactEmail,
      subject,
      htmlBody: bodyHtml,
      textBody: bodyText,
    });
  } else {
    // SMTP fallback
    result = await sendViaSMTP({
      host: tenant.smtpHost,
      port: tenant.smtpPort,
      user: tenant.smtpUser,
      pass: tenant.smtpPass,
      from: tenant.fromEmail,
      to: contactEmail,
      subject,
      html: bodyHtml,
      text: bodyText,
    });
  }
  
  await logExecution({
    enrollmentId,
    stepId,
    channel: 'email',
    action: 'sent',
    providerId: result.messageId,
    providerResponse: result
  });
  
  return result;
}, {
  connection: redis,
  concurrency: 5,
  limiter: {
    max: 20,                   // Gmail: 2000/day, so ~83/hour. Be conservative.
    duration: 60000            // 20 per minute per worker
  }
});
```

### 5.3 Voice — VAPI (Umbrella-Aware Concurrency Management) ⚠️ CRITICAL

VAPI has a per-**account** concurrency limit (default 10). Multiple tenants may share one VAPI account ("umbrella"), or a tenant may have a dedicated account. The system must:

1. Track concurrency per **umbrella** (not per tenant)
2. Fair-share slots across tenants within a shared umbrella
3. Respect per-tenant soft caps within the umbrella
4. Allow migrating tenants between umbrellas with zero downtime
5. Use webhook feedback to sync ground truth

```
UMBRELLA MODEL:

Scenario A: Shared Umbrella (3 tenants, 10 concurrency)
┌─────────────────────────────────────────────────┐
│  VAPI Account "Shared Pool A"                   │
│  Concurrency Limit: 10                          │
│                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐      │
│  │ Tenant A │  │ Tenant B │  │ Tenant C │      │
│  │ cap: 4   │  │ cap: 4   │  │ cap: 4   │      │
│  │ weight:1 │  │ weight:1 │  │ weight:2 │      │
│  └──────────┘  └──────────┘  └──────────┘      │
│                                                 │
│  Fair sharing: If only Tenant C is active,      │
│  they can use all 10. If all 3 compete,         │
│  C gets more slots (higher weight).             │
└─────────────────────────────────────────────────┘

Scenario B: Dedicated Umbrella (tenant scaled up)
┌─────────────────────────────────────────────────┐
│  VAPI Account "Dedicated - AcmePlumbing"        │
│  Concurrency Limit: 10                          │
│                                                 │
│  ┌──────────────────────────────────────┐       │
│  │ Tenant A (full account)              │       │
│  │ All 10 slots exclusively theirs      │       │
│  └──────────────────────────────────────┘       │
└─────────────────────────────────────────────────┘

Migration: Tenant A moves from Shared → Dedicated
┌───────────┐          ┌───────────────┐
│ Shared    │ ──move─▶ │ Dedicated     │
│ Pool A    │          │ AcmePlumbing  │
│ (A,B,C)   │          │ (A only)      │
│ → (B,C)   │          │               │
└───────────┘          └───────────────┘
- Update tenant_vapi_assignments row
- Queued calls for A auto-route to new umbrella
- No calls dropped
```

```typescript
// vapi-umbrella-concurrency-manager.ts
import { Queue, Worker } from 'bullmq';

// ─── UMBRELLA RESOLVER: Tenant → Umbrella lookup ───

class UmbrellaResolver {
  private redis: Redis;
  private db: SupabaseClient;
  
  constructor(redis: Redis, db: SupabaseClient) {
    this.redis = redis;
    this.db = db;
  }
  
  // Cached lookup: which umbrella does this tenant belong to?
  // Cache TTL is short (30s) so migrations take effect quickly
  async getUmbrellaForTenant(tenantId: string): Promise<{
    umbrellaId: string;
    umbrellaType: 'shared' | 'dedicated';
    vapiApiKey: string;
    concurrencyLimit: number;
    tenantCap: number | null;
    priorityWeight: number;
  }> {
    const cacheKey = `umbrella:tenant:${tenantId}`;
    const cached = await this.redis.get(cacheKey);
    
    if (cached) return JSON.parse(cached);
    
    const result = await this.db.rpc('get_tenant_umbrella', { p_tenant_id: tenantId });
    // SQL function joins tenant_vapi_assignments + vapi_umbrellas
    
    if (!result.data) {
      throw new Error(`Tenant ${tenantId} has no VAPI umbrella assignment`);
    }
    
    const mapping = {
      umbrellaId: result.data.umbrella_id,
      umbrellaType: result.data.umbrella_type,
      vapiApiKey: decrypt(result.data.vapi_api_key_encrypted),
      concurrencyLimit: result.data.concurrency_limit,
      tenantCap: result.data.tenant_concurrency_cap,
      priorityWeight: result.data.priority_weight || 1.0,
    };
    
    // Short TTL — migrations invalidate this naturally within 30s
    await this.redis.set(cacheKey, JSON.stringify(mapping), 'EX', 30);
    
    return mapping;
  }
  
  // Force cache invalidation (called during migration)
  async invalidateCache(tenantId: string): Promise<void> {
    await this.redis.del(`umbrella:tenant:${tenantId}`);
  }
}

// ─── UMBRELLA CONCURRENCY TRACKER (Redis-backed, per-umbrella) ───

class VapiUmbrellaConcurrencyManager {
  private redis: Redis;
  
  constructor(redis: Redis) {
    this.redis = redis;
  }
  
  // Redis keys are now per UMBRELLA, not per tenant
  private umbrellaKey(umbrellaId: string) {
    return `vapi:umbrella:${umbrellaId}`;
  }
  
  // Track per-tenant usage WITHIN the umbrella (for fair sharing)
  private tenantUsageKey(umbrellaId: string) {
    return `vapi:umbrella:${umbrellaId}:tenant_usage`;
  }
  
  /**
   * Try to acquire a concurrency slot within the umbrella.
   * Checks both:
   *   1. Umbrella-level total concurrency
   *   2. Per-tenant soft cap (if set)
   */
  async tryAcquire(umbrellaId: string, tenantId: string, tenantCap: number | null): Promise<boolean> {
    const umbrellaKey = this.umbrellaKey(umbrellaId);
    const tenantUsageKey = this.tenantUsageKey(umbrellaId);
    
    // Atomic Lua: check umbrella limit + tenant cap, then increment both
    const script = `
      local umbrella_current = tonumber(redis.call('hget', KEYS[1], 'current') or '0')
      local umbrella_limit = tonumber(redis.call('hget', KEYS[1], 'limit') or '10')
      
      -- Check umbrella-level capacity
      if umbrella_current >= umbrella_limit then
        return 0
      end
      
      -- Check per-tenant soft cap (if set)
      local tenant_cap = tonumber(ARGV[1])
      if tenant_cap > 0 then
        local tenant_current = tonumber(redis.call('hget', KEYS[2], ARGV[2]) or '0')
        if tenant_current >= tenant_cap then
          return -1  -- -1 = umbrella has capacity, but tenant is at its cap
        end
      end
      
      -- Acquire: increment both umbrella total and tenant usage
      redis.call('hincrby', KEYS[1], 'current', 1)
      redis.call('hincrby', KEYS[2], ARGV[2], 1)
      return 1
    `;
    
    const result = await this.redis.eval(
      script, 2,
      umbrellaKey, tenantUsageKey,
      (tenantCap || 0).toString(), tenantId
    );
    
    // result: 1 = acquired, 0 = umbrella full, -1 = tenant cap hit
    return result === 1;
  }
  
  /**
   * Release a concurrency slot
   */
  async release(umbrellaId: string, tenantId: string): Promise<void> {
    const umbrellaKey = this.umbrellaKey(umbrellaId);
    const tenantUsageKey = this.tenantUsageKey(umbrellaId);
    
    const script = `
      -- Decrement umbrella total
      local current = tonumber(redis.call('hget', KEYS[1], 'current') or '0')
      if current > 0 then
        redis.call('hincrby', KEYS[1], 'current', -1)
      end
      
      -- Decrement tenant usage
      local tenant_current = tonumber(redis.call('hget', KEYS[2], ARGV[1]) or '0')
      if tenant_current > 0 then
        redis.call('hincrby', KEYS[2], ARGV[1], -1)
      end
    `;
    
    await this.redis.eval(script, 2, umbrellaKey, tenantUsageKey, tenantId);
  }
  
  /**
   * Sync from VAPI webhook (ground truth correction)
   * VAPI reports concurrency at the ACCOUNT level — this is the umbrella level
   */
  async syncFromWebhook(umbrellaId: string, reportedConcurrency: number, reportedLimit: number): Promise<void> {
    await this.redis.hmset(this.umbrellaKey(umbrellaId), {
      current: reportedConcurrency.toString(),
      limit: reportedLimit.toString(),
      last_sync: Date.now().toString()
    });
  }
  
  /**
   * Get current state for monitoring dashboard
   */
  async getUmbrellaState(umbrellaId: string): Promise<{
    current: number;
    limit: number;
    tenantBreakdown: Record<string, number>;
  }> {
    const umbrella = await this.redis.hgetall(this.umbrellaKey(umbrellaId));
    const tenantUsage = await this.redis.hgetall(this.tenantUsageKey(umbrellaId));
    
    return {
      current: parseInt(umbrella.current || '0'),
      limit: parseInt(umbrella.limit || '10'),
      tenantBreakdown: Object.fromEntries(
        Object.entries(tenantUsage).map(([k, v]) => [k, parseInt(v)])
      )
    };
  }
}

// ─── VAPI CALL QUEUE (Umbrella-Aware) ───

const vapiQueue = new Queue('vapi:calls', { connection: redis });
const umbrellaResolver = new UmbrellaResolver(redis, supabase);
const concurrencyMgr = new VapiUmbrellaConcurrencyManager(redis);

const vapiDispatcher = new Worker('vapi:calls', async (job) => {
  const { tenantId, contactPhone, assistantConfig, enrollmentId, stepId, retryCount = 0 } = job.data;
  
  // Step 1: Resolve which umbrella this tenant belongs to (cached, 30s TTL)
  const umbrella = await umbrellaResolver.getUmbrellaForTenant(tenantId);
  
  // Step 2: Try to acquire a slot in the umbrella's concurrency pool
  const slotAcquired = await concurrencyMgr.tryAcquire(
    umbrella.umbrellaId,
    tenantId,
    umbrella.tenantCap
  );
  
  if (!slotAcquired) {
    // No slot available — re-queue with backoff
    const backoffMs = Math.min(5000 * Math.pow(1.5, retryCount), 60000);
    
    await vapiQueue.add('vapi:call', {
      ...job.data,
      retryCount: retryCount + 1
    }, {
      delay: backoffMs,
      priority: job.data.urgencyPriority || 5
    });
    
    console.log(`[VAPI] Tenant ${tenantId} (umbrella: ${umbrella.umbrellaId}): At capacity. Re-queued.`);
    return { status: 'requeued', retryCount: retryCount + 1, nextAttemptMs: backoffMs };
  }
  
  // Step 3: Slot acquired — make the call using the UMBRELLA's API key
  try {
    const vapiResponse = await makeVapiCall({
      apiKey: umbrella.vapiApiKey,  // Use the umbrella's VAPI API key
      phoneNumber: contactPhone,
      assistantId: assistantConfig.assistantId,
      firstMessage: assistantConfig.firstMessage,
      systemPrompt: assistantConfig.systemPrompt,
      metadata: {
        enrollmentId,
        stepId,
        tenantId,
        umbrellaId: umbrella.umbrellaId  // CRITICAL: include for webhook routing
      },
      serverUrl: `${WEBHOOK_BASE_URL}/webhooks/vapi`
    });
    
    await logExecution({
      enrollmentId,
      stepId,
      channel: 'voice',
      action: 'call_initiated',
      providerId: vapiResponse.callId,
      providerResponse: { ...vapiResponse, umbrellaId: umbrella.umbrellaId }
    });
    
    return { status: 'call_initiated', callId: vapiResponse.callId };
    
  } catch (error) {
    // Call failed — release the umbrella slot
    await concurrencyMgr.release(umbrella.umbrellaId, tenantId);
    
    if (error.status === 429) {
      await vapiQueue.add('vapi:call', {
        ...job.data,
        retryCount: retryCount + 1
      }, { delay: 10000 });
      
      return { status: 'rate_limited_requeued' };
    }
    
    throw error;
  }
}, {
  connection: redis,
  concurrency: 5,
});

// ─── VAPI WEBHOOK HANDLER (Umbrella-Aware) ───

fastify.post('/webhooks/vapi', async (request, reply) => {
  const event = request.body;
  const { tenantId, enrollmentId, stepId, umbrellaId } = event.metadata || {};
  
  switch (event.type) {
    case 'call-ended':
    case 'call-failed': {
      // RELEASE the slot from the UMBRELLA pool (not tenant)
      await concurrencyMgr.release(umbrellaId, tenantId);
      
      // Sync ground truth at umbrella level
      if (event.concurrencyUsed !== undefined) {
        await concurrencyMgr.syncFromWebhook(
          umbrellaId,
          event.concurrencyUsed,
          event.concurrencyLimit || 10
        );
      }
      
      // Process call outcome
      await eventQueue.add('process:call-outcome', {
        tenantId,
        umbrellaId,
        enrollmentId,
        stepId,
        callId: event.callId,
        duration: event.durationSeconds,
        disposition: mapVapiDisposition(event),
        transcript: event.transcript,
        endReason: event.endReason,
        costCents: event.costCents
      });
      
      // Slot opened — kick ALL tenants in this umbrella who have queued calls
      await kickQueuedCallsForUmbrella(umbrellaId);
      
      break;
    }
    
    case 'speech-update':
    case 'transcript': {
      break;
    }
    
    case 'function-call': {
      await handleVapiFunctionCall(event);
      break;
    }
  }
  
  reply.status(200).send({ ok: true });
});

// When a slot opens on an umbrella, kick ALL waiting calls from ANY tenant on that umbrella
async function kickQueuedCallsForUmbrella(umbrellaId: string) {
  // Get all tenants on this umbrella
  const tenants = await db.query(`
    SELECT tenant_id FROM tenant_vapi_assignments 
    WHERE umbrella_id = $1 AND is_active = true
  `, [umbrellaId]);
  
  const tenantIds = new Set(tenants.map(t => t.tenant_id));
  
  // Find waiting jobs for ANY tenant on this umbrella
  const waiting = await vapiQueue.getDelayed(0, 100);
  const umbrellaJobs = waiting.filter(j => tenantIds.has(j.data.tenantId));
  
  // Sort by priority (lower = more urgent) then by age
  umbrellaJobs.sort((a, b) => (a.opts.priority || 5) - (b.opts.priority || 5));
  
  // Promote top 3 (conservative — they'll acquire slots atomically)
  for (const job of umbrellaJobs.slice(0, 3)) {
    await job.promote();
  }
}
```

#### Umbrella Migration — Zero Downtime Tenant Moves

When you want to move a tenant from a shared umbrella to a dedicated one (or between shared pools):

```typescript
// umbrella-migration.ts
async function migrateTenantToUmbrella(
  tenantId: string,
  targetUmbrellaId: string,
  reason: string = 'manual'
): Promise<void> {
  
  // 1. Get current assignment
  const current = await db.query(`
    SELECT * FROM tenant_vapi_assignments 
    WHERE tenant_id = $1 AND is_active = true
  `, [tenantId]);
  
  const fromUmbrellaId = current?.umbrella_id;
  
  // 2. Update assignment (atomic — single row update)
  await db.query(`
    UPDATE tenant_vapi_assignments 
    SET umbrella_id = $2, assigned_at = NOW(), assigned_by = 'admin'
    WHERE tenant_id = $1 AND is_active = true
  `, [tenantId, targetUmbrellaId]);
  
  // 3. Log migration
  await db.query(`
    INSERT INTO vapi_umbrella_migrations (tenant_id, from_umbrella_id, to_umbrella_id, reason)
    VALUES ($1, $2, $3, $4)
  `, [tenantId, fromUmbrellaId, targetUmbrellaId, reason]);
  
  // 4. Invalidate Redis cache (forces fresh lookup on next call)
  await umbrellaResolver.invalidateCache(tenantId);
  
  // 5. Clean up tenant usage tracking on old umbrella
  if (fromUmbrellaId) {
    await redis.hdel(`vapi:umbrella:${fromUmbrellaId}:tenant_usage`, tenantId);
  }
  
  console.log(`[MIGRATION] Tenant ${tenantId}: ${fromUmbrellaId} → ${targetUmbrellaId} (${reason})`);
  
  // NOTE: In-flight calls on the OLD umbrella will still complete normally.
  // Their webhooks will release slots on the old umbrella (umbrellaId is in metadata).
  // New calls will route to the new umbrella (cache invalidated).
  // This is inherently safe — no calls are dropped.
}

// Example: Auto-migration when tenant exceeds threshold
async function checkAutoMigration(tenantId: string): Promise<void> {
  const umbrella = await umbrellaResolver.getUmbrellaForTenant(tenantId);
  
  if (umbrella.umbrellaType !== 'shared') return; // Already dedicated
  
  // Check if this tenant is consistently maxing out their cap
  const recentQueueDepth = await getAverageQueueDepth(tenantId, '24h');
  
  if (recentQueueDepth > 5) {
    // Tenant is consistently queuing — suggest or auto-migrate to dedicated
    await notifyAdmin({
      type: 'migration_recommended',
      tenantId,
      reason: `Average queue depth: ${recentQueueDepth} calls. Consider dedicated umbrella.`,
      currentUmbrella: umbrella.umbrellaId
    });
  }
}
```

#### Fair Sharing Within Shared Umbrellas

When multiple tenants compete for slots on the same umbrella, the priority system uses both urgency tier AND tenant weight:

```typescript
// Composite priority: combines urgency + tenant weight
function getCompositePriority(urgencyTier: string, tenantWeight: number): number {
  const basePriority = {
    'critical': 1,
    'high': 3,
    'medium': 5,
    'low': 8,
  }[urgencyTier] || 5;
  
  // Higher weight = lower priority number = served first
  // Weight 2.0 effectively halves the priority number
  return Math.round(basePriority / tenantWeight);
}

// Usage when dispatching:
await vapiQueue.add('vapi:call', {
  tenantId,
  contactPhone,
  assistantConfig,
  enrollmentId,
  stepId,
  urgencyPriority: getCompositePriority(sequence.urgencyTier, umbrella.priorityWeight)
}, {
  priority: getCompositePriority(sequence.urgencyTier, umbrella.priorityWeight)
});
```

---

## 6. The Scheduler (Heart of the Engine)

The scheduler runs on a tick (every 5–10 seconds), finds enrollments where `next_step_at <= NOW()`, and dispatches steps to the appropriate channel queue.

```typescript
// scheduler-worker.ts
import cron from 'node-cron';

class SequencerScheduler {
  
  // Runs every 5 seconds
  async tick() {
    const dueEnrollments = await db.query(`
      SELECT 
        se.*,
        ss.channel,
        ss.content,
        ss.skip_conditions,
        ss.on_success,
        ss.on_failure,
        s.urgency_tier,
        s.respect_business_hours,
        c.phone,
        c.email,
        c.first_name,
        c.last_name,
        tp.timezone,
        tp.business_hours
      FROM sequence_enrollments se
      JOIN sequence_steps ss ON ss.sequence_id = se.sequence_id 
        AND ss.step_order = se.current_step_order + 1
      JOIN sequences s ON s.id = se.sequence_id
      JOIN contacts c ON c.id = se.contact_id
      JOIN tenant_profiles tp ON tp.tenant_id = se.tenant_id
      WHERE se.status = 'active'
        AND se.next_step_at <= NOW()
      ORDER BY se.next_step_at ASC
      LIMIT 100
      FOR UPDATE SKIP LOCKED
    `);
    
    for (const enrollment of dueEnrollments) {
      await this.processStep(enrollment);
    }
  }
  
  async processStep(enrollment: any) {
    // 1. Check skip conditions
    if (await this.shouldSkip(enrollment)) {
      await this.advanceToNextStep(enrollment);
      return;
    }
    
    // 2. Check business hours (for voice + SMS)
    if (enrollment.respect_business_hours && 
        enrollment.channel !== 'email' &&
        !this.isWithinBusinessHours(enrollment.timezone, enrollment.business_hours)) {
      // Reschedule to next business hours window
      const nextWindow = this.getNextBusinessHoursStart(enrollment.timezone, enrollment.business_hours);
      await this.rescheduleStep(enrollment.id, nextWindow);
      return;
    }
    
    // 3. TCPA check (no calls/texts before 8am or after 9pm contact's local time)
    if (['sms', 'voice'].includes(enrollment.channel)) {
      if (!this.isTCPACompliant(enrollment.timezone)) {
        const nextCompliant = this.getNextTCPAWindow(enrollment.timezone);
        await this.rescheduleStep(enrollment.id, nextCompliant);
        return;
      }
    }
    
    // 4. Render template with variables
    const renderedContent = this.renderTemplate(enrollment.content, {
      first_name: enrollment.first_name,
      last_name: enrollment.last_name,
      company: enrollment.company_name,
      ...enrollment.custom_variables
    });
    
    // 5. Dispatch to channel queue
    switch (enrollment.channel) {
      case 'sms':
        await smsQueue.add('sms:send', {
          tenantId: enrollment.tenant_id,
          contactPhone: enrollment.phone,
          body: renderedContent.body,
          enrollmentId: enrollment.id,
          stepId: enrollment.step_id,
        });
        break;
        
      case 'email':
        await emailQueue.add('email:send', {
          tenantId: enrollment.tenant_id,
          contactEmail: enrollment.email,
          subject: renderedContent.subject,
          bodyHtml: renderedContent.body_html,
          bodyText: renderedContent.body_text,
          enrollmentId: enrollment.id,
          stepId: enrollment.step_id,
        });
        break;
        
      case 'voice':
        await vapiQueue.add('vapi:call', {
          tenantId: enrollment.tenant_id,
          contactPhone: enrollment.phone,
          assistantConfig: renderedContent,
          enrollmentId: enrollment.id,
          stepId: enrollment.step_id,
          urgencyPriority: getCallPriority(enrollment.urgency_tier),
        }, {
          priority: getCallPriority(enrollment.urgency_tier)
        });
        break;
    }
    
    // 6. Advance enrollment state
    await this.advanceToNextStep(enrollment);
  }
  
  async advanceToNextStep(enrollment: any) {
    const nextStep = await db.query(`
      SELECT * FROM sequence_steps 
      WHERE sequence_id = $1 AND step_order = $2
    `, [enrollment.sequence_id, enrollment.current_step_order + 2]);
    
    if (!nextStep) {
      // Sequence complete
      await db.query(`
        UPDATE sequence_enrollments 
        SET status = 'completed', completed_at = NOW(), updated_at = NOW()
        WHERE id = $1
      `, [enrollment.id]);
      return;
    }
    
    // Calculate next step time
    const nextStepAt = this.calculateNextStepTime(nextStep, enrollment);
    
    await db.query(`
      UPDATE sequence_enrollments 
      SET current_step_order = current_step_order + 1,
          next_step_at = $2,
          total_attempts = total_attempts + 1,
          updated_at = NOW()
      WHERE id = $1
    `, [enrollment.id, nextStepAt]);
  }
}

// Start scheduler
const scheduler = new SequencerScheduler();
setInterval(() => scheduler.tick(), 5000); // Every 5 seconds
```

---

## 7. Event Processing — Closing the Loop

When webhooks come in (call ended, SMS delivered, email opened, reply received), the event processor updates enrollment state and triggers branching logic.

```typescript
// event-processor.ts
const eventWorker = new Worker('events:process', async (job) => {
  const event = job.data;
  
  switch (event.type) {
    case 'call-outcome': {
      const { enrollmentId, disposition, transcript } = event;
      
      // Update enrollment
      await db.query(`
        UPDATE sequence_enrollments 
        SET calls_made = calls_made + 1,
            contact_answered_call = CASE WHEN $2 = 'answered' THEN true ELSE contact_answered_call END,
            updated_at = NOW()
        WHERE id = $1
      `, [enrollmentId, disposition]);
      
      // If answered and appointment booked (detected from transcript or function call)
      if (disposition === 'answered' && event.appointmentBooked) {
        await db.query(`
          UPDATE sequence_enrollments 
          SET status = 'booked', appointment_booked = true, completed_at = NOW()
          WHERE id = $1
        `, [enrollmentId]);
        // Stop all future steps
      }
      
      // If answered but didn't book — might trigger a different branch
      if (disposition === 'answered' && !event.appointmentBooked) {
        // Could enroll in "warm follow-up" sequence
      }
      
      break;
    }
    
    case 'sms-reply': {
      const { enrollmentId, messageBody } = event;
      
      // AI classification of reply intent
      const intent = await classifyReplyIntent(messageBody);
      // 'interested', 'not_interested', 'reschedule', 'stop', 'question'
      
      if (intent === 'stop') {
        await db.query(`
          UPDATE sequence_enrollments SET status = 'manual_stop' WHERE id = $1
        `, [enrollmentId]);
        // Add to opt-out list
      } else if (intent === 'interested') {
        await db.query(`
          UPDATE sequence_enrollments SET contact_replied = true WHERE id = $1
        `, [enrollmentId]);
        // Notify tenant: "Hot lead replied!"
      }
      
      break;
    }
    
    case 'email-opened':
    case 'email-clicked': {
      // Track engagement, may influence step branching
      break;
    }
  }
}, { connection: redis });
```

---

## 8. AI Sequence Generation (From Onboarding Data)

This is the magic — after the 30-minute onboarding, AI generates the full sequence set.

```typescript
// ai-sequence-generator.ts
async function generateSequencesFromOnboarding(tenantId: string): Promise<void> {
  const profile = await getTenantProfile(tenantId);
  
  const prompt = `
You are a marketing automation expert. Based on this business profile, generate 
optimized multi-channel follow-up sequences.

BUSINESS PROFILE:
- Industry: ${profile.industry} (${profile.sub_industry})
- Service area: ${JSON.stringify(profile.service_area)}
- Job types: ${JSON.stringify(profile.job_types)}
- Brand voice: ${profile.brand_voice}
- Custom phrases: ${JSON.stringify(profile.custom_phrases)}
- Business hours: ${JSON.stringify(profile.business_hours)}
- Primary goal: ${profile.primary_goal}
- Lead sources: ${JSON.stringify(profile.lead_sources)}

RULES:
1. Generate one sequence per (lead_source × urgency_tier) combination
2. Critical urgency: 6-8 touches in first 4 hours, aggressive multi-channel
3. High urgency: 5-6 touches in 24 hours
4. Medium urgency: 4-5 touches over 48 hours  
5. Low urgency: 3-4 touches over 2 weeks
6. Always start with a voice call for critical/high urgency
7. SMS within 2 minutes if call not answered
8. Respect TCPA: no calls/texts before 8am or after 9pm local time
9. Include the brand's custom phrases naturally
10. Voice scripts should be conversational, not robotic
11. Always include a "Why We Lost" feedback touchpoint at sequence end

OUTPUT FORMAT:
Return a JSON array of sequences, each with steps. Follow this exact schema:
{
  sequences: [{
    name: string,
    trigger_conditions: { lead_source: string[], job_type_keywords: string[], urgency_tier: string },
    steps: [{
      step_order: number,
      channel: "sms" | "email" | "voice",
      delay_seconds: number,
      delay_type: "after_previous",
      content: {
        // SMS: { body: string }
        // Email: { subject: string, body_html: string, body_text: string }
        // Voice: { first_message: string, system_prompt: string }
      },
      skip_conditions: { skip_if: string[] },
      on_success: { action: string },
      on_failure: { action: string }
    }]
  }]
}
`;

  const aiResponse = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    temperature: 0.7
  });
  
  const generated = JSON.parse(aiResponse.choices[0].message.content);
  
  // Persist generated sequences to DB
  for (const seq of generated.sequences) {
    const sequenceId = await db.query(`
      INSERT INTO sequences (tenant_id, name, trigger_conditions, urgency_tier, generated_by_ai, generation_prompt)
      VALUES ($1, $2, $3, $4, true, $5)
      RETURNING id
    `, [tenantId, seq.name, seq.trigger_conditions, seq.trigger_conditions.urgency_tier, prompt]);
    
    for (const step of seq.steps) {
      await db.query(`
        INSERT INTO sequence_steps (sequence_id, step_order, channel, delay_seconds, delay_type, content, skip_conditions, on_success, on_failure)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      `, [sequenceId, step.step_order, step.channel, step.delay_seconds, step.delay_type, step.content, step.skip_conditions, step.on_success, step.on_failure]);
    }
  }
}
```

---

## 9. Lead Ingestion — Trigger Enrollment

```typescript
// lead-ingestion.ts

// Google Ads webhook
fastify.post('/webhooks/leads/google-ads', async (req, reply) => {
  const lead = parseGoogleAdsLead(req.body);
  await ingestLead(lead, 'google_ads');
  reply.status(200).send({ ok: true });
});

// Facebook Lead Ads webhook  
fastify.post('/webhooks/leads/facebook', async (req, reply) => {
  const lead = parseFacebookLead(req.body);
  await ingestLead(lead, 'facebook');
  reply.status(200).send({ ok: true });
});

// Generic webhook
fastify.post('/webhooks/leads/generic/:tenantId', async (req, reply) => {
  await ingestLead({ ...req.body, tenantId: req.params.tenantId }, 'webhook');
  reply.status(200).send({ ok: true });
});

// CSV upload (processed async)
fastify.post('/api/leads/csv-upload', async (req, reply) => {
  // Parse CSV, validate, then batch enroll
  const contacts = parseCSV(req.body.file);
  for (const contact of contacts) {
    await ingestLead({ ...contact, tenantId: req.body.tenantId }, 'csv_upload');
  }
  reply.status(200).send({ imported: contacts.length });
});

// Core ingestion logic
async function ingestLead(leadData: any, source: string) {
  const { tenantId } = leadData;
  
  // 1. Upsert contact
  const contact = await upsertContact(tenantId, leadData);
  
  // 2. Find matching sequence based on trigger conditions
  const sequences = await db.query(`
    SELECT * FROM sequences 
    WHERE tenant_id = $1 AND is_active = true
    ORDER BY urgency_tier ASC
  `, [tenantId]);
  
  const matchingSequence = sequences.find(seq => {
    const conditions = seq.trigger_conditions;
    
    // Match lead source
    if (conditions.lead_source && !conditions.lead_source.includes(source)) return false;
    
    // Match job type keywords (if lead data includes search terms or form data)
    if (conditions.job_type_keywords && leadData.keywords) {
      const hasMatch = conditions.job_type_keywords.some(kw => 
        leadData.keywords.toLowerCase().includes(kw.toLowerCase())
      );
      if (!hasMatch) return false;
    }
    
    return true;
  });
  
  if (!matchingSequence) {
    // Enroll in default sequence
    console.log(`[LEAD] No matching sequence for tenant ${tenantId}, source ${source}`);
    return;
  }
  
  // 3. Enroll in sequence
  const firstStep = await db.query(`
    SELECT * FROM sequence_steps 
    WHERE sequence_id = $1 ORDER BY step_order LIMIT 1
  `, [matchingSequence.id]);
  
  const nextStepAt = new Date(Date.now() + (firstStep.delay_seconds * 1000));
  
  await db.query(`
    INSERT INTO sequence_enrollments 
      (tenant_id, sequence_id, contact_id, status, current_step_order, next_step_at, enrollment_source, custom_variables)
    VALUES ($1, $2, $3, 'active', 0, $4, $5, $6)
    ON CONFLICT (sequence_id, contact_id) DO NOTHING
  `, [tenantId, matchingSequence.id, contact.id, nextStepAt, source, leadData.customVariables || {}]);
  
  console.log(`[LEAD] Enrolled contact ${contact.id} in sequence "${matchingSequence.name}" (${matchingSequence.urgency_tier})`);
}
```

---

## 10. VM Deployment

### 10.1 Infrastructure

```yaml
# docker-compose.yml
version: '3.8'

services:
  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis-data:/data
    command: redis-server --appendonly yes --maxmemory 512mb --maxmemory-policy allkeys-lru
    restart: always

  sequencer:
    build: .
    depends_on:
      - redis
    environment:
      - NODE_ENV=production
      - REDIS_URL=redis://redis:6379
      - SUPABASE_URL=${SUPABASE_URL}
      - SUPABASE_SERVICE_KEY=${SUPABASE_SERVICE_KEY}
      - VAPI_API_KEY=${VAPI_API_KEY}
      - WEBHOOK_BASE_URL=${WEBHOOK_BASE_URL}
    ports:
      - "3000:3000"    # Webhook server
      - "3001:3001"    # Admin/health API
    volumes:
      - ./logs:/app/logs
    restart: always

volumes:
  redis-data:
```

### 10.2 PM2 Ecosystem

```javascript
// ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'scheduler',
      script: './dist/workers/scheduler-worker.js',
      instances: 1,
      max_memory_restart: '500M',
    },
    {
      name: 'sms-worker',
      script: './dist/workers/sms-worker.js',
      instances: 2,
      max_memory_restart: '300M',
    },
    {
      name: 'email-worker',
      script: './dist/workers/email-worker.js',
      instances: 2,
      max_memory_restart: '300M',
    },
    {
      name: 'vapi-worker',
      script: './dist/workers/vapi-worker.js',
      instances: 1,                    // Single instance — concurrency managed by Redis
      max_memory_restart: '500M',
    },
    {
      name: 'webhook-server',
      script: './dist/server/webhook-server.js',
      instances: 1,
      max_memory_restart: '300M',
    },
    {
      name: 'event-processor',
      script: './dist/workers/event-processor.js',
      instances: 1,
      max_memory_restart: '300M',
    }
  ]
};
```

### 10.3 Recommended VM Sizing

| Scale | Tenants | VM Size | Monthly Cost |
|-------|---------|---------|-------------|
| Start | 1–20 | AWS t3.medium (2 vCPU, 4GB) | ~$30/mo |
| Growth | 20–100 | AWS t3.large (2 vCPU, 8GB) | ~$60/mo |
| Scale | 100–500 | AWS c5.xlarge (4 vCPU, 8GB) | ~$120/mo |
| Heavy | 500+ | Split into microservices | Variable |

---

## 11. Monitoring & Health Checks

```typescript
// health-api.ts
fastify.get('/health', async () => {
  // Get all umbrella states
  const umbrellas = await db.query('SELECT id, name, umbrella_type FROM vapi_umbrellas WHERE is_active = true');
  const umbrellaStates = {};
  
  for (const u of umbrellas) {
    umbrellaStates[u.name] = await concurrencyMgr.getUmbrellaState(u.id);
  }
  
  return {
    status: 'ok',
    queues: {
      sms: await smsQueue.getJobCounts(),
      email: await emailQueue.getJobCounts(),
      vapi: await vapiQueue.getJobCounts(),
      events: await eventQueue.getJobCounts(),
    },
    vapiUmbrellas: umbrellaStates,
    // Example output:
    // "Shared Pool A": { current: 7, limit: 10, tenantBreakdown: { "tenant-1": 3, "tenant-2": 2, "tenant-3": 2 } }
    // "Dedicated - AcmePlumbing": { current: 4, limit: 10, tenantBreakdown: { "tenant-4": 4 } }
    scheduler: {
      lastTick: schedulerLastTick,
      dueEnrollments: await countDueEnrollments()
    }
  };
});

// Alert if any umbrella is consistently at capacity
setInterval(async () => {
  const umbrellas = await db.query('SELECT id, name FROM vapi_umbrellas WHERE is_active = true');
  
  for (const u of umbrellas) {
    const state = await concurrencyMgr.getUmbrellaState(u.id);
    
    // Umbrella at 90%+ capacity
    if (state.current >= state.limit * 0.9) {
      await sendAlert(`VAPI umbrella "${u.name}" at ${state.current}/${state.limit} concurrency. Tenant breakdown: ${JSON.stringify(state.tenantBreakdown)}`);
    }
  }
  
  // Global queue check
  const vapiWaiting = await vapiQueue.getWaitingCount();
  const vapiDelayed = await vapiQueue.getDelayedCount();
  if (vapiWaiting + vapiDelayed > 100) {
    await sendAlert(`VAPI queue backed up: ${vapiWaiting} waiting, ${vapiDelayed} delayed`);
  }
}, 60000);

// Admin API: View umbrella assignments
fastify.get('/admin/umbrellas', async () => {
  return await db.query(`
    SELECT 
      u.id, u.name, u.umbrella_type, u.concurrency_limit,
      COUNT(a.tenant_id) as tenant_count,
      json_agg(json_build_object('tenant_id', a.tenant_id, 'cap', a.tenant_concurrency_cap, 'weight', a.priority_weight)) as tenants
    FROM vapi_umbrellas u
    LEFT JOIN tenant_vapi_assignments a ON a.umbrella_id = u.id AND a.is_active = true
    WHERE u.is_active = true
    GROUP BY u.id
  `);
});

// Admin API: Migrate tenant
fastify.post('/admin/umbrellas/migrate', async (req) => {
  const { tenantId, targetUmbrellaId, reason } = req.body;
  await migrateTenantToUmbrella(tenantId, targetUmbrellaId, reason);
  return { ok: true, tenantId, newUmbrella: targetUmbrellaId };
});
```

---

## 12. Key Design Decisions Summary

| Decision | Choice | Why |
|----------|--------|-----|
| Queue system | BullMQ + Redis | Native delayed jobs, priority queues, rate limiting |
| VAPI concurrency | Umbrella-level Redis Lua scripts + webhook sync | Atomic, supports shared + dedicated accounts, ground truth sync |
| Umbrella model | Tenant ↔ Umbrella mapping with migration support | Flexible: start shared, graduate to dedicated. Zero-downtime moves |
| Fair sharing | Priority weight + tenant soft caps | Prevents one noisy tenant from starving others on shared umbrella |
| Scheduler poll interval | 5 seconds | Balance between responsiveness and DB load |
| VM over serverless | Docker on EC2/Azure | Long-running workers, WebSocket support for VAPI, full control |
| Single VAPI worker | 1 instance | Concurrency managed at Redis level, not process level |
| Priority queuing | Urgency-tier × tenant weight | Emergency leads first, weighted by tenant tier |
| TCPA compliance | Built into scheduler | Check before dispatch, reschedule if outside window |
| Idempotency | UNIQUE constraint on enrollments | Prevent double-enrollment from webhook retries |
| Cache TTL for umbrella lookup | 30 seconds | Fast enough for migrations, avoids DB hit per call |
