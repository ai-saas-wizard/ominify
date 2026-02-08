import { listAgents, getOrgIdFromAgents, VapiAgent } from "@/lib/vapi";
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
    let accountType: string | null = null;

    if (params.clientId) {
        const { data } = await supabase
            .from("clients")
            .select("name, vapi_key, vapi_org_id, account_type")
            .eq("id", params.clientId)
            .single();
        if (data) {
            vapiKey = data.vapi_key;
            clientName = `${data.name}'s Agents`;
            currentOrgId = data.vapi_org_id;
            accountType = data.account_type;
        }
    }

    let agents: VapiAgent[] = await listAgents(vapiKey);

    // ═══ UMBRELLA AGENT ISOLATION ═══
    // UMBRELLA clients share a VAPI org with other tenants.
    // Filter to only show agents that belong to THIS client via the local agents table.
    if (accountType === "UMBRELLA" && params.clientId) {
        const { data: localAgents } = await supabase
            .from("agents")
            .select("vapi_id")
            .eq("client_id", params.clientId);

        if (localAgents && localAgents.length > 0) {
            // Only show VAPI agents that are registered to this client locally
            const clientVapiIds = new Set(localAgents.map((a) => a.vapi_id));
            agents = agents.filter((agent) => clientVapiIds.has(agent.id));
        } else {
            // No agents registered locally for this client — show empty
            agents = [];
        }
    }

    // Auto-sync org ID silently in background if not set (Type A only)
    if (params.clientId && !currentOrgId && agents.length > 0 && accountType !== "UMBRELLA") {
        const orgId = getOrgIdFromAgents(agents);
        if (orgId) {
            (async () => {
                try {
                    await supabase
                        .from("clients")
                        .update({ vapi_org_id: orgId })
                        .eq("id", params.clientId);
                } catch (e) {
                    // Silent fail - not critical
                }
            })();
        }
    }

    return (
        <div className="flex flex-col h-full">
            <div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between bg-white sticky top-0 z-10">
                <h2 className="text-xl font-semibold text-gray-900">
                    {clientName}
                </h2>
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
                {accountType === "UMBRELLA" && agents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-16 h-16 bg-violet-100 rounded-full flex items-center justify-center mb-4">
                            <svg
                                className="w-8 h-8 text-violet-600"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                                />
                            </svg>
                        </div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">
                            No Agents Yet
                        </h3>
                        <p className="text-gray-500 text-sm max-w-sm">
                            Complete your onboarding to have AI agents set up
                            for your business. Once configured, your agents will
                            appear here.
                        </p>
                        <Link
                            href={`/client/${params.clientId}/onboarding`}
                            className="mt-4 inline-flex items-center gap-2 px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm font-medium"
                        >
                            Go to Onboarding
                            <svg
                                className="w-4 h-4"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                            >
                                <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M9 5l7 7-7 7"
                                />
                            </svg>
                        </Link>
                    </div>
                ) : (
                    <AgentTable agents={agents} />
                )}
            </div>
        </div>
    );
}
