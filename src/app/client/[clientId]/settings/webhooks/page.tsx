import { supabase } from "@/lib/supabase";
import { listAgents } from "@/lib/vapi";
import { WebhookManager } from "@/components/webhooks/webhook-manager";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

async function getClient(clientId: string) {
    const { data } = await supabase
        .from('clients')
        .select('*')
        .eq('id', clientId)
        .single();
    return data;
}

async function getAgentsFromVapi(vapiKey: string | null) {
    // Fetch agents directly from Vapi API
    const vapiAgents = await listAgents(vapiKey || undefined);
    return vapiAgents.map(agent => ({
        id: agent.id,
        name: agent.name,
        vapi_id: agent.id
    }));
}

export default async function WebhooksSettingsPage({
    params
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const client = await getClient(clientId);

    if (!client) {
        return (
            <div className="p-8">
                <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-center">
                    <p className="text-red-600">Client not found</p>
                </div>
            </div>
        );
    }

    const agents = await getAgentsFromVapi(client.vapi_key);

    return (
        <div className="p-4 lg:p-8 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Link
                    href={`/client/${clientId}/settings`}
                    className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                >
                    <ArrowLeft className="w-5 h-5 text-gray-600" />
                </Link>
                <div>
                    <h1 className="text-2xl font-bold text-gray-900">Webhooks</h1>
                    <p className="text-gray-500 text-sm">
                        Manage webhook endpoints for real-time call notifications
                    </p>
                </div>
            </div>

            {/* Webhook Manager */}
            <WebhookManager clientId={clientId} agents={agents} />
        </div>
    );
}
