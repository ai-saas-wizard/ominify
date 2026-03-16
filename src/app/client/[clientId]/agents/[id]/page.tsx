import { getAgent, listVoices } from "@/lib/vapi";
import { AgentEditor } from "@/components/agents/agent-editor";
import { PhoneNumberAssignment } from "@/components/agents/phone-number-assignment";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default async function AgentEditorPage(props: {
    params: Promise<{ clientId: string, id: string }>;
}) {
    const params = await props.params;

    // Fetch Client Key
    let vapiKey: string | undefined = undefined;
    if (params.clientId) {
        const { data } = await supabase.from('clients').select('vapi_key').eq('id', params.clientId).single();
        if (data) vapiKey = data.vapi_key;
    }

    const [agent, voices] = await Promise.all([
        getAgent(params.id, vapiKey),
        listVoices(vapiKey)
    ]);

    if (!agent) {
        notFound();
    }

    // Get agent's DB record (for DB UUID)
    const { data: agentRecord } = await supabase
        .from('agents')
        .select('id')
        .eq('vapi_id', params.id)
        .eq('client_id', params.clientId)
        .single();

    // Get phone numbers from DB (not VAPI) — assigned to this agent + unassigned
    const { data: allPhoneNumbers } = await supabase
        .from('tenant_phone_numbers')
        .select('id, phone_number, friendly_name, agent_id')
        .eq('client_id', params.clientId)
        .eq('status', 'active');

    const phoneNumbers = allPhoneNumbers || [];
    const assignedNumber = agentRecord
        ? phoneNumbers.find(p => p.agent_id === agentRecord.id) || null
        : null;
    const availableNumbers = phoneNumbers.filter(p => !p.agent_id);

    return (
        <div className="p-4 lg:p-8 max-w-[1600px] mx-auto space-y-6">
            <Link
                href={`/client/${params.clientId}/agents`}
                className="inline-flex items-center text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back to Agents
            </Link>

            <div className="flex items-center justify-between">
                <h1 className="text-3xl font-bold tracking-tight">{agent.name}</h1>
                <div className="flex items-center gap-2">
                    <span className={`px-2 py-1 rounded-full text-xs font-medium border ${agent.orgId ? 'bg-green-50 text-green-700 border-green-200' : 'bg-gray-100'}`}>
                        Active
                    </span>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <div className="lg:col-span-2 space-y-6">
                    <AgentEditor agent={agent} voices={voices} />
                </div>
                <div className="space-y-6">
                    <div className="bg-white p-6 rounded-xl border shadow-sm space-y-4">
                        <h3 className="font-semibold text-gray-900">Test Agent</h3>
                        <p className="text-sm text-gray-500">
                            Talk to your agent directly from the browser to test the latency and response quality.
                        </p>
                        <button className="w-full bg-black text-white py-2 rounded-lg font-medium hover:bg-gray-800 transition-colors">
                            Start Call
                        </button>
                        <Link
                            href={`/client/${params.clientId}/logs?assistantId=${agent.id}`}
                            className="block w-full text-center py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                        >
                            View Logs
                        </Link>
                    </div>
                    <div className="bg-white p-6 rounded-xl border shadow-sm space-y-4">
                        <h3 className="font-semibold text-gray-900">Deployment</h3>
                        {agentRecord ? (
                            <PhoneNumberAssignment
                                clientId={params.clientId}
                                agentDbId={agentRecord.id}
                                assignedNumber={assignedNumber}
                                availableNumbers={availableNumbers}
                            />
                        ) : (
                            <p className="text-sm text-gray-400 italic">Agent not synced to database yet.</p>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
