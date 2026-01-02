import { listAgents, getOrgIdFromAgents } from "@/lib/vapi";
import { supabase } from "@/lib/supabase";
import { Plus, Search, Filter } from "lucide-react";
import Link from "next/link";
import { AgentTable } from "@/components/agents/agent-table";

export default async function AgentsPage(props: {
    params: Promise<{ clientId: string }>;
}) {
    const params = await props.params;
    let vapiKey: string | undefined = undefined;
    let clientName = "Agents";
    let currentOrgId: string | null = null;

    if (params.clientId) {
        const { data } = await supabase.from('clients').select('name, vapi_key, vapi_org_id').eq('id', params.clientId).single();
        if (data) {
            vapiKey = data.vapi_key;
            clientName = `${data.name}'s Agents`;
            currentOrgId = data.vapi_org_id;
        }
    }

    const agents = await listAgents(vapiKey);

    // Auto-sync org ID silently in background if not set
    if (params.clientId && !currentOrgId && agents.length > 0) {
        const orgId = getOrgIdFromAgents(agents);
        if (orgId) {
            // Fire and forget - background sync
            (async () => {
                try {
                    await supabase
                        .from('clients')
                        .update({ vapi_org_id: orgId })
                        .eq('id', params.clientId);
                } catch (e) {
                    // Silent fail - not critical
                }
            })();
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <h2 className="text-xl font-semibold text-gray-900">{clientName}</h2>
                <div className="flex items-center gap-3">
                    <div className="relative">
                        <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                        <input
                            placeholder="Search..."
                            className="pl-9 pr-4 py-2 border border-gray-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-violet-500/20 focus:border-violet-500 transition-all"
                        />
                    </div>
                    <button className="p-2 border border-gray-200 rounded-lg text-gray-500 hover:bg-gray-50 transition-colors">
                        <Filter className="w-4 h-4" />
                    </button>
                    <button className="bg-[#111827] hover:bg-gray-800 text-white px-4 py-2 rounded-lg flex items-center gap-2 text-sm font-medium transition-colors">
                        <Plus className="w-4 h-4" />
                        Create Agent
                    </button>
                </div>
            </div>

            <div className="p-8 bg-gray-50 flex-1 overflow-auto">
                <AgentTable agents={agents} />
            </div>
        </div>
    );
}
