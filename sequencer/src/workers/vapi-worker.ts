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
import type { VapiJobPayload, VoiceContent } from '../lib/types.js';

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
 */
async function makeVapiCall(
    vapiApiKey: string,
    phoneNumber: string,
    assistantConfig: VoiceContent,
    tenantId: string,
    umbrellaId: string,
    enrollmentId: string
): Promise<{ callId: string }> {
    // Build request body for VAPI
    const requestBody: any = {
        phoneNumberId: null, // We'll use 'from' number or let VAPI pick
        customer: {
            number: phoneNumber,
        },
        assistant: {
            firstMessage: assistantConfig.first_message,
            model: {
                provider: 'openai',
                model: 'gpt-4',
                systemPrompt: assistantConfig.system_prompt,
            },
            voice: {
                provider: 'playht',
                voiceId: 'jennifer', // Default voice
            },
        },
        // Webhook URL to receive call events
        serverUrl: `${WEBHOOK_BASE_URL}/webhooks/vapi/call-events`,
        serverUrlSecret: process.env.VAPI_WEBHOOK_SECRET || 'ominify-secret',
        // Metadata for our webhook handler
        metadata: {
            tenantId,
            umbrellaId,
            enrollmentId,
        },
    };

    // If a specific assistant ID is provided, use that instead
    if (assistantConfig.vapi_assistant_id) {
        requestBody.assistantId = assistantConfig.vapi_assistant_id;
        delete requestBody.assistant;

        // Inject override variables for dynamic per-call data (e.g. lead name, campaign)
        const overrides = assistantConfig.override_variables;
        if (overrides && Object.keys(overrides).length > 0) {
            requestBody.assistantOverrides = {
                variableValues: overrides,
            };
        }
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
    const { tenantId, contactPhone, assistantConfig, enrollmentId, stepId, urgencyPriority, retryCount = 0 } = job.data;

    console.log(`[VAPI] Processing job ${job.id} for tenant ${tenantId}, phone ${contactPhone}, priority ${urgencyPriority}`);

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
            enrollmentId
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
const vapiWorker = new Worker<VapiJobPayload>('vapi:calls', processVapiJob, {
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
