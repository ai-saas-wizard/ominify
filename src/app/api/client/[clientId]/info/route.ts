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

        return NextResponse.json(client);
    } catch (error: any) {
        console.error('Client info fetch error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch client info' },
            { status: 500 }
        );
    }
}
