import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@clerk/nextjs/server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
    try {
        // Get the current user from Clerk
        const { userId } = await auth();

        if (!userId) {
            return NextResponse.json(
                { error: 'Unauthorized' },
                { status: 401 }
            );
        }

        // Find all clients linked to this Clerk user
        const { data: clients, error } = await supabase
            .from('clients')
            .select('id, name, email')
            .eq('clerk_id', userId)
            .order('name');

        if (error) {
            throw error;
        }

        // Fetch business names from tenant_profiles for all clients
        const clientIds = (clients || []).map(c => c.id);
        let profileMap: Record<string, string> = {};
        if (clientIds.length > 0) {
            const { data: profiles } = await supabase
                .from('tenant_profiles')
                .select('client_id, legal_business_name')
                .in('client_id', clientIds);
            if (profiles) {
                for (const p of profiles) {
                    if (p.legal_business_name) profileMap[p.client_id] = p.legal_business_name;
                }
            }
        }

        return NextResponse.json({
            clients: (clients || []).map(c => ({
                ...c,
                business_name: profileMap[c.id] || null,
            }))
        });
    } catch (error: any) {
        console.error('User clients fetch error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch clients' },
            { status: 500 }
        );
    }
}
