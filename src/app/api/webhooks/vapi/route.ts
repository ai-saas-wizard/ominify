import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { recordCallUsage } from "@/lib/billing";
import crypto from "crypto";

/**
 * Central Vapi Webhook Receiver
 * 
 * Configure in Vapi Dashboard:
 * Server URL: https://yourplatform.com/api/webhooks/vapi
 * 
 * This endpoint receives all Vapi events and forwards them to client webhooks
 * AND updates contacts with call summaries for AI context.
 */

interface VapiWebhookPayload {
    message: {
        type: string;
        call?: {
            id: string;
            orgId: string;
            assistantId?: string;
            status: string;
            endedReason?: string;
            startedAt?: string;
            endedAt?: string;
            transcript?: string;
            type?: string;
            customer?: {
                number?: string;
            };
            costs?: Array<{
                type: string;
                cost: number;
            }>;
            analysis?: {
                summary?: string;
                structuredData?: {
                    name?: string;
                    email?: string;
                };
            };
        };
        conversation?: Array<{
            role: string;
            content?: string;
            message?: string;
        }>;
    };
}

// Helper to get Client ID from Vapi Org ID
async function getClientIdByOrgId(orgId: string): Promise<string | null> {
    const { data } = await supabase
        .from('clients')
        .select('id')
        .eq('vapi_org_id', orgId)
        .single();
    return data?.id || null;
}

// Handle Call Started - Create Active Call
async function handleCallStarted(call: NonNullable<VapiWebhookPayload['message']['call']>) {
    try {
        if (!call.orgId) return;
        const clientId = await getClientIdByOrgId(call.orgId);
        if (!clientId) return;

        // Check if already exists to avoid duplicates
        const { data: existing } = await supabase
            .from('active_calls')
            .select('id')
            .eq('vapi_call_id', call.id)
            .single();

        if (existing) return;

        await supabase.from('active_calls').insert({
            vapi_call_id: call.id,
            client_id: clientId,
            status: call.status || 'ringing',
            started_at: call.startedAt || new Date().toISOString(),
            customer_number: call.customer?.number,
            assistant_id: call.assistantId,
            type: call.type || 'inbound',
            last_active_at: new Date().toISOString()
        });
    } catch (error) {
        console.error('Error handling call started:', error);
    }
}

// Handle Call Updates (Status, Conversation)
async function handleCallUpdate(
    call: NonNullable<VapiWebhookPayload['message']['call']>,
    conversation?: VapiWebhookPayload['message']['conversation']
) {
    try {
        const updateData: any = {
            status: call.status,
            last_active_at: new Date().toISOString()
        };

        if (call.analysis?.summary) {
            updateData.summary = call.analysis.summary;
        }

        if (conversation) {
            // Format transcript from conversation history
            const transcript = conversation
                .map(m => `${m.role}: ${m.content || m.message || ''}`)
                .join('\n');
            updateData.transcript = transcript;
        }

        // Only update if record exists
        await supabase
            .from('active_calls')
            .update(updateData)
            .eq('vapi_call_id', call.id);

    } catch (error) {
        console.error('Error handling call update:', error);
    }
}

// Handle End of Call - Cleanup and History
async function handleEndOfCall(call: NonNullable<VapiWebhookPayload['message']['call']>) {
    try {
        // 1. Remove from active calls
        await supabase.from('active_calls').delete().eq('vapi_call_id', call.id);

        // 2. Update Contact History (CRM)
        await updateContactAfterCall(call);

        // 3. Record Usage for Billing
        if (call.orgId) {
            const clientId = await getClientIdByOrgId(call.orgId);
            if (clientId) {
                // Calculate duration
                const startedAt = call.startedAt ? new Date(call.startedAt) : null;
                const endedAt = call.endedAt ? new Date(call.endedAt) : null;
                const durationSeconds = startedAt && endedAt
                    ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
                    : 0;

                if (durationSeconds > 0) {
                    await recordCallUsage(clientId, call.id, durationSeconds);
                }
            }
        }

    } catch (error) {
        console.error('Error handling end of call:', error);
    }
}

// Update contact after call ends (Existing Logic)
async function updateContactAfterCall(call: NonNullable<VapiWebhookPayload['message']['call']>) {
    if (!call?.customer?.number || !call.orgId) return;

    try {
        const clientId = await getClientIdByOrgId(call.orgId);
        if (!clientId) return;

        // Find or create contact
        let { data: contact } = await supabase
            .from('contacts')
            .select('id, conversation_summary, total_calls')
            .eq('client_id', clientId)
            .eq('phone', call.customer.number)
            .single();

        if (!contact) {
            // Create new contact
            const { data: newContact } = await supabase
                .from('contacts')
                .insert({
                    client_id: clientId,
                    phone: call.customer.number,
                    name: call.analysis?.structuredData?.name || null,
                    email: call.analysis?.structuredData?.email || null,
                    total_calls: 0
                })
                .select('id, conversation_summary, total_calls')
                .single();
            contact = newContact;
        }

        if (!contact) return;

        // Calculate duration and insert call history
        const startedAt = call.startedAt ? new Date(call.startedAt) : null;
        const endedAt = call.endedAt ? new Date(call.endedAt) : null;
        const durationSeconds = startedAt && endedAt
            ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
            : 0;

        await supabase.from('contact_calls').insert({
            contact_id: contact.id,
            vapi_call_id: call.id,
            summary: call.analysis?.summary || null,
            transcript: call.transcript || null,
            outcome: call.endedReason || call.status,
            duration_seconds: durationSeconds,
            called_at: call.startedAt || new Date().toISOString()
        });

        // Update contact summary (rolling 5 calls)
        const newSummary = call.analysis?.summary;
        let updatedSummary = contact.conversation_summary || '';

        if (newSummary) {
            const callDate = new Date(call.startedAt || Date.now()).toLocaleDateString();
            const summaryEntry = `[${callDate}] ${newSummary}`;
            const summaries = updatedSummary.split('\n\n').filter(Boolean);
            summaries.push(summaryEntry);
            if (summaries.length > 5) summaries.shift();
            updatedSummary = summaries.join('\n\n');
        }

        // Update contact details
        const updateData: any = {
            total_calls: (contact.total_calls || 0) + 1,
            last_call_at: call.startedAt || new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (newSummary) updateData.conversation_summary = updatedSummary;

        if (call.analysis?.structuredData?.name) {
            const { data: current } = await supabase.from('contacts').select('name').eq('id', contact.id).single();
            if (!current?.name) updateData.name = call.analysis.structuredData.name;
        }
        if (call.analysis?.structuredData?.email) {
            const { data: current } = await supabase.from('contacts').select('email').eq('id', contact.id).single();
            if (!current?.email) updateData.email = call.analysis.structuredData.email;
        }

        await supabase.from('contacts').update(updateData).eq('id', contact.id);

    } catch (error) {
        console.error('Error updating contact after call:', error);
    }
}

// Transform Vapi payload to our clean format
function transformPayload(vapiPayload: VapiWebhookPayload, eventType: string) {
    const call = vapiPayload.message?.call;
    if (!call) return null;

    const startedAt = call.startedAt ? new Date(call.startedAt) : null;
    const endedAt = call.endedAt ? new Date(call.endedAt) : null;
    const durationSeconds = startedAt && endedAt
        ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
        : 0;

    const totalCost = call.costs?.reduce((sum, c) => sum + (c.cost || 0), 0) || 0;

    return {
        event: eventType,
        timestamp: new Date().toISOString(),
        call: {
            id: call.id,
            agentId: call.assistantId,
            status: call.status,
            outcome: formatOutcome(call.endedReason),
            duration: {
                seconds: durationSeconds,
                formatted: formatDuration(durationSeconds)
            },
            startedAt: call.startedAt,
            endedAt: call.endedAt
        },
        customer: {
            phone: call.customer?.number || null
        },
        transcript: call.transcript || null,
        summary: call.analysis?.summary || null,
        costs: {
            total: Math.round(totalCost * 100) / 100
        }
    };
}

function formatOutcome(endedReason?: string): string {
    const mapping: Record<string, string> = {
        'assistant-ended-call': 'completed',
        'customer-ended-call': 'customer_hangup',
        'customer-did-not-answer': 'no_answer',
        'voicemail': 'voicemail',
        'assistant-error': 'error'
    };
    return mapping[endedReason || ''] || endedReason || 'unknown';
}

function formatDuration(seconds: number): string {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Sign payload with HMAC
function signPayload(payload: string, secret: string): string {
    return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

// Forward to client webhook
async function forwardToWebhook(
    webhookUrl: string,
    payload: any,
    secret?: string | null
): Promise<{ success: boolean; status?: number; error?: string }> {
    try {
        const payloadString = JSON.stringify(payload);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'X-INDRIS-Event': payload.event,
            'X-INDRIS-Timestamp': payload.timestamp
        };

        if (secret) {
            headers['X-INDRIS-Signature'] = signPayload(payloadString, secret);
        }

        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers,
            body: payloadString,
            signal: AbortSignal.timeout(10000) // 10 second timeout
        });

        return {
            success: response.ok,
            status: response.status
        };
    } catch (error: any) {
        return {
            success: false,
            error: error.message
        };
    }
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as VapiWebhookPayload;
        const messageType = body.message?.type;
        const call = body.message?.call;

        if (!call || !call.assistantId) {
            return NextResponse.json({ received: true });
        }

        // --- ACTIVE CALL TRACKING ---
        if (messageType === 'call-started') {
            await handleCallStarted(call);
        } else if (messageType === 'status-update') {
            await handleCallUpdate(call);
        } else if (messageType === 'conversation-update') {
            await handleCallUpdate(call, body.message.conversation);
        } else if (messageType === 'end-of-call-report') {
            await handleEndOfCall(call);
        }

        // --- WEBHOOK FORWARDING LOGIC ---
        // Map Vapi message types to our event types
        let eventType: string | null = null;
        if (messageType === 'status-update' && call.status === 'in-progress') {
            eventType = 'call.started';
        } else if (messageType === 'end-of-call-report') {
            eventType = 'call.ended';
        }

        if (!eventType) {
            return NextResponse.json({ received: true });
        }

        // Find webhooks that match this agent and event
        const { data: webhookAgentMappings } = await supabase
            .from('webhook_agents')
            .select('webhook_id')
            .eq('agent_id', call.assistantId);

        const webhookIdsWithAgent = webhookAgentMappings?.map(m => m.webhook_id) || [];

        // Get all active webhooks for this event type
        const { data: allWebhooks } = await supabase
            .from('webhooks')
            .select('*')
            .eq('is_active', true)
            .contains('events', [eventType]);

        if (!allWebhooks || allWebhooks.length === 0) {
            return NextResponse.json({ received: true, forwarded: 0 });
        }

        // Filter webhooks
        const webhooksToForward = [];
        for (const webhook of allWebhooks) {
            const { count } = await supabase
                .from('webhook_agents')
                .select('*', { count: 'exact', head: true })
                .eq('webhook_id', webhook.id);

            if (count === 0 || webhookIdsWithAgent.includes(webhook.id)) {
                webhooksToForward.push(webhook);
            }
        }

        // Transform payload
        const transformedPayload = transformPayload(body, eventType);
        if (!transformedPayload) {
            return NextResponse.json({ received: true });
        }

        // Forward to each webhook
        const results = await Promise.all(
            webhooksToForward.map(async (webhook) => {
                const result = await forwardToWebhook(
                    webhook.url,
                    transformedPayload,
                    webhook.secret
                );

                await supabase.from('webhook_logs').insert({
                    webhook_id: webhook.id,
                    event_type: eventType,
                    payload: transformedPayload,
                    response_status: result.status,
                    error_message: result.error
                });

                return result;
            })
        );

        const successCount = results.filter(r => r.success).length;

        return NextResponse.json({
            received: true,
            forwarded: successCount,
            total: webhooksToForward.length
        });
    } catch (error) {
        console.error('Vapi webhook error:', error);
        return NextResponse.json({ error: 'Webhook processing failed' }, { status: 500 });
    }
}
