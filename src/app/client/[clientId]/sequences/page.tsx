import { supabase } from "@/lib/supabase";
import { fetchAllRows } from "@/lib/supabase-paginate";
import { getChannelCapabilities } from "@/lib/channels/capabilities";
import {
    SequencesListClient,
    type SequenceCardData,
} from "@/components/sequences/sequences-list-client";
import { IN_FLIGHT_STATUSES } from "@/components/sequences/observability/enrollment-status";

type EnrollmentStatRow = { sequence_id: string; status: string; is_test: boolean | null };

async function getSequencesData(clientId: string): Promise<SequenceCardData[]> {
    // Enrollments are read separately and paginated: embedding them in the
    // sequences select capped each sequence at 1000 rows, so a 3,000-lead
    // sequence showed "1000 enrolled" here.
    const [seqResult, enrollmentRows] = await Promise.all([
        supabase
            .from("sequences")
            .select(`
                *,
                sequence_steps(id, channel, enable_ai_mutation)
            `)
            .eq("client_id", clientId)
            .order("created_at", { ascending: false }),
        fetchAllRows<EnrollmentStatRow>((from, to) =>
            supabase
                .from("sequence_enrollments")
                .select("sequence_id, status, is_test")
                .eq("tenant_id", clientId)
                .order("id")
                .range(from, to),
        ).catch((e): EnrollmentStatRow[] => {
            console.error("getSequencesData enrollments error:", e);
            return [];
        }),
    ]);
    const { data, error } = seqResult;

    if (error) {
        console.error("getSequencesData error:", error);
        return [];
    }

    const enrollmentsBySequence = new Map<string, EnrollmentStatRow[]>();
    for (const e of enrollmentRows) {
        if (e.is_test) continue;
        const arr = enrollmentsBySequence.get(e.sequence_id);
        if (arr) arr.push(e);
        else enrollmentsBySequence.set(e.sequence_id, [e]);
    }

    return (data || []).map((seq: any) => {
        const steps = seq.sequence_steps || [];
        const enrollments = enrollmentsBySequence.get(seq.id) || [];

        const isTask = seq.metadata?.is_task === true ||
            seq.sequence_strategy?.is_task === true;

        return {
            id: seq.id,
            name: seq.name,
            description: seq.description,
            trigger_type: seq.trigger_type,
            urgency_tier: seq.urgency_tier,
            is_active: seq.is_active,
            generation_mode: seq.generation_mode || null,
            is_task: isTask,
            created_at: seq.created_at,
            updated_at: seq.updated_at || null,
            step_count: steps.length,
            channels: steps.map((s: any) => s.channel).filter(Boolean),
            ai_mutation_steps: steps.filter((s: any) => s.enable_ai_mutation).length,
            // Same in-flight definition the detail page uses: a dynamic
            // enrollment lives most of its life in awaiting_outcome /
            // generating_next_step, so counting only status='active' made this
            // list report far fewer running leads than the sequence itself.
            active_count: enrollments.filter((e: any) =>
                (IN_FLIGHT_STATUSES as readonly string[]).includes(e.status)
            ).length,
            paused_count: enrollments.filter((e: any) => e.status === "paused").length,
            completed_count: enrollments.filter(
                (e: any) => e.status === "completed" || e.status === "booked"
            ).length,
            replied_count: enrollments.filter((e: any) => e.status === "replied").length,
            booked_count: enrollments.filter((e: any) => e.status === "booked").length,
            failed_count: enrollments.filter((e: any) => e.status === "failed").length,
            total_enrolled: enrollments.length,
        };
    });
}

async function getTenantWizardContext(clientId: string) {
    const [profileResult, agentResult, metaResult, googleAdsResult, metaPagesResult, channelReadiness] = await Promise.all([
        supabase
            .from("tenant_profiles")
            .select("industry, emergency_phone, business_name")
            .eq("client_id", clientId)
            .single(),
        // Outbound agents only, sequences are run BY an agent, so the wizard
        // needs the pickable list (and gates on zero). vapi_id lets the wizard
        // scope the voice toggle to the SELECTED agent, not just the tenant.
        supabase
            .from("agents")
            .select("id, name, vapi_id")
            .eq("client_id", clientId)
            .eq("agent_type", "outbound")
            .order("created_at", { ascending: false }),
        // Tables may not exist on every environment yet, wrap in maybeSingle so a
        // missing-table error doesn't crash the page during phased rollout.
        supabase
            .from("tenant_meta_ads")
            .select("is_active")
            .eq("client_id", clientId)
            .eq("is_active", true)
            .maybeSingle(),
        supabase
            .from("tenant_google_ads")
            .select("is_active")
            .eq("client_id", clientId)
            .eq("is_active", true)
            .maybeSingle(),
        supabase
            .from("tenant_meta_ads_pages")
            .select("id")
            .eq("client_id", clientId)
            .eq("subscription_active", true)
            .limit(1),
        getChannelCapabilities(clientId),
    ]);

    // Also get the client email from clients table
    const { data: client } = await supabase
        .from("clients")
        .select("email")
        .eq("id", clientId)
        .single();

    const metaAdsConnected =
        !!metaResult.data && (metaPagesResult.data?.length ?? 0) > 0;
    const googleAdsConnected = !!googleAdsResult.data;

    return {
        outboundAgents: (agentResult.data as { id: string; name: string; vapi_id: string | null }[]) || [],
        channelReadiness,
        metaAdsConnected,
        googleAdsConnected,
        tenantProfile: {
            industry: profileResult.data?.industry || "general",
            phone: profileResult.data?.emergency_phone || "",
            email: client?.email || "",
            business_name: profileResult.data?.business_name || "",
        },
    };
}

export default async function SequencesPage({
    params,
}: {
    params: Promise<{ clientId: string }>;
}) {
    const { clientId } = await params;
    const [sequences, wizardContext] = await Promise.all([
        getSequencesData(clientId),
        getTenantWizardContext(clientId),
    ]);

    return (
        <SequencesListClient
            clientId={clientId}
            sequences={sequences}
            outboundAgents={wizardContext.outboundAgents}
            channelReadiness={wizardContext.channelReadiness}
            metaAdsConnected={wizardContext.metaAdsConnected}
            googleAdsConnected={wizardContext.googleAdsConnected}
            tenantProfile={wizardContext.tenantProfile}
        />
    );
}
