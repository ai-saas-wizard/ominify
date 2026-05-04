import { ImportWizard } from "@/components/contacts/import/import-wizard";

export default async function ContactsImportPage({
    params,
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    return <ImportWizard clientId={clientId} />;
}
