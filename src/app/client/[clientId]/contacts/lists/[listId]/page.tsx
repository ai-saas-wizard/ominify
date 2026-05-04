import { notFound } from "next/navigation";
import {
    getContactList,
    getListMembers,
} from "@/app/actions/contact-list-actions";
import { ListDetailClient } from "@/components/contacts/lists/list-detail-client";

export default async function ContactListDetailPage({
    params,
}: {
    params: Promise<{ clientId: string; listId: string }>;
}) {
    const { clientId, listId } = await params;
    const listResult = await getContactList(listId);
    if (!listResult.success || !listResult.data) notFound();
    const list = listResult.data as any;
    if (list.client_id !== clientId) notFound();

    const membersResult = await getListMembers(listId, { limit: 200 });
    const data = membersResult.success ? membersResult.data : { rows: [], total: 0 };

    return (
        <ListDetailClient
            clientId={clientId}
            list={list}
            members={(data?.rows || []) as any}
            total={data?.total || 0}
        />
    );
}
