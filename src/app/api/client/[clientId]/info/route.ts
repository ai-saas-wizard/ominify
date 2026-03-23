import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ clientId: string }> }
) {
    try {
        const { clientId } = await context.params;

        const { data: client, error } = await supabase
            .from('clients')
            .select('id, name, email, account_type, created_at')
            .eq('id', clientId)
            .single();

        if (error || !client) {
            return NextResponse.json(
                { error: 'Client not found' },
                { status: 404 }
            );
        }

        // Fetch business name from tenant_profiles
        const { data: profile } = await supabase
            .from('tenant_profiles')
            .select('legal_business_name')
            .eq('client_id', clientId)
            .single();

        return NextResponse.json({
            ...client,
            business_name: profile?.legal_business_name || null,
        });
    } catch (error: any) {
        console.error('Client info fetch error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch client info' },
            { status: 500 }
        );
    }
}
