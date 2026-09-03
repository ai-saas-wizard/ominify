import { getAgent } from "@/lib/vapi";
import { AgentEditor } from "@/components/agents/agent-editor";
import { PhoneNumberAssignment } from "@/components/agents/phone-number-assignment";
import { AgentDetailHeader } from "@/components/agents/agent-detail-header";
import { TestCallCard } from "@/components/agents/test-call-card";
import { ArrowLeft, Calendar, FileSpreadsheet, ExternalLink } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getClientVapiKey } from "@/lib/client-secrets";
import { getCalendarConnectionStatus } from "@/lib/google-calendar";
import { getSheetsConnectionStatus } from "@/lib/google-sheets";

export default async function AgentEditorPage(props: {
    params: Promise<{ clientId: string; id: string }>;
}) {
    const params = await props.params;

    const vapiKey = params.clientId
        ? (await getClientVapiKey(params.clientId)) || undefined
        : undefined;

    const agent = await getAgent(params.id, vapiKey);

    if (!agent) {
        notFound();
    }

    const { data: agentRecord } = await supabase
        .from("agents")
        .select("id, agent_type, agent_config")
        .eq("vapi_id", params.id)
        .eq("client_id", params.clientId)
        .single();

    // VAPI is the source of truth for the voice prompt, and it gets edited in
    // the VAPI dashboard directly. The sequencer reads the DB copy
    // (agent_config.voice_prompt) for cross-channel context, so pull the live
    // prompt back into the DB whenever this page loads and they differ.
    if (agentRecord) {
        const vapiPrompt: string =
            agent.model?.systemPrompt ||
            (Array.isArray(agent.model?.messages)
                ? agent.model.messages.find((m: { role?: string }) => m.role === "system")?.content
                : "") ||
            "";
        if (vapiPrompt && vapiPrompt !== agentRecord.agent_config?.voice_prompt) {
            const { error: syncError } = await supabase
                .from("agents")
                .update({
                    agent_config: {
                        ...(agentRecord.agent_config || {}),
                        voice_prompt: vapiPrompt,
                    },
                })
                .eq("id", agentRecord.id);
            if (syncError) {
                console.error(
                    `[AGENT] voice_prompt sync from VAPI failed for ${agentRecord.id}:`,
                    syncError.message
                );
            } else {
                console.log(`[AGENT] voice_prompt pulled from VAPI for ${agentRecord.id}`);
            }
        }
    }

    const { data: allPhoneNumbers } = await supabase
        .from("tenant_phone_numbers")
        .select("id, phone_number, friendly_name, agent_id")
        .eq("client_id", params.clientId)
        .eq("status", "active");

    const phoneNumbers = allPhoneNumbers || [];
    const assignedNumber = agentRecord
        ? phoneNumbers.find((p) => p.agent_id === agentRecord.id) || null
        : null;
    const availableNumbers = phoneNumbers.filter((p) => !p.agent_id);

    const calendarStatus = await getCalendarConnectionStatus(params.clientId);
    const isCalendarConnected = calendarStatus?.is_active === true;

    const isREAgent =
        agentRecord?.agent_config?.vertical === "real_estate_investor";
    let isSheetsConnected = true;
    if (isREAgent) {
        const sheetsStatus = await getSheetsConnectionStatus(params.clientId);
        isSheetsConnected =
            sheetsStatus?.is_active === true && !!sheetsStatus?.google_sheet_id;
    }

    return (
        <div className="flex flex-col h-full bg-gray-50/50">
            {/* ── Top bar ───────────────────────────────────────────────── */}
            <div className="sticky top-0 z-10 bg-white/80 backdrop-blur-md border-b border-gray-200/60 px-8 py-3">
                <Link
                    href={`/client/${params.clientId}/agents`}
                    className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors group"
                >
                    <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                    Back to Agents
                </Link>
            </div>

            <div className="flex-1 overflow-auto">
                <div className="max-w-[1600px] mx-auto px-8 py-6 space-y-6">
                    {/* ── Integration Banners ────────────────────────────── */}
                    {!isCalendarConnected && (
                        <div className="flex items-center gap-4 p-4 bg-amber-50/80 border border-amber-200/60 rounded-xl">
                            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 shrink-0">
                                <Calendar className="w-5 h-5 text-amber-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-amber-900 text-sm">
                                    Google Calendar not connected
                                </p>
                                <p className="text-xs text-amber-700/80 mt-0.5">
                                    Enable availability checking and appointment booking.
                                </p>
                            </div>
                            <Link
                                href={`/client/${params.clientId}/settings/integrations`}
                                className="inline-flex items-center gap-1 text-sm font-semibold text-amber-800 hover:text-amber-900 shrink-0"
                            >
                                Connect
                                <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                        </div>
                    )}

                    {isREAgent && !isSheetsConnected && (
                        <div className="flex items-center gap-4 p-4 bg-amber-50/80 border border-amber-200/60 rounded-xl">
                            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-amber-100 shrink-0">
                                <FileSpreadsheet className="w-5 h-5 text-amber-600" />
                            </div>
                            <div className="flex-1 min-w-0">
                                <p className="font-semibold text-amber-900 text-sm">
                                    Google Sheets not connected
                                </p>
                                <p className="text-xs text-amber-700/80 mt-0.5">
                                    Auto-log call leads to a spreadsheet.
                                </p>
                            </div>
                            <Link
                                href={`/client/${params.clientId}/settings/integrations`}
                                className="inline-flex items-center gap-1 text-sm font-semibold text-amber-800 hover:text-amber-900 shrink-0"
                            >
                                Connect
                                <ExternalLink className="w-3.5 h-3.5" />
                            </Link>
                        </div>
                    )}

                    {/* ── Agent Header ───────────────────────────────────── */}
                    <AgentDetailHeader agent={agent} />

                    {/* ── Main Layout ────────────────────────────────────── */}
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        {/* Editor (main) */}
                        <div className="lg:col-span-2">
                            <AgentEditor
                                agent={agent}
                                clientId={params.clientId}
                                showSms={agentRecord?.agent_type === "outbound"}
                                smsPrompt={agentRecord?.agent_config?.sms_prompt || ""}
                                smsFirstMessage={
                                    agentRecord?.agent_config?.sms_first_message || ""
                                }
                                sharedContext={(() => {
                                    // Deploy paths store shared_context as a structured
                                    // object; the textarea needs a string. Pretty JSON
                                    // round-trips through updateAgentAction's parse.
                                    const sc = agentRecord?.agent_config?.shared_context;
                                    if (!sc) return "";
                                    return typeof sc === "string"
                                        ? sc
                                        : JSON.stringify(sc, null, 2);
                                })()}
                            />
                        </div>

                        {/* Sidebar */}
                        <div className="space-y-5">
                            {/* Test Agent Card */}
                            <TestCallCard
                                clientId={params.clientId}
                                vapiAssistantId={agent.id}
                                isSynced={!!agentRecord}
                                callerId={assignedNumber}
                            />

                            {/* Deployment Card */}
                            <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
                                <div className="px-5 py-4 border-b border-gray-100 bg-gray-50/40">
                                    <h3 className="font-semibold text-gray-900 text-sm">
                                        Deployment
                                    </h3>
                                </div>
                                <div className="p-5">
                                    {agentRecord ? (
                                        <PhoneNumberAssignment
                                            clientId={params.clientId}
                                            agentDbId={agentRecord.id}
                                            assignedNumber={assignedNumber}
                                            availableNumbers={availableNumbers}
                                        />
                                    ) : (
                                        <p className="text-sm text-gray-400 italic">
                                            Agent not synced to database yet.
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
