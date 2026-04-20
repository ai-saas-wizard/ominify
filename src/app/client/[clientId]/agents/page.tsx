import { listAgents, getOrgIdFromAgents, VapiAgent } from "@/lib/vapi";
import { supabase } from "@/lib/supabase";
import { getClientVapiKey } from "@/lib/client-secrets";
import { Plus, Search, Bot, Phone, Activity } from "lucide-react";
import Link from "next/link";
import { AgentGrid } from "@/components/agents/agent-grid";

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
            .select("name, vapi_org_id, account_type")
            .eq("id", params.clientId)
            .single();
        if (data) {
            clientName = "Agents";
            currentOrgId = data.vapi_org_id;
            accountType = data.account_type;
        }
        vapiKey = (await getClientVapiKey(params.clientId)) || undefined;
    }

    let agents: VapiAgent[] = await listAgents(vapiKey);

    // ═══ UMBRELLA AGENT ISOLATION ═══
    if (accountType === "UMBRELLA" && params.clientId) {
        const { data: localAgents } = await supabase
            .from("agents")
            .select("vapi_id")
            .eq("client_id", params.clientId);

        if (localAgents && localAgents.length > 0) {
            const clientVapiIds = new Set(localAgents.map((a) => a.vapi_id));
            agents = agents.filter((agent) => clientVapiIds.has(agent.id));
        } else {
            agents = [];
        }
    }

    // Auto-sync org ID silently
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
                    // Silent fail
                }
            })();
        }
    }

    return (
        <div className="flex flex-col h-full bg-gray-50/50">
            {/* ── Header ────────────────────────────────────────────────── */}
            <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200/60">
                <div className="px-8 py-5 flex items-center justify-between">
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">
                            {clientName}
                        </h1>
                        <p className="text-sm text-gray-500 mt-0.5">
                            Manage and configure your AI voice agents
                        </p>
                    </div>
                    <div className="flex items-center gap-3">
                        <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                            <input
                                placeholder="Search agents..."
                                className="pl-9 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm w-64 bg-gray-50/50 focus:bg-white focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-400 transition-all placeholder:text-gray-400"
                            />
                        </div>
                        <Link
                            href={`/client/${params.clientId}/agents/new`}
                            className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-emerald-600 hover:from-emerald-700 hover:to-emerald-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold shadow-md shadow-emerald-500/20 hover:shadow-lg hover:shadow-emerald-500/25 transition-all"
                        >
                            <Plus className="w-4 h-4" />
                            New Agent
                        </Link>
                    </div>
                </div>

                {/* Stats bar */}
                {agents.length > 0 && (
                    <div className="px-8 pb-4 flex items-center gap-6">
                        <div className="flex items-center gap-2 text-sm">
                            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-50">
                                <Bot className="w-3.5 h-3.5 text-emerald-600" />
                            </div>
                            <span className="text-gray-500">Total</span>
                            <span className="font-semibold text-gray-900">{agents.length}</span>
                        </div>
                        <div className="w-px h-5 bg-gray-200" />
                        <div className="flex items-center gap-2 text-sm">
                            <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-50">
                                <Activity className="w-3.5 h-3.5 text-emerald-600" />
                            </div>
                            <span className="text-gray-500">Active</span>
                            <span className="font-semibold text-emerald-600">{agents.length}</span>
                        </div>
                    </div>
                )}
            </div>

            {/* ── Content ───────────────────────────────────────────────── */}
            <div className="p-8 flex-1 overflow-auto">
                {accountType === "UMBRELLA" && agents.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-20 text-center">
                        <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-emerald-500 to-emerald-600 flex items-center justify-center mb-6 shadow-lg shadow-emerald-500/20">
                            <Bot className="w-10 h-10 text-white" />
                        </div>
                        <h3 className="text-xl font-bold text-gray-900 mb-2">
                            No Agents Yet
                        </h3>
                        <p className="text-gray-500 text-sm max-w-md leading-relaxed mb-6">
                            Complete your onboarding to have AI agents set up
                            for your business. Once configured, your agents will
                            appear here.
                        </p>
                        <Link
                            href={`/client/${params.clientId}/onboarding`}
                            className="inline-flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-emerald-600 to-emerald-600 text-white rounded-xl hover:from-emerald-700 hover:to-emerald-700 transition-all text-sm font-semibold shadow-md shadow-emerald-500/20"
                        >
                            Go to Onboarding
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </Link>
                    </div>
                ) : (
                    <AgentGrid agents={agents} />
                )}
            </div>
        </div>
    );
}
