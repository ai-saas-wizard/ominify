import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { listApiKeys } from "@/app/actions/api-key-actions";
import { ApiKeysSection } from "@/components/settings/api-keys-section";

export default async function ApiKeysPage({
    params,
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const { keys } = await listApiKeys(clientId);

    return (
        <div className="max-w-3xl mx-auto px-8 py-8">
            <div className="mb-6">
                <Link
                    href={`/client/${clientId}/settings`}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4"
                >
                    <ArrowLeft className="w-4 h-4" />
                    Back to Settings
                </Link>
                <h1 className="text-2xl font-bold text-gray-900">API Keys</h1>
                <p className="text-sm text-gray-500 mt-1">
                    Manage API keys for the Lead Creation endpoint and other integrations.
                </p>
            </div>

            <ApiKeysSection clientId={clientId} initialKeys={keys} />
        </div>
    );
}
