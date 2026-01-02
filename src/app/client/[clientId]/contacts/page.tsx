import { supabase } from "@/lib/supabase";
import { ContactsPageClient } from "@/components/contacts/contacts-page-client";

async function getContacts(clientId: string) {
    const { data, count } = await supabase
        .from('contacts')
        .select('*', { count: 'exact' })
        .eq('client_id', clientId)
        .order('last_call_at', { ascending: false, nullsFirst: false })
        .limit(50);

    return { contacts: data || [], total: count || 0 };
}

async function getCustomFields(clientId: string) {
    const { data } = await supabase
        .from('contact_fields')
        .select('*')
        .eq('client_id', clientId)
        .order('display_order', { ascending: true });

    return data || [];
}

export default async function ContactsPage({
    params
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const { contacts, total } = await getContacts(clientId);
    const customFields = await getCustomFields(clientId);

    return (
        <ContactsPageClient
            clientId={clientId}
            initialContacts={contacts}
            total={total}
            customFields={customFields}
        />
    );
}
