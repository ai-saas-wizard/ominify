/**
 * VAPI Webhook Routes
 * 
 * Handles:
 * - Call events (started, ended, transcript, etc.)
 * - Concurrency sync from VAPI
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eventQueue } from '../../lib/redis.js';
import { concurrencyManager } from '../../lib/concurrency-manager.js';
import { supabase } from '../../lib/db.js';
import type { EventJobPayload } from '../../lib/types.js';

interface VapiWebhookPayload {
    message: {
        type: 'assistant-request' | 'status-update' | 'transcript' | 'hang' | 'function-call' | 'end-of-call-report' | 'conversation-update';
        call?: {
            id: string;
            orgId: string;
            status: string;
            endedReason?: string;
            transcript?: string;
            recordingUrl?: string;
            duration?: number;
            messages?: any[];
        };
        transcript?: string;
        status?: string;
        endedReason?: string;
        timestamp?: string;
        functionCall?: {
            name: string;
            parameters: any;
        };
        artifact?: any;
    };
    call?: {
        id: string;
        orgId: string;
        phoneNumberId?: string;
        customer?: {
            number: string;
        };
        metadata?: {
            tenantId?: string;
            umbrellaId?: string;
            enrollmentId?: string;
        };
    };
}

interface VapiConcurrencySyncPayload {
    orgId: string;
    current: number;
    limit: number;
    timestamp: string;
}

/**
 * Determine if an appointment was booked from call data
 */
function detectAppointmentBooked(payload: VapiWebhookPayload): boolean {
    // Check for function call indicating booking
    if (payload.message.functionCall?.name === 'book_appointment') {
        return true;
    }

    // Check for specific patterns in transcript (simplified)
    const transcript = payload.message.transcript || payload.message.call?.transcript || '';
    const bookingIndicators = [
        'appointment confirmed',
        'booked for',
        'scheduled for',
        'see you on',
        "we'll be there",
    ];

    return bookingIndicators.some(indicator =>
        transcript.toLowerCase().includes(indicator)
    );
}

/**
 * Determine call disposition from VAPI end reason
 */
function getDisposition(endedReason?: string): string {
    if (!endedReason) return 'unknown';

    const dispositionMap: Record<string, string> = {
        'assistant-ended-call': 'completed',
        'customer-ended-call': 'answered',
        'hang-up': 'answered',
        'voicemail': 'voicemail',
        'no-answer': 'no_answer',
        'busy': 'busy',
        'failed': 'failed',
        'system-error': 'failed',
    };

    return dispositionMap[endedReason] || 'unknown';
}

export async function vapiWebhooks(fastify: FastifyInstance) {
    /**
     * Main VAPI webhook handler
     * POST /webhooks/vapi/call-events
     */
    fastify.post<{ Body: VapiWebhookPayload }>(
        '/call-events',
        async (request, reply) => {
            const payload = request.body;
            const messageType = payload.message?.type;

            console.log(`[VAPI] Webhook: ${messageType}`);

            // Extract metadata
            const metadata = payload.call?.metadata || {};
            const callId = payload.call?.id || payload.message?.call?.id;
            const orgId = payload.call?.orgId || payload.message?.call?.orgId;

            // Handle different message types
            switch (messageType) {
                case 'status-update': {
                    const status = payload.message.status;
                    console.log(`[VAPI] Call ${callId} status: ${status}`);

                    // If call ended, process the outcome
                    if (status === 'ended') {
                        const endedReason = payload.message.endedReason || payload.message.call?.endedReason;
                        const duration = payload.message.call?.duration;
                        const transcript = payload.message.call?.transcript;
                        const appointmentBooked = detectAppointmentBooked(payload);

                        const event: EventJobPayload = {
                            type: 'call-outcome',
                            tenantId: metadata.tenantId || '',
                            umbrellaId: metadata.umbrellaId,
                            enrollmentId: metadata.enrollmentId,
                            callId,
                            disposition: getDisposition(endedReason),
                            duration,
                            transcript,
                            appointmentBooked,
                        };

                        await eventQueue.add('event:call-outcome', event);
                    }
                    break;
                }

                case 'end-of-call-report': {
                    // Detailed report at end of call
                    const call = payload.message.call;
                    if (!call) break;

                    const appointmentBooked = detectAppointmentBooked(payload);

                    const event: EventJobPayload = {
                        type: 'call-outcome',
                        tenantId: metadata.tenantId || '',
                        umbrellaId: metadata.umbrellaId,
                        enrollmentId: metadata.enrollmentId,
                        callId: call.id,
                        disposition: getDisposition(call.endedReason),
                        duration: call.duration,
                        transcript: call.transcript,
                        appointmentBooked,
                    };

                    await eventQueue.add('event:call-outcome', event);
                    break;
                }

                case 'function-call': {
                    const funcCall = payload.message.functionCall;
                    console.log(`[VAPI] Function call: ${funcCall?.name}`);

                    // Handle specific function calls (e.g., booking confirmation)
                    if (funcCall?.name === 'book_appointment' && metadata.enrollmentId) {
                        // Update enrollment immediately
                        await supabase
                            .from('sequence_enrollments')
                            .update({
                                appointment_booked: true,
                                status: 'booked',
                                completed_at: new Date().toISOString(),
                                updated_at: new Date().toISOString(),
                            })
                            .eq('id', metadata.enrollmentId);
                        console.log(`[VAPI] Enrollment ${metadata.enrollmentId} marked as booked`);
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
        async (request, reply) => {
            const { orgId, current, limit, timestamp } = request.body;

            console.log(`[VAPI] Concurrency sync: orgId=${orgId}, current=${current}, limit=${limit}`);

            // Find umbrella by VAPI org ID
            const { data: umbrella } = await supabase
                .from('vapi_umbrellas')
                .select('id')
                .eq('vapi_org_id', orgId)
                .single();

            if (!umbrella) {
                console.log(`[VAPI] Unknown orgId in concurrency sync: ${orgId}`);
                reply.status(404).send({ error: 'Unknown orgId' });
                return;
            }

            // Sync to Redis
            await concurrencyManager.syncFromWebhook(umbrella.id, current, limit);

            // Update umbrella record
            await supabase
                .from('vapi_umbrellas')
                .update({
                    current_concurrency: current,
                    last_webhook_at: new Date(timestamp).toISOString(),
                })
                .eq('id', umbrella.id);

            reply.status(200).send({ ok: true });
        }
    );
}
