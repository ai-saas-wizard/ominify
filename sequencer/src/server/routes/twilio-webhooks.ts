/**
 * Twilio Webhook Routes
 * 
 * Handles:
 * - Inbound SMS messages
 * - SMS delivery status callbacks
 */

import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { eventQueue } from '../../lib/redis.js';
import { supabase } from '../../lib/db.js';
import { requireTwilioSignature } from '../middleware/webhook-auth.js';
import { phoneLookupCandidates } from '../../lib/phone.js';
import type { EventJobPayload } from '../../lib/types.js';

interface SmsStatusParams {
    tenantId: string;
}

interface TwilioSmsWebhook {
    AccountSid: string;
    ApiVersion: string;
    Body?: string;
    From: string;
    FromCity?: string;
    FromCountry?: string;
    FromState?: string;
    FromZip?: string;
    MessageSid: string;
    NumMedia: string;
    NumSegments: string;
    SmsMessageSid: string;
    SmsSid: string;
    SmsStatus: string;
    To: string;
    ToCity?: string;
    ToCountry?: string;
    ToState?: string;
    ToZip?: string;
    // Status callback specific
    MessageStatus?: string;
    ErrorCode?: string;
    ErrorMessage?: string;
}

/**
 * Find tenant by phone number
 */
async function findTenantByPhoneNumber(phoneNumber: string): Promise<string | null> {
    const { data, error } = await supabase
        .from('tenant_phone_numbers')
        .select('client_id')
        .eq('phone_number', phoneNumber)
        .eq('status', 'active')
        .maybeSingle();

    if (error || !data) {
        console.log(`[TWILIO] No tenant found for phone ${phoneNumber}`);
        return null;
    }

    return data.client_id;
}

/**
 * Find enrollment by contact phone within tenant
 */
async function findEnrollmentByPhone(tenantId: string, contactPhone: string): Promise<string | null> {
    // First find the contact — match both the E.164 form Twilio delivers
    // and the raw form, so legacy un-normalized rows still resolve.
    const candidates = phoneLookupCandidates(contactPhone);
    if (candidates.length === 0) return null;

    const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('client_id', tenantId)
        .in('phone', candidates)
        .limit(1)
        .maybeSingle();

    if (!contact) return null;

    // Then find active enrollment
    const { data: enrollment } = await supabase
        .from('sequence_enrollments')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contact.id)
        .in('status', ['active', 'paused', 'awaiting_outcome', 'generating_next_step'])
        .order('created_at', { ascending: false })
        .limit(1)
        .single();

    return enrollment?.id || null;
}

export async function twilioWebhooks(fastify: FastifyInstance) {
    /**
     * Inbound SMS webhook
     * POST /webhooks/twilio/sms-inbound/:tenantId
     */
    fastify.post<{ Params: SmsStatusParams; Body: TwilioSmsWebhook }>(
        '/sms-inbound/:tenantId',
        async (request, reply) => {
            const { tenantId } = request.params;
            if (!(await requireTwilioSignature(request, reply, tenantId))) return;
            const { From: from, To: to, Body: body, MessageSid: messageSid } = request.body;

            console.log(`[TWILIO] Inbound SMS from ${from} to ${to}: "${body?.substring(0, 50)}..."`);

            // Find enrollment for this contact
            const enrollmentId = await findEnrollmentByPhone(tenantId, from);

            // Queue the event for processing
            const event: EventJobPayload = {
                type: 'sms-reply',
                tenantId,
                enrollmentId: enrollmentId || undefined,
                messageBody: body,
                fromPhone: from,
                messageSid,
            };

            // Deterministic jobId — Twilio retries/replays of the same
            // MessageSid dedupe at the queue.
            await eventQueue.add('event:sms-reply', event, { jobId: `sms-in:${messageSid}` });

            // Return TwiML response (empty = no auto-reply)
            reply.type('text/xml');
            return '<Response></Response>';
        }
    );

    /**
     * SMS delivery status webhook
     * POST /webhooks/twilio/sms-status/:tenantId
     */
    fastify.post<{ Params: SmsStatusParams; Body: TwilioSmsWebhook }>(
        '/sms-status/:tenantId',
        async (request, reply) => {
            const { tenantId } = request.params;
            if (!(await requireTwilioSignature(request, reply, tenantId))) return;
            const { MessageSid: messageSid, MessageStatus: status, To: to, ErrorCode: errorCode } = request.body;

            console.log(`[TWILIO] SMS status: ${messageSid} -> ${status}`);

            // Find enrollment (look up by message SID in execution log),
            // scoped to this tenant via the enrollment join so one tenant's
            // callback can't resolve another tenant's log row.
            const { data: log } = await supabase
                .from('sequence_execution_log')
                .select('enrollment_id, step_id, sequence_enrollments!inner(tenant_id)')
                .eq('provider_id', messageSid)
                .eq('sequence_enrollments.tenant_id', tenantId)
                .maybeSingle();

            // Queue the event — providerId lets the event processor update
            // the execution log by provider_id.
            const event: EventJobPayload & { providerId: string } = {
                type: 'sms-delivery',
                tenantId,
                enrollmentId: log?.enrollment_id,
                stepId: log?.step_id,
                deliveryStatus: status,
                providerId: messageSid,
            };

            await eventQueue.add('event:sms-delivery', event, { jobId: `sms-status:${messageSid}:${status}` });

            reply.status(200).send({ ok: true });
        }
    );

    /**
     * Generic inbound SMS (tenant lookup by To number)
     * POST /webhooks/twilio/sms-inbound
     */
    fastify.post<{ Body: TwilioSmsWebhook }>(
        '/sms-inbound',
        async (request, reply) => {
            const { From: from, To: to, Body: body, MessageSid: messageSid } = request.body;

            console.log(`[TWILIO] Inbound SMS from ${from} to ${to}`);

            // Find tenant by the "To" phone number
            const tenantId = await findTenantByPhoneNumber(to);

            if (!tenantId) {
                console.log(`[TWILIO] Unknown destination number: ${to}`);
                reply.type('text/xml');
                return '<Response></Response>';
            }

            // Validate signature against this tenant's authToken before
            // accepting any state change.
            if (!(await requireTwilioSignature(request, reply, tenantId))) return;

            // Find enrollment
            const enrollmentId = await findEnrollmentByPhone(tenantId, from);

            // Queue the event
            const event: EventJobPayload = {
                type: 'sms-reply',
                tenantId,
                enrollmentId: enrollmentId || undefined,
                messageBody: body,
                fromPhone: from,
                messageSid,
            };

            await eventQueue.add('event:sms-reply', event, { jobId: `sms-in:${messageSid}` });

            reply.type('text/xml');
            return '<Response></Response>';
        }
    );
}
