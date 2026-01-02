import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// GET - Get a single contact with call history
export async function GET(
    request: Request,
    { params }: { params: Promise<{ clientId: string; contactId: string }> }
) {
    const { clientId, contactId } = await params;

    try {
        // Get contact
        const { data: contact, error } = await supabase
            .from('contacts')
            .select('*')
            .eq('id', contactId)
            .eq('client_id', clientId)
            .single();

        if (error || !contact) {
            return NextResponse.json({ error: 'Contact not found' }, { status: 404 });
        }

        // Get call history
        const { data: calls } = await supabase
            .from('contact_calls')
            .select('*')
            .eq('contact_id', contactId)
            .order('called_at', { ascending: false })
            .limit(20);

        return NextResponse.json({
            ...contact,
            calls: calls || []
        });
    } catch (error) {
        console.error('Error fetching contact:', error);
        return NextResponse.json({ error: 'Failed to fetch contact' }, { status: 500 });
    }
}

// PATCH - Update a contact
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ clientId: string; contactId: string }> }
) {
    const { clientId, contactId } = await params;

    try {
        const body = await request.json();
        const { name, email, custom_fields, conversation_summary } = body;

        const updateData: any = { updated_at: new Date().toISOString() };

        if (name !== undefined) updateData.name = name;
        if (email !== undefined) updateData.email = email;
        if (custom_fields !== undefined) updateData.custom_fields = custom_fields;
        if (conversation_summary !== undefined) updateData.conversation_summary = conversation_summary;

        const { data, error } = await supabase
            .from('contacts')
            .update(updateData)
            .eq('id', contactId)
            .eq('client_id', clientId)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json(data);
    } catch (error) {
        console.error('Error updating contact:', error);
        return NextResponse.json({ error: 'Failed to update contact' }, { status: 500 });
    }
}

// DELETE - Delete a contact
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ clientId: string; contactId: string }> }
) {
    const { clientId, contactId } = await params;

    try {
        const { error } = await supabase
            .from('contacts')
            .delete()
            .eq('id', contactId)
            .eq('client_id', clientId);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting contact:', error);
        return NextResponse.json({ error: 'Failed to delete contact' }, { status: 500 });
    }
}
