import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET - Get a single webhook
export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string; webhookId: string }> }
) {
    const { clientId, webhookId } = await params;

    try {
        const { data: webhook, error } = await supabase
            .from('webhooks')
            .select('*')
            .eq('id', webhookId)
            .eq('client_id', clientId)
            .single();

        if (error || !webhook) {
            return NextResponse.json({ error: 'Webhook not found' }, { status: 404 });
        }

        // Fetch agent mappings
        const { data: agentMappings } = await supabase
            .from('webhook_agents')
            .select('agent_id')
            .eq('webhook_id', webhookId);

        const agentIds = agentMappings?.map(m => m.agent_id) || [];

        return NextResponse.json({ ...webhook, agentIds });
    } catch (error) {
        console.error('Error fetching webhook:', error);
        return NextResponse.json({ error: 'Failed to fetch webhook' }, { status: 500 });
    }
}

// PATCH - Update a webhook
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ clientId: string; webhookId: string }> }
) {
    const { clientId, webhookId } = await params;

    try {
        const body = await request.json();
        const { name, url, events, agentIds, secret, is_active } = body;

        // Update webhook
        const updateData: any = { updated_at: new Date().toISOString() };
        if (name !== undefined) updateData.name = name;
        if (url !== undefined) updateData.url = url;
        if (events !== undefined) updateData.events = events;
        if (secret !== undefined) updateData.secret = secret;
        if (is_active !== undefined) updateData.is_active = is_active;

        const { data: webhook, error } = await supabase
            .from('webhooks')
            .update(updateData)
            .eq('id', webhookId)
            .eq('client_id', clientId)
            .select()
            .single();

        if (error) throw error;

        // Update agent mappings if provided
        if (agentIds !== undefined) {
            // Remove existing mappings
            await supabase
                .from('webhook_agents')
                .delete()
                .eq('webhook_id', webhookId);

            // Create new mappings
            if (agentIds.length > 0) {
                const mappings = agentIds.map((agentId: string) => ({
                    webhook_id: webhookId,
                    agent_id: agentId
                }));
                await supabase.from('webhook_agents').insert(mappings);
            }
        }

        return NextResponse.json(webhook);
    } catch (error) {
        console.error('Error updating webhook:', error);
        return NextResponse.json({ error: 'Failed to update webhook' }, { status: 500 });
    }
}

// DELETE - Delete a webhook
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ clientId: string; webhookId: string }> }
) {
    const { clientId, webhookId } = await params;

    try {
        const { error } = await supabase
            .from('webhooks')
            .delete()
            .eq('id', webhookId)
            .eq('client_id', clientId);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting webhook:', error);
        return NextResponse.json({ error: 'Failed to delete webhook' }, { status: 500 });
    }
}
