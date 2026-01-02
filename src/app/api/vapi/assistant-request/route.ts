import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * Vapi Assistant Request Handler
 * 
 * This endpoint receives the "assistant-request" event from Vapi on inbound calls.
 * It looks up or creates a contact, then returns assistant config with customer context.
 * 
 * Configure in Vapi: Set this as the Server URL for your phone number or assistant.
 */

interface VapiAssistantRequest {
    message: {
        type: string;
        call?: {
            id: string;
            orgId: string;
            customer?: {
                number?: string;
            };
            phoneNumberId?: string;
        };
    };
}

interface Contact {
    id: string;
    name: string | null;
    email: string | null;
    phone: string;
    conversation_summary: string | null;
    total_calls: number;
    last_call_at: string | null;
    custom_fields: Record<string, any>;
}

export async function POST(request: Request) {
    try {
        const body = await request.json() as VapiAssistantRequest;

        // Only handle assistant-request type
        if (body.message?.type !== 'assistant-request') {
            return NextResponse.json({ received: true });
        }

        const customerPhone = body.message.call?.customer?.number;
        const phoneNumberId = body.message.call?.phoneNumberId;

        if (!customerPhone) {
            // Can't lookup without phone, return default
            return NextResponse.json({});
        }

        // Find the client by their Vapi phone number ID or org ID
        // For now, we'll look up by orgId if available
        const orgId = body.message.call?.orgId;

        let clientId: string | null = null;

        if (orgId) {
            const { data: client } = await supabase
                .from('clients')
                .select('id')
                .eq('vapi_org_id', orgId)
                .single();

            clientId = client?.id || null;
        }

        // If no client found, return empty (use default assistant)
        if (!clientId) {
            return NextResponse.json({});
        }

        // Find or create contact
        let contact: Contact | null = null;

        const { data: existingContact } = await supabase
            .from('contacts')
            .select('*')
            .eq('client_id', clientId)
            .eq('phone', customerPhone)
            .single();

        if (existingContact) {
            contact = existingContact as Contact;
        } else {
            // Create new contact
            const { data: newContact } = await supabase
                .from('contacts')
                .insert({
                    client_id: clientId,
                    phone: customerPhone,
                    total_calls: 0
                })
                .select()
                .single();

            contact = newContact as Contact;
        }

        if (!contact) {
            return NextResponse.json({});
        }

        // Build customer context for AI
        const isReturningCaller = contact.total_calls > 0;
        let customerContext = '';

        if (isReturningCaller) {
            customerContext = `
RETURNING CALLER DETECTED
Name: ${contact.name || 'Unknown'}
Phone: ${contact.phone}
Email: ${contact.email || 'Not provided'}
Previous Calls: ${contact.total_calls}
Last Call: ${contact.last_call_at ? new Date(contact.last_call_at).toLocaleDateString() : 'Unknown'}

CONVERSATION HISTORY:
${contact.conversation_summary || 'No previous conversation summary available.'}

Use this context to personalize the conversation. Reference previous interactions naturally.
`.trim();
        } else {
            customerContext = `
NEW CALLER
Phone: ${contact.phone}
This is their first time calling. Be welcoming and gather basic information.
`.trim();
        }

        // Return assistant configuration with variable values
        // These can be referenced in the assistant's prompt as {{customer_name}}, {{customer_context}}, etc.
        return NextResponse.json({
            variableValues: {
                customer_name: contact.name || '',
                customer_phone: contact.phone,
                customer_email: contact.email || '',
                customer_context: customerContext,
                is_returning_caller: isReturningCaller,
                total_previous_calls: contact.total_calls,
                contact_id: contact.id
            }
        });
    } catch (error) {
        console.error('Assistant request error:', error);
        // Return empty on error to let Vapi use default
        return NextResponse.json({});
    }
}
