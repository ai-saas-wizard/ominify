import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
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
    };
}

// Update contact after call ends
async function updateContactAfterCall(call: VapiWebhookPayload['message']['call']) {
    if (!call?.customer?.number || !call.orgId) return;

    try {
        // Find client by org ID
        const { data: client } = await supabase
            .from('clients')
            .select('id')
            .eq('vapi_org_id', call.orgId)
            .single();

        if (!client) return;

        // Find or create contact
        let { data: contact } = await supabase
            .from('contacts')
            .select('id, conversation_summary, total_calls')
            .eq('client_id', client.id)
            .eq('phone', call.customer.number)
            .single();

        if (!contact) {
            // Create new contact
            const { data: newContact } = await supabase
                .from('contacts')
                .insert({
                    client_id: client.id,
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

        // Calculate duration
        const startedAt = call.startedAt ? new Date(call.startedAt) : null;
        const endedAt = call.endedAt ? new Date(call.endedAt) : null;
        const durationSeconds = startedAt && endedAt
            ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
            : 0;

        // Add call to history
        await supabase.from('contact_calls').insert({
            contact_id: contact.id,
            vapi_call_id: call.id,
            summary: call.analysis?.summary || null,
            transcript: call.transcript || null,
            outcome: call.endedReason || call.status,
            duration_seconds: durationSeconds,
            called_at: call.startedAt || new Date().toISOString()
        });

        // Update contact with new summary (append to rolling summary)
        const newSummary = call.analysis?.summary;
        let updatedSummary = contact.conversation_summary || '';

        if (newSummary) {
            const callDate = new Date(call.startedAt || Date.now()).toLocaleDateString();
            const summaryEntry = `[${callDate}] ${newSummary}`;

            // Keep last 5 call summaries for context
            const summaries = updatedSummary.split('\n\n').filter(Boolean);
            summaries.push(summaryEntry);
            if (summaries.length > 5) {
                summaries.shift();
            }
            updatedSummary = summaries.join('\n\n');
        }

        // Update contact
        const updateData: any = {
            total_calls: (contact.total_calls || 0) + 1,
            last_call_at: call.startedAt || new Date().toISOString(),
            updated_at: new Date().toISOString()
        };

        if (newSummary) {
            updateData.conversation_summary = updatedSummary;
        }

        // Extract name/email from structured data if not already set
        if (call.analysis?.structuredData?.name) {
            const { data: currentContact } = await supabase
                .from('contacts')
                .select('name')
                .eq('id', contact.id)
                .single();

            if (!currentContact?.name) {
                updateData.name = call.analysis.structuredData.name;
            }
        }

        if (call.analysis?.structuredData?.email) {
            const { data: currentContact } = await supabase
                .from('contacts')
                .select('email')
                .eq('id', contact.id)
                .single();

            if (!currentContact?.email) {
                updateData.email = call.analysis.structuredData.email;
            }
        }

        await supabase
            .from('contacts')
            .update(updateData)
            .eq('id', contact.id);

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

        // Map Vapi message types to our event types
        let eventType: string | null = null;
        if (messageType === 'status-update' && call.status === 'in-progress') {
            eventType = 'call.started';
        } else if (messageType === 'end-of-call-report') {
            eventType = 'call.ended';

            // UPDATE CONTACT after call ends
            await updateContactAfterCall(call);
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
