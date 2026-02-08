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
        .select('tenant_id')
        .eq('phone_number', phoneNumber)
        .eq('is_active', true)
        .single();

    if (error || !data) {
        console.log(`[TWILIO] No tenant found for phone ${phoneNumber}`);
        return null;
    }

    return data.tenant_id;
}

/**
 * Find enrollment by contact phone within tenant
 */
async function findEnrollmentByPhone(tenantId: string, contactPhone: string): Promise<string | null> {
    // First find the contact
    const { data: contact } = await supabase
        .from('contacts')
        .select('id')
        .eq('client_id', tenantId)
        .eq('phone', contactPhone)
        .single();

    if (!contact) return null;

    // Then find active enrollment
    const { data: enrollment } = await supabase
        .from('sequence_enrollments')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('contact_id', contact.id)
        .eq('status', 'active')
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
            };

            await eventQueue.add('event:sms-reply', event);

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
            const { MessageSid: messageSid, MessageStatus: status, To: to, ErrorCode: errorCode } = request.body;

            console.log(`[TWILIO] SMS status: ${messageSid} -> ${status}`);

            // Find enrollment (look up by message SID in execution log)
            const { data: log } = await supabase
                .from('sequence_execution_log')
                .select('enrollment_id, step_id')
                .eq('provider_id', messageSid)
                .single();

            // Queue the event
            const event: EventJobPayload = {
                type: 'sms-delivery',
                tenantId,
                enrollmentId: log?.enrollment_id,
                stepId: log?.step_id,
                deliveryStatus: status,
            };

            await eventQueue.add('event:sms-delivery', event);

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

            // Find enrollment
            const enrollmentId = await findEnrollmentByPhone(tenantId, from);

            // Queue the event
            const event: EventJobPayload = {
                type: 'sms-reply',
                tenantId,
                enrollmentId: enrollmentId || undefined,
                messageBody: body,
            };

            await eventQueue.add('event:sms-reply', event);

            reply.type('text/xml');
            return '<Response></Response>';
        }
    );
}
