import { NextRequest, NextResponse } from 'next/server';
import { getOrCreateMinuteBalance } from '@/lib/billing';

export async function GET(
    request: NextRequest,
    context: { params: Promise<{ clientId: string }> }
) {
    try {
        const { clientId } = await context.params;

        const balance = await getOrCreateMinuteBalance(clientId);

        return NextResponse.json({
            balance_minutes: balance.balance_minutes,
            total_purchased: balance.total_purchased_minutes,
            total_used: balance.total_used_minutes,
        });
    } catch (error: any) {
        console.error('Balance fetch error:', error);
        return NextResponse.json(
            { error: error.message || 'Failed to fetch balance' },
            { status: 500 }
        );
    }
}
