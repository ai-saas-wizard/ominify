import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

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
