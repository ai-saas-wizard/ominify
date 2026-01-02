import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET - List custom fields for a client
export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    try {
        const { data, error } = await supabase
            .from('contact_fields')
            .select('*')
            .eq('client_id', clientId)
            .order('display_order', { ascending: true });

        if (error) throw error;

        return NextResponse.json(data || []);
    } catch (error) {
        console.error('Error fetching contact fields:', error);
        return NextResponse.json({ error: 'Failed to fetch fields' }, { status: 500 });
    }
}

// POST - Create a new custom field
export async function POST(
    request: Request,
    { params }: { params: Promise<{ clientId: string }> }
) {
    const { clientId } = await params;

    try {
        const body = await request.json();
        const { name, field_type, is_required } = body;

        if (!name || !field_type) {
            return NextResponse.json({ error: 'Name and field_type are required' }, { status: 400 });
        }

        // Generate field_key from name
        const field_key = name.toLowerCase().replace(/[^a-z0-9]/g, '_');

        // Get max display order
        const { data: maxOrder } = await supabase
            .from('contact_fields')
            .select('display_order')
            .eq('client_id', clientId)
            .order('display_order', { ascending: false })
            .limit(1)
            .single();

        const display_order = (maxOrder?.display_order || 0) + 1;

        const { data, error } = await supabase
            .from('contact_fields')
            .insert({
                client_id: clientId,
                name,
                field_key,
                field_type,
                is_required: is_required || false,
                display_order
            })
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json(data, { status: 201 });
    } catch (error) {
        console.error('Error creating contact field:', error);
        return NextResponse.json({ error: 'Failed to create field' }, { status: 500 });
    }
}
