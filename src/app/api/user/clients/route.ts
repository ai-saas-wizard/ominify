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

        return NextResponse.json({
            clients: clients || []
        });
    } catch (error: any) {
        console.error('User clients fetch error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch clients' },
            { status: 500 }
        );
    }
}
