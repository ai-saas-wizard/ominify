import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { ArrowLeft, Plus, Trash2, Type, Hash, Mail, Calendar, Link as LinkIcon, CheckSquare, MapPin } from "lucide-react";
import { CustomFieldsList } from "@/components/contacts/custom-fields-list";

async function getCustomFields(clientId: string) {
    const { data } = await supabase
        .from('contact_fields')
        .select('*')
        .eq('client_id', clientId)
        .order('display_order', { ascending: true });

    return data || [];
}

export default async function ContactFieldsSettingsPage({
    params
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const fields = await getCustomFields(clientId);

    return (
        <div className="p-4 lg:p-8 max-w-3xl mx-auto space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link
                    href={`/client/${clientId}/contacts`}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <ArrowLeft className="w-5 h-5 text-gray-600" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Custom Fields</h1>
                    <p className="text-gray-500 text-sm">
                        Define custom properties for your contacts
                    </p>
                </div>
            </div>

            {/* Custom Fields */}
            <CustomFieldsList clientId={clientId} initialFields={fields} />
        </div>
    );
}
