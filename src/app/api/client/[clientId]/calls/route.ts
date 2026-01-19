import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

/**
 * GET /api/client/[clientId]/calls
 * 
 * Fetch calls from Supabase for a specific client.
 * Supports pagination, filtering, and search.
 * 
 * Query Parameters:
 * - limit: number (default 100, max 500)
 * - offset: number (default 0)
 * - agentId: string (filter by agent UUID or vapi_id)
 * - type: string (filter by call type: inboundPhoneCall, outboundPhoneCall, webCall)
 * - status: string (filter by status: ended, in-progress, etc.)
 * - search: string (search by phone number)
 * - dateFrom: ISO date string (filter calls from this date)
 * - dateTo: ISO date string (filter calls until this date)
 */
export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;
    const { searchParams } = new URL(request.url);

    // Parse query parameters
    const limit = Math.min(parseInt(searchParams.get('limit') || '100'), 500);
    const offset = parseInt(searchParams.get('offset') || '0');
    const agentId = searchParams.get('agentId') || searchParams.get('assistantId'); // Support both
    const type = searchParams.get('type');
    const status = searchParams.get('status');
    const search = searchParams.get('search');
    const dateFrom = searchParams.get('dateFrom');
    const dateTo = searchParams.get('dateTo');

    try {
        // Verify client exists
        const { data: client } = await supabase
            .from('clients')
            .select('id')
            .eq('id', clientId)
            .single();

        if (!client) {
            return NextResponse.json({ error: 'Client not found' }, { status: 404 });
        }

        // Build query with agent join
        let query = supabase
            .from('calls')
            .select(`
                *,
                agents (
                    id,
                    vapi_id,
                    name
                )
            `, { count: 'exact' })
            .eq('client_id', clientId)
            .order('started_at', { ascending: false });

        // Apply agent filter (could be UUID or vapi_id)
        if (agentId) {
            // First try to find by vapi_id
            const { data: agent } = await supabase
                .from('agents')
                .select('id')
                .eq('vapi_id', agentId)
                .eq('client_id', clientId)
                .single();

            if (agent) {
                query = query.eq('agent_id', agent.id);
            } else {
                // Try as direct UUID
                query = query.eq('agent_id', agentId);
            }
        }

        if (type) {
            query = query.eq('type', type);
        }

        if (status) {
            query = query.eq('status', status);
        }

        if (search) {
            // Search by phone number (partial match)
            query = query.ilike('customer_number', `%${search}%`);
        }

        if (dateFrom) {
            query = query.gte('started_at', dateFrom);
        }

        if (dateTo) {
            query = query.lte('started_at', dateTo);
        }

        // Apply pagination
        query = query.range(offset, offset + limit - 1);

        const { data: calls, count, error } = await query;

        if (error) {
            console.error('Error fetching calls:', error);
            return NextResponse.json({ error: 'Failed to fetch calls' }, { status: 500 });
        }

        return NextResponse.json({
            calls: calls || [],
            total: count || 0,
            limit,
            offset,
            hasMore: (offset + limit) < (count || 0)
        });

    } catch (error) {
        console.error('Calls API error:', error);
        return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
}
