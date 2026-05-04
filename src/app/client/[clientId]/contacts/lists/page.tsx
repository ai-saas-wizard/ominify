import { listContactLists } from "@/app/actions/contact-list-actions";
import { ListsPageClient } from "@/components/contacts/lists/lists-page-client";

export default async function ContactsListsPage({
    params,
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const result = await listContactLists(clientId, { includeArchived: true });
    const lists = (result.success ? result.data : []) || [];

    return <ListsPageClient clientId={clientId} initialLists={lists} />;
}
