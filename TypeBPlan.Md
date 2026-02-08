Context
OMINIFY CRM currently supports only TYPE A (Custom) clients — agencies that provide their own Vapi API key. The ominify-sequencer-design.md specifies a TYPE B (Umbrella) system where self-serve SaaS clients use agency-managed credentials, get Twilio subaccounts auto-provisioned, and run AI-generated multi-channel sequences (SMS + Email + Voice).
What exists: Full Type A stack — client CRUD, Vapi webhook handler (755 lines), billing system, contacts CRM, agent management, Stripe integration, RBAC. The clients.account_type column already supports 'UMBRELLA' but the UI option is commented out and zero business logic exists for it.
What we're building: The TYPE B client infrastructure within the existing Next.js app — database tables, admin management UI, tenant onboarding, umbrella management, Twilio integration, and sequence management UI.

Phase 1: Database Schema (run SQL in Supabase)
Create: supabase/type-b-schema.sql
11 new tables matching the design doc:

vapi_umbrellas — Agency VAPI accounts with concurrency limits
tenant_vapi_assignments — Client ↔ umbrella mapping (UNIQUE on client_id)
vapi_umbrella_migrations — Audit trail for umbrella moves
tenant_profiles — Business context, job types, brand voice, hours, lead sources (UNIQUE on client_id)
tenant_twilio_accounts — Twilio subaccount per tenant (UNIQUE on client_id)
tenant_phone_numbers — Phone numbers per tenant (UNIQUE on phone_number)
tenant_a2p_registrations — A2P 10DLC brand + campaign tracking
sequences — Sequence definitions with trigger conditions
sequence_steps — Individual steps (sms/email/voice/wait/condition) with timing + branching
sequence_enrollments — Contact enrollment state machine (UNIQUE on sequence_id + contact_id)
sequence_execution_log — Every action taken with results + cost tracking

Plus all indexes (especially idx_sequence_enrollments_next_action for the scheduler) and RLS enabled on all tables.

Phase 2: Admin UI — TYPE B Client Creation + Umbrella Management
2A: Modify Create Client Dialog
Modify: src/components/admin/create-client-dialog.tsx

Uncomment line 58: <option value="UMBRELLA">Type B (Umbrella)</option>
Add useState for account type selection
When UMBRELLA selected: hide Vapi Key field, show umbrella dropdown + reserved concurrency input
Umbrella list fetched from vapi_umbrellas via server action

Modify: src/app/actions/client-actions.ts

Make vapi_key optional when type === 'UMBRELLA'
After client insert, for UMBRELLA: create tenant_vapi_assignments row, create empty tenant_profiles row, set client's vapi_key and vapi_org_id from the umbrella's credentials

2B: Differentiate Client Cards
Modify: src/app/admin/clients/page.tsx

CUSTOM → gray pill, show masked vapi_key
UMBRELLA → indigo pill, show assigned umbrella name + onboarding status
Join tenant_vapi_assignments + vapi_umbrellas + tenant_profiles in the query

2C: Umbrella Management Admin Page
Create: src/app/admin/umbrellas/page.tsx — Summary cards + umbrella table + tenant assignments
Create: src/components/admin/create-umbrella-dialog.tsx — Name, Vapi API Key, Max Concurrency
Create: src/components/admin/umbrella-tenant-list.tsx — Tenants per umbrella with concurrency
Create: src/components/admin/migrate-tenant-dialog.tsx — Move tenant between umbrellas
Create: src/app/actions/umbrella-actions.ts — createUmbrella, getUmbrellas, migrateTenant, deactivateUmbrella
Create: src/lib/umbrella.ts — Concurrency utilities
Modify: src/components/layout/admin-sidebar.tsx — Add "Umbrellas" nav item (between Clients and Billing), using Umbrella icon from lucide-react

Phase 3: Tenant Profile + Onboarding Wizard
Create: src/app/client/[clientId]/onboarding/page.tsx — Server component, UMBRELLA-only gate
Create: src/components/onboarding/onboarding-wizard.tsx — Multi-step form (6 steps)
Create step components in src/components/onboarding/steps/:

business-identity-step.tsx — Name, industry, description, website
service-details-step.tsx — Service area, job types, typical job values
brand-voice-step.tsx — Voice tone, greeting style, custom phrases
business-hours-step.tsx — Weekly schedule + timezone picker
lead-config-step.tsx — Lead sources, qualification criteria
review-step.tsx — Summary + complete button

Create: src/app/actions/tenant-profile-actions.ts — getTenantProfile, saveTenantProfile, completeOnboarding
Modify: src/components/layout/sidebar.tsx — Conditionally add "Sequences" (GitBranch icon, already imported) and "Phone Numbers" (Phone icon, already imported) nav items for UMBRELLA clients. Fetch account_type from client record.

Phase 4: Twilio Infrastructure
Create: src/lib/twilio.ts — API wrapper: createSubaccount, purchasePhoneNumber, releasePhoneNumber, listAvailableNumbers, registerBrand, registerCampaign, checkBrandStatus, checkCampaignStatus
Create: src/app/actions/twilio-actions.ts — provisionTwilioSubaccount, purchasePhoneNumberForClient, releasePhoneNumberForClient, startA2PRegistration, checkA2PStatus
Create: src/app/client/[clientId]/phone-numbers/page.tsx — Phone number management (UMBRELLA only)
Create: src/components/phone-numbers/phone-numbers-manager.tsx — List numbers + purchase UI
Create: src/components/phone-numbers/a2p-status-card.tsx — A2P registration progress
Create: src/app/api/webhooks/twilio/route.ts — Inbound SMS + delivery status webhooks
Dependency: npm install twilio
Env vars needed: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN

Phase 5: Sequence Management UI
Create: src/app/client/[clientId]/sequences/page.tsx — Sequences list (server component)
Create: src/app/client/[clientId]/sequences/[sequenceId]/page.tsx — Sequence detail
Create components in src/components/sequences/:

sequences-page-client.tsx — List with stats cards, active/inactive toggle
create-sequence-dialog.tsx — Name, trigger type, description
sequence-detail.tsx — Detail view with step timeline + enrollments
sequence-step-timeline.tsx — Visual vertical timeline with icons per action type
sequence-step-editor.tsx — Edit step (action type, content template, timing, branching)
enrollment-table.tsx — Contacts enrolled with status + actions
execution-log-table.tsx — Execution history

Create: src/app/actions/sequence-actions.ts — Full CRUD: createSequence, updateSequence, toggleSequenceActive, deleteSequence, addSequenceStep, updateSequenceStep, deleteSequenceStep, reorderSequenceSteps, enrollContact, unenrollContact, getEnrollments, getExecutionLog
Create: src/app/api/client/[clientId]/sequences/route.ts — API route for sequencer engine

Phase 6: Webhook Handler Update
Modify: src/app/api/webhooks/vapi/route.ts

Enhance getClientIdByOrgId to handle shared umbrella org IDs
Current: direct org → client lookup (works for Type A)
New: if no Type A match, resolve via agents.vapi_id → agents.client_id using the call's assistantId
Fully backwards-compatible — Type A unchanged


Files Summary
ActionCountFilesNew SQL1supabase/type-b-schema.sqlNew Pages5onboarding, phone-numbers, sequences list, sequence detail, admin umbrellasNew Components~18onboarding steps (6), phone-numbers (2), sequences (7), admin (3)New Server Actions4umbrella, tenant-profile, twilio, sequence actionsNew Lib Modules2twilio.ts, umbrella.tsNew API Routes2twilio webhook, sequences APIModified Files6create-client-dialog, client-actions, admin clients page, admin-sidebar, sidebar, vapi webhook

Verification Plan

DB: Run type-b-schema.sql in Supabase SQL editor, verify all 11 tables created
Admin: Create umbrella → create UMBRELLA client → verify assignment + profile rows created
Onboarding: Navigate to /client/[id]/onboarding, complete wizard, verify tenant_profiles populated
Sidebar: Verify UMBRELLA clients see Sequences + Phone Numbers nav items; CUSTOM clients don't
Sequences: Create sequence → add steps → enroll contact → verify all DB records
Webhook: Send test Vapi webhook with umbrella org_id → verify correct client resolution
Twilio (if credentials available): Provision subaccount → purchase number → verify records