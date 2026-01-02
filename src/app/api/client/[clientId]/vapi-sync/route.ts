import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";
import { getVapiOrgId } from "@/lib/vapi-org";

// POST - Sync Vapi Org ID for a client
export async function POST(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    try {
        // Get client's Vapi key
        const { data: client } = await supabase
            .from('clients')
            .select('vapi_key')
            .eq('id', clientId)
            .single();

        if (!client?.vapi_key) {
            return NextResponse.json({
                error: 'No Vapi API key configured for this client'
            }, { status: 400 });
        }

        // Fetch org ID from Vapi
        const orgId = await getVapiOrgId(client.vapi_key);

        if (!orgId) {
            return NextResponse.json({
                error: 'Could not fetch Vapi organization ID. Make sure you have at least one agent or phone number in Vapi.'
            }, { status: 400 });
        }

        // Update client with org ID
        const { error } = await supabase
            .from('clients')
            .update({ vapi_org_id: orgId })
            .eq('id', clientId);

        if (error) throw error;

        return NextResponse.json({
            success: true,
            orgId
        });
    } catch (error) {
        console.error('Error syncing Vapi org ID:', error);
        return NextResponse.json({ error: 'Failed to sync Vapi org ID' }, { status: 500 });
    }
}

// GET - Check current Vapi Org ID
export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    try {
        const { data: client } = await supabase
            .from('clients')
            .select('vapi_org_id')
            .eq('id', clientId)
            .single();

        return NextResponse.json({
            orgId: client?.vapi_org_id || null,
            isConfigured: !!client?.vapi_org_id
        });
    } catch (error) {
        return NextResponse.json({ error: 'Failed to fetch org ID' }, { status: 500 });
    }
}
