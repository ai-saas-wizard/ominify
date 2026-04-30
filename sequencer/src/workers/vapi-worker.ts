/**
 * VAPI Worker
 * 
 * Processes outbound voice call jobs from the vapi:calls queue.
 * Critical feature: umbrella-aware concurrency management.
 * 
 * Key behaviors:
 * - Acquires slot from umbrella before making call
 * - Re-queues with backoff if at capacity
 * - Uses priority based on urgency tier
 * - Releases slot when call ends (via webhook)
 */

import 'dotenv/config';
import { Worker, Job } from 'bullmq';
import { supabase } from '../lib/db.js';
import { redisConnection, vapiQueue } from '../lib/redis.js';
import { umbrellaResolver } from '../lib/umbrella-resolver.js';
import { concurrencyManager } from '../lib/concurrency-manager.js';
import { recordInteraction } from '../lib/conversation-memory.js';
import { canPlaceCall } from '../lib/access.js';
import { getCallTimeVariables } from '../lib/call-variables.js';
import type { VapiJobPayload, VoiceContent, InlineVapiAgent } from '../lib/types.js';

const WEBHOOK_BASE_URL = process.env.WEBHOOK_BASE_URL || 'http://localhost:3000';
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 30000; // 30 seconds

/**
 * Log execution to database
 */
async function logExecution(params: {
    enrollmentId: string;
    stepId: string;
    channel: string;
    action: string;
    providerId: string;
    providerResponse: any;
    callDuration?: number;
    callStatus?: string;
}): Promise<void> {
    try {
        await supabase.from('sequence_execution_log').insert({
            enrollment_id: params.enrollmentId,
            step_id: params.stepId,
            channel: params.channel,
            action: params.action,
            provider_id: params.providerId,
            provider_response: params.providerResponse,
            call_duration_seconds: params.callDuration,
            call_status: params.callStatus,
            executed_at: new Date().toISOString(),
        });
    } catch (error) {
        console.error('[VAPI] Error logging execution:', error);
    }
}

/**
 * Make a VAPI call
 *
 * Dispatch priority:
 * 1. inlineAgent (from blueprint) — tenant's real voice/model + dynamic prompt
 * 2. Legacy assistantId path — fixed VAPI agent (only override_variables survive)
 * 3. Legacy inline fallback — hardcoded voice/model (old behavior)
 */
async function makeVapiCall(
    vapiApiKey: string,
    phoneNumber: string,
    assistantConfig: VoiceContent,
    tenantId: string,
    umbrellaId: string,
    enrollmentId: string,
    outboundPhoneNumberId?: string,
    inlineAgent?: InlineVapiAgent
): Promise<{ callId: string }> {
    // Resolve currentDate + tenantTimezone for {{currentDate}} /
    // {{tenantTimezone}} interpolation in the assistant's system prompt.
    let callVars: { currentDate: string; tenantTimezone: string } | null = null;
    try {
        callVars = await getCallTimeVariables(tenantId);
    } catch (err) {
        console.warn('[VAPI] Failed to resolve call-time variables, continuing without:', err);
    }

    const requestBody: any = {
        phoneNumberId: outboundPhoneNumberId || null,
        customer: {
            number: phoneNumber,
        },
        serverUrl: `${WEBHOOK_BASE_URL}/webhooks/vapi/call-events`,
        serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET || 'ominify-secret',
        metadata: {
            tenantId,
            umbrellaId,
            enrollmentId,
        },
    };

    // Resolve contact-level variables for this enrollment. The outbound RE
    // agent (and any other tenant-shaped agent) reads {{contact_data}} as a
    // JSON blob of everything we know about this seller, plus
    // {{contact_field_legend}} describing what each key means (pulled from the
    // tenant's contact_fields definitions). We also expose top-level
    // {{contact_name}} / {{contact_phone}} / {{contact_email}}.
    let contactVariables: Record<string, string> = {};
    try {
        const { data: enrollmentRow } = await supabase
            .from('sequence_enrollments')
            .select('contact_id')
            .eq('id', enrollmentId)
            .single();

        if (enrollmentRow?.contact_id) {
            const [{ data: contact }, { data: fieldDefs }] = await Promise.all([
                supabase
                    .from('contacts')
                    .select('name, phone, email, custom_fields')
                    .eq('id', enrollmentRow.contact_id)
                    .single(),
                supabase
                    .from('contact_fields')
                    .select('field_key, name, description, field_type')
                    .eq('client_id', tenantId),
            ]);

            if (contact) {
                const customFields =
                    (contact.custom_fields as Record<string, any>) || {};
                const fieldKeys = Object.keys(customFields);

                // Build a key → {name, description, type} map from definitions
                const defByKey = new Map<
                    string,
                    { name: string; description: string | null; type: string }
                >();
                for (const def of (fieldDefs as any[]) || []) {
                    defByKey.set(def.field_key, {
                        name: def.name,
                        description: def.description,
                        type: def.field_type,
                    });
                }

                // Legend lines: prefer "- key (Display Name, type): description"
                // when a definition exists; fall back to bare key for keys
                // that haven't been described yet.
                const legendLines = fieldKeys.map((k) => {
                    const def = defByKey.get(k);
                    if (!def) return `- ${k}`;
                    const head = def.name
                        ? `${k} (${def.name}${def.type ? `, ${def.type}` : ''})`
                        : k;
                    return def.description
                        ? `- ${head}: ${def.description}`
                        : `- ${head}`;
                });

                contactVariables = {
                    contact_data: JSON.stringify(customFields),
                    contact_field_legend: legendLines.length
                        ? legendLines.join('\n')
                        : '(no custom fields populated for this contact)',
                    contact_name: (contact.name as string) || '',
                    contact_phone: (contact.phone as string) || '',
                    contact_email: (contact.email as string) || '',
                };
            }
        }
    } catch (err) {
        console.warn('[VAPI] Failed to resolve contact variables, continuing without:', err);
    }

    // Build base assistantOverrides.variableValues — merged into whichever
    // dispatch path we take below.
    const baseVariableValues: Record<string, any> = {
        ...(callVars
            ? { currentDate: callVars.currentDate, tenantTimezone: callVars.tenantTimezone }
            : {}),
        ...contactVariables,
    };

    // Always attach assistantOverrides.variableValues when we have any —
    // VAPI applies these to both `assistant` inline configs and `assistantId`
    // references, and ignores them otherwise.
    if (Object.keys(baseVariableValues).length > 0) {
        requestBody.assistantOverrides = {
            ...(requestBody.assistantOverrides || {}),
            variableValues: {
                ...(requestBody.assistantOverrides?.variableValues || {}),
                ...baseVariableValues,
            },
        };
    }

    if (inlineAgent) {
        // ── PATH 1: Blueprint inline agent (preferred)
        // Merge per-contact variables (from enrollment.custom_variables) into
        // assistantOverrides.variableValues so VAPI substitutes {{var}} at call time.
        if (inlineAgent.variableValues && Object.keys(inlineAgent.variableValues).length > 0) {
            requestBody.assistantOverrides = {
                ...(requestBody.assistantOverrides || {}),
                variableValues: {
                    ...(requestBody.assistantOverrides?.variableValues || {}),
                    ...inlineAgent.variableValues,
                },
            };
        }

        // Uses tenant's real voice, model, and dynamic prompt from the blueprint
        requestBody.assistant = {
            firstMessage: inlineAgent.firstMessage,
            model: {
                provider: inlineAgent.model.provider,
                model: inlineAgent.model.model,
                systemPrompt: inlineAgent.model.systemPrompt,
                temperature: inlineAgent.model.temperature,
                tools: inlineAgent.tools,
            },
            voice: {
                provider: inlineAgent.voice.provider,
                voiceId: inlineAgent.voice.voiceId,
            },
            ...(inlineAgent.transcriber ? {
                transcriber: {
                    provider: inlineAgent.transcriber.provider,
                    model: inlineAgent.transcriber.model,
                    language: inlineAgent.transcriber.language,
                },
            } : {}),
            maxDurationSeconds: inlineAgent.maxDurationSeconds,
            backgroundSound: inlineAgent.backgroundSound,
            endCallMessage: inlineAgent.endCallMessage,
            voicemailMessage: inlineAgent.voicemailMessage,
            ...(inlineAgent.voicemailDetection ? {
                voicemailDetection: inlineAgent.voicemailDetection,
            } : {}),
            serverMessages: ["status-update", "end-of-call-report"],
            clientMessages: [],
        };

        // Override server URL if blueprint specifies one
        if (inlineAgent.serverUrl) {
            requestBody.assistant.server = { url: inlineAgent.serverUrl };
        }

        console.log(`[VAPI] Using blueprint inline agent (model: ${inlineAgent.model.model}, voice: ${inlineAgent.voice.voiceId})`);

    } else if (assistantConfig.vapi_assistant_id) {
        // ── PATH 2: Legacy assistantId (dynamic prompt is lost — only overrides survive)
        requestBody.assistantId = assistantConfig.vapi_assistant_id;

        const overrides = assistantConfig.override_variables;
        if (overrides && Object.keys(overrides).length > 0) {
            // Merge user-provided overrides on top of any already-set call-time
            // variables (currentDate, tenantTimezone) so both survive.
            requestBody.assistantOverrides = {
                ...(requestBody.assistantOverrides || {}),
                variableValues: {
                    ...(requestBody.assistantOverrides?.variableValues || {}),
                    ...overrides,
                },
            };
        }

        console.log(`[VAPI] Using legacy assistantId: ${assistantConfig.vapi_assistant_id}`);

    } else {
        // ── PATH 3: Legacy inline fallback (hardcoded voice/model)
        requestBody.assistant = {
            firstMessage: assistantConfig.first_message,
            model: {
                provider: 'openai',
                model: 'gpt-4',
                systemPrompt: assistantConfig.system_prompt,
            },
            voice: {
                provider: 'playht',
                voiceId: 'jennifer',
            },
            serverMessages: ["status-update", "end-of-call-report"],
            clientMessages: [],
        };

        console.log('[VAPI] Using legacy inline fallback (hardcoded voice/model)');
    }

    const response = await fetch('https://api.vapi.ai/call/phone', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${vapiApiKey}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`VAPI API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json() as { id: string };
    return { callId: data.id };
}

/**
 * VAPI Worker processor
 */
async function processVapiJob(job: Job<VapiJobPayload>): Promise<{ callId: string; status: string }> {
    const { tenantId, contactPhone, assistantConfig, enrollmentId, stepId, urgencyPriority, retryCount = 0, phoneNumberId, inlineAgent } = job.data;

    console.log(`[VAPI] Processing job ${job.id} for tenant ${tenantId}, phone ${contactPhone}, priority ${urgencyPriority}`);

    // 0. Paywall + balance gate. Reject (do not re-queue) if the tenant lacks
    //    access or has zero minutes — the job is a no-op until they resubscribe
    //    or buy a top-up pack.
    const access = await canPlaceCall(tenantId);
    if (access.allowed === false) {
        console.log(`[VAPI] Access denied for tenant ${tenantId}: ${access.reason}`);
        await logExecution({
            enrollmentId,
            stepId,
            channel: 'voice',
            action: 'skipped_no_access',
            providerId: '',
            providerResponse: { reason: access.reason },
            callStatus: 'access_denied',
        });
        return { callId: '', status: 'skipped_no_access' };
    }

    // 1. Resolve umbrella for this tenant
    const umbrella = await umbrellaResolver.getUmbrellaForTenant(tenantId);

    // 2. Try to acquire a concurrency slot
    const { acquired, reason } = await concurrencyManager.tryAcquire(
        umbrella.umbrellaId,
        tenantId,
        umbrella.concurrencyLimit,
        umbrella.tenantCap
    );

    if (!acquired) {
        console.log(`[VAPI] Cannot acquire slot: ${reason}`);

        // Re-queue with backoff
        if (retryCount < MAX_RETRIES) {
            await vapiQueue.add('vapi:call', {
                ...job.data,
                retryCount: retryCount + 1,
            }, {
                delay: RETRY_DELAY_MS * (retryCount + 1),
                priority: urgencyPriority,
            });
            console.log(`[VAPI] Re-queued for retry ${retryCount + 1}`);
        } else {
            // Max retries reached, log and skip
            await logExecution({
                enrollmentId,
                stepId,
                channel: 'voice',
                action: 'skipped_capacity',
                providerId: '',
                providerResponse: { reason, retryCount },
                callStatus: 'capacity_exhausted',
            });
        }

        return { callId: '', status: 'requeued' };
    }

    try {
        // 3. Make the call
        const result = await makeVapiCall(
            umbrella.vapiApiKey,
            contactPhone,
            assistantConfig,
            tenantId,
            umbrella.umbrellaId,
            enrollmentId,
            phoneNumberId,
            inlineAgent
        );

        console.log(`[VAPI] Call initiated: ${result.callId}`);

        // Log execution (initial state)
        await logExecution({
            enrollmentId,
            stepId,
            channel: 'voice',
            action: 'call_initiated',
            providerId: result.callId,
            providerResponse: result,
            callStatus: 'initiated',
        });

        // Record interaction for conversation memory (initial - updated on call end by event processor)
        const { data: enrollment } = await supabase
            .from('sequence_enrollments')
            .select('contact_id, tenant_id')
            .eq('id', enrollmentId)
            .single();

        if (enrollment) {
            await recordInteraction({
                clientId: enrollment.tenant_id,
                contactId: enrollment.contact_id,
                enrollmentId,
                stepId,
                channel: 'voice',
                direction: 'outbound',
                outcome: 'delivered',
                providerId: result.callId,
            });

            // Persist the reason for this outbound call onto the contact so
            // that if they call back, the inbound agent can reference it.
            // Priority: step.voice_context > agent.config.outbound_scenario.
            // If both are empty, leave existing values untouched.
            try {
                const { data: stepRow } = await supabase
                    .from('sequence_steps')
                    .select('voice_context, voice_agent_id')
                    .eq('id', stepId)
                    .single();

                let reason = (stepRow?.voice_context as string | null)?.trim() || '';
                if (!reason && stepRow?.voice_agent_id) {
                    const { data: agentRow } = await supabase
                        .from('agents')
                        .select('config')
                        .eq('id', stepRow.voice_agent_id)
                        .single();
                    const scenario = (agentRow?.config as any)?.outbound_scenario;
                    if (typeof scenario === 'string') reason = scenario.trim();
                }

                if (reason) {
                    await supabase
                        .from('contacts')
                        .update({
                            last_outbound_reason: reason,
                            last_outbound_at: new Date().toISOString(),
                            last_outbound_call_id: result.callId,
                        })
                        .eq('id', enrollment.contact_id);
                }
            } catch (err) {
                console.warn('[VAPI] Failed to persist last_outbound_reason on contact:', err);
            }
        }

        // Note: Concurrency slot will be released by the webhook when call ends
        // DO NOT release here - call is still in progress

        return { callId: result.callId, status: 'initiated' };
    } catch (error) {
        // Release slot on API error
        await concurrencyManager.release(umbrella.umbrellaId, tenantId);
        throw error;
    }
}

// Create the worker with priority support
const vapiWorker = new Worker<VapiJobPayload>('vapi-calls', processVapiJob, {
    connection: redisConnection,
    concurrency: 5, // Process multiple jobs, but concurrency is really managed by the manager
    lockDuration: 60000, // 1 minute lock (calls can take time to initiate)
});

// Event listeners
vapiWorker.on('completed', (job, result) => {
    console.log(`[VAPI] Job ${job.id} completed:`, result);
});

vapiWorker.on('failed', (job, error) => {
    console.error(`[VAPI] Job ${job?.id} failed:`, error.message);
});

vapiWorker.on('error', (error) => {
    console.error('[VAPI] Worker error:', error);
});

console.log('[VAPI] VAPI worker started');

// Handle graceful shutdown
process.on('SIGTERM', async () => {
    console.log('[VAPI] Received SIGTERM, closing worker...');
    await vapiWorker.close();
    process.exit(0);
});

process.on('SIGINT', async () => {
    console.log('[VAPI] Received SIGINT, closing worker...');
    await vapiWorker.close();
    process.exit(0);
});

export { vapiWorker };
