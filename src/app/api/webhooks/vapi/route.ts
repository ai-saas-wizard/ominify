import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { recordCallUsage } from "@/lib/billing";
import { extractContactInfo } from "@/lib/openai-extractor";
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
        endedReason?: string;
        artifact?: {
            messages?: Array<{
                role: string;
                message?: string;
                content?: string;
            }>;
            transcript?: string;
            recordingUrl?: string;
            stereoRecordingUrl?: string;
        };
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
            phoneNumberId?: string;
            customer?: {
                number?: string;
            };
            costs?: Array<{
                type: string;
                cost: number;
            }>;
            analysis?: {
                summary?: string;
                structuredData?: Record<string, any>;
            };
            artifact?: {
                recordingUrl?: string;
                stereoRecordingUrl?: string;
            };
        };
        assistant?: {
            id: string;
            name: string;
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

// Get contact context for assistant-request (inject into AI)
async function getContactContext(call: NonNullable<VapiWebhookPayload['message']['call']>): Promise<{
    variableValues: Record<string, any>;
} | null> {
    const phone = call?.customer?.number;
    if (!phone || !call?.orgId) return null;

    try {
        const clientId = await getClientIdByOrgId(call.orgId);
        if (!clientId) return null;

        // Get or create contact
        let { data: contact } = await supabase
            .from('contacts')
            .select('id, name, email, conversation_summary, total_calls, last_call_at')
            .eq('client_id', clientId)
            .eq('phone', phone)
            .single();

        // Create contact if doesn't exist
        if (!contact) {
            const { data: newContact } = await supabase
                .from('contacts')
                .insert({ client_id: clientId, phone, total_calls: 0 })
                .select('id, name, email, conversation_summary, total_calls, last_call_at')
                .single();
            contact = newContact;
        }

        if (!contact) return null;

        const isReturningCaller = (contact.total_calls || 0) > 0;

        // Build context string for AI
        let customerContext = '';
        if (isReturningCaller) {
            customerContext = `RETURNING CALLER DETECTED\nName: ${contact.name || 'Unknown'}\nPhone: ${phone}\nEmail: ${contact.email || 'Not provided'}\nPrevious Calls: ${contact.total_calls}\nLast Call: ${contact.last_call_at ? new Date(contact.last_call_at).toLocaleDateString() : 'Unknown'}\n\nCONVERSATION HISTORY:\n${contact.conversation_summary || 'No previous conversation summary.'}\n\nUse this context to personalize the conversation.`;
        } else {
            customerContext = `NEW CALLER\nPhone: ${phone}\nThis is their first time calling. Be welcoming and gather basic information.`;
        }

        console.log('[VAPI WEBHOOK] Returning context for', isReturningCaller ? 'returning' : 'new', 'caller:', phone);

        return {
            variableValues: {
                customer_name: contact.name || '',
                customer_phone: phone,
                customer_email: contact.email || '',
                customer_context: customerContext,
                is_returning_caller: isReturningCaller,
                total_previous_calls: contact.total_calls || 0,
                contact_id: contact.id
            }
        };
    } catch (error) {
        console.error('[VAPI WEBHOOK] Error getting contact context:', error);
        return null;
    }
}

// Handle Call Started - Create Active Call
async function handleCallStarted(call: NonNullable<VapiWebhookPayload['message']['call']>) {
    console.log('[VAPI WEBHOOK] handleCallStarted called:', { callId: call.id, orgId: call.orgId });
    try {
        if (!call.orgId) {
            console.log('[VAPI WEBHOOK] No orgId, skipping');
            return;
        }
        const clientId = await getClientIdByOrgId(call.orgId);
        console.log('[VAPI WEBHOOK] Client lookup result:', { orgId: call.orgId, clientId });
        if (!clientId) {
            console.log('[VAPI WEBHOOK] No client found for orgId:', call.orgId);
            return;
        }

        // Cleanup stale calls older than 1 hour (in case end-of-call webhooks were missed)
        await supabase
            .from('active_calls')
            .delete()
            .lt('started_at', new Date(Date.now() - 60 * 60 * 1000).toISOString());

        // Check if already exists to avoid duplicates
        const { data: existing } = await supabase
            .from('active_calls')
            .select('id')
            .eq('vapi_call_id', call.id)
            .single();

        if (existing) {
            console.log('[VAPI WEBHOOK] Call already exists, skipping insert:', call.id);
            return;
        }

        const insertResult = await supabase.from('active_calls').insert({
            vapi_call_id: call.id,
            client_id: clientId,
            status: call.status || 'ringing',
            started_at: call.startedAt || new Date().toISOString(),
            customer_number: call.customer?.number,
            assistant_id: call.assistantId,
            type: call.type || 'inbound',
            last_active_at: new Date().toISOString()
        });
        console.log('[VAPI WEBHOOK] Insert result:', insertResult);
    } catch (error) {
        console.error('[VAPI WEBHOOK] Error handling call started:', error);
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

// Persist call record to Supabase calls table
async function persistCallRecord(
    call: NonNullable<VapiWebhookPayload['message']['call']>,
    artifact?: VapiWebhookPayload['message']['artifact'],
    assistant?: VapiWebhookPayload['message']['assistant'],
    endedReason?: string,
    rawPayload?: any
) {
    console.log('[VAPI WEBHOOK] persistCallRecord called for:', call.id);
    try {
        if (!call.orgId) {
            console.log('[VAPI WEBHOOK] No orgId, skipping persist');
            return;
        }

        const clientId = await getClientIdByOrgId(call.orgId);
        if (!clientId) {
            console.log('[VAPI WEBHOOK] No client found for orgId:', call.orgId);
            return;
        }

        // Look up agent by vapi_id (Vapi's assistantId) to get our internal agent UUID
        let agentId: string | null = null;
        if (call.assistantId) {
            const { data: agent } = await supabase
                .from('agents')
                .select('id')
                .eq('vapi_id', call.assistantId)
                .eq('client_id', clientId)
                .single();

            agentId = agent?.id || null;
            if (!agentId) {
                console.log('[VAPI WEBHOOK] No agent found for vapi_id:', call.assistantId);
            }
        }

        // Calculate duration
        const startedAt = call.startedAt ? new Date(call.startedAt) : null;
        const endedAt = call.endedAt ? new Date(call.endedAt) : null;
        const durationSeconds = startedAt && endedAt
            ? Math.round((endedAt.getTime() - startedAt.getTime()) / 1000)
            : 0;

        // Build transcript from artifact.messages if needed
        let transcript = call.transcript || artifact?.transcript || '';
        if (!transcript && artifact?.messages) {
            transcript = artifact.messages
                .filter(m => m.role === 'user' || m.role === 'bot' || m.role === 'assistant')
                .map(m => `${m.role}: ${m.message || m.content || ''}`)
                .join('\n');
        }

        // Get recording URL from artifact
        const recordingUrl = call.artifact?.recordingUrl || artifact?.recordingUrl || null;

        // Calculate total cost
        const totalCost = call.costs?.reduce((sum, c) => sum + (c.cost || 0), 0) || 0;

        // Use ended reason from multiple sources
        const finalEndedReason = call.endedReason || endedReason || null;

        // Build call data matching existing schema
        const callData: Record<string, any> = {
            client_id: clientId,
            vapi_call_id: call.id,
            agent_id: agentId,
            duration_seconds: durationSeconds,
            recording_url: recordingUrl,
            transcript: transcript || null,
            cost: totalCost,
            status: call.status || 'ended',
            started_at: call.startedAt || null,
            ended_at: call.endedAt || null,
            // New columns (added via migration)
            customer_number: call.customer?.number || null,
            type: call.type || 'inboundPhoneCall',
            ended_reason: finalEndedReason,
            summary: call.analysis?.summary || null,
            structured_data: call.analysis?.structuredData || {},
            raw_payload: rawPayload || null,
            updated_at: new Date().toISOString()
        };

        // Upsert to handle duplicate webhooks
        const { error } = await supabase
            .from('calls')
            .upsert(callData, {
                onConflict: 'vapi_call_id',
                ignoreDuplicates: false
            });

        if (error) {
            console.error('[VAPI WEBHOOK] Error persisting call:', error);
        } else {
            console.log('[VAPI WEBHOOK] Call persisted successfully:', call.id);
        }
    } catch (error) {
        console.error('[VAPI WEBHOOK] Error in persistCallRecord:', error);
    }
}


// Handle End of Call - Cleanup and History
async function handleEndOfCall(
    call: NonNullable<VapiWebhookPayload['message']['call']>,
    artifact?: VapiWebhookPayload['message']['artifact'],
    assistant?: VapiWebhookPayload['message']['assistant'],
    endedReason?: string,
    rawPayload?: any
) {
    console.log('[VAPI WEBHOOK] handleEndOfCall called for:', call.id);
    try {
        // 1. Remove from active calls
        const deleteResult = await supabase.from('active_calls').delete().eq('vapi_call_id', call.id);
        console.log('[VAPI WEBHOOK] Delete result:', deleteResult);

        // 2. Persist call record to Supabase
        await persistCallRecord(call, artifact, assistant, endedReason, rawPayload);

        // 3. Update Contact History (CRM)
        await updateContactAfterCall(call, artifact);

        // 4. Record Usage for Billing
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
        console.log('[VAPI WEBHOOK] handleEndOfCall completed for:', call.id);

    } catch (error) {
        console.error('Error handling end of call:', error);
    }
}

// Update contact after call ends (Existing Logic)
async function updateContactAfterCall(
    call: NonNullable<VapiWebhookPayload['message']['call']>,
    artifact?: VapiWebhookPayload['message']['artifact']
) {
    if (!call?.customer?.number || !call.orgId) return;

    // Build transcript from artifact.messages if call.transcript is empty
    let transcript = call.transcript || '';
    if (!transcript && artifact?.messages) {
        transcript = artifact.messages
            .filter(m => m.role === 'user' || m.role === 'bot' || m.role === 'assistant')
            .map(m => `${m.role}: ${m.message || m.content || ''}`)
            .join('\n');
        console.log('[VAPI WEBHOOK] Built transcript from artifact.messages, length:', transcript.length);
    } else if (artifact?.transcript) {
        transcript = artifact.transcript;
    }

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
            transcript: transcript || null,  // Use the built transcript
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

        // Extract name/email - try VAPI's built-in extraction first, then OpenAI fallback
        let extractedName = call.analysis?.structuredData?.name ||
            call.analysis?.structuredData?.caller_name || null;
        let extractedEmail = call.analysis?.structuredData?.email ||
            call.analysis?.structuredData?.caller_email || null;

        // Use OpenAI extraction as fallback if transcript exists and we're missing data
        if ((!extractedName || !extractedEmail) && transcript && transcript.length > 100) {
            console.log('[VAPI WEBHOOK] Using OpenAI fallback for contact extraction, transcript length:', transcript.length);
            try {
                const aiExtracted = await extractContactInfo(transcript);
                if (!extractedName && aiExtracted.name) {
                    extractedName = aiExtracted.name;
                    console.log('[VAPI WEBHOOK] OpenAI extracted name:', extractedName);
                }
                if (!extractedEmail && aiExtracted.email) {
                    extractedEmail = aiExtracted.email;
                    console.log('[VAPI WEBHOOK] OpenAI extracted email:', extractedEmail);
                }
            } catch (err) {
                console.error('[VAPI WEBHOOK] OpenAI extraction failed:', err);
            }
        }

        // Update contact with extracted name if we don't have one
        if (extractedName) {
            const { data: current } = await supabase.from('contacts').select('name').eq('id', contact.id).single();
            if (!current?.name) updateData.name = extractedName;
        }
        // Update contact with extracted email if we don't have one
        if (extractedEmail) {
            const { data: current } = await supabase.from('contacts').select('email').eq('id', contact.id).single();
            if (!current?.email) updateData.email = extractedEmail;
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
        const rawPayload = await request.json();

        // Vapi wraps payload in { headers, params, query, body, webhookUrl, executionMode }
        // The actual message is inside body.body.message
        const payload = rawPayload.body || rawPayload;
        const message = payload.message || payload;

        console.log('[VAPI WEBHOOK] Payload structure - has rawPayload.body?:', !!rawPayload.body);
        console.log('[VAPI WEBHOOK] Message type:', message?.type);
        console.log('[VAPI WEBHOOK] Has call?:', !!message?.call);
        console.log('[VAPI WEBHOOK] call.id:', message?.call?.id);
        console.log('[VAPI WEBHOOK] call.orgId:', message?.call?.orgId);

        const messageType = message?.type;
        const call = message?.call;
        const conversation = message?.conversation;

        // Skip if no call object
        if (!call) {
            console.log('[VAPI WEBHOOK] Skipping - no call object');
            return NextResponse.json({ received: true });
        }

        console.log('[VAPI WEBHOOK] Processing call:', call.id, 'type:', messageType, 'status:', call.status);

        // --- ACTIVE CALL TRACKING ---
        // Handle any event that has call data - insert if new, update if exists

        // IMPORTANT: For assistant-request, we must return context for the AI
        if (messageType === 'assistant-request') {
            console.log('[VAPI WEBHOOK] assistant-request - getting contact context for:', call.customer?.number);
            await handleCallStarted(call);
            const context = await getContactContext(call);
            console.log('[VAPI WEBHOOK] Returning context:', context ? 'found' : 'none');
            return NextResponse.json(context || {});
        }

        if (messageType === 'call-started' || messageType === 'assistant.started' || messageType === 'speech-update') {
            await handleCallStarted(call);
        } else if (messageType === 'status-update') {
            // Check if call has ended - Vapi sends status-update with status=ended
            if (call.status === 'ended') {
                console.log('[VAPI WEBHOOK] Call ended via status-update:', call.id);
                await handleEndOfCall(call, message?.artifact, message?.assistant, message?.endedReason, rawPayload);
            } else {
                await handleCallStarted(call); // Ensure call exists
                await handleCallUpdate(call);
            }
        } else if (messageType === 'conversation-update') {
            await handleCallStarted(call); // Ensure call exists
            await handleCallUpdate(call, conversation);
        } else if (messageType === 'end-of-call-report') {
            await handleEndOfCall(call, message?.artifact, message?.assistant, message?.endedReason, rawPayload);
        } else {
            // For any other event type, try to create/update the call
            await handleCallStarted(call);
        }


        // --- WEBHOOK FORWARDING LOGIC ---
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
        const transformedPayload = transformPayload({ message } as VapiWebhookPayload, eventType);
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
