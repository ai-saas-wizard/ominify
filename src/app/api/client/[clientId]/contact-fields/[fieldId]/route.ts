import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

// PATCH - Update editable parts of a custom field (name, description)
export async function PATCH(
    request: Request,
    { params }: { params: Promise<{ clientId: string; fieldId: string }> }
) {
    const { clientId, fieldId } = await params;

    try {
        const body = await request.json();
        const updates: Record<string, any> = {};

        if (typeof body.name === 'string') {
            const trimmed = body.name.trim();
            if (!trimmed) {
                return NextResponse.json({ error: 'Name cannot be empty' }, { status: 400 });
            }
            updates.name = trimmed;
        }

        if (typeof body.description === 'string' || body.description === null) {
            updates.description =
                typeof body.description === 'string'
                    ? body.description.trim() || null
                    : null;
        }

        if (typeof body.is_required === 'boolean') {
            updates.is_required = body.is_required;
        }

        if (Object.keys(updates).length === 0) {
            return NextResponse.json({ error: 'No editable fields provided' }, { status: 400 });
        }

        const { data, error } = await supabase
            .from('contact_fields')
            .update(updates)
            .eq('id', fieldId)
            .eq('client_id', clientId)
            .select()
            .single();

        if (error) throw error;

        return NextResponse.json(data);
    } catch (error) {
        console.error('Error updating field:', error);
        return NextResponse.json({ error: 'Failed to update field' }, { status: 500 });
    }
}

// DELETE - Delete a custom field
export async function DELETE(
    request: Request,
    { params }: { params: Promise<{ clientId: string; fieldId: string }> }
) {
    const { clientId, fieldId } = await params;

    try {
        const { error } = await supabase
            .from('contact_fields')
            .delete()
            .eq('id', fieldId)
            .eq('client_id', clientId);

        if (error) throw error;

        return NextResponse.json({ success: true });
    } catch (error) {
        console.error('Error deleting field:', error);
        return NextResponse.json({ error: 'Failed to delete field' }, { status: 500 });
    }
}
