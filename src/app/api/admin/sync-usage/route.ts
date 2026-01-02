import { NextRequest, NextResponse } from 'next/server';
import { syncAllClientsCallUsage } from '@/app/actions/billing-actions';

export async function POST(request: NextRequest) {
    try {
        const result = await syncAllClientsCallUsage();

        return NextResponse.json({
            clientsSynced: result.clientsSynced,
            totalSynced: result.totalSynced,
            totalErrors: result.totalErrors,
        });
    } catch (error: any) {
        console.error('Sync usage error:', error);
        return NextResponse.json(
            { error: error.message || 'Sync failed' },
            { status: 500 }
        );
    }
}
