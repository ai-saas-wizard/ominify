import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET - List contacts for a client
export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search');
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');

    try {
        let query = supabase
            .from('contacts')
            .select('*', { count: 'exact' })
            .eq('client_id', clientId)
            .order('last_call_at', { ascending: false, nullsFirst: false })
            .range(offset, offset + limit - 1);

        if (search) {
            query = query.or(`name.ilike.%${search}%,phone.ilike.%${search}%,email.ilike.%${search}%`);
        }

        const { data, error, count } = await query;

        if (error) throw error;

        return NextResponse.json({
            contacts: data || [],
            total: count || 0,
            limit,
            offset
        });
    } catch (error) {
        console.error('Error fetching contacts:', error);
        return NextResponse.json({ error: 'Failed to fetch contacts' }, { status: 500 });
    }
}

// POST - Create a new contact
export async function POST(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    try {
        const body = await request.json();
        const { phone, name, email, custom_fields } = body;

        if (!phone) {
            return NextResponse.json({ error: 'Phone number is required' }, { status: 400 });
        }

        // Check if contact already exists
        const { data: existing } = await supabase
            .from('contacts')
            .select('id')
            .eq('client_id', clientId)
            .eq('phone', phone)
            .single();

        if (existing) {
            return NextResponse.json({ error: 'Contact with this phone already exists' }, { status: 409 });
        }

        const { data, error } = await supabase
            .from('contacts')
            .insert({
                client_id: clientId,
                phone,
                name: name || null,
                email: email || null,
                custom_fields: custom_fields || {},
                total_calls: 0
            })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json(data, { status: 201 });
    } catch (error) {
        console.error('Error creating contact:', error);
        return NextResponse.json({ error: 'Failed to create contact' }, { status: 500 });
    }
}
