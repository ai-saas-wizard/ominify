/**
 * VAPI Webhook Routes
 *
 * Handles:
 * - Call events (started, ended, transcript, etc.)
 * - Concurrency sync from VAPI
 *
 * VAPI payload structure notes (from real payloads):
 * - The `call` object with metadata may be at the TOP level OR inside `message.call`
 * - `metadata` (tenantId, umbrellaId, enrollmentId) is only present on OUTBOUND calls
 *   initiated by the sequencer. INBOUND calls won't have it.
 * - `transcript` is NOT always a flat string — it may only exist inside `message.artifact.messages[]`
 * - `duration` may not be present on `status-update` events, only on `end-of-call-report`
 * - `endedReason` includes transfer reasons like `assistant-forwarded-call`
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eventQueue, redis } from '../../lib/redis.js';
import { concurrencyManager } from '../../lib/concurrency-manager.js';
import { supabase } from '../../lib/db.js';
import { requireVapiSecret } from '../middleware/webhook-auth.js';
import type { EventJobPayload } from '../../lib/types.js';

interface VapiArtifactMessage {
    role: 'system' | 'bot' | 'user' | 'tool_calls' | 'tool_call_result';
    message: string;
    time?: number;
    endTime?: number;
    secondsFromStart?: number;
    duration?: number;
    source?: string;
    name?: string;
    result?: string;
    toolCallId?: string;
    toolCalls?: Array<{
        id: string;
        type: string;
        function: {
            name: string;
            arguments: string;
        };
    }>;
    metadata?: any;
}

interface VapiWebhookPayload {
    message: {
        type: 'assistant-request' | 'status-update' | 'transcript' | 'hang' | 'function-call' | 'end-of-call-report' | 'conversation-update';
        call?: {
            id: string;
            orgId: string;
            status: string;
            type?: string;
            endedReason?: string;
            transcript?: string;
            recordingUrl?: string;
            duration?: number;
            cost?: number;
            messages?: any[];
            customer?: {
                number: string;
                sipUri?: string;
            };
            assistantId?: string;
            phoneNumberId?: string;
            transport?: {
                conversationType?: string;
                provider?: string;
                callSid?: string;
            };
            // Some VAPI event shapes nest the outbound-call metadata here
            // instead of on the top-level call object.
            metadata?: {
                tenantId?: string;
                umbrellaId?: string;
                enrollmentId?: string;
                [key: string]: any;
            };
        };
        transcript?: string;
        status?: string;
        endedReason?: string;
        timestamp?: string | number;
        functionCall?: {
            name: string;
            parameters: any;
        };
        artifact?: {
            messages?: VapiArtifactMessage[];
            messagesOpenAIFormatted?: any[];
        };
        // Top-level fields VAPI may send alongside message
        phoneNumber?: {
            id: string;
            orgId: string;
            number: string;
            name?: string;
            provider?: string;
        };
        customer?: {
            number: string;
            sipUri?: string;
        };
        assistant?: {
            id: string;
            orgId: string;
            name: string;
            [key: string]: any;
        };
    };
    // Top-level call object — may contain metadata for outbound sequencer calls
    call?: {
        id: string;
        orgId: string;
        phoneNumberId?: string;
        type?: string;
        customer?: {
            number: string;
            sipUri?: string;
        };
        metadata?: {
            tenantId?: string;
            umbrellaId?: string;
            enrollmentId?: string;
            [key: string]: any;
        };
    };
}

interface VapiConcurrencySyncPayload {
    orgId: string;
    current: number;
    limit: number;
    timestamp: string;
}

// Persist call-dedup state in Redis so a webhook-server restart between
// status-update:ended and end-of-call-report can't let both events through
// and double-release the concurrency slot.
const DEDUP_TTL_SEC = 600; // 10 minutes — long calls can have minutes between events

/**
 * Atomically claim a callId for processing. Returns true on first claim,
 * false if another webhook already processed this call.
 */
async function tryClaimCall(callId: string): Promise<boolean> {
    try {
        // NX = set only if not exists; EX = 10min TTL
        const res = await redis.set(`vapi:dedup:${callId}`, '1', 'EX', DEDUP_TTL_SEC, 'NX');
        return res === 'OK';
    } catch (err) {
        console.error('[VAPI] Redis dedup error, allowing through:', err);
        return true; // fail-open: better to risk a duplicate than to drop both
    }
}

/**
 * Release a dedup claim. Used when event enqueue fails AFTER a successful
 * claim — otherwise the claim would strand and the call outcome would be
 * lost forever (no later webhook could ever process it).
 */
async function releaseCallClaim(callId: string): Promise<void> {
    try {
        await redis.del(`vapi:dedup:${callId}`);
    } catch (err) {
        console.error(`[VAPI] Failed to release dedup claim for ${callId}:`, err);
    }
}

/**
 * Extract a flat transcript string from the payload.
 * VAPI may provide transcript in several places:
 * 1. message.call.transcript (flat string) — preferred
 * 2. message.transcript (flat string)
 * 3. message.artifact.messages[] (array of message objects) — need to reconstruct
 */
function extractTranscript(payload: VapiWebhookPayload): string | undefined {
    // 1. Check flat transcript fields first
    const flatTranscript = payload.message.call?.transcript || payload.message.transcript;
    if (flatTranscript && flatTranscript.length > 0) {
        return flatTranscript;
    }

    // 2. Reconstruct from artifact.messages[] (filter out system messages)
    const artifactMessages = payload.message.artifact?.messages;
    if (artifactMessages && Array.isArray(artifactMessages) && artifactMessages.length > 0) {
        const conversationParts: string[] = [];
        for (const msg of artifactMessages) {
            if (msg.role === 'system') continue; // Skip system prompt
            if (msg.role === 'tool_calls' || msg.role === 'tool_call_result') continue; // Skip tool calls

            const role = msg.role === 'bot' ? 'Assistant' : 'User';
            if (msg.message && msg.message.trim().length > 0) {
                conversationParts.push(`${role}: ${msg.message}`);
            }
        }
        if (conversationParts.length > 0) {
            return conversationParts.join('\n');
        }
    }

    return undefined;
}

/**
 * Calculate approximate call duration from artifact messages when duration field is missing.
 * Uses the timestamp difference between the first and last messages.
 */
function estimateDuration(payload: VapiWebhookPayload): number | undefined {
    // Try message.call.duration first
    if (payload.message.call?.duration !== undefined && payload.message.call.duration > 0) {
        return payload.message.call.duration;
    }

    // Estimate from artifact messages timestamps
    const artifactMessages = payload.message.artifact?.messages;
    if (artifactMessages && Array.isArray(artifactMessages) && artifactMessages.length > 1) {
        const firstMsg = artifactMessages[0];
        const lastMsg = artifactMessages[artifactMessages.length - 1];

        const startTime = firstMsg.time;
        const endTime = lastMsg.endTime || lastMsg.time;

        if (startTime && endTime && endTime > startTime) {
            // Convert ms to seconds
            return Math.round((endTime - startTime) / 1000);
        }

        // Try secondsFromStart on last message
        if (lastMsg.secondsFromStart) {
            return Math.round(lastMsg.secondsFromStart + (lastMsg.duration || 0) / 1000);
        }
    }

    // Try computing from message.timestamp (epoch ms) and message.call.createdAt
    const callCreatedAt = (payload.message.call as any)?.createdAt as string | undefined;
    const messageTimestamp = payload.message.timestamp;
    if (callCreatedAt && messageTimestamp) {
        const start = new Date(callCreatedAt).getTime();
        const end = typeof messageTimestamp === 'number' ? messageTimestamp : parseInt(messageTimestamp);
        if (start > 0 && end > start) {
            return Math.round((end - start) / 1000);
        }
    }

    return undefined;
}

/**
 * Determine if an appointment was booked from call data.
 * Checks function calls, tool calls in artifact, and transcript keywords.
 */
function detectAppointmentBooked(payload: VapiWebhookPayload, transcript?: string): boolean {
    // Check for function call indicating booking
    if (payload.message.functionCall?.name === 'book_appointment') {
        return true;
    }

    // Check artifact messages for booking-related tool calls
    const artifactMessages = payload.message.artifact?.messages;
    if (artifactMessages && Array.isArray(artifactMessages)) {
        for (const msg of artifactMessages) {
            if (msg.role === 'tool_calls' && msg.toolCalls) {
                for (const toolCall of msg.toolCalls) {
                    const funcName = toolCall.function?.name?.toLowerCase() || '';
                    if (funcName.includes('book') || funcName.includes('schedule') || funcName.includes('appointment')) {
                        return true;
                    }
                }
            }
        }
    }

    // Check for specific patterns in transcript
    const transcriptText = transcript || payload.message.transcript || payload.message.call?.transcript || '';
    const bookingIndicators = [
        'appointment confirmed',
        'booked for',
        'scheduled for',
        'see you on',
        "we'll be there",
        'showing confirmed',
        'tour scheduled',
        "you're all set for",
    ];

    return bookingIndicators.some(indicator =>
        transcriptText.toLowerCase().includes(indicator)
    );
}

/**
 * Determine if a call was transferred from artifact messages.
 * Looks for Transfer tool calls in the conversation.
 */
function detectCallTransferred(payload: VapiWebhookPayload): boolean {
    const artifactMessages = payload.message.artifact?.messages;
    if (artifactMessages && Array.isArray(artifactMessages)) {
        for (const msg of artifactMessages) {
            // Check for transfer tool calls
            if (msg.role === 'tool_calls' && msg.toolCalls) {
                for (const toolCall of msg.toolCalls) {
                    const funcName = toolCall.function?.name?.toLowerCase() || '';
                    if (funcName === 'transfer' || funcName.includes('transfer')) {
                        return true;
                    }
                }
            }
            // Check for transfer results
            if (msg.role === 'tool_call_result' && msg.name?.toLowerCase() === 'transfer') {
                return true;
            }
        }
    }
    return false;
}

/**
 * Determine call disposition from VAPI end reason.
 * Covers all known VAPI endedReason values including transfers.
 */
function getDisposition(endedReason?: string): string {
    if (!endedReason) return 'unknown';

    const dispositionMap: Record<string, string> = {
        // Standard call endings
        'assistant-ended-call': 'completed',
        'customer-ended-call': 'answered',
        'hang-up': 'answered',
        'customer-did-not-give-microphone-permission': 'failed',

        // Transfer outcomes — these are successful calls
        'assistant-forwarded-call': 'transferred',
        'assistant-transferred-call': 'transferred',

        // Voicemail & no answer
        'voicemail': 'voicemail',
        'no-answer': 'no_answer',
        'customer-did-not-answer': 'no_answer',

        // Busy
        'busy': 'busy',
        'customer-busy': 'busy',

        // Failures
        'failed': 'failed',
        'system-error': 'failed',
        'pipeline-error-openai-llm-failed': 'failed',
        'pipeline-error-deepgram-transcriber-failed': 'failed',
        'pipeline-error-vapi-llm-failed': 'failed',
        'pipeline-error-eleven-labs-voice-failed': 'failed',
        'pipeline-error-playht-voice-failed': 'failed',
        'pipeline-error-cartesia-voice-failed': 'failed',
        'pipeline-error-deepgram-voice-failed': 'failed',
        'pipeline-error-custom-voice-failed': 'failed',
        'pipeline-error-openai-voice-failed': 'failed',
        'silence-timed-out': 'no_answer',
        'exceeded-max-duration': 'completed',
        'manually-canceled': 'failed',

        // Twilio/SIP specific
        'twilio-failed-to-connect-call': 'failed',
        'vonage-rejected': 'failed',
        'phone-call-provider-closed-websocket': 'failed',
    };

    return dispositionMap[endedReason] || 'unknown';
}

/**
 * Look up the current stepId for an enrollment from the DB.
 * This is needed because VAPI webhooks don't include stepId in their payload.
 */
async function resolveStepId(enrollmentId?: string): Promise<string | undefined> {
    if (!enrollmentId) return undefined;

    try {
        const { data } = await supabase
            .from('sequence_enrollments')
            .select('current_step_id')
            .eq('id', enrollmentId)
            .single();

        return data?.current_step_id || undefined;
    } catch (err) {
        console.error(`[VAPI] Failed to resolve stepId for enrollment ${enrollmentId}:`, err);
        return undefined;
    }
}

/**
 * Extract customer phone number from the payload.
 * VAPI may provide it in multiple places.
 */
function extractCustomerPhone(payload: VapiWebhookPayload): string | undefined {
    return (
        payload.call?.customer?.number ||
        payload.message?.call?.customer?.number ||
        payload.message?.customer?.number ||
        undefined
    );
}

export async function vapiWebhooks(fastify: FastifyInstance) {
    /**
     * Main VAPI webhook handler
     * POST /webhooks/vapi/call-events
     *
     * Handles real VAPI payloads which may have:
     * - call data at top level or nested inside message.call
     * - transcript as flat string OR reconstructed from artifact.messages[]
     * - metadata only on outbound sequencer-initiated calls
     * - various endedReason values including transfers
     */
    fastify.post<{ Body: VapiWebhookPayload }>(
        '/call-events',
        { preHandler: requireVapiSecret },
        async (request, reply) => {
            const payload = request.body;
            const messageType = payload.message?.type;

            // Extract metadata — check both top-level call and message.call
            // Outbound sequencer calls: metadata is in payload.call.metadata
            // (or nested in message.call.metadata on some event shapes)
            // Inbound/VAPI-dashboard calls: no metadata, need to resolve from orgId/phoneNumber
            const metadata = payload.call?.metadata || payload.message?.call?.metadata || {};
            const callId = payload.call?.id || payload.message?.call?.id;
            const orgId = payload.call?.orgId || payload.message?.call?.orgId;
            const customerPhone = extractCustomerPhone(payload);
            const callType = payload.call?.type || payload.message?.call?.type; // 'inboundPhoneCall' | 'outboundPhoneCall' | 'webCall'

            console.log(`[VAPI] Webhook: ${messageType}, callId: ${callId}, type: ${callType}, customer: ${customerPhone}`);

            // Handle different message types
            switch (messageType) {
                case 'status-update': {
                    const status = payload.message.status;
                    console.log(`[VAPI] Call ${callId} status: ${status}`);

                    // If call ended, process the outcome
                    if (status === 'ended') {
                        // Dedup via Redis SETNX so a process restart between
                        // status-update:ended and end-of-call-report can't
                        // double-process.
                        if (callId && !(await tryClaimCall(callId))) {
                            console.log(`[VAPI] Call ${callId} already processed (dedup), skipping status-update`);
                            break;
                        }

                        const endedReason = payload.message.endedReason || payload.message.call?.endedReason;
                        const duration = estimateDuration(payload);
                        const transcript = extractTranscript(payload);
                        const appointmentBooked = detectAppointmentBooked(payload, transcript);
                        const wasTransferred = detectCallTransferred(payload);
                        const disposition = getDisposition(endedReason);

                        // Resolve stepId from DB for self-healing support
                        const stepId = await resolveStepId(metadata.enrollmentId);

                        const event: EventJobPayload = {
                            type: 'call-outcome',
                            tenantId: metadata.tenantId || '',
                            umbrellaId: metadata.umbrellaId,
                            enrollmentId: metadata.enrollmentId,
                            stepId,
                            callId,
                            disposition: wasTransferred && disposition === 'unknown' ? 'transferred' : disposition,
                            duration,
                            transcript,
                            appointmentBooked,
                        };

                        try {
                            await eventQueue.add('event:call-outcome', event);
                        } catch (err) {
                            if (callId) await releaseCallClaim(callId);
                            throw err;
                        }
                        console.log(`[VAPI] Queued call-outcome: disposition=${event.disposition}, duration=${duration}s, transcript=${transcript ? transcript.length + ' chars' : 'none'}`);
                    }
                    break;
                }

                case 'end-of-call-report': {
                    // Detailed report at end of call — may arrive AFTER status-update:ended
                    const call = payload.message.call;
                    if (!call) break;

                    const reportCallId = call.id || callId;

                    // Dedup: atomically claim the callId. If the claim fails,
                    // a concurrent/earlier webhook (status-update:ended) already
                    // processed this call — enrich with richer report data
                    // instead of double-queuing the outcome.
                    if (reportCallId && !(await tryClaimCall(reportCallId))) {
                        console.log(`[VAPI] Call ${reportCallId} already processed via status-update, enriching with end-of-call-report data`);

                        // Enrich the execution log with any additional data from the report
                        // (end-of-call-report often has better transcript and duration)
                        const transcript = extractTranscript(payload);
                        const duration = estimateDuration(payload);

                        if (transcript || duration) {
                            const { error: enrichError } = await supabase
                                .from('sequence_execution_log')
                                .update({
                                    ...(transcript ? { call_transcript: transcript } : {}),
                                    ...(duration ? { call_duration_seconds: duration } : {}),
                                })
                                .eq('provider_id', reportCallId);
                            if (enrichError) {
                                console.error(`[VAPI] Failed to enrich execution log for call ${reportCallId}:`, enrichError.message);
                            } else {
                                console.log(`[VAPI] Enriched execution log for call ${reportCallId}`);
                            }
                        }
                        break;
                    }

                    const transcript = extractTranscript(payload);
                    const duration = estimateDuration(payload);
                    const appointmentBooked = detectAppointmentBooked(payload, transcript);
                    const wasTransferred = detectCallTransferred(payload);
                    const endedReason = call.endedReason || payload.message.endedReason;
                    const disposition = getDisposition(endedReason);

                    // Resolve stepId from DB for self-healing support
                    const stepId = await resolveStepId(metadata.enrollmentId);

                    const event: EventJobPayload = {
                        type: 'call-outcome',
                        tenantId: metadata.tenantId || '',
                        umbrellaId: metadata.umbrellaId,
                        enrollmentId: metadata.enrollmentId,
                        stepId,
                        callId: reportCallId,
                        disposition: wasTransferred && disposition === 'unknown' ? 'transferred' : disposition,
                        duration: duration || call.duration,
                        transcript: transcript || call.transcript,
                        appointmentBooked,
                    };

                    try {
                        await eventQueue.add('event:call-outcome', event);
                    } catch (err) {
                        if (reportCallId) await releaseCallClaim(reportCallId);
                        throw err;
                    }
                    console.log(`[VAPI] Queued call-outcome from report: disposition=${event.disposition}, duration=${event.duration}s`);
                    break;
                }

                case 'function-call': {
                    const funcCall = payload.message.functionCall;
                    console.log(`[VAPI] Function call: ${funcCall?.name}`);

                    // Handle specific function calls (e.g., booking confirmation)
                    if (funcCall?.name === 'book_appointment' && metadata.enrollmentId) {
                        // Verify the enrollment actually belongs to the tenant
                        // claimed in the call metadata before mutating it —
                        // mismatched/forged metadata must not flip another
                        // tenant's enrollment to booked.
                        const { data: enrollment, error: enrollmentError } = await supabase
                            .from('sequence_enrollments')
                            .select('id, tenant_id')
                            .eq('id', metadata.enrollmentId)
                            .maybeSingle();

                        if (enrollmentError || !enrollment) {
                            console.warn(`[VAPI] book_appointment for unknown enrollment ${metadata.enrollmentId}; ignoring`);
                            break;
                        }
                        if (!metadata.tenantId || enrollment.tenant_id !== metadata.tenantId) {
                            console.warn(`[VAPI] book_appointment tenant mismatch for enrollment ${metadata.enrollmentId} (enrollment tenant ${enrollment.tenant_id}, metadata tenant ${metadata.tenantId}); ignoring`);
                            break;
                        }

                        // Update enrollment immediately
                        const { error: bookError } = await supabase
                            .from('sequence_enrollments')
                            .update({
                                appointment_booked: true,
                                status: 'booked',
                                completed_at: new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', metadata.enrollmentId);
                        if (bookError) {
                            console.error(`[VAPI] Failed to mark enrollment ${metadata.enrollmentId} as booked:`, bookError.message);
                        } else {
                            console.log(`[VAPI] Enrollment ${metadata.enrollmentId} marked as booked`);
                        }
                    }
                    break;
                }

                case 'assistant-request': {
                    // VAPI is requesting assistant config - return empty for now
                    // In production, might dynamically configure based on context
                    break;
                }

                default:
                    console.log(`[VAPI] Unhandled message type: ${messageType}`);
            }

            reply.status(200).send({ ok: true });
        }
    );

    /**
     * Concurrency sync endpoint
     * POST /webhooks/vapi/concurrency-sync
     * 
     * VAPI periodically reports its actual concurrency state.
     * This is the "ground truth" that corrects any drift in our tracking.
     */
    fastify.post<{ Body: VapiConcurrencySyncPayload }>(
        '/concurrency-sync',
        { preHandler: requireVapiSecret },
        async (request, reply) => {
            const { orgId, current, limit, timestamp } = (request.body || {}) as VapiConcurrencySyncPayload;

            // Validate before touching Redis/DB — a malformed payload must
            // get a 400, not crash the handler (NaN counters, Invalid Date
            // .toISOString() throws RangeError).
            if (typeof orgId !== 'string' || orgId.length === 0) {
                reply.status(400).send({ error: 'Missing or invalid orgId' });
                return;
            }
            if (!Number.isFinite(current) || !Number.isFinite(limit) || current < 0 || limit < 0) {
                reply.status(400).send({ error: 'current and limit must be finite non-negative numbers' });
                return;
            }
            let lastWebhookAt = new Date();
            if (timestamp !== undefined && timestamp !== null) {
                const parsed = new Date(timestamp);
                if (isNaN(parsed.getTime())) {
                    reply.status(400).send({ error: 'Invalid timestamp' });
                    return;
                }
                lastWebhookAt = parsed;
            }

            console.log(`[VAPI] Concurrency sync: orgId=${orgId}, current=${current}, limit=${limit}`);

            // Find umbrella by VAPI org ID
            const { data: umbrella } = await supabase
                .from('vapi_umbrellas')
                .select('id')
                .eq('vapi_org_id', orgId)
                .maybeSingle();

            if (!umbrella) {
                console.log(`[VAPI] Unknown orgId in concurrency sync: ${orgId}`);
                reply.status(404).send({ error: 'Unknown orgId' });
                return;
            }

            // Sync to Redis
            await concurrencyManager.syncFromWebhook(umbrella.id, current, limit);

            // Update umbrella record
            const { error: updateError } = await supabase
                .from('vapi_umbrellas')
                .update({
                    current_concurrency: current,
                    last_webhook_at: lastWebhookAt.toISOString(),
                })
                .eq('id', umbrella.id);
            if (updateError) {
                console.error(`[VAPI] Failed to update umbrella ${umbrella.id} after concurrency sync:`, updateError.message);
            }

            reply.status(200).send({ ok: true });
        }
    );
}
