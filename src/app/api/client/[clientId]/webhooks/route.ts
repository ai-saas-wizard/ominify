import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { auth } from "@clerk/nextjs/server";

// Types
interface Webhook {
    id: string;
    client_id: string;
    name: string;
    url: string;
    secret?: string;
    events: string[];
    is_active: boolean;
    created_at: string;
    updated_at: string;
    agents?: { id: string; name: string; vapi_id: string }[];
}

// GET - List all webhooks for a client
export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    try {
        // Fetch webhooks
        const { data: webhooks, error } = await supabase
            .from('webhooks')
            .select('*')
            .eq('client_id', clientId)
            .order('created_at', { ascending: false });

        if (error) throw error;

        // Fetch agent mappings for each webhook
        const webhooksWithAgents = await Promise.all(
            (webhooks || []).map(async (webhook) => {
                const { data: agentMappings } = await supabase
                    .from('webhook_agents')
                    .select('agent_id')
                    .eq('webhook_id', webhook.id);

                const agentIds = agentMappings?.map(m => m.agent_id) || [];

                // Fetch agent details
                const { data: agents } = await supabase
                    .from('agents')
                    .select('id, name, vapi_id')
                    .in('id', agentIds.length > 0 ? agentIds : ['none']);

                return {
                    ...webhook,
                    agents: agents || []
                };
            })
        );

        return NextResponse.json(webhooksWithAgents);
    } catch (error) {
        console.error('Error fetching webhooks:', error);
        return NextResponse.json({ error: 'Failed to fetch webhooks' }, { status: 500 });
    }
}

// POST - Create a new webhook
export async function POST(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    try {
        const body = await request.json();
        const { name, url, events, agentIds, secret } = body;

        if (!name || !url) {
            return NextResponse.json({ error: 'Name and URL are required' }, { status: 400 });
        }

        // Create webhook
        const { data: webhook, error } = await supabase
            .from('webhooks')
            .insert({
                client_id: clientId,
                name,
                url,
                events: events || ['call.ended'],
                secret: secret || null,
                is_active: true
            })
            .select()
            .single();

        if (error) throw error;

        // Create agent mappings
        if (agentIds && agentIds.length > 0) {
            const mappings = agentIds.map((agentId: string) => ({
                webhook_id: webhook.id,
                agent_id: agentId
            }));

            await supabase.from('webhook_agents').insert(mappings);
        }

        return NextResponse.json(webhook, { status: 201 });
    } catch (error) {
        console.error('Error creating webhook:', error);
        return NextResponse.json({ error: 'Failed to create webhook' }, { status: 500 });
    }
}
